"""
Pydantic models for Haikai Orchestration Status API.

This module defines the request and response models for checking
orchestration status and retrieving logs.
"""

from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


class OrchestrationStatusResponse(BaseModel):
    """Response model for orchestration status check."""
    
    orchestration_id: str = Field(
        ...,
        description="Unique identifier for the orchestration"
    )
    status: str = Field(
        ...,
        description="Current status: 'running', 'completed', 'failed', 'not_found'"
    )
    company: str = Field(
        ...,
        description="Company name"
    )
    project: str = Field(
        ...,
        description="Project name"
    )
    spec_names: List[str] = Field(
        default_factory=list,
        description="List of spec names being orchestrated"
    )
    current_step: Optional[int] = Field(
        default=None,
        description="Current step number (0-3) if running"
    )
    current_command: Optional[str] = Field(
        default=None,
        description="Current command being executed if running"
    )
    completed_steps: int = Field(
        default=0,
        description="Number of completed steps"
    )
    total_steps: int = Field(
        default=4,
        description="Total number of steps in workflow"
    )
    elapsed_time_seconds: Optional[float] = Field(
        default=None,
        description="Elapsed time since orchestration started"
    )
    success: Optional[bool] = Field(
        default=None,
        description="Overall success status (only set when completed)"
    )
    log_file: str = Field(
        ...,
        description="Path to the orchestration log file"
    )


class StepLogEntry(BaseModel):
    """A single log entry from a step."""
    
    timestamp: str = Field(
        ...,
        description="ISO timestamp of the log entry"
    )
    level: str = Field(
        ...,
        description="Log level: INFO, WARNING, ERROR, DEBUG"
    )
    message: str = Field(
        ...,
        description="Log message content"
    )
    source: str = Field(
        default="orchestrator",
        description="Source of the log: orchestrator, claude, haikai"
    )


class OrchestrationLogsResponse(BaseModel):
    """Response model for orchestration logs."""
    
    orchestration_id: str = Field(
        ...,
        description="Unique identifier for the orchestration"
    )
    logs: List[StepLogEntry] = Field(
        default_factory=list,
        description="List of log entries"
    )
    has_more: bool = Field(
        default=False,
        description="Whether there are more logs available"
    )
