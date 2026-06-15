"""
Test script for the full metamodel persistence and product tech-stack generation workflow.
"""
import os
import json
import shutil
from pathlib import Path
from src.entrypoints.run import run_standards_extractor

def main():
    # 1. Setup test environment
    project_name = "test-product"
    output_dir = Path(f"./{project_name}-standards")
    if output_dir.exists():
        shutil.rmtree(output_dir)
    
    # 2. Create a mock metamodel file to "fetch"
    mock_metamodel_path = Path("/home/ubuntu/upload/pasted_content.txt")
    
    # 3. Create a mock global standard
    global_dir = output_dir / "global"
    global_dir.mkdir(parents=True, exist_ok=True)
    with open(global_dir / "tech-stack.md", "w") as f:
        f.write("# Global Tech Stack\n\n- **Language:** Java\n- **Framework:** Spring Boot\n- **Frontend:** Angular\n")

    print(f"Running full workflow for project: {project_name}")
    print(f"Sourcing metamodel from: {mock_metamodel_path}")
    
    # 4. Run the extractor with the new parameters
    run_standards_extractor(
        sources=["/home/ubuntu/standards-extractor/src"], # Just scan some local code
        project_name=project_name,
        output_dir=output_dir,
        technical_documents={
            "metamodel": [str(mock_metamodel_path)]
        },
        product_tech_standards=True
    )
    
    # 5. Verify results
    print("\n" + "="*60)
    print("VERIFICATION")
    print("="*60)
    
    # Check persistence
    persisted_arch = output_dir / "metamodel" / "architecture.json"
    if persisted_arch.exists():
        print(f"✅ SUCCESS: Metamodel persisted to {persisted_arch}")
    else:
        print(f"❌ FAILURE: Metamodel NOT persisted to {persisted_arch}")
        
    # Check product tech-stack
    product_ts = output_dir / "product" / "tech-stack.md"
    if product_ts.exists():
        print(f"✅ SUCCESS: Product tech-stack generated at {product_ts}")
        with open(product_ts, "r") as f:
            content = f.read()
            if "React" in content:
                print("✅ SUCCESS: Precedence logic applied (React found)")
            else:
                print("❌ FAILURE: Precedence logic NOT applied (React missing)")
    else:
        print(f"❌ FAILURE: Product tech-stack NOT generated at {product_ts}")

if __name__ == "__main__":
    main()
