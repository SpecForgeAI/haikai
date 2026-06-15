# Specification: Modularize `api/__init__.py` + extract `ClaudeChatExecutor.stream_message`

## Summary

Two related Long-Method / Large-Class smells surfaced in
`debug/260518-0633-executor-smell-taxonomy/findings.md`:

- **B3 + C1** — `src/api/__init__.py` is 4529 LOC with 84 callables.
  Every concern (routes, factories, recovery, gates, OAuth detection,
  package builder, registry re-exports) touches the same file → classic
  Divergent Change.
- **B1** — `ClaudeChatExecutor.stream_message` is 773 LOC. A single
  method spans prompt assembly, env setup, subprocess spawn, NDJSON
  streaming, partial-message buffering, tool detection, file-write
  detection, question parsing, session persistence side-effects, and
  error handling.

This spec proposes a **two-phase refactor**, sequenced so each phase
can land independently and roll back cleanly.

The motivation is reviewability: the current files force every PR
reviewer to scroll thousands of lines to verify a small change. Splits
reduce the surface a typical change touches and let future work
parallelize across reviewers.

**Risk:** these are large mechanical refactors with high test-pollution
sensitivity. The CO1 work earlier this session already taught us that
moving symbols breaks `@patch('src.api.X')` mocks that bind by name.
Same risk applies in spades here.

## Goals

| # | Goal |
|---|---|
| G1 | After Phase A, no single file in `src/api/` exceeds **~800 LOC** (down from 4529). |
| G2 | After Phase B, `ClaudeChatExecutor.stream_message` is **≤ 150 LOC** with named sub-methods doing the rest. |
| G3 | Public import surface unchanged: `from src.api import create_chat_executor`, `BACKEND_REGISTRY`, all `@app.*` routes resolve identically. |
| G4 | Regression count unchanged between every commit. `pytest tests/ -q --ignore=tests/manual --ignore=tests/integration` reports the same `passed / skipped / xfailed` totals throughout. |
| G5 | Behaviour unchanged. Same HTTP responses, same SSE event shapes, same session-uuid semantics, same auth gates. |

## Non-goals

- **Not** changing any endpoint contract (URL, request/response shape, status codes).
- **Not** renaming any public symbol exported from `src.api`.
- **Not** touching `KiroChatExecutor.stream_message` (already 217 LOC, acceptable).
- **Not** changing `OAuthChatExecutor` or `OpenAIChatExecutor` (already short).
- **Not** introducing async/await where currently sync, or vice versa.
- **Not** rewriting any parser logic (the question-pattern regexes, the
  partial-message buffer, the tool-invocation detection — all stay
  byte-for-byte identical, just moved into named methods).
- **Not** adding any feature (no new env vars, no new endpoints, no new
  registry entries).
- **Not** introducing `ChatExecutorContext` dataclass (B4/B5) — deferred
  to a separate spec when a third chat backend is actually being added.

## Architecture (target state)

### Phase A — Modularize `src/api/`

```
src/api/
├── __init__.py             ~600 LOC  (re-exports + app + lifespan + recovery glue)
├── factories.py            ~250 LOC  (create_chat_executor, _build_claude_chat_executor,
│                                       imports from src.backend_registry)
├── gates.py                ~50 LOC   (_credentials_satisfied delegation,
│                                       missing-API-key 503 helpers)
├── recovery.py             ~150 LOC  (_recover_interrupted_jobs)
├── packages.py             ~250 LOC  (implementation-package endpoints,
│                                       backend-aware artifact rendering)
└── routes/
    ├── __init__.py          empty
    ├── orchestration.py    ~600 LOC  (POST /api/v1/orchestrations,
    │                                   v2 endpoints, jobs, logs/status)
    ├── chat.py             ~700 LOC  (shape-spec, plan-product,
    │                                   story-component-anchor, analyze-repo,
    │                                   v2 variants)
    ├── jobs.py             ~300 LOC  (POST /api/v1/jobs/*, list, cancel)
    ├── standards.py        ~300 LOC  (metamodels, product/global standards)
    └── specs.py            ~300 LOC  (CRUD on specs)
```

Each route module: defines its `APIRouter()`, registers handlers, gets
mounted onto `app` in `src/api/__init__.py`. Recovery + factories +
gates + packages get a similar module-level treatment.

`src/api/__init__.py` stays as the public surface — re-exports everything
that callers currently import from `src.api`, mounts all routers, owns
the FastAPI app instance and lifespan handler.

### Phase B — Extract `ClaudeChatExecutor.stream_message`

```
class ClaudeChatExecutor:
    def stream_message(self, message, is_new_session, command_name):
        prompt = self._build_streaming_prompt(message, is_new_session, command_name)
        cmd = self._build_cli_command(prompt)
        with self._spawn_cli(cmd) as proc:
            yield from self._stream_events(proc, command_name)

    def _build_streaming_prompt(self, message, is_new_session, command_name) -> str: ...
    def _build_cli_command(self, prompt) -> list[str]: ...
    def _spawn_cli(self, cmd): ...                                  # contextmanager
    def _stream_events(self, proc, command_name):                    # generator
        for line in self._read_stream_lines(proc):
            yield from self._handle_stream_line(line, command_name)
    def _read_stream_lines(self, proc): ...                          # generator
    def _handle_stream_line(self, line, command_name): ...           # generator
    def _parse_tool_invocation(self, payload) -> Optional[dict]: ...
    def _parse_file_modification(self, payload) -> Optional[dict]: ...
    def _parse_partial_message(self, payload) -> Optional[dict]: ...
    def _detect_question_block(self, content_buffer) -> list[dict]: ...
    def _persist_session_on_complete(self, command_name): ...
```

Each extracted method should be **strictly internal** (underscore
prefix), single-responsibility, and reachable only from
`stream_message` or its descendants.

The only public-surface change: `stream_message` itself stays public.
No other helper becomes public.

## Phase ordering

| # | Phase | Land before | Rationale |
|---|---|---|---|
| A.1 | Move `factories.py` + update imports | A.2 | Other route modules need to import from it. |
| A.2 | Move `gates.py` + update 3 gate-site imports | A.3 | Quick win, small surface. |
| A.3 | Move `recovery.py` | A.4 | Self-contained. Test pollution risk if mocks bind by name. |
| A.4 | Move `packages.py` + 2 package endpoints | A.5 | Self-contained. |
| A.5 | Move `routes/orchestration.py` | A.6 | Largest route module first; review feedback can shape the rest. |
| A.6 | Move `routes/chat.py`, `routes/jobs.py`, `routes/standards.py`, `routes/specs.py` (one PR each) | — | Each module's own PR; ~250–700 LOC per. |
| **A done** | | | |
| B.1 | Extract `_build_streaming_prompt` + `_build_cli_command` | B.2 | Pure functions, easy unit-testable. |
| B.2 | Extract `_spawn_cli` (contextmanager) | B.3 | Owns subprocess lifecycle. |
| B.3 | Extract stream-line parsing helpers | — | The bulk of the LOC. |

Each step: regression must stay at the same `passed/skipped/xfailed`
totals. Test churn from binding-name patches handled per CO1 lesson —
update `@patch('src.api.X')` to point at the new home, or to the call
site, whichever is more stable.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | `@patch('src.api.X')` and `@patch('src.api.routes.chat.X')` are different patch targets; tests bound to the old name break. | Audit every `@patch` referencing `src.api.*` before each PR. Document the rule in `tests/CONVENTIONS.md`. |
| R2 | Module-load order changes break circular-import behaviour. The current order is "everything in one file"; splitting may surface ordering bugs that were latent. | Run regression after every commit. Use lazy imports where modules form a cycle (we've already done this for `haikai_orchestrator → api`). |
| R3 | Route ordering matters in FastAPI — `app.include_router()` in the wrong order can change which route matches a path. | Verify a smoke test of `/api/v1/...` endpoints after each `routes/*.py` extraction. |
| R4 | `stream_message` extraction risks subtle behavior change in NDJSON buffering / partial-message handling. Currently the integration tests catch most of this; unit tests for each new helper would catch more. | Add `tests/chat/test_claude_chat_executor_stream_helpers.py` BEFORE extracting; assert each helper's contract independently. Mandatory for B.3 (the biggest chunk). |
| R5 | Reviewers can't fit a 1000-LOC PR in their head. | Each Phase-A step is one PR ≤ ~700 LOC; Phase-B steps are smaller still. No mega-PRs. |

## Success criteria

- **G4 verified at every commit:** regression unchanged (`1232 passed,
  33 skipped, 2 xfailed` as of today's main, modulo any new tests
  added alongside).
- **G1 verified after Phase A:** `wc -l src/api/**/*.py | sort -n` —
  no file > ~800 LOC.
- **G2 verified after Phase B:** the `stream_message` body is ≤ 150
  LOC by `ast.unparse` count.
- **G3 verified after every commit:** `grep -rn "from src.api import"
  src/ tests/ | wc -l` count unchanged.

## Out-of-scope (revisit later)

| # | Smell | Why deferred |
|---|---|---|
| B2 | 5 endpoint handlers > 100 LOC | Address as a shared `StreamingChatEndpoint` factory in a separate spec — needs API design review. |
| B4 + B5 | Data clump `(company, project, workspace_dir, anthropic_api_key)` | Defer to when a third chat backend is being added; the clump only bites then. |
| C2 | Shotgun Surgery to add a new endpoint | Same as B2 — the same `StreamingChatEndpoint` factory addresses this. |
| O2 | OpenAI ctor diverges | Already hidden inside `_build_claude_chat_executor`; caller-facing surface is uniform. |
| D5 | Lazy Class Protocols | Earn their keep when mypy lands in CI — separate spec for CI setup. |
| CO3 | Feature Envy on package builder | Small. Bundle with Phase A.4 (packages.py) if the move makes it natural. |

## Sequencing recommendation

Don't start Phase B until Phase A is fully merged and stable on `main`.
A.1 alone is a useful proving ground for the patch-naming + import-cycle
lessons. If A.1 lands cleanly with no regression and no test churn, the
rest of A is mechanical. B is structurally simpler (single file) but
the test surface is heavier (every chat-stream integration test exercises
it).
