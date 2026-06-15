"""
Tool Executor for Claude Code tools.

Executes tool calls using Anthropic SDK's official tool calling API:
- write_to_file: Create/update files
- bash: Execute shell commands
- read_file: Read file contents
"""

import json
import logging
import os
import platform
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)


_MAX_READ_BYTES = 1024 * 1024  # 1 MB
"""Hard cap for read_file. The LLM-issued read tool used to call
read_text() with no cap; an LLM prompted to read a sparse file or huge
log could OOM the worker. 1 MB is the cap chosen 2026-05-04: it lands
under GPT-5.4's 272K-token cost cliff (~290K tokens at 3.5 bytes/tok)
and well inside Claude Sonnet 4.6 / Opus 4.7's 1M context, while still
being generous enough that source-code reads almost never trip it."""


class ToolExecutor:
    """Executes tool calls using Anthropic SDK's official tool calling API."""

    def __init__(self, workspace_dir: Path):
        """
        Initialize tool executor.

        Args:
            workspace_dir: Base workspace directory for file operations
        """
        self.workspace_dir = workspace_dir
        logger.info(f"Initialized ToolExecutor with workspace: {workspace_dir}")

    def _safe_workspace_path(self, path: str) -> Path:
        """Resolve `path` under workspace_dir, rejecting traversal escapes.

        Blocks both absolute paths (which would win the `Path /` join under
        Python's "absolute right side wins" rule) and `..` chains that
        resolve outside the workspace. Same defense pattern that landed in
        endpoint_discoverer (commit 51603da) and interaction_agent (ef93ad7);
        applied here so the LLM can't read or write outside the project.
        """
        if not isinstance(path, str) or not path:
            raise ValueError("path must be a non-empty string")
        ws = Path(self.workspace_dir).resolve()
        candidate = (ws / path).resolve()
        try:
            candidate.relative_to(ws)
        except ValueError:
            raise ValueError(
                f"path escapes workspace: {path!r} (workspace={ws})"
            )
        return candidate
    
    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        """
        Get Anthropic SDK tool schemas for write_to_file, bash, and read_file.
        
        Returns:
            List of tool schema dictionaries for messages.create(tools=...)
        """
        return [
            {
                "name": "write_to_file",
                "description": "Write content to a file. Creates parent directories if needed. Use for creating or updating files.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path to the file relative to workspace (e.g., 'haikai/product/mission.md')"
                        },
                        "content": {
                            "type": "string",
                            "description": "Complete file content to write"
                        }
                    },
                    "required": ["path", "content"]
                }
            },
            {
                "name": "bash",
                "description": "Execute a bash command in the workspace directory. Returns stdout and stderr. Timeout: 30 seconds.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "Bash command to execute"
                        }
                    },
                    "required": ["command"]
                }
            },
            {
                "name": "read_file",
                "description": "Read the contents of a file from the workspace.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path to the file relative to workspace"
                        }
                    },
                    "required": ["path"]
                }
            }
        ]
    
    def execute_tool(self, tool_name: str, tool_input: Dict[str, Any]) -> str:
        """
        Execute a tool call from Anthropic SDK.
        
        Args:
            tool_name: Name of the tool (write_to_file, bash, read_file)
            tool_input: Tool input parameters from SDK
            
        Returns:
            Tool result string (for SDK tool_result content)
        """
        try:
            if tool_name == "write_to_file":
                result = self._execute_write_to_file(tool_input)
            elif tool_name == "bash":
                result = self._execute_bash(tool_input)
            elif tool_name == "read_file":
                result = self._execute_read_file(tool_input)
            else:
                return f"Error: Unknown tool: {tool_name}"
            
            if result["success"]:
                return result["output"]
            else:
                return f"Error: {result['error']}"
                
        except Exception as e:
            logger.error(f"Tool execution failed: {tool_name}", exc_info=True)
            return f"Error: {str(e)}"
    
    def _execute_write_to_file(self, params: Dict[str, str]) -> Dict[str, Any]:
        """Execute write_to_file tool."""
        import re

        path = params["path"]


        escaped = path.encode("unicode_escape").decode("ascii")
        if re.search(r'[\uE000-\uF8FF]', path) or "" in path:
            logger.error("Invalid glyph in path", extra={"path": escaped})
            raise RuntimeError(f"Invalid glyph in path: {escaped}")

        content = params["content"]

        # Resolve path relative to workspace, rejecting traversal escapes.
        file_path = self._safe_workspace_path(path)
        logger.info("write_to_file path=%s", path.encode("unicode_escape").decode("ascii"))

        # Create parent directories
        file_path.parent.mkdir(parents=True, exist_ok=True)

        # Write file
        file_path.write_text(content, encoding='utf-8')
        
        logger.info(f"✓ Wrote file: {file_path}")


        return {
            "success": True,
            "output": f"Successfully wrote {len(content)} bytes to {path}",
            "error": None
        }

    def _execute_bash(self, params: Dict[str, str]) -> Dict[str, Any]:
        command = params["command"]

        # Log raw command with escapes
        logger.info("tool_cmd=%s", command.encode("unicode_escape").decode("ascii"))

        # On Linux (e.g. Docker container), always use bash — cmd.exe/PowerShell don't exist
        _is_linux = platform.system() != "Windows"

        # Heuristic: CMD-specific tokens (Windows only)
        is_cmd = not _is_linux and (
            bool(re.search(r'(^|\s)(if\s+exist|2>nul|nul\s*(&|\)|$)|\bdir\b|\bcopy\b|\bdel\b|\brd\b|\bmd\b)', command, re.I))
            or " & " in command  # cmd chaining
        )

        # Heuristic: PowerShell (Windows only)
        is_powershell = not _is_linux and command.strip().lower().startswith(("powershell ", "pwsh "))

        try:
            if is_powershell:
                logger.info("Routing to PowerShell")
                result = subprocess.run(
                    command,  # already contains powershell -Command ...
                    cwd=self.workspace_dir,
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=600
                )
            elif is_cmd:
                logger.info("Routing to cmd.exe")
                result = subprocess.run(
                    ["cmd.exe", "/c", command],
                    cwd=self.workspace_dir,
                    capture_output=True,
                    text=True,
                    timeout=600
                )
            else:
                bash = shutil.which("bash")
                if not bash:
                    logger.error("bash not found; cannot run bash command", extra={"command_preview": command[:200]})
                    raise RuntimeError("bash not found on PATH.")
                logger.info("Routing to bash")
                result = subprocess.run(
                    [bash, "-lc", command],
                    cwd=self.workspace_dir,
                    capture_output=True,
                    text=True,
                    timeout=600
                )

            out = (result.stdout or "") + (result.stderr or "")
            return {
                "success": result.returncode == 0,
                "output": out,
                "error": None if result.returncode == 0 else f"Exit code {result.returncode}"
            }

        except Exception:
            logger.exception("Command execution failed", extra={"command_preview": command[:200]})
            raise

    @staticmethod
    def _split_chain(command: str):
        """Split a command string on && and ; into (operator, cmd) pairs.

        Returns a list of (operator, command_str) tuples.
        The first element has operator=None.

        Example:
            "mkdir -p foo && echo done ; ls"
            → [(None, "mkdir -p foo"), ("&&", "echo done"), (";", "ls")]
        """
        segments = []
        current = []
        # Track whether we're inside quotes
        in_quote = None

        i = 0
        chars = command
        while i < len(chars):
            c = chars[i]

            # Handle quotes
            if c in ('"', "'") and in_quote is None:
                in_quote = c
                current.append(c)
                i += 1
                continue
            if c == in_quote:
                in_quote = None
                current.append(c)
                i += 1
                continue

            # Only split outside quotes
            if in_quote is None:
                # Check for &&
                if c == '&' and i + 1 < len(chars) and chars[i + 1] == '&':
                    segments.append("".join(current).strip())
                    current = []
                    segments.append("&&")
                    i += 2
                    continue
                # Check for ;
                if c == ';':
                    segments.append("".join(current).strip())
                    current = []
                    segments.append(";")
                    i += 1
                    continue

            current.append(c)
            i += 1

        # Last segment
        trailing = "".join(current).strip()
        if trailing:
            segments.append(trailing)

        # Convert flat list into (operator, cmd) pairs
        result = []
        op = None
        for s in segments:
            if s in ("&&", ";"):
                op = s
            else:
                result.append((op, s))
                op = None
        return result

    def _execute_single_command(self, command: str) -> Dict[str, Any]:
        """Execute a single command."""
        try:
            # date +%Y-%m-%d
            if match := re.match(r'^date \+(.+)$', command):
                fmt = match.group(1)
                return {"success": True, "output": datetime.now().strftime(fmt), "error": None}

            # echo
            if match := re.match(r'^echo\s+(.*)$', command):
                text = match.group(1).strip('"\'')
                return {"success": True, "output": text, "error": None}

            # pwd
            if command in ('pwd', 'cd'):
                return {"success": True, "output": self.workspace_dir, "error": None}

            # mkdir -p
            if match := re.match(r'^mkdir(?:\s+-p)?\s+["\']?(.+?)["\']?\s*$', command):
                path = self._resolve_path(match.group(1))
                os.makedirs(path, exist_ok=True)
                return {"success": True, "output": f"Created {path}", "error": None}

            # cat
            if match := re.match(r'^cat\s+["\']?(.+?)["\']?\s*$', command):
                path = self._resolve_path(match.group(1))
                content = Path(path).read_text(encoding='utf-8')
                return {"success": True, "output": content, "error": None}

            # ls / dir
            if match := re.match(r'^(?:ls|dir)(?:\s+-\w+)*(?:\s+["\']?(.+?)["\']?)?\s*$', command):
                path = self._resolve_path(match.group(1)) if match.group(1) else self.workspace_dir
                items = os.listdir(path)
                return {"success": True, "output": '\n'.join(items), "error": None}

            # cd (validate)
            if match := re.match(r'^cd\s+["\']?(.+?)["\']?\s*$', command):
                path = self._resolve_path(match.group(1))
                if os.path.isdir(path):
                    return {"success": True, "output": path, "error": None}
                return {"success": False, "output": "", "error": f"Not found: {path}"}

            # rm
            if match := re.match(r'^rm\s+(?:-rf?\s+)?["\']?(.+?)["\']?\s*$', command):
                path = self._resolve_path(match.group(1))
                if os.path.isdir(path):
                    shutil.rmtree(path)
                elif os.path.exists(path):
                    os.remove(path)
                return {"success": True, "output": f"Removed {path}", "error": None}

            # cp
            if match := re.match(r'^cp\s+(?:-r\s+)?["\']?(.+?)["\']?\s+["\']?(.+?)["\']?\s*$', command):
                src = self._resolve_path(match.group(1))
                dst = self._resolve_path(match.group(2))
                if os.path.isdir(src):
                    shutil.copytree(src, dst, dirs_exist_ok=True)
                else:
                    shutil.copy2(src, dst)
                return {"success": True, "output": f"Copied {src} to {dst}", "error": None}

            # mv
            if match := re.match(r'^mv\s+["\']?(.+?)["\']?\s+["\']?(.+?)["\']?\s*$', command):
                src = self._resolve_path(match.group(1))
                dst = self._resolve_path(match.group(2))
                shutil.move(src, dst)
                return {"success": True, "output": f"Moved {src} to {dst}", "error": None}

            # touch
            if match := re.match(r'^touch\s+["\']?(.+?)["\']?\s*$', command):
                path = self._resolve_path(match.group(1))
                Path(path).parent.mkdir(parents=True, exist_ok=True)
                Path(path).touch()
                return {"success": True, "output": f"Touched {path}", "error": None}

            # Fallback
            logger.info(f"Fallback subprocess: {command[:50]}...")
            result = subprocess.run(command, shell=True, cwd=self.workspace_dir,
                                    capture_output=True, text=True, timeout=30)
            return {
                "success": result.returncode == 0,
                "output": result.stdout + result.stderr,
                "error": None if result.returncode == 0 else f"Exit code {result.returncode}"
            }

        except Exception as e:
            logger.error(f"Command failed: {command}", exc_info=True)
            return {"success": False, "output": "", "error": str(e)}

    def _resolve_path(self, path: str) -> str:
        """Resolve path relative to workspace."""
        path = path.strip().strip('"\'')
        if os.path.isabs(path):
            return path
        return os.path.join(self.workspace_dir, path)

    def _execute_read_file(self, params: Dict[str, str]) -> Dict[str, Any]:
        """Execute read_file tool."""
        path = params["path"]

        # Resolve path relative to workspace, rejecting traversal escapes.
        file_path = self._safe_workspace_path(path)

        if not file_path.exists():
            return {
                "success": False,
                "output": "",
                "error": f"File not found: {path}"
            }

        # Cap size BEFORE reading so a hostile path (huge log, sparse file,
        # symlink target chosen by an LLM) can't OOM the worker.
        size = file_path.stat().st_size
        if size > _MAX_READ_BYTES:
            return {
                "success": False,
                "output": "",
                "error": (
                    f"File too large: {size:,} bytes exceeds the "
                    f"{_MAX_READ_BYTES:,}-byte read_file cap. Use grep "
                    f"or a structural-store query instead."
                ),
            }

        # Encoding stays strict — we want a clean UnicodeDecodeError on
        # binary content rather than silent corruption from errors='replace'
        # (the LLM gets actionable feedback that the file is binary).
        content = file_path.read_text(encoding='utf-8')

        logger.info(f"✓ Read file: {file_path} ({len(content)} bytes)")
        
        return {
            "success": True,
            "output": content,
            "error": None
        }

