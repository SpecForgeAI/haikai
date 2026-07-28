"""
Claude Chat Executor for Conversational API.

This module provides a wrapper around the Claude Code CLI to enable
conversational, streaming interactions with full Haikai skills access.
"""

import subprocess
import json
import logging
import platform
import uuid
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Dict, Any, Generator, List, Tuple
from datetime import datetime

from . import rate_limit_backoff
from .cli_limits import MAX_CLI_ARG_LENGTH
from .profiles_path import HAIKAI_PROFILES_ROOT
from .tool_executor import ToolExecutor

logger = logging.getLogger(__name__)


# CLI-content patterns that indicate a non-streamed CLI error landed inside
# the assistant content channel (e.g. "Failed to authenticate. API Error: 401...").
# Promoted to a module-level tuple so unit tests can assert against the same set.
_CLI_ERROR_PATTERNS: Tuple[str, ...] = (
    "Failed to authenticate",
    "API Error:",
    "authentication_error",
    "invalid_api_key",
    "permission_error",
    "rate_limit_error",
    "overloaded_error",
)

# Substrings inside an error message that mean "this is not transient — retrying
# is futile" (auth / config / invalid key). Sets state.is_fatal_error so the
# retry loop skips the nudge logic and goes straight to /explain-failure.
_FATAL_ERROR_HINTS: Tuple[str, ...] = ("authenticate", "invalid", "authentication_error")

# Commands the orchestrator runs non-interactively: they never invoke the
# /ask-questions skill, so they must skip the shape-spec question/folder recovery
# retries in stream_message(). Without this, /git-commit-preparation -- which
# produces neither questions nor a spec folder -- burns `max_retries` CLI spawns
# and logs a misleading "failed to produce questions or folder" error (the other
# three only avoid it incidentally by writing a spec folder). Mirrors the command
# names in HaikaiOrchestrator.COMMANDS; a guard test keeps the two in sync.
_NON_INTERACTIVE_COMMANDS = frozenset({
    "write-spec",
    "create-tasks",
    "implement-tasks",
    "git-commit-preparation",
})


def _uses_question_flow(command_name: str) -> bool:
    """True when a command may use the /ask-questions question/folder flow.

    False for the non-interactive orchestration commands, which never ask
    questions and so must not trigger the question/folder recovery retries.
    """
    return command_name not in _NON_INTERACTIVE_COMMANDS

# Deterministic rate-limit (HTTP 429) backoff for the agentic CLI lane. The Claude CLI
# swallows 429s inside its own internal HTTP retries and emits NOTHING to stdout/stderr —
# so the executor can't see them; the call just hangs until killed (exit 143). Instead we
# probe the Anthropic Messages API directly (a 429 returns in <1s) and back off
# before spawning. See debug 260615 (a raw probe returned 429 in 0.48s). The
# backoff schedule/budget/signal now lives in `rate_limit_backoff` (shared with
# the SDK lane); only the probe model is local.
_RATE_LIMIT_PROBE_MODEL = "claude-sonnet-4-5"


@dataclass
class _StreamLoopState:
    """Mutable buffers shared by the three stream loops in `stream_message`
    (main + question-retry + resume-retry) and the reason-probe.

    Passed by reference to every per-event dispatcher so they can
    accumulate findings (detected spec folder, CLI errors, whether the
    `/ask-questions` skill has been invoked, partial question text)
    without returning out-params.

    Fields:
      folder_buffer: spec slug detected from `haikai/specs/<slug>` in
        text or Write-tool paths; first detection wins.
      cli_errors: every error message yielded to the client this run.
      is_fatal_error: True when an error pattern indicates an
        unrecoverable subprocess failure (e.g. auth) rather than a
        transient one — short-circuits some retry decisions.
      is_collecting_questions: True once `/ask-questions` has been
        invoked; further assistant text is appended to
        `ask_questions_content` instead of yielded as content.
      ask_questions_content: the running buffer of question text to be
        parsed by `chat/question_parser.py` after the stream completes.
    """
    folder_buffer: Optional[str] = None
    cli_errors: List[str] = field(default_factory=list)
    is_fatal_error: bool = False
    is_collecting_questions: bool = False
    ask_questions_content: List[str] = field(default_factory=list)


class ClaudeChatExecutor:
    """
    Wrapper class for executing conversational Claude Code CLI commands with streaming.
    
    This class provides a streaming interface for conversational interactions
    with Claude Code, maintaining session persistence and providing access to
    all Haikai skills.
    """
    
    def __init__(self, company: str, project: str, workspace_dir: Path, anthropic_api_key: str,
                 session_uuid: Optional[str] = None,
                 extra_dirs: Optional[List[Path]] = None):
        """
        Initialize the Claude Chat executor.

        Args:
            company: Company name for session identification
            project: Project name for session identification
            workspace_dir: Base workspace directory (e.g., /home/ubuntu/api_workspace)
            anthropic_api_key: Anthropic API key for authentication
            session_uuid: Optional explicit session UUID. When None, a
                deterministic v5 UUID is derived from `{company}_{project}`.
                Pass an explicit value to resume a specific session — used
                by recovery paths that load the session id from
                `active_session.json`. Avoids the Temporary Field smell of
                setting `executor.session_uuid = ...` after construction
                (which silently no-ops on backends that don't track
                spec-scoped sessions).
            extra_dirs: Additional directories to mount via Claude's
                ``--add-dir`` flag, beyond the default ``project_dir`` and
                ``haikai-profiles/``. The polyrepo orchestrator passes
                one entry per repo sub-directory of a multi-repo product so
                Claude sees each repo as a distinct context root. ``None``
                or empty list = today's single-mount behaviour.
        """
        # Defense in depth: validate company/project at the executor
        # boundary too. Today the API handlers call create_active_session
        # first (which validates via session_store._safe_segment), but the
        # recovery handler bypasses that path -- and any future caller
        # would inherit an escape if we relied on the upstream guard alone.
        from src.path_safety import safe_segment
        company = safe_segment(company, "company")
        project = safe_segment(project, "project")

        self.company = company
        self.project = project
        # session_uuid: caller-supplied (recovery) OR deterministic v5
        # from (company, project) so the same project gets a stable id.
        session_string = f"{company}_{project}"
        self.session_uuid = session_uuid or str(uuid.uuid5(uuid.NAMESPACE_DNS, session_string))
        self.session_id = session_string  # Keep human-readable ID for logging
        self.anthropic_api_key = anthropic_api_key

        # Polyrepo: additional --add-dir mounts. Normalised to a list of
        # Path objects so the CLI builders can iterate deterministically.
        # An empty list is equivalent to ``None`` — preserves N=1 argv shape.
        self.extra_dirs: List[Path] = [Path(p) for p in (extra_dirs or [])]

        # Setup workspace paths
        self.workspace_dir = workspace_dir
        self.project_dir = workspace_dir / company / project
        self.claude_dir = self.project_dir / ".claude"
        self.sessions_dir = self.claude_dir / "sessions"
        self.chat_logs_dir = self.project_dir / "chat_logs"
        
        # Create directories if they don't exist
        self.project_dir.mkdir(parents=True, exist_ok=True)
        self.claude_dir.mkdir(parents=True, exist_ok=True)
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        self.chat_logs_dir.mkdir(parents=True, exist_ok=True)
        
        # Create project-scoped permissions settings
        self._create_permissions_settings()
        
        # Find Claude CLI installation (project-local first, then global)
        project_root = Path(__file__).parent.parent.parent
        
        # On Windows, use .cmd wrapper; on Unix, use the shell script
        if platform.system() == "Windows":
            local_cli_path = project_root / "node_modules" / ".bin" / "claude.cmd"
        else:
            local_cli_path = project_root / "node_modules" / ".bin" / "claude"
        
        # Check project-local first, then fall back to global install
        if local_cli_path.exists():
            self.claude_cli_path = local_cli_path
            logger.info(f"Using project-local Claude CLI: {self.claude_cli_path}")
        else:
            # Try to find globally installed Claude CLI on PATH.
            # The pre-fix code hardcoded "/tmp/claude-wrapper.sh" with a
            # dead `if global_cli:` check (always truthy) — Windows and
            # any non-container deployment got an invalid path that only
            # failed at first subprocess call. See D9' in pass-2 findings.
            import shutil
            global_cli = shutil.which("claude")
            if global_cli:
                self.claude_cli_path = Path(global_cli)
                logger.info(f"Using global Claude CLI: {self.claude_cli_path}")
            else:
                raise ValueError(
                    f"Claude CLI not found. Checked project-local path ({local_cli_path}) "
                    f"and global PATH. Please install with 'npm install' or 'npm install -g @anthropic-ai/claude-code'."
                )
        
        # Setup Haikai commands
        self._setup_claude_commands(project_root)
        
        # Initialize tool executor for handling Write/Bash tools
        # Claude CLI --print mode may not execute tools, so we handle them manually
        self.tool_executor = ToolExecutor(self.project_dir)
        
        logger.info(f"Initialized ClaudeChatExecutor for {self.session_id}")
        logger.info(f"  Session UUID: {self.session_uuid}")
        logger.info(f"  Project dir: {self.project_dir}")
        logger.info(f"  Sessions dir: {self.sessions_dir}")
        logger.info(f"  Chat logs dir: {self.chat_logs_dir}")
    
    def _create_permissions_settings(self):
        """
        Create project-scoped permissions settings file.
        
        This creates a .claude/settings.json file in the project directory
        that allows Write, Edit, and Bash operations only within the project.
        This is safer than --dangerously-skip-permissions which gives unrestricted access.
        """
        settings_file = self.claude_dir / "settings.json"
        
        # Only create if it doesn't exist (don't overwrite user customizations)
        if not settings_file.exists():
            settings = {
                "permissions": {
                    "allow": [
                        "Write(./**)",      # Allow writing to all files in project and subdirs
                        "Edit(./**)",       # Allow editing all files in project and subdirs
                        "Bash(*)",          # Allow all bash commands
                        "Read(./**)",       # Allow reading all files in project and subdirs
                        "Glob(./**)",       # Allow glob patterns in project and subdirs
                        "WebFetch(*)",      # Allow all web fetching
                        "TodoWrite(./**)",  # Allow todo operations in project
                        "TaskOutput(./**)", # Allow task output in project
                    ]
                }
            }
            
            try:
                with open(settings_file, 'w') as f:
                    json.dump(settings, f, indent=2)
                logger.info(f"Created project-scoped permissions: {settings_file}")
            except Exception as e:
                logger.warning(f"Failed to create permissions settings: {e}")
    
    def _setup_claude_commands(self, project_root: Path):
        """
        Setup Haikai commands by copying them to Claude's commands directory.
        
        Args:
            project_root: Path to the project root directory
        """
        import shutil
        import os
        
        # Use project-specific commands directory instead of user home
        # This ensures commands are isolated per project and work with cwd=project_dir
        claude_commands_dir = self.claude_dir / "commands"
        haikai_profiles_root = project_root / "haikai-profiles" / "default"
        haikai_commands = haikai_profiles_root / "commands"
        
        # Create Claude commands directory if it doesn't exist
        claude_commands_dir.mkdir(parents=True, exist_ok=True)
        
        # List of commands to setup
        commands_to_setup = [
            ("write-spec", "write-spec/single-agent/write-spec.md"),
            ("create-tasks", "create-tasks/single-agent/create-tasks.md"),
            ("implement-tasks", "implement-tasks/single-agent/implement-tasks.md"),
            ("shape-spec", "shape-spec/single-agent/shape-spec.md"),
            ("plan-product", "plan-product/single-agent/plan-product.md"),
            ("ask-questions", "ask-questions/single-agent/ask-questions.md"),
            ("story-component-anchor", "story-component-anchor/single-agent/story-component-anchor.md"),
            ("analyze-repo", "analyze-repo/single-agent/analyze-repo.md"),
        ]
        
        logger.debug(f"Setting up Haikai commands in {claude_commands_dir}")
        
        for command_name, source_path in commands_to_setup:
            source_file = haikai_commands / source_path
            dest_file = claude_commands_dir / f"{command_name}.md"
            
            if source_file.exists():
                try:
                    # Read and resolve templates before copying
                    raw_content = source_file.read_text(encoding='utf-8')
                    resolved_content = self._resolve_template(raw_content, haikai_profiles_root)
                    dest_file.write_text(resolved_content, encoding='utf-8')
                    logger.debug(f"  ✓ Compiled and copied /{command_name}")
                except Exception as e:
                    logger.warning(f"  ✗ Failed to copy /{command_name}: {e}")
            else:
                logger.debug(f"  ⊘ Source not found for /{command_name}: {source_file}")
    
    def _resolve_template(self, content: str, profiles_dir: Path, depth: int = 0) -> str:
        """Delegate to the shared resolver (see `src/chat/template_resolver.py`)."""
        from .template_resolver import resolve_template  # lazy
        return resolve_template(content, profiles_dir, depth)

    # ─────────────────────────────────────────────────────────────────────
    # stream_message helpers (Phase B.1 extraction — pure pre-spawn setup)
    # ─────────────────────────────────────────────────────────────────────

    # Re-exposes the shared module-level limit as a class attribute so
    # existing tests (`executor.MAX_CLI_ARG_LENGTH`) and `self.` access
    # keep working. The single source of truth lives in `cli_limits.py`.
    MAX_CLI_ARG_LENGTH = MAX_CLI_ARG_LENGTH

    def _haikai_profiles_path(self) -> Path:
        """Path to `haikai-profiles/` (added to Claude's --add-dir and HAIKAI_PROFILES_PATH).

        Delegates to `HAIKAI_PROFILES_ROOT` — the method shape is
        kept so tests that call `executor._haikai_profiles_path()`
        continue to work.
        """
        return HAIKAI_PROFILES_ROOT

    def _write_message_tempfile(self, message: str) -> Path:
        """Write a large message to a tempfile inside `project_dir` and return its path.

        Uses `mkstemp` (atomic open + O_EXCL) rather than `mktemp` —
        Python documents `mktemp` as insecure because a symlink attack on
        the predicted name between mktemp() and write_text() could
        redirect our write to an arbitrary path. See autoresearch:debug
        260504-1321 finding B4-1.
        """
        import os
        import tempfile
        fd, name = tempfile.mkstemp(
            suffix='.txt',
            prefix='claude_msg_',
            dir=str(self.project_dir),
        )
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                f.write(message)
        except Exception:
            try:
                os.unlink(name)
            except OSError:
                pass
            raise
        path = Path(name)
        logger.info(f"Large message ({len(message)} chars) written to temp file: {path}")
        return path

    def _build_streaming_prompt(
        self,
        message: str,
        is_new_session: bool,
        command_name: str,
    ) -> Tuple[str, Optional[Path]]:
        """Build the LLM-visible prompt and (optionally) a tempfile path.

        Returns `(prompt, message_file)`:
          - `prompt` — what Claude sees as its positional CLI arg. For
            new sessions on Windows the message is augmented with OS
            context; for any new session the prompt is prefixed with
            `/{command_name}` and a reinforcement reminder to invoke
            `/ask-questions`. When the raw message exceeds
            `MAX_CLI_ARG_LENGTH`, the prompt becomes a "Read the
            file ..." instruction pointing at the tempfile.
          - `message_file` — the tempfile path the caller MUST unlink
            after the subprocess exits, or `None` if no tempfile was
            written.

        The tempfile threshold is checked against the **raw message**
        length (before any augmentation), keeping the on-disk-vs-inline
        decision deterministic across platforms.
        """
        # Append OS context to the raw message for new sessions (Windows only)
        if is_new_session:
            if platform.system() == "Windows":
                os_context = """
                [System Context: Running on Windows. Use Windows-compatible commands:
                - Instead of `date +%Y-%m-%d` use `powershell -Command "Get-Date -Format 'yyyy-MM-dd'"`
                - Instead of `mkdir -p` use `mkdir` (PowerShell creates parents automatically)
                - Instead of `ls` use `dir`
                - Instead of `[ -d "path" ]` use `if exist "path\\" (echo exists)`
                - Instead of `cat` use `type`]
                """
                message = message + os_context
                logger.info("Added Windows OS context to message")

        # For large messages, write to a temp file to avoid OS ARG_MAX /
        # Windows 32k command line limit. Threshold checked against the
        # raw (possibly OS-context-augmented) message — matches the
        # pre-refactor inline check exactly.
        message_file: Optional[Path] = None
        if len(message) > self.MAX_CLI_ARG_LENGTH:
            message_file = self._write_message_tempfile(message)
            cli_prompt = f"Read the file {message_file} and follow the instructions within it."
            logger.info(f"Large message ({len(message)} chars) written to temp file, Claude will read it via tool")
        else:
            cli_prompt = message

        if is_new_session:
            if command_name == "shape-spec":
                # Reinforce question-asking — SHAPE-SPEC ONLY (2026-07-28):
                # worktree runs start /write-spec as a fresh session too, and
                # this ask-and-STOP block made the agent write NOTHING
                # (step 1 "silent LLM failure": no spec.md).
                reinforcement = (
                    "\n\n[System: This is a NEW session. You MUST ask clarifying questions "
                    "using the /ask-questions skill and then STOP. Do NOT write requirements.md "
                    "or skip ahead — ask questions first and wait for the user's answers.]"
                )
            else:
                # Artifact commands (write-spec / create-tasks /
                # implement-tasks) resume from the spec's on-disk files —
                # the OPPOSITE reinforcement applies: produce output now.
                reinforcement = (
                    "\n\n[System: This is a NEW session resuming from the spec's on-disk "
                    "artifacts under haikai/specs/. Execute the "
                    f"{command_name} skill fully and WRITE its output files now; "
                    "do not stop to ask clarifying questions.]"
                )
            cli_prompt = f"/{command_name} {cli_prompt}{reinforcement}"
            logger.info(f"New session: prefixed CLI prompt with /{command_name}")

        return cli_prompt, message_file

    def _build_cli_command(self, prompt: str, is_new_session: bool) -> List[str]:
        """Build the Claude CLI argv. Last element is the positional prompt.

        Uses `--session-id` for new sessions, `--resume` to continue existing
        sessions. Mounts the project dir, ``haikai-profiles/``, and any
        polyrepo per-folder mounts (``self.extra_dirs``) as ``--add-dir``
        entries. For a one-repo product ``extra_dirs`` is empty so the argv
        is identical to today's single-repo shape.
        """
        session_flag = "--session-id" if is_new_session else "--resume"
        argv: List[str] = [
            str(self.claude_cli_path),
            "--setting-sources", "project",
            session_flag, self.session_uuid,
            "--add-dir", str(self.project_dir).replace("\\", "/"),
            "--add-dir", str(self._haikai_profiles_path()).replace("\\", "/"),
        ]
        for d in self.extra_dirs:
            argv.extend(["--add-dir", str(d).replace("\\", "/")])
        argv.extend([
            "--dangerously-skip-permissions",
            "--print",
            "--output-format", "stream-json",
            "--include-partial-messages",
            "--verbose",
            prompt,
        ])
        return argv

    def _spawn_subprocess(self, cli_args: List[str]) -> subprocess.Popen:
        """Spawn the Claude CLI subprocess with the project's standard kwargs.

        Single source of truth for cwd / env / stdout / stderr /
        encoding across every spawn (main loop, both retry loops, and
        the reason-probe). Env vars are rebuilt on each call via
        `_build_env_vars()` — see that helper for OAuth-vs-API-key
        routing.

        Returns the live Popen handle. The caller is responsible for
        draining stdout/stderr and waiting on the process.

        Parallel-worktrees D13: the spawn is a TRACKED handle — an optional
        `on_spawn(pid)` callback (set as an attribute by the job runner)
        registers the pid against the job so the owning process can kill
        the tree on cancel. POSIX spawns get their own session so the
        whole group is killable.
        """
        kwargs = dict(
            cwd=str(self.project_dir),
            env=self._build_env_vars(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            encoding='utf-8',
            errors='replace',
        )
        if subprocess.os.name == "posix":
            kwargs["start_new_session"] = True
        proc = subprocess.Popen(cli_args, **kwargs)
        on_spawn = getattr(self, "on_spawn", None)
        if on_spawn:
            try:
                on_spawn(proc.pid)
            except Exception:
                logger.warning("on_spawn callback failed", exc_info=True)
        return proc

    def _build_env_vars(self) -> Dict[str, str]:
        """Build subprocess env. OAuth tokens (sk-ant-oat...) use
        CLAUDE_CODE_OAUTH_TOKEN + empty ANTHROPIC_API_KEY (Bearer + oauth
        beta); regular API keys use ANTHROPIC_API_KEY (x-api-key header).
        HAIKAI_PROFILES_PATH is set to `haikai-profiles/` unless the
        caller already provided one.
        """
        is_oauth = "sk-ant-oat" in self.anthropic_api_key
        if is_oauth:
            env_vars = {
                **subprocess.os.environ,
                "CLAUDE_CODE_OAUTH_TOKEN": self.anthropic_api_key,
                "ANTHROPIC_API_KEY": "",  # Must be empty to avoid conflicting headers
            }
            logger.info("Using CLAUDE_CODE_OAUTH_TOKEN for OAuth token authentication")
        else:
            env_vars = {
                **subprocess.os.environ,
                "ANTHROPIC_API_KEY": self.anthropic_api_key,
            }

        if "HAIKAI_PROFILES_PATH" not in env_vars:
            env_vars["HAIKAI_PROFILES_PATH"] = str(self._haikai_profiles_path())

        return env_vars

    def _probe_rate_limited(self) -> Tuple[bool, Optional[float]]:
        """Deterministically check whether the Anthropic account is rate-limited.

        Makes ONE minimal POST to the Messages API with this executor's credentials and
        returns ``(is_rate_limited, retry_after_seconds)``. A 429 comes back in <1s, so
        this surfaces a rate limit the Claude CLI would otherwise hide inside its own
        silent internal retries (the CLI then hangs with no output until killed).

        Auth mirrors `_build_env_vars`: OAuth tokens (``sk-ant-oat``) use Bearer + the
        oauth beta header; plain keys use ``x-api-key``. Any non-429 response or network
        error returns ``(False, None)`` — we never false-positive into backoff, and real
        errors still surface through the CLI run itself.
        """
        import os
        import json as _json
        import urllib.request
        import urllib.error

        base = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")
        headers = {"content-type": "application/json", "anthropic-version": "2023-06-01"}
        body = {
            "model": _RATE_LIMIT_PROBE_MODEL,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}],
        }
        if "sk-ant-oat" in self.anthropic_api_key:
            # A subscription OAuth token must look like Claude Code or the API
            # rejects it with a MISLEADING `429 rate_limit_error` (no ratelimit
            # headers) — a bare oauth-beta probe ALWAYS 429s and would falsely
            # trip the backoff forever. Mirror the Claude Code identity.
            headers["authorization"] = f"Bearer {self.anthropic_api_key}"
            headers["anthropic-beta"] = "claude-code-20250219,oauth-2025-04-20"
            headers["user-agent"] = "claude-cli/2.1.2 (external, cli)"
            headers["x-app"] = "cli"
            body["system"] = [{
                "type": "text",
                "text": "You are Claude Code, Anthropic's official CLI for Claude.",
            }]
        else:
            headers["x-api-key"] = self.anthropic_api_key
        payload = _json.dumps(body).encode("utf-8")
        req = urllib.request.Request(base + "/v1/messages", data=payload, headers=headers, method="POST")
        try:
            urllib.request.urlopen(req, timeout=15)
            return (False, None)
        except urllib.error.HTTPError as e:
            # Only a 429 carrying genuine rate-limit headers is a usage limit; a
            # bare 429 with none is a malformed-request rejection — never back off.
            if e.code == 429 and rate_limit_backoff.has_rate_limit_headers(getattr(e, "headers", None)):
                retry_after = e.headers.get("retry-after")
                try:
                    retry_after = float(retry_after) if retry_after else None
                except (TypeError, ValueError):
                    retry_after = None
                return (True, retry_after)
            return (False, None)
        except Exception:
            return (False, None)

    def _rate_limit_backoff(self) -> Generator[Dict[str, Any], None, bool]:
        """Preflight gate: if rate-limited, back off exponentially until it clears.

        Probes deterministically (`_probe_rate_limited`); if clear, returns ``True``
        immediately (no events). If rate-limited, backs off with the shared
        time-budgeted exponential schedule (`rate_limit_backoff`: full jitter,
        honoring ``Retry-After``), re-probing between sleeps and emitting a visible
        ``rate_limited`` signal each attempt. Returns ``True`` once the limit clears
        (safe to spawn) or ``False`` after the budget is spent (a terminal ``error``
        event with ``message="rate_limited"`` has been yielded). Callers `yield from`
        this and skip the CLI spawn when it returns ``False``.
        """
        import time

        limited, retry_after = self._probe_rate_limited()
        if not limited:
            return True
        start = time.monotonic()
        budget = rate_limit_backoff.budget_seconds()
        attempt = 0
        while True:
            attempt += 1
            elapsed = time.monotonic() - start
            wait, honored = rate_limit_backoff.next_wait(attempt, retry_after)
            if attempt >= rate_limit_backoff.ATTEMPT_BACKSTOP or elapsed + wait >= budget:
                yield rate_limit_backoff.rate_limit_signal(
                    attempt, wait, elapsed, budget, honored, retrying=False)
                yield {"type": "error", "message": "rate_limited",
                       "detail": (f"Anthropic rate limit (429) did not clear within "
                                  f"the {budget:.0f}s budget ({attempt} attempts)")}
                return False
            yield rate_limit_backoff.rate_limit_signal(
                attempt, wait, elapsed, budget, honored, retrying=True)
            time.sleep(wait)
            limited, retry_after = self._probe_rate_limited()
            if not limited:
                logger.info(f"Rate limit cleared after {attempt} backoff attempt(s)")
                return True

    # ─────────────────────────────────────────────────────────────────────
    # Stream-line dispatch helpers (Phase B.3a)
    # ─────────────────────────────────────────────────────────────────────

    @staticmethod
    def _iter_stream_events(stdout) -> Generator[Dict[str, Any], None, None]:
        """Yield parsed JSON event dicts from a Claude CLI stdout stream.

        Per line: strip, skip if empty, `json.loads`, skip if not a
        dict, yield otherwise. JSONDecodeError is logged at warning
        level and surfaces to the caller as a synthetic
        `{"type": "error", "message": "Invalid JSON ..."}` event — the
        stream is never aborted on a single bad line.

        Returns immediately if `stdout` is None (subprocess died before
        producing output).
        """
        if stdout is None:
            return
        for line in stdout:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse stream-json line: {line[:100]}... Error: {e}")
                yield {"type": "error", "message": f"Invalid JSON in stream: {line[:50]}..."}
                continue
            if not isinstance(event, dict):
                continue
            yield event

    @staticmethod
    def _detect_folder_in_text(text: str, state: _StreamLoopState) -> None:
        """Set `state.folder_buffer` to the spec slug if `text` mentions
        `haikai/specs/<slug>` (or the Windows-separator variant).

        First detection wins: no-op if `state.folder_buffer` is already
        set. Pure side effect on `state`; returns None.
        """
        if state.folder_buffer:
            return
        if "haikai/specs/" not in text and "haikai\\specs\\" not in text:
            return
        match = re.search(r"haikai[/\\]specs[/\\]([^/\\\s`]+)", text)
        if match:
            state.folder_buffer = match.group(1)
            logger.info(f"Detected spec folder from content: {state.folder_buffer}")

    @staticmethod
    def _check_text_for_cli_errors(
        text: str, state: _StreamLoopState
    ) -> Generator[Dict[str, Any], None, None]:
        """If `text` contains a CLI error pattern, append to state.cli_errors,
        set state.is_fatal_error when warranted, and yield an error event.

        Returns a generator (zero or one event yielded). When the text
        doesn't match any pattern, the generator is empty and the
        caller's `yield from` is a no-op.
        """
        if not any(p in text for p in _CLI_ERROR_PATTERNS):
            return
        state.cli_errors.append(text)
        logger.error(f"CLI error in content: {text[:200]}")
        lower = text.lower()
        if any(hint in lower for hint in _FATAL_ERROR_HINTS):
            state.is_fatal_error = True
        yield {"type": "error", "message": text}

    @staticmethod
    def _try_collect_ask_questions(
        tool_name: str,
        tool_input: Any,
        state: _StreamLoopState,
        log_context: str = "",
    ) -> bool:
        """If `tool_name` is `ask-questions` (or `Skill` with `skill:
        ask-questions`), flip `state.is_collecting_questions`, append
        the args body to `state.ask_questions_content`, and return True.
        Otherwise return False.

        Single source of truth for ask-questions detection across the
        main loop and both retry loops — any future ask-questions
        invocation shape (new tool name, new Skill wrapper) lands here
        only.
        """
        if tool_name == "ask-questions":
            state.is_collecting_questions = True
            args_str = tool_input.get("args", "") if isinstance(tool_input, dict) else str(tool_input)
            if args_str:
                state.ask_questions_content.append(args_str)
            logger.info(f"{log_context}Detected /ask-questions skill invocation (tool_name={tool_name}), enabled content buffering")
            return True
        if tool_name == "Skill":
            skill_name = tool_input.get("skill", "") if isinstance(tool_input, dict) else ""
            if skill_name == "ask-questions" or "ask-questions" in str(tool_input):
                state.is_collecting_questions = True
                args_str = tool_input.get("args", "") if isinstance(tool_input, dict) else str(tool_input)
                if args_str:
                    state.ask_questions_content.append(args_str)
                logger.info(f"{log_context}Detected /ask-questions via Skill tool, args={len(args_str)} chars")
                return True
        return False

    def _execute_write_tool(
        self,
        tool_input: Dict[str, Any],
        state: _StreamLoopState,
    ) -> Generator[Dict[str, Any], None, None]:
        """Execute a Write tool invocation and yield a file_modified event
        on success (or error event on failure). Also extracts the spec
        folder from the target path if not already set.

        Shared by main + resume-retry loops. Centralizes the disk-write
        side effect so future error-handling changes touch one site.
        """
        file_path = tool_input.get("path", "")
        file_content = tool_input.get("content", "")
        # Extract folder from path like haikai/specs/2026-01-29-feature/...
        if "haikai/specs/" in file_path or "haikai\\specs\\" in file_path:
            match = re.search(r"haikai[/\\]specs[/\\]([^/\\]+)", file_path)
            if match and not state.folder_buffer:
                state.folder_buffer = match.group(1)
                logger.info(f"Detected spec folder from Write tool: {state.folder_buffer}")
        if file_path and file_content:
            try:
                result = self.tool_executor.execute_tool(
                    "write_to_file",
                    {"path": file_path, "content": file_content},
                )
                logger.info(f"Executed Write tool: {file_path} - {result}")
                yield {"type": "file_modified", "path": file_path}
            except Exception as e:
                logger.error(f"Failed to execute Write tool: {e}")
                yield {"type": "error", "message": f"Failed to write file: {e}"}

    def _handle_question_retry_event(
        self,
        event: Dict[str, Any],
        state: _StreamLoopState,
    ) -> Generator[Dict[str, Any], None, None]:
        """Dispatch one event from the QUESTION-RETRY stream loop.

        Lean dispatch compared to main: no folder detect, no CLI-error
        detect, no Write/Edit/Bash tools. Still yields `content`,
        `skill_invoked`, and `error` events so the client sees retry
        progress.
        """
        event_type = event.get("type")

        if event_type == "assistant":
            message_data = event.get("message", {})
            content = message_data.get("content", [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        yield from self._handle_question_retry_block(block, state)
            elif isinstance(content, str) and content:
                if state.is_collecting_questions:
                    state.ask_questions_content.append(content)
                yield {"type": "content", "delta": content}
            return

        if event_type == "error":
            yield {"type": "error", "message": event.get("message", str(event))}

    def _handle_question_retry_block(
        self,
        block: Dict[str, Any],
        state: _StreamLoopState,
    ) -> Generator[Dict[str, Any], None, None]:
        """Per-block dispatch for the question-retry loop.

        text blocks: question buffer + content yield (no folder, no error detect).
        tool_use blocks: ask-questions detection only, always yield skill_invoked.
        """
        block_type = block.get("type")

        if block_type == "text":
            text = block.get("text", "")
            if text:
                if state.is_collecting_questions:
                    state.ask_questions_content.append(text)
                yield {"type": "content", "delta": text}
            return

        if block_type == "tool_use":
            tool_name = block.get("name", "unknown")
            tool_input = block.get("input", {})
            self._try_collect_ask_questions(tool_name, tool_input, state, log_context="Retry: ")
            reported_skill = (
                "ask-questions"
                if tool_name == "Skill" and state.is_collecting_questions
                else tool_name
            )
            yield {"type": "skill_invoked", "skill": reported_skill}

    def _handle_resume_retry_event(
        self,
        event: Dict[str, Any],
        state: _StreamLoopState,
    ) -> Generator[Dict[str, Any], None, None]:
        """Dispatch one event from the RESUME-RETRY stream loop.

        This retry is a "side-effect-only" nudge: it mutates state
        (folder_buffer, is_collecting_questions, ask_questions_content)
        and executes Write tools silently, but does NOT yield content
        or skill_invoked events back to the client — only file_modified
        from successful Writes (and error from failed Writes).
        """
        if event.get("type") != "assistant":
            return

        message_data = event.get("message", {})
        content_blocks = message_data.get("content", [])
        if not isinstance(content_blocks, list):
            return

        for block in content_blocks:
            if not isinstance(block, dict):
                continue
            block_type = block.get("type")

            if block_type == "text":
                text = block.get("text", "")
                if text:
                    self._detect_folder_in_text(text, state)
                continue

            if block_type == "tool_use":
                tool_name = block.get("name", "")
                tool_input = block.get("input", {})
                if self._try_collect_ask_questions(tool_name, tool_input, state, log_context="Resume retry: "):
                    continue
                if tool_name == "Write":
                    yield from self._execute_write_tool(tool_input, state)

    def _check_main_returncode(
        self,
        process: subprocess.Popen,
        state: _StreamLoopState,
    ) -> Generator[Dict[str, Any], None, None]:
        """Inspect the main spawn's returncode after the stream loop exits.

        On non-zero: set `is_fatal_error`, append stderr (or a synthetic
        "exited with code N" message if stderr is empty) to
        `state.cli_errors`, and yield an error event. On zero: drain
        stderr at warning level only.

        Retry-process returncode checks follow slightly different rules
        (clear fatal flag on success; don't synthesize errors for empty
        stderr) — see `_run_question_retry_loop`.
        """
        if process.returncode != 0:
            state.is_fatal_error = True
            stderr_output = process.stderr.read().strip() if process.stderr else ""
            if stderr_output:
                state.cli_errors.append(stderr_output)
                logger.error(f"Claude CLI failed (code {process.returncode}): {stderr_output}")
                yield {"type": "error", "message": stderr_output}
            else:
                error_msg = f"Claude CLI exited with code {process.returncode}"
                state.cli_errors.append(error_msg)
                logger.error(error_msg)
                yield {"type": "error", "message": error_msg}
            return
        # Process succeeded — drain stderr for warnings/debug info only.
        if process.stderr:
            stderr_output = process.stderr.read().strip()
            if stderr_output:
                logger.warning(f"Claude CLI stderr (exit 0): {stderr_output}")

    def _run_question_retry_loop(
        self,
        state: _StreamLoopState,
        original_cli_prompt: str,
        command_name: str,
        max_retries: int = 3,
    ) -> Generator[Dict[str, Any], None, None]:
        """Retry the question-collection flow on new sessions.

        Two branches per attempt:
          - state.is_fatal_error: re-send the ORIGINAL prompt (the CLI
            failed transiently, the LLM never saw it).
          - otherwise: send a nudge prompt asking the LLM to invoke
            /ask-questions.

        Each attempt spawns its own subprocess, streams via
        `_handle_question_retry_event`, and checks the retry's
        returncode. A successful attempt that flips
        `state.is_collecting_questions` breaks the loop early. A
        non-zero exit re-arms the fatal flag and continues to the next
        attempt (or exhaustion).
        """
        for retry_attempt in range(max_retries):
            if state.is_fatal_error:
                # CLI process failed — retry the original request
                logger.warning(
                    f"CLI failed for {command_name} "
                    f"— retrying ({retry_attempt + 1}/{max_retries})"
                )
                retry_prompt = original_cli_prompt
                retry_msg = f"Retrying... ({retry_attempt + 1}/{max_retries})"
                progress_msg = "Re-sending request..."
            else:
                # CLI succeeded but didn't ask questions — nudge
                logger.warning(
                    f"New session for {command_name} completed WITHOUT /ask-questions "
                    f"— retrying ({retry_attempt + 1}/{max_retries})"
                )
                retry_prompt = (
                    "You have not yet asked the user any clarifying questions. "
                    "You MUST now invoke the /ask-questions skill to ask clarifying questions about this feature. "
                    "Do NOT write requirements.md or proceed further. "
                    "Invoke /ask-questions with your questions immediately."
                )
                retry_msg = f"Rethinking... ({retry_attempt + 1}/{max_retries})"
                progress_msg = "Asking clarifying questions..."

            yield {
                "type": "retry",
                "attempt": retry_attempt + 1,
                "max_attempts": max_retries,
                "message": retry_msg,
            }

            # Shared helper — see helper-exists-sibling-missed in CLAUDE.md.
            # is_new_session=False → --resume + session uuid.
            retry_cli_args = self._build_cli_command(retry_prompt, is_new_session=False)

            yield {
                "type": "retry_progress",
                "attempt": retry_attempt + 1,
                "step": "prompt_sent",
                "message": progress_msg,
            }

            retry_process = self._spawn_subprocess(retry_cli_args)

            yield {
                "type": "retry_progress",
                "attempt": retry_attempt + 1,
                "step": "processing",
                "message": "Generating questions...",
            }

            # Stream via the shared question-retry dispatcher.
            for event in self._iter_stream_events(retry_process.stdout):
                yield from self._handle_question_retry_event(event, state)

            retry_process.wait()

            # Retry-specific returncode rules (differ from main):
            #   - failure with no stderr: log only, no cli_errors append, no yield
            #   - success: explicitly clear fatal flag (main never sets it false)
            if retry_process.returncode != 0:
                state.is_fatal_error = True
                stderr_output = retry_process.stderr.read().strip() if retry_process.stderr else ""
                if stderr_output:
                    state.cli_errors.append(stderr_output)
                    logger.error(f"Retry {retry_attempt + 1} failed (code {retry_process.returncode}): {stderr_output}")
                    yield {"type": "error", "message": stderr_output}
                else:
                    logger.error(f"Retry {retry_attempt + 1} failed (code {retry_process.returncode})")
                continue

            state.is_fatal_error = False

            if retry_process.stderr:
                stderr_output = retry_process.stderr.read().strip()
                if stderr_output:
                    logger.warning(f"Retry {retry_attempt + 1} stderr (exit 0): {stderr_output}")

            if state.is_collecting_questions:
                logger.info(f"Retry {retry_attempt + 1}: /ask-questions successfully invoked")
                yield {
                    "type": "retry_progress",
                    "attempt": retry_attempt + 1,
                    "step": "success",
                    "message": "Questions ready",
                }
                break
            else:
                logger.warning(f"Retry {retry_attempt + 1}: /ask-questions still not invoked")

    def _emit_questions_failed(
        self,
        state: _StreamLoopState,
        command_name: str,
        max_retries: int = 3,
    ) -> Generator[Dict[str, Any], None, None]:
        """Emit the questions_failed terminal event when all retries
        exhaust without /ask-questions being invoked.

        On a fatal CLI error, build the reason from the collected
        cli_errors. Otherwise spawn a one-shot /explain-failure probe
        via _probe_failure_reason. Yields exactly one
        `questions_failed` event.
        """
        if state.is_fatal_error:
            logger.error(
                f"New session for {command_name} failed due to fatal CLI error: "
                f"{'; '.join(state.cli_errors[:3])}"
            )
        else:
            logger.error(
                f"New session for {command_name} failed to generate questions "
                f"after {max_retries} retries"
            )

        # Skip the LLM probe on fatal errors — LLM won't be reachable.
        reason = ""
        if state.is_fatal_error:
            reason = "; ".join(state.cli_errors[:3])
        else:
            try:
                reason = self._probe_failure_reason()
                logger.info(f"LLM reason for not generating questions: {reason}")
            except Exception as e:
                logger.error(f"Failed to get reason from LLM: {e}")
                reason = ""

        fail_message = "Unable to generate questions based on your spec."
        if reason:
            fail_message = f"{fail_message} {reason}"

        yield {"type": "questions_failed", "message": fail_message}

    def _run_resume_retry_loop(
        self,
        state: _StreamLoopState,
        command_name: str,
        max_retries: int = 3,
    ) -> Generator[Dict[str, Any], None, None]:
        """Resume-session retry: if Claude dumped follow-up questions as
        plain text instead of using /ask-questions, nudge it until it
        does (or we detect a spec folder, which also satisfies the
        success condition).

        Side-effect-only stream dispatch (see `_handle_resume_retry_event`):
        yields retry events to the client but no content / skill_invoked
        relay from the retry stream itself — only `file_modified` from
        successful Writes.

        Caller is responsible for the entry predicate (`not
        is_new_session and not state.is_collecting_questions and not
        state.folder_buffer and not state.is_fatal_error`) before
        invoking.
        """
        logger.warning(
            f"Resume for {command_name} completed WITHOUT /ask-questions or folder "
            f"— retrying to enforce /ask-questions"
        )
        for retry_attempt in range(max_retries):
            retry_prompt = (
                "You output follow-up questions as plain text instead of using the "
                "/ask-questions skill. You MUST invoke /ask-questions with your "
                "follow-up questions. If you have no follow-up questions and requirements "
                "are complete, write requirements.md and complete the spec. "
                "Do NOT output questions as plain text — use /ask-questions."
            )

            yield {
                "type": "retry",
                "attempt": retry_attempt + 1,
                "max_attempts": max_retries,
                "message": f"Re-prompting for /ask-questions... ({retry_attempt + 1}/{max_retries})",
            }

            retry_cli_args = self._build_cli_command(retry_prompt, is_new_session=False)
            retry_process = self._spawn_subprocess(retry_cli_args)

            for event in self._iter_stream_events(retry_process.stdout):
                yield from self._handle_resume_retry_event(event, state)

            retry_process.wait()
            logger.info(
                f"Resume retry {retry_attempt + 1} completed "
                f"(collecting_q={state.is_collecting_questions}, folder={state.folder_buffer})"
            )

            if state.is_collecting_questions or state.folder_buffer:
                break

        if not state.is_collecting_questions and not state.folder_buffer:
            logger.error(
                f"Resume for {command_name} failed to produce questions or folder "
                f"after {max_retries} retries"
            )

    def _probe_failure_reason(self) -> str:
        """Spawn one final probe asking the LLM why /ask-questions wasn't invoked.

        Distinct from the main + retry spawns: omits
        `--include-partial-messages` (this is a one-shot probe — partial
        events would be discarded by the text accumulator anyway). The
        --add-dir paths and base flags mirror `_build_cli_command`'s
        output; kept inline because of the one flag divergence.
        Documented in CLAUDE.md as a tolerated drift from the
        helper-exists-sibling-missed guard.
        """
        reason_prompt = (
            "/explain-failure You were asked to generate clarifying questions using the "
            "/ask-questions skill but you did not do so. Explain why."
        )
        reason_cli_args = [
            str(self.claude_cli_path),
            "--setting-sources", "project",
            "--resume", self.session_uuid,
            "--add-dir", str(self.project_dir).replace("\\", "/"),
            "--add-dir", str(self._haikai_profiles_path()).replace("\\", "/"),
        ]
        for d in self.extra_dirs:
            reason_cli_args.extend(["--add-dir", str(d).replace("\\", "/")])
        reason_cli_args.extend([
            "--dangerously-skip-permissions",
            "--print",
            "--output-format", "stream-json",
            "--verbose",
            reason_prompt,
        ])
        reason_process = self._spawn_subprocess(reason_cli_args)
        reason_parts: List[str] = []
        for event in self._iter_stream_events(reason_process.stdout):
            if event.get("type") != "assistant":
                continue
            content = event.get("message", {}).get("content", [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text = block.get("text", "")
                        if text:
                            reason_parts.append(text)
            elif isinstance(content, str) and content:
                reason_parts.append(content)
        reason_process.wait()
        return "".join(reason_parts).strip()

    def _handle_main_event(
        self,
        event: Dict[str, Any],
        state: _StreamLoopState,
        command_name: str,
    ) -> Generator[Dict[str, Any], None, None]:
        """Dispatch one parsed event from the MAIN stream loop.

        Owns the full main-loop dispatch: text-block scanning (folder
        detect, CLI-error detect, question buffering, content yield) and
        tool_use-block dispatch (ask-questions / Skill / Write / Edit /
        Bash / TodoWrite / write-spec).

        `command_name` is accepted to match the dispatcher signature
        shared with the retry handlers, but is unused in the main loop
        dispatch path.

        Yields zero or more output events (`content`, `skill_invoked`,
        `file_modified`, `error`).
        """
        del command_name  # accepted for signature parity; not used at present

        event_type = event.get("type")

        if event_type == "user":
            logger.debug(f"User message: {event.get('message', {}).get('content', '')}")
            return

        if event_type == "assistant":
            message_data = event.get("message", {})
            content = message_data.get("content", [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        yield from self._handle_main_assistant_block(block, state)
            elif isinstance(content, str):
                if content:
                    if state.is_collecting_questions:
                        state.ask_questions_content.append(content)
                    yield {"type": "content", "delta": content}
            return

        if event_type == "tool_result":
            logger.debug(f"Tool result: {event}")
            return

        if event_type == "error":
            error_msg = event.get("message", str(event))
            yield {"type": "error", "message": error_msg}
            return

    def _handle_main_assistant_block(
        self,
        block: Dict[str, Any],
        state: _StreamLoopState,
    ) -> Generator[Dict[str, Any], None, None]:
        """Handle one `{"type": "text"|"tool_use", ...}` block from an assistant event.

        Split out of `_handle_main_event` because the per-block dispatch
        carries the bulk of the LOC (Write / Edit / Bash / Skill /
        ask-questions / TodoWrite / write-spec). Keeping it as a separate
        method makes each branch unit-testable.
        """
        block_type = block.get("type")

        if block_type == "text":
            text = block.get("text", "")
            if not text:
                return
            self._detect_folder_in_text(text, state)
            error_events = list(self._check_text_for_cli_errors(text, state))
            if error_events:
                yield from error_events
            else:
                if state.is_collecting_questions:
                    state.ask_questions_content.append(text)
                yield {"type": "content", "delta": text}
            return

        if block_type == "tool_use":
            tool_name = block.get("name", "unknown")
            tool_input = block.get("input", {})

            # Shared with both retry loops — see _try_collect_ask_questions.
            ask_q_matched = self._try_collect_ask_questions(tool_name, tool_input, state)

            if not ask_q_matched and tool_name == "Write":
                # Shared with resume-retry — see _execute_write_tool.
                yield from self._execute_write_tool(tool_input, state)

            elif tool_name == "Edit":
                file_path = tool_input.get("path", "")
                logger.info(f"Edit tool invoked for: {file_path}")
                yield {"type": "file_modified", "path": file_path}

            elif tool_name == "Bash":
                command = tool_input.get("command", "")
                if command:
                    try:
                        self.tool_executor.execute_tool("bash", {"command": command})
                        logger.info(f"Executed Bash tool: {command[:50]}...")
                    except Exception as e:
                        logger.error(f"Failed to execute Bash tool: {e}")

            elif tool_name == "TodoWrite":
                logger.info(f"TodoWrite tool invoked: {tool_input}")

            elif tool_name == "write-spec":
                spec_name = tool_input.get("spec_name", "")
                if spec_name:
                    state.folder_buffer = spec_name
                    logger.info(f"Detected /write-spec with folder: {spec_name}")

            # Report skill name, but use "ask-questions" if it's the Skill tool
            reported_skill = (
                "ask-questions"
                if tool_name == "Skill" and state.is_collecting_questions
                else tool_name
            )
            yield {"type": "skill_invoked", "skill": reported_skill}

    def stream_message(self, message: str, is_new_session: bool = False, command_name: str = "shape-spec") -> Generator[Dict[str, Any], None, None]:
        """
        Stream a message to Claude and yield response chunks.
        
        This method executes the Claude CLI with session persistence and streams
        the output line by line. The Claude CLI is configured to have access to
        all Haikai skills via the haikai-profiles directory.
        
        When starting a new session (is_new_session=True), the message is automatically
        prefixed with the command_name (e.g. '/shape-spec' or '/plan-product').
        For resumed sessions, the message is sent as-is.
        
        Args:
            message: User message to send to Claude
            is_new_session: If True, automatically prefix message with the command_name
            
        Yields:
            Dictionary events with structure:
                {"type": "content", "delta": str}
                {"type": "skill_invoked", "skill": str}
                {"type": "file_modified", "path": str}
                {"type": "error", "message": str}
                {"type": "questions", "questions": list}
                {"type": "folder", "folder": str}
        """
        start_time = datetime.now()

        # Buffer for questions and folder (sent after streaming completes)
        # Mutable buffers carried across the main + 2 retry stream loops.
        # See _StreamLoopState for the field-level descriptions. All three
        # loops (main, question retry, resume retry) read/mutate state
        # directly via the per-event dispatchers (B.3a / B.3b).
        state = _StreamLoopState()
        questions_buffer: List[Dict[str, Any]] = []

        # Restore session from spec folder backup if Claude's copy is missing
        if not is_new_session:
            self.restore_session_from_spec()

        # Build prompt (with OS context, /{command_name} prefix, large-message
        # tempfile substitution) + CLI args (Phase B.1 helpers).
        cli_prompt, message_file = self._build_streaming_prompt(message, is_new_session, command_name)
        cli_args = self._build_cli_command(cli_prompt, is_new_session)

        logger.info(f"Streaming message for session {self.session_id}")
        logger.info(f"CLI args: {' '.join(cli_args)}")

        try:
            # Preflight: deterministic 429 check + exponential backoff. The Claude CLI
            # swallows rate limits in its own internal retries and then hangs with no
            # output until killed; probing the API directly lets us back off and surface
            # a clear `rate_limited` signal instead of a silent multi-minute hang.
            if not (yield from self._rate_limit_backoff()):
                return

            # Execute the command with streaming
            process = self._spawn_subprocess(cli_args)
            
            # Stream stdout line by line
            # Main stream loop: drive event dispatch through helpers (Phase B.3a).
            # _iter_stream_events handles the JSON parsing scaffolding;
            # _handle_main_event owns the event_type / block_type / tool_name
            # dispatch tree. All buffer mutations land on `state`.
            for event in self._iter_stream_events(process.stdout):
                yield from self._handle_main_event(event, state, command_name)

            # Wait for the process to complete + handle returncode/stderr.
            process.wait()
            yield from self._check_main_returncode(process, state)

            execution_time = (datetime.now() - start_time).total_seconds()
            logger.info(f"Message streaming completed in {execution_time:.2f}s")

            # New-session recovery: retry up to 3 times, then emit
            # questions_failed if /ask-questions never landed.
            if (is_new_session and not state.is_collecting_questions
                    and _uses_question_flow(command_name)):
                yield from self._run_question_retry_loop(state, cli_prompt, command_name)
            if (is_new_session and not state.is_collecting_questions
                    and _uses_question_flow(command_name)):
                yield from self._emit_questions_failed(state, command_name)

            # Resume-session recovery: if the LLM dumped questions as plain
            # text instead of /ask-questions, nudge it. Skipped on fatal
            # errors (LLM is unreachable).
            if (not is_new_session and not state.is_collecting_questions
                    and not state.folder_buffer and not state.is_fatal_error
                    and _uses_question_flow(command_name)):
                yield from self._run_resume_retry_loop(state, command_name)

            # Parse questions from buffered content if /ask-questions was invoked
            if state.ask_questions_content:
                questions_buffer = self._parse_questions_from_content(state.ask_questions_content)
                if questions_buffer:
                    logger.info(f"Parsed {len(questions_buffer)} questions from /ask-questions")

            # Yield questions event if we have questions
            if questions_buffer:
                logger.info(f"About to yield questions event with {len(questions_buffer)} questions")
                yield {"type": "questions", "questions": questions_buffer}
                logger.info(f"Successfully yielded questions event")

            # Yield folder event if we detected a folder
            if state.folder_buffer:
                logger.info(f"About to yield folder event: {state.folder_buffer}")
                yield {"type": "folder", "folder": state.folder_buffer}
                logger.info(f"Successfully yielded folder event")
            
        except Exception as e:
            error_msg = f"Error streaming message: {str(e)}"
            logger.error(error_msg, exc_info=True)
            yield {"type": "error", "message": error_msg}
        finally:
            # Clean up temp files if created
            if message_file and message_file.exists():
                try:
                    message_file.unlink()
                    logger.info(f"Cleaned up temp message file: {message_file}")
                except Exception:
                    pass
    
    def get_session_file(self) -> Path:
        """
        Get the path to the session file.
        
        Claude CLI stores sessions in ~/.claude/projects/<project_path>/<session_uuid>.jsonl
        
        Returns:
            Path to the session file
        """
        import os
        
        # Determine home directory based on OS
        if platform.system() == "Windows":
            home_dir = Path(os.environ.get("USERPROFILE", os.path.expanduser("~")))
        else:
            home_dir = Path(os.path.expanduser("~"))
        
        # Claude stores sessions in ~/.claude/projects/<encoded_project_path>/<session_uuid>.jsonl
        # The project path is encoded by replacing path separators with dashes
        # Note: Use project_dir, not sessions_dir, as Claude CLI encodes the working directory
        # Claude CLI encoding rules:
        # 1. Replace :\ (Windows drive) with -- as a unit
        # 2. Replace remaining \ and / with -
        # 3. Replace _ with -
        encoded_project_path = str(self.project_dir)
        
        # Handle Windows drive letter (C:\ -> C--)
        if platform.system() == "Windows" and ":\\" in encoded_project_path:
            encoded_project_path = encoded_project_path.replace(":\\", "--")
        elif platform.system() == "Windows" and ":" in encoded_project_path:
            # Handle case where path uses forward slashes on Windows
            encoded_project_path = encoded_project_path.replace(":/", "--")
        
        # Replace remaining separators and underscores
        encoded_project_path = encoded_project_path.replace("\\", "-").replace("/", "-").replace("_", "-")
        
        session_dir = home_dir / ".claude" / "projects" / encoded_project_path
        return session_dir / f"{self.session_uuid}.jsonl"

    def persist_session_to_spec(self, spec_name: str) -> None:
        """Write active_session.json and copy the session .jsonl into the spec folder.

        Called after each API call (shape-spec SSE, orchestration steps) so that
        the conversation can be committed to git and restored on another machine.
        """
        import shutil

        spec_dir = self.project_dir / "haikai" / "specs" / spec_name
        if not spec_dir.exists():
            logger.warning(f"Spec dir does not exist, skipping session persist: {spec_dir}")
            return

        # 1. Write active_session.json
        active_session = {
            "session_id": self.session_uuid,
            "created_at": datetime.now().isoformat(),
            "spec_name": spec_name,
        }
        active_session_path = spec_dir / "active_session.json"
        active_session_path.write_text(json.dumps(active_session, indent=2), encoding="utf-8")
        logger.info(f"Wrote active_session.json to {active_session_path}")

        # 2. Copy session .jsonl
        session_file = self.get_session_file()
        if session_file.exists():
            dest = spec_dir / session_file.name  # <uuid>.jsonl
            shutil.copy2(str(session_file), str(dest))
            logger.info(f"Copied session file to {dest}")
        else:
            logger.warning(f"Session file not found for copy: {session_file}")

    def restore_session_from_spec(self) -> Optional[str]:
        """If the Claude CLI session file is missing, restore it from a spec folder backup.

        Scans haikai/specs/*/active_session.json for a matching session_id
        and copies the .jsonl back to the Claude CLI session directory.

        Returns:
            The spec_name that was matched, or None if no backup found or not needed.
        """
        import shutil

        session_file = self.get_session_file()
        if session_file.exists():
            return None  # No restoration needed

        # Scan spec folders for matching session_id
        specs_dir = self.project_dir / "haikai" / "specs"
        if not specs_dir.exists():
            return None

        for spec_folder in specs_dir.iterdir():
            if not spec_folder.is_dir():
                continue
            active_session_path = spec_folder / "active_session.json"
            if not active_session_path.exists():
                continue
            try:
                data = json.loads(active_session_path.read_text(encoding="utf-8"))
                if data.get("session_id") == self.session_uuid:
                    backup_jsonl = spec_folder / f"{self.session_uuid}.jsonl"
                    if backup_jsonl.exists():
                        session_file.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(str(backup_jsonl), str(session_file))
                        logger.info(f"Restored session from {backup_jsonl} to {session_file}")
                        return data.get("spec_name")
                    else:
                        logger.warning(f"active_session.json found in {spec_folder} but .jsonl backup missing")
            except (json.JSONDecodeError, OSError) as e:
                logger.warning(f"Failed to read {active_session_path}: {e}")

        logger.info(f"No backup found for session {self.session_uuid}")
        return None

    def clear_session(self) -> bool:
        """
        Clear the conversation session by removing the entire session directory (including locks) and chat logs.
        
        Returns:
            True if session was cleared successfully, False otherwise
        """
        import shutil
        import time
        success = True
        
        session_file = self.get_session_file()
        session_dir = session_file.parent
        
        # Remove entire session directory (includes session file, subagents, and any lock files)
        if session_dir.exists():
            try:
                shutil.rmtree(session_dir)
                logger.info(f"Deleted entire session directory: {session_dir}")
                # Small delay to ensure filesystem operations complete
                time.sleep(0.1)
            except Exception as e:
                logger.error(f"Failed to delete session directory: {e}")
                success = False
        
        # Remove chat logs directory
        if self.chat_logs_dir.exists():
            try:
                shutil.rmtree(self.chat_logs_dir)
                self.chat_logs_dir.mkdir(parents=True, exist_ok=True)
                logger.info(f"Cleared chat logs directory: {self.chat_logs_dir}")
            except Exception as e:
                logger.error(f"Failed to clear chat logs directory: {e}")
                success = False
        
        return success

    def _parse_questions_from_content(self, content_chunks: list) -> list:
        """Parse questions from buffered content after /ask-questions invocation.

        Delegates to :mod:`src.chat.question_parser` — the single source of
        truth for the four supported formats. See that module for pattern
        details. Method retained for backwards compatibility with callers
        and tests that invoke it on the executor instance.
        """
        from src.chat.question_parser import parse_questions

        return parse_questions(content_chunks)
