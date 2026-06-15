"""Unit tests for PlantUMLSerialiser edge cases NOT covered by integration tests.

Integration coverage (test_diagram_integration.py on real diagram models):
- @startuml/@enduml wrapping, title line
- Class members listed, visibility prefixes (+, #, -)
- Extends arrows (<|--), implements arrows (<|..)
- Abstract/interface stereotypes
- Graph nodes and edges for non-class diagrams
"""
import pytest
from src.ast.diagram_model import DiagramModel, DiagramEntity, DiagramRelationship
from src.ast.plantuml_serialiser import PlantUMLSerialiser


@pytest.fixture
def serialiser():
    return PlantUMLSerialiser()


class TestPlantUMLEdgeCases:

    def test_empty_model_returns_empty(self, serialiser):
        assert serialiser.serialise(DiagramModel(diagram_type="class", title="Empty")) == ""

    def test_none_model_returns_empty(self, serialiser):
        assert serialiser.serialise(None) == ""

    def test_inheritance_diagram_format(self, serialiser):
        """Inheritance diagrams use same extends notation as class diagrams."""
        model = DiagramModel(
            diagram_type="inheritance", title="Tree",
            entities=[DiagramEntity(id="A", name="A", entity_type="class"),
                      DiagramEntity(id="B", name="B", entity_type="class")],
            relationships=[DiagramRelationship(source_id="A", target_id="B", rel_type="extends")],
        )
        output = serialiser.serialise(model)
        assert "@startuml" in output and "A <|-- B" in output and "@enduml" in output

    def test_component_diagram_format(self, serialiser):
        """Component diagrams use --> arrows."""
        model = DiagramModel(
            diagram_type="component", title="Components",
            entities=[DiagramEntity(id="api", name="api", entity_type="module"),
                      DiagramEntity(id="svc", name="svc", entity_type="module")],
            relationships=[DiagramRelationship(source_id="api", target_id="svc", rel_type="imports")],
        )
        output = serialiser.serialise(model)
        assert "@startuml" in output and "-->" in output
