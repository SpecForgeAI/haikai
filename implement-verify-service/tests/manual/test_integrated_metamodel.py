"""
Test script for integrated MetamodelAnalysisStrategy.
Verifies that the strategy works within the project's FileAnalyzer and categorization system.
"""

import os
import logging
from pathlib import Path
from dotenv import load_dotenv
from src.llm_client import LLMClient
from src.file_analyzer import FileAnalyzer, FileAnalysisContext
from src.categories import FileCategories

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

def main():
    # Load environment variables
    load_dotenv()
    
    # Initialize LLM client
    client = LLMClient(provider='openai', model='gpt-4.1-mini')
    
    # Initialize FileAnalyzer
    analyzer = FileAnalyzer(client)
    
    # Test file
    test_file = "/home/ubuntu/upload/pasted_content.txt"
    
    print(f"Analyzing metamodel file using integrated strategy: {test_file}")
    
    # Create context with 'metamodel' category
    context = FileAnalysisContext(
        path=test_file,
        category=FileCategories.METAMODEL,
        standard_file="global/tech-stack.md"
    )
    
    try:
        # This will trigger the MetamodelAnalysisStrategy.get_prompts() 
        # which includes the Pass 1 (Identify) and Pass 2 (Extract) logic
        result = analyzer.analyze_file(context)
        
        if result:
            print("\n" + "="*60)
            print("INTEGRATED ANALYSIS RESULT")
            print("="*60)
            print(f"Source File: {result.get('source_file')}")
            print(f"Category: {result.get('category')}")
            print(f"File Type: {result.get('file_type')}")
            
            print("\nTECH STACK:")
            ts = result.get('tech_stack', {})
            print(f"  Languages: {', '.join(ts.get('languages', []))}")
            print(f"  Frameworks: {', '.join(ts.get('frameworks', []))}")
            
            print("\nARCHITECTURAL SUMMARY:")
            for app in result.get('architectural_summary', []):
                print(f"  Application: {app.get('application')}")
                for comp in app.get('components', []):
                    print(f"    - {comp.get('name')}: {', '.join(comp.get('tech_stack', []))}")
            
            print("\nENRICHMENT NOTES:")
            print(result.get('enrichment_notes'))
        else:
            print("Analysis failed to return a result.")
            
    except Exception as e:
        import traceback
        print(f"Error during analysis: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    main()
