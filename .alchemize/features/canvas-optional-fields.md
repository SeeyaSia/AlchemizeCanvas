# Optional Drupal Fields Linked to Component Props

## Overview

Canvas allows linking Drupal entity fields to SDC component props via content
templates. When an **optional** Drupal field (e.g. `body`) is linked to a
component prop (e.g. `text` on a paragraph component), the field may be empty.
This document explains how the system handles that scenario and the design
decisions behind it.

## The Problem

Upstream Canvas (stable 1.x) **prevents** optional Drupal fields from being
mapped to required component props. The `JsonSchemaFieldInstanceMatcher`
checks `isRequired()` on the Drupal field and rejects the match if the field
is optional but the prop is required.

Our branches remove this restriction because real-world content templates need
to link optional fields (like an optional body field) to components.

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

**File:** `src/Plugin/Canvas/ComponentSource/SingleDirectoryComponent.php`,
`src/Plugin/Canvas/ComponentSource/GeneratedFieldExplicitInputUxComponentSourceBase.php`

Handles the rendering of components when linked fields are empty:

1. **`hydrateComponent()`** — For required props that evaluate to NULL (linked
   to an empty optional field), evaluates the default `StaticPropSource` for a
   fallback value. If the default is also NULL, unsets the prop so
   `substituteEmptyPropsWithExamples()` can fill it from SDC metadata examples.

2. **`substituteEmptyPropsWithExamples()`** — Fills absent or NULL props with
   their SDC `examples[0]` values. Runs for both preview and live rendering to
   prevent SDC validation failures. Only affects props that are both absent/NULL
   AND have an `examples` key in their schema.

## The Whack-a-Mole Trap (Lessons Learned)

We hit a cycle of "fix one thing, break another" because of how three layers
interact. Understanding this chain prevents falling into the same trap again.

### The Rendering Pipeline

```
Field evaluation → hydrateComponent() → renderComponent() → substituteEmptyPropsWithExamples() → SDC validation → Twig
```

### The Conflict

1. **`hydrateComponent()`** intentionally UNSETS optional props with NULL
   values (upstream behavior, lines 396-398). This is correct — optional
   absent props pass SDC validation.

2. **`substituteEmptyPropsWithExamples()`** fills examples for ALL absent
   props that have an `examples` key — it does NOT distinguish between
   required and optional props. This can **override** the hydration decision
   and inject example text for props that were intentionally removed.

3. **Twig templates** may have their own empty-state handling (e.g. showing a
   "Body Field" placeholder in preview, rendering nothing on live). But if
   `substituteEmptyPropsWithExamples()` fills in example text first, the Twig
   template never sees the empty state.

### The Chain of Failures

```
Step 1: Allow optional field → required prop mapping
Step 2: Body is empty → text = NULL → SDC validation fails in preview
Step 3: Add substituteEmptyPropsWithExamples() for preview → preview works
Step 4: Live site still crashes (substitute only ran in preview)
Step 5: Make substitute unconditional → live works BUT...
Step 6: Now both preview AND live show example text ("A paragraph element...")
        instead of the Twig template's own empty-state handling
Step 7: Fix hydrateComponent to unset NULL required props → substitute fills
        them BACK with the example → still shows generic text
```

## The Correct Approach

The solution has two layers, depending on whether the component prop should be
required or optional:

### For Props That Should Be Optional (Preferred)

If a component can render meaningfully without a prop (e.g. a paragraph renders
nothing when text is empty), the prop should be **optional** in the SDC schema:

1. **Remove from `required` array** in `component.yml`
2. **Remove `examples` key** from the prop definition (prevents
   `substituteEmptyPropsWithExamples()` from injecting placeholder text)
3. **Handle empty state in Twig** — the template controls what to show:
   - Preview: show a descriptive placeholder (e.g. "Body Field")
   - Live: render nothing

This is the cleanest approach because:
- `hydrateComponent()` correctly unsets the optional NULL prop (existing code)
- `substituteEmptyPropsWithExamples()` has nothing to inject (no examples key)
- SDC validation passes (optional prop can be absent)
- Twig controls the empty-state UX

### For Props That Must Be Required

If a component genuinely needs a prop value (e.g. a heading without text is
meaningless), keep it required. The `hydrateComponent()` fix handles this:

1. Required prop evaluates to NULL → evaluate default `StaticPropSource`
2. Default is typically an empty string → passes SDC validation
3. If default is also NULL → unset → `substituteEmptyPropsWithExamples()`
   fills from `examples[0]`

This means the SDC `examples` value acts as a last-resort fallback for required
props. For preview AND live rendering.

## Guidelines for Component Authors

### When to mark a prop as required

- The component is meaningless without the prop (heading without text)
- The prop controls structural behavior (layout direction, variant)
- Every content instance MUST provide this value

### When to mark a prop as optional

- The component degrades gracefully without it (paragraph without text = nothing)
- The prop enhances but isn't essential (subtitle, description)
- The prop is linked to an optional Drupal field

### When a prop is optional and linked to a field

1. Remove from `required` array in the component YAML
2. Remove `examples` from the prop definition (prevents ghost placeholder text)
3. Add empty-state handling in the Twig template:

```twig
{% set text_rendered = text is iterable ? text|render : text|default('') %}
{% set text_stripped = text_rendered|striptags|trim %}

{% if text_stripped is not empty %}
  {# Normal rendering #}
  <p>{{ text_rendered }}</p>
{% elseif canvas_is_preview is defined and canvas_is_preview %}
  {# Preview placeholder — tells editor which field this is #}
  <p class="text-muted fst-italic">Field Name</p>
{% endif %}
{# Live site with empty field: render nothing #}
```

### Key principle

> The Twig template should own the empty-state UX, not the PHP rendering
> pipeline. Remove `examples` from optional props to prevent
> `substituteEmptyPropsWithExamples()` from overriding Twig's decisions.

## Potential Future Improvement

`substituteEmptyPropsWithExamples()` could be made smarter by checking the
schema's `required` array and only filling examples for required props. This
would be a defense-in-depth measure that prevents optional props with
`examples` from being accidentally filled on live rendering:

```php
$required_props = $metadata->schema['required'] ?? [];
foreach ($schema_properties as $prop_name => $prop_schema) {
    // Only substitute examples for required props.
    if (!in_array($prop_name, $required_props, TRUE)) {
        continue;
    }
    // ... existing logic
}
```

This is not implemented yet because the current approach (removing `examples`
from optional props) works and is simpler. But if a component has legitimate
reasons to keep `examples` on an optional prop (e.g. for the SDC styleguide),
this code-level guard would prevent unintended injection.

## File Reference

| File | Branch | Purpose |
|------|--------|---------|
| `JsonSchemaFieldInstanceMatcher.php` | `fix/optional-field-mapping` | Allows optional fields → required props |
| `Evaluator.php` | `fix/computed-url-optional-field` | Graceful NULL on empty field delta |
| `ComputedUrlWithQueryString.php` | `fix/computed-url-optional-field` | Handle NULL URLs |
| `SingleDirectoryComponent.php` | `fix/preview-empty-optional-props` | `substituteEmptyPropsWithExamples()` |
| `GeneratedFieldExplicitInputUxComponentSourceBase.php` | `fix/preview-empty-optional-props` | `hydrateComponent()` NULL fallback |
