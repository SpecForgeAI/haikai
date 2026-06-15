"""
Strategy and Provider patterns for tech-stack synthesis.
Following Martin Fowler's architectural principles for modularity and extension.
"""
from abc import ABC, abstractmethod
from typing import Dict, List, Optional
import json

class TechStackProvider(ABC):
    """
    Abstract base class for tech-stack data providers.
    Each provider knows how to extract and format its own data for the LLM.
    """
    def __init__(self, name: str, precedence: int):
        self.name = name
        self.precedence = precedence  # Higher number = higher precedence

    @abstractmethod
    def get_metadata(self) -> str:
        """Return a string representation of the tech metadata for LLM context."""
        pass

class DependencyProvider(TechStackProvider):
    """Provides tech-stack data from dependency file analyses (e.g., package.json, requirements.txt)."""
    def __init__(self, analyses: List[Dict], precedence: int = 10):
        super().__init__("Dependency Analysis", precedence)
        self.analyses = analyses

    def get_metadata(self) -> str:
        if not self.analyses:
            return "No dependency data available."
        
        merged = {}
        for analysis in self.analyses:
            ts = analysis.get('tech_stack', {})
            for k, v in ts.items():
                if v:
                    if k not in merged: merged[k] = set()
                    if isinstance(v, list): merged[k].update(v)
                    else: merged[k].add(v)
        
        # Convert sets to lists for JSON serialization
        serializable = {k: list(v) for k, v in merged.items()}
        return f"### Dependency Metadata (Precedence: {self.precedence})\n{json.dumps(serializable, indent=2)}"

class MetamodelProvider(TechStackProvider):
    """Provides tech-stack data from architectural metamodel JSON files."""
    def __init__(self, analyses: List[Dict], precedence: int = 100):
        super().__init__("Metamodel Metadata", precedence)
        self.analyses = analyses

    def get_metadata(self) -> str:
        if not self.analyses:
            return "No metamodel data available."
        
        summaries = []
        tech_data = []
        for analysis in self.analyses:
            tech_data.append(analysis.get('tech_stack', {}))
            summaries.append(analysis.get('architectural_summary', ''))
            
        return f"### Metamodel Metadata (High Precedence: {self.precedence})\n" \
               f"Architectural Context: {json.dumps(summaries)}\n" \
               f"Tech Details: {json.dumps(tech_data, indent=2)}"

class GlobalStandardProvider(TechStackProvider):
    """Provides the baseline global tech-stack standard."""
    def __init__(self, content: str, precedence: int = 0):
        super().__init__("Global Standard Baseline", precedence)
        self.content = content

    def get_metadata(self) -> str:
        return f"### Global Standard Baseline (Lowest Precedence: {self.precedence})\n{self.content}"

class TechStackSynthesisStrategy(ABC):
    """
    Abstract strategy for synthesizing tech-stacks.
    Different strategies can handle different workflows (Global vs Product).
    """
    @abstractmethod
    def synthesize(self, llm_client, providers: List[TechStackProvider]) -> str:
        pass

class ProductTechStackStrategy(TechStackSynthesisStrategy):
    """Strategy for generating product-specific tech-stacks with strict precedence rules."""
    def synthesize(self, llm_client, providers: List[TechStackProvider]) -> str:
        # Sort providers by precedence (highest first)
        sorted_providers = sorted(providers, key=lambda p: p.precedence, reverse=True)
        
        context_blocks = [p.get_metadata() for p in sorted_providers]
        
        system_prompt = """You are a technical architect generating a product-specific tech-stack document.
Follow the provided metadata blocks in order of precedence. Higher precedence data MUST override lower precedence data if there are conflicts.
Your goal is to produce a concise, professional Markdown document tailored to this specific product."""

        user_prompt = f"""Create a product tech-stack document using the following precedence:

{chr(10).join(context_blocks)}

**Instructions:**
1. **PRIMARY CONTENT**: Extract ALL technologies from the Metamodel and organize them by their natural groupings (e.g., Data Platform, ML/AI, API Layer, Frontend, Backend Services)
2. **SUPPLEMENTARY CONTENT**: From the Global Standard Baseline, add any sections/categories that are COMPLETELY ABSENT from the metamodel
3. **CONFLICT RESOLUTION**: 
   - If a category exists in BOTH sources (e.g., Database, Frontend), use ONLY the metamodel version
   - Completely ignore the global template's content for that category
   - Only use global template for categories with ZERO presence in the metamodel
4. **Structure**: 
   - Start with an 'Architectural Context' section explaining the overall architecture
   - Follow with metamodel-derived sections (most detailed, highest precedence)
   - End with template sections for completely missing categories (use template examples as placeholders)
5. Return only the final Markdown content."""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        return llm_client.generate(messages)

class GlobalTechStackStrategy(TechStackSynthesisStrategy):
    """Strategy for generating company-wide global tech-stack standards."""
    def synthesize(self, llm_client, providers: List[TechStackProvider]) -> str:
        # For global, we usually just have dependencies and a template
        context_blocks = [p.get_metadata() for p in providers]
        
        system_prompt = "You are a technical architect defining company-wide tech-stack standards."
        user_prompt = f"Synthesize the following metadata into a global tech-stack standard:\n\n{chr(10).join(context_blocks)}"
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        return llm_client.generate(messages)
