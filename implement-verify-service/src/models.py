"""Request and response models for standards extraction operations."""
from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_serializer, field_validator
from typing import Optional, List, Literal, Dict
from pathlib import Path
from enum import Enum


class OperationMode(str, Enum):
    """Enumeration of supported operation modes."""
    GET_METAMODEL = "get_metamodel"
    GENERATE_PRODUCT_STANDARDS = "generate_product_standards"
    GENERATE_GLOBAL_STANDARDS = "generate_global_standards"


class BaseRequest(BaseModel):
    """Base request model with common fields."""
    mode: OperationMode

    # Pydantic V2 — replaces the V1 `class Config:` form.
    model_config = ConfigDict(use_enum_values=True)


class GetMetamodelRequest(BaseRequest):
    """Request to get architectural metamodel from external system."""
    mode: Literal[OperationMode.GET_METAMODEL] = Field(default=OperationMode.GET_METAMODEL)
    metamodel_id: str = Field(..., description="External metamodel identifier")
    company: str = Field(..., description="Company name")
    project: str = Field(..., description="Project name")


class GenerateProductStandardsRequest(BaseRequest):
    """Request to generate product-level technical standards."""
    mode: Literal[OperationMode.GENERATE_PRODUCT_STANDARDS] = Field(default=OperationMode.GENERATE_PRODUCT_STANDARDS)
    company: str = Field(..., description="Company name")
    project: str = Field(..., description="Project name")
    sources: Optional[List[str]] = Field(default=None, description="Optional source paths/URLs")
    recursive: bool = Field(default=True, description="Recursively scan directories")
    



class GenerateGlobalStandardsRequest(BaseRequest):
    """Request to generate global baseline standards."""
    mode: Literal[OperationMode.GENERATE_GLOBAL_STANDARDS] = Field(default=OperationMode.GENERATE_GLOBAL_STANDARDS)
    company: str = Field(..., description="Company name")
    sources: Optional[List[str]] = Field(default=None, description="Source paths/URLs to analyze")
    recursive: bool = Field(default=True, description="Recursively scan directories")
    technical_documents: Optional[Dict[str, List[str]]] = Field(
        default=None,
        description="Optional technical documents to supplement analysis. Keys: tech_stack, coding_style, conventions, error_handling, validation"
    )
    
    @field_validator('technical_documents')
    @classmethod
    def validate_sources_or_docs(cls, v, info: ValidationInfo):
        """Ensure at least sources or technical_documents is provided.

        Pydantic V2 form: replaces the V1 `@validator` that accessed
        `values` dict; V2 passes the whole context via `info.data`.
        """
        sources = info.data.get('sources')

        # Check if we have any sources
        has_sources = sources and len(sources) > 0

        # Check if we have any technical documents
        has_docs = v and any(len(docs) > 0 for docs in v.values())

        if not has_sources and not has_docs:
            raise ValueError(
                "At least one of 'sources' or 'technical_documents' must be provided. "
                "Cannot generate standards without any input."
            )

        return v


class OperationResponse(BaseModel):
    """Standard response for all operations."""
    success: bool
    mode: OperationMode
    output_dir: Path
    outputs: List[Path] = Field(default_factory=list, description="Generated output files")
    message: str
    errors: Optional[List[str]] = None
    
    @field_serializer('output_dir', 'outputs')
    def serialize_paths(self, value, _info):
        """Convert Path objects to POSIX-format workspace-relative strings.

        Stripping the workspace prefix avoids leaking server filesystem
        layout (e.g. `/home/ubuntu/api_workspace/...`) to API clients —
        per autoresearch:debug 260504-1448 finding M4. Falls back to the
        absolute POSIX form if API_WORKSPACE_DIR is unset (e.g. in CLI
        contexts) or the path doesn't sit under the workspace root.
        """
        import os

        workspace = os.environ.get("API_WORKSPACE_DIR")
        workspace_root = Path(workspace).resolve() if workspace else None

        def _to_relative(p: Path) -> str:
            posix = p.as_posix()
            if workspace_root is None:
                return posix
            try:
                return p.resolve().relative_to(workspace_root).as_posix()
            except ValueError:
                # Path lives outside the workspace (CLI mode, custom
                # output_dir, etc) — surface the absolute path.
                return posix

        if isinstance(value, Path):
            return _to_relative(value)
        elif isinstance(value, list):
            return [_to_relative(p) if isinstance(p, Path) else p for p in value]
        return value
