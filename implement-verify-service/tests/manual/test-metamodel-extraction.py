#!/usr/bin/env python
"""
Test what metadata the MetamodelProvider extracts from our architecture.json
"""
import json
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from strategies.metamodel_strategy import MetamodelAnalysisStrategy
from file_analyzer import FileAnalyzer, FileAnalysisContext, FileCategories
from llm_client import LLMClient

# Initialize LLM client
llm_client = LLMClient()

# Path to our architecture metamodel
arch_file = Path(r"C:\Projects\standards-extractor\api_workspace\CloudTech Enterprises\CloudDataPlatform\metamodel\architecture.json")

print("=" * 70)
print("TESTING METAMODEL EXTRACTION")
print("=" * 70)

# Create file analyzer
file_analyzer = FileAnalyzer(llm_client=llm_client)

# Analyze the metamodel
context = FileAnalysisContext(
    path=str(arch_file),
    category=FileCategories.METAMODEL,
    standard_file='global/tech-stack.md'
)

print(f"\n📂 Analyzing: {arch_file.name}")
print(f"   Category: {context.category}")

analysis = file_analyzer.analyze_file(context)

print("\n" + "=" * 70)
print("ANALYSIS RESULT")
print("=" * 70)

if analysis:
    print(json.dumps(analysis, indent=2))
    
    print("\n" + "=" * 70)
    print("TECH STACK SUMMARY")
    print("=" * 70)
    
    tech_stack = analysis.get('tech_stack', {})
    print(f"\nLanguages: {tech_stack.get('languages', [])}")
    print(f"Frameworks: {tech_stack.get('frameworks', [])}")
    print(f"Runtimes: {tech_stack.get('runtimes', [])}")
    
    if 'backend' in tech_stack:
        print(f"\nBackend:")
        print(f"  Service Types: {tech_stack['backend'].get('service_types', [])}")
        print(f"  Technologies: {tech_stack['backend'].get('technologies', [])}")
    
    if 'database' in tech_stack:
        print(f"\nDatabase:")
        print(f"  Systems: {tech_stack['database'].get('systems', [])}")
else:
    print("❌ No analysis returned")
