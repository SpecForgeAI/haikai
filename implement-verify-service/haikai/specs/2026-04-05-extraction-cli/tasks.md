# Tasks: Extraction CLI Commands

## Overview
Total: 4 phases, 19 tasks (+ 1 sub-item added to T2.6)

**Goal:** Add `analyze`, `extract-endpoints`, and `list-stores` CLI commands to `src/cli.py`. Thin wrappers over existing pipeline code — no new analysis logic.

**Reference Documents:**
- Spec: `spec.md`
- Requirements: `planning/requirements.md`

## Phase 1: `analyze` Command

**Dependencies:** `src/ast/pipeline.py`, `src/ast/ctags_provider.py`, `src/ast/store.py`

- [x] T1.1: Add `discover_files()` helper to `src/cli.py`
  - Glob for supported extensions (.py, .java, .ts, .tsx, .js, .jsx, .go, .cs, .rs, .c, .cpp, .h, .hpp)
  - Exclude node_modules, .git, __pycache__, venv, dist, build
  - Accept optional `--file-pattern` override

- [x] T1.2: Add `analyze` command to click group
  - `--project-dir` (required, Path)
  - `--store-dir` (optional, default: `<project-dir>/.specforge/structural`)
  - `--repo-name` (optional, auto-detect from git)
  - `--no-treesitter` flag
  - `--env-file` (optional, default `.env`)

- [x] T1.3: Wire `analyze` command to pipeline
  - Instantiate `CtagsProvider`, call `analyze_batch()`
  - Create `FileStore` with store-dir
  - Call `run_structural_pipeline()` with ctags results
  - Set `AST_TREESITTER_ENABLED=false` if `--no-treesitter`

- [x] T1.4: Add progress output + summary stats
  - Print file count, phase names to stderr during execution
  - Print snapshot path + symbol/import/call/inheritance counts to stdout on completion

- [x] T1.5: Unit test — `analyze` command with CliRunner
  - Mock `CtagsProvider` and `run_structural_pipeline`
  - Verify correct options parsed, pipeline called with right args
  - Verify output format and exit codes

## Phase 2: `extract-endpoints` Command

**Dependencies:** `src/ast/extractors/`, `src/ast/store.py`, `src/ast/interaction_classifier.py`

- [x] T2.1: Add `extract-endpoints` command to click group
  - `--store-path` (required, Path, must exist)
  - `--no-llm` flag (disable LLM classification, YAML-only)
  - `--format` choice: tsv | json
  - `--endpoints-only` flag
  - `--interactions-only` flag
  - `--env-file` (optional, default `.env`)

- [x] T2.2: Implement store validation
  - Check `_index.txt` and `_calls.txt` exist in store path
  - Clear error message if missing with expected path format

- [x] T2.3: Wire extraction logic
  - Load store files (_index.txt, _calls.txt, _imports.txt, _inheritance.txt)
  - Run framework detection from _imports.txt
  - Run per-language endpoint extractors
  - Run per-language interaction extractors
  - Write _endpoints.txt, _interactions.txt, _extraction_meta.yaml via FileStore

- [x] T2.4: Wire classification (always-on)
  - YAML patterns always run (zero cost)
  - Use `_get_llm_client()` pattern from `structural_endpoints.py` to create LLM client from env vars
  - If API keys configured and `--no-llm` not set: LLM classifies unknown interactions
  - If no API keys or `--no-llm`: YAML-only (no error, just informational message)

- [x] T2.5: Add JSON output format
  - When `--format json`: write _endpoints.json and _interactions.json alongside TSV
  - JSON schema: array of objects matching TSV column names

- [x] T2.6: Unit test — `extract-endpoints` command with CliRunner
  - Create fixture store path with minimal _index.txt, _calls.txt
  - Verify extraction runs and output files created
  - Verify --endpoints-only skips interactions
  - Verify --no-llm skips LLM classification
  - Verify no API keys configured runs YAML-only without error

## Phase 3: `list-stores` Command + Integration

- [x] T3.1: Add `list-stores` command to click group
  - `--project-dir` (required, Path)
  - `--repo-name` (optional, auto-detect from git)

- [x] T3.2: Implement snapshot listing
  - Walk `.specforge/structural/<repo>/` directory
  - Parse `_meta.yaml` for timestamp, branch, file count
  - Identify latest symlink/pointer
  - Print formatted table

- [x] T3.3: Integration test — full pipeline via CLI (ctags installed, verified end-to-end)
  - Run `analyze --project-dir .` on this repo (or small fixture)
  - Run `list-stores --project-dir .` and verify snapshot appears
  - Run `extract-endpoints --store-path <snapshot>` and verify output files
  - Verify exit codes throughout

- [x] T3.4: Performance test
  - Run `extract-endpoints` on a 500-file structural store
  - Assert completes in < 5 seconds

## Phase 4: Haikai Skill

**Dependencies:** Phase 1-2 complete (CLI commands working)

- [x] T4.1: Create skill file `haikai-profiles/default/commands/analyze-repo/single-agent/analyze-repo.md`
  - Follow existing skill pattern (Description, Usage, Input, Output, Workflow sections)
  - Conversational flow: resolve target → analyze → extract (classification automatic) → write REPORT.md → confirm
  - REPORT.md step is critical: skill reads back _endpoints.txt, _interactions.txt, _extraction_meta.yaml, _classification_meta.yaml, _index.txt, _calls.txt and writes a structured markdown summary to `<snapshot>/REPORT.md`
  - REPORT.md includes: frameworks detected, structural stats, endpoints by type with examples, interactions by category with direction breakdown, classification provenance, store location
  - Handle existing store (reuse vs re-analyze)
  - Handle missing ctags, no source files, missing API key errors

- [x] T4.2: Register skill in `src/chat/claude_chat_executor.py`
  - Add `("analyze-repo", "analyze-repo/single-agent/analyze-repo.md")` to commands list
  - Verify template resolution works (no `{{...}}` references needed for this skill)

- [ ] T4.3: Test skill via Claude CLI
  - Invoke `/analyze-repo` against this repo
  - Verify full flow: analysis runs, endpoints extracted, summary displayed
  - Verify error handling: run without ctags, run without API keys (should work YAML-only)

- [x] T4.4: Add `POST /api/v1/analyze-repo/stream` endpoint to `src/api.py`
  - `AnalyzeRepoRequest` model: company, project, repo_path (optional), no_llm (bool, default false), session_mode
  - Create `ClaudeChatExecutor` with `command_name="analyze-repo"`
  - Build prompt from request fields (repo path + LLM mode)
  - Use `_get_llm_client()` pattern for automatic LLM detection
  - Return `StreamingResponse` wrapping `executor.stream_message()`
  - Follow exact pattern of `story_component_anchor_stream`
  - Tag under "Skills" in OpenAPI

- [ ] T4.5: Test API SSE endpoint
  - POST to `/api/v1/analyze-repo/stream` with company/project/repo_path
  - Verify SSE events stream correctly (content, file_modified, error)
  - Verify files written to workspace (.specforge/structural/)
