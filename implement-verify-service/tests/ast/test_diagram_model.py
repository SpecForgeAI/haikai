"""Unit tests for DiagramModel edge cases NOT covered by integration tests.

Integration coverage (test_diagram_integration.py):
- Entity construction, parent, defaults → test_entity_has_name, test_entity_has_kind
- Relationship construction, default label → test_relationship_has_source_target
- Model construction → all builder tests create models
"""
from src.ast.diagram_model import DiagramModel


class TestDiagramModelEdgeCases:

    def test_model_empty_defaults(self):
        """Empty model defaults — can't trigger on real repo with data."""
        model = DiagramModel(diagram_type="class", title="Empty")
        assert model.entities == []
        assert model.relationships == []
