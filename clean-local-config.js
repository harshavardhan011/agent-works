#!/usr/bin/env node
/**
 * clean-local-config.js
 *
 * Reverts marked "local-only" edits inside tracked files, and deletes
 * local-only untracked files - using a git stash purely as a READ-ONLY
 * reference for "what changed locally".
 *
 * GUARDRAILS
 *  - NEVER runs any git command that can modify a stash (no drop/pop/
 *    apply/clear). Only `git stash show` / `git stash list` are used.
 *  - Only touches files that are actually listed in the given stash.
 *  - For tracked files, only reverts diff hunks that fall INSIDE a
 *        // LOCAL_CONFIG_START ... // LOCAL_CONFIG_END
 *    block. Every other hunk (your real feature code, even in the
 *    same file) is left completely untouched.
 *  - If a file has an unmatched START or END marker, that file is
 *    SKIPPED entirely and reported - no changes are made to it.
 *  - Defaults to a dry run. You must pass --apply to actually write
 *    anything to disk or delete anything.
 *
 * USAGE (run from the repo root)
 *   node clean-local-config.js                  dry run vs stash@{0}
 *   node clean-local-config.js stash@{2}         dry run vs a specific stash
 *   node clean-local-config.js --apply           actually revert/delete
 *   node clean-local-config.js stash@{1} --apply
 *
 * MARKERS - put these around local-only edits in your files:
 *   // LOCAL_CONFIG_START
 *   ...local-only lines (ports, local URLs, feature-flag overrides)...
 *   // LOCAL_CONFIG_END
 *
 * WORKFLOW
 *   1. Make your local changes as usual, wrapping local-only bits in
 *      the markers above.
 *   2. git stash -u            (the -u is required to also capture
 *                                untracked local-only files)
 *   3. node clean-local-config.js          (review the dry run)
 *   4. node clean-local-config.js --apply
 *   5. git stash pop           (restore your working copy; only the
 *                                marked/local bits will already be
 *                                gone from tracked files, and the
 *                                untracked files will already be
 *                                deleted, so the pop just restores
 *                                your real feature edits cleanly)
 */

const { execSync } = require('child_process');
const fs = require('fs');

const START_MARKER = /LOCAL_CONFIG_START/;
const END_MARKER   = /LOCAL_CONFIG_END/;

const args     = process.argv.slice(2);
const APPLY    = args.includes('--apply');
const stashRef = args.find(a => a.startsWith('stash@')) || 'stash@{0}';

// ---- GUARDRAIL -------------------------------------------------------
// Every git call in this file goes through sh() below, and every call
// site only ever uses read-only operations:
//   git stash list / git stash show   (read-only inspection)
//   git show HEAD:<file>              (read-only)
//   git status --porcelain            (read-only)
// There is no code path anywhere in this script that can drop, pop,
// apply, or clear a stash.
// -----------------------------------------------------------------------
function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
}

function getStashFiles(ref) {
  let out;
  try {
    // --include-untracked so untracked local-only files are listed too
    // (requires the stash to have been created with `git stash -u`)
    out = sh(`git stash show --include-untracked --name-status ${ref}`);
  } catch (e) {
    console.error(`Could not read ${ref}. Does it exist?`);
    try { console.error(sh('git stash list')); } catch (e2) {}
    process.exit(1);
  }
  return out
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const [status, ...rest] = l.split('\t');
      return { status, file: rest.join('\t') };
    });
}

function isUntracked(file) {
  const out = sh(`git status --porcelain -- "${file}"`);
  return out.startsWith('??');
}

function getHeadContent(file) {
  try {
    return sh(`git show HEAD:"${file}"`);
  } catch (e) {
    return null; // no HEAD version - e.g. a brand new tracked file
  }
}

// ---- EOL / trailing-newline helpers ------------------------------------

/**
 * Detect the dominant line ending in raw content.
 * Returns '\r\n' if CRLF is found anywhere, else '\n'.
 */
function detectEol(raw) {
  return raw.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Split raw file content into lines, stripping any trailing empty element
 * caused by a terminal newline so the diff is clean. Also strips stray \r
 * from each line so CRLF files don't cause false mismatches in the LCS.
 * Returns { lines, eol, trailingNewline }.
 */
function splitLines(raw) {
  const eol             = detectEol(raw);
  const trailingNewline = raw.endsWith('\n');
  const lines           = raw
    .split(/\r?\n/)
    .map(l => l.replace(/\r$/, '')); // normalise – diff sees clean lines
  if (trailingNewline && lines[lines.length - 1] === '') lines.pop();
  return { lines, eol, trailingNewline };
}

/**
 * Rejoin clean lines using the original EOL and restore the trailing
 * newline if the source had one.
 */
function joinLines(lines, eol, trailingNewline) {
  return lines.join(eol) + (trailingNewline ? eol : '');
}

// ---- minimal dependency-free line diff (LCS-based) --------------------

function diffLines(oldLines, newLines) {
  const n = oldLines.length, m = newLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) { ops.push({ op: 'same', oldIdx: i, newIdx: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ op: 'del', oldIdx: i }); i++; }
    else { ops.push({ op: 'add', newIdx: j }); j++; }
  }
  while (i < n) { ops.push({ op: 'del', oldIdx: i }); i++; }
  while (j < m) { ops.push({ op: 'add', newIdx: j }); j++; }
  return ops;
}

// group the op stream into hunks, each anchored to a position in the
// CURRENT (new) file so it can be checked against marker ranges
function toHunks(ops, oldLines) {
  const hunks = [];
  let k = 0;
  let lastSameNewIdx = -1;
  while (k < ops.length) {
    if (ops[k].op === 'same') { lastSameNewIdx = ops[k].newIdx; k++; continue; }
    const start = k;
    while (k < ops.length && ops[k].op !== 'same') k++;
    const chunk   = ops.slice(start, k);
    const oldIdxs = chunk.filter(o => o.op === 'del').map(o => o.oldIdx);
    const newIdxs = chunk.filter(o => o.op === 'add').map(o => o.newIdx);
    const anchor  = newIdxs.length ? newIdxs[0] : lastSameNewIdx + 1;
    hunks.push({
      newStart:    newIdxs.length ? newIdxs[0] : anchor,
      newEnd:      newIdxs.length ? newIdxs[newIdxs.length - 1] : anchor,
      oldLines:    oldIdxs.map(idx => oldLines[idx]),
      pureDelete:  newIdxs.length === 0,
    });
  }
  return hunks;
}

function findMarkerRanges(lines) {
  const ranges = [];
  let openAt   = null;
  for (let idx = 0; idx < lines.length; idx++) {
    if (START_MARKER.test(lines[idx])) {
      if (openAt !== null) {
        throw new Error(
          `duplicate/nested LOCAL_CONFIG_START at line ${idx + 1} (already open from line ${openAt + 1})`
        );
      }
      openAt = idx;
    } else if (END_MARKER.test(lines[idx])) {
      if (openAt === null) {
        throw new Error(`LOCAL_CONFIG_END at line ${idx + 1} has no matching START`);
      }
      ranges.push([openAt, idx]);
      openAt = null;
    }
  }
  if (openAt !== null) {
    throw new Error(`LOCAL_CONFIG_START at line ${openAt + 1} has no matching END`);
  }
  return ranges;
}

const overlaps = (aS, aE, bS, bE) => aS <= bE && bS <= aE;

function processTrackedFile(file) {
  const headContent = getHeadContent(file);
  if (headContent === null) {
    console.log(`  [skip] ${file}: no HEAD version (new tracked file) - handle manually.`);
    return;
  }

  const rawCurrent    = fs.readFileSync(file, 'utf8');
  const { lines: oldLines }                                   = splitLines(headContent);
  const { lines: newLines, eol, trailingNewline }             = splitLines(rawCurrent);

  let markerRanges;
  try {
    markerRanges = findMarkerRanges(newLines);
  } catch (e) {
    console.log(`  [skip] ${file}: ${e.message} - no changes made.`);
    return;
  }

  if (markerRanges.length === 0) {
    console.log(`  [skip] ${file}: modified, but no LOCAL_CONFIG markers found - leaving as-is.`);
    return;
  }

  const ops   = diffLines(oldLines, newLines);
  const hunks = toHunks(ops, oldLines);

  const revertHunks = [];
  const keepHunks   = [];
  for (const h of hunks) {
    const inMarker = markerRanges.some(([s, e]) => overlaps(h.newStart, h.newEnd, s, e));
    (inMarker ? revertHunks : keepHunks).push(h);
  }

  if (revertHunks.length === 0) {
    console.log(`  [skip] ${file}: markers present but no diff hunks fall inside them - leaving as-is.`);
    return;
  }

  const blockRanges = markerRanges
    .map(([s, e]) => `lines ${s + 1}-${e + 1}`)
    .join(', ');
  console.log(
    `  [revert] ${file}: reverting ${revertHunks.length} local-config hunk(s)` +
    ` (${blockRanges}), preserving ${keepHunks.length} feature hunk(s)`
  );
  if (!APPLY) return;

  const markerLineIdxs = new Set();
  markerRanges.forEach(([s, e]) => { markerLineIdxs.add(s); markerLineIdxs.add(e); });

  const toDrop   = new Set();    // current-file line indices to drop
  const insertAt = new Map();    // newStart -> lines to insert from HEAD
  for (const h of revertHunks) {
    if (!h.pureDelete) {
      for (let idx = h.newStart; idx <= h.newEnd; idx++) toDrop.add(idx);
    }
    if (h.oldLines.length) insertAt.set(h.newStart, h.oldLines);
  }

  const rebuilt = [];
  for (let idx = 0; idx < newLines.length; idx++) {
    if (insertAt.has(idx)) rebuilt.push(...insertAt.get(idx));
    if (toDrop.has(idx) || markerLineIdxs.has(idx)) continue;
    rebuilt.push(newLines[idx]);
  }

  // Restore original line endings and trailing-newline behaviour
  fs.writeFileSync(file, joinLines(rebuilt, eol, trailingNewline), 'utf8');
}

function processUntrackedFile(file) {
  if (!isUntracked(file)) {
    console.log(`  [skip] ${file}: listed as new-in-stash but not currently untracked on disk - leaving as-is.`);
    return;
  }
  console.log(`  [delete] ${file}: untracked local-only file`);
  if (APPLY) fs.unlinkSync(file);
}

function main() {
  console.log(`Reading ${stashRef} (read-only - this script never modifies stashes)`);
  const entries = getStashFiles(stashRef);

  if (entries.length === 0) {
    console.log('No files found in that stash.');
    return;
  }

  console.log(APPLY ? '\nApplying changes:\n' : '\nDRY RUN - pass --apply to actually make changes:\n');

  for (const { status, file } of entries) {
    if (!fs.existsSync(file)) {
      console.log(`  [skip] ${file}: not present on disk right now.`);
      continue;
    }
    if (status === 'A' || isUntracked(file)) {
      processUntrackedFile(file);
    } else {
      processTrackedFile(file);
    }
  }

  if (!APPLY) console.log('\nDry run complete. Re-run with --apply to make these changes.');
}

main();
