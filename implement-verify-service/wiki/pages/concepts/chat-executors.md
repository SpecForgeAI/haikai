# Chat executors

Four backends for the SSE-streaming chat API, dispatched by a single factory. All share a generator contract; differences are in *how* they reach Claude (or another model).

## The four

| Executor | File | Mechanism | When selected |
|---|---|---|---|
| `ClaudeChatExecutor` | `src/chat/claude_chat_executor.py` | Subprocess: spawns the Claude Code CLI with `--output-format stream-json`, parses NDJSON | Default when Claude CLI is available and not running as root |
| `OAuthChatExecutor` | `src/chat/oauth_chat_executor.py` | In-process: Anthropic Python SDK + OAuth-mimicking headers (claude-cli/x.y.z user-agent, claude-code-20250219 beta) | Currently never picked by the factory — `sk-ant-oat` tokens route to ClaudeChatExecutor; the OAuth executor exists for direct use |
| `OpenAIChatExecutor` | `src/chat/openai_chat_executor.py` | In-process: OpenAI SDK | Fallback when Claude CLI unavailable / running as root + `OPENAI_API_KEY` set |
| `KiroChatExecutor` *(planned)* | `src/chat/kiro_chat_executor.py` | Subprocess: Kiro CLI | When `CHAT_PROVIDER=kiro` env var set; spec at `haikai/specs/2026-05-04-kiro-chat-executor/` |

## Shared contract

```python
class ChatExecutor:
    company: str
    project: str
    session_uuid: str          # uuid5(NAMESPACE_DNS, f"{company}_{project}")
    project_dir: Path
    chat_logs_dir: Path

    def stream_message(
        self,
        message: str,
        is_new_session: bool = False,
        command_name: str = "shape-spec",
    ) -> Generator[Dict, None, None]:
        # yields events: content, skill_invoked, file_modified,
        # questions, folder, error, retry, retry_progress, questions_failed
```

Plus session-management methods (`get_session_file`, `restore_session_from_spec`, `persist_session_to_spec`, `clear_session`) that vary in implementation but share intent.

## Factory dispatch

`create_chat_executor()` in `src/api/__init__.py:2103`. Priority:

1. OAuth token (`sk-ant-oat`) → `ClaudeChatExecutor` (OAuth tokens require the Claude CLI, not the SDK path).
2. Running as root → fall through to OpenAI (Claude CLI refuses `--dangerously-skip-permissions` as root).
3. Claude CLI available → `ClaudeChatExecutor` for any Anthropic key.
4. `OPENAI_API_KEY` set → `OpenAIChatExecutor`.
5. Last resort: try `ClaudeChatExecutor` anyway.

The Kiro path inserts ahead of step 1 when `CHAT_PROVIDER=kiro` is set — see `haikai/specs/2026-05-04-kiro-chat-executor/spec.md`.

## Tool surface for in-process executors

`OAuthChatExecutor` runs tools in-process via [[tool-executor]] — Read/Write/Bash/Edit, all workspace-scoped. `ClaudeChatExecutor` doesn't use this; the Claude CLI handles tools internally.

## Two ways Haikai commands are injected

The `/shape-spec`, `/plan-product`, etc. command bodies live as markdown templates with `{{...}}` references at `haikai-profiles/default/commands/<cmd>/single-agent/<cmd>.md`. They reach the LLM by two mechanisms:

| Strategy | Used by | How |
|---|---|---|
| **File-based** | ClaudeChatExecutor | Compiles templates and writes them into project-local `.claude/commands/<cmd>.md`. Claude CLI reads them as slash commands. |
| **Inlined** | OAuthChatExecutor | Compiles templates into a structured system-prompt block (`_build_system_blocks`). |

Both share the same `_resolve_template` logic (currently duplicated; could be extracted if a third executor needs it).

## Why no shared base class

Three implementations with subtle differences are tractable. A base class would force premature consolidation of the `_resolve_template` helper (currently duplicated, OK), the session-persistence model (different per executor — ClaudeChatExecutor uses `~/.claude/projects/...`, OAuthChatExecutor uses a JSON file), and the tool-execution model (Claude CLI runs tools itself; OAuth executor runs them in-process via `ToolExecutor`). Karpathy guideline #2: simplicity first. Three lines beats premature abstraction.

## Cross-references

- Future fourth executor: `haikai/specs/2026-05-04-kiro-chat-executor/spec.md`
- Tool surface for in-proc executors: `src/chat/tool_executor.py`
- Audit logging: `src/chat/audit_logger.py`

## Sources

- `src/chat/claude_chat_executor.py`, `src/chat/oauth_chat_executor.py`, `src/chat/openai_chat_executor.py`
- `src/api/__init__.py:2103` (`create_chat_executor`)
- [[../../raw/2026-05-04_codebase-walk]]
