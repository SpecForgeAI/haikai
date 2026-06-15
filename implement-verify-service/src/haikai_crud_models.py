"""
Pydantic models for Haikai CRUD API endpoints.

This module defines request and response models for the RESTful CRUD operations
on specifications and tasks.
"""

from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict, Any
from datetime import datetime
from pathlib import Path


class SpecMetadata(BaseModel):
    """Metadata for a specification."""
    
    description: Optional[str] = Field(
        default=None,
        description="Brief description of the specification"
    )
    tags: Optional[List[str]] = Field(
        default=None,
        description="Tags for categorizing the specification"
    )


class SpecSummary(BaseModel):
    """Summary information about a specification."""
    
    id: str = Field(
        ...,
        description="Specification ID (simple name, e.g., 'user-registration')"
    )
    company: str = Field(
        ...,
        description="Company name"
    )
    project: str = Field(
        ...,
        description="Project name"
    )
    title: Optional[str] = Field(
        default=None,
        description="Human-readable title extracted from spec.md"
    )
    status: str = Field(
        ...,
        description="Status: 'draft', 'in_progress', 'completed'"
    )
    created_at: Optional[datetime] = Field(
        default=None,
        description="Creation timestamp"
    )
    updated_at: Optional[datetime] = Field(
        default=None,
        description="Last update timestamp"
    )
    has_spec: bool = Field(
        default=False,
        description="Whether spec.md exists"
    )
    has_tasks: bool = Field(
        default=False,
        description="Whether tasks.md exists"
    )
    has_implementation: bool = Field(
        default=False,
        description="Whether implementation files exist"
    )


class SpecDetail(SpecSummary):
    """Detailed information about a specification."""
    
    files: Dict[str, str] = Field(
        default_factory=dict,
        description="Map of file types to file paths"
    )
    content: Dict[str, str] = Field(
        default_factory=dict,
        description="Map of file types to file contents"
    )
    metadata: Optional[SpecMetadata] = Field(
        default=None,
        description="Additional metadata"
    )


class SpecListResponse(BaseModel):
    """Response for listing specifications."""
    
    specs: List[SpecSummary] = Field(
        default_factory=list,
        description="List of specification summaries"
    )
    total: int = Field(
        ...,
        ge=0,
        description="Total number of specifications"
    )


class WriteSpecRequest(BaseModel):
    """Request to create a new specification."""
    
    spec_id: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Specification ID (simple name, e.g., 'user-registration'). Requirements will be read from planning/{spec_id}/requirements.md"
    )
    
    @field_validator('spec_id')
    @classmethod
    def validate_spec_id(cls, v):
        """Ensure spec_id is a valid directory name."""
        # Only allow alphanumeric, hyphens, and underscores
        import re
        if not re.match(r'^[a-z0-9_-]+$', v):
            raise ValueError(
                "spec_id must contain only lowercase letters, numbers, hyphens, and underscores"
            )
        return v


class WriteSpecResponse(BaseModel):
    """Response after creating a specification."""
    
    id: str = Field(..., description="Specification ID")
    company: str = Field(..., description="Company name")
    project: str = Field(..., description="Project name")
    title: Optional[str] = Field(default=None, description="Extracted title from spec.md")
    status: str = Field(..., description="Status after creation")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")
    files: Dict[str, str] = Field(
        default_factory=dict,
        description="Map of file types to file paths"
    )
    execution: Dict[str, Any] = Field(
        default_factory=dict,
        description="Execution metadata (command, duration, status)"
    )


class GenerateTasksResponse(BaseModel):
    """Response after generating tasks."""

    spec_id: str = Field(..., description="Specification ID")
    company: str = Field(..., description="Company name")
    project: str = Field(..., description="Project name")
    task_groups: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Parsed task groups from tasks.md"
    )
    total_task_groups: int = Field(..., ge=0, description="Total number of task groups")
    total_tasks: int = Field(..., ge=0, description="Total number of tasks")
    created_at: datetime = Field(..., description="Creation timestamp")
    execution: Dict[str, Any] = Field(
        default_factory=dict,
        description="Execution metadata"
    )
    errors: List[str] = Field(
        default_factory=list,
        description="Non-fatal errors that occurred during the operation"
    )


class ImplementRequest(BaseModel):
    """Request to implement tasks."""
    
    task_groups: Optional[List[int]] = Field(
        default=None,
        description="Optional list of specific task group IDs to implement"
    )
    workspace_dir: Optional[str] = Field(
        default=None,
        description="Optional override for workspace directory"
    )


class ImplementResponse(BaseModel):
    """Response after implementing tasks."""

    spec_id: str = Field(..., description="Specification ID")
    company: str = Field(..., description="Company name")
    project: str = Field(..., description="Project name")
    status: str = Field(..., description="Implementation status")
    execution: Dict[str, Any] = Field(
        default_factory=dict,
        description="Execution metadata"
    )
    artifacts: Dict[str, Any] = Field(
        default_factory=dict,
        description="Information about created/modified files"
    )
    summary: Optional[str] = Field(
        default=None,
        description="Summary of implementation results"
    )
    git_errors: List[str] = Field(
        default_factory=list,
        description="Git operation errors that did not fail the implementation"
    )


class TasksDetail(BaseModel):
    """Detailed information about tasks."""
    
    spec_id: str = Field(..., description="Specification ID")
    company: str = Field(..., description="Company name")
    project: str = Field(..., description="Project name")
    task_groups: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Parsed task groups"
    )
    total_task_groups: int = Field(..., ge=0, description="Total task groups")
    total_tasks: int = Field(..., ge=0, description="Total tasks")
    completed_tasks: int = Field(..., ge=0, description="Number of completed tasks")
    created_at: Optional[datetime] = Field(default=None, description="Creation timestamp")
    updated_at: Optional[datetime] = Field(default=None, description="Last update timestamp")


class DeleteSpecResponse(BaseModel):
    """Response after deleting a specification."""
    
    message: str = Field(..., description="Success message")
    deleted_files: List[str] = Field(
        default_factory=list,
        description="List of deleted file paths"
    )


class ErrorResponse(BaseModel):
    """Standard error response."""
    
    error: Dict[str, Any] = Field(
        ...,
        description="Error details"
    )
    
    @staticmethod
    def create(code: str, message: str, details: Optional[Dict[str, Any]] = None) -> "ErrorResponse":
        """Create an error response."""
        error_dict = {
            "code": code,
            "message": message
        }
        if details:
            error_dict["details"] = details
        return ErrorResponse(error=error_dict)
