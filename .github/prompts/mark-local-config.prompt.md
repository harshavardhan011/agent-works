---
description: Wrap every changed hunk (except JSON and untracked files) in LOCAL_CONFIG markers so the cleaner can revert the entire local diff.
mode: agent
tools: ['runCommands', 'edit']
---

Scope (leave blank for all changed files): ${input:path:(all changed files)}

Inspect my current working-tree changes and wrap **every changed hunk** in every
modified tracked file in `LOCAL_CONFIG_START / LOCAL_CONFIG_END` markers, using
the correct comment syntax for each file type.

All current changes are considered local and should not be committed. Do not judge
whether an edit is machine-specific or feature code — wrap everything changed.

**Step 1 — Inspect changes:**

Run:
```
git status --porcelain
git diff
git diff --staged
```

If there are registered submodules, also run for each:
```
git -C <submodule-path> status --porcelain
git -C <submodule-path> diff
```

If a `${input:path}` scope was provided, limit your diff to that path.

Separate results into:
- Modified tracked files — wrap ALL hunks (every changed line/block).
- Untracked files — **do not tag**; list them as "the cleaner will delete these wholesale."
- JSON files — **cannot be tagged** (no comment syntax); report them and suggest a `.env` or untracked override file instead.
- Pure deletions — lines removed locally with no replacement; **cannot be wrapped**; note that these need a manual `git restore <file>` before the cleaner can revert them.

**Step 2 — Collect every changed hunk:**

For each tracked modified file (excluding JSON), collect **all hunks** from the diff:
- Added lines → wrap them.
- Modified lines (inline sub-line edits) → wrap the **entire changed line** (the cleaner reverts the full line to its HEAD version).
- Pure deletions → cannot be wrapped; include in the skip report.

Group adjacent hunks into a single marker block when they are close together; use
separate marker pairs for hunks that are far apart.

**Step 3 — Propose and confirm:**

Present a concise summary:
- Which files and hunk/line ranges will be wrapped.
- Untracked files (listed, not tagged).
- JSON files (reported, not tagged).
- Pure deletions (reported, not wrapped).

Then ask: "Should I insert LOCAL_CONFIG markers around all these changes?" and **stop**.
Do not edit any file until I say yes.

**Step 4 — Insert markers on confirmation:**

Use the correct comment token for each file type:
- `//` → JS/TS/Go/Java/C/C++/Rust/Swift/Kotlin
- `#` → Python/YAML/shell/Ruby/TOML/.env
- `<!-- -->` → HTML/XML/Vue/Svelte/Markdown
- `/* */` → CSS/SCSS/Less
- `--` → SQL
- `;` → INI/CFG

Insert `<token> LOCAL_CONFIG_START` immediately before and `<token> LOCAL_CONFIG_END`
immediately after each hunk. Match surrounding indentation. Touch only those lines.

**Idempotency:** read the file first. If a region is already wrapped in markers,
skip it — never double-wrap. Verify every `LOCAL_CONFIG_START` is matched by a
`LOCAL_CONFIG_END`; unmatched markers cause the cleaner to skip that file entirely.

**Step 5 — Report and remind:**

After inserting, confirm what was tagged and what was skipped. Then remind me:
```
Next steps:
1. git stash -u  (in the parent repo)
2. git stash -u  inside each submodule that has local edits
3. Run the Clean Local Config agent (or: node clean-local-config.js) to revert markers and delete untracked files.
4. git stash pop  in each repo when ready to restore your feature work.
```

**Constraints:**
- Never alter actual code lines — only insert marker comment lines.
- Never stash, revert, or delete anything.
- Never tag JSON files.
- Always confirm before editing.
- Keep every START balanced with an END.
