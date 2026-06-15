# Specification: Capture Commit SHA in Dep-Graph Snapshot Metadata

## Summary

The dep-graph builder (`src/dep/builder.py`, Spec 1) writes
`<snapshot>/_depgraph.meta.json` with build metadata but **omits the source
repo's commit SHA**. The upstream V2 runner writes `_meta.yaml` with the
literal placeholder `commit: head`, not a real SHA. This breaks any
downstream tool that needs to know "what commit was this snapshot built
from" — including the refactoring spec's `check_staleness`, which is forced
to fall back to mtime comparison instead of the precise SHA equality test
it was designed for.

This spec is a small, surgical fix: capture the commit SHA at snapshot
build time and propagate it through both meta files.

## Core Principle

> **A snapshot is identified by `(repo_remote, commit_sha)`, not by a
> directory name.** The pipeline must record both at build time;
> downstream tools should never have to guess.

## Surfaced from

`haikai/specs/2026-04-27-refactoring-impact/` Phase 9 done-criteria
verification on Kibana — `check_staleness` returned `level=unknown` because
no commit SHA was discoverable. Required adding an mtime fallback in
`src/refactoring/staleness.py` that's strictly less precise than a real
SHA check.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  AST snapshot pipeline (V2 50-repo runner, etc.)            │
│                                                             │
│  Today writes _meta.yaml with `commit: head`  ← bug         │
│  Should write _meta.yaml with `commit: <full-SHA>`          │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  src/dep/builder.py::_write_meta_json (Spec 1)              │
│                                                             │
│  Today: { snapshot, db, build_seconds, row_counts }         │
│  Should: { ..., commit_sha, repo_remote }                   │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Downstream consumers (refactoring.staleness, future)       │
│                                                             │
│  check_staleness already reads commit_sha from              │
│  _depgraph.meta.json — once builder writes it, the          │
│  mtime fallback becomes a backup, not the primary path.     │
└─────────────────────────────────────────────────────────────┘
```

## Two changes

### Change 1 — V2 runner records real commit SHA in `_meta.yaml`

**Where:** `scripts/run_v2_50_repos.py` (and any sibling that writes
`_meta.yaml`). The `commit:` field is currently set to a literal string
("head", "main", or similar) instead of the actual git SHA.

**Fix:** at snapshot build time, run `git rev-parse HEAD` against the
source repo and write the resulting 40-char SHA into `commit:` (and
`branch:` separately if the runner wants to keep the branch name).

### Change 2 — `_depgraph.meta.json` includes `commit_sha` and `repo_remote`

**Where:** `src/dep/builder.py::_write_meta_json` (Spec 1).

**Fix:** read the upstream `_meta.yaml` (already in the snapshot dir, written
by the V2 runner) and propagate `commit` and `remote` into the dep-graph's
own meta JSON so `check_staleness` finds them on the first lookup. If the
upstream `_meta.yaml` is missing or doesn't carry a SHA, leave the field
unset — don't invent one.

```python
# src/dep/builder.py::_write_meta_json — proposed addition
upstream = snap / "_meta.yaml"
commit_sha = None
repo_remote = None
if upstream.exists():
    text = upstream.read_text(encoding="utf-8")
    for line in text.splitlines():
        m = re.match(r"^\s*commit\s*:\s*['\"]?([0-9a-fA-F]{7,40})['\"]?\s*$", line)
        if m: commit_sha = m.group(1).lower()
        m = re.match(r"^\s*remote\s*:\s*['\"]?(\S+)['\"]?\s*$", line)
        if m: repo_remote = m.group(1)
meta = {
    "snapshot": str(snap),
    "db": str(db_path),
    "build_seconds": round(build_seconds, 2),
    "row_counts": counts,
    "commit_sha": commit_sha,      # may be None — that's fine
    "repo_remote": repo_remote,
}
```

## Constraints

1. **No schema change** to the SQLite tables. This affects only the
   `_meta.yaml` (V2 runner) and `_depgraph.meta.json` (builder) sidecar files.
2. **Backwards compatible.** Existing snapshots without `commit_sha` continue
   to work — `check_staleness` already handles the missing-SHA case via its
   mtime fallback.
3. **No new dependency.** Use the existing `subprocess` + `re` for git
   queries and YAML line-parsing.
4. **No mass re-build required.** Snapshots can pick up the new field on
   their next build; old snapshots get the mtime fallback until rebuilt.

## Outputs

| Artifact | Lives in | Status |
|---|---|---|
| Real SHA in `_meta.yaml` | V2 runner (`scripts/run_v2_50_repos.py`) | edit |
| `commit_sha` in `_depgraph.meta.json` | `src/dep/builder.py::_write_meta_json` | edit |
| `repo_remote` in `_depgraph.meta.json` | same | edit |
| Test: meta-json has commit_sha when upstream yaml carries one | `tests/test_dep_builder_meta.py` | new |

## Out of scope

- Cross-snapshot diffs or multi-snapshot registries — Spec 3 territory.
- Storing commit SHA inside the SQLite (we already have a `meta` table —
  arguably it could go there, but the JSON sidecar is the documented
  consumer-facing meta surface today).
- Detecting partial / dirty snapshots (snapshot built mid-edit). Out of
  scope; mtime fallback would catch this anyway.

## Success criteria

1. After this fix, running `check_staleness` against the standard Kibana
   snapshot returns `level ∈ {fresh, stale, outdated}` (not `stale-mtime`),
   and `report.snapshot_sha` is the full 40-char SHA.
2. `_depgraph.meta.json` for any newly built snapshot contains a non-null
   `commit_sha` matching `git rev-parse HEAD` at build time.
3. Snapshots built before this change still work — `check_staleness` falls
   back to mtime cleanly with no error.
4. `_meta.yaml` no longer contains the literal `commit: head` for any new
   build.
