# Canvas Upstream Sync — Agent Runbook

You are updating our local Canvas branches to align with the latest upstream
dev branch. This is a multi-phase process combining automated scripts with
your analysis and judgment.

## Prerequisites
- Working directory: the canvas repo root
- Remotes: `upstream` → drupal.org canvas, `origin` → our GitHub fork
- Current branch: `local/integration`
- Config: `.alchemize/sync-branches.conf` lists all branches in merge order

## Step 0: Snapshot (BEFORE ANYTHING ELSE)

Before touching anything, create pre-sync snapshot tags so we can restore
every branch to its current working state if the sync goes wrong.

```bash
DATE=$(date +%Y%m%d)
# Tag integration
git tag "pre-sync/${DATE}/integration" local/integration
# Tag every branch
for branch in $(grep -v '^\s*#' .alchemize/sync-branches.conf | grep -v '^\s*$'); do
  short="${branch#local/}"
  git tag "pre-sync/${DATE}/${short}" "$branch"
done
# Verify
git tag -l "pre-sync/${DATE}/*"
```

To restore everything after a failed sync:
```bash
DATE=<the date used above>
for branch in $(grep -v '^\s*#' .alchemize/sync-branches.conf | grep -v '^\s*$'); do
  short="${branch#local/}"
  git checkout "$branch" && git reset --hard "pre-sync/${DATE}/${short}"
done
git checkout local/integration && git reset --hard "pre-sync/${DATE}/integration"
```

Note: The sync script (`sync-upstream.sh`) also creates these tags automatically
in Phase A, but always create them manually first to be safe — especially if
you plan to run steps individually rather than using the full script.

## Step 1: Reconnaissance (READ-ONLY)

Before touching anything, understand what changed upstream.

1. Fetch upstream: `git fetch upstream`
2. Find our current fork point: `git merge-base local/integration upstream/1.x`
3. List new upstream commits: `git log --oneline <fork-point>..upstream/1.x`
4. Count them: if 0, report "already up to date" and stop.

For each new upstream commit, analyze:
- What functional area does it touch?
- Does it overlap with any of our branches? (check `.alchemize/sync-branches.conf`)
- Is it adopting a new convention we should follow? (coding standards, patterns, APIs)
- Does it fix something we also fixed? If so, compare approaches.

### Key questions to answer in recon:
- [ ] Are any of our fix branches now **redundant**? (upstream fixed same issue)
- [ ] Are any of our fix branches now **superseded**? (upstream took a different approach)
- [ ] Has upstream introduced new **conventions** we should adopt? (naming, coding standards, architectural patterns)
- [ ] Has upstream changed **APIs we depend on**? (renamed classes, changed method signatures, new required parameters)
- [ ] Are there new upstream features that **complement** our work? (should we integrate with them?)
- [ ] Are there new upstream features that **conflict** with our approach? (should we change direction?)

Report findings to the user before proceeding.

## Step 2: Plan Updates

Based on recon, decide what needs to happen beyond mechanical rebase:

### 2a. Branches to DROP
If upstream fixed the same issue we have a fix branch for, AND their approach
is equivalent or better, recommend dropping our branch:
- Remove it from `.alchemize/sync-branches.conf`
- Delete the local branch (after confirmation)

### 2b. Branches to ADAPT
If upstream changed something that affects our branch's approach:
- Note what needs to change in our code
- Will be applied after rebase in Step 4

### 2c. Conventions to ADOPT
If upstream introduced new coding standards, patterns, or conventions:
- Note them for application across all branches
- Examples: function prefix conventions, annotation styles, new base classes,
  architectural patterns (e.g., if they introduced a service pattern we
  should use instead of direct entity manipulation)

### 2d. New branches to CREATE
If upstream added something we should build on:
- Note the new branch needed
- Add to `.alchemize/sync-branches.conf` in correct position

Present this plan to the user for approval.

## Step 3: Rebase Branches

### 3a. Run Phase A (setup)

Use the script for tagging and state setup:
```bash
./.alchemize/sync-upstream.sh --phase=A
```
This fetches upstream, creates pre-sync tags, and saves branch list + `.alchemize/`
backup to `.git/sync-state/`.

### 3b. Rebase each branch directly

Do NOT use the script for rebases — direct control is better for inline conflict
resolution (the script's pause/resume model requires exiting and re-entering).

```bash
UPSTREAM=$(git rev-parse upstream/1.x)
for branch in $(grep -v '^\s*#' .alchemize/sync-branches.conf | grep -v '^\s*$'); do
  git checkout "$branch"
  git rebase "$UPSTREAM"
  # If conflict: resolve inline, then:
  #   git add <resolved-files>
  #   git rebase --continue
  # Repeat until rebase completes, then continue loop.
done
```

For each conflict:
1. Read the conflict carefully
2. Understand both sides (our change + upstream change)
3. Resolve by keeping our logic AND adopting upstream conventions
4. `git add <resolved-files> && git rebase --continue`

If a branch can't be resolved mechanically, note it for manual handling in Step 4.

## Step 4: Intelligent Review & Cleanup

After all branches are rebased, review each one:

For EACH branch in `.alchemize/sync-branches.conf`:
1. `git checkout <branch>`
2. `git diff upstream/1.x..HEAD` — review our changes in context of new upstream
3. Check: does our code use any patterns upstream has moved away from?
4. Check: are there new upstream utilities/services we should use instead of
   our custom implementations?
5. Check: does our code follow the latest upstream conventions?
   - PHP: backslash-prefixed built-in functions
   - PHP: `declare(strict_types=1)` if upstream now requires it
   - PHP: `#[Group(...)]` annotations instead of `@group` in tests
   - PHP: `CanvasKernelTestBase` instead of `KernelTestBase` in tests
   - TS/JS: check import patterns, naming conventions
6. If changes needed: make them, commit with clear message
7. If the branch is no longer needed: flag it for removal

### Upstream-readiness checks (CRITICAL):
Each branch must be submittable to upstream as-is. Verify:
- [ ] Branch is rebased on latest `upstream/1.x` (no merge commits)
- [ ] Commit messages follow upstream conventions (see recent upstream commits)
- [ ] No integration-only code leaked into feature branches (build artifacts, .gitignore hacks, README changes, `.alchemize/` files)
- [ ] Code follows ALL current upstream coding standards
- [ ] If the branch has tests, they extend `CanvasKernelTestBase` (not `KernelTestBase`)
- [ ] PHP files include `declare(strict_types=1)` where upstream requires it
- [ ] No references to our internal tooling, GitHub fork, or integration process

### Things to specifically watch for:
- **DynamicPropSource → EntityFieldPropSource**: ensure our code uses new name
- **CanvasKernelTestBase**: if we have test files, extend this instead of KernelTestBase
- **declare(strict_types=1)**: upstream requires this in PHP files now
- **SPA navigation changes**: test that our per-content editing flow works with
  the discard/refresh logic upstream added
- **Component version auto-upgrade**: ensure our merged component tree handles
  the new version reconciliation logic

## Step 5: Rebuild Integration

After all branches are reviewed and updated:

### 5a. Reset integration to upstream

```bash
UPSTREAM=$(git rev-parse upstream/1.x)
git checkout -B local/integration "$UPSTREAM"
```

### 5b. Merge all branches

You can use the script (`sync-upstream.sh --phase=C`) or merge directly.
Direct merging is equally valid and gives you inline conflict control:

```bash
for branch in $(cat .git/sync-state/branches.txt); do
  short="${branch#local/}"
  git merge --no-ff "$branch" -m "Merge $short"
  # If conflict: resolve inline, git add, git commit, then continue loop.
done
```

If there are integration merge conflicts (between our own branches):
- These indicate branches that now overlap in ways they didn't before
- Resolve carefully, understanding both branches' intent
- Expected conflicts: per-content-editing-backend vs entity-layout-tab,
  expose-slot-dialog-ui vs per-content-editing-frontend

### 5c. Restore `.alchemize/`

The checkout -B above resets to upstream which deletes `.alchemize/`.
Restore it from the pre-sync tag:

```bash
DATE=$(date +%Y%m%d)  # or the date used in Phase A
git checkout "pre-sync/${DATE}/integration" -- .alchemize/
git commit -m "Restore .alchemize/ tooling on integration branch"
```

Or from the state backup (if Phase A was run):
```bash
cp -R .git/sync-state/alchemize-backup .alchemize
git add .alchemize/
git commit -m "Restore .alchemize/ tooling on integration branch"
```

### 5d. Build and commit artifacts

Build prerequisites — order matters:

```bash
# 1. Install workspace deps at root (hoisted deps like tsdown live here)
npm install

# 2. Build drupal-canvas first (dependency of astro-hydration)
cd packages/drupal-canvas && npm run build && cd ../..

# 3. Build UI (chains vite build → build:astro internally)
cd ui && npm run build && cd ..
```

**Type-check fallback:** If `npm run build` in `ui/` fails on `tsc --noEmit`
(due to hoisted vite-plugin-svgr types), use `npx vite build` directly:
```bash
cd ui && npx vite build && cd ..
```

Then un-ignore and commit build artifacts:

```bash
# Flip gitignore rules to include build dirs
sed -i '' 's|^/ui/dist$|!/ui/dist|' .gitignore
sed -i '' 's|^/packages/astro-hydration/dist$|!/packages/astro-hydration/dist|' .gitignore

git add -A
git commit -m "Include build artifacts in integration branch"
```

## Step 6: Verify

1. `git log --oneline --first-parent local/integration | head -25`
   → Should show: upstream commits + merge commits for each branch + build artifacts
2. `git diff upstream/1.x..local/integration --stat | grep -v dist/`
   → Should show ONLY our changes (no upstream-only drift)
3. For each branch: `git log --oneline upstream/1.x..<branch>`
   → Should show only our commits (typically 1-3 per branch)
4. Quick PHPCS check on our changed files:
   ```bash
   for branch in $(grep -v '^\s*#' .alchemize/sync-branches.conf | grep -v '^\s*$'); do
     files=$(git diff --name-only upstream/1.x..$branch -- '*.php')
     if [ -n "$files" ]; then
       echo "--- $branch ---"
       echo "$files" | xargs grep -n '([^\\])is_array\b' 2>/dev/null || true
     fi
   done
   ```
   → Should find zero unescaped calls in files we touched

## Step 7: Report

Summarize to the user:
- What upstream commits were incorporated (count and notable changes)
- Which branches had conflicts and how they were resolved
- What conventions/patterns were adopted across branches
- Any branches dropped, adapted, or created
- **Upstream-readiness status**: for each branch, confirm it's clean and
  submittable as an MR to drupal.org. Flag any that aren't and why.
- Current status of integration branch
- Recommendation for next steps (push, test, etc.)

### Report template:

```
## Upstream Sync Report — <date>

### Upstream Changes
- X new commits since last sync (<old-hash>..<new-hash>)
- Notable: <summary of significant upstream changes>

### Branch Status
| Branch | Status | Conflicts | Notes |
|--------|--------|-----------|-------|
| local/fix/... | Rebased | None | Clean |
| ... | ... | ... | ... |

### Conventions Adopted
- <list any new conventions applied>

### Branches Dropped/Added
- <list or "None">

### Upstream-Readiness
- All branches ready for MR: Yes/No
- Issues: <list any branches not ready and why>

### Next Steps
- [ ] Push with: `./.alchemize/sync-upstream.sh --push`
- [ ] Test deployment from local/integration
- [ ] Submit MRs for branches that are ready
```

## Known Issues / Lessons

### `tsc --noEmit` may fail in `ui/` build

The `npm run build` script in `ui/` runs `tsc --noEmit` before `vite build`.
This type-check can fail with errors about `vite-plugin-svgr` types that are
hoisted to the workspace root. This is a pre-existing issue that does **not**
affect the actual Vite build output. Workaround: run `npx vite build` directly.

### Integration merge conflicts between overlapping branches

Certain branch pairs are expected to conflict when merged into integration:
- `per-content-editing-backend` vs `entity-layout-tab` — both touch entity
  routing and tab configuration
- `expose-slot-dialog-ui` vs `per-content-editing-frontend` — both modify
  the slot dialog and editing UI components

These are not bugs — they reflect intentional overlap between features that
build on each other. Resolve by keeping both sides' intent.
