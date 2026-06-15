# Standards Extractor

The project this wiki documents. A FastAPI app that does two distinct things:

1. **Extracts coding standards** from arbitrary codebases (the original product — three CLI modes: global / product / metamodel).
2. **Drives Haikai spec-driven development** — `/shape-spec` → `/write-spec` → `/create-tasks` → `/implement-tasks` lifecycle, exposed as both REST endpoints and SSE-streaming chat.

Underneath both is a **structural extraction pipeline** ([[../concepts/two-tier-code-intelligence]] + [[../concepts/structural-store]]) that produces compact, LLM-friendly summaries of any codebase, plus an **agentic discovery loop** ([[../concepts/agentic-discovery]]) that finds endpoints and DB interactions framework-agnostically.

## Surface area

| Layer | Where | Notes |
|---|---|---|
| API | `src/api/__init__.py` ([[../concepts/api-layer]]) | 27 endpoints, 6 functional groups. Single file (~4,000 lines). |
| Standards pipeline | `src/standards_orchestrator.py` ([[../concepts/standards-pipeline]]) | FileScanner → strategies → StandardsSynthesizer → ReportGenerator |
| Metamodel system | `src/metamodel_*.py` ([[../concepts/metamodel-system]]) | Third pipeline mode: fetch architectural metamodels from external systems |
| Haikai pipeline | `src/haikai_orchestrator.py` ([[../concepts/haikai-orchestrator]]), `src/haikai_service.py` | spec lifecycle CRUD + workflow chaining |
| Chat | `src/chat/` ([[../concepts/chat-executors]]) | Four executors, common SSE event contract |
| LLM client | `src/llm_client.py` ([[../concepts/llm-client]]) | LangChain wrapper + custom OAuth path; non-chat LLM calls |
| Repo fetch | `src/repo_fetcher.py` ([[../concepts/repo-fetcher]]) | GitHub/GitLab/Bitbucket REST (no clone) |
| AST V1 | `src/ast/` | Mature structural extraction — symbols, calls, diagrams |
| AST V2 | `src/ast/v2/` | Playbook-driven framework detection ([[../concepts/v2-extraction-pipeline]]); 11 phases implemented |
| Dep graph | `src/dep/` ([[../concepts/dep-graph]]) | SQLite projection of a snapshot, commit-SHA-pinned ([[../concepts/depgraph-commit-sha]]) |
| Diagrams | `src/ast/diagram_*.py` ([[../concepts/diagram-generation]]) | 8 builders × 4 serialisers (Mermaid/PlantUML/Graphviz/JSON) |
| Refactoring | `src/refactoring/` | change_detector, rename_engine, staleness ([[../concepts/refactoring-engines]]) |
| Job queue | `src/job_queue/` ([[../concepts/job-queue]]) | SQLite-backed async jobs for orchestrations + long pipeline runs |
| Chunking | `src/chunking/` ([[../concepts/chunking]]) | File-aware splitting before LLM calls |

## Key project rules

- [[../decisions/never-add-framework-patterns-to-ast]] — the load-bearing AST/LLM responsibility split.
- [[../decisions/structural-first-in-discovery]] — discovery reads structural store first, source last.
- [[../decisions/use-claude-proxy]] — LLM via local proxy, explicit config only, no fallbacks.
- [[../decisions/windows-first-compatibility]] — Windows is the primary dev platform; no `/dev/null`.
- [[../concepts/haikai-sdd]] — every feature follows shape-spec → write-spec → tasks → implement.

## Comparable tools (external)

- [[gitnexus]] — third-party graph-extraction tool used as benchmark baseline. Different shape: in-memory pipeline, no HTTP route abstraction, scaling cliff at ~6,500 files.

## Sources

- [[../../raw/2026-05-04_codebase-walk]]
- `README.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md`
