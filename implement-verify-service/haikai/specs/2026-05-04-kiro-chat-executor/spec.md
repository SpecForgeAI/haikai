# Specification: Kiro Chat Executor (additional connector)

## Summary

Add a new chat executor backed by Amazon's **Kiro CLI** as an *additional*
connector alongside the existing `ClaudeChatExecutor`,
`OAuthChatExecutor`, and `OpenAIChatExecutor`. Operators select which
backend to use via an environment/settings switch — no existing executor
is removed, replaced, or modified beyond a single factory dispatch line.

The motivation is to give the operator an alternative billing/identity
path (AWS Builder ID via Kiro) without giving up the current Anthropic
OAuth path (Claude Max/Pro subscription via `sk-ant-oat...`). Both paths
remain available; the choice is per-deployment.

## Goals

| # | Goal |
|---|------|
| G1 | New `src/chat/kiro_chat_executor.py` implementing the same `stream_message` generator contract as the other executors. |
| G2 | Operator can switch the chat backend via a single env var (`CHAT_PROVIDER`) without code changes. |
| G3 | Haikai commands (`/shape-spec`, `/plan-product`, `/write-spec`, `/create-tasks`, `/implement-tasks`, `/ask-questions`) work end-to-end through the Kiro path with the same SSE event shape the API contract already exposes. |
| G4 | Existing behavior is unchanged when `CHAT_PROVIDER` is unset or set to a non-Kiro value. Default = current behavior. |

## Non-goals

- **Not** removing or refactoring `ClaudeChatExecutor`, `OAuthChatExecutor`, or `OpenAIChatExecutor`.
- **Not** migrating the Haikai spec lifecycle to Kiro's native spec workflow. Haikai remains the workflow owner; Kiro is just another runtime.
- **Not** unifying the four executors behind a base class. Three already exist with subtle differences; a fourth doesn't justify the abstraction. (Karpathy guideline #2: simplicity first — three similar lines beats a premature abstraction.)
- **Not** wrapping AWS Builder ID auth ourselves. Kiro CLI handles its own auth via `kiro auth login`. We assume the operator has logged in once on the host.
- **Not** in-process tool calling (the way `OAuthChatExecutor` does it via Anthropic SDK). Kiro is a subprocess; tools execute inside Kiro's own loop.

## Architecture

```
                ┌──────────────────────────────────┐
                │  POST /api/v1/shape-spec/stream  │
                │  (and 5 other chat endpoints)    │
                └──────────────────────────────────┘
                              │
                              ▼
                ┌──────────────────────────────────┐
                │  create_chat_executor(...)       │
                │  src/api/__init__.py:2103        │
                └──────────────────────────────────┘
                              │
        ┌──────────────┬──────┴──────┬──────────────┐
        ▼              ▼             ▼              ▼
   Claude CLI      OAuth SDK      OpenAI         Kiro CLI  ← NEW
   (subproc)      (in-proc)      (in-proc)      (subproc)
        │              │             │              │
        ▼              ▼             ▼              ▼
              All yield the SAME generator events:
              {"type": "content"|"skill_invoked"|
                       "file_modified"|"questions"|
                       "folder"|"error"|"retry"|...}
```

## Components

### 1. `src/chat/kiro_chat_executor.py` (new)

Mirrors `ClaudeChatExecutor`'s public surface. The implementation is
subprocess-based (closer to `ClaudeChatExecutor` than `OAuthChatExecutor`).

| Member | Behavior |
|---|---|
| `__init__(company, project, workspace_dir, anthropic_api_key=None, **kw)` | `anthropic_api_key` accepted but ignored — kept for factory call-site uniformity. Locates `kiro` binary (project-local `node_modules/.bin/kiro` if present, else `shutil.which("kiro")`). Creates project workspace dirs same as ClaudeChatExecutor. |
| `session_uuid` | Deterministic `uuid5(NAMESPACE_DNS, f"{company}_{project}")`, matching the other executors so session_store lookups stay shared. |
| `stream_message(message, is_new_session, command_name)` | Spawns `kiro` as a subprocess (see "Process model" below). Parses Kiro's output stream and yields the same event dicts the other executors yield. |
| `get_session_file()` | Returns the path under Kiro's session storage (TBD — Phase 0 discovery). |
| `restore_session_from_spec()` | Same restore-from-`haikai/specs/<spec>/active_session.json` flow as `ClaudeChatExecutor.restore_session_from_spec`. |
| `persist_session_to_spec(spec_name)` | Same write-active_session-and-copy-jsonl flow. If Kiro's session file format is incompatible with the existing `.jsonl` consumers, we persist as `kiro_session.json` instead and document the shape. |
| `clear_session()` | Deletes Kiro's session dir + chat_logs_dir, same as `ClaudeChatExecutor`. |
| `chat_logs_dir`, `project_dir` | Same paths as the other executors. |

### 2. Factory dispatch in `src/api/__init__.py`

Single dispatch block added at the top of `create_chat_executor` (line
2103). Pseudocode:

```python
chat_provider = os.environ.get("CHAT_PROVIDER", "").lower()

if chat_provider == "kiro":
    from ..chat.kiro_chat_executor import KiroChatExecutor
    if not KiroChatExecutor.is_available():
        logger.warning("CHAT_PROVIDER=kiro but kiro CLI not found; falling through")
    else:
        logger.info("Using KiroChatExecutor (CHAT_PROVIDER=kiro)")
        return KiroChatExecutor(
            company=company, project=project,
            workspace_dir=workspace_dir,
        )
# ...existing logic unchanged below...
```

`CHAT_PROVIDER` accepted values:
- `""` / unset → existing dispatch (no behavior change)
- `kiro` → use Kiro if available, else fall through to existing dispatch
- `claude` / `openai` → reserved (not implemented in this spec; existing logic still wins)

The fall-through-on-missing behavior matches the current OpenAI fallback
shape and avoids 500ing a deployment that has the env var set wrong.

### 3. Configuration surface

Added to `.env.example` and `docs/AUTHENTICATION.md`:

```env
# Chat backend selection (optional)
# - unset / "" : auto-select (Claude CLI > OpenAI fallback)
# - "kiro"     : route chat requests to Kiro CLI (requires `kiro auth login` on host)
CHAT_PROVIDER=

# Kiro-specific (only consulted when CHAT_PROVIDER=kiro)
KIRO_BIN=                # optional path override; default = "kiro" on PATH
KIRO_MODEL=              # optional Kiro model override; default = Kiro's default
```

No `settings.json` for this — env vars are how the rest of the project
configures backends, and consistency wins. (Karpathy #2: don't add
config flexibility that wasn't requested.)

## Process model (Phase 0 → Phase 1)

The exact CLI surface of Kiro is **not yet validated**. This spec treats
the integration as a two-phase build:

**Phase 0 — Discovery (no code).** Validate Kiro's CLI shape on the
target host. Specifically, answer:

| Q | What we need to confirm |
|---|---|
| Q1 | Does `kiro` have a non-interactive `--print` / `--prompt` mode that exits after one turn? |
| Q2 | Does it support session persistence (`--session-id` / `--resume`-style flags)? |
| Q3 | What's its streaming output format? Newline-delimited JSON (matching `--output-format stream-json`)? Plain text? Structured events? |
| Q4 | How are tool/skill invocations surfaced — as JSON events, as text markers, or invisibly? |
| Q5 | Can a system prompt or "steering" file be injected per-invocation, or only via `.kiro/steering/*.md` files in cwd? |
| Q6 | Does it accept slash commands (`/shape-spec ...`) the way Claude CLI does, or does it require a different invocation? |
| Q7 | What auth state must exist on the host (`kiro auth login` once? AWS env vars? Both?) |

Phase 0 deliverable is a short note in `wiki/pages/tools/kiro-cli.md`
that records the answers. **Implementation does not start until Phase 0
is in.**

**Phase 1 — Implementation.** Build the executor against the validated
Phase 0 surface. The most likely shape:

```python
cli_args = [
    self.kiro_path,
    "--print",                     # or whatever the equivalent is
    "--output-format", "stream-json",  # if supported, else parse plain text
    "--cwd", str(self.project_dir),
]
if is_new_session:
    cli_args += ["--new-session", self.session_uuid]
else:
    cli_args += ["--resume", self.session_uuid]
cli_args.append(cli_prompt)  # /shape-spec <message>
```

If Kiro doesn't support stream-json, fall back to capturing plain text
and yielding it as `{"type": "content", "delta": ...}` chunks line by
line. Skill detection (for `/ask-questions`) regresses to text-pattern
matching instead of structured tool_use events — same fallback the
`OAuthChatExecutor` already uses.

## Haikai command bridge

Two strategies, picked in Phase 0 based on what Kiro supports:

**Strategy A (preferred, if Kiro reads steering files):** Reuse the
existing `_setup_claude_commands` template-compilation logic from
`ClaudeChatExecutor` and write the compiled `.md` files into
`.kiro/steering/` (or whatever the Kiro equivalent is) inside the
project workspace. This keeps Haikai as the source of truth and is
analogous to how `ClaudeChatExecutor._setup_claude_commands` plants
files under `.claude/commands/`.

**Strategy B (fallback, if Kiro only accepts a single prompt):** Reuse
the `_build_system_blocks` template-compilation logic from
`OAuthChatExecutor` and inline the compiled command into the user
prompt as a system-context preamble. Equivalent semantically; loses
multi-turn skill recall.

The shared template compiler in
`OAuthChatExecutor._resolve_template` and
`ClaudeChatExecutor._resolve_template` is identical-ish; if we end up
needing it from a third place we extract it to
`src/chat/_template_resolver.py` at that point — not before. (Don't
abstract pre-emptively.)

## Acceptance criteria

| # | Criterion |
|---|---|
| AC1 | `wiki/pages/tools/kiro-cli.md` exists and answers Phase 0 questions Q1–Q7 with concrete CLI examples or "not supported" verdicts. |
| AC2 | `src/chat/kiro_chat_executor.py` exposes `KiroChatExecutor` with the same constructor signature, attribute set, and `stream_message` generator contract as `ClaudeChatExecutor`. |
| AC3 | With `CHAT_PROVIDER=kiro` and a logged-in Kiro install, `POST /api/v1/shape-spec/stream` (new session) emits `session` → `content` → `questions` → `folder` events in the same shape as the Claude path. |
| AC4 | With `CHAT_PROVIDER` unset, the factory dispatch is byte-identical to today (verified by an existing test run; no Claude/OpenAI path tests change behavior). |
| AC5 | With `CHAT_PROVIDER=kiro` and Kiro **not** installed, the factory logs a warning and falls through to the existing dispatch — the API does **not** 500. |
| AC6 | `.env.example` documents `CHAT_PROVIDER`, `KIRO_BIN`, `KIRO_MODEL`. `docs/AUTHENTICATION.md` has a "Kiro CLI backend" section explaining the auth prerequisite (`kiro auth login`). |
| AC7 | New tests under `tests/chat/test_kiro_chat_executor.py` cover: (a) factory routes to Kiro when env set, (b) factory falls through when Kiro missing, (c) `stream_message` parses Kiro's output format into the contract events (mocked subprocess). |
| AC8 | Existing chat tests (`test_shapespec_sse_askquestions.py`, `test_plan_product_sse.py`, `test_oauth_llm_client.py`, `test_session_persistence.py`) all still pass with `CHAT_PROVIDER` unset. |

## Out of scope

- **Migrating Haikai to Kiro's native spec workflow.** Kiro has its
  own requirements/design/tasks lifecycle; we deliberately do not adopt
  it. Haikai stays.
- **Sharing session storage between Claude and Kiro.** Each backend
  keeps its own session files; switching `CHAT_PROVIDER` mid-project
  starts a fresh session for the new backend. Documented, not bridged.
- **Wrapping `kiro auth login`.** Operator runs it once. We do not embed
  AWS Builder ID OAuth in this codebase.
- **Cost telemetry / billing attribution.** No per-message cost reporting
  for either backend.
- **Auto-fallback Claude→Kiro on Anthropic 429.** Could be useful, but
  it's a separate failover spec.
- **Comparison harness (Claude vs Kiro response quality on the same
  Haikai prompts).** Worth doing later as a benchmark; not part of
  this connector.

## Open questions

| # | Question | Why it matters | Resolution path |
|---|----------|----------------|-----------------|
| OQ1 | Does Kiro CLI have a `--print` / non-interactive mode? | If not, the whole subprocess approach is wrong — would need MCP server or REPL pty. | Phase 0 Q1. |
| OQ2 | Does Kiro emit a stream-json analogue? | Determines whether skill detection is structured (`tool_use` events) or text-pattern (`/ask-questions` regex). | Phase 0 Q3, Q4. |
| OQ3 | Is `CHAT_PROVIDER` the right knob, or should the OAuth-token check (`sk-ant-oat`) explicitly mean "claude path" while a separate `KIRO_ENABLED=1` activates Kiro? | Affects whether OAuth + Kiro can coexist or are mutually exclusive. | Decide before Phase 1 starts; default this spec assumes the simple `CHAT_PROVIDER` knob. |
| OQ4 | Should `is_available()` shell out to `kiro --version` at import time, or lazily at factory time? | Lazy is safer (no startup cost, no failure on hosts without Kiro); pick lazy. | Resolved here: lazy. |
| OQ5 | Does Kiro's session model survive across container restarts the way Claude CLI's `~/.claude/projects/<encoded-path>/<uuid>.jsonl` does? | Determines whether `persist_session_to_spec` / `restore_session_from_spec` need different logic. | Phase 0 Q2. |

## References

- Existing executors:
  - `src/chat/claude_chat_executor.py` — subprocess + stream-json reference implementation
  - `src/chat/oauth_chat_executor.py` — in-proc Anthropic SDK + template compiler reference
  - `src/chat/openai_chat_executor.py` — in-proc HTTP fallback shape
- Factory: `src/api/__init__.py:2103` (`create_chat_executor`)
- Project conventions on adding a backend: this spec is the first non-Anthropic, non-OpenAI backend, so this spec itself is the precedent.
- Kiro CLI: https://kiro.dev (validate exact CLI surface in Phase 0; do not hardcode flag names from this URL into code without confirmation).
