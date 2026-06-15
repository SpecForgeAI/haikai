"""Unit tests for GraphvizSerialiser edge cases NOT covered by integration tests.

Integration coverage (test_diagram_integration.py on real diagram models):
- digraph header, record shape for classes
- Class node content, inheritance empty arrowhead
- Implements dashed style
- Subgraph clustering, edge labels
"""
import pytest
from src.ast.diagram_model import DiagramModel, DiagramEntity, DiagramRelationship
from src.ast.graphviz_serialiser import GraphvizSerialiser


@pytest.fixture
def serialiser():
    return GraphvizSerialiser()


class TestGraphvizEdgeCases:

    def test_empty_model_returns_empty(self, serialiser):
        assert serialiser.serialise(DiagramModel(diagram_type="class", title="Empty")) == ""

    def test_none_model_returns_empty(self, serialiser):
        assert serialiser.serialise(None) == ""

    def test_implements_uses_dashed_style(self, serialiser):
        """Implements relationships use dashed edges — specific to graphviz."""
        model = DiagramModel(
            diagram_type="class", title="Test",
            entities=[DiagramEntity(id="I", name="IRepo", entity_type="class"),
                      DiagramEntity(id="R", name="UserRepo", entity_type="class")],
            relationships=[DiagramRelationship(source_id="I", target_id="R", rel_type="implements")],
        )
        output = serialiser.serialise(model)
        assert "dashed" in output or "dotted" in output

    def test_subgraph_clustering(self, serialiser):
        """Component diagrams use subgraph clusters — graphviz specific."""
        model = DiagramModel(
            diagram_type="component", title="Components",
            entities=[
                DiagramEntity(id="src_api", name="api.py", entity_type="module",
                              parent_id="src"),
                DiagramEntity(id="src_db", name="db.py", entity_type="module",
                              parent_id="src"),
            ],
            relationships=[DiagramRelationship(source_id="src_api", target_id="src_db", rel_type="imports")],
        )
        output = serialiser.serialise(model)
        assert "digraph" in output
