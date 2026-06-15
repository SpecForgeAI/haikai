# Requirements: Extraction CLI Commands

## Context

The structural analysis pipeline (`src/ast/pipeline.py`) produces rich output files:
- `_index.txt` — symbols (classes, methods, variables)
- `_calls.txt` — call graph with confidence scores
- `_imports.txt` — import/dependency graph
- `_inheritance.txt` — type hierarchies

The `feature/interaction-extraction-and-classification` branch adds:
- `_endpoints.txt` — detected REST, WebSocket, MQ, gRPC, scheduled endpoints
- `_interactions.txt` — data movements (HTTP, DB, MQ, cache, file I/O) with provenance
- `_extraction_meta.yaml` — framework detection stats + extraction metadata
- `_classification_meta.yaml` — classification provenance (YAML vs LLM)

Classification is now always-on: YAML pattern matching runs unconditionally (zero cost), and LLM classification runs automatically when an `llm_client` is available (reads from env vars via `_get_llm_client()` in `structural_endpoints.py`).

Currently these are only accessible via the Python pipeline API (`run_structural_pipeline()`) and the existing `POST /api/v1/structural/analyze` endpoint. The CLI (`src/cli.py`) exposes `get-metamodel`, `generate-product-standards`, and `generate-global-standards` — but no structural analysis or extraction commands.

---

## Goal

Add CLI commands to `src/cli.py` that expose the structural pipeline and extraction capabilities for standalone use. Users should be able to:

1. Run the full structural pipeline on a repo/directory (including always-on classification)
2. Extract endpoints and interactions from an existing structural store
3. List available structural store snapshots

Classification is automatic — YAML patterns always run, LLM classification runs when API keys are configured in the environment. No opt-in flag needed.

These commands enable CI/CD integration, scripting, and developer use without the API server.

---

## Functional Requirements

### FR-1: `analyze` Command

**FR-1.1** Add `standards-extractor analyze` CLI command that runs the full structural pipeline on a directory.

**FR-1.2** Required options:
- `--project-dir` — path to the codebase to analyze

**FR-1.3** Optional options:
- `--store-dir` — override output directory (default: `<project-dir>/.specforge/structural`)
- `--repo-name` — override repo name (default: auto-detect from git)
- `--no-treesitter` — skip tree-sitter enrichment (ctags only)
- `--file-pattern` — glob pattern to filter files (default: all supported extensions)

**FR-1.4** Output:
- Print snapshot path on success
- Print summary stats (files analyzed, symbols found, calls extracted)
- Exit code 0 on success, 1 on failure

### FR-2: `extract-endpoints` Command

**FR-2.1** Add `standards-extractor extract-endpoints` CLI command that extracts endpoints and interactions from an existing structural store snapshot.

**FR-2.2** Required options:
- `--store-path` — path to a structural store snapshot (directory containing `_index.txt`, `_calls.txt`, etc.)

**FR-2.3** Optional options:
- `--no-llm` — disable LLM classification even if API keys are configured (YAML-only)
- `--format` — output format: `tsv` (default) or `json`
- `--endpoints-only` — skip interaction extraction, only detect endpoints
- `--interactions-only` — skip endpoint extraction, only detect interactions

**FR-2.4** Output:
- Write `_endpoints.txt` and/or `_interactions.txt` to the store path
- Write `_extraction_meta.yaml` with stats
- Print summary to stdout (endpoints found, interactions found, frameworks detected)
- Exit code 0 on success, 1 on failure

### FR-3: `list-stores` Command

**FR-3.1** Add `standards-extractor list-stores` CLI command that lists available structural store snapshots.

**FR-3.2** Required options:
- `--project-dir` — path to the project

**FR-3.3** Output:
- List snapshots with: timestamp, commit SHA, branch, file count
- Indicate which is `latest`

---

## Non-Functional Requirements

### NFR-1: Consistency
- Follow the existing CLI pattern in `src/cli.py` (click group, env file loading, colored output)
- Use the same `click.secho` / `click.echo` patterns for success/error

### NFR-2: No New Dependencies
- Use only `click` (already a dependency) and existing pipeline code
- No new packages required

### NFR-3: Error Handling
- Missing store path or project dir: clear error message with expected path format
- Missing ctags binary: clear error message with install instructions
- No API keys configured: classification runs YAML-only silently (no error, this is normal)

### NFR-4: Performance
- `analyze` command should print progress as it runs (file count, current phase)
- `extract-endpoints` on an existing store should complete in < 5 seconds for 500-file repos

### NFR-5: Testability
- Commands must be testable via click's `CliRunner`
- Integration test: analyze this repo, extract endpoints, verify output files exist

---

## Haikai Skill Requirements

### SK-1: `/analyze-repo` Skill

**SK-1.1** Create an Haikai skill at `haikai-profiles/default/commands/analyze-repo/single-agent/analyze-repo.md` that wraps the structural analysis and extraction workflow.

**SK-1.2** The skill should guide Claude through a conversational flow:
1. Ask the user for the target repo path (or use the current project)
2. Run `standards-extractor analyze` to produce the structural store
3. Run `standards-extractor extract-endpoints` on the resulting snapshot
4. Classification runs automatically (YAML always, LLM if API keys configured)
5. Read back the generated files (`_endpoints.txt`, `_interactions.txt`, `_extraction_meta.yaml`, `_classification_meta.yaml`, `_index.txt`, `_calls.txt`) and synthesize a human-readable summary
6. Write `REPORT.md` to `.specforge/structural/<repo>/<commit>/REPORT.md` — this is the skill's primary deliverable

**SK-1.3** The skill must follow the existing Haikai command pattern:
- Markdown file with Description, Usage, Input, Output sections
- Registered in `claude_chat_executor.py` commands list for API-driven execution
- Works both as a Claude CLI `/analyze-repo` slash command and via the API SSE endpoint

**SK-1.4** Create API SSE endpoint `POST /api/v1/analyze-repo/stream` in `src/api.py`:
- Request model: `AnalyzeRepoRequest` with company, project, repo_path (optional), session_mode
- LLM classification is automatic when API keys are configured (uses `_get_llm_client()` pattern from `structural_endpoints.py`)
- Follows the same pattern as `story_component_anchor_stream` — creates `ClaudeChatExecutor`, builds prompt, returns `StreamingResponse`
- SSE event types: `content`, `file_modified`, `error`
- Tagged under "Skills" in OpenAPI

**SK-1.5** The skill should handle common scenarios:
- Repo already has a structural store: offer to reuse or re-analyze
- No ctags installed: provide install instructions
- Large repo: warn about analysis time, suggest `--file-pattern` to scope down
