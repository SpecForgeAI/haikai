"""Core business logic executor for standards extraction operations."""
import logging
from typing import Union
from pathlib import Path
from .models import (
    GetMetamodelRequest,
    GenerateProductStandardsRequest,
    GenerateGlobalStandardsRequest,
    OperationResponse,
    OperationMode
)
from .standards_orchestrator import StandardsOrchestrator
from .path_safety import safe_segment, check_no_traversal

# Set up logging
logger = logging.getLogger(__name__)


def _safe_project_dir(workspace_dir: Path, company: str, project: str) -> Path:
    """Validate company/project then build workspace_dir/<company>/<project>.

    Thin wrapper over ProjectRef.from_strings(...).as_dir(...) — kept
    as a function so existing call sites that pass (workspace_dir,
    company, project) don't need to change yet.
    """
    from .project_ref import ProjectRef

    return ProjectRef.from_strings(company, project).as_dir(workspace_dir)


def _safe_company_dir(workspace_dir: Path, company: str) -> Path:
    """Validate company then build workspace_dir/<company>."""
    return workspace_dir / safe_segment(company, "company")


def _safe_source_path(workspace_dir: Path, source: str) -> Path:
    """Resolve a workspace-relative source path, rejecting `..` traversal.

    Source values are intentionally multi-segment (e.g. "alfresco/repo/src")
    so `safe_segment` is too strict — but `..` must still be blocked.
    """
    check_no_traversal(source, "source")
    return workspace_dir / source


class OperationExecutor:
    """
    Core business logic executor that processes operation requests.
    Decoupled from transport layer (CLI/SDK/API).
    """
    
    def __init__(self, config: dict, workspace_dir: Path = None):
        """
        Initialize with environment config (LLM keys, etc.).
        
        Args:
            config: Configuration dictionary with LLM settings, tokens, etc.
            workspace_dir: Base workspace directory for API operations
        """
        self.env_config = config
        self.workspace_dir = workspace_dir
        logger.info(f"OperationExecutor initialized with workspace_dir: {self.workspace_dir}")
    
    def execute(
        self, 
        request: Union[GetMetamodelRequest, GenerateProductStandardsRequest, GenerateGlobalStandardsRequest]
    ) -> OperationResponse:
        """
        Execute an operation based on the request type.
        
        Args:
            request: Operation request model
            
        Returns:
            OperationResponse with results
        """
        logger.info(f"Executing request: {type(request).__name__}")
        
        if isinstance(request, GetMetamodelRequest):
            return self._get_metamodel(request)
        elif isinstance(request, GenerateProductStandardsRequest):
            return self._generate_product_standards(request)
        elif isinstance(request, GenerateGlobalStandardsRequest):
            return self._generate_global_standards(request)
        else:
            raise ValueError(f"Unsupported request type: {type(request)}")
    
    def _get_metamodel(self, request: GetMetamodelRequest) -> OperationResponse:
        """
        Execute metamodel retrieval operation.
        
        Writes to: {company}/{project}/metamodel/architecture.json
        """
        try:
            logger.info(f"Getting metamodel for company={request.company}, project={request.project}, metamodel_id={request.metamodel_id}")

            # Validate company/project once; reuse the safe path on both
            # success and error returns. Raises ValueError on traversal —
            # caller (run()) catches and turns into the standard error
            # response shape.
            project_dir = _safe_project_dir(self.workspace_dir, request.company, request.project)
            logger.info(f"Project directory: {project_dir}")

            # Create orchestrator with project_dir as output_dir
            orchestrator = StandardsOrchestrator(
                config={
                    **self.env_config,
                    'output_dir': project_dir.as_posix(),
                    'mode': request.mode if isinstance(request.mode, str) else request.mode.value
                }
            )

            # Get metamodel from external system
            output_path = orchestrator.get_metamodel(request.metamodel_id)
            logger.info(f"Metamodel retrieved successfully: {output_path}")

            return OperationResponse(
                success=True,
                mode=request.mode,
                output_dir=project_dir,
                outputs=[output_path],
                message=f"Metamodel retrieved successfully for {request.metamodel_id}"
            )
        except Exception as e:
            logger.error(f"Failed to retrieve metamodel: {str(e)}", exc_info=True)
            return OperationResponse(
                success=False,
                mode=request.mode,
                # Don't echo the unsafe input back — use the workspace root
                # if we never got past validation.
                output_dir=locals().get("project_dir") or self.workspace_dir,
                outputs=[],
                message="Failed to retrieve metamodel",
                errors=[str(e)]
            )
    
    def _generate_product_standards(self, request: GenerateProductStandardsRequest) -> OperationResponse:
        """
        Execute product standards creation.
        
        Reads from: 
        - {company}/haikai/standards/global/tech-stack.md (baseline)
        - {company}/{project}/metamodel/architecture.json (if present)
        
        Writes to: {company}/{project}/haikai/product/tech-stack.md
        """
        try:
            logger.info(f"Generating product standards for company={request.company}, project={request.project}, sources={request.sources}, recursive={request.recursive}")

            # Validate company/project — raises ValueError on traversal.
            project_dir = _safe_project_dir(self.workspace_dir, request.company, request.project)
            global_dir = _safe_company_dir(self.workspace_dir, request.company)
            logger.info(f"Project directory: {project_dir}")
            logger.info(f"Global directory: {global_dir}")

            # Resolve sources relative to workspace directory. Sources are
            # multi-segment (e.g. "alfresco/repo/src") so safe_segment is
            # too strict — but `..` must still be blocked.
            resolved_sources = []
            for source in (request.sources or []):
                # Skip URLs - they don't need path resolution
                if source.startswith(('http://', 'https://', 'git@', 'git://')):
                    resolved_sources.append(source)
                else:
                    source_path = _safe_source_path(self.workspace_dir, source)
                    resolved_sources.append(str(source_path))
            
            logger.info(f"Resolved sources: {resolved_sources}")
            
            orchestrator = StandardsOrchestrator(
                config={
                    **self.env_config,
                    'output_dir': project_dir.as_posix(),
                    'global_dir': global_dir.as_posix(),
                    'mode': request.mode if isinstance(request.mode, str) else request.mode.value
                }
            )
            
            outputs = orchestrator.create_product_standards(
                sources=resolved_sources,
                recursive=request.recursive
            )
            
            logger.info(f"Product standards created successfully: {outputs}")
            
            return OperationResponse(
                success=True,
                mode=request.mode,
                output_dir=project_dir,
                outputs=outputs,
                message="Product standards created successfully"
            )
        except Exception as e:
            # Keep the full traceback in the server log (operator-facing)
            # but DO NOT echo it back to the API client — leaking file paths
            # and stack frames helps attackers map internals.
            logger.error("Failed to create product standards", exc_info=True)
            return OperationResponse(
                success=False,
                mode=request.mode,
                output_dir=locals().get("project_dir") or self.workspace_dir,
                outputs=[],
                message="Failed to create product standards",
                errors=[str(e)],
            )
    
    def _generate_global_standards(self, request: GenerateGlobalStandardsRequest) -> OperationResponse:
        """
        Execute global standards creation.
        
        Writes to:
        - {company}/haikai/standards/global/*.md (primary location)
        - {company}/haikai/profiles/default/standards/global/tech-stack.md (copy for Haikai compatibility)
        
        REPORT.md only goes to the primary location.
        """
        try:
            logger.info(f"Generating global standards for company={request.company}, sources={request.sources}, recursive={request.recursive}")

            # Validate company segment — raises ValueError on traversal.
            global_dir = _safe_company_dir(self.workspace_dir, request.company)
            logger.info(f"Global directory: {global_dir}")

            # Resolve sources — block `..` traversal but allow multi-segment.
            resolved_sources = []
            for source in (request.sources or []):
                if source.startswith(('http://', 'https://', 'git@', 'git://')):
                    resolved_sources.append(source)
                else:
                    source_path = _safe_source_path(self.workspace_dir, source)
                    resolved_sources.append(str(source_path))
            
            logger.info(f"Resolved sources: {resolved_sources}")
            
            orchestrator = StandardsOrchestrator(
                config={
                    **self.env_config,
                    'output_dir': global_dir.as_posix(),
                    'mode': request.mode if isinstance(request.mode, str) else request.mode.value,
                    'technical_documents': request.technical_documents or {}
                }
            )
            
            outputs = orchestrator.run(
                sources=resolved_sources,
                recursive=request.recursive
            )
            
            logger.info(f"Global standards created successfully: {outputs}")
            
            # Outputs now include:
            # - REPORT.md in {company}/haikai/standards/global/ only
            # - tech-stack.md in both {company}/haikai/standards/global/ and profiles/
            all_outputs = [Path(p) for p in outputs.values()]
            
            return OperationResponse(
                success=True,
                mode=request.mode,
                output_dir=global_dir,
                outputs=all_outputs,
                message=f"Global standards created successfully"
            )
        except Exception as e:
            logger.error(f"Failed to create global standards: {str(e)}", exc_info=True)
            return OperationResponse(
                success=False,
                mode=request.mode,
                output_dir=locals().get("global_dir") or self.workspace_dir,
                outputs=[],
                message="Failed to create global standards",
                errors=[str(e)]
            )
