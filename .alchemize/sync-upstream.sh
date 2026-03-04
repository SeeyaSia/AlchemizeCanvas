#!/usr/bin/env bash
set -euo pipefail

# Canvas upstream sync script
# Rebases local branches onto upstream/1.x and rebuilds local/integration.
# State is tracked in .git/sync-state for pause/resume on conflicts.
#
# Compatible with macOS bash 3.x (no mapfile, no associative arrays).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
CONF="$SCRIPT_DIR/sync-branches.conf"
STATE_DIR="$REPO_ROOT/.git/sync-state"
UPSTREAM="upstream/1.x"

# --- Helpers ---------------------------------------------------------------

die()  { echo "FATAL: $*" >&2; exit 1; }
info() { echo "==> $*"; }
warn() { echo "WARNING: $*" >&2; }

# Read branches from config (one per line, comments/blanks stripped).
read_branches() {
  grep -v '^\s*#' "$CONF" | grep -v '^\s*$'
}

# Read branches from state copy (survives Phase C checkout that deletes .alchemize/).
read_branches_from_state() {
  local state_branches="$STATE_DIR/branches.txt"
  [[ -f "$state_branches" ]] || die "No branch list in sync state. Run Phase A first."
  cat "$state_branches"
}

# Get the Nth branch (0-indexed) from the config.
get_branch() {
  read_branches | sed -n "$((${1} + 1))p"
}

# Get the Nth branch (0-indexed) from state copy.
get_branch_from_state() {
  read_branches_from_state | sed -n "$((${1} + 1))p"
}

# Count total branches.
count_branches() {
  read_branches | wc -l | tr -d ' '
}

# Count total branches from state copy.
count_branches_from_state() {
  read_branches_from_state | wc -l | tr -d ' '
}

save_state() {
  mkdir -p "$STATE_DIR"
  echo "$1" > "$STATE_DIR/phase"
  echo "$2" > "$STATE_DIR/branch_index"
  echo "$3" > "$STATE_DIR/upstream_ref"
}

load_state() {
  [[ -d "$STATE_DIR" ]] || return 1
  PHASE=$(cat "$STATE_DIR/phase" 2>/dev/null || echo "")
  BRANCH_INDEX=$(cat "$STATE_DIR/branch_index" 2>/dev/null || echo "0")
  UPSTREAM_REF=$(cat "$STATE_DIR/upstream_ref" 2>/dev/null || echo "")
  [[ -n "$PHASE" ]] || return 1
}

clear_state() {
  rm -rf "$STATE_DIR"
}

ensure_clean() {
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
    die "Working tree is not clean. Commit or stash changes first."
  fi
}

# PHPCS: backslash-prefix built-in PHP functions in files changed by branch.
phpcs_autofix() {
  local branch="$1"
  local files
  files=$(git -C "$REPO_ROOT" diff --name-only "$UPSTREAM_REF..HEAD" -- '*.php' || true)
  [[ -n "$files" ]] || return 0

  local pattern="is_array|is_bool|is_callable|is_countable|is_double|is_float|is_int|is_integer|is_long|is_null|is_numeric|is_object|is_real|is_resource|is_scalar|is_string"

  echo "$files" | while IFS= read -r file; do
    local fpath="$REPO_ROOT/$file"
    [[ -f "$fpath" ]] || continue
    if grep -qE "([^\\\\]|^)($pattern)\s*\(" "$fpath"; then
      sed -i '' -E "s/([^\\\\])($pattern)\s*\(/\1\\\\\2(/g" "$fpath"
      sed -i '' -E "s/^($pattern)\s*\(/\\\\\1(/g" "$fpath"
    fi
  done

  # Check if any PHP files were modified (outside the subshell)
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain -- '*.php')" ]]; then
    git -C "$REPO_ROOT" add -A
    git -C "$REPO_ROOT" commit -m "chore: adopt PHPCS backslash prefix convention"
    info "  PHPCS auto-fix committed on $branch"
  fi
}

# --- Phases ----------------------------------------------------------------

phase_a() {
  info "Phase A: Preparation"
  ensure_clean

  info "Fetching upstream..."
  git -C "$REPO_ROOT" fetch upstream

  UPSTREAM_REF=$(git -C "$REPO_ROOT" rev-parse "$UPSTREAM")
  local mergebase_short
  mergebase_short=$(git -C "$REPO_ROOT" rev-parse --short HEAD)

  # Create pre-sync snapshot tags for rollback (all branches + integration)
  local sync_date
  sync_date=$(date +%Y%m%d)
  local tag_prefix="pre-sync/${sync_date}"

  # Tag integration
  local int_tag="${tag_prefix}/integration"
  if ! git -C "$REPO_ROOT" tag -l "$int_tag" | grep -q .; then
    git -C "$REPO_ROOT" tag "$int_tag" HEAD
    info "Tagged: $int_tag -> $(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  else
    info "Tag $int_tag already exists, skipping"
  fi

  # Save pre-rebase refs and tag every branch
  mkdir -p "$STATE_DIR"
  echo "$UPSTREAM_REF" > "$STATE_DIR/upstream_ref"

  local total
  total=$(count_branches)
  local idx=0
  while [[ $idx -lt $total ]]; do
    local branch
    branch=$(get_branch $idx)
    local ref
    ref=$(git -C "$REPO_ROOT" rev-parse "$branch" 2>/dev/null || echo "MISSING")
    echo "$ref" > "$STATE_DIR/pre-rebase-$(echo "$branch" | tr '/' '_')"

    # Tag the branch for rollback
    if [[ "$ref" != "MISSING" ]]; then
      local short_name="${branch#local/}"
      local branch_tag="${tag_prefix}/${short_name}"
      if ! git -C "$REPO_ROOT" tag -l "$branch_tag" | grep -q .; then
        git -C "$REPO_ROOT" tag "$branch_tag" "$ref"
        info "Tagged: $branch_tag -> $(git -C "$REPO_ROOT" rev-parse --short "$ref")"
      fi
    fi

    idx=$((idx + 1))
  done

  info "All pre-sync tags created under $tag_prefix/"

  # Back up branch list and .alchemize/ to sync state.
  # Phase C resets to upstream which deletes .alchemize/; these copies survive.
  read_branches > "$STATE_DIR/branches.txt"
  info "Branch list saved to $STATE_DIR/branches.txt"

  rm -rf "$STATE_DIR/alchemize-backup"
  cp -R "$SCRIPT_DIR" "$STATE_DIR/alchemize-backup"
  info ".alchemize/ backed up to $STATE_DIR/alchemize-backup/"

  info "Upstream target: $UPSTREAM_REF"
  info "Phase A complete."
}

phase_b() {
  info "Phase B: Rebase branches"

  UPSTREAM_REF=$(cat "$STATE_DIR/upstream_ref" 2>/dev/null || die "No upstream_ref in state. Run phase A first.")
  local total
  total=$(count_branches)
  local i=${BRANCH_INDEX:-0}

  while [[ $i -lt $total ]]; do
    local branch
    branch=$(get_branch $i)
    info "[$((i+1))/$total] Rebasing $branch"

    if ! git -C "$REPO_ROOT" rev-parse --verify "$branch" &>/dev/null; then
      warn "Branch $branch does not exist, skipping."
      i=$((i + 1))
      continue
    fi

    git -C "$REPO_ROOT" checkout "$branch"

    if ! git -C "$REPO_ROOT" rebase "$UPSTREAM_REF"; then
      save_state "B" "$i" "$UPSTREAM_REF"
      echo ""
      echo "========================================="
      echo "CONFLICT rebasing: $branch"
      echo "========================================="
      echo ""
      echo "Resolve conflicts, then run:"
      echo "  git add <resolved-files>"
      echo "  git rebase --continue"
      echo "  $0 --continue"
      echo ""
      echo "Or skip this branch:  $0 --skip"
      echo "Or abort everything:  $0 --abort"
      exit 1
    fi

    if [[ "$NO_PHPCS" != "1" ]]; then
      phpcs_autofix "$branch"
    fi

    info "  $branch rebased successfully."
    i=$((i + 1))
  done

  info "Phase B complete. All branches rebased."
}

phase_c() {
  info "Phase C: Rebuild integration"

  UPSTREAM_REF=$(cat "$STATE_DIR/upstream_ref" 2>/dev/null || true)
  [[ -n "$UPSTREAM_REF" ]] || UPSTREAM_REF=$(git -C "$REPO_ROOT" rev-parse "$UPSTREAM")

  # Read branch list from state copy (survives the checkout below).
  local total
  total=$(count_branches_from_state)

  # Resume from saved merge index if continuing after a conflict.
  local start_idx=0
  if [[ "$CONTINUE" -eq 1 && -f "$STATE_DIR/merge_index" ]]; then
    start_idx=$(cat "$STATE_DIR/merge_index")
    info "Resuming merges from index $start_idx"
  else
    git -C "$REPO_ROOT" checkout -B local/integration "$UPSTREAM_REF"
    info "Reset local/integration to $UPSTREAM"
  fi

  local idx=$start_idx
  while [[ $idx -lt $total ]]; do
    local branch
    branch=$(get_branch_from_state $idx)

    if ! git -C "$REPO_ROOT" rev-parse --verify "$branch" &>/dev/null; then
      warn "Branch $branch does not exist, skipping merge."
      idx=$((idx + 1))
      continue
    fi

    local short_name="${branch#local/}"
    info "Merging $short_name"
    if ! git -C "$REPO_ROOT" merge --no-ff "$branch" -m "Merge $short_name"; then
      # Save merge index so --continue resumes from here.
      echo "$idx" > "$STATE_DIR/merge_index"
      save_state "C" "0" "$UPSTREAM_REF"
      echo ""
      echo "========================================="
      echo "CONFLICT merging $branch into integration"
      echo "========================================="
      echo ""
      echo "Resolve the conflict, then:"
      echo "  git add <resolved-files>"
      echo "  git commit"
      echo "  $0 --continue --phase=C"
      exit 1
    fi

    idx=$((idx + 1))
  done

  # Clean up merge index after all merges succeed.
  rm -f "$STATE_DIR/merge_index"

  # Restore .alchemize/ from backup (the checkout -B above deletes it).
  if [[ -d "$STATE_DIR/alchemize-backup" ]]; then
    info "Restoring .alchemize/ from backup..."
    cp -R "$STATE_DIR/alchemize-backup" "$REPO_ROOT/.alchemize"
    git -C "$REPO_ROOT" add .alchemize/
    git -C "$REPO_ROOT" commit -m "Restore .alchemize/ tooling on integration branch"
    info ".alchemize/ restored and committed."
  fi

  # Integration-only changes: un-ignore build dirs, build, commit
  info "Applying integration-only changes..."

  # Flip /ui/dist → !/ui/dist in place (instead of appending a duplicate rule).
  if grep -q '^/ui/dist$' "$REPO_ROOT/.gitignore"; then
    sed -i '' 's|^/ui/dist$|!/ui/dist|' "$REPO_ROOT/.gitignore"
  elif ! grep -q '!/ui/dist' "$REPO_ROOT/.gitignore"; then
    echo '!/ui/dist' >> "$REPO_ROOT/.gitignore"
  fi

  # Flip /packages/astro-hydration/dist → !/packages/astro-hydration/dist
  if grep -q '^/packages/astro-hydration/dist$' "$REPO_ROOT/.gitignore"; then
    sed -i '' 's|^/packages/astro-hydration/dist$|!/packages/astro-hydration/dist|' "$REPO_ROOT/.gitignore"
  elif ! grep -q '!/packages/astro-hydration/dist' "$REPO_ROOT/.gitignore"; then
    echo '!/packages/astro-hydration/dist' >> "$REPO_ROOT/.gitignore"
  fi

  # Build chain: root install → drupal-canvas → ui (which chains astro internally).
  # Workspace deps like tsdown are hoisted to root; subdir npm ci won't find them.
  info "Installing dependencies at workspace root..."
  (cd "$REPO_ROOT" && npm install)

  if [[ -f "$REPO_ROOT/packages/drupal-canvas/package.json" ]]; then
    info "Building packages/drupal-canvas..."
    (cd "$REPO_ROOT/packages/drupal-canvas" && npm run build)
  fi

  if [[ -f "$REPO_ROOT/ui/package.json" ]]; then
    info "Building UI (includes astro-hydration via workspace chain)..."
    # If `npm run build` fails on tsc --noEmit (hoisted vite-plugin-svgr types),
    # fall back to `npx vite build` directly.
    (cd "$REPO_ROOT/ui" && npm run build) || {
      warn "npm run build failed (likely tsc --noEmit). Falling back to npx vite build..."
      (cd "$REPO_ROOT/ui" && npx vite build)
    }
  fi

  # Commit build artifacts
  git -C "$REPO_ROOT" add -A
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
    git -C "$REPO_ROOT" commit -m "Include build artifacts in integration branch"
    info "Build artifacts committed."
  else
    info "No build artifact changes to commit."
  fi

  info "Phase C complete."
}

phase_d() {
  info "Phase D: Push"

  local total
  total=$(count_branches)
  local idx=0
  while [[ $idx -lt $total ]]; do
    local branch
    branch=$(get_branch $idx)
    if git -C "$REPO_ROOT" rev-parse --verify "$branch" &>/dev/null; then
      info "Pushing $branch"
      git -C "$REPO_ROOT" push --force-with-lease origin "$branch"
    fi
    idx=$((idx + 1))
  done

  info "Pushing local/integration"
  git -C "$REPO_ROOT" push --force-with-lease origin local/integration

  info "Pushing tags"
  git -C "$REPO_ROOT" push origin --tags

  info "Phase D complete."
}

# --- Dry run ---------------------------------------------------------------

dry_run() {
  info "DRY RUN — previewing sync operations"
  echo ""

  local total
  total=$(count_branches)

  echo "Config: $CONF"
  echo "Upstream: $UPSTREAM"
  echo "Branches: $total"
  echo ""

  local upstream_ref
  upstream_ref=$(git -C "$REPO_ROOT" rev-parse "$UPSTREAM" 2>/dev/null || echo "UNKNOWN")
  echo "Upstream ref: $upstream_ref"
  echo ""

  echo "Phase A: Fetch upstream, tag integration, save pre-rebase refs"
  echo ""

  echo "Phase B: Rebase each branch onto $UPSTREAM"
  local i=0
  while [[ $i -lt $total ]]; do
    local branch
    branch=$(get_branch $i)
    local exists="yes"
    git -C "$REPO_ROOT" rev-parse --verify "$branch" &>/dev/null || exists="MISSING"
    local commits
    if [[ "$exists" == "yes" ]]; then
      commits=$(git -C "$REPO_ROOT" log --oneline "$UPSTREAM..$branch" 2>/dev/null | wc -l | tr -d ' ')
    else
      commits="?"
    fi
    printf "  [%2d/%d] %-50s %s commits  (%s)\n" "$((i+1))" "$total" "$branch" "$commits" "$exists"
    i=$((i + 1))
  done
  echo ""

  echo "Phase C: Rebuild local/integration from $UPSTREAM + all branches"
  echo "  -> merge each branch with --no-ff"
  echo "  -> restore .alchemize/ from backup"
  echo "  -> npm install at root, build drupal-canvas, build UI"
  echo "  -> commit build artifacts"
  echo ""

  echo "Phase D: Push (only with --push flag)"
  echo "  -> force-with-lease push all rebased branches"
  echo "  -> push integration and tags"
  echo ""

  info "Dry run complete. No changes were made."
}

# --- Abort -----------------------------------------------------------------

abort_sync() {
  info "Aborting sync — restoring pre-rebase refs"

  # Abort any in-progress rebase
  git -C "$REPO_ROOT" rebase --abort 2>/dev/null || true

  if [[ ! -d "$STATE_DIR" ]]; then
    die "No sync state found. Nothing to abort."
  fi

  local total
  total=$(count_branches)
  local idx=0
  while [[ $idx -lt $total ]]; do
    local branch
    branch=$(get_branch $idx)
    local key
    key=$(echo "$branch" | tr '/' '_')
    local saved_ref
    saved_ref=$(cat "$STATE_DIR/pre-rebase-$key" 2>/dev/null || echo "")
    if [[ -n "$saved_ref" && "$saved_ref" != "MISSING" ]]; then
      info "Restoring $branch to $saved_ref"
      git -C "$REPO_ROOT" checkout "$branch" 2>/dev/null || true
      git -C "$REPO_ROOT" reset --hard "$saved_ref"
    fi
    idx=$((idx + 1))
  done

  git -C "$REPO_ROOT" checkout local/integration 2>/dev/null || true
  clear_state
  info "Abort complete. Branches restored to pre-sync state."
}

# --- Main ------------------------------------------------------------------

CONTINUE=0
ABORT=0
SKIP=0
DRY_RUN=0
NO_PHPCS=0
PUSH=0
PHASE=""
BRANCH_INDEX=0

for arg in "$@"; do
  case "$arg" in
    --continue)  CONTINUE=1 ;;
    --abort)     ABORT=1 ;;
    --skip)      SKIP=1 ;;
    --dry-run)   DRY_RUN=1 ;;
    --no-phpcs)  NO_PHPCS=1 ;;
    --push)      PUSH=1 ;;
    --phase=*)   PHASE="${arg#--phase=}" ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --continue    Resume after conflict resolution"
      echo "  --abort       Restore branches to pre-rebase state"
      echo "  --skip        Skip current branch, continue with next"
      echo "  --dry-run     Preview without changes"
      echo "  --no-phpcs    Skip PHPCS auto-fix"
      echo "  --push        Push to origin (Phase D)"
      echo "  --phase=X     Run only phase A, B, C, or D"
      echo "  -h, --help    Show this help"
      exit 0
      ;;
    *) die "Unknown option: $arg" ;;
  esac
done

cd "$REPO_ROOT"

# --- Dispatch --------------------------------------------------------------

if [[ "$DRY_RUN" -eq 1 ]]; then
  dry_run
  exit 0
fi

if [[ "$ABORT" -eq 1 ]]; then
  abort_sync
  exit 0
fi

if [[ "$SKIP" -eq 1 ]]; then
  if ! load_state; then
    die "No sync state found. Nothing to skip."
  fi
  git -C "$REPO_ROOT" rebase --abort 2>/dev/null || true
  BRANCH_INDEX=$((BRANCH_INDEX + 1))
  save_state "$PHASE" "$BRANCH_INDEX" "$UPSTREAM_REF"
  info "Skipped branch at index $((BRANCH_INDEX - 1)), resuming from $BRANCH_INDEX"
  CONTINUE=1
fi

if [[ "$CONTINUE" -eq 1 ]]; then
  if ! load_state; then
    die "No sync state found. Run without --continue first."
  fi
  info "Resuming from phase $PHASE, branch index $BRANCH_INDEX"

  case "$PHASE" in
    B)
      UPSTREAM_REF="$UPSTREAM_REF" BRANCH_INDEX="$BRANCH_INDEX" NO_PHPCS="$NO_PHPCS" phase_b
      phase_c
      ;;
    C) phase_c ;;
    *) die "Cannot resume from phase $PHASE" ;;
  esac

  if [[ "$PUSH" -eq 1 ]]; then
    phase_d
  fi

  clear_state
  info "Sync complete."
  exit 0
fi

# Run specific phase or full pipeline
if [[ -n "$PHASE" ]]; then
  case "$PHASE" in
    A) phase_a ;;
    B) phase_a; NO_PHPCS="$NO_PHPCS" phase_b ;;
    C) phase_c ;;
    D) [[ "$PUSH" -eq 1 ]] || die "Phase D requires --push flag"; phase_d ;;
    *) die "Unknown phase: $PHASE (must be A, B, C, or D)" ;;
  esac
else
  phase_a
  NO_PHPCS="$NO_PHPCS" phase_b
  phase_c

  if [[ "$PUSH" -eq 1 ]]; then
    phase_d
  else
    info "Skipping push (use --push to push to origin)."
  fi
fi

clear_state
git -C "$REPO_ROOT" checkout local/integration
info "Sync complete."
