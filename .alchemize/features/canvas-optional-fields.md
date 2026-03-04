# Optional Drupal Fields Linked to Component Props

## Overview

Canvas allows linking Drupal entity fields to SDC component props via content
templates. When an **optional** Drupal field (e.g. `body`) is linked to a
component prop (e.g. `text` on a paragraph component), the field may be empty.
This document explains how the system handles that scenario, the full rendering
pipeline, and the design decisions behind the current implementation.

## The Problem

Upstream Canvas (stable 1.x) **prevents** optional Drupal fields from being
mapped to required component props. The `JsonSchemaFieldInstanceMatcher`
checks `isRequired()` on the Drupal field and rejects the match if the field
is optional but the prop is required.

Our branches remove this restriction because real-world content templates need
to link optional fields (like an optional body field) to components.

## The Full Rendering Pipeline

Understanding the data flow is essential to avoid the whack-a-mole trap (see
below). Here is the complete chain from field evaluation to rendered output:

```
ComponentTreeItemList::toRenderable()
  → getHydratedTree() → getHydratedValue()
      → For each component instance:
          1. getExplicitInput($uuid, $item)
             Returns: { 'source': {raw prop source arrays},
                        'resolved': {EvaluationResult objects} }

          2. hydrateComponent($explicit_input, ...)
             Receives BOTH 'source' and 'resolved'.
             Discards 'source' (except for label collection).
             Returns: { 'explicit_input': {processed values},
                        '_empty_prop_labels': {field labels for empty props},
                        'slots': {...} }
  → renderify($hydrated)
      → For each component:
          3. renderComponent($inputs, $slot_defs, $uuid, $isPreview)
             Receives hydrated output (including _empty_prop_labels).
             In preview: substituteEmptyPropsWithExamples() fills placeholders.
             On live: absent props stay absent.

          4. SDC validation → Twig rendering
```

### Key data flow insight

`getExplicitInput()` returns raw prop source arrays (`'source'` key) that
identify whether each prop is linked to an entity field, a static value, a
host entity URL, etc. `hydrateComponent()` is the **only** method that sees
both the raw sources and the resolved values. By the time `renderComponent()`
runs, only the hydrated values remain — the raw source info is gone.

This is why `_empty_prop_labels` must be collected in `hydrateComponent()`
and threaded through to `renderComponent()`.

## Our Fix Branches

### `local/fix/optional-field-mapping`

**File:** `src/ShapeMatcher/JsonSchemaFieldInstanceMatcher.php`

Removes the `isRequired()` checks that block optional fields from matching
required props. This is the gate-opener that enables the use case.

### `local/fix/computed-url-optional-field`

**Files:** `src/PropExpressions/StructuredData/Evaluator.php`,
`src/Plugin/DataType/ComputedUrlWithQueryString.php`

Fixes a real upstream bug: when an empty field (e.g. image with no file) is
evaluated with a specific delta (`body.0.value`), the Evaluator unconditionally
throws `\LogicException` even when `is_required: FALSE`. This fix:

- Adds a graceful NULL return when the delta doesn't exist and `is_required`
  is FALSE.
- Changes `ComputedUrlWithQueryString` to use `is_required: FALSE` and handle
  NULL URLs gracefully.

### `local/fix/preview-empty-optional-props`

**Files:** `src/Plugin/Canvas/ComponentSource/SingleDirectoryComponent.php`,
`src/Plugin/Canvas/ComponentSource/GeneratedFieldExplicitInputUxComponentSourceBase.php`

Handles rendering when linked fields are empty. Three key behaviors:

1. **`hydrateComponent()`** — For optional props that evaluate to NULL, unsets
   them (upstream behavior). For required props that evaluate to NULL (linked
   to an empty optional field), evaluates the default `StaticPropSource`. If
   the default is also NULL, unsets the prop. In **all** unset paths, collects
   the linked entity field's label via `collectEmptyPropLabel()`.

2. **`collectEmptyPropLabel()`** — New helper that parses the raw prop source
   array. If the source is an `EntityFieldPropSource`, extracts the Drupal
   field label (e.g. "Body") using `EntityFieldPropSource::label()`. Labels
   are passed downstream via `_empty_prop_labels` in the hydrated output.

3. **`substituteEmptyPropsWithExamples()`** — Now **preview-only** (guarded
   by `if ($isPreview)`). Priority for empty props:
   - First: linked entity field label from `_empty_prop_labels` (e.g. "Body")
   - Fallback: SDC `examples[0]` value (for non-field-linked props)
   - On live site: method is not called; absent props remain absent.

## The Whack-a-Mole Trap (Lessons Learned)

We hit a cycle of "fix one thing, break another" because of how three layers
interact. Understanding this chain prevents falling into the same trap again.

### The Conflict (before the fix)

1. **`hydrateComponent()`** intentionally UNSETS optional props with NULL
   values (upstream behavior). This is correct — optional absent props pass
   SDC validation.

2. **`substituteEmptyPropsWithExamples()`** (when unconditional) fills
   examples for ALL absent props that have an `examples` key — it does NOT
   distinguish between required and optional, or between preview and live.
   This **overrides** the hydration decision and injects example text for
   props that were intentionally removed.

3. **Twig templates** may have their own empty-state handling. But if the
   PHP layer fills in example text first, the template never sees empty state.

### The Chain of Failures

```
Step 1: Allow optional field → required prop mapping
Step 2: Body is empty → text = NULL → SDC validation fails in preview
Step 3: Add substituteEmptyPropsWithExamples() for preview → preview works
Step 4: Live site still crashes (substitute only ran in preview)
Step 5: Make substitute unconditional → live works BUT...
Step 6: Now both preview AND live show example text ("A paragraph element...")
        instead of the Twig template's own empty-state handling
Step 7: Try Twig-level fix with canvas_is_preview → works but WRONG:
        theme now contains Canvas-specific logic, breaking clean SDC pattern
```

### The Resolution

The fix is **preview-only substitution with entity field labels**:

- `substituteEmptyPropsWithExamples()` runs only in preview mode
- It prefers the linked field's label over the generic SDC example
- On live: absent optional props remain absent, Twig handles empty state
- Theme Twig stays completely free of Canvas awareness

## The Correct Approach

### Design Principle

> The Canvas module owns preview placeholder UX. Theme Twig templates own
> empty-state rendering for the live site. The two concerns must not mix.

This means:
- **No `canvas_is_preview` checks in theme Twig** — the theme should be a
  pure SDC component that renders content or renders nothing.
- **Canvas injects preview placeholders in the PHP layer** — before the
  render array reaches Twig, the module fills in meaningful values.
- **Live site never gets placeholder text** — if a field is empty, the prop
  is absent, and Twig decides what to render (usually nothing).

### For Props Linked to Optional Fields

Make the prop **optional** in the SDC schema:

1. **Remove from `required` array** in `component.yml`
2. **Handle empty state in Twig** — render nothing when the prop is absent:

```twig
{% set text_rendered = text is iterable ? text|render : text|default('') %}
{% set text_stripped = text_rendered|striptags|trim %}

{% if text_stripped is not empty %}
  <p>{{ text_rendered }}</p>
{% endif %}
{# Empty: render nothing — both preview-with-field-label and live #}
```

3. **Keep or remove `examples`** — with preview-only substitution, examples
   only appear in the Canvas editor, never on the live site. But for field-
   linked props, the field label takes priority anyway.

4. **Align config entity** — update the Canvas component config entity
   (e.g. `canvas.component.sdc.*.yml`) to set `required: false` for the prop,
   matching the component YAML.

### For Props That Must Be Required

Keep it required. The `hydrateComponent()` fix handles this:

1. Required prop evaluates to NULL → evaluate default `StaticPropSource`
2. Default is typically an empty string → passes SDC validation
3. If default is also NULL → unset → preview gets field label or SDC example

### What the User Sees

| Scenario                        | Preview           | Live          |
|---------------------------------|-------------------|---------------|
| Field has content               | Renders content   | Renders content |
| Field empty, linked to entity   | Shows field label (e.g. "Body") | Renders nothing |
| Prop not linked to any field    | Shows SDC example | Renders nothing |
| Prop with static source, empty  | Shows SDC example | Renders nothing |

## Config Entity vs Component YAML

The Canvas component config entity (e.g.
`canvas.component.sdc.alchemize_forge.paragraph.yml`) stores `required: true/false`
per prop **independently** from the component YAML's `required` array.
`hydrateComponent()` reads the config entity — not the YAML — to decide code paths.

When making a prop optional:
- Update the component YAML (`required` array)
- **Also** update the config entity to set `required: false`
- Otherwise hydration still treats the prop as required

## Guidelines for Component Authors

### When to mark a prop as required

- The component is meaningless without the prop (heading without text)
- The prop controls structural behavior (layout direction, variant)
- Every content instance MUST provide this value

### When to mark a prop as optional

- The component degrades gracefully without it (paragraph without text = nothing)
- The prop enhances but isn't essential (subtitle, description)
- The prop is linked to an optional Drupal field

### Key principle

> The Twig template should handle empty-state rendering for the live site.
> Canvas handles preview placeholders in the PHP rendering pipeline.
> These two concerns should never cross.

## File Reference

| File | Branch | Purpose |
|------|--------|---------|
| `JsonSchemaFieldInstanceMatcher.php` | `fix/optional-field-mapping` | Allows optional fields → required props |
| `Evaluator.php` | `fix/computed-url-optional-field` | Graceful NULL on empty field delta |
| `ComputedUrlWithQueryString.php` | `fix/computed-url-optional-field` | Handle NULL URLs |
| `SingleDirectoryComponent.php` | `fix/preview-empty-optional-props` | Preview-only `substituteEmptyPropsWithExamples()` with field labels |
| `GeneratedFieldExplicitInputUxComponentSourceBase.php` | `fix/preview-empty-optional-props` | `hydrateComponent()` NULL fallback + `collectEmptyPropLabel()` |

### Key methods

| Method | File | Role |
|--------|------|------|
| `getExplicitInput()` | `GeneratedField...Base.php` | Returns raw sources + resolved values |
| `hydrateComponent()` | `GeneratedField...Base.php` | Processes NULLs, collects field labels |
| `collectEmptyPropLabel()` | `GeneratedField...Base.php` | Extracts field label from EntityFieldPropSource |
| `renderComponent()` | `SingleDirectoryComponent.php` | Builds render array, calls substitution in preview |
| `substituteEmptyPropsWithExamples()` | `SingleDirectoryComponent.php` | Fills field labels / SDC examples (preview only) |
| `EntityFieldPropSource::label()` | `PropSource/EntityFieldPropSource.php` | Returns linked Drupal field's label |
