---
description: Detect local-only edits in your working changes and wrap them in LOCAL_CONFIG markers (after confirmation).
agent: agent
tools: ['execute', 'edit']
---

Scope (leave blank for all changed files): ${input:path:(all changed files)}

Inspect my current working-tree changes and wrap any local-only edits in
`LOCAL_CONFIG_START / LOCAL_CONFIG_END` markers, using the correct comment syntax
for each file type.

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
- Modified tracked files — candidates for marker insertion.
- Untracked files — **do not tag**; list them as "the cleaner will delete these wholesale."
- JSON files — **cannot be tagged** (no comment syntax); report them and suggest `.env` or an untracked override file instead.

**Step 2 — Identify local-only hunks:**

Flag edits that look machine-specific and should not be committed:
`localhost`/`127.0.0.1`, dev ports, dev/staging URLs, API keys/tokens, personal
absolute paths, debug/verbose flags, disabled-auth or mock toggles, feature-flag
overrides. Leave all feature code, bug fixes, refactors, and test changes alone.
When unsure, **ask** — don't tag.

**Step 3 — Propose and wait for confirmation:**

Present a clear summary:
- Which file and line range looks local-only, and why.
- Untracked files (listed, not tagged).
- JSON files (reported, not tagged).

Then ask: "Should I insert LOCAL_CONFIG markers around these edits?" and **stop**.
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
immediately after each confirmed region. Match surrounding indentation. Touch only
those lines.

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
