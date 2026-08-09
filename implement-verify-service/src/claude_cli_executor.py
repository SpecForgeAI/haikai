"""
Claude CLI Executor for Haikai Orchestration.

This module provides a wrapper around the Claude Code CLI to execute
Haikai commands programmatically without user interaction.
"""

import os
import shutil
import subprocess
import json
import logging
import platform
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime

from .chat.model_pinning import claude_pinned_model, describe_pinned_model, model_args

# `pwd` is POSIX-only. Import lazily so this module can be imported on
# Windows (where `_demote_to_appuser` is never called — the only call site
# at line ~206 short-circuits via `hasattr(os, 'getuid')`).
try:
    import pwd  # type: ignore
except ImportError:  # pragma: no cover — Windows
    pwd = None  # type: ignore

logger = logging.getLogger(__name__)



def _demote_to_appuser():
    """Pre-exec function to drop root privileges to appuser for Claude CLI."""
    import os
    if pwd is None:
        return  # POSIX-only; no-op on Windows
    try:
        pw = pwd.getpwnam('appuser')
        os.setgid(pw.pw_gid)
        os.setuid(pw.pw_uid)
        os.environ['HOME'] = pw.pw_dir
        os.environ['USER'] = 'appuser'
    except (KeyError, PermissionError):
        pass  # appuser doesn't exist or can't switch — run as-is

class ClaudeCLIExecutor:
    """
    Wrapper class for executing Claude Code CLI commands.
    
    This class provides a clean interface for running Haikai commands
    via the `claude` CLI with proper configuration for non-interactive execution.
    """
    
    def __init__(self, project_dir: str, anthropic_api_key: str):
        """
        Initialize the Claude CLI executor.
        
        Args:
            project_dir: Absolute path to the project directory
            anthropic_api_key: Anthropic API key for authentication
        """
        self.project_dir = Path(project_dir)
        self.anthropic_api_key = anthropic_api_key
        
        # Verify project directory exists
        if not self.project_dir.exists():
            raise ValueError(f"Project directory does not exist: {project_dir}")
        
        # Find project-local Claude CLI installation
        project_root = Path(__file__).parent.parent
        
        # On Windows, use .cmd wrapper; on Unix, use the shell script
        if platform.system() == "Windows":
            self.claude_cli_path = project_root / "node_modules" / ".bin" / "claude.cmd"
        else:
            self.claude_cli_path = project_root / "node_modules" / ".bin" / "claude"
        
        # Prefer the project-local CLI; otherwise fall back to a global `claude`
        # on PATH (the same fallback ClaudeChatExecutor uses). Without this the
        # worker's verify-task-group / repair path dies unless the project has a
        # local `npm install`, even when a global Claude CLI is available.
        if self.claude_cli_path.exists():
            logger.info(f"Using project-local Claude CLI: {self.claude_cli_path}")
        else:
            global_cli = shutil.which("claude")
            if not global_cli:
                raise ValueError(
                    f"Claude CLI not found: no project-local install at "
                    f"{self.claude_cli_path} and no 'claude' on PATH. Run "
                    f"'npm install' in the project root or install the Claude CLI globally."
                )
            self.claude_cli_path = Path(global_cli)
            logger.info(f"Using global Claude CLI: {self.claude_cli_path}")
        
        # Setup Haikai commands
        self._setup_claude_commands(project_root)

        # Model pinned on every spawn WHEN LLM_MODEL is set (see
        # chat/model_pinning.py — the env line was ignored on CLI paths).
        self.model = claude_pinned_model()

        logger.info(f"Initialized ClaudeCLIExecutor for project: {project_dir}")
        logger.info(f"  Model: {describe_pinned_model(self.model)}")
    
    def _setup_claude_commands(self, project_root: Path):
        """
        Setup Haikai commands by copying them to Claude's commands directory.
        This mimics what the Docker setup script does.
        
        Args:
            project_root: Path to the project root directory
        """
        import shutil
        import os
        
        # Determine Claude commands directory based on OS
        if platform.system() == "Windows":
            # On Windows, use USERPROFILE
            home_dir = Path(os.environ.get("USERPROFILE", os.path.expanduser("~")))
        else:
            # On Unix-like systems, use HOME
            home_dir = Path(os.path.expanduser("~"))
        
        claude_commands_dir = home_dir / ".claude" / "commands"
        haikai_profiles = project_root / "haikai-profiles" / "default" / "commands"
        
        # Create Claude commands directory if it doesn't exist
        claude_commands_dir.mkdir(parents=True, exist_ok=True)
        
        # List of commands to setup
        commands_to_setup = [
            ("write-spec", "write-spec/single-agent/write-spec.md"),
            ("create-tasks", "create-tasks/single-agent/create-tasks.md"),
            ("implement-tasks", "implement-tasks/single-agent/implement-tasks.md"),
            ("shape-spec", "shape-spec/single-agent/shape-spec.md"),
            ("plan-product", "plan-product/single-agent/plan-product.md"),
            ("run-pipeline", "run-pipeline/run-pipeline.md"),  # flat layout (like orchestrate-tasks)
            ("verify-task-group", "verify-task-group/verify-task-group.md"),  # flat layout
        ]
        
        logger.info(f"Setting up Haikai commands in {claude_commands_dir}")
        
        # Copy-if-absent: every executor init used to unconditionally
        # overwrite the user's ~/.claude/commands/ entries, silently
        # destroying any local customisation. The Docker image is unaffected
        # (fresh appuser) but local devs lost edits on every run. Setting
        # CLAUDE_FORCE_REFRESH_COMMANDS=true restores the old behaviour for
        # operators who want a clean re-sync.
        force_refresh = os.environ.get(
            "CLAUDE_FORCE_REFRESH_COMMANDS", "false"
        ).lower() == "true"

        for command_name, source_path in commands_to_setup:
            source_file = haikai_profiles / source_path
            dest_file = claude_commands_dir / f"{command_name}.md"

            if not source_file.exists():
                logger.debug(f"  ⊘ Source not found for /{command_name}: {source_file}")
                continue

            if dest_file.exists() and not force_refresh:
                logger.debug(f"  ⊙ Skipping /{command_name} (user copy present)")
                continue

            try:
                shutil.copy2(source_file, dest_file)
                logger.debug(f"  ✓ Copied /{command_name}")
            except Exception as e:
                logger.warning(f"  ✗ Failed to copy /{command_name}: {e}")

        # Subagents referenced by commands (the Task tool resolves them from
        # ~/.claude/agents/). Same copy-if-absent semantics as commands.
        claude_agents_dir = home_dir / ".claude" / "agents"
        agents_src = project_root / "haikai-profiles" / "default" / "agents"
        agents_to_setup = [
            "pipeline-orchestrator.md",
            "batch-extractor.md",
            # verification subagents (spec 2026-05-20)
            "verification-loop.md",
            "inline-runner.md",
            "rubric-verifier.md",
            "repair-engine.md",
        ]
        claude_agents_dir.mkdir(parents=True, exist_ok=True)
        for agent_name in agents_to_setup:
            source_file = agents_src / agent_name
            dest_file = claude_agents_dir / agent_name
            if not source_file.exists():
                logger.debug(f"  ⊘ Agent source not found: {source_file}")
                continue
            if dest_file.exists() and not force_refresh:
                logger.debug(f"  ⊙ Skipping agent {agent_name} (user copy present)")
                continue
            try:
                shutil.copy2(source_file, dest_file)
                logger.debug(f"  ✓ Copied agent {agent_name}")
            except Exception as e:
                logger.warning(f"  ✗ Failed to copy agent {agent_name}: {e}")

        logger.info(f"Haikai commands setup complete")
    
    def execute(
        self,
        command: str,
        system_prompt: Optional[str] = None,
        timeout: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Execute a Claude CLI command.
        
        Args:
            command: The Haikai command to execute (e.g., "/write-spec")
            system_prompt: Optional system prompt to append to the command
            timeout: Command timeout in seconds. None means unlimited (no timeout).
        
        Returns:
            Dictionary containing execution results with keys:
                - success: bool
                - return_code: int
                - stdout: str
                - stderr: str
                - execution_time: float
                - timestamp: str
        
        Raises:
            subprocess.TimeoutExpired: If command execution exceeds timeout (when timeout is set)
        """
        start_time = datetime.now()
        
        # Build CLI arguments
        # Get the project root to access haikai-profiles
        project_root = Path(__file__).parent.parent
        haikai_profiles = project_root / "haikai-profiles"
        
        cli_args = [
            str(self.claude_cli_path),
            "--print",  # Print response and exit (non-interactive)
            "--output-format", "json",  # Get structured JSON output
            "--dangerously-skip-permissions",  # Skip all permission prompts
            "--no-session-persistence",  # Don't save sessions
            "--add-dir", str(self.project_dir).replace("\\", "/"),  # Add project directory (Unix paths)
            "--add-dir", str(haikai_profiles).replace("\\", "/"),  # Add haikai-profiles for instruction files
            # Pin the model explicitly when LLM_MODEL is set (empty when not)
            *model_args(self.model),
        ]
        
        # Build the full prompt
        # If system_prompt is provided, prepend it to the command
        if system_prompt:
            full_prompt = f"{system_prompt}\n\n{command}"
        else:
            full_prompt = command
        
        timeout_str = f"{timeout}s" if timeout is not None else "unlimited"
        logger.info(f"Executing command: {command} (timeout: {timeout_str})")
        logger.debug(f"Full CLI args: {' '.join(cli_args)}")
        
        try:
            # Execute the command
            # Build environment variables. OAuth tokens (sk-ant-oat...) must
            # go via CLAUDE_CODE_OAUTH_TOKEN with ANTHROPIC_API_KEY blanked
            # (Bearer + oauth beta) — a raw OAuth token in ANTHROPIC_API_KEY is
            # rejected ("Invalid API key"). Mirrors ClaudeChatExecutor's
            # branching (helper-exists-sibling-missed: the CLI executor lacked
            # it, surfaced when the worker launched a loop session with the
            # OAuth token from .env.session).
            if "sk-ant-oat" in (self.anthropic_api_key or ""):
                env_vars = {
                    **subprocess.os.environ,
                    "CLAUDE_CODE_OAUTH_TOKEN": self.anthropic_api_key,
                    "ANTHROPIC_API_KEY": "",
                }
                logger.info("Using CLAUDE_CODE_OAUTH_TOKEN for OAuth token authentication")
            else:
                env_vars = {
                    **subprocess.os.environ,
                    "ANTHROPIC_API_KEY": self.anthropic_api_key,
                }

            # Only set HAIKAI_PROFILES_PATH if not already in environment
            # This allows .env.local or system environment to take precedence
            if "HAIKAI_PROFILES_PATH" not in env_vars:
                profiles_path = Path(__file__).parent.parent / "haikai-profiles"
                env_vars["HAIKAI_PROFILES_PATH"] = str(profiles_path)
                logger.info(f"Using default profiles path: {profiles_path}")
            else:
                logger.info(f"Using environment HAIKAI_PROFILES_PATH: {env_vars['HAIKAI_PROFILES_PATH']}")
            
            # Treat timeout=0 as None (unlimited) since subprocess.run treats 0 as immediate timeout
            actual_timeout = None if timeout == 0 else timeout
            
            # Drop root privileges for Claude CLI (refuses --dangerously-skip-permissions
            # as root). Linux-container-specific — Windows has no `os.getuid` and runs
            # as a regular user account, so the guard short-circuits.
            preexec = (
                _demote_to_appuser
                if hasattr(os, "getuid") and os.getuid() == 0
                else None
            )
            
            # Popen (not blocking subprocess.run) so the spawned tree is a
            # TRACKED, killable handle (spec v2 D13: cancel = kill the
            # tracked process tree; the handle must not stay trapped inside
            # a blocking call). POSIX: new session → group-killable.
            popen_kwargs = dict(
                cwd=str(self.project_dir),
                env=env_vars,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                errors='replace',
            )
            if preexec is not None:
                popen_kwargs["preexec_fn"] = preexec
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
                stdout, stderr = proc.communicate(
                    input=full_prompt, timeout=actual_timeout)
            except subprocess.TimeoutExpired:
                from src.job_queue.process_tracking import kill_tree
                kill_tree(proc.pid)
                proc.wait()
                raise
            result = subprocess.CompletedProcess(
                cli_args, proc.returncode, stdout, stderr)
            
            end_time = datetime.now()
            execution_time = (end_time - start_time).total_seconds()
            
            # Parse the result
            execution_result = {
                "success": result.returncode == 0,
                "return_code": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "execution_time": execution_time,
                "timestamp": start_time.isoformat(),
                "command": command,
                "cli_args": cli_args
            }
            
            if result.returncode == 0:
                logger.info(f"Command succeeded: {command} (took {execution_time:.2f}s)")
                # Safely log stdout (handle None case)
                if result.stdout:
                    logger.debug(f"stdout: {result.stdout[:500]}...")  # Log first 500 chars
            else:
                logger.error(f"Command failed: {command} (return code: {result.returncode})")
                # Safely log stderr (handle None case)
                if result.stderr:
                    logger.error(f"stderr: {result.stderr}")
            
            return execution_result
            
        except subprocess.TimeoutExpired:
            end_time = datetime.now()
            execution_time = (end_time - start_time).total_seconds()
            
            logger.error(f"Command timed out after {timeout}s: {command}")
            
            return {
                "success": False,
                # Explicit timeout marker (2026-08-09): callers with retry
                # loops must be able to tell "the clock ran out" from "the
                # work failed" — a timeout retry re-issues an identical
                # command into the same wall, so it is never retried.
                "timed_out": True,
                "return_code": -1,
                "stdout": "",
                "stderr": f"Command timed out after {timeout} seconds",
                "execution_time": execution_time,
                "timestamp": start_time.isoformat(),
                "command": command,
                "cli_args": cli_args
            }
        
        except Exception as e:
            end_time = datetime.now()
            execution_time = (end_time - start_time).total_seconds()
            
            logger.error(f"Unexpected error executing command: {command}", exc_info=True)
            
            return {
                "success": False,
                "return_code": -1,
                "stdout": "",
                "stderr": str(e),
                "execution_time": execution_time,
                "timestamp": start_time.isoformat(),
                "command": command,
                "cli_args": cli_args
            }
    
