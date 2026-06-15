# Enabling Kiro CLI for Standards Extractor

## Overview

This document covers how to use Kiro CLI (or the Kiro IDE) instead of
Claude Code with the Standards Extractor. There are two distinct use cases:

1. **As a chat / orchestration executor** — the Standards Extractor API uses
   `kiro-cli` as its backend for conversational spec-driven development
   (`/api/v1/shape-spec/stream`, etc.) and for non-interactive Haikai
   commands (`write-spec`, `create-tasks`, `implement-tasks`).
2. **As your development tool** — using Kiro CLI or the Kiro IDE to develop
   and maintain this codebase (replaces Claude Code for daily coding).

---

## Part 1: Kiro CLI as API Backend

### How it works

The API has a pluggable executor system. Two factory helpers in
`src/api/__init__.py` decide which CLI to spawn:

```
ClaudeChatExecutor  →  uses `claude` CLI subprocess
OAuthChatExecutor   →  uses Anthropic OAuth directly
OpenAIChatExecutor  →  uses OpenAI / Azure API directly
KiroChatExecutor    →  uses `kiro-cli` CLI subprocess  ← NEW

ClaudeCLIExecutor   →  uses `claude` CLI for batch commands
KiroCLIExecutor     →  uses `kiro-cli` for batch commands  ← NEW
```

`KiroChatExecutor` (`src/chat/kiro_chat_executor.py`) is a drop-in replacement
for `ClaudeChatExecutor`. `KiroCLIExecutor` (`src/kiro_cli_executor.py`) is a
drop-in replacement for `ClaudeCLIExecutor`. Both:

- Spawn `kiro-cli chat --no-interactive --trust-all-tools --wrap never`
- Strip ANSI escape codes from output
- Parse tool invocations, file writes, questions, and spec folders from raw text
- Manage sessions via `--resume` (per-directory, auto-saved by Kiro CLI)
- Copy Haikai profile commands into `.kiro/skills/` in the project workspace

### Activation

#### Option 1 — explicit (environment variable)

```bash
export CHAT_EXECUTOR=kiro
python -m src.entrypoints.run_api
```

Or in `.env.local`:

```
CHAT_EXECUTOR=kiro
```

#### Option 2 — automatic fallback

If `claude` is **not** in `PATH` but `kiro-cli` is, the factory auto-selects
`KiroChatExecutor` / `KiroCLIExecutor`.

### Prerequisites

```bash
kiro-cli --version
kiro-cli doctor --all
```

- SSO login completed (Pro license; use your AWS SSO start URL)
- `~/.local/bin` in `PATH` (default install location)

### Quick test

```bash
CHAT_EXECUTOR=kiro python -m src.entrypoints.run_api
```

Hit the shape-spec endpoint:

```bash
curl -X POST http://localhost:8000/api/v1/shape-spec/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer changeit" \
  -d '{
    "company": "test",
    "project": "demo",
    "message": "I need a login page",
    "session_mode": "new"
  }'
```

### Differences from Claude CLI

| Aspect             | Claude CLI                              | Kiro CLI                                       |
| ------------------ | --------------------------------------- | ---------------------------------------------- |
| Output format      | `--output-format stream-json` (NDJSON)  | Raw ANSI text (stripped + parsed)              |
| Session management | `--session-id UUID` / `--resume UUID`   | Per-directory, `--resume` (most recent)        |
| Permissions        | `--dangerously-skip-permissions`        | `--no-interactive --trust-all-tools`           |
| Auth               | `ANTHROPIC_API_KEY` (or proxy)          | AWS SSO (Pro license)                          |
| Skills / commands  | `.claude/commands/*.md`                 | `.kiro/skills/*/SKILL.md` (auto-created)       |
| Model              | Anthropic API (or proxy → Bedrock)      | Kiro's built-in model routing                  |
| Root user          | works                                   | refused; `install.sh --force` to allow         |
| Line wrapping      | n/a                                     | `--wrap never`                                 |

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   API Layer (FastAPI)                   │
│                                                         │
│  _build_chat_executor() / _build_cli_executor()         │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Priority:                                        │   │
│  │ 0. Kiro*Executor    (CHAT_EXECUTOR=kiro)         │   │
│  │ 1. ClaudeChatExecutor (OAuth / Claude available) │   │
│  │ 2. Kiro*Executor    (kiro-cli in PATH)           │   │
│  │ 3. OpenAIChatExecutor (OPENAI_API_KEY set)       │   │
│  │ 4. ClaudeChatExecutor (last resort)              │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         │                              │
    ┌────▼────────────┐          ┌──────▼──────────────┐
    │ KiroChatExecutor│          │ KiroCLIExecutor     │
    │ (streaming chat)│          │ (orchestration)     │
    └────┬────────────┘          └──────┬──────────────┘
         │                              │
    ┌────▼──────────────────────────────▼──┐
    │           kiro-cli binary            │
    │  --no-interactive --trust-all-tools  │
    │  --wrap never                        │
    │                                      │
    │  Auth: SSO (pre-authenticated)       │
    │  Skills: .kiro/skills/ (auto-loaded) │
    │  Sessions: per-directory, --resume   │
    └──────────────────────────────────────┘
```

### How the streaming chat parser works

1. Build CLI args: `kiro-cli chat --no-interactive --trust-all-tools --wrap never <prompt>`
2. Run as subprocess with `stdout=PIPE`
3. Read line-by-line, strip ANSI escape codes
4. Pattern-match for:
   - Tool invocations (`I will run the following command: X (using tool: Y)`)
   - File modifications (`Created/Wrote/Updated file.ext`)
   - Spec folder references (`haikai/specs/<name>/...`)
   - Question patterns (numbered lists, markdown lists)
5. Yield events matching the standard interface:
   `content`, `skill_invoked`, `file_modified`, `questions`, `folder`, `error`

The non-interactive `KiroCLIExecutor` is simpler — it `subprocess.run`s the
same command, waits for completion, and returns
`{success, return_code, stdout, stderr, execution_time}` with ANSI stripped.

### Skill setup

On initialization, both executors copy Haikai command templates from
`haikai-profiles/default/commands/` into `.kiro/skills/haikai/` in the
project workspace. This is what makes `kiro-cli` aware of `/write-spec`,
`/create-tasks`, etc. Template `{{...}}` references are resolved at copy time
(same logic as the Claude CLI executor).

### Known limitations

- **No structured JSON streaming.** Output is parsed from raw text, which is
  less reliable than Claude CLI's `stream-json` mode.
- **Question detection is regex-based**, matching the `/ask-questions` output
  format. New question shapes require parser updates.
- **File modification detection is heuristic** — looks for
  `Created/Wrote/Updated` patterns.
- **Session resume depends on the working directory.** Run from the same dir
  to pick up the right session.
- **No partial token streaming.** Kiro CLI emits complete lines, so streaming
  granularity is coarser than Claude's `--include-partial-messages`.
- **Tool detection is heuristic.** Without structured events, edge cases may be
  missed.
- **No OAuth token / API key.** `anthropic_api_key` is accepted for interface
  compatibility but ignored — Kiro uses SSO.

---

## Part 2: Using Kiro for Development (replacing Claude Code)

### Two Kiro interfaces

| Interface | Where                      | Purpose                                            |
| --------- | -------------------------- | -------------------------------------------------- |
| Kiro IDE  | Windows (VS Code extension)| Visual editing, specs, steering, hooks, MCP        |
| Kiro CLI  | WSL / Linux / macOS        | Headless / batch work, CI, autonomous iteration    |

Both share the same `.kiro/` configuration when pointed at the same workspace.

### What Kiro IDE provides (that Claude Code doesn't)

| Feature                           | Benefit                                                                |
| --------------------------------- | ---------------------------------------------------------------------- |
| Specs (`.kiro/specs/`)            | Structured requirements → design → tasks workflow                      |
| Steering (`.kiro/steering/`)      | Always-on context rules (like CLAUDE.md, with conditional inclusion)   |
| Skills (`.kiro/skills/`)          | On-demand progressive context loading                                  |
| Hooks (`.kiro/hooks/`)            | Event-driven automation (lint on save, test on edit)                   |
| MCP servers (`.kiro/settings/mcp.json`) | Tool integrations                                                |

### What you lose vs Claude Code

| Feature                        | Workaround                                                           |
| ------------------------------ | -------------------------------------------------------------------- |
| `--resume` / `--continue` flags| Kiro CLI: `kiro-cli chat --resume` or `--resume-picker`              |
| `CLAUDE.md` auto-loading       | Migrate to `.kiro/steering/`                                         |
| `--output-format json`         | Not available; use Kiro IDE for visual feedback                      |
| Permission hooks with `modify` | Kiro `preToolUse` hooks can block but not modify params              |

### Daily workflow

```
┌─────────────────────────────────────────────────────────┐
│  Kiro IDE (Windows)                                     │
│  • Edit code visually                                   │
│  • Create / run specs                                   │
│  • Use steering for context                             │
│  • Chat with agent (built-in model via Pro license)     │
└─────────────────────────────────────────────────────────┘
         │  Same .kiro/ config, same workspace
         ▼
┌─────────────────────────────────────────────────────────┐
│  Kiro CLI (WSL / Linux)                                 │
│  • Headless batch operations                            │
│  • CI/CD integration                                    │
│  • Long-running autonomous iteration                    │
│  • Standards Extractor chat executor backend            │
└─────────────────────────────────────────────────────────┘
```

### Running the Standards Extractor with Kiro

#### Development (Kiro IDE)

Open the workspace in Kiro IDE. Steering files auto-load. Use the chat panel
to ask questions, run skills, or create new specs.

#### Server with Kiro CLI backend

```bash
cd <path-to-standards-extractor>
source .venv/bin/activate
export CHAT_EXECUTOR=kiro
python -m src.entrypoints.run_api
```

If you sit behind a corporate proxy, configure `NO_PROXY` for your localhost
and any internal hosts you need to bypass.

#### Tests

```bash
cd <path-to-standards-extractor>
source .venv/bin/activate
python -m pytest tests/ -v
```

---

## Troubleshooting

| Issue                | Cause                              | Fix                                                                  |
| -------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| `kiro-cli not found` | Not in `PATH`                      | Add `~/.local/bin` to `PATH`                                         |
| `dispatch failure`   | SSO expired                        | Re-run `kiro-cli` and complete auth                                  |
| Empty responses      | Session state issue                | `kiro-cli chat --list-sessions` then `--delete-session`              |
| ANSI in output       | `--wrap never` not stripping codes | Adapter handles this; report if you see raw escape sequences         |

---

## File reference

| File                                  | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `src/chat/kiro_chat_executor.py`      | Streaming chat executor (replaces `ClaudeChatExecutor`)  |
| `src/kiro_cli_executor.py`            | Non-interactive executor (replaces `ClaudeCLIExecutor`)  |
| `src/api/__init__.py`                 | `_build_chat_executor()` / `_build_cli_executor()` factories |
| `src/haikai_orchestrator.py`        | Uses chat-executor factory for orchestration steps       |
