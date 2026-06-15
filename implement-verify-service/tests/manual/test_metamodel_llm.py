"""
Test script for LLM-driven metamodel analyzer.
"""

import os
import json
import logging
from dotenv import load_dotenv
from src.llm_client import LLMClient
from src.metamodel_llm_analyzer import MetamodelLLMAnalyzer

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

def main():
    # Load environment variables
    load_dotenv()
    
    # Initialize LLM client
    # Using gpt-4.1-mini as it's efficient for JSON tasks
    provider = 'openai'
    model = 'gpt-4.1-mini'
    
    print(f"Initializing LLM client with {provider}/{model}...")
    client = LLMClient(provider=provider, model=model)
    
    # Initialize analyzer
    analyzer = MetamodelLLMAnalyzer(client)
    
    # Test file
    test_file = "/home/ubuntu/upload/pasted_content.txt"
    
    print(f"Analyzing metamodel file: {test_file}")
    try:
        result = analyzer.analyze_file(test_file)
        
        # Print results
        print("\n" + "="*60)
        print("METAMODEL IDENTIFICATION (PASS 1)")
        print("="*60)
        print(json.dumps(result['metamodel_info'], indent=2))
        
        print("\n" + "="*60)
        print("TECH-STACK EXTRACTION & ENRICHMENT (PASS 2)")
        print("="*60)
        print(json.dumps(result['tech_stack_analysis'], indent=2))
        
        print("\n" + "="*60)
        print("MARKDOWN OUTPUT")
        print("="*60)
        print(analyzer.to_markdown(result))
        
    except Exception as e:
        print(f"Error during analysis: {e}")

if __name__ == "__main__":
    main()
