"""
Service layer for Haikai CRUD operations.

This module provides business logic for managing specifications and tasks,
integrating with HaikaiOrchestrator for workflow execution.
"""

import logging
import shutil
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime
import re

from .haikai_crud_models import (
    SpecSummary,
    SpecDetail,
    SpecListResponse,
    WriteSpecRequest,
    WriteSpecResponse,
    GenerateTasksResponse,
    ImplementRequest,
    ImplementResponse,
    TasksDetail,
    DeleteSpecResponse,
    SpecMetadata
)
from .haikai_orchestrator import HaikaiOrchestrator
from .haikai_models import OrchestrationRequest, OrchestrationOptions
from .api_command_executor import APICommandExecutor
from .path_safety import safe_segment

logger = logging.getLogger(__name__)


class HaikaiService:
    """
    Service for managing Haikai specifications and tasks.
    
    Provides CRUD operations and workflow execution for the Haikai system.
    """
    
    def __init__(self, workspace_dir: Path, anthropic_api_key: str):
        """
        Initialize the service.
        
        Args:
            workspace_dir: Base workspace directory (e.g., /app/api_workspace)
            anthropic_api_key: Anthropic API key for Claude CLI
        """
        self.workspace_dir = workspace_dir
        self.anthropic_api_key = anthropic_api_key
        
        logger.info(f"Initialized HaikaiService with workspace: {workspace_dir}")
    
    def _get_spec_path(self, company: str, project: str, spec_id: str) -> Path:
        """
        Get the path to a specification directory.

        Validates each segment via `ProjectRef.from_strings` (which
        wraps `safe_segment`) plus a separate `safe_segment` for
        spec_id, so a hostile API request with `company=".."` /
        `spec_id=".."` can't escape workspace_dir before the path is
        used by `delete_spec` (rmtree) or read/write operations.
        """
        from .project_ref import ProjectRef

        return (
            ProjectRef.from_strings(company, project).as_dir(self.workspace_dir)
            / "haikai" / "specs"
            / safe_segment(spec_id, "spec_id")
        )

    def _get_project_path(self, company: str, project: str) -> Path:
        """Get the path to a project directory. See `_get_spec_path` for the
        path-traversal rationale."""
        from .project_ref import ProjectRef

        return ProjectRef.from_strings(company, project).as_dir(self.workspace_dir)
    
    def _spec_exists(self, company: str, project: str, spec_id: str) -> bool:
        """Check if a specification exists."""
        spec_path = self._get_spec_path(company, project, spec_id)
        return spec_path.exists()
    
    def _get_file_timestamp(self, file_path: Path) -> Optional[datetime]:
        """Get file modification timestamp."""
        if file_path.exists():
            return datetime.fromtimestamp(file_path.stat().st_mtime)
        return None
    
    def _extract_title_from_spec(self, spec_path: Path) -> Optional[str]:
        """Extract title from spec.md file."""
        spec_file = spec_path / "spec.md"
        if not spec_file.exists():
            return None
        
        try:
            content = spec_file.read_text(encoding='utf-8')
            # Look for first H1 heading
            match = re.search(r'^#\s+(.+)$', content, re.MULTILINE)
            if match:
                return match.group(1).strip()
        except Exception as e:
            logger.warning(f"Failed to extract title from {spec_file}: {e}")
        
        return None
    
    def _determine_status(self, spec_path: Path) -> str:
        """
        Determine spec status based on existing files.
        
        Returns:
            'draft', 'in_progress', or 'completed'
        """
        has_spec = (spec_path / "spec.md").exists()
        has_tasks = (spec_path / "tasks.md").exists()
        has_impl = (spec_path / "implementation").exists()
        
        if has_impl:
            return "completed"
        elif has_tasks:
            return "in_progress"
        elif has_spec:
            return "draft"
        else:
            return "draft"
    
    def _parse_task_groups(self, tasks_content: str) -> Tuple[List[Dict[str, Any]], int, int]:
        """
        Parse task groups from tasks.md content.
        
        Returns:
            Tuple of (task_groups, total_groups, total_tasks)
        """
        # This is a simplified parser - you may want to enhance it
        task_groups = []
        total_tasks = 0
        
        # Split by phase headers (## Phase X:)
        phase_pattern = r'##\s+Phase\s+(\d+):\s+(.+?)(?=##\s+Phase|\Z)'
        phases = re.findall(phase_pattern, tasks_content, re.DOTALL)
        
        for phase_num, phase_content in phases:
            group = {
                "id": int(phase_num),
                "name": phase_content.split('\n')[0].strip(),
                "status": "pending",
                "tasks": []
            }
            
            # Count tasks in this phase (### Task X.Y:)
            task_pattern = r'###\s+Task\s+([\d.]+):\s+(.+)'
            tasks = re.findall(task_pattern, phase_content)
            
            for task_id, task_title in tasks:
                group["tasks"].append({
                    "id": task_id,
                    "title": task_title.strip(),
                    "status": "pending"
                })
                total_tasks += 1
            
            task_groups.append(group)
        
        return task_groups, len(task_groups), total_tasks
    
    # CRUD Operations
    
    def list_specs(self, company: str, project: str) -> SpecListResponse:
        """
        List all specifications for a company/project.
        
        Args:
            company: Company name
            project: Project name
        
        Returns:
            SpecListResponse with list of specs
        """
        project_path = self._get_project_path(company, project)
        specs_dir = project_path / "haikai" / "specs"
        
        if not specs_dir.exists():
            return SpecListResponse(specs=[], total=0)
        
        specs = []
        for spec_dir in specs_dir.iterdir():
            if spec_dir.is_dir():
                spec_id = spec_dir.name
                
                # Get file timestamps
                requirements_file = spec_dir / "planning" / "requirements.md"
                spec_file = spec_dir / "spec.md"
                tasks_file = spec_dir / "tasks.md"
                impl_dir = spec_dir / "implementation"
                
                created_at = self._get_file_timestamp(requirements_file)
                updated_at = max(
                    filter(None, [
                        self._get_file_timestamp(spec_file),
                        self._get_file_timestamp(tasks_file)
                    ]),
                    default=created_at
                )
                
                specs.append(SpecSummary(
                    id=spec_id,
                    company=company,
                    project=project,
                    title=self._extract_title_from_spec(spec_dir),
                    status=self._determine_status(spec_dir),
                    created_at=created_at,
                    updated_at=updated_at,
                    has_spec=spec_file.exists(),
                    has_tasks=tasks_file.exists(),
                    has_implementation=impl_dir.exists()
                ))
        
        # Sort by updated_at descending
        specs.sort(key=lambda s: s.updated_at or datetime.min, reverse=True)
        
        return SpecListResponse(specs=specs, total=len(specs))
    
    def get_spec(self, company: str, project: str, spec_id: str) -> SpecDetail:
        """
        Get detailed information about a specification.
        
        Args:
            company: Company name
            project: Project name
            spec_id: Specification ID
        
        Returns:
            SpecDetail with full spec information
        
        Raises:
            FileNotFoundError: If spec does not exist
        """
        spec_path = self._get_spec_path(company, project, spec_id)
        
        if not spec_path.exists():
            raise FileNotFoundError(f"Specification '{spec_id}' not found")
        
        # Get file paths and contents
        files = {}
        content = {}
        
        requirements_file = spec_path / "planning" / "requirements.md"
        spec_file = spec_path / "spec.md"
        tasks_file = spec_path / "tasks.md"
        
        if requirements_file.exists():
            files["requirements"] = str(requirements_file).replace("\\", "/")
            content["requirements"] = requirements_file.read_text(encoding='utf-8')
        
        if spec_file.exists():
            files["spec"] = str(spec_file).replace("\\", "/")
            content["spec"] = spec_file.read_text(encoding='utf-8')
        
        if tasks_file.exists():
            files["tasks"] = str(tasks_file).replace("\\", "/")
            content["tasks"] = tasks_file.read_text(encoding='utf-8')
        
        # Get timestamps
        created_at = self._get_file_timestamp(requirements_file)
        updated_at = max(
            filter(None, [
                self._get_file_timestamp(spec_file),
                self._get_file_timestamp(tasks_file)
            ]),
            default=created_at
        )
        
        return SpecDetail(
            id=spec_id,
            company=company,
            project=project,
            title=self._extract_title_from_spec(spec_path),
            status=self._determine_status(spec_path),
            created_at=created_at,
            updated_at=updated_at,
            has_spec=spec_file.exists(),
            has_tasks=tasks_file.exists(),
            has_implementation=(spec_path / "implementation").exists(),
            files=files,
            content=content,
            metadata=None  # TODO: Load from metadata file if exists
        )
    
    def write_spec(
        self,
        company: str,
        project: str,
        request: WriteSpecRequest
    ) -> WriteSpecResponse:
        """
        Create a new specification using /write-spec command.
        
        Args:
            company: Company name
            project: Project name
            request: WriteSpecRequest with spec_id
        
        Returns:
            WriteSpecResponse with execution results
        
        Raises:
            FileNotFoundError: If requirements.md does not exist in planning/{spec_id}/
            FileExistsError: If spec.md already exists
            RuntimeError: If Claude CLI execution fails
        """
        spec_id = request.spec_id
        spec_path = self._get_spec_path(company, project, spec_id)
        
        # Check if requirements.md exists
        requirements_file = spec_path / "planning" / "requirements.md"
        if not requirements_file.exists():
            raise FileNotFoundError(
                f"Requirements file not found at {requirements_file}. "
                f"Please ensure planning/{spec_id}/requirements.md exists before calling /write-spec."
            )

        # Verify spec has been fully shaped (initialization.md is created during /shape-spec)
        initialization_file = spec_path / "planning" / "initialization.md"
        if not initialization_file.exists():
            raise FileNotFoundError(
                f"Spec '{request.spec_id}' is missing planning/initialization.md. "
                f"This file is created during /shape-spec and is required before running /write-spec. "
                f"Ensure the spec has been fully shaped first."
            )

        # Check if spec.md already exists
        spec_file = spec_path / "spec.md"
        if spec_file.exists():
            raise FileExistsError(f"Specification '{spec_id}' already exists (spec.md found)")
        
        logger.info(f"Reading requirements from: {requirements_file}")
        
        # Execute /write-spec command
        project_path = self._get_project_path(company, project)
        cli_executor = APICommandExecutor(
            project_dir=str(project_path),
            anthropic_api_key=self.anthropic_api_key
        )
        
        start_time = datetime.now()
        result = cli_executor.execute(
            command=f"/write-spec for {spec_id}",
            system_prompt=None
        )
        end_time = datetime.now()
        
        if not result["success"]:
            raise RuntimeError(f"Failed to execute /write-spec: {result['stderr']}")
        
        # Verify spec.md was created
        spec_file = spec_path / "spec.md"
        if not spec_file.exists():
            raise RuntimeError("spec.md was not created by /write-spec command")
        
        # Extract title
        title = self._extract_title_from_spec(spec_path)
        
        # Build response
        return WriteSpecResponse(
            id=spec_id,
            company=company,
            project=project,
            title=title,
            status="draft",
            created_at=start_time,
            updated_at=end_time,
            files={
                "requirements": str(requirements_file).replace("\\", "/"),
                "spec": str(spec_file).replace("\\", "/")
            },
            execution={
                "command": "/write-spec",
                "duration_seconds": (end_time - start_time).total_seconds(),
                "status": "success"
            }
        )
    
    def delete_spec(self, company: str, project: str, spec_id: str) -> DeleteSpecResponse:
        """
        Delete a specification.
        
        Args:
            company: Company name
            project: Project name
            spec_id: Specification ID
        
        Returns:
            DeleteSpecResponse with deleted files
        
        Raises:
            FileNotFoundError: If spec does not exist
        """
        spec_path = self._get_spec_path(company, project, spec_id)
        
        if not spec_path.exists():
            raise FileNotFoundError(f"Specification '{spec_id}' not found")
        
        # Collect all files before deletion
        deleted_files = []
        for file_path in spec_path.rglob("*"):
            if file_path.is_file():
                deleted_files.append(str(file_path))
        
        # Delete the directory
        shutil.rmtree(spec_path)
        
        logger.info(f"Deleted specification: {spec_id} ({len(deleted_files)} files)")
        
        return DeleteSpecResponse(
            message=f"Spec '{spec_id}' deleted successfully",
            deleted_files=deleted_files
        )
    
    def get_tasks(self, company: str, project: str, spec_id: str) -> TasksDetail:
        """
        Get tasks for a specification.
        
        Args:
            company: Company name
            project: Project name
            spec_id: Specification ID
        
        Returns:
            TasksDetail with parsed tasks
        
        Raises:
            FileNotFoundError: If spec or tasks.md does not exist
        """
        spec_path = self._get_spec_path(company, project, spec_id)
        tasks_file = spec_path / "tasks.md"
        
        if not spec_path.exists():
            raise FileNotFoundError(f"Specification '{spec_id}' not found")
        
        if not tasks_file.exists():
            raise FileNotFoundError(f"tasks.md not found for spec '{spec_id}'")
        
        # Parse tasks
        tasks_content = tasks_file.read_text(encoding='utf-8')
        task_groups, total_groups, total_tasks = self._parse_task_groups(tasks_content)
        
        # Get timestamps
        created_at = self._get_file_timestamp(tasks_file)
        updated_at = created_at
        
        return TasksDetail(
            spec_id=spec_id,
            company=company,
            project=project,
            task_groups=task_groups,
            total_task_groups=total_groups,
            total_tasks=total_tasks,
            completed_tasks=0,  # TODO: Parse from task status
            created_at=created_at,
            updated_at=updated_at
        )
    
    def generate_tasks(
        self,
        company: str,
        project: str,
        spec_id: str
    ) -> GenerateTasksResponse:
        """
        Generate tasks using /create-tasks command.
        
        Args:
            company: Company name
            project: Project name
            spec_id: Specification ID
        
        Returns:
            GenerateTasksResponse with execution results
        
        Raises:
            FileNotFoundError: If spec does not exist
            FileExistsError: If tasks already exist
            RuntimeError: If Claude CLI execution fails
        """
        spec_path = self._get_spec_path(company, project, spec_id)
        spec_file = spec_path / "spec.md"
        tasks_file = spec_path / "tasks.md"
        
        if not spec_path.exists() or not spec_file.exists():
            raise FileNotFoundError(f"Specification '{spec_id}' not found")
        
        if tasks_file.exists():
            raise FileExistsError(f"Tasks already exist for spec '{spec_id}'")
        
        # Execute /create-tasks command
        project_path = self._get_project_path(company, project)
        cli_executor = APICommandExecutor(
            project_dir=str(project_path),
            anthropic_api_key=self.anthropic_api_key
        )
        
        start_time = datetime.now()
        result = cli_executor.execute(
            command=f"/create-tasks for {spec_id}",
            system_prompt=None
        )
        end_time = datetime.now()
        
        if not result["success"]:
            raise RuntimeError(f"Failed to execute /create-tasks: {result['stderr']}")
        
        # Verify tasks.md was created
        if not tasks_file.exists():
            raise RuntimeError("tasks.md was not created by /create-tasks command")
        
        # Parse tasks
        tasks_content = tasks_file.read_text(encoding='utf-8')
        task_groups, total_groups, total_tasks = self._parse_task_groups(tasks_content)
        
        return GenerateTasksResponse(
            spec_id=spec_id,
            company=company,
            project=project,
            task_groups=task_groups,
            total_task_groups=total_groups,
            total_tasks=total_tasks,
            created_at=start_time,
            execution={
                "command": "/create-tasks",
                "duration_seconds": (end_time - start_time).total_seconds(),
                "status": "success"
            }
        )
    
    def implement_tasks(
        self,
        company: str,
        project: str,
        spec_id: str,
        request: Optional[ImplementRequest] = None
    ) -> ImplementResponse:
        """
        Implement tasks using /implement-tasks command.
        
        Args:
            company: Company name
            project: Project name
            spec_id: Specification ID
            request: Optional ImplementRequest with options
        
        Returns:
            ImplementResponse with execution results
        
        Raises:
            FileNotFoundError: If spec or tasks do not exist
            RuntimeError: If Claude CLI execution fails
        """
        spec_path = self._get_spec_path(company, project, spec_id)
        tasks_file = spec_path / "tasks.md"
        
        if not spec_path.exists():
            raise FileNotFoundError(f"Specification '{spec_id}' not found")
        
        if not tasks_file.exists():
            raise FileNotFoundError(f"Tasks not found for spec '{spec_id}'")
        
        # Execute /implement-tasks command
        project_path = self._get_project_path(company, project)
        cli_executor = APICommandExecutor(
            project_dir=str(project_path),
            anthropic_api_key=self.anthropic_api_key
        )
        
        start_time = datetime.now()
        result = cli_executor.execute(
            command=f"/implement-tasks for {spec_id}",
            system_prompt="Implement ALL task groups without asking for confirmation. Do not prompt the user."
        )
        end_time = datetime.now()
        
        if not result["success"]:
            raise RuntimeError(f"Failed to execute /implement-tasks: {result['stderr']}")
        
        # Count created files
        impl_dir = spec_path / "implementation"
        files_created = 0
        created_files = []
        
        if impl_dir.exists():
            for file_path in impl_dir.rglob("*"):
                if file_path.is_file():
                    files_created += 1
                    created_files.append(str(file_path))
        
        return ImplementResponse(
            spec_id=spec_id,
            company=company,
            project=project,
            status="completed" if result["success"] else "failed",
            execution={
                "command": "/implement-tasks",
                "duration_seconds": (end_time - start_time).total_seconds(),
                "status": "success" if result["success"] else "failure",
                "start_time": start_time.isoformat(),
                "end_time": end_time.isoformat()
            },
            artifacts={
                "files_created": files_created,
                "files": created_files[:50]  # Limit to first 50 files
            },
            summary=f"Successfully implemented tasks for {spec_id}"
        )
