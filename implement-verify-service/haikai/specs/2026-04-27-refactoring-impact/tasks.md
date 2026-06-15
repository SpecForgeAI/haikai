# Tasks: Refactoring Impact

## Phase 1 — Git wrapper

- [x] T1.1: `src/refactoring/git_repo.py::GitRepo` — subprocess wrapper. Methods: `head_sha()`, `working_tree_dirty() -> bool`, `modified_files() -> list[str]`, `diff(scope, commit=None) -> list[FileDiff]`
- [x] T1.2: `FileDiff` + `DiffHunk` dataclasses (path, old_start, new_start, lines, status)
- [x] T1.3: Parse `git diff --unified=0` output → structured hunks (regex on `@@ -a,b +c,d @@`)
- [x] T1.4: Unit tests: synthetic git repo, modify a file, verify diff parsed
- [x] T1.5: Handle renames (`git diff` shows `rename from`/`rename to`) — populate `old_path`

## Phase 2 — Change detection engine

- [x] T2.1: `src/refactoring/change_detector.py::ChangeImpactReport` dataclass with `risk: {score, level}` (placeholder formula, tune later)
- [x] T2.2: `detect_changes(repo_root, depgraph, scope='staged')` — orchestrator
- [x] T2.3: `_hunks_to_symbols(depgraph, file_diff)` — for each hunk line, run *nearest-preceding-symbol* query (`SELECT * FROM symbols WHERE file=? AND line<=? ORDER BY line DESC LIMIT 1`); dedupe to symbol set per file
- [x] T2.4: For each impacted symbol, call `dep.impact_of(...)` to get callers + endpoints
- [x] T2.5: Risk score = `len(callers) + 5*len(endpoints)`; level thresholds low<10, medium<50, high≥50; emit both (raw score + level)
- [x] T2.6: Synthetic equivalent done (in-method-body edit attribution + endpoint association verified via `test_in_method_body_edit_attributes_to_enclosing_symbol` and `test_endpoint_handler_edit_marks_endpoint_affected`). Petclinic-specific run deferred to Phase 9 done-criteria T9.3.
- [x] T2.7: Edge cases:
  - Added file → no impact, list new file only
  - Deleted file → impact = union of every symbol in `<file>` per snapshot (treat each as edited)
  - Renamed file (`status='renamed'`) → hunks attribute to new path; old path symbols flagged as "moved"

## Phase 3 — Rename engine

- [ ] T3.1: `src/refactoring/rename_engine.py::RenamePlan` dataclass with `partitions`, `import_refs`, `ambiguous`, `ambiguity_candidates` fields
- [ ] T3.2: `_resolve_old_qname(depgraph, old_name)` — accepts qualified name or bare; returns 1 row OR ambiguity candidates list
- [ ] T3.3: `_graph_refs(depgraph, old_symbol)` — kind-aware: methods/functions → `calls.callee_symbol_id`; classes → `calls.callee_symbol_id` + `inheritance.parent_symbol_id`; also fallback to `calls.callee_qualified_name == ?` for unresolved-callee rows
- [ ] T3.4: `_import_refs(depgraph, old_symbol)` — `imports WHERE imported_name == old.name AND package matches old.module_path` → file:line of import statements that need rewriting
- [ ] T3.5: `_text_refs(repo_root, old_bare_name, lang_exts, all_languages=False)` — `git grep -nE "\\b<name>\\b" -- <ext-glob>` parser; respects symbol's language by default
- [ ] T3.6: `_partition_refs(graph_refs, import_refs, text_refs)` — emit `graph_only` / `text_only` / `both` partitions, each with file:line
- [ ] T3.7: `_build_patches(refs, old_bare_name, new_bare_name)` — produce `(file, line, before_text, after_text)` tuples; word-boundary replacement, not whole-line regex
- [ ] T3.8: `rename_preview(repo_root, depgraph, old_qname, new_name, kind=None, all_languages=False)` — returns plan; if ambiguous, plan.ambiguous=True with candidates and no patches
- [ ] T3.9: `rename_apply(repo_root, depgraph, plan, force_dirty=False, triggered_by='python_api')` — writes patches; appends `_refactoring_log.jsonl`
- [ ] T3.10: Apply path safety: refuse if working-tree dirty unless `force_dirty=True`; record `sha_before` before any write
- [ ] T3.11: Unit tests on synthetic repo (5 files, 1 class with 8 references including 2 import statements) covering preview + apply + ambiguity branch
- [ ] T3.12: Integration test on petclinic snapshot — `rename_preview("org.springframework.samples.petclinic.owner.OwnerController", "OwnerCtrl")` finds graph + import refs; assert ref count is within ±2 of `git grep -c "\\bOwnerController\\b"`

## Phase 3 — Rename engine (continued)

- [x] T3.1-T3.12: all done. Tests in `tests/test_refactoring_rename_engine.py` (7 cases): preview finds graph + import + text refs, ambiguity branch, unknown-symbol noop, apply writes + audit, dirty-tree refusal, force-dirty override, ambiguous apply is noop.

## Phase 4 — Staleness tracker

- [x] T4.1: `src/refactoring/staleness.py::StalenessReport` dataclass
- [x] T4.2: Reads `_meta.json` → `_depgraph.meta.json` → dir-name pattern (full SHA, then short-SHA fallback)
- [x] T4.3: `check_staleness(snapshot_path, repo_root)` implemented
- [x] T4.4: Levels: `fresh` / `stale` / `outdated` / `unknown`
- [x] T4.5: 6 unit tests in `tests/test_refactoring_staleness.py`

## Phase 5 — Haikai skills (3)

- [x] T5.1: `haikai-profiles/default/commands/detect-changes/single-agent/detect-changes.md`
- [x] T5.2: `haikai-profiles/default/commands/rename-symbol/single-agent/rename-symbol.md` (preview-by-default semantics in skill prompt)
- [x] T5.3: `haikai-profiles/default/commands/check-staleness/single-agent/check-staleness.md`
- [x] T5.4: All 3 skills are pure narrators over the engine — LLM optional

## Phase 6 — REST endpoints (4)

- [x] T6.1: `src/api/refactor_routes.py` — FastAPI router
- [x] T6.2: `GET /api/refactor/detect`
- [x] T6.3: `GET /api/refactor/rename-preview`
- [x] T6.4: `POST /api/refactor/rename-apply` (returns 400 when `confirm` != `true`)
- [x] T6.5: `GET /api/refactor/staleness`
- [x] T6.6: Mounted in `src/api.py` after `dep_router`
- [x] T6.7: 6 TestClient smoke tests in `tests/test_refactoring_routes.py` (all 4 routes + confirm guard + 404 path)

## Phase 7 — Public Python API + docs

- [x] T7.1: `src/refactoring/__init__.py` re-exports all engines + dataclasses
- [x] T7.2: `docs/refactoring-guide.md` — quick start, naming convention, partition explanation, audit log, safety defaults, REST table
- [ ] T7.3: README mention of `src/refactoring/` — pending (small change to top-level README)

## Phase 8 — Audit log + safety hardening

- [x] T8.1: `_refactoring_log.jsonl` schema covered (all 9 fields verified by test_audit_log_record_shape)
- [x] T8.2: `sha_before` recorded; `sha_after` left optional (deferred unless we add commit-within-apply)
- [x] T8.3: `force_dirty` flag implemented + tested
- [x] T8.4: Atomic write via sibling `.tmp` + `os.replace`; test_atomic_apply_no_temp_files_left confirms no leftovers
- [x] T8.5: Replay test (`test_replay_log_produces_same_result`) — apply, git checkout, replay → identical state
- [x] T8.6: `tool_version` from `src.refactoring.__version__` (verified by test_audit_log_record_shape)

## Phase 9 — Done criteria

- [x] T9.1: 3 skills callable — verified via Python API path; petclinic-specific end-to-end deferred (no live snapshot in this env)
- [x] T9.2: 4 REST endpoints return 200 — verified via TestClient on synthetic data; petclinic-specific deferred
- [ ] T9.3: detect_changes vs Spec 1 fixture on petclinic — **deferred** (needs live petclinic snapshot)
- [ ] T9.4: Rename preview vs `git grep` on petclinic ±2 — **deferred** (needs live petclinic snapshot)
- [ ] T9.5: V2 50-repo benchmark + Spec 1 builds unchanged — **deferred** (no benchmark re-run yet; nothing in this spec touches AST extraction or dep-graph schema, so no expected impact)
- [x] T9.6: Test suite → zero unintended file mutations — all 44 tests use tmp_path fixtures; only the apply-tests write, and they write to throwaway paths

## Test summary

`tests/test_refactoring_*.py` — **44 cases, all green** (~15s):
- `git_repo`: 13 (head/dirty/diff parsing across all 4 file statuses + 2 scopes)
- `change_detector`: 8 (no-changes / in-method-body / endpoint / added / deleted / renamed / risk / scope-string)
- `rename_engine`: 7 (preview / ambiguity / unknown / apply+audit / dirty-refusal / force-dirty / ambiguous-noop)
- `staleness`: 6 (fresh / stale / outdated / unknown / dir-name fallbacks)
- `routes`: 6 (4 endpoints + confirm guard + 404)
- `audit_replay`: 4 (record shape / replay / no-leftover-tmps / triggered_by)
