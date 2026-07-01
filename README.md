# agent-works

Developer tooling for managing local configuration overrides in a shared codebase.

---

## `clean-local-config.js`

Reverts machine-specific local edits in tracked files and deletes local-only
untracked files — using a git stash purely as a **read-only** reference. It
never modifies the stash.

### The marker convention

Wrap any local-only edit in marker comments:

```js
// LOCAL_CONFIG_START
const API_URL = 'http://localhost:3001';   // local dev override
const LOG_LEVEL = 'verbose';
// LOCAL_CONFIG_END
```

Works in any file type — the markers are matched as plain substrings, so
`# LOCAL_CONFIG_START` (Python/YAML), `<!-- LOCAL_CONFIG_START -->` (HTML), etc.
are all recognised.

### Recommended workflow

```bash
# 1. Make your local changes, wrapping local-only bits in markers as above.
#    Do this in the parent repo AND in each submodule where you have local edits.

# 2. Stash everything in the parent repo (the -u captures untracked files too).
git stash -u
# Then stash in each submodule separately — a parent stash does NOT capture
# changes inside submodules.
cd path/to/submodule && git stash -u && cd -

# 3. Dry run from the parent repo root — reviews what will be reverted or deleted
#    across the parent AND all registered submodules.
node clean-local-config.js

# 4. Apply the changes.
node clean-local-config.js --apply

# 5. Restore your feature edits in each repo (the pop is clean: marked bits are
#    already gone). Run git stash pop in the parent and in each submodule.
git stash pop
cd path/to/submodule && git stash pop && cd -
```

### Submodules

Each git submodule is an **independent repository** with its own stash list.
The cleaner automatically discovers all registered submodules (via
`git submodule foreach --recursive`) and processes each one against its own
`stash@{0}`. A submodule with no stash is skipped quietly and noted in the
output. You must stash — and later pop — each submodule yourself.

### CLI reference

```
node clean-local-config.js [<stash-ref>] [--apply]
```

| Argument | Default | Description |
|---|---|---|
| `<stash-ref>` | `stash@{0}` | Stash to read scope from — e.g. `stash@{2}` |
| `--apply` | _(omit)_ | Write changes to disk. Without this flag, dry run only. |

**npm aliases** (equivalent shortcuts):

```bash
npm run clean:config             # dry run against stash@{0}
npm run clean:config:apply       # apply against stash@{0}
# For a specific stash ref, use the node command directly:
node clean-local-config.js stash@{2} --apply
```

### What it does

- **Tracked files** — diffs `HEAD` vs the working-tree file. Only hunks whose
  current-side lines fall inside a `LOCAL_CONFIG_START/END` block are reverted to
  HEAD. All other hunks (feature code, unrelated edits) are left untouched. The
  marker comment lines themselves are removed along with the local content.
- **Untracked files** — deletes them entirely (only files listed in the stash).
- **Unmatched markers** — if a file has mismatched `START`/`END` markers the
  whole file is skipped and the error is reported. Nothing is written.
- **Stash safety** — only `git stash show` and `git stash list` are ever called.
  No pop, apply, drop, or clear.

---

## VS Code Copilot integration

### Custom agent

Select **Clean Local Config** from the Copilot Chat agent picker (the `@` or
mode selector). The agent will:
1. Run a dry run first and summarise what would change.
2. Ask for your confirmation before passing `--apply`.
3. Never run `git stash pop` — that remains your manual final step.

> **File:** `.github/agents/clean-local-config.agent.md`

### Prompt (slash command)

Type `/clean-local-config` in Copilot Chat. VS Code will prompt you for a stash
reference (default `stash@{0}`), run the dry run, and ask before applying.

> **File:** `.github/prompts/clean-local-config.prompt.md`

Both wrappers enforce the same guardrails as the script: read-only stash, dry-run
first, apply only on confirmation.
