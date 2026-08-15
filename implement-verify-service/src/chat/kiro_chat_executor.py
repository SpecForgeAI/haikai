"""
Kiro CLI Chat Executor for Conversational API.

Drop-in replacement for ClaudeChatExecutor that uses Kiro CLI instead of
Claude Code CLI. Maintains the same interface (stream_message,
clear_session, etc.) so the API layer's create_chat_executor factory
can swap between them.

Key differences from Claude CLI:
* No JSON output mode — output is ANSI-colored text, stripped here
* No --session-id flag — sessions are per-directory, resumed with --resume
* No --output-format stream-json — we parse raw text output
* Uses --no-interactive --trust-all-tools instead of --dangerously-skip-permissions
* Skills live in .kiro/skills/ (auto-loaded via agent config)
* Agent configs in .kiro/agents/ replace .claude/commands/
"""

import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Optional, Dict, Any, Generator, List

from .cli_limits import MAX_CLI_ARG_LENGTH
from .model_pinning import describe_pinned_model, kiro_pinned_model, model_args
from .profiles_path import HAIKAI_PROFILES_ROOT
from .stream_watchdog import GuardedProcess
from ..kiro_cli_locator import kiro_cli_args, locate_kiro_cli
from datetime import datetime

from .tool_executor import ToolExecutor

logger = logging.getLogger(__name__)

# ANSI escape sequence pattern
_ANSI_RE = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]|\x1b\[\?[0-9;]*[a-zA-Z]')


def _strip_ansi(text: str) -> str:
    """Remove ANSI escape sequences from text."""
    return _ANSI_RE.sub('', text)


# A genuine /ask-questions INVOCATION is a line-start command only — see
# src/chat/ask_questions_detection.py for the rule, the 2026-08-04 incident
# (a skills directory-listing line flipped collection and failed a successful
# run), and the delta-stream variant the openai/oauth executors use.
from .ask_questions_detection import is_ask_questions_invocation  # noqa: E402


class KiroChatExecutor:
    """
    Wrapper class for executing conversational Kiro CLI commands with streaming.

    Provides the same interface as ClaudeChatExecutor so the API layer can
    use either executor interchangeably via the factory function.
    """

    def __init__(self, company: str, project: str, workspace_dir: Path, anthropic_api_key: str = "",
                 session_uuid: Optional[str] = None):
        """
        Initialize the Kiro Chat executor.

        Args:
            company: Company name for session identification
            project: Project name for session identification
            workspace_dir: Base workspace directory
            anthropic_api_key: Not used by Kiro CLI (auth is via SSO), kept for interface compat
            session_uuid: Optional explicit session UUID. When None, a
                deterministic v5 UUID is derived from `{company}_{project}`.
                See ClaudeChatExecutor for rationale (O3 fix).
        """
        from src.path_safety import safe_segment
        company = safe_segment(company, "company")
        project = safe_segment(project, "project")

        self.company = company
        self.project = project
        session_string = f"{company}_{project}"
        self.session_uuid = session_uuid or str(uuid.uuid5(uuid.NAMESPACE_DNS, session_string))
        self.session_id = session_string

        # Workspace paths
        self.workspace_dir = workspace_dir
        self.project_dir = workspace_dir / company / project
        self.kiro_dir = self.project_dir / ".kiro"
        self.chat_logs_dir = self.project_dir / "chat_logs"

        # Create directories
        self.project_dir.mkdir(parents=True, exist_ok=True)
        self.kiro_dir.mkdir(parents=True, exist_ok=True)
        self.chat_logs_dir.mkdir(parents=True, exist_ok=True)

        # Find kiro-cli binary
        self.kiro_cli_path = self._find_kiro_cli()

        # Setup haikai skills for kiro
        self._setup_kiro_skills()

        # Tool executor for handling file writes detected in output
        self.tool_executor = ToolExecutor(self.project_dir)

        # Model pinned on EVERY kiro-cli chat spawn (see model_pinning.py:
        # kiro-cli ignores `settings chat.defaultModel`, and each step is a
        # separate --no-interactive process).
        self.model = kiro_pinned_model()

        logger.info(f"Initialized KiroChatExecutor for {self.session_id}")
        logger.info(f"  Project dir: {self.project_dir}")
        logger.info(f"  Kiro CLI: {self.kiro_cli_path}")
        logger.info(f"  Model: {describe_pinned_model(self.model)}")

    def _find_kiro_cli(self) -> Path:
        """Locate kiro-cli via the shared locator (login-shell-aware WSL
        probing lives in src/kiro_cli_locator.py — do not add probes here)."""
        cli_path, self._use_wsl = locate_kiro_cli()
        return Path(cli_path)

    def _setup_kiro_skills(self):
        """
        Setup Haikai skills in .kiro/skills/ directory for the project workspace.

        Copies haikai-profiles command templates as kiro skills so they're
        auto-loaded when kiro-cli runs in the project directory.
        """
        haikai_profiles = HAIKAI_PROFILES_ROOT / "default"
        skills_dir = self.kiro_dir / "skills" / "haikai"

        if not haikai_profiles.exists():
            logger.warning(f"haikai-profiles not found at {haikai_profiles}")
            return

        skills_dir.mkdir(parents=True, exist_ok=True)

        # Create a SKILL.md that loads all haikai commands as context.
        # MUST cover every HaikaiOrchestrator.COMMANDS entry (2026-07-28:
        # git-commit-preparation was missing — step 4 found no skill, the
        # agent improvised /ask-questions and stalled a headless job ~7 min).
        commands_to_setup = [
            "shape-spec", "plan-product", "write-spec",
            "create-tasks", "implement-tasks", "ask-questions",
            "git-commit-preparation",
        ]

        for cmd_name in commands_to_setup:
            cmd_dir = skills_dir / cmd_name
            cmd_dir.mkdir(parents=True, exist_ok=True)
            source = haikai_profiles / "commands" / cmd_name / "single-agent" / f"{cmd_name}.md"

            if source.exists():
                try:
                    raw = source.read_text(encoding='utf-8')
                    resolved = self._resolve_template(raw, haikai_profiles)
                    skill_md = cmd_dir / "SKILL.md"
                    # Write as a kiro skill with frontmatter
                    content = (
                        f"---\n"
                        f"name: {cmd_name}\n"
                        f"description: Haikai {cmd_name} command\n"
                        f"---\n\n"
                        f"{resolved}\n"
                    )
                    skill_md.write_text(content, encoding='utf-8')
                    logger.debug(f"  ✓ Created skill /{cmd_name}")
                except Exception as e:
                    logger.warning(f"  ✗ Failed to create skill /{cmd_name}: {e}")

    def _resolve_template(self, content: str, profiles_dir: Path, depth: int = 0) -> str:
        """Delegate to the shared resolver (see `src/chat/template_resolver.py`)."""
        from .template_resolver import resolve_template  # lazy
        return resolve_template(content, profiles_dir, depth)

    def stream_message(
        self,
        message: str,
        is_new_session: bool = False,
        command_name: str = "shape-spec"
    ) -> Generator[Dict[str, Any], None, None]:
        """
        Stream a message to Kiro CLI and yield response chunks.

        Kiro CLI doesn't support stream-json, so we:
        1. Run kiro-cli chat in non-interactive mode
        2. Capture output line-by-line
        3. Strip ANSI codes
        4. Parse for tool invocations, file writes, and questions
        5. Yield events matching the ClaudeChatExecutor interface

        Args:
            message: User message to send
            is_new_session: If True, start fresh (don't --resume)
            command_name: Haikai command to prefix for new sessions

        Yields:
            {"type": "content", "delta": str}
            {"type": "skill_invoked", "skill": str}
            {"type": "file_modified", "path": str}
            {"type": "error", "message": str}
            {"type": "questions", "questions": list}
            {"type": "folder", "folder": str}
        """
        start_time = datetime.now()
        questions_buffer = []
        folder_buffer = None
        ask_questions_content = []
        is_collecting_questions = False
        full_response_parts = []

        # Build the prompt
        cli_prompt = message
        if is_new_session:
            cli_prompt = f"/{command_name} {message}"
            if command_name == "shape-spec":
                # Reinforce question-asking behavior — SHAPE-SPEC ONLY
                # (2026-07-28): worktree runs start /write-spec as a fresh
                # session too, and this ask-and-STOP block made the agent
                # write NOTHING (step 1 "silent LLM failure": no spec.md).
                cli_prompt += (
                    "\n\n[System: This is a NEW session. You MUST ask clarifying questions "
                    "using the /ask-questions skill and then STOP. Do NOT write requirements.md "
                    "or skip ahead — ask questions first and wait for the user's answers.]"
                )
            else:
                # Artifact commands (write-spec / create-tasks /
                # implement-tasks) resume from the spec's on-disk files —
                # the OPPOSITE reinforcement applies: produce output now.
                cli_prompt += (
                    "\n\n[System: This is a NEW session resuming from the spec's on-disk "
                    "artifacts under haikai/specs/. Execute the "
                    f"{command_name} skill fully and WRITE its output files now; "
                    "do not stop to ask clarifying questions.]"
                )

        # Kiro CLI interprets messages starting with "/" as built-in slash commands.
        # Escape by rephrasing as an instruction to the agent instead.
        if cli_prompt.startswith("/"):
            skill_name = cli_prompt.split()[0].lstrip("/")
            rest = cli_prompt[len(cli_prompt.split()[0]):].strip()
            cli_prompt = f"Execute the {skill_name} skill. {rest}"

        # Handle large messages via temp file. MAX_CLI_ARG_LENGTH lives
        # in cli_limits.py — shared with claude_chat_executor.
        message_file = None
        if len(cli_prompt) > MAX_CLI_ARG_LENGTH:
            fd, name = tempfile.mkstemp(
                suffix='.txt', prefix='kiro_msg_', dir=str(self.project_dir)
            )
            try:
                with os.fdopen(fd, 'w', encoding='utf-8') as f:
                    f.write(cli_prompt)
            except Exception:
                try:
                    os.unlink(name)
                except OSError:
                    pass
                raise
            message_file = Path(name)
            cli_prompt = f"Read the file {message_file} and follow the instructions within it."
            logger.info(f"Large message ({len(message)} chars) written to temp file")

        # Build CLI arguments (wsl-prefixed on Windows by the shared builder)
        cli_args = kiro_cli_args(
            self.kiro_cli_path, self._use_wsl,
            "chat", "--no-interactive", "--trust-all-tools", "--wrap", "never",
        )

        # Pin the model explicitly on every spawn (no-op when disabled)
        cli_args.extend(model_args(self.model))

        # Resume existing session unless starting fresh
        if not is_new_session:
            cli_args.append("--resume")

        # Add the prompt as positional argument
        cli_args.append(cli_prompt)

        logger.info(f"Streaming message for session {self.session_id}")
        logger.debug(f"CLI args: {' '.join(cli_args[:6])}... [prompt truncated]")

        try:
            env_vars = {**os.environ}
            # Stall-guarded wrapper (2026-08-15): the bare `for line in
            # process.stdout` blocked FOREVER when the kiro run died inside
            # WSL but wsl.exe kept the pipe open-and-silent (two overnight
            # job deaths, specs 8 + 4). GuardedProcess pumps stdout with an
            # inactivity deadline (kills the tree + raises a retry-classified
            # StreamStallError), drains stderr concurrently (the mutual
            # pipe-deadlock class), and bounds wait().
            process = GuardedProcess(
                subprocess.Popen(
                    cli_args,
                    cwd=str(self.project_dir),
                    env=env_vars,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                    encoding='utf-8',
                    errors='replace'
                ),
                label="kiro-cli",
            )
            # D13 parity with the Claude executors (2026-07-28): report the
            # spawned pid so the job runner's cancel watchdog can kill the
            # tree. On Windows the pid is wsl.exe's — killing it tears down
            # the WSL command channel and the kiro-cli run with it.
            on_spawn = getattr(self, "on_spawn", None)
            if on_spawn:
                try:
                    on_spawn(process.pid)
                except Exception:
                    logger.warning("on_spawn callback failed", exc_info=True)

            # Track whether we're past the header (trust warning, etc.)
            past_header = False
            header_lines_seen = 0

            if process.stdout:
                for raw_line in process.stdout:
                    line = _strip_ansi(raw_line).strip()
                    if not line:
                        continue

                    # Skip kiro-cli header lines (trust warning, learn more URL)
                    if not past_header:
                        if any(skip in line for skip in [
                            "All tools are now trusted",
                            "Agents can sometimes do unexpected",
                            "Learn more at",
                            "https://kiro.dev",
                        ]):
                            header_lines_seen += 1
                            continue
                        if header_lines_seen > 0:
                            past_header = True

                    # Skip footer/metadata lines
                    if line.startswith("▸ Credits:") or line.startswith("> Credits:"):
                        continue

                    # Detect tool usage lines: "I will run the following command: X (using tool: shell)"
                    tool_match = re.match(r'I will run the following command:\s*(.+?)\s*\(using tool:\s*(\w+)\)', line)
                    if tool_match:
                        command_text = tool_match.group(1)
                        tool_name = tool_match.group(2)
                        yield {"type": "skill_invoked", "skill": tool_name}
                        continue

                    # Detect "Completed in X.XXs" lines
                    if re.match(r'- Completed in \d+\.\d+s', line):
                        continue

                    # Detect file write operations from output
                    file_write_match = re.search(
                        r'(?:Created|Wrote|Updated|Modified)\s+(?:file\s+)?[`"]?([^\s`"]+)[`"]?',
                        line
                    )
                    if file_write_match:
                        file_path = file_write_match.group(1)
                        if '.' in file_path and not file_path.startswith('http'):
                            yield {"type": "file_modified", "path": file_path}

                    # Detect spec folder references
                    if not folder_buffer:
                        folder_match = re.search(r'haikai[/\\]specs[/\\]([^/\\\s`"]+)', line)
                        if folder_match:
                            folder_buffer = folder_match.group(1)
                            logger.info(f"Detected spec folder: {folder_buffer}")

                    # Detect a GENUINE /ask-questions invocation (line-start
                    # command only — never a path/prose mention; 2026-08-04).
                    if is_ask_questions_invocation(line):
                        is_collecting_questions = True
                        logger.info("Detected /ask-questions invocation")

                    # Strip the "> " prefix kiro uses for response lines
                    if line.startswith("> "):
                        line = line[2:]

                    # Buffer content
                    full_response_parts.append(line)
                    if is_collecting_questions:
                        ask_questions_content.append(line)

                    yield {"type": "content", "delta": line + "\n"}

            process.wait()

            if process.returncode != 0:
                # ALWAYS lead with the exit code (2026-08-04 live incident):
                # kiro-cli's stderr is chronically noisy (trust banners etc.),
                # and reporting it VERBATIM masked the true cause — a reloader
                # SIGTERM (-15) read as a spurious tool-trust problem. The
                # code is the signal; stderr is appended as context only.
                stderr_output = process.stderr.read().strip() if process.stderr else ""
                error_msg = f"kiro-cli exited with code {process.returncode}" + (
                    f": {stderr_output}" if stderr_output else ""
                )
                logger.error(f"Kiro CLI failed: {error_msg}")
                yield {"type": "error", "message": error_msg}
            else:
                if process.stderr:
                    stderr_output = process.stderr.read().strip()
                    if stderr_output:
                        logger.warning(f"Kiro CLI stderr (exit 0): {stderr_output}")

            end_time = datetime.now()
            logger.info(f"Message streaming completed in {(end_time - start_time).total_seconds():.2f}s")

            # Parse questions from buffered content
            if ask_questions_content:
                questions_buffer = self._parse_questions_from_content(ask_questions_content)
                if questions_buffer:
                    logger.info(f"Parsed {len(questions_buffer)} questions")

            if questions_buffer:
                yield {"type": "questions", "questions": questions_buffer}

            if folder_buffer:
                yield {"type": "folder", "folder": folder_buffer}

        except Exception as e:
            error_msg = f"Error streaming message: {str(e)}"
            logger.error(error_msg, exc_info=True)
            yield {"type": "error", "message": error_msg}
        finally:
            if message_file and message_file.exists():
                try:
                    message_file.unlink()
                except Exception:
                    pass

    def clear_session(self) -> bool:
        """
        Clear the conversation session.

        Kiro CLI sessions are per-directory. We delete the session via
        --delete-session if we can find the session ID, otherwise we
        clear the chat logs directory.
        """
        success = True
        # Try to find and delete the kiro session (kiro_cli_args prefixes
        # 'wsl' on Windows — the bare argv here previously broke there)
        try:
            result = subprocess.run(
                kiro_cli_args(self.kiro_cli_path, self._use_wsl, "chat", "--list-sessions"),
                cwd=str(self.project_dir),
                capture_output=True, text=True, encoding='utf-8', errors='replace',
                timeout=30
            )
            # Parse session IDs from output
            session_ids = re.findall(r'Chat SessionId:\s*([a-f0-9-]+)', _strip_ansi(result.stdout))
            for sid in session_ids:
                subprocess.run(
                    kiro_cli_args(self.kiro_cli_path, self._use_wsl, "chat", "--delete-session", sid),
                    cwd=str(self.project_dir),
                    capture_output=True, text=True, timeout=30
                )
                logger.info(f"Deleted kiro session: {sid}")
        except Exception as e:
            logger.warning(f"Failed to clear kiro sessions: {e}")
            success = False

        # Clear chat logs
        if self.chat_logs_dir.exists():
            try:
                shutil.rmtree(self.chat_logs_dir)
                self.chat_logs_dir.mkdir(parents=True, exist_ok=True)
                logger.info(f"Cleared chat logs: {self.chat_logs_dir}")
            except Exception as e:
                logger.error(f"Failed to clear chat logs: {e}")
                success = False

        return success

    def get_session_file(self) -> Path:
        """
        Get path to session storage.

        Kiro CLI stores sessions in its internal database, not as individual files.
        We return a synthetic path for interface compatibility.
        """
        return self.project_dir / ".kiro" / "sessions" / f"{self.session_uuid}.json"

    def persist_session_to_spec(self, spec_name: str) -> None:
        """Write active_session.json into the spec folder for recovery."""
        spec_dir = self.project_dir / "haikai" / "specs" / spec_name
        if not spec_dir.exists():
            logger.warning(f"Spec dir does not exist: {spec_dir}")
            return

        active_session = {
            "session_id": self.session_uuid,
            "created_at": datetime.now().isoformat(),
            "spec_name": spec_name,
            "executor": "kiro",
        }

        active_session_path = spec_dir / "active_session.json"
        active_session_path.write_text(json.dumps(active_session, indent=2), encoding="utf-8")
        logger.info(f"Wrote active_session.json to {active_session_path}")

    def restore_session_from_spec(self) -> Optional[str]:
        """
        Kiro CLI sessions are per-directory and auto-resumed with --resume.
        No explicit restoration needed. Returns None.
        """
        return None

    def _parse_questions_from_content(self, content_chunks: list) -> list:
        """Parse questions from buffered /ask-questions content.

        Delegates to :mod:`src.chat.question_parser` — see that module for
        pattern details. Kept as an instance method so existing callers
        and polymorphic dispatch keep working.
        """
        from src.chat.question_parser import parse_questions

        return parse_questions(content_chunks)
