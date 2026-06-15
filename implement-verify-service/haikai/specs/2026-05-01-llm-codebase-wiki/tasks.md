# Tasks: LLM Codebase Wiki

## Phase 1 — Scaffolding

- [ ] T1.1: Create `src/wiki/` package with `__init__.py`
- [ ] T1.2: `src/wiki/schema.py` — default page-type taxonomy + frontmatter model (Pydantic)
- [ ] T1.3: `src/wiki/pages.py` — `Page` model: load/save markdown + YAML frontmatter, parse `[[wikilinks]]`
- [ ] T1.4: `src/wiki/log.py` — append entry helper with date format `## [YYYY-MM-DD] {init|ingest|query|lint} | <title>`
- [ ] T1.5: `src/wiki/init.py` — `init_wiki(target_path)` creates `.wiki/` skeleton, idempotent
- [ ] T1.6: Default `schema.md` template embedded as a Python string constant
- [ ] T1.7: Tests: init on empty target, init on existing wiki preserves user edits

## Phase 2 — V2-extraction ingest

- [ ] T2.1: `src/wiki/ingest.py` — `ingest_v2_extraction(target_path, llm_client)`
  - Read V2's structural store + endpoint records + interaction records
  - Group by service/module → per-service prompt
  - Group by endpoint → per-endpoint-group prompt
  - Group by data entity → per-entity prompt
- [ ] T2.2: Page-authoring prompt — system prompt + few-shot for synthesis prose with cross-links
- [ ] T2.3: `src/wiki/index.py` — `rebuild_index(wiki_path)` walks pages, reads frontmatter, writes `index.md`
- [ ] T2.4: Cross-link inference — after pages drafted, second pass adds `[[wikilinks]]` between related pages
- [ ] T2.5: Snapshot input filed in `raw/YYYY-MM-DD_v2-extraction.json`
- [ ] T2.6: Smoke test on spring-petclinic — must produce OwnerService, Owner, owner-routes pages with cross-links
- [ ] T2.7: Smoke test on openmrs-core — ≥ 1 page per discovered service/endpoint/entity

## Phase 3 — Query + index navigation

- [ ] T3.1: `src/wiki/query.py` — `query_wiki(target_path, question, llm_client)`
  - Read `index.md`
  - LLM picks relevant pages
  - Read picked pages
  - LLM synthesizes answer with citations like `[services/PatientService](pages/services/PatientService.md)`
- [ ] T3.2: `src/wiki/search.py` — BM25 over page text, grep fallback; return ranked page paths
- [ ] T3.3: Tests: query against the petclinic wiki — "what services own owners?" returns OwnerService

## Phase 4 — Git-range ingest

- [ ] T4.1: `ingest_git_range(target_path, ref_range, llm_client)`
  - Compute diff between refs
  - Map changed symbols/files to existing pages (via frontmatter `sources`)
  - For each affected page, prompt LLM to update with new info, flag contradictions
  - For substantial changes, draft new entry in `pages/decisions/`
- [ ] T4.2: Symbol-to-page mapping with fallback fuzzy match on rename
- [ ] T4.3: Contradiction-detection prompt — "is this update consistent with the existing page?"
- [ ] T4.4: Pages unchanged if diff is no-op for them (preserve mtime)
- [ ] T4.5: Tests: edit one source file in petclinic, run incremental ingest, only one page changes

## Phase 5 — Lint (mechanical)

- [ ] T5.1: `src/wiki/lint.py` — `lint_wiki(target_path)` returns structured report
  - Orphan pages (no inbound links from other pages or index)
  - Broken `[[links]]`
  - Stale pages (referenced source files modified after page mtime by > N days)
  - Missing pages (concept names appearing in ≥3 pages without their own page)
- [ ] T5.2: Tests: synthetic wiki with intentional orphans/broken links/stale pages

## Phase 6 — API + CLI

- [ ] T6.1: `src/api/wiki_routes.py` — endpoints from spec.md §2
- [ ] T6.2: Wire routes into `src/api.py`
- [ ] T6.3: `src/cli.py` — `wiki` subcommand with `init|ingest|query|lint|serve`
- [ ] T6.4: `wiki serve <target>` — minimal HTTP server that renders markdown pages with link navigation (use existing static-file infra if any, else stdlib)
- [ ] T6.5: API tests: TestClient for each endpoint, mocked LLM
- [ ] T6.6: CLI smoke tests

## Phase 7 — Comparison study (validation)

- [ ] T7.1: Run `gitnexus wiki openmrs-core` to produce gitnexus's artifact
- [ ] T7.2: Run our `wiki init + ingest --source v2-extraction` on openmrs-core
- [ ] T7.3: Pick 3 questions:
  - "What services write to the patient table and under what conditions?"
  - "What are the main extension points for adding a new clinical concept?"
  - "What's the architectural relationship between the api/, web/, and webapp/ layers?"
- [ ] T7.4: Hand-rate each artifact's ability to answer (1–5 scale, with notes)
- [ ] T7.5: File results in `wiki/pages/comparisons/gitnexus-wiki-vs-llm-codebase-wiki.md`

## Phase 8 — Optional skills + LLM-driven lint

- [ ] T8.1: `haikai-profiles/default/commands/wiki-ingest/single-agent/wiki-ingest.md`
- [ ] T8.2: `haikai-profiles/default/commands/wiki-query/single-agent/wiki-query.md`
- [ ] T8.3: `--llm` flag on `wiki lint` for contradiction detection across pages

## Phase 9 — Done criteria

- [ ] T9.1: All success criteria from spec.md §"Success criteria" pass
- [ ] T9.2: STATUS.md updated with new artifact paths and CLI commands
- [ ] T9.3: README addition pointing at the new capability
- [ ] T9.4: Comparison study writeup filed (T7.5)
