# Haikai SDD lifecycle

Spec-driven development as **the** workflow for new features in this project.

## The lifecycle

```
shape-spec  →  write-spec  →  create-tasks  →  implement-tasks
   │              │               │                 │
   │              │               │                 ▼
   │              │               │          verification-report.md
   │              │               ▼
   │              │          tasks.md
   │              ▼
   │       spec.md
   ▼
planning/requirements.md
```

Each step is a slash command (skill) defined under `haikai-profiles/default/commands/<cmd>/single-agent/<cmd>.md`.

## Per-spec folder layout

```
haikai/specs/<YYYY-MM-DD>-<slug>/
├── planning/
│   ├── requirements.md      ← shape-spec output (clarifying Q&A → reqs)
│   └── decisions.md         ← (optional) explicit decision log
├── spec.md                   ← write-spec output (the design)
├── tasks.md                  ← create-tasks output (work breakdown)
├── verification-report.md    ← implement-tasks output
└── active_session.json       ← Claude CLI session pointer for resumption
```

## How each step runs

| Step | Skill | API endpoint | Implementation |
|---|---|---|---|
| `shape-spec` | `/shape-spec` | `POST /api/v1/shape-spec/stream` (SSE) | Streaming chat: LLM asks clarifying questions via `/ask-questions`, writes `planning/requirements.md` |
| `write-spec` | `/write-spec` | `POST /api/v1/specs/{co}/{proj}/write-spec` | Reads requirements + product context, writes `spec.md` |
| `create-tasks` | `/create-tasks` | `POST /api/v1/specs/{co}/{proj}/{spec}/tasks/generate` | Reads spec, writes `tasks.md` (numbered task breakdown) |
| `implement-tasks` | `/implement-tasks` | `POST /api/v1/specs/{co}/{proj}/{spec}/implement` | Iterates tasks, edits code, writes `verification-report.md` |

The full chain can be run via `POST /api/v1/orchestrations` — see [[haikai-orchestrator]] for the chaining logic.

## Why this is project-mandatory

Memory entry: **"User: follows Haikai SDD lifecycle, prefers autonomous execution."** This is the workflow, not a workflow option. The `/shape-spec` step in particular is not skippable — every feature starts with clarifying questions captured in `planning/requirements.md`. Skipping straight to `spec.md` from a one-line goal is treated as a bug to retry against (see `claude_chat_executor.py:620`+ retry logic).

## Profile compilation

Skill markdown files contain `{{...}}` template references that compile at runtime:

- `{{PHASE N: @haikai/commands/path/file.md}}` — inline a child command
- `{{workflows/specification/file}}` — inline from workflows dir
- `{{standards/global/*}}` — inline all matching markdown files
- `{{UNLESS flag}}...{{ENDUNLESS flag}}` — conditional blocks

Two compilation paths:

1. **File-based** (Claude CLI) — `_setup_claude_commands` writes compiled `.md` into project-local `.claude/commands/`.
2. **Inlined** (OAuth SDK) — `_build_system_blocks` compiles into a structured system prompt.

Both share the same `_resolve_template` recursive resolver — see [[chat-executors]].

## Sessions and resumption

See [[chat-sessions-and-audit]] for the full session model. Two UUIDs in play: a deterministic project UUID (`uuid5(NAMESPACE_DNS, f"{company}_{project}")`) and an active-session random UUID. Same company/project always derives the same project UUID — that's what makes sessions resumable across machine restarts, container rebuilds, or git checkouts.

The session `.jsonl` is also copied into the spec folder (`haikai/specs/<spec>/<uuid>.jsonl`) so it can be committed to git and restored on another machine. Logic: `ClaudeChatExecutor.persist_session_to_spec` / `.restore_session_from_spec`.

## Cross-references

- [[chat-executors]] — the runtimes that execute Haikai commands
- [[../decisions/never-add-framework-patterns-to-ast]] — discoverers are *not* part of the SDD lifecycle; they're a separate skill family
- Memory entry: "Haikai SDD workflow, autonomous execution preferred"

## Sources

- `haikai-profiles/default/commands/`
- `src/haikai_orchestrator.py`, `src/haikai_service.py`, `src/api_command_executor.py`
- [[../../raw/2026-05-04_codebase-walk]]
