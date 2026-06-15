# Raw: Commit batch — 7 commits landed on feature/agentic-discovery-v2
**Date:** 2026-05-01
**Source type:** Git log range `f97e021^..HEAD`
**Branch:** feature/agentic-discovery-v2

Immutable raw notes. Do not edit; supersede via a new dated raw file if findings change.

---

## Commits in chronological order

| SHA | Subject | Notes |
|---|---|---|
| f97e021 | `feat(dep): add commit_sha + repo_remote to dep-graph metadata` | ~40 LOC, 5 tests; `_resolve_head_sha()` in benchmark runner |
| 28c14de | `fix(v1): handle UTF-8 BOM + empty file in claude reporter loader` | Real bug — V1 reported 0 endpoints on Kibana; manifest-driven regression suite |
| 8b6dfc7 | `perf(ctags): make subprocess timeout env-configurable for large repos` | `CTAGS_TIMEOUT_SEC` env var, default 600s (was 60s hardcoded) |
| b19c048 | `feat(openapi): detect + parse OpenAPI/Swagger as canonical endpoint source` | Kibana 2,597 → 611; new `src/dep/openapi.py`, `parse_openapi_spec` parser, `find-openapi-spec` skill |
| 3f6ad2f | `feat(refactoring): change detector + rename engine + staleness on the dep-graph` | 20 files, 3,053 insertions; 3 engines + 4 REST endpoints + 3 skills + 6 tests + a guide |
| 9c6eda3 | `wiki: scaffold project meta-wiki + spec the codebase-wiki capability` | This wiki + spec for Layer B |
| 85bad3c | `chore: move kibana investigation scripts to scripts/investigations/` | Moved 4 ad-hoc scripts behind a README explaining their throwaway nature |

## The cross-cutting story

These were not 7 independent threads. The chronology underneath the commit timestamps:

1. **OpenAPI canonicalization** (b19c048) was the centerpiece: when a project ships its own spec, that's the canonical answer.
2. While building it, Kibana benchmarks revealed the **ctags timeout** silently failing on big repos (8b6dfc7), and the **dep-graph metadata** lacked precise commit SHAs (f97e021).
3. The **refactoring impact** work (3f6ad2f) was the next layer up: now that dep-graph metadata is precise, build engines that exploit it (change_detector, rename_engine, staleness).
4. While exercising V1 on Kibana for comparison, the **UTF-8 BOM bug** (28c14de) surfaced — V1 was emitting 0 endpoints because Claude CLI added a BOM that `json.loads` choked on.
5. The **Karpathy LLM Wiki gist** was read late in the day; this wiki + the codebase-wiki spec (9c6eda3) followed.
6. Cleanup of throwaway investigation scripts (85bad3c) closed out the batch.

## Methodological notes

- Six logical commits + one chore commit. Splits chosen so each lands a coherent unit rather than a mega-PR.
- Order chosen so simpler / dependent-on-by-others commits land first: depgraph SHA → BOM fix → ctags timeout → openapi → refactoring → wiki → chore.
- Each commit message names the spec it implements (where applicable).
- `git add -A` was deliberately avoided; files were staged explicitly to prevent accidentally committing `.claude/scheduled_tasks.lock` (a runtime artifact).

## Discovered: existing structural oddity

- Both `src/api.py` AND `src/api/` directory exist. Python's import system means the package wins; `src/api.py` is likely shadowed/unreachable. Not addressed in this batch — flagged for future cleanup.

## Pre-commit verification

- No test suite was run before committing this batch. Risk acknowledged; tests existed for each new module but full-suite green was not confirmed.
- All commits have `Co-Authored-By` trailer.
- Commit style follows existing repo convention: lowercase imperative with `feat/fix/perf/chore/wiki:` prefix.

## Push outcome

All 7 commits pushed to `origin/feature/agentic-discovery-v2` (`f965680..85bad3c`). Branch in sync with origin.
