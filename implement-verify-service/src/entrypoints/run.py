"""Programmatic SDK for standards extraction."""
from pathlib import Path
from typing import List, Optional, Dict
from dotenv import load_dotenv
import os

from src.models import (
    GetMetamodelRequest,
    GenerateProductStandardsRequest,
    GenerateGlobalStandardsRequest,
    OperationResponse
)
from src.operation_executor import OperationExecutor


class StandardsExtractorClient:
    """
    Programmatic client for standards extraction.
    Provides a clean Python API for all operations.
    """
    
    def __init__(self, env_file: str = '.env'):
        """
        Initialize the client.
        
        Args:
            env_file: Path to environment file (default: .env)
        """
        load_dotenv(env_file)
        self.executor = OperationExecutor(self._load_env_config())
    
    def get_metamodel(
        self,
        metamodel_id: str,
        project_dir: Path
    ) -> OperationResponse:
        """
        Get architectural metamodel from external system.
        
        Args:
            metamodel_id: External metamodel identifier
            project_dir: Directory to write metamodel output (relative or absolute)
            
        Returns:
            OperationResponse with results
            
        Example:
            client = StandardsExtractorClient()
            response = client.get_metamodel(
                metamodel_id="proj_123",
                project_dir=Path("./my-project")  # Relative path OK
            )
        """
        request = GetMetamodelRequest(
            metamodel_id=metamodel_id,
            project_dir=project_dir
        )
        return self.executor.execute(request)
    
    def generate_product_standards(
        self,
        project_dir: Path,
        global_dir: Path,
        sources: Optional[List[str]] = None,
        recursive: bool = True
    ) -> OperationResponse:
        """
        Create product-level technical standards.
        
        Args:
            project_dir: Project workspace directory (relative or absolute)
            global_dir: Global standards directory (relative or absolute)
            sources: Optional source paths/URLs
            recursive: Recursively scan directories
            
        Returns:
            OperationResponse with results
            
        Example:
            client = StandardsExtractorClient()
            response = client.generate_product_standards(
                project_dir=Path("./my-project"),  # Relative paths OK
                global_dir=Path("./global-standards")
            )
        """
        request = GenerateProductStandardsRequest(
            project_dir=project_dir,
            global_dir=global_dir,
            sources=sources,
            recursive=recursive
        )
        return self.executor.execute(request)
    
    def generate_global_standards(
        self,
        company: str,
        global_dir: Path,
        sources: Optional[List[str]] = None,
        recursive: bool = True,
        technical_documents: Optional[Dict[str, List[str]]] = None
    ) -> OperationResponse:
        """
        Create global baseline standards from source code and/or technical documents.
        
        Args:
            company: Company name
            global_dir: Global standards directory (relative or absolute)
            sources: Source paths/URLs to analyze (optional if technical_documents provided)
            recursive: Recursively scan directories
            technical_documents: Optional technical documents to supplement analysis.
                                Keys: tech_stack, coding_style, conventions, error_handling, validation
            
        Returns:
            OperationResponse with results
            
        Example:
            client = StandardsExtractorClient()
            response = client.generate_global_standards(
                company="MyCompany",
                global_dir=Path("./global-standards"),  # Relative path OK
                sources=["./my-codebase"],
                technical_documents={
                    "tech_stack": ["https://github.com/org/repo/blob/main/docs/ARCHITECTURE.md"]
                }
            )
        """
        request = GenerateGlobalStandardsRequest(
            company=company,
            global_dir=global_dir,
            sources=sources,
            technical_documents=technical_documents,
            recursive=recursive
        )
        return self.executor.execute(request)
    
    def _load_env_config(self):
        """Load configuration from environment variables."""
        return {
            'llm_provider': os.getenv('LLM_PROVIDER', 'anthropic'),
            'llm_model': os.getenv('LLM_MODEL', 'claude-haiku-4-5-20251001'),
            'llm_api_key': self._get_llm_api_key(),
            'github_token': os.getenv('GITHUB_TOKEN'),
            'gitlab_token': os.getenv('GITLAB_TOKEN'),
            'bitbucket_username': os.getenv('BITBUCKET_USERNAME'),
            'bitbucket_password': os.getenv('BITBUCKET_APP_PASSWORD'),
            'config_dir': 'config',
            'templates_dir': 'templates/standards',
            'max_file_size_kb': 500,
            'standard_extraction_max_files': self._parse_int_or_none(
                os.getenv('STANDARD_EXTRACTION_MAX_FILES')
            )
        }
    
    def _get_llm_api_key(self):
        """Get LLM API key based on provider."""
        provider = os.getenv('LLM_PROVIDER', 'anthropic').lower()
        
        if provider == 'openai':
            return os.getenv('OPENAI_API_KEY')
        elif provider == 'anthropic':
            return os.getenv('ANTHROPIC_API_KEY')
        elif provider == 'azure':
            return os.getenv('AZURE_OPENAI_API_KEY')
        else:
            return os.getenv('CUSTOM_API_KEY')
    
    @staticmethod
    def _parse_int_or_none(value):
        """Parse integer or return None."""
        if not value or value == '':
            return None
        try:
            return int(value)
        except ValueError:
            return None


# Example usage
if __name__ == "__main__":
    client = StandardsExtractorClient()

    # # Example 1: Get metamodel
    # print("Example 1: Get metamodel")
    # response = client.get_metamodel(
    #     metamodel_id="proj_123",
    #     project_dir=Path("/workspace/my-project-1")
    # )
    # print(f"Success: {response.success}, Output: {response.outputs}")

    # Example 1: Using relative paths (automatically converted to absolute)
    print("Example 1: Using relative paths")
    print("Note: Relative paths are automatically converted to absolute paths")
    response = client.generate_global_standards(
        company="ExampleCompany",
        global_dir=Path("./company/global-standards"),  # Relative path
        sources=[],  # At least one source required
        technical_documents={
            "tech_stack": [
                "https://github.com/AutoMaker-Org/automaker/blob/main/apps/ui/docs/AGENT_ARCHITECTURE.md"
            ],
            # "coding_style": [],
            # "conventions": [],
            # "error_handling": [],
            # "validation": []
        }
    )
    print(f"Success: {response.success}")
    print(f"Resolved to: {response.output_dir}")

"""
    # Example 1: Get metamodel
    print("Example 1: Get metamodel")
    response = client.get_metamodel(
        metamodel_id="proj_123",
        project_dir=Path("/workspace/my-project-1")
    )
    print(f"Success: {response.success}, Output: {response.outputs}")

    # Example 2: Create global standards
    print("\nExample 2: Create global standards")
    response = client.generate_global_standards(
        global_dir=Path("/workspace/global-standards"),
        sources=[],
        technical_documents={
            "tech_stack": [
                "https://github.com/AutoMaker-Org/automaker/blob/main/apps/ui/docs/AGENT_ARCHITECTURE.md"
            ],
            # "coding_style": [],
            # "conventions": [],
            # "error_handling": [],
            # "validation": []
        }
    )
    print(f"Success: {response.success}, Files: {len(response.outputs)}")

    # Example 3: Create product standards
    print("\nExample 3: Create product standards")
    response = client.generate_product_standards(
        project_dir=Path("/workspace/repo_partial_repository-automaker_6"),
        global_dir=Path("/workspace/global-standards")
    )
    print(f"Success: {response.success}, Output: {response.outputs}")


"""

