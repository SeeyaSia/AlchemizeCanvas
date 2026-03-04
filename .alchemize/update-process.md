 Plan: Reproducible Agent-Driven Upstream Sync for Canvas Local Branches
                                                                                                           
 Context                                                

 We maintain 18 local branches (8 fixes, 10 features) for Canvas, all independently based on the upstream
 1.x dev branch. These are merged into local/integration for deployment. The upstream dev branch is
 actively developed by the community. We need a repeatable, agent-driven process that combines mechanical
 sync (scripts) with intelligent review (agent analysis) to keep our branches current, aligned with
 upstream direction, and clean.

 Core Design Goal: Upstream-Ready Branches

 Every local branch must always be a clean set of commits rebased on top of latest upstream/1.x. This
 means:
 - Each branch can be submitted as a merge request to the Canvas project at any time
 - No merge commits, no integration-only artifacts — just our focused changes on top of dev
 - Branches follow upstream coding conventions, patterns, and API usage
 - The local/integration branch is a derived artifact (rebuilt from branches), not a source of truth
 - If upstream adopts one of our fixes or features, we simply drop that branch from the config

 Deliverables — 3 files in .alchemize/

 All tooling lives in .alchemize/ at the repo root. This directory is only committed on local/integration
 — never on individual fix/feat branches. This ensures our internal tooling never leaks into upstream
 merge requests.

 1. .alchemize/sync-branches.conf — Branch list and merge order

 2. .alchemize/sync-upstream.sh — Mechanical sync script

 3. .alchemize/agent-update.md — Agent runbook (the brain of the process)

 The human workflow is: open Claude Code, pass in .alchemize/agent-update.md, and the agent handles
 everything — running scripts, reviewing changes, making updates, resolving conflicts, and rebuilding
 integration.

 The .alchemize/ directory should also be added to .gitignore on each feature/fix branch (as part of the
 upstream PHPCS/convention cleanup) so it never accidentally gets committed there. On local/integration,
 it's explicitly tracked.

 ---
 File 1: .alchemize/sync-branches.conf

 Plain text, one branch per line. Order matters for integration merge. Comments allowed.

 # Phase 1 - Independent fixes
 local/fix/optional-field-mapping
 local/fix/computed-url-optional-field
 local/fix/viewbuilder-label-field
 local/fix/validator-scoped-parent
 local/fix/hydration-orphan-parent
 local/fix/access-check-graceful-403
 local/fix/autosave-revision-ordering
 local/fix/preview-empty-optional-props

 # Phase 2 - Feature chain (order matters)
 local/feat/active-exposed-slots
 local/feat/merged-component-tree
 local/feat/field-widget-component-tree
 local/feat/auto-provision-slot-fields
 local/feat/canvas-fields-api
 local/feat/generalize-content-api
 local/feat/entity-layout-tab
 local/feat/per-content-editing-backend
 local/feat/expose-slot-dialog-ui
 local/feat/per-content-editing-frontend

 Ordering rationale:
 - Fixes first — independent, establish the baseline
 - active-exposed-slots before merged-component-tree — both modify ContentTemplate.php around
 getExposedSlots()/getActiveExposedSlots()
 - Features build logically: data model → API → routing → backend → UI

 ---
 File 2: .alchemize/sync-upstream.sh (~250 lines)

 Pausable/resumable shell script with 4 phases. State tracked in .git/sync-state.

 Phase A: Preparation

 1. Verify clean working tree
 2. git fetch upstream
 3. Tag current integration: local/integration-at-<mergebase-short-hash>
 4. Save pre-rebase refs for every branch (to .git/sync-state for rollback)
 5. Record target upstream ref

 Phase B: Rebase each branch

 For each branch in sync-branches.conf:
 1. git checkout <branch>
 2. git rebase upstream/1.x
 3. If conflict → pause, print instructions, exit (user/agent resolves, runs --continue)
 4. If clean → run PHPCS auto-fix on branch's changed PHP files:
   - sed replacement for bare is_array( → \is_array( etc. (16 is_* functions)
   - Only on files changed by the branch: git diff --name-only upstream/1.x..HEAD -- '*.php'
   - If changes, commit: "chore: adopt PHPCS backslash prefix convention"
 5. Move to next branch

 Phase C: Rebuild integration

 1. git checkout -B local/integration upstream/1.x
 2. For each branch: git merge --no-ff <branch> -m "Merge <short-name>"
 3. Apply integration-only changes:
   - .gitignore: un-ignore ui/dist and packages/astro-hydration/dist
   - Build: cd ui && npm ci && npm run build
   - Build: cd packages/astro-hydration && npm ci && npm run build
   - Commit build artifacts

 Phase D: Push (requires --push flag)

 1. Force-with-lease push all rebased branches to origin
 2. Push integration branch
 3. Push tags

 Script flags

 ┌────────────┬─────────────────────────────────────────┐
 │    Flag    │                 Purpose                 │
 ├────────────┼─────────────────────────────────────────┤
 │ --continue │ Resume after conflict resolution        │
 ├────────────┼─────────────────────────────────────────┤
 │ --abort    │ Restore branches to pre-rebase state    │
 ├────────────┼─────────────────────────────────────────┤
 │ --skip     │ Skip current branch, continue with next │
 ├────────────┼─────────────────────────────────────────┤
 │ --dry-run  │ Preview without changes                 │
 ├────────────┼─────────────────────────────────────────┤
 │ --no-phpcs │ Skip PHPCS auto-fix                     │
 ├────────────┼─────────────────────────────────────────┤
 │ --push     │ Push to origin                          │
 ├────────────┼─────────────────────────────────────────┤
 │ --phase=X  │ Run only phase A, B, C, or D            │
 └────────────┴─────────────────────────────────────────┘

 ---
 File 3: .alchemize/agent-update.md — Agent Runbook

 This is the key document. When a human passes this to Claude Code, the agent follows it end-to-end. It
 covers both the mechanical sync AND the intelligent review that scripts can't do.

 Structure of agent-update.md:

 # Canvas Upstream Sync — Agent Runbook

 You are updating our local Canvas branches to align with the latest upstream
 dev branch. This is a multi-phase process combining automated scripts with
 your analysis and judgment.

 ## Prerequisites
 - Working directory: the canvas repo root
 - Remotes: `upstream` → drupal.org canvas, `origin` → our GitHub fork
 - Current branch: `local/integration`
 - Config: `.alchemize/sync-branches.conf` lists all branches in merge order

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
 - [ ] Has upstream introduced new **conventions** we should adopt? (naming, coding standards,
 architectural patterns)
 - [ ] Has upstream changed **APIs we depend on**? (renamed classes, changed method signatures, new
 required parameters)
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

 ## Step 3: Mechanical Sync

 Run the sync script:
 ```bash
 ./.alchemize/sync-upstream.sh

 If it pauses for conflicts:
 1. Read the conflict carefully
 2. Understand both sides (our change + upstream change)
 3. Resolve by keeping our logic AND adopting upstream conventions
 4. git add <resolved-files> && git rebase --continue
 5. ./.alchemize/sync-upstream.sh --continue

 If a branch fails and can't be resolved mechanically:
 - ./.alchemize/sync-upstream.sh --skip
 - Handle it manually in Step 4

 Step 4: Intelligent Review & Cleanup

 After all branches are rebased, review each one:

 For EACH branch in .alchemize/sync-branches.conf:
 1. git checkout <branch>
 2. git diff upstream/1.x..HEAD — review our changes in context of new upstream
 3. Check: does our code use any patterns upstream has moved away from?
 4. Check: are there new upstream utilities/services we should use instead of
 our custom implementations?
 5. Check: does our code follow the latest upstream conventions?
   - PHP: backslash-prefixed built-in functions
   - PHP: declare(strict_types=1) if upstream now requires it
   - PHP: #[Group(...)] annotations instead of @group in tests
   - PHP: CanvasKernelTestBase instead of KernelTestBase in tests
   - TS/JS: check import patterns, naming conventions
 6. If changes needed: make them, commit with clear message
 7. If the branch is no longer needed: flag it for removal

 Upstream-readiness checks (CRITICAL):

 Each branch must be submittable to upstream as-is. Verify:
 - Branch is rebased on latest upstream/1.x (no merge commits)
 - Commit messages follow upstream conventions (see recent upstream commits)
 - No integration-only code leaked into feature branches (build artifacts, .gitignore hacks, README
 changes, .alchemize/ files)
 - Code follows ALL current upstream coding standards
 - If the branch has tests, they extend CanvasKernelTestBase (not KernelTestBase)
 - PHP files include declare(strict_types=1) where upstream requires it
 - No references to our internal tooling, GitHub fork, or integration process

 Things to specifically watch for:

 - DynamicPropSource → EntityFieldPropSource: ensure our code uses new name
 - CanvasKernelTestBase: if we have test files, extend this instead of KernelTestBase
 - declare(strict_types=1): upstream requires this in PHP files now
 - SPA navigation changes: test that our per-content editing flow works with
 the discard/refresh logic upstream added
 - Component version auto-upgrade: ensure our merged component tree handles
 the new version reconciliation logic

 Step 5: Rebuild Integration

 After all branches are reviewed and updated:

 ./.alchemize/sync-upstream.sh --phase=C

 This rebuilds local/integration fresh from upstream + all branches.

 If there are integration merge conflicts (between our own branches):
 - These indicate branches that now overlap in ways they didn't before
 - Resolve carefully, understanding both branches' intent
 - Consider if the branches should be restructured

 Step 6: Verify

 1. git log --oneline --first-parent local/integration | head 25
 → Should show: upstream commits + 18 merge commits + build artifacts
 2. git diff upstream/1.x..local/integration --stat | grep -v dist/
 → Should show ONLY our changes
 3. For each branch: git log --oneline upstream/1.x..<branch>
 → Should show only our commits (1-3 per branch)
 4. Quick PHPCS check: grep -rn "([^\\])is_array\b" src/ --include="*.php"
 → Should find zero unescaped calls in files we touched

 Step 7: Report

 Summarize to the user:
 - What upstream commits were incorporated
 - Which branches had conflicts and how they were resolved
 - What conventions/patterns were adopted
 - Any branches dropped, adapted, or created
 - Upstream-readiness status: for each branch, confirm it's clean and
 submittable as an MR to drupal.org. Flag any that aren't and why.
 - Current status of integration branch
 - Recommendation for next steps (push, test, etc.)

 ---

 ## Implementation order

 1. **Create `.alchemize/` directory** (on `local/integration` only)
 2. **`.alchemize/sync-branches.conf`** — simple config file
 3. **`.alchemize/sync-upstream.sh`** — the mechanical script, make executable
 4. **`.alchemize/agent-update.md`** — the agent runbook
 5. **Commit all to `local/integration`** — these files exist ONLY on this branch

 ## Verification

 After all 3 files are created:
 1. `./.alchemize/sync-upstream.sh --dry-run` — verify it reads config and previews correctly
 2. Read through `agent-update.md` and confirm it covers the full workflow
 3. Verify `.alchemize/` does NOT exist on any fix/feat branch
 4. First real run: execute the agent-update process against current upstream/1.x

 =====
 │ Plan: Post-Mortem Improvements to .alchemize/ Tooling                                                   │
│                                                                                                         │
│ Context                                                                                                 │
│                                                                                                         │
│ We just completed the first real upstream sync. Several issues surfaced — one critical bug, two regular │
│  bugs, and several workflow lessons. This plan fixes them all.                                          │
│                                                                                                         │
│ Issues Found (by severity)                                                                              │
│                                                                                                         │
│ 1. CRITICAL — Phase C self-destructs                                                                    │
│                                                                                                         │
│ phase_c() runs git checkout -B local/integration upstream/1.x, which deletes .alchemize/ (it only       │
│ exists on integration). The script immediately crashes: grep: .alchemize/sync-branches.conf: No such    │
│ file or directory.                                                                                      │
│                                                                                                         │
│ Fix: In Phase A, copy the branch list and .alchemize/ to .git/sync-state/. Phase C reads from the state │
│  copy, then restores .alchemize/ after all merges.                                                      │
│                                                                                                         │
│ 2. BUG — Build chain is wrong                                                                           │
│                                                                                                         │
│ Script does cd ui && npm ci && npm run build and separately builds astro-hydration. In practice:        │
│ - Workspace deps like tsdown are hoisted to root — npm ci in subdirs doesn't install them               │
│ - packages/drupal-canvas must build before packages/astro-hydration (it's a dependency)                 │
│ - The ui build already chains vite build → build:astro internally                                       │
│                                                                                                         │
│ Fix: Root npm install first, then packages/drupal-canvas build, then ui build. Remove the separate      │
│ astro-hydration build. Add a fallback note for the known tsc --noEmit type-check issue.                 │
│                                                                                                         │
│ 3. BUG — .gitignore modification is fragile                                                             │
│                                                                                                         │
│ Script appends !/ui/dist but upstream already has /ui/dist. Both lines coexist; works by coincidence    │
│ (last rule wins). Could break.                                                                          │
│                                                                                                         │
│ Fix: Use sed to flip /ui/dist → !/ui/dist in place instead of appending.                                │
│                                                                                                         │
│ 4. WORKFLOW — Agent shouldn't use the script for Phase B                                                │
│                                                                                                         │
│ The script's pause/resume model (exit on conflict → user resolves → --continue) is designed for a human │
│  shell session, not an agent. The agent resolves conflicts inline, so running git rebase directly in a  │
│ loop is faster and simpler — no need to exit/re-enter the script.                                       │
│                                                                                                         │
│ Fix: Rewrite Step 3 in the runbook to tell the agent to:                                                │
│ - Use the script for Phase A (tagging/setup) and Phase D (push)                                         │
│ - Do rebases directly in a loop for Phase B                                                             │
│ - Do merges directly for Phase C (since the script has the self-destruct issue)                         │
│                                                                                                         │
│ 5. WORKFLOW — Phase C can't resume integration merges                                                   │
│                                                                                                         │
│ When an integration merge conflicts, the script exits but doesn't save which branch index was being     │
│ merged. --continue --phase=C would restart from the beginning.                                          │
│                                                                                                         │
│ Fix: Save/load merge index in .git/sync-state/merge_index.                                              │
│                                                                                                         │
│ 6. ENHANCEMENT — Runbook missing build prerequisites and .alchemize/ restore                            │
│                                                                                                         │
│ Agent had to debug npm install order and figure out how to restore .alchemize/ after Phase C reset.     │
│                                                                                                         │
│ Fix: Add explicit instructions for both to the runbook.                                                 │
│                                                                                                         │
│ ---                                                                                                     │
│ Files to Modify                                                                                         │
│                                                                                                         │
│ .alchemize/sync-upstream.sh                                                                             │
│                                                                                                         │
│ Phase A additions:                                                                                      │
│ - Copy branch list to .git/sync-state/branches.txt                                                      │
│ - Back up .alchemize/ to .git/sync-state/alchemize-backup/                                              │
│                                                                                                         │
│ New helper:                                                                                             │
│ - read_branches_from_state() — reads from .git/sync-state/branches.txt, used by Phase C                 │
│                                                                                                         │
│ Phase C fixes:                                                                                          │
│ - Use read_branches_from_state() instead of read_branches() for the merge loop                          │
│ - Save merge index to .git/sync-state/merge_index on conflict; resume from it on --continue             │
│ - Fix .gitignore with sed replacement instead of appending                                              │
│ - Fix build chain: npm install at root → drupal-canvas build → ui build (remove separate                │
│ astro-hydration build)                                                                                  │
│ - Restore .alchemize/ from .git/sync-state/alchemize-backup/ after merges (commit it as part of         │
│ integration)                                                                                            │
│                                                                                                         │
│ .alchemize/agent-update.md                                                                              │
│                                                                                                         │
│ Step 3 — rewrite to recommend agent does rebases directly:                                              │
│ ## Step 3: Rebase Branches                                                                              │
│                                                                                                         │
│ Run Phase A setup:                                                                                      │
│   ./.alchemize/sync-upstream.sh --phase=A                                                               │
│                                                                                                         │
│ Then rebase each branch directly (do NOT use the script for this —                                      │
│ direct control is better for inline conflict resolution):                                               │
│                                                                                                         │
│   UPSTREAM=$(git rev-parse upstream/1.x)                                                                │
│   for branch in $(read branches from config); do                                                        │
│     git checkout $branch                                                                                │
│     git rebase $UPSTREAM                                                                                │
│     # if conflict: resolve inline, git add, git rebase --continue                                       │
│   done                                                                                                  │
│                                                                                                         │
│ Step 5 — add:                                                                                           │
│ - .alchemize/ restore instruction: git checkout <pre-sync-tag> -- .alchemize/                           │
│ - Build prerequisites: root npm install, then drupal-canvas, then ui                                    │
│ - Type-check fallback: if npm run build fails on tsc --noEmit, use npx vite build directly              │
│ - Note that the script can be used for Phase C once the self-destruct fix is in, but manual merge loop  │
│ is equally valid                                                                                        │
│                                                                                                         │
│ Add "Known Issues / Lessons" section at the bottom documenting:                                         │
│ - tsc --noEmit may fail due to hoisted vite-plugin-svgr types (pre-existing, doesn't affect build)      │
│ - Integration merge conflicts are expected between overlapping feature branches                         │
│ (per-content-editing-backend vs entity-layout-tab, expose-slot-dialog-ui vs                             │
│ per-content-editing-frontend)                                                                           │
│                                                                                                         │
│ Verification                                                                                            │
│                                                                                                         │
│ 1. ./.alchemize/sync-upstream.sh --dry-run — still works after changes                                  │
│ 2. ./.alchemize/sync-upstream.sh --help — still works                                                   │
│ 3. Read through updated runbook — matches the actual workflow we followed                               │
│ 4. Verify Phase C reads from state copy (grep for read_branches_from_state in Phase C)                  │
╰─────────────────────────────────────────────────────────────────────────────────────────────────────────╯