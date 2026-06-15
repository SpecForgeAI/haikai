# Tool executor

The in-process tool surface used by [[chat-executors]] that don't shell out to a CLI. Lives at `src/chat/tool_executor.py`. Provides `read_file`, `write_to_file`, `bash`, `edit` to LLMs running inside the OAuth path (and similar). Workspace-scoped, recently hardened.

## What it's for

`OAuthChatExecutor` calls the Anthropic SDK directly with `tools=[...]`. When Claude responds with a `tool_use` block, the executor runs the actual tool *in our process* — it's not Claude Code's CLI handling tool execution, it's this module.

`ClaudeChatExecutor` (subprocess to Claude CLI) doesn't use this — Claude CLI runs its own tool loop with its own permissions model. So `ToolExecutor` is the *in-process* equivalent of "what the Claude CLI would do internally", scoped to a single project workspace.

## The 4 tools exposed to the LLM

From `get_tool_schemas()`:

| Tool | What it does |
|---|---|
| `write_to_file` | Create or overwrite a file at `path` with `content`. Creates parent dirs as needed. |
| `read_file` | Read a file at `path`. Hard cap at **1 MB** to prevent OOM (see below). |
| `edit` | String replace in an existing file (`path`, `old_string`, `new_string`). |
| `bash` | Execute a shell command. PowerShell on Windows, `bash -lc` elsewhere. |

All four operate inside `workspace_dir` only.

## The workspace-scope guarantee

Every tool routes its `path` parameter through `_safe_workspace_path(...)` (`tool_executor.py:49-`):

```python
def _safe_workspace_path(self, path: str) -> Path:
    if not isinstance(path, str) or not path:
        raise ValueError("path must be a non-empty string")
    ws = Path(self.workspace_dir).resolve()
    candidate = (ws / path).resolve()
    try:
        candidate.relative_to(ws)
    except ValueError:
        raise ValueError(f"path escapes workspace: {path!r}")
    return candidate
```

Blocks:
- **Absolute paths** that would win the `Path /` join under Python's "absolute right side wins" rule (e.g. `/etc/passwd`).
- **`..` chains** that resolve outside the workspace.
- **Windows drive letters** (`C:\…`) that absolute-path detection wouldn't catch on Linux runs.

This is the same defense pattern that landed in `endpoint_discoverer` (commit `51603da`), `interaction_agent` (`ef93ad7`), and `session_store` ([[chat-sessions-and-audit]]). All three sites delegate to `src/path_safety.py` for the actual segment-safety checks.

## Why 1 MB cap on `read_file`

`tool_executor.py:27-`:

```python
_MAX_READ_BYTES = 1024 * 1024  # 1 MB
"""Hard cap for read_file. The LLM-issued read tool used to call
read_text() with no cap; an LLM prompted to read a sparse file or huge
log could OOM the worker. 1 MB is the cap chosen 2026-05-04: it lands
under GPT-5.4's 272K-token cost cliff (~290K tokens at 3.5 bytes/tok)
and well inside Claude Sonnet 4.6 / Opus 4.7's 1M context, while still
being generous enough that source-code reads almost never trip it."""
```

The cap is set deliberately to avoid blowing the LLM's context cost cliff *and* avoid OOMing the worker on a runaway read. Source-code files are almost always under 1 MB; the cap exclusively trips on log-style content the LLM shouldn't be ingesting wholesale anyway.

## bash is shell-capable on purpose

Per the chat/fetcher hardening spec (`haikai/specs/2026-05-03-chat-and-fetcher-hardening/spec.md`, finding H4):

> The bash tool needs to stay shell-capable (pipes/chains are why the LLM has it). What we change: encoding fix only. Don't try to block metacharacters — that breaks the tool.

The `cwd=workspace_dir` pin is enforced for the entry point, but the LLM can `cd /` mid-command. That's the same trust boundary Claude Code's own `Bash` tool has. **If you want stronger isolation, that's a sandbox spec, not a patch to this file.**

What the spec *did* fix in this file:
- Subprocess `text=True` calls now have `encoding="utf-8", errors="replace"` (was crashing on Windows cp1252).
- `_resolve_path` traversal escapes (H1, H2, H3) closed via `_safe_workspace_path`.

## What it's *not*

- **Not used by `ClaudeChatExecutor`.** That executor shells out; Claude CLI handles tools internally.
- **Not used by [[agentic-discovery]].** Discovery skills run inside chat-executor sessions and use whatever tool surface that executor provides.
- **Not the same as the LangChain tool surface used by [[llm-client]].** Those are non-streaming, strategy-shaped one-shot prompts; this is for multi-turn agent loops.

## Cross-references

- [[chat-executors]] — `OAuthChatExecutor` is the primary consumer
- [[chat-sessions-and-audit]] — same `safe_segment`/`relative_to(workspace)` pattern
- [[api-layer]] — `_safe_project_dir` is the URL-segment cousin of this helper
- Security spec: `haikai/specs/2026-05-03-chat-and-fetcher-hardening/spec.md`

## Sources

- `src/chat/tool_executor.py`
- `src/path_safety.py` (shared safety helpers)
- `haikai/specs/2026-05-03-chat-and-fetcher-hardening/spec.md` (findings H1–H4 + M3)
- [[../../raw/2026-05-04_codebase-walk]]
