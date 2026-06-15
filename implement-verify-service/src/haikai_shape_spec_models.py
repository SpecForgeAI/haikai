"""
Pydantic models for Haikai Shape-Spec API endpoints.

This module defines the request and response models for shape-spec operations,
which initialize spec folders and gather requirements.
"""

from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
from datetime import datetime


class ShapeSpecRequest(BaseModel):
    """Request model for creating one or more shape-specs."""
    
    company: str = Field(
        ...,
        description="Company name"
    )
    project: str = Field(
        ...,
        description="Project name"
    )
    spec_intents: List[str] = Field(
        ...,
        min_length=1,
        description="List of spec intents (detailed text blocks describing features with context, goals, requirements, etc.)"
    )
    context_files: Optional[List[str]] = Field(
        default=None,
        description="Optional list of paths to context files to include in requirements.md"
    )
    
    @field_validator('spec_intents')
    @classmethod
    def validate_spec_intents(cls, v):
        """Ensure spec_intents is not empty and contains valid text blocks."""
        if not v or len(v) == 0:
            raise ValueError("At least one spec_intent must be provided")
        
        # Validate each spec intent has minimum length (more detailed than feature descriptions)
        for idx, intent in enumerate(v):
            if not intent or len(intent.strip()) < 50:
                raise ValueError(
                    f"Spec intent at index {idx} is too short. Must be at least 50 characters."
                )
        
        return v


class ShapeSpecResult(BaseModel):
    """Result of a single shape-spec operation."""
    
    spec_name: str = Field(
        ...,
        description="The generated spec directory name (e.g., 'user-registration')"
    )
    spec_intent: str = Field(
        ...,
        description="The original spec intent text block"
    )
    status: str = Field(
        ...,
        description="Status: 'success' or 'failure'"
    )
    spec_path: str = Field(
        ...,
        description="Full path to the spec directory"
    )
    requirements_path: Optional[str] = Field(
        default=None,
        description="Path to the generated requirements.md file"
    )
    initialization_path: Optional[str] = Field(
        default=None,
        description="Path to the generated initialization.md file"
    )
    execution_time_seconds: float = Field(
        ...,
        ge=0,
        description="Time taken to shape this spec in seconds"
    )
    error_message: Optional[str] = Field(
        default=None,
        description="Error message if the operation failed"
    )


class ShapeSpecResponse(BaseModel):
    """Response model for shape-spec operations."""
    
    success: bool = Field(
        ...,
        description="True if all shape-specs completed successfully"
    )
    results: List[ShapeSpecResult] = Field(
        ...,
        description="Array containing the result of each shape-spec operation"
    )
    total_execution_time_seconds: float = Field(
        ...,
        ge=0,
        description="Total time taken for all shape-specs in seconds"
    )
    timestamp: str = Field(
        ...,
        description="ISO timestamp when the operation completed"
    )
    errors: List[str] = Field(
        default_factory=list,
        description="Non-fatal errors that occurred during the operation"
    )


class SpecInfo(BaseModel):
    """Information about a single spec."""
    
    spec_name: str = Field(
        ...,
        description="The spec directory name (e.g., 'user-registration')"
    )
    spec_path: str = Field(
        ...,
        description="Full path to the spec directory"
    )
    has_requirements: bool = Field(
        ...,
        description="Whether requirements.md exists"
    )
    has_spec: bool = Field(
        ...,
        description="Whether spec.md exists"
    )
    has_tasks: bool = Field(
        ...,
        description="Whether tasks.md exists"
    )
    has_implementation: bool = Field(
        ...,
        description="Whether implementation folder has content"
    )
    feature_name: str = Field(
        ...,
        description="Feature name (same as spec_name)"
    )


class GetSpecsResponse(BaseModel):
    """Response model for getting multiple specs."""
    
    company: str = Field(
        ...,
        description="Company name"
    )
    project: str = Field(
        ...,
        description="Project name"
    )
    specs: List[SpecInfo] = Field(
        ...,
        description="List of specs found in the project"
    )
    total_specs: int = Field(
        ...,
        ge=0,
        description="Total number of specs found"
    )
    timestamp: str = Field(
        ...,
        description="ISO timestamp when the query was made"
    )
