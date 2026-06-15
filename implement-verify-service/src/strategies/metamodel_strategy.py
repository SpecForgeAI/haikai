"""
Metamodel Analysis Strategy

Intelligently parses architectural metamodel JSON files using a two-pass LLM workflow.
Follows the project's Strategy Pattern and Martin Fowler's architectural principles.
"""

import json
import logging
import re
from typing import Tuple, Dict, Any, List
from .base_strategy import AnalysisStrategy, FileAnalysisContext
from src.content_extractor import ContentExtractor

logger = logging.getLogger(__name__)

# Pass 1: Identify Metamodel Structure and Nature
IDENTIFY_METAMODEL_SYSTEM_PROMPT = """You are an expert enterprise architect and metadata analyst.

Your task is to analyze a JSON file that represents an architectural metamodel and identify its structure, nature, and key entities.

You must determine:
1. **Metamodel Type**: What kind of metamodel is this? (e.g., Application Portfolio, Service Mesh, Data Model, Full Enterprise Architecture)
2. **Core Entities**: What are the primary entities defined? (e.g., Applications, Services, Components, Interfaces, Data Entities)
3. **Schema Mapping**: How are technologies and tech-stack information represented? (e.g., core_tech fields, app_type fields, attribute lists)
4. **Relationship Depth**: How deep are the relationships? (e.g., App -> Service -> Component -> Interface)

Provide your analysis in the following JSON format:
{
  "metamodel_type": "string",
  "nature": "string (brief description of what this metamodel represents)",
  "primary_entities": ["entity1", "entity2"],
  "tech_stack_locations": [
    {
      "entity": "entity_name",
      "field": "field_name",
      "description": "what this field represents in terms of technology"
    }
  ],
  "extraction_strategy": "string (how should we best extract tech-stack info from this specific structure?)"
}

Be precise and focus on the structural metadata."""

# Pass 2: Extract and Enrich Tech-Stack Information
EXTRACT_TECH_STACK_SYSTEM_PROMPT = """You are a technology stack expert and technical architect.

Your task is to extract and enrich tech-stack information from an architectural metamodel JSON file, guided by a structural analysis of that metamodel.

You will receive:
1. The structural analysis of the metamodel (from Pass 1)
2. The full JSON content of the metamodel

Your goal is to produce a comprehensive tech-stack summary that includes:
1. **Framework & Runtime**: Languages, frameworks, and runtimes
2. **Frontend**: UI frameworks and libraries
3. **Backend**: Service types, API types, and backend technologies
4. **Database & Storage**: Databases and data storage patterns
5. **Architectural Context**: How these technologies are organized (e.g., by application, by service)

Provide your extraction in the following JSON format:
{
  "tech_stack": {
    "languages": ["Python", "TypeScript", etc],
    "frameworks": ["React", "Spring Boot", etc],
    "runtimes": ["Node.js", "JVM", etc],
    "frontend": {
      "frameworks": [],
      "libraries": []
    },
    "backend": {
      "service_types": ["REST", "CRUD", "ETL"],
      "api_types": ["REST API", "GraphQL"],
      "technologies": []
    },
    "database": {
      "systems": ["PostgreSQL", "MongoDB"],
      "patterns": ["Relational", "Document"]
    }
  },
  "architectural_summary": [
    {
      "application": "App Name",
      "components": [
        {
          "name": "Component Name",
          "tech_stack": ["Tech1", "Tech2"]
        }
      ]
    }
  ],
  "enrichment_notes": "Any insights or architectural patterns discovered during extraction"
}

Be thorough and ensure all technologies mentioned in the metamodel are captured and correctly categorized."""


class MetamodelAnalysisStrategy(AnalysisStrategy):
    """
    Strategy for analyzing architectural metamodel JSON files.
    
    Follows the project's Strategy Pattern and implements a two-pass LLM workflow:
    1. Identify metamodel structure (Pass 1)
    2. Extract and enrich tech-stack (Pass 2)
    
    This strategy leverages the existing ContentExtractor for structural analysis
    and follows the project's preference for meaningful process step names.
    """
    
    def __init__(self, llm_client):
        """
        Initialize with LLM client.
        
        Args:
            llm_client: LLM client for analysis
        """
        self.llm_client = llm_client
        logger.info("MetamodelAnalysisStrategy initialized")
    
    def get_prompts(
        self, 
        file_path: str, 
        content: str, 
        context: FileAnalysisContext
    ) -> Tuple[str, str, int]:
        """
        Get prompts for metamodel analysis.
        
        This method implements the two-pass workflow:
        1. Pass 1: Identify Metamodel Structure
        2. Pass 2: Extract and Enrich Tech-Stack
        
        Args:
            file_path: Path to the metamodel JSON file
            content: JSON content
            context: Analysis context with metadata
            
        Returns:
            Tuple of (system_prompt, user_prompt, max_tokens)
        """
        # Pass 1: Identify Metamodel Structure
        logger.info(f"Pass 1: Identifying metamodel structure for {file_path}")
        
        # Use a preview for Pass 1 to save tokens and focus on structure
        json_preview = content[:4000]
        if len(content) > 4000:
            json_preview += "\n\n... (content continues)"
            
        pass1_user_prompt = f"""Analyze the following architectural metamodel JSON and identify its structure and nature:

**File Path:** {file_path}

**JSON Content (Preview):**
```json
{json_preview}
```

Identify the metamodel type and provide a strategy for extracting tech-stack information."""

        # Call LLM for Pass 1
        messages = [
            {'role': 'system', 'content': IDENTIFY_METAMODEL_SYSTEM_PROMPT},
            {'role': 'user', 'content': pass1_user_prompt}
        ]
        
        try:
            pass1_response_text = self.llm_client.generate(messages)
            pass1_analysis = self._parse_json_from_text(pass1_response_text)
            logger.info(f"Metamodel identified as: {pass1_analysis.get('metamodel_type')}")
        except Exception as e:
            logger.error(f"Pass 1 analysis failed: {e}")
            pass1_analysis = {"metamodel_type": "Unknown", "extraction_strategy": "Extract all technology-related fields."}

        # Pass 2: Extract and Enrich Tech-Stack
        # We return the prompts for Pass 2, which will be executed by the FileAnalyzer
        system_prompt = EXTRACT_TECH_STACK_SYSTEM_PROMPT
        
        user_prompt = f"""Extract and enrich tech-stack information from the following metamodel JSON.

**Metamodel Analysis (Pass 1):**
{json.dumps(pass1_analysis, indent=2)}

**Full JSON Content:**
{content}

Follow the extraction strategy identified in Pass 1 to produce a comprehensive tech-stack summary.
Return valid JSON only, no markdown code blocks or extra text."""

        return (system_prompt, user_prompt, 4000)
    
    def get_metadata(self, file_path: str, content: str, context: FileAnalysisContext) -> Dict[str, Any]:
        """Return metadata about the analyzed metamodel."""
        return {
            'file_type': 'metamodel_json',
            'content_length': len(content),
            'analysis_type': 'two_pass_llm'
        }
        
    def _parse_json_from_text(self, text: str) -> Dict[str, Any]:
        """Helper to extract and parse JSON from LLM response text."""
        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass
        
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            logger.warning(f"Could not parse JSON from response: {text[:100]}...")
            return {}
