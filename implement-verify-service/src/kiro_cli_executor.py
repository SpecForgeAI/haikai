"""
Kiro CLI Executor for Haikai Orchestration.

Drop-in replacement for ClaudeCLIExecutor that uses kiro-cli instead of
Claude Code CLI for non-interactive command execution (write-spec,
create-tasks, implement-tasks).

Key differences from ClaudeCLIExecutor:
- Uses kiro-cli chat --no-interactive --trust-all-tools
- No --print or --output-format flags (kiro outputs ANSI text)
- No --session-id (sessions are per-directory)
- Skills loaded via .kiro/skills/ directory
- Auth via SSO (no ANTHROPIC_API_KEY needed)
"""

import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime

from .chat.model_pinning import describe_pinned_model, kiro_pinned_model, model_args
from .kiro_cli_locator import kiro_cli_args, locate_kiro_cli

logger = logging.getLogger(__name__)

# ANSI escape sequence pattern
_ANSI_RE = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]|\x1b\[\?[0-9;]*[a-zA-Z]')


def _strip_ansi(text: str) -> str:
    """Remove ANSI escape sequences from text."""
    return _ANSI_RE.sub('', text)


class KiroCLIExecutor:
    """
    Wrapper class for executing Haikai commands via kiro-cli.

    Same interface as ClaudeCLIExecutor so the orchestrator can use either.
    """

    def __init__(self, project_dir: str, anthropic_api_key: str = ""):
        """
        Initialize the Kiro CLI executor.

        Args:
            project_dir: Absolute path to the project directory
            anthropic_api_key: Not used (kiro-cli uses SSO auth), kept for interface compat
        """
        self.project_dir = Path(project_dir)

        if not self.project_dir.exists():
            raise ValueError(f"Project directory does not exist: {project_dir}")

        # Find kiro-cli
        self.kiro_cli_path = self._find_kiro_cli()

        # Setup skills
        self._setup_skills()

        # Model pinned on EVERY kiro-cli chat spawn (see chat/model_pinning.py)
        self.model = kiro_pinned_model()

        logger.info(f"Initialized KiroCLIExecutor for project: {project_dir}")
        logger.info(f"  Model: {describe_pinned_model(self.model)}")

    def _find_kiro_cli(self) -> Path:
        """Locate kiro-cli via the shared locator (login-shell-aware WSL
        probing lives in src/kiro_cli_locator.py — do not add probes here)."""
        cli_path, self._use_wsl = locate_kiro_cli()
        return Path(cli_path)

    def _setup_skills(self):
        """Setup .kiro/skills/ directory with haikai command skills."""
        project_root = Path(__file__).parent.parent
        haikai_profiles = project_root / "haikai-profiles" / "default"
        kiro_dir = self.project_dir / ".kiro"
        skills_dir = kiro_dir / "skills" / "haikai"

        if not haikai_profiles.exists():
            logger.warning(f"haikai-profiles not found: {haikai_profiles}")
            return

        skills_dir.mkdir(parents=True, exist_ok=True)

        # MUST cover every HaikaiOrchestrator.COMMANDS entry (2026-07-28:
        # git-commit-preparation was missing from the sibling chat-executor
        # list — step 4 had no skill to execute).
        commands = [
            "write-spec", "create-tasks", "implement-tasks",
            "shape-spec", "plan-product", "git-commit-preparation",
        ]

        for cmd_name in commands:
            source = haikai_profiles / "commands" / cmd_name / "single-agent" / f"{cmd_name}.md"
            if not source.exists():
                continue

            cmd_dir = skills_dir / cmd_name
            cmd_dir.mkdir(parents=True, exist_ok=True)
            skill_md = cmd_dir / "SKILL.md"

            try:
                raw = source.read_text(encoding='utf-8')
                resolved = self._resolve_template(raw, haikai_profiles)
                content = (
                    f"---\n"
                    f"name: {cmd_name}\n"
                    f"description: Haikai {cmd_name} command\n"
                    f"---\n\n"
                    f"{resolved}\n"
                )
                skill_md.write_text(content, encoding='utf-8')
            except Exception as e:
                logger.warning(f"Failed to setup skill {cmd_name}: {e}")

    def _resolve_template(self, content: str, profiles_dir: Path, depth: int = 0) -> str:
        """Delegate to the shared resolver (see `src/chat/template_resolver.py`)."""
        from .chat.template_resolver import resolve_template  # lazy
        return resolve_template(content, profiles_dir, depth)

    def execute(
        self,
        command: str,
        system_prompt: Optional[str] = None,
        timeout: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Execute a command via kiro-cli in non-interactive mode.

        Args:
            command: The Haikai command (e.g., "/write-spec for login-endpoint")
            system_prompt: Optional additional context prepended to the command
            timeout: Command timeout in seconds. None = unlimited.

        Returns:
            Dictionary with: success, return_code, stdout, stderr, execution_time, timestamp
        """
        start_time = datetime.now()

        # Build the full prompt
        full_prompt = f"{system_prompt}\n\n{command}" if system_prompt else command

        # wsl-prefixed on Windows by the shared builder; the model is pinned
        # explicitly on every spawn (model_args is empty when disabled)
        cli_args = kiro_cli_args(
            self.kiro_cli_path, self._use_wsl,
            "chat", "--no-interactive", "--trust-all-tools", "--wrap", "never",
            *model_args(self.model),
            full_prompt,
        )

        timeout_str = f"{timeout}s" if timeout else "unlimited"
        logger.info(f"Executing: {command} (timeout: {timeout_str})")

        try:
            actual_timeout = None if timeout == 0 else timeout

            # Popen, not blocking subprocess.run — D13 parity with
            # ClaudeCLIExecutor (2026-07-28): the spawned tree must be a
            # TRACKED, killable handle for the cancel watchdog, not trapped
            # inside a blocking call. POSIX: new session → group-killable;
            # Windows: the pid is wsl.exe's, killing it ends the kiro run.
            popen_kwargs = dict(
                cwd=str(self.project_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                errors='replace',
            )
            if os.name == "posix":
                popen_kwargs["start_new_session"] = True
            proc = subprocess.Popen(cli_args, **popen_kwargs)
            on_spawn = getattr(self, "on_spawn", None)
            if on_spawn:
                try:
                    on_spawn(proc.pid)
                except Exception:
                    logger.warning("on_spawn callback failed", exc_info=True)
            try:
                stdout, stderr = proc.communicate(timeout=actual_timeout)
            except subprocess.TimeoutExpired:
                from src.job_queue.process_tracking import kill_tree
                kill_tree(proc.pid)
                proc.wait()
                raise
            result = subprocess.CompletedProcess(
                cli_args, proc.returncode, stdout, stderr)

            end_time = datetime.now()
            execution_time = (end_time - start_time).total_seconds()

            # Strip ANSI from output
            stdout_clean = _strip_ansi(result.stdout)
            stderr_clean = _strip_ansi(result.stderr) if result.stderr else ""

            execution_result = {
                "success": result.returncode == 0,
                "return_code": result.returncode,
                "stdout": stdout_clean,
                "stderr": stderr_clean,
                "execution_time": execution_time,
                "timestamp": start_time.isoformat(),
                "command": command,
                "cli_args": cli_args,
            }

            if result.returncode == 0:
                logger.info(f"Command succeeded: {command} ({execution_time:.2f}s)")
            else:
                logger.error(f"Command failed (code {result.returncode}): {command}")
                if stderr_clean:
                    logger.error(f"stderr: {stderr_clean[:500]}")

            return execution_result

        except subprocess.TimeoutExpired:
            end_time = datetime.now()
            execution_time = (end_time - start_time).total_seconds()
            logger.error(f"Command timed out after {timeout}s: {command}")
            return {
                "success": False,
                "return_code": -1,
                "stdout": "",
                "stderr": f"Command timed out after {timeout} seconds",
                "execution_time": execution_time,
                "timestamp": start_time.isoformat(),
                "command": command,
                "cli_args": cli_args,
            }

        except Exception as e:
            end_time = datetime.now()
            execution_time = (end_time - start_time).total_seconds()
            logger.error(f"Unexpected error: {command}", exc_info=True)
            return {
                "success": False,
                "return_code": -1,
                "stdout": "",
                "stderr": str(e),
                "execution_time": execution_time,
                "timestamp": start_time.isoformat(),
                "command": command,
                "cli_args": cli_args,
            }

