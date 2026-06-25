"""
Pydantic models for Haikai Orchestration API.

This module defines the request and response models for the Haikai orchestrator,
which automates the execution of Haikai workflows (write-spec, create-tasks, implement-tasks).
"""

from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
from pathlib import Path


class OrchestrationOptions(BaseModel):
    """Configuration options for orchestration execution."""
    
    stop_on_error: bool = Field(
        default=True,
        description="If true, stop the workflow immediately when any step fails"
    )
    retry_on_failure: bool = Field(
        default=False,
        description="If true, retry failed steps up to max_retries times"
    )
    max_retries: int = Field(
        default=1,
        ge=0,
        le=5,
        description="Maximum number of retries for failed steps (0-5)"
    )
    timeout_seconds: Optional[int] = Field(
        default=None,
        ge=0,
        description="Timeout in seconds for each step. None means unlimited (no timeout)."
    )


class SpecIntent(BaseModel):
    """A spec intent paired with its shape-spec session."""
    spec_name: str = Field(
        ...,
        description="Spec folder name (e.g. '2026-02-20-scenarios-service-scaffold')"
    )
    session_id: Optional[str] = Field(
        default=None,
        description="Claude CLI session UUID from shape-spec. Auto-generated if not provided."
    )


class OrchestrationRequest(BaseModel):
    """Request model for initiating an Haikai orchestration."""

    company: str = Field(
        ...,
        description="Company name"
    )
    project: str = Field(
        ...,
        description="Project name"
    )
    spec_intents: List[SpecIntent] = Field(
        ...,
        min_length=1,
        description="List of spec intents to orchestrate. Each pairs a spec folder name with its shape-spec session ID."
    )
    batch_name: Optional[str] = Field(
        default=None,
        description=(
            "When set, the spec_intents are treated as one tightly-coupled batch: "
            "they accumulate as N commits onto a SINGLE branch `feature/<batch_name>` "
            "(not a branch per spec), pushed + PR'd once at the end. Unset = legacy "
            "per-spec branch/PR behaviour."
        ),
    )
    context_files: Optional[List[str]] = Field(
        default=None,
        description="List of paths to context files to include in requirements.md"
    )
    options: Optional[OrchestrationOptions] = Field(
        default_factory=OrchestrationOptions,
        description="Execution options for the orchestration"
    )
    # W1/F4: when the migration loop wants the run deployed and a build-results
    # callback (the async /api/v2/jobs/orchestrations path). All optional and
    # default-off so the existing sync/no-deploy behaviour is unchanged.
    deploy_on_complete: bool = Field(
        default=False,
        description="If true, after a clean run consolidate the spec branches and deploy via haibox, then POST a build-results callback."
    )
    target: Optional[dict] = Field(
        default=None,
        description=(
            "haibox serve spec (command, health_path, ...) used to deploy the integrated run. "
            "Required for deploy_on_complete. TRUST BOUNDARY (S2): target.command is executed "
            "verbatim by haiboxd on the host — TRUSTED INPUT, only the authenticated co-located "
            "peer may set it. Not allowlisted here; command-allowlist + API-key split is a tracked "
            "follow-up (plan/260613-1640-fix-endpoint-flaws/followups.md)."
        ),
    )
    callback_url: Optional[str] = Field(
        default=None,
        description="URL the service POSTs the build-results outcome to (implemented|deployed|fix_unserved|not_fixed|rejected|error)."
    )
    integrate_branches: Optional[List[str]] = Field(
        default=None,
        description="Explicit branches to consolidate at deploy. Defaults to the per-spec feature branches of this run."
    )

    @field_validator('spec_intents')
    @classmethod
    def validate_spec_intents(cls, v):
        """Ensure spec_intents is not empty and contains valid intents."""
        if not v or len(v) == 0:
            raise ValueError("At least one spec_intent must be provided")

        for idx, intent in enumerate(v):
            if not intent.spec_name or len(intent.spec_name.strip()) < 5:
                raise ValueError(
                    f"Spec intent at index {idx} has an invalid spec_name. Must be at least 5 characters."
                )
            if intent.session_id is not None and len(intent.session_id.strip()) < 5:
                raise ValueError(
                    f"Spec intent at index {idx} has an invalid session_id. Must be at least 5 characters."
                )

        return v


class ImplementationPackageFile(BaseModel):
    """A single file in the implementation package."""
    path: str = Field(..., description="Relative path where this file should be placed (e.g. 'haikai/specs/my-spec/spec.md')")
    content: str = Field(..., description="Full text content of the file")


class ImplementationPackage(BaseModel):
    """Portable implementation package for handoff to a developer machine."""
    spec_name: str = Field(..., description="Name of the spec this package is for")
    company: str = Field(..., description="Company name")
    project: str = Field(..., description="Project name")
    files: List[ImplementationPackageFile] = Field(..., description="List of files in the package")
    instructions: str = Field(
        default="Extract into your project root; see the active backend's CLI for invocation.",
        description=(
            "Human-readable instructions for using the package. Populated by "
            "the package endpoint with the active backend's CLI invocation "
            "(see `api.BackendDescriptor.invocation_hint`)."
        ),
    )


class StepResult(BaseModel):
    """Result of a single orchestration step."""
    
    step: int = Field(
        ...,
        ge=0,
        le=4,
        description="Step number (0=shape-spec, 1=write-spec, 2=create-tasks, 3=implement-tasks, 4=git-commit-preparation)"
    )
    command: str = Field(
        ...,
        description="The Haikai command that was executed"
    )
    status: str = Field(
        ...,
        description="Execution status: 'success' or 'failure'"
    )
    output_paths: List[str] = Field(
        default_factory=list,
        description="List of file paths created during this step"
    )
    execution_time_seconds: float = Field(
        ...,
        ge=0,
        description="Time taken to execute this step in seconds"
    )
    log_file: str = Field(
        ...,
        description="Path to the detailed log file for this step"
    )
    error_message: Optional[str] = Field(
        default=None,
        description="Error message if the step failed"
    )


class OrchestrationResponse(BaseModel):
    """Response model for an Haikai orchestration."""
    
    success: bool = Field(
        ...,
        description="True if the entire workflow completed without errors"
    )
    spec_names: List[str] = Field(
        ...,
        description="The generated names of the spec directories (e.g., ['2026-01-15-user-registration', '2026-01-15-payment-gateway'])"
    )
    session_ids: dict[str, str] = Field(
        ...,
        description="Map of spec_name to session_id used for each spec (for resuming sessions after orchestration)"
    )
    results: List[StepResult] = Field(
        ...,
        description="Array containing the result of each executed step"
    )
    total_execution_time_seconds: float = Field(
        ...,
        ge=0,
        description="Total time taken for the entire workflow in seconds"
    )
    orchestration_log: str = Field(
        ...,
        description="Path to the main log file for the entire orchestration"
    )
    commit_sha: Optional[str] = Field(
        default=None,
        description="Git commit SHA (set by V2 git-integrated endpoints)"
    )
    branch: Optional[str] = Field(
        default=None,
        description="Git branch name (set by V2 git-integrated endpoints)"
    )
    pr_url: Optional[str] = Field(
        default=None,
        description="Pull request URL (set by V2 git-integrated endpoints)"
    )
    errors: List[str] = Field(
        default_factory=list,
        description="Non-fatal errors (git push, PR creation, etc.) that occurred during the operation"
    )


class OrchestrationV2Response(BaseModel):
    """Response model for v2 orchestration (brain-only: write-spec + create-tasks)."""

    success: bool = Field(..., description="True if the workflow completed without errors")
    spec_names: List[str] = Field(..., description="The spec directory names processed")
    session_ids: dict[str, str] = Field(..., description="Map of spec_name to session_id")
    results: List[StepResult] = Field(..., description="Results of each executed step")
    total_execution_time_seconds: float = Field(..., ge=0, description="Total wall-clock time in seconds")
    orchestration_log: str = Field(..., description="Path to the orchestration log file")
    implementation_packages: List[ImplementationPackage] = Field(
        default_factory=list,
        description="Portable implementation packages — one per spec. Contains all files needed to run /implement-tasks on a developer machine."
    )
    errors: List[str] = Field(
        default_factory=list,
        description="Non-fatal errors (git push, PR creation, etc.) that occurred during the operation"
    )
