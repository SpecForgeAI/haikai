"""Metamodel serialiser — converts DiagramModel to architecture.json format.

Produces diagram_nodes and diagram_edges dicts compatible with the
architecture.json metamodel structure. Returns dict (not string).
"""
import logging
import uuid

from src.ast.diagram_model import DiagramModel, DiagramEntity, DiagramRelationship

logger = logging.getLogger(__name__)

# Grid layout defaults
_DEFAULT_WIDTH = 200
_DEFAULT_HEIGHT = 120
_GRID_SPACING_X = 250
_GRID_SPACING_Y = 180
_GRID_COLS = 4
_DEFAULT_Z_INDEX = 1


class MetamodelSerialiser:
    """Convert DiagramModel to architecture.json diagram node/edge format."""

    def serialise(self, model: DiagramModel) -> dict:
        """Convert a DiagramModel to metamodel diagram format.

        Returns dict with 'diagram_nodes' and 'diagram_edges' lists,
        compatible with architecture.json layout data.
        Returns empty dict if model is None or has no entities.
        """
        if model is None or not model.entities:
            return {}

        nodes = []
        edges = []

        # Map entity IDs to generated node UUIDs for edge references
        entity_to_node_id: dict[str, str] = {}

        for idx, entity in enumerate(model.entities):
            node = self._create_node(entity, idx)
            nodes.append(node)
            entity_to_node_id[entity.id] = node["id"]

        for rel in model.relationships:
            source_node_id = entity_to_node_id.get(rel.source_id)
            target_node_id = entity_to_node_id.get(rel.target_id)
            if source_node_id and target_node_id:
                edge = self._create_edge(rel, source_node_id, target_node_id)
                edges.append(edge)

        return {
            "diagram_nodes": nodes,
            "diagram_edges": edges,
        }

    def _create_node(self, entity: DiagramEntity, index: int) -> dict:
        """Map DiagramEntity to architecture.json node format.

        Uses simple grid layout for auto-positioning.
        """
        col = index % _GRID_COLS
        row = index // _GRID_COLS

        node = {
            "id": _generate_uuid(),
            "entity_type": _map_entity_type(entity.entity_type),
            "entity_id": entity.id,
            "label": entity.name,
            "pos_x": col * _GRID_SPACING_X,
            "pos_y": row * _GRID_SPACING_Y,
            "width": _DEFAULT_WIDTH,
            "height": _DEFAULT_HEIGHT,
            "z_index": _DEFAULT_Z_INDEX,
        }

        if entity.parent_id:
            node["parent_node_id"] = entity.parent_id

        return node

    def _create_edge(
        self,
        rel: DiagramRelationship,
        source_node_id: str,
        target_node_id: str,
    ) -> dict:
        """Map DiagramRelationship to architecture.json edge format."""
        edge = {
            "id": _generate_uuid(),
            "source_node_id": source_node_id,
            "target_node_id": target_node_id,
            "relationship_type": rel.rel_type,
        }

        if rel.label:
            edge["label"] = rel.label

        return edge


def _generate_uuid() -> str:
    """Generate a UUID matching architecture.json ID pattern."""
    return str(uuid.uuid4())


def _map_entity_type(entity_type: str) -> str:
    """Map DiagramModel entity types to architecture.json entity types."""
    type_map = {
        "class": "classes",
        "interface": "interfaces",
        "module": "packages",
        "method": "methods",
        "package": "packages",
        "pattern": "classes",
        "instance": "classes",
        "participant": "services",
        "component": "packages",
        # Agentic diagram entity types
        "controller": "services",
        "endpoint": "services",
        "service": "services",
        "database": "external_systems",
        "message_queue": "external_systems",
        "cache": "external_systems",
        "external_api": "external_systems",
        "topic": "external_systems",
        "entity": "classes",
    }
    return type_map.get(entity_type, entity_type)
