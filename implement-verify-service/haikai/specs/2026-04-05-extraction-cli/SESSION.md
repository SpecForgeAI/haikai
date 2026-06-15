# Session Log: Extraction CLI + /analyze-repo Skill

**Date:** 2026-04-05
**Branch:** `feature/extraction-cli-2026-04-05` (merged to main)

---

## Context

Started by pulling latest and resolving an unfinished merge on main. Reviewed recent commits and outstanding specs across the project. Identified that the `feature/interaction-extraction-and-classification` branch had implemented the full endpoint & data movement extraction spec (2026-04-04) but was missing two things from the spec: a standalone CLI command and a performance benchmark.

## What We Built

### Spec Design

Created `haikai/specs/2026-04-05-extraction-cli/` with requirements, spec, and tasks covering:

1. **3 CLI commands** added to `src/cli.py`:
   - `analyze` — runs ctags + tree-sitter structural pipeline on a codebase, writes snapshot to `.specforge/structural/`
   - `extract-endpoints` — extracts endpoints (REST, WebSocket, MQ, gRPC, scheduled) and interactions (HTTP, DB, MQ, cache, file I/O) from an existing structural store snapshot
   - `list-stores` — lists available snapshots with metadata

2. **Haikai `/analyze-repo` skill** — markdown instruction file at `haikai-profiles/default/commands/analyze-repo/` that guides Claude through: resolve target → analyze → extract → write REPORT.md → confirm. Primary deliverable is `REPORT.md` written to `.specforge/structural/<repo>/<commit>/REPORT.md`.

3. **API endpoint** `POST /api/v1/analyze-repo/stream` — SSE streaming endpoint following the same pattern as story-component-anchor. Triggers the skill via `ClaudeChatExecutor`.

### Key Design Decisions

- **Classification is always-on** — Updated mid-session after reviewing new commits on the interaction-extraction branch that removed the classification gate. YAML patterns always run (zero cost), LLM runs automatically when API keys are configured. `--no-llm` flag to disable.
- **Reuse `_get_llm_client()` pattern** from `structural_endpoints.py` for consistent env var handling.
- **REPORT.md as primary deliverable** — Skill reads back all generated files and synthesizes a structured markdown report. Output persisted to disk, not just printed to terminal.
- **Thin wrappers** — CLI commands call existing pipeline code. No business logic in the CLI layer.

### Implementation

- **src/cli.py** — 564 lines added: `discover_files()` helper, framework detection, endpoint/interaction extraction from store files, TSV/JSON output writers, all 3 click commands.
- **src/api.py** — `AnalyzeRepoRequest` model + `analyze_repo_stream()` SSE endpoint.
- **src/chat/claude_chat_executor.py** — Registered `analyze-repo` in commands list.
- **haikai-profiles/default/commands/analyze-repo/single-agent/analyze-repo.md** — Full skill with 5-step workflow.

### Testing

- **27 unit tests** (`tests/test_cli_structural.py`) — discover_files, framework detection, all 3 CLI commands via CliRunner with mocks, performance benchmark (500 entries < 5s).
- **15 integration tests** (`tests/test_cli_integration.py`) — Real ctags on Python + Java + TypeScript fixture project. Verifies: snapshot creation, all index files present, symbol detection (OrderService, OrderController, OrderApiClient), inheritance (JpaRepository), list-stores, extract-endpoints with all flag combinations, custom store/repo, performance.
- **42/42 passing** in ~5 seconds.

### Infrastructure

- Installed `universal-ctags` on the Windows dev machine (downloaded from GitHub releases, placed in `~/bin`).

## What's Deferred

- **T4.3**: Test `/analyze-repo` skill via live Claude CLI session
- **T4.5**: Test `POST /api/v1/analyze-repo/stream` with running API server

Both require a live environment — noted in memory for future sessions.

## What Changed During the Session

1. **Spec evolved** — Started with `--classify` opt-in flag, changed to always-on classification after reviewing new commits on the interaction-extraction branch that removed the gate.
2. **REPORT.md added** — Originally the skill just printed to terminal. Updated to persist a structured report to the store directory after discussing that output should be saved.
3. **API endpoint added** — Initially only had CLI + skill. Added the SSE endpoint after tracing the full execution chain (API → ClaudeChatExecutor → Claude CLI → skill markdown → bash commands).

## What's Next

### Immediate (close out nearly-done specs)

1. **Chat Session Memory** (3 tasks) — Wire into api.py SSE endpoints, register router, integration tests. This was just merged to main in a parallel branch.
2. **Auto Pattern Discovery** (3 tasks) — Real LLM validation. Needs API keys. Run against test repos, verify cost < $0.10/repo.
3. **AST Analysis Strategy** (2 tasks) — Token reduction measurement with tiktoken, performance test on 500-file project.

### Next Major Feature

4. **Enterprise Architecture Metamodel** (83 tasks, 10 phases) — The big one. Multi-repo structural analysis: stitch per-repo stores into a unified metamodel with cross-service dependencies, API surface extraction, contract parsing, data flow tracing, event detection. This builds directly on the endpoint extraction and interaction classification work we just completed. The extraction CLI provides the per-repo foundation; the metamodel spec stitches them together.

### Supporting Work

5. **Pattern Detection Refactor** (5 tasks) — Signal-based scoring for design pattern detection. Small scope, improves structural store quality.
6. **Tree-sitter Language Expansion** (1 task) — Performance test for mixed-language analysis. Nearly done.
