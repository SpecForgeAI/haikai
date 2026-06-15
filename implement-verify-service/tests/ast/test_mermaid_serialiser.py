"""Unit tests for MermaidSerialiser edge cases NOT covered by integration tests.

Integration coverage (test_diagram_integration.py on real diagram models):
- Class diagram header, member listing, visibility prefixes (+, #, -)
- Inheritance arrows (<|--), implements arrows (<|..)
- Graph header (LR/TD), node IDs, edge labels
- Sequence diagram format (sequenceDiagram, participant, ->>)
"""
import pytest
from src.ast.diagram_model import DiagramModel, DiagramEntity, DiagramRelationship
from src.ast.mermaid_serialiser import MermaidSerialiser, sanitize_id, mermaid_visibility


@pytest.fixture
def serialiser():
    return MermaidSerialiser()


class TestMermaidEdgeCases:

    def test_empty_model_returns_empty(self, serialiser):
        assert serialiser.serialise(DiagramModel(diagram_type="class", title="Empty")) == ""

    def test_none_model_returns_empty(self, serialiser):
        assert serialiser.serialise(None) == ""

    def test_inheritance_tree_uses_td(self, serialiser):
        """Inheritance diagrams use top-down layout, not left-right."""
        model = DiagramModel(
            diagram_type="inheritance", title="Tree",
            entities=[DiagramEntity(id="A", name="A", entity_type="class"),
                      DiagramEntity(id="B", name="B", entity_type="class")],
            relationships=[DiagramRelationship(source_id="A", target_id="B", rel_type="extends")],
        )
        assert serialiser.serialise(model).startswith("graph TD")


class TestHelpers:

    def test_sanitize_id(self):
        assert sanitize_id("my-class.v2") == "my_class_v2"
        assert sanitize_id("src/ast/provider") == "src_ast_provider"

    def test_visibility_prefixes(self):
        assert mermaid_visibility("get_user") == "+"
        assert mermaid_visibility("_validate") == "#"
        assert mermaid_visibility("__secret") == "-"
