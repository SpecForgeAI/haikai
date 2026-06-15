# Codebase Walk — Standards Extractor (snapshot 2026-05-04)

> Synthesis input for the foundation wiki page set. Captures the
> structural shape of the codebase as of branch `main`, commit `899b35e`.

This is *not* a re-statement of `docs/ARCHITECTURE.md`. It's the inputs I
read to write the wiki pages. The pages are the synthesis; this is the
raw view.

## Sources read

- `README.md` — public entry point, CLI + API surface
- `docs/ARCHITECTURE.md` — 27 endpoints, 6 functional groups, component map
- `CLAUDE.md` — load-bearing project instructions:
  - **Bug triage rule** — discovered bugs are stopping points, not follow-ups
  - **AST vs LLM responsibilities** — mechanical extraction vs framework interpretation
  - **Windows compatibility** — never use `/dev/null` (creates literal `nul` file)
  - **LLM Wiki** — this directory; pattern from Karpathy
- `src/ast/v2/STATUS.md` — V2 discovery pipeline status (Phases 1-11 implemented)
- `haikai-profiles/default/commands/discover-endpoints/single-agent/discover-endpoints.md` — the agentic discovery loop in skill form (DOT graph)
- Memory entries: structural-first preference, OAuth wrapper design, LLM proxy default
- Recent commit log:
  - `899b35e` docs(spec): chat-executor and fetcher hardening
  - `014de40` fix(chat): reject path-traversal in session_store
  - `27db3ec` chore(ast): hygiene fixes
  - `42b0e8d` chore(ast/v2): clean up LOW findings
  - `51603da` fix(ast): close LLM-tool sandbox escapes

## Top-level src/ inventory

```
src/
├── api/                    ← FastAPI app + 4 route modules
├── ast/                    ← V1 structural extraction (mature)
│   ├── v2/                 ← V2 playbook-driven extraction (Phases 1-11 ✅)
│   ├── extractors/         ← per-language tree-sitter extractors (8 langs)
│   ├── store.py            ← FileStore: writes _index.txt, _calls.txt, etc.
│   ├── endpoint_discoverer.py    ← agentic loop (V1)
│   ├── interaction_discoverer.py ← agentic loop (V1)
│   └── ...
├── chat/                   ← four chat executors + tool executor + audit
│   ├── claude_chat_executor.py   ← subprocess wraps Claude CLI
│   ├── oauth_chat_executor.py    ← in-proc Anthropic SDK + OAuth tokens
│   ├── openai_chat_executor.py   ← OpenAI SDK fallback
│   └── tool_executor.py    ← Write/Edit/Bash for OAuth path
├── dep/                    ← dependency graph (commit-pinned snapshots)
├── refactoring/            ← change_detector, rename_engine, staleness
├── strategies/             ← analysis strategies (Strategy pattern)
├── chunking/               ← LLM-context chunkers
├── job_queue/              ← SQLite-backed async jobs
├── git/                    ← git_manager subprocess wrapper
├── skills/                 ← (test_coverage subdir; mostly empty)
├── queue/                  ← async queue helpers
├── standards_orchestrator.py     ← top-level pipeline
├── haikai_orchestrator.py      ← Haikai workflow chainer
├── haikai_service.py           ← spec CRUD
├── api_command_executor.py       ← Anthropic SDK wrapper
├── claude_cli_executor.py        ← subprocess wrap (non-chat)
├── llm_client.py                 ← unified LLM client
├── repo_fetcher.py               ← GitHub/Bitbucket clone+fetch
└── file_scanner.py / file_analyzer.py / file_parser.py
```

## Key facts captured for synthesis

- Two AST pipelines coexist: V1 (`src/ast/*`) and V2 (`src/ast/v2/*`). V2 is the active extraction path; STATUS.md says all 11 phases implemented.
- Four chat executors share a generator contract: `stream_message(msg, is_new_session, command_name) → Generator[{"type": ...}]`. Selected by `create_chat_executor` factory in `src/api/__init__.py:2103`.
- Structural store is on-disk flat text files (`_index.txt`, `_calls.txt`, `_imports.txt`, `_inheritance.txt`, `_patterns.txt`, `_stats.txt`) — designed to be cheap for LLMs to grep.
- 8 languages × 17 file extensions. Each extractor implements `LanguageExtractor` with 4 methods.
- 8 diagram builders × 4 serialisers (Mermaid/PlantUML/Graphviz/Metamodel JSON).
- 27 API endpoints across 6 functional groups.
- Haikai profiles at `haikai-profiles/default/` — commands compiled into project-local `.claude/commands/` for the Claude CLI path; compiled into system prompt for the OAuth path.
- Auth: project API uses `STANDARDS_API_KEY` Bearer; LLM layer detects `sk-ant-oat` (OAuth) vs `sk-ant-api` (key) and switches header strategy.

## What CLAUDE.md tells us is load-bearing

1. **AST does mechanical, framework-agnostic extraction.** Symbols, calls, imports, inheritance, assignments, annotations. NEVER add framework-specific patterns. New framework = the LLM already knows it.
2. **LLM does framework interpretation.** `@GetMapping` → REST endpoint. `repository.save()` → DB write. Target table resolution. DTO type resolution.
3. **The agentic discovery loop is hypothesis → probe → assess** with structural store tools. Skill files at `haikai-profiles/default/commands/discover-{endpoints,interactions}/`.
4. **A discovered bug is a stopping point, not a footnote.**
5. **No `/dev/null` on Windows.** It creates a literal `nul` file.

These form the spine of the architectural decisions and concept pages.
