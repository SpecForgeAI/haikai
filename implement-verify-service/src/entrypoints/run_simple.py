"""Simplified SDK for quick usage."""
from pathlib import Path
from src.entrypoints.run import StandardsExtractorClient

# Quick helper function
def run_extractor(operation: str, **kwargs):
    """
    Quick helper to run operations.
    
    Args:
        operation: One of 'get_metamodel', 'create_product_standards', 'generate_global_standards'
        **kwargs: Operation-specific arguments
    """
    client = StandardsExtractorClient()
    
    if operation == 'get_metamodel':
        return client.get_metamodel(**kwargs)
    elif operation == 'create_product_standards':
        return client.create_product_standards(**kwargs)
    elif operation == 'generate_global_standards':
        return client.generate_global_standards(**kwargs)
    else:
        raise ValueError(f"Unknown operation: {operation}")


# Example usage
if __name__ == "__main__":
    # Example 1: Get metamodel (using relative path)
    print("Example 1: Get metamodel")
    response = run_extractor(
        'get_metamodel',
        metamodel_id="proj_123",
        project_dir=Path("./my-project")  # Relative path OK
    )
    print(f"Success: {response.success}")
    
    # Example 2: Create global standards with technical documents (relative path)
    print("\nExample 2: Create global standards")
    response = run_extractor(
        'generate_global_standards',
        global_dir=Path("./global-standards"),  # Relative path OK
        sources=["./src"],  # At least one source required
        technical_documents={
            "tech_stack": ["https://github.com/org/repo/blob/main/docs/ARCHITECTURE.md"]
        }
    )
    print(f"Success: {response.success}")
    print(f"Output dir: {response.output_dir}")
    
    # Example 3: Create product standards (relative paths)
    print("\nExample 3: Create product standards")
    response = run_extractor(
        'create_product_standards',
        project_dir=Path("./my-project"),      # Relative path OK
        global_dir=Path("./global-standards")  # Relative path OK
    )
    print(f"Success: {response.success}")
