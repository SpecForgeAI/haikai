"""Format-agnostic diagram model.

Intermediate representation consumed by all serialisers.
Builders produce DiagramModels from structural store index files.
Serialisers convert DiagramModels to output format strings.
"""
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class DiagramEntity:
    """A node in a diagram — class, method, service, component, etc."""
    id: str
    name: str
    entity_type: str              # class, method, service, component, etc.
    parent_id: Optional[str] = None  # for nesting (methods in classes, services in components)
    properties: dict = field(default_factory=dict)  # signatures, visibility, flags, etc.


@dataclass
class DiagramRelationship:
    """An edge in a diagram — extends, implements, imports, calls, etc."""
    source_id: str
    target_id: str
    rel_type: str                 # extends, implements, imports, calls, etc.
    label: Optional[str] = None


@dataclass
class DiagramModel:
    """Format-agnostic diagram representation.

    Builders produce these from structural store index files.
    Serialisers consume these to produce output format strings.
    """
    diagram_type: str             # class, inheritance, dependency, component, pattern_map, etc.
    title: str
    entities: list[DiagramEntity] = field(default_factory=list)
    relationships: list[DiagramRelationship] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)  # language, repo, snapshot info
