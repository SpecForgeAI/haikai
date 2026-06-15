# Tasks: Capture Commit SHA in Dep-Graph Snapshot Metadata

## Phase 1 — V2 runner records real SHA

- [x] T1.1: In `scripts/run_v2_50_repos.py`, locate the spot that writes `_meta.yaml`'s `commit:` field
- [x] T1.2: Replace the placeholder string with `subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo_path, ...).stdout.strip()`. If the call fails (no `.git`, etc.), fall back to the placeholder so the runner doesn't crash.
- [ ] T1.3 (deferred — only `run_v2_50_repos.py` had the placeholder; legacy runner inherits via subprocess): If applicable, do the same in any sibling runner that writes `_meta.yaml` (legacy runner, single-repo CLIs)
- [ ] T1.4 (manual; needs a real V2 run after this commit lands): Manual verification: run V2 on one small repo (petclinic), inspect the resulting `_meta.yaml`, confirm `commit:` is a 40-char SHA

## Phase 2 — Builder propagates SHA into `_depgraph.meta.json`

- [x] T2.1: In `src/dep/builder.py::_write_meta_json`, before constructing the `meta` dict, attempt to read `<snap>/_meta.yaml` and extract `commit` and `remote` via line-grep regex (no pyyaml dep)
- [x] T2.2: Add `commit_sha` and `repo_remote` keys to the `meta` dict (None when not found)
- [x] T2.3 (5 tests in `tests/test_dep_builder_meta.py`, all green): Unit test in `tests/test_dep_builder_meta.py`: write a synthetic `_meta.yaml` with `commit: <40-char-sha>`, run builder, assert `_depgraph.meta.json` carries the same `commit_sha`
- [x] T2.4: Backwards-compat test: `_meta.yaml` missing → builder writes `commit_sha: null` and doesn't error

## Phase 3 — Verify gap closed

- [ ] T3.1: Re-run `scripts/test_refactoring_on_kibana.py` after rebuilding the kibana snapshot
- [ ] T3.2: Confirm `check_staleness` returns `level ∈ {fresh, stale, outdated}` (no longer `stale-mtime`)
- [ ] T3.3: Confirm `report.snapshot_sha` is the real SHA (not None)

## Phase 4 — Done criteria

- [ ] T4.1: Newly built snapshot has commit_sha in `_depgraph.meta.json`
- [ ] T4.2: V2 50-repo runner outputs no longer carry `commit: head` literal
- [ ] T4.3: `check_staleness` on real snapshots reports a precise level (no mtime fallback unless SHA truly unavailable)
- [ ] T4.4: Existing snapshots without `commit_sha` still work — mtime fallback engages cleanly
- [ ] T4.5: No SQLite schema change; no new pip dep
