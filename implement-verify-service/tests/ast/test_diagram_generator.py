"""Unit tests for DiagramGenerator edge cases NOT covered by integration tests.

Integration coverage (test_diagram_integration.py on real snapshot data):
- Generates class diagram, inheritance tree, dependency graph, component diagram
- Generates all 4 formats (mermaid, plantuml, graphviz, metamodel)
- Generates to correct directory, files are non-empty
- Class diagram shows methods, inheritance arrows, visibility prefixes
- Pattern map generated from real patterns
"""
from pathlib import Path
import pytest
from src.ast.diagram_generator import DiagramGenerator


class TestDiagramGeneratorEdgeCases:

    def test_empty_snapshot_no_crash(self, tmp_path):
        """Empty snapshot → no crash (can't happen with real analysis)."""
        snapshot = tmp_path / "empty"
        snapshot.mkdir()
        DiagramGenerator().generate_all(snapshot)

    def test_unknown_format_skipped(self, tmp_path):
        """Unknown format name → silently skipped."""
        snapshot = tmp_path / "test"
        snapshot.mkdir()
        DiagramGenerator().generate_all(snapshot, formats=["xml", "yaml"])
