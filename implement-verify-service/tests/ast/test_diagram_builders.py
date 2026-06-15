"""Unit tests for diagram builder edge cases NOT covered by integration tests.

Integration coverage (test_diagram_integration.py on real ctags+treesitter data):
- All 5 file readers (read_index, read_inheritance, read_imports, read_calls, read_patterns)
- All 7 builders produce DiagramModel with entities and relationships
- ClassDiagramBuilder: entities have entity_type, relationships have source_id/target_id
- InheritanceTreeBuilder, DependencyGraphBuilder, ComponentDiagramBuilder,
  PackageStructureBuilder, PatternMapBuilder, SequenceDiagramBuilder all tested on real data
"""
import pytest
from pathlib import Path

from src.ast.diagram_builders import (
    ClassDiagramBuilder, InheritanceTreeBuilder, DependencyGraphBuilder,
    ComponentDiagramBuilder, PackageStructureBuilder, PatternMapBuilder,
    read_index,
)


class TestBuilderEdgeCases:
    """Empty input handling — can't trigger on real repo with data."""

    def test_read_index_missing_file(self, tmp_path):
        result = read_index(tmp_path)
        assert result is not None

    @pytest.fixture
    def empty_snapshot(self, tmp_path):
        """Snapshot with header-only files."""
        (tmp_path / "_index.txt").write_text("# file\tkind\tname\tscope\n")
        (tmp_path / "_inheritance.txt").write_text("# class\tbase\n")
        (tmp_path / "_imports.txt").write_text("# file\tmodule\tnames\n")
        (tmp_path / "_calls.txt").write_text("# caller_file\tcaller\tcallee_file\tcallee\tline\tconfidence\n")
        (tmp_path / "_patterns.txt").write_text("# file\tpattern\n")
        return tmp_path

    def test_class_builder_empty(self, empty_snapshot):
        assert ClassDiagramBuilder().build(empty_snapshot) is None

    def test_inheritance_builder_empty(self, empty_snapshot):
        assert InheritanceTreeBuilder().build(empty_snapshot) is None

    def test_dependency_builder_empty(self, empty_snapshot):
        assert DependencyGraphBuilder().build(empty_snapshot) is None

    def test_component_builder_empty(self, empty_snapshot):
        assert ComponentDiagramBuilder().build(empty_snapshot) is None

    def test_package_builder_empty(self, empty_snapshot):
        assert PackageStructureBuilder().build(empty_snapshot) is None

    def test_pattern_builder_empty(self, empty_snapshot):
        assert PatternMapBuilder().build(empty_snapshot) is None


class TestSnapshotWithData:
    """Verify builder output structure with controlled synthetic data."""

    @pytest.fixture
    def snapshot_with_data(self, tmp_path):
        (tmp_path / "_index.txt").write_text(
            "# file\tkind\tname\tscope\n"
            "src/api.py\tclass\tApp\t-\n"
            "src/api.py\tmethod\thandle\tApp\n"
            "src/db.py\tclass\tDatabase\t-\n"
            "src/db.py\tmethod\tquery\tDatabase\n"
        )
        (tmp_path / "_inheritance.txt").write_text("# class\tbase\nApp\tBaseApp\n")
        (tmp_path / "_imports.txt").write_text("# file\tmodule\tnames\nsrc/api.py\tsrc.db\tDatabase\n")
        (tmp_path / "_calls.txt").write_text(
            "# caller_file\tcaller\tcallee_file\tcallee\tline\tconfidence\n"
            "src/api.py\tApp.handle\tsrc/db.py\tDatabase.query\t10\t0.95\n"
        )
        (tmp_path / "_patterns.txt").write_text("# file\tpattern\nsrc/db.py\trepository\n")
        return tmp_path

    def test_class_builder_entities_and_relationships(self, snapshot_with_data):
        model = ClassDiagramBuilder().build(snapshot_with_data)
        assert model is not None
        assert len(model.entities) > 0
        assert any(e.entity_type == "class" for e in model.entities)

    def test_inheritance_builder_has_tree(self, snapshot_with_data):
        model = InheritanceTreeBuilder().build(snapshot_with_data)
        assert model is not None
        assert len(model.relationships) > 0

    def test_dependency_builder_produces_model(self, snapshot_with_data):
        model = DependencyGraphBuilder().build(snapshot_with_data)
        assert model is not None
        assert len(model.entities) > 0
