"""
Metamodel Parser Module

Extracts tech-stack information from architecture metamodel JSON files.
These JSON files come from a metamodel application that generates rich metadata
about applications, services, components, and their technologies.

This module serves as a third input source for tech-stack composition,
alongside user input and global standards.
"""

import json
from pathlib import Path
from typing import Dict, List, Optional, Set
from dataclasses import dataclass, field


@dataclass
class TechStackInfo:
    """Structured tech-stack information extracted from metamodel"""
    
    # Framework & Runtime
    languages: Set[str] = field(default_factory=set)
    frameworks: Set[str] = field(default_factory=set)
    runtimes: Set[str] = field(default_factory=set)
    
    # Frontend
    ui_frameworks: Set[str] = field(default_factory=set)
    ui_libraries: Set[str] = field(default_factory=set)
    
    # Backend
    service_types: Set[str] = field(default_factory=set)
    api_types: Set[str] = field(default_factory=set)
    
    # Database & Storage
    databases: Set[str] = field(default_factory=set)
    physical_data_types: Set[str] = field(default_factory=set)
    
    # Applications & Components
    applications: List[Dict] = field(default_factory=list)
    components: List[Dict] = field(default_factory=list)
    services: List[Dict] = field(default_factory=list)
    
    # Metadata
    project_id: Optional[str] = None
    source_file: Optional[str] = None


class MetamodelParser:
    """
    Parser for architecture metamodel JSON files.
    
    Extracts tech-stack information from the metaModel structure including:
    - Applications and their types
    - Services and their core technologies
    - Components and their purposes
    - Physical data entities (databases)
    - Interfaces and API types
    """
    
    def __init__(self):
        self.tech_stack_info = TechStackInfo()
    
    def parse_file(self, file_path: str) -> TechStackInfo:
        """
        Parse a metamodel JSON file and extract tech-stack information.
        
        Args:
            file_path: Path to the JSON file
            
        Returns:
            TechStackInfo object with extracted information
        """
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        return self.parse_json(data, source_file=file_path)
    
    def parse_json(self, data: Dict, source_file: Optional[str] = None) -> TechStackInfo:
        """
        Parse metamodel JSON data and extract tech-stack information.
        
        Args:
            data: Parsed JSON data
            source_file: Optional source file path for metadata
            
        Returns:
            TechStackInfo object with extracted information
        """
        self.tech_stack_info = TechStackInfo()
        self.tech_stack_info.source_file = source_file
        
        # Extract project_id if present
        if 'project_id' in data:
            self.tech_stack_info.project_id = data['project_id']
        
        # Navigate to metaModel.entities
        meta_model = data.get('metaModel', {})
        entities = meta_model.get('entities', {})
        
        # Extract from applications
        self._extract_from_applications(entities.get('applications', []))
        
        # Extract from services
        self._extract_from_services(entities.get('services', []))
        
        # Extract from components
        self._extract_from_components(entities.get('app_components', []))
        
        # Extract from physical data entities (databases)
        self._extract_from_physical_data(entities.get('physical_data_entities', []))
        
        # Extract from interfaces
        self._extract_from_interfaces(entities.get('interfaces', []))
        
        return self.tech_stack_info
    
    def _extract_from_applications(self, applications: List[Dict]):
        """Extract tech info from applications"""
        for app in applications:
            app_info = {
                'id': app.get('id'),
                'name': app.get('name'),
                'type': app.get('app_type'),
                'status': app.get('status'),
                'description': app.get('description')
            }
            self.tech_stack_info.applications.append(app_info)
            
            # Extract app_type as framework hint
            app_type = app.get('app_type', '').lower()
            if app_type in ['web', 'mobile', 'desktop']:
                self.tech_stack_info.frameworks.add(app_type.capitalize())
    
    def _extract_from_services(self, services: List[Dict]):
        """Extract tech info from services"""
        for service in services:
            service_info = {
                'id': service.get('id'),
                'name': service.get('name'),
                'type': service.get('service_type'),
                'core_tech': service.get('core_tech'),
                'description': service.get('description')
            }
            self.tech_stack_info.services.append(service_info)
            
            # Extract service_type
            service_type = service.get('service_type', '')
            if service_type:
                self.tech_stack_info.service_types.add(service_type)
                
                # Map service types to API types
                if 'REST' in service_type.upper():
                    self.tech_stack_info.api_types.add('REST API')
                elif 'GRAPHQL' in service_type.upper():
                    self.tech_stack_info.api_types.add('GraphQL')
                elif 'GRPC' in service_type.upper():
                    self.tech_stack_info.api_types.add('gRPC')
            
            # Extract core_tech (e.g., "React,TS", "Python", "Java,Spring Boot")
            core_tech = service.get('core_tech', '')
            if core_tech:
                technologies = [tech.strip() for tech in core_tech.split(',')]
                for tech in technologies:
                    self._categorize_technology(tech)
    
    def _extract_from_components(self, components: List[Dict]):
        """Extract tech info from app components"""
        for component in components:
            comp_info = {
                'id': component.get('id'),
                'name': component.get('name'),
                'application_id': component.get('application_id'),
                'description': component.get('description')
            }
            self.tech_stack_info.components.append(comp_info)
    
    def _extract_from_physical_data(self, physical_entities: List[Dict]):
        """Extract database information from physical data entities"""
        for entity in physical_entities:
            # Extract database name
            database = entity.get('database', '')
            if database:
                self.tech_stack_info.databases.add(database)
            
            # Extract physical_type (Table, View, Collection, etc.)
            physical_type = entity.get('physical_type', '')
            if physical_type:
                self.tech_stack_info.physical_data_types.add(physical_type)
                
                # Infer database type from physical_type
                if physical_type.lower() in ['table', 'view']:
                    # Likely SQL database
                    pass
                elif physical_type.lower() in ['collection', 'document']:
                    self.tech_stack_info.databases.add('MongoDB')
    
    def _extract_from_interfaces(self, interfaces: List[Dict]):
        """Extract API information from interfaces"""
        for interface in interfaces:
            interface_type = interface.get('interface_type', '')
            if interface_type:
                if 'REST' in interface_type.upper():
                    self.tech_stack_info.api_types.add('REST API')
                elif 'GRAPHQL' in interface_type.upper():
                    self.tech_stack_info.api_types.add('GraphQL')
                elif 'SOAP' in interface_type.upper():
                    self.tech_stack_info.api_types.add('SOAP')
    
    def _categorize_technology(self, tech: str):
        """Categorize a technology string into appropriate tech-stack category"""
        tech_lower = tech.lower()
        
        # Languages
        languages = {
            'python': 'Python',
            'java': 'Java',
            'javascript': 'JavaScript',
            'typescript': 'TypeScript',
            'ts': 'TypeScript',
            'ruby': 'Ruby',
            'go': 'Go',
            'rust': 'Rust',
            'c#': 'C#',
            'php': 'PHP',
            'kotlin': 'Kotlin',
            'swift': 'Swift'
        }
        
        # Frameworks
        frameworks = {
            'react': 'React',
            'vue': 'Vue.js',
            'angular': 'Angular',
            'svelte': 'Svelte',
            'spring boot': 'Spring Boot',
            'spring': 'Spring',
            'django': 'Django',
            'flask': 'Flask',
            'express': 'Express.js',
            'fastapi': 'FastAPI',
            'rails': 'Ruby on Rails',
            'laravel': 'Laravel',
            'next.js': 'Next.js',
            'nextjs': 'Next.js',
            'nest.js': 'NestJS',
            'nestjs': 'NestJS'
        }
        
        # Check languages
        for key, value in languages.items():
            if key in tech_lower:
                self.tech_stack_info.languages.add(value)
                return
        
        # Check frameworks
        for key, value in frameworks.items():
            if key in tech_lower:
                self.tech_stack_info.frameworks.add(value)
                return
        
        # If not categorized, add as framework (generic)
        self.tech_stack_info.frameworks.add(tech)
    
    def to_markdown(self) -> str:
        """
        Convert extracted tech-stack info to Markdown format
        matching the Haikai tech-stack.md template.
        
        Returns:
            Markdown formatted string
        """
        lines = []
        lines.append("## Tech Stack (from Metamodel)")
        lines.append("")
        lines.append("This tech stack was automatically extracted from architecture metamodel JSON files.")
        lines.append("")
        
        # Framework & Runtime
        if self.tech_stack_info.languages or self.tech_stack_info.frameworks:
            lines.append("### Framework & Runtime")
            if self.tech_stack_info.frameworks:
                lines.append(f"- **Application Framework:** {', '.join(sorted(self.tech_stack_info.frameworks))}")
            if self.tech_stack_info.languages:
                lines.append(f"- **Language/Runtime:** {', '.join(sorted(self.tech_stack_info.languages))}")
            lines.append("")
        
        # Frontend
        if self.tech_stack_info.ui_frameworks or self.tech_stack_info.ui_libraries:
            lines.append("### Frontend")
            if self.tech_stack_info.ui_frameworks:
                lines.append(f"- **JavaScript Framework:** {', '.join(sorted(self.tech_stack_info.ui_frameworks))}")
            if self.tech_stack_info.ui_libraries:
                lines.append(f"- **UI Components:** {', '.join(sorted(self.tech_stack_info.ui_libraries))}")
            lines.append("")
        
        # Backend Services
        if self.tech_stack_info.service_types or self.tech_stack_info.api_types:
            lines.append("### Backend Services")
            if self.tech_stack_info.service_types:
                lines.append(f"- **Service Types:** {', '.join(sorted(self.tech_stack_info.service_types))}")
            if self.tech_stack_info.api_types:
                lines.append(f"- **API Types:** {', '.join(sorted(self.tech_stack_info.api_types))}")
            lines.append("")
        
        # Database & Storage
        if self.tech_stack_info.databases or self.tech_stack_info.physical_data_types:
            lines.append("### Database & Storage")
            if self.tech_stack_info.databases:
                lines.append(f"- **Databases:** {', '.join(sorted(self.tech_stack_info.databases))}")
            if self.tech_stack_info.physical_data_types:
                lines.append(f"- **Data Types:** {', '.join(sorted(self.tech_stack_info.physical_data_types))}")
            lines.append("")
        
        # Applications Summary
        if self.tech_stack_info.applications:
            lines.append("### Applications")
            for app in self.tech_stack_info.applications:
                app_type = app.get('type', 'Unknown')
                status = app.get('status', 'Unknown')
                lines.append(f"- **{app['name']}**: {app_type} | {status}")
            lines.append("")
        
        # Services Summary
        if self.tech_stack_info.services:
            lines.append("### Services")
            for svc in self.tech_stack_info.services:
                svc_type = svc.get('type', 'Service')
                core_tech = svc.get('core_tech', '')
                if core_tech:
                    lines.append(f"- **{svc['name']}**: {svc_type} ({core_tech})")
                else:
                    lines.append(f"- **{svc['name']}**: {svc_type}")
            lines.append("")
        
        return '\n'.join(lines)
    
    def to_dict(self) -> Dict:
        """
        Convert extracted tech-stack info to dictionary format.
        
        Returns:
            Dictionary with tech-stack information
        """
        return {
            'project_id': self.tech_stack_info.project_id,
            'source_file': self.tech_stack_info.source_file,
            'languages': sorted(list(self.tech_stack_info.languages)),
            'frameworks': sorted(list(self.tech_stack_info.frameworks)),
            'ui_frameworks': sorted(list(self.tech_stack_info.ui_frameworks)),
            'service_types': sorted(list(self.tech_stack_info.service_types)),
            'api_types': sorted(list(self.tech_stack_info.api_types)),
            'databases': sorted(list(self.tech_stack_info.databases)),
            'applications': self.tech_stack_info.applications,
            'services': self.tech_stack_info.services,
            'components': self.tech_stack_info.components
        }


def parse_metamodel_files(file_paths: List[str]) -> TechStackInfo:
    """
    Parse multiple metamodel JSON files and merge their tech-stack information.
    
    Args:
        file_paths: List of paths to JSON files
        
    Returns:
        Merged TechStackInfo object
    """
    merged = TechStackInfo()
    
    for file_path in file_paths:
        parser = MetamodelParser()
        info = parser.parse_file(file_path)
        
        # Merge sets
        merged.languages.update(info.languages)
        merged.frameworks.update(info.frameworks)
        merged.ui_frameworks.update(info.ui_frameworks)
        merged.service_types.update(info.service_types)
        merged.api_types.update(info.api_types)
        merged.databases.update(info.databases)
        merged.physical_data_types.update(info.physical_data_types)
        
        # Merge lists
        merged.applications.extend(info.applications)
        merged.components.extend(info.components)
        merged.services.extend(info.services)
    
    return merged


# Example usage
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python metamodel_parser.py <json_file>")
        sys.exit(1)
    
    parser = MetamodelParser()
    tech_stack = parser.parse_file(sys.argv[1])
    
    print(parser.to_markdown())
    print("\n" + "="*60 + "\n")
    print("Extracted Data:")
    print(json.dumps(parser.to_dict(), indent=2))
