# Update log

This directory records **upstream sync** runs: merging latest Canvas dev into our fork and re-applying our branches/patches using the process in [agent-update.md](../agent-update.md).

## Convention

- **One file per sync:** `YYYY-MM-DD.md` (date of the pre-sync snapshot, e.g. `pre-sync/20260302/*`).
- **Contents:** What we did (steps), which upstream commits were incorporated, branch list/order, restore-point tags, and any notable conflicts or decisions. Document only; no code edits in these files.

## Restore from a pre-sync tag

If a sync goes wrong, restore all branches from the tags created before that sync (see the “Snapshot” section in the corresponding log file).
