"""
Test script for product-level tech-stack generation with precedence logic.
"""

import os
import json
import logging
from pathlib import Path
from dotenv import load_dotenv
from src.llm_client import LLMClient
from src.standards_synthesizer import StandardsSynthesizer

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

def main():
    # Load environment variables
    load_dotenv()
    
    # Initialize LLM client
    client = LLMClient(provider='openai', model='gpt-4.1-mini')
    
    # Initialize Synthesizer
    synthesizer = StandardsSynthesizer(client)
    
    # 1. Mock Global Tech Stack
    global_content = """# Global Tech Stack Standard

## Framework & Runtime
- **Language:** Java, Python
- **Framework:** Spring Boot, Django
- **Runtime:** JVM, Python 3.10

## Frontend
- **Framework:** Angular
- **CSS Framework:** Bootstrap

## Database
- **Database:** PostgreSQL
- **ORM:** Hibernate
"""

    # 2. Mock Metamodel Analysis (Conflict with Global)
    # Global says Angular/Bootstrap, Metamodel says React/Tailwind
    # Global says PostgreSQL, Metamodel says MongoDB
    metamodel_analyses = [
        {
            "tech_stack": {
                "languages": ["TypeScript", "Python"],
                "frameworks": ["React", "FastAPI"],
                "runtimes": ["Node.js"],
                "frontend": {
                    "frameworks": ["React"],
                    "libraries": ["Tailwind CSS"]
                },
                "backend": {
                    "technologies": ["FastAPI", "Python"]
                },
                "database": {
                    "systems": ["MongoDB"],
                    "patterns": ["Document Store"]
                }
            },
            "architectural_summary": [
                {
                    "application": "Product X",
                    "components": [
                        {"name": "Web UI", "tech_stack": ["React", "TypeScript"]},
                        {"name": "API Service", "tech_stack": ["FastAPI", "Python"]}
                    ]
                }
            ],
            "enrichment_notes": "Product X is a modern cloud-native application using a document-oriented database for high scalability."
        }
    ]
    
    print("Generating product-level tech-stack with precedence logic...")
    print("Global Standard: Java/Spring/Angular/PostgreSQL")
    print("Metamodel: Python/FastAPI/React/MongoDB")
    print("-" * 40)
    
    try:
        product_doc = synthesizer.synthesize_product_tech_stack(global_content, metamodel_analyses)
        
        print("\n" + "="*60)
        print("GENERATED PRODUCT TECH-STACK (project/product/tech-stack.md)")
        print("="*60)
        print(product_doc)
        
        # Verify precedence
        if "React" in product_doc and "Angular" not in product_doc:
            print("\n✅ SUCCESS: Metamodel (React) took precedence over Global (Angular)")
        elif "React" in product_doc:
            print("\n⚠️ PARTIAL: Metamodel (React) is present, but Global (Angular) might still be there.")
        else:
            print("\n❌ FAILURE: Metamodel (React) is missing.")
            
        if "MongoDB" in product_doc and "PostgreSQL" not in product_doc:
            print("✅ SUCCESS: Metamodel (MongoDB) took precedence over Global (PostgreSQL)")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
