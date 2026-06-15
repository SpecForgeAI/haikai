"""
API-based Command Executor for Haikai workflows.

Replaces ClaudeCLIExecutor by using the Anthropic API directly (via OAuth tokens)
instead of shelling out to the Claude CLI. This avoids the root user restriction
and provides more control over the execution.

Commands supported:
- /write-spec: Reads requirements, generates spec.md
- /create-tasks: Reads spec.md, generates tasks.md  
- /implement-tasks: Reads tasks.md, generates implementation files
"""

import json
import logging
import os
import re
from pathlib import Path
from typing import Optional, Dict, Any, List
from datetime import datetime

logger = logging.getLogger(__name__)


class APICommandExecutor:
    """
    Executes Haikai commands using the Anthropic API directly.
    
    Instead of running Claude CLI as a subprocess, this executor:
    1. Reads the relevant input files (requirements.md, spec.md, etc.)
    2. Compiles the command template with all {{...}} references resolved
    3. Sends the compiled prompt to the Anthropic API
    4. Writes the output to the expected file locations
    """
    
    def __init__(self, project_dir: str, anthropic_api_key: str, model: str = None):
        """
        Initialize the API command executor.
        
        Args:
            project_dir: Path to the project directory
            anthropic_api_key: Anthropic API key or OAuth token
            model: Model to use (defaults to CHAT_MODEL env var or claude-sonnet-4-5-20250929)
        """
        self.project_dir = Path(project_dir)
        self.anthropic_api_key = anthropic_api_key
        self.model = model or os.environ.get('CHAT_MODEL', 'claude-sonnet-4-5-20250929')
        
        # Verify project directory exists
        if not self.project_dir.exists():
            raise ValueError(f"Project directory does not exist: {project_dir}")
        
        # Setup paths
        self.project_root = Path(__file__).parent.parent
        self.profiles_dir = self.project_root / "haikai-profiles" / "default"
        
        # Create Anthropic client
        self._create_client()
        
        logger.info(f"Initialized APICommandExecutor for project: {project_dir}")
        logger.info(f"  Model: {self.model}")
    
    def _create_client(self):
        """Create Anthropic client with proper auth."""
        from anthropic import Anthropic
        
        self.is_oauth = "sk-ant-oat" in self.anthropic_api_key
        
        beta_features = [
            "claude-code-20250219",
            "oauth-2025-04-20",
        ]
        
        default_headers = {
            "anthropic-beta": ",".join(beta_features),
            "user-agent": "claude-cli/2.1.2 (external, cli)",
            "x-app": "cli",
        }
        
        if self.is_oauth:
            saved_key = os.environ.pop("ANTHROPIC_API_KEY", None)
            try:
                self.client = Anthropic(
                    auth_token=self.anthropic_api_key,
                    default_headers=default_headers,
                )
            finally:
                if saved_key is not None:
                    os.environ["ANTHROPIC_API_KEY"] = saved_key
        else:
            self.client = Anthropic(
                api_key=self.anthropic_api_key,
                default_headers=default_headers,
            )
    
    def _resolve_template(self, content: str, depth: int = 0) -> str:
        """Delegate to the shared resolver (see `src/chat/template_resolver.py`)."""
        from .chat.template_resolver import resolve_template  # lazy
        return resolve_template(content, self.profiles_dir, depth)
    
    def _load_command_template(self, command_name: str) -> str:
        """Load and compile a command template."""
        template_path = self.profiles_dir / "commands" / command_name / "single-agent" / f"{command_name}.md"
        if not template_path.exists():
            raise FileNotFoundError(f"Command template not found: {template_path}")
        
        raw = template_path.read_text(encoding='utf-8')
        compiled = self._resolve_template(raw)
        logger.info(f"Compiled {command_name} template: {len(raw)} -> {len(compiled)} chars")
        return compiled
    
    def _find_spec_dir(self, spec_reference: str) -> Path:
        """Find the spec directory from a reference like 'for login-endpoint'."""
        # Extract spec name from command like "/write-spec for login-endpoint"
        match = re.search(r'for\s+(\S+)', spec_reference)
        if match:
            spec_name = match.group(1)
        else:
            spec_name = spec_reference.strip()
        
        spec_dir = self.project_dir / "haikai" / "specs" / spec_name
        return spec_dir
    
    def execute(
        self,
        command: str,
        system_prompt: Optional[str] = None,
        timeout: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Execute an Haikai command via the API.
        
        Args:
            command: The command to execute (e.g., "/write-spec for login-endpoint")
            system_prompt: Optional additional system prompt
            timeout: Not used (kept for interface compatibility)
        
        Returns:
            Dictionary with success, stdout, stderr, execution_time, timestamp
        """
        start_time = datetime.now()
        
        try:
            # Parse command
            parts = command.strip().split(None, 1)
            cmd_name = parts[0].lstrip('/')
            cmd_args = parts[1] if len(parts) > 1 else ""
            
            logger.info(f"Executing API command: /{cmd_name} {cmd_args}")
            
            if cmd_name == "write-spec":
                result = self._execute_write_spec(cmd_args)
            elif cmd_name == "create-tasks":
                result = self._execute_create_tasks(cmd_args)
            elif cmd_name == "implement-tasks":
                result = self._execute_implement_tasks(cmd_args, system_prompt)
            else:
                result = {"success": False, "output": "", "error": f"Unknown command: /{cmd_name}"}
            
            end_time = datetime.now()
            execution_time = (end_time - start_time).total_seconds()
            
            return {
                "success": result["success"],
                "return_code": 0 if result["success"] else 1,
                "stdout": result.get("output", ""),
                "stderr": result.get("error", ""),
                "execution_time": execution_time,
                "timestamp": start_time.isoformat()
            }
            
        except Exception as e:
            end_time = datetime.now()
            execution_time = (end_time - start_time).total_seconds()
            logger.error(f"API command execution failed: {e}", exc_info=True)
            return {
                "success": False,
                "return_code": 1,
                "stdout": "",
                "stderr": str(e),
                "execution_time": execution_time,
                "timestamp": start_time.isoformat()
            }
    
    def _call_api(self, system_content: str, user_message: str) -> str:
        """Make a single API call and return the response text."""
        system_blocks = [
            {
                "type": "text",
                "text": "You are Claude Code, Anthropic's official CLI for Claude.",
                "cache_control": {"type": "ephemeral"},
            },
            {
                "type": "text",
                "text": system_content,
                "cache_control": {"type": "ephemeral"},
            }
        ]
        
        response = self.client.messages.create(
            model=self.model,
            max_tokens=16384,
            system=system_blocks,
            messages=[{"role": "user", "content": user_message}],
        )
        
        return response.content[0].text
    
    def _execute_write_spec(self, args: str) -> Dict[str, Any]:
        """Execute /write-spec command via API."""
        spec_dir = self._find_spec_dir(args)
        requirements_file = spec_dir / "planning" / "requirements.md"
        
        if not requirements_file.exists():
            return {"success": False, "error": f"Requirements not found: {requirements_file}"}
        
        requirements = requirements_file.read_text(encoding='utf-8')
        
        # Check for visual assets
        visuals_dir = spec_dir / "planning" / "visuals"
        visual_files = []
        if visuals_dir.exists():
            visual_files = [f.name for f in visuals_dir.iterdir() if f.is_file()]
        
        # Load and compile the write-spec template
        template = self._load_command_template("write-spec")
        
        # Build the user message with all context
        spec_name = spec_dir.name
        user_message = f"""Execute the /write-spec command for spec: {spec_name}

## Requirements (from planning/requirements.md):

{requirements}

## Visual Assets:
{"None" if not visual_files else chr(10).join(visual_files)}

## Instructions:
1. Analyze the requirements above
2. Generate a comprehensive specification document following the template structure
3. Output ONLY the content of spec.md - no explanations, no code fences wrapping the whole thing
4. The spec should be written to: haikai/specs/{spec_name}/spec.md
5. Start your response directly with the markdown content of the spec (starting with # Specification: ...)"""
        
        # Call API
        logger.info(f"Calling API for write-spec ({spec_name})")
        response = self._call_api(template, user_message)
        
        # Write spec.md
        spec_file = spec_dir / "spec.md"
        spec_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Clean response if wrapped in code fences
        content = response.strip()
        if content.startswith("```markdown"):
            content = content[len("```markdown"):].strip()
        if content.startswith("```"):
            content = content[3:].strip()
        if content.endswith("```"):
            content = content[:-3].strip()
        
        spec_file.write_text(content, encoding='utf-8')
        logger.info(f"Wrote spec.md: {len(content)} chars to {spec_file}")
        
        return {"success": True, "output": f"spec.md created at {spec_file} ({len(content)} chars)"}
    
    def _execute_create_tasks(self, args: str) -> Dict[str, Any]:
        """Execute /create-tasks command via API."""
        spec_dir = self._find_spec_dir(args)
        spec_file = spec_dir / "spec.md"
        
        if not spec_file.exists():
            return {"success": False, "error": f"spec.md not found: {spec_file}"}
        
        spec_content = spec_file.read_text(encoding='utf-8')
        
        # Load template
        template = self._load_command_template("create-tasks")
        
        spec_name = spec_dir.name
        user_message = f"""Execute the /create-tasks command for spec: {spec_name}

## Specification (from spec.md):

{spec_content}

## Instructions:
1. Analyze the specification above
2. Break it down into implementable task groups and tasks
3. Output ONLY the content of tasks.md - no explanations
4. Start directly with the markdown content"""
        
        logger.info(f"Calling API for create-tasks ({spec_name})")
        response = self._call_api(template, user_message)
        
        # Write tasks.md
        tasks_file = spec_dir / "tasks.md"
        content = response.strip()
        if content.startswith("```markdown"):
            content = content[len("```markdown"):].strip()
        if content.startswith("```"):
            content = content[3:].strip()
        if content.endswith("```"):
            content = content[:-3].strip()
        
        tasks_file.write_text(content, encoding='utf-8')
        logger.info(f"Wrote tasks.md: {len(content)} chars to {tasks_file}")
        
        return {"success": True, "output": f"tasks.md created at {tasks_file} ({len(content)} chars)"}
    
    def _execute_implement_tasks(self, args: str, system_prompt: Optional[str] = None) -> Dict[str, Any]:
        """Execute /implement-tasks command via API."""
        spec_dir = self._find_spec_dir(args)
        tasks_file = spec_dir / "tasks.md"
        spec_file = spec_dir / "spec.md"
        
        if not tasks_file.exists():
            return {"success": False, "error": f"tasks.md not found: {tasks_file}"}
        
        tasks_content = tasks_file.read_text(encoding='utf-8')
        spec_content = spec_file.read_text(encoding='utf-8') if spec_file.exists() else "(spec.md not available)"
        
        # Load template
        template = self._load_command_template("implement-tasks")
        
        extra_system = f"\n\n{system_prompt}" if system_prompt else ""
        
        spec_name = spec_dir.name
        user_message = f"""Execute the /implement-tasks command for spec: {spec_name}

## Specification:

{spec_content}

## Tasks:

{tasks_content}

## Instructions:
1. Implement ALL task groups without asking for confirmation
2. For each file that should be created, output it in the following format:

===FILE: path/to/file.ext===
file content here
===END FILE===

3. Include ALL files needed for the implementation
4. Do not skip any tasks{extra_system}"""
        
        logger.info(f"Calling API for implement-tasks ({spec_name})")
        response = self._call_api(template + extra_system, user_message)
        
        # Parse and write implementation files to project root (not spec folder)
        # This allows multiple specs to contribute to the same codebase
        impl_dir = self.project_dir
        
        files_written = self._parse_and_write_files(response, impl_dir)
        
        # If no ===FILE:=== markers found, write the whole response as implementation notes
        # Notes go in the spec folder since they're spec-specific
        if not files_written:
            notes_dir = spec_dir / "implementation"
            notes_dir.mkdir(parents=True, exist_ok=True)
            notes_file = notes_dir / "implementation-notes.md"
            notes_file.write_text(response, encoding='utf-8')
            files_written = [str(notes_file)]
            logger.info(f"No file markers found, wrote implementation notes to spec folder")
        
        logger.info(f"Implement-tasks created {len(files_written)} files")
        
        return {
            "success": True, 
            "output": f"Created {len(files_written)} implementation files in project root: {impl_dir}"
        }
    
    def _parse_and_write_files(self, response: str, base_dir: Path) -> List[str]:
        """Parse ===FILE: path=== blocks and write files."""
        files_written = []
        
        # Pattern: ===FILE: path/to/file.ext===\ncontent\n===END FILE===
        pattern = r'===FILE:\s*(.+?)===\s*\n(.*?)===END FILE==='
        matches = re.findall(pattern, response, re.DOTALL)
        
        for file_path, content in matches:
            file_path = file_path.strip()
            # Security: prevent path traversal
            if '..' in file_path:
                logger.warning(f"Skipping file with path traversal: {file_path}")
                continue
            
            full_path = base_dir / file_path
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(content.strip(), encoding='utf-8')
            files_written.append(str(full_path))
            logger.info(f"  Wrote: {file_path} ({len(content)} chars)")
        
        return files_written
