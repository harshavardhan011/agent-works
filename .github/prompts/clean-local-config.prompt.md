---
description: Dry-run (then optionally apply) the local-config cleaner against a stash.
mode: agent
tools: ['runCommands']
---

Stash reference to clean against: ${input:stashRef:stash@{0}}

Run the local-config cleaner in two stages:

**Stage 1 — dry run (always):**
```
node clean-local-config.js ${input:stashRef}
```
Show me the complete terminal output, then summarise:
- Which tracked files have LOCAL_CONFIG-marked hunks that would be reverted (list the block line ranges).
- Which untracked files would be deleted.
- Which files were skipped and why (unmatched markers, not on disk, etc.).

**Stage 2 — wait for my confirmation.**
Do not pass `--apply` yet. Ask me: "Apply these changes?" and wait for a yes/no.

If I say yes, run:
```
node clean-local-config.js ${input:stashRef} --apply
```
Show the output, then remind me to run `git stash pop` when I'm ready to restore
my feature edits.

**Constraints:**
- Never run `git stash pop`, `apply`, `drop`, or `clear` — that is always my manual step.
- Never hand-edit files to work around a skip; surface the skip error instead.
- Stop and report if the script exits with a non-zero code.
