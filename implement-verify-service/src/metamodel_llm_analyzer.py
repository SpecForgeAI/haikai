"""
LLM-Driven Metamodel Analyzer

Intelligently parses metamodel JSON files using a two-pass LLM workflow:
1. Identify Metamodel: Understand the structure and nature of the metamodel.
2. Extract & Enrich: Extract tech-stack information and enrich it with architectural context.
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any
from .llm_client import LLMClient

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

IDENTIFY_METAMODEL_USER_PROMPT_TEMPLATE = """Analyze the following architectural metamodel JSON and identify its structure and nature:

**File Path:** {file_path}

**JSON Content (Preview):**
```json
{json_preview}
```

Identify the metamodel type and provide a strategy for extracting tech-stack information."""

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

EXTRACT_TECH_STACK_USER_PROMPT_TEMPLATE = """Extract and enrich tech-stack information from the following metamodel JSON:

**Metamodel Analysis (Pass 1):**
```json
{metamodel_analysis}
```

**Full JSON Content:**
```json
{json_content}
```

Follow the extraction strategy identified in Pass 1 to produce a comprehensive tech-stack summary."""


class MetamodelLLMAnalyzer:
    """
    Two-pass LLM-driven analyzer for metamodel JSON files.
    """
    
    def __init__(self, llm_client: LLMClient):
        self.llm_client = llm_client
    
    def analyze_file(self, file_path: str) -> Dict[str, Any]:
        """
        Perform two-pass analysis on a metamodel file.
        
        Args:
            file_path: Path to the JSON file
            
        Returns:
            Enriched tech-stack analysis
        """
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
            
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON from {file_path}: {e}")
            raise
            
        # Pass 1: Identify Metamodel
        logger.info(f"Pass 1: Identifying metamodel structure for {file_path}")
        # Use a preview for Pass 1 to save tokens and focus on structure
        json_preview = json.dumps(data, indent=2)[:4000] 
        
        pass1_user_prompt = IDENTIFY_METAMODEL_USER_PROMPT_TEMPLATE.format(
            file_path=file_path,
            json_preview=json_preview
        )
        
        pass1_response = self.llm_client.generate_json(
            system_prompt=IDENTIFY_METAMODEL_SYSTEM_PROMPT,
            user_prompt=pass1_user_prompt
        )
        
        logger.info(f"Metamodel identified as: {pass1_response.get('metamodel_type')}")
        
        # Pass 2: Extract & Enrich
        logger.info(f"Pass 2: Extracting and enriching tech-stack from {file_path}")
        
        pass2_user_prompt = EXTRACT_TECH_STACK_USER_PROMPT_TEMPLATE.format(
            metamodel_analysis=json.dumps(pass1_response, indent=2),
            json_content=content
        )
        
        pass2_response = self.llm_client.generate_json(
            system_prompt=EXTRACT_TECH_STACK_SYSTEM_PROMPT,
            user_prompt=pass2_user_prompt
        )
        
        # Combine results
        result = {
            "metamodel_info": pass1_response,
            "tech_stack_analysis": pass2_response,
            "source_file": file_path
        }
        
        return result

    def to_markdown(self, analysis_result: Dict[str, Any]) -> str:
        """
        Convert LLM analysis result to Markdown format.
        """
        ts = analysis_result.get('tech_stack_analysis', {}).get('tech_stack', {})
        arch = analysis_result.get('tech_stack_analysis', {}).get('architectural_summary', [])
        meta = analysis_result.get('metamodel_info', {})
        
        lines = []
        lines.append(f"# Tech Stack Analysis: {analysis_result.get('metamodel_info', {}).get('metamodel_type', 'Architectural Metamodel')}")
        lines.append("")
        lines.append(f"**Nature:** {meta.get('nature', 'N/A')}")
        lines.append(f"**Source:** `{analysis_result.get('source_file')}`")
        lines.append("")
        
        lines.append("## Framework & Runtime")
        if ts.get('languages'):
            lines.append(f"- **Languages:** {', '.join(ts['languages'])}")
        if ts.get('frameworks'):
            lines.append(f"- **Frameworks:** {', '.join(ts['frameworks'])}")
        if ts.get('runtimes'):
            lines.append(f"- **Runtimes:** {', '.join(ts['runtimes'])}")
        lines.append("")
        
        lines.append("## Frontend")
        fe = ts.get('frontend', {})
        if fe.get('frameworks'):
            lines.append(f"- **Frameworks:** {', '.join(fe['frameworks'])}")
        if fe.get('libraries'):
            lines.append(f"- **Libraries:** {', '.join(fe['libraries'])}")
        lines.append("")
        
        lines.append("## Backend")
        be = ts.get('backend', {})
        if be.get('service_types'):
            lines.append(f"- **Service Types:** {', '.join(be['service_types'])}")
        if be.get('api_types'):
            lines.append(f"- **API Types:** {', '.join(be['api_types'])}")
        if be.get('technologies'):
            lines.append(f"- **Technologies:** {', '.join(be['technologies'])}")
        lines.append("")
        
        lines.append("## Database & Storage")
        db = ts.get('database', {})
        if db.get('systems'):
            lines.append(f"- **Systems:** {', '.join(db['systems'])}")
        if db.get('patterns'):
            lines.append(f"- **Patterns:** {', '.join(db['patterns'])}")
        lines.append("")
        
        if arch:
            lines.append("## Architectural Summary")
            for app in arch:
                lines.append(f"### {app.get('application', 'Unknown Application')}")
                for comp in app.get('components', []):
                    tech = ', '.join(comp.get('tech_stack', []))
                    lines.append(f"- **{comp.get('name')}**: {tech}")
            lines.append("")
            
        enrichment = analysis_result.get('tech_stack_analysis', {}).get('enrichment_notes')
        if enrichment:
            lines.append("## Enrichment Notes")
            lines.append(enrichment)
            
        return "\n".join(lines)
