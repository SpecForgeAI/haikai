"""Unit tests for MetamodelSerialiser edge cases NOT covered by integration tests.

Integration coverage (test_diagram_integration.py on real diagram models):
- Returns dict with diagram_nodes and diagram_edges lists
- Correct node and edge counts from real data
- Node has required fields (id, entity_type, entity_id, pos_x, pos_y, width, height)
- Node id is UUID format, entity_type mapped (class→classes, method→methods)
- Edge has required fields, references valid node IDs
- Edge relationship_type matches rel_type
"""
import pytest
from src.ast.diagram_model import DiagramModel, DiagramEntity, DiagramRelationship
from src.ast.metamodel_serialiser import MetamodelSerialiser


@pytest.fixture
def serialiser():
    return MetamodelSerialiser()


@pytest.fixture
def class_model():
    return DiagramModel(
        diagram_type="class", title="Test",
        entities=[
            DiagramEntity(id="UserService", name="UserService", entity_type="class"),
            DiagramEntity(id="get_user", name="get_user", entity_type="method", parent_id="UserService"),
        ],
        relationships=[
            DiagramRelationship(source_id="UserService", target_id="get_user",
                                rel_type="contains", label="has method"),
        ],
    )


class TestMetamodelEdgeCases:

    def test_empty_model_returns_empty_dict(self, serialiser):
        assert serialiser.serialise(DiagramModel(diagram_type="class", title="Empty")) == {}

    def test_none_model_returns_empty_dict(self, serialiser):
        assert serialiser.serialise(None) == {}

    def test_no_relationships_returns_empty_edges(self, serialiser):
        model = DiagramModel(
            diagram_type="class", title="No Rels",
            entities=[DiagramEntity(id="A", name="A", entity_type="class")],
        )
        assert serialiser.serialise(model)["diagram_edges"] == []

    def test_parent_node_id_set_for_children(self, serialiser, class_model):
        """Methods get parent_node_id, top-level classes don't."""
        result = serialiser.serialise(class_model)
        method_node = [n for n in result["diagram_nodes"] if n["entity_id"] == "get_user"][0]
        class_node = [n for n in result["diagram_nodes"] if n["entity_id"] == "UserService"][0]
        assert method_node["parent_node_id"] == "UserService"
        assert "parent_node_id" not in class_node

    def test_positions_grid_layout(self, serialiser, class_model):
        """Nodes are laid out on a grid — not all at origin."""
        result = serialiser.serialise(class_model)
        nodes = result["diagram_nodes"]
        assert nodes[0]["pos_x"] == 0 and nodes[0]["pos_y"] == 0
        assert nodes[1]["pos_x"] > 0 or nodes[1]["pos_y"] > 0

    def test_edge_label_preserved(self, serialiser, class_model):
        """Edge labels from DiagramRelationship are preserved."""
        result = serialiser.serialise(class_model)
        assert result["diagram_edges"][0]["label"] == "has method"

    def test_edge_relationship_type_preserved(self, serialiser, class_model):
        result = serialiser.serialise(class_model)
        assert result["diagram_edges"][0]["relationship_type"] == "contains"
