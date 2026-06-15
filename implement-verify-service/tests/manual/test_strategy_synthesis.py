
import os
import json
from pathlib import Path
from src.standards_orchestrator import StandardsOrchestrator
from src.llm_client import LLMClient

def test_strategy_synthesis():
    # Setup mock config
    config = {
        'project_name': 'test-strategy-project',
        'output_dir': 'test-standards',
        'openai_api_key': os.getenv('OPENAI_API_KEY'),
        'openai_model': 'gpt-4.1-mini',
        'product_tech_standards': True
    }
    
    # Create orchestrator
    orchestrator = StandardsOrchestrator(config)
    
    # Create mock staging data
    staging_dir = Path('test-standards/staging')
    staging_dir.mkdir(parents=True, exist_ok=True)
    
    # 1. Mock Dependency Analysis
    dep_analysis = [{
        'tech_stack': {'languages': ['Python'], 'frameworks': ['Flask']},
        'standard_file': 'global/tech-stack.md'
    }]
    with open(staging_dir / 'dependency_analyses.json', 'w') as f:
        json.dump(dep_analysis, f)
        
    # 2. Mock Metamodel Analysis (High Precedence)
    meta_analysis = [{
        'tech_stack': {'languages': ['TypeScript'], 'frameworks': ['React', 'FastAPI']},
        'architectural_summary': 'Modern SPA with FastAPI backend',
        'standard_file': 'global/tech-stack.md'
    }]
    with open(staging_dir / 'metamodel_analyses.json', 'w') as f:
        json.dump(meta_analysis, f)
        
    # 3. Mock Global Standard
    global_dir = Path('test-standards/global')
    global_dir.mkdir(parents=True, exist_ok=True)
    with open(global_dir / 'tech-stack.md', 'w') as f:
        f.write("# Global Tech Stack\n\nBaseline: Java/Spring")
        
    # Run synthesis
    print("Running product synthesis...")
    results = orchestrator._synthesize_standards(is_product_mode=True)
    
    print(f"Results: {results}")
    
    product_file = Path('test-standards/product/tech-stack.md')
    if product_file.exists():
        print("\n--- Generated Product Tech Stack ---")
        with open(product_file, 'r') as f:
            print(f.read())
    else:
        print("Error: Product tech stack not generated")

if __name__ == "__main__":
    test_strategy_synthesis()
