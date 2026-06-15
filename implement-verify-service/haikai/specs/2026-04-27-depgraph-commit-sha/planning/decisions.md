# Planning Decisions

## Why this spec exists

Verifying Phase 9 done-criteria of the refactoring spec
(`haikai/specs/2026-04-27-refactoring-impact/`) against the live Kibana
snapshot turned up a gap: `check_staleness` returned `level=unknown` because
no commit SHA was discoverable anywhere in the snapshot directory. The
upstream `_meta.yaml` had `commit: head` (the literal string) and the
dep-graph's `_depgraph.meta.json` didn't carry the field at all.

The refactoring spec worked around it by adding an mtime fallback — but
that's strictly less precise than SHA equality. This spec restores the
precise check by making both writers record the real SHA.

## Why a separate spec, not an in-place fix

Spec 1 (`haikai/specs/2026-04-25-deep-dependency-analysis/`) is marked
fully done. Editing its source files retroactively would muddy the "done"
status. A small follow-up spec is the cleaner pattern — it documents
exactly what changed, why, and what success looks like.

The refactoring spec's "no Spec 1 changes" constraint also forced this:
that spec couldn't fix the builder, only work around its limitations.

## Decisions

### Decision: SHA goes in JSON sidecar, not SQLite

**Why:** The SQLite has a `meta` table that could hold commit_sha — but the
documented consumer-facing meta surface is `_depgraph.meta.json`. Tools
already read it for row counts; adding two more fields fits the existing
shape with no new query path.

**Trade-off:** the SQLite remains "snapshot-content" only; the JSON is
"snapshot-context". Clear separation. If a future tool wants the SHA via
SQL, it can run `SELECT value FROM meta WHERE key='commit_sha'` after we
also write it there — but we don't do that now.

### Decision: builder reads upstream `_meta.yaml`, doesn't shell out to git

**Why:** The dep-graph builder doesn't know where the source repo lives;
it only knows the snapshot dir. The upstream V2 runner already has that
information when it writes `_meta.yaml`. Asking the builder to also
locate and shell out to git would duplicate logic that the runner already
has.

**Pattern:** Single source of truth = `_meta.yaml`. Builder is a passive
propagator.

**Trade-off:** if `_meta.yaml` is missing or has a bad SHA, builder
silently records `commit_sha: null`. That's fine — `check_staleness`
falls back to mtime, which we've already tested handles this gracefully.

### Decision: line-grep YAML, no pyyaml dependency

**Why:** Spec 1 explicitly avoids new external dependencies (stdlib +
networkx only). pyyaml is widely used but adding it for one regex would
violate the constraint.

**Pattern:** `re.match(r"^\s*commit\s*:\s*['\"]?([0-9a-fA-F]{7,40})['\"]?\s*$", line)`
is sufficient for the structured YAML the runner writes. We're not parsing
arbitrary YAML, just a few known keys.

**Trade-off:** if the upstream YAML grows nested structures around `commit:`,
the regex misses. Document this so future runner changes don't silently
break the propagation.

## Risk register

| Risk | Mitigation |
|---|---|
| Existing snapshots have `commit: head` placeholder; mtime fallback runs | Already handled — `check_staleness` mtime fallback gives a useful answer (`stale-mtime` / `fresh-mtime`). Migration is "rebuild the snapshot when convenient." |
| Source repo is shallow-cloned (`--depth 1`) — `git rev-parse HEAD` returns a real SHA but it's the only commit known | Fine. The SHA is still unique and comparable. Staleness check works as designed. |
| User has a detached-HEAD checkout | `git rev-parse HEAD` works in detached state too. No change. |
| Source repo path is unknown to the runner | The V2 runner controls the clone — it always knows the path. If a future runner doesn't, it can't write a real SHA and the fallback engages. |

## Done criteria (mirrors `tasks.md` Phase 4)

1. Newly built snapshot's `_depgraph.meta.json` has a real `commit_sha`
2. `_meta.yaml` no longer carries `commit: head` literals
3. `check_staleness` on real snapshots returns precise levels
4. Snapshots from before this fix still work (mtime fallback engages)
