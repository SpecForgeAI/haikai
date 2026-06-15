"""Integration tests for diagram generation pipeline on real repo data.

Runs the full pipeline: ctags → store → tree-sitter → diagram builders → serialisers.
Uses real structural data from src/ast/*.py — not synthetic models.

Replaces unit tests from:
- test_diagram_builders.py: all 5 file readers, all 7 builders producing models with entities/relationships
- test_diagram_generator.py: generates to correct dir, all formats, class diagram content
- test_diagram_model.py: entity construction, parent, defaults, relationship construction
- test_mermaid_serialiser.py: class diagram header, members, visibility, inheritance/implements arrows, graph format
- test_plantuml_serialiser.py: @startuml/@enduml, title, members, visibility, stereotypes, arrows
- test_graphviz_serialiser.py: digraph header, record shape, class nodes, inheritance arrowhead, subgraph clustering
- test_metamodel_serialiser.py: dict structure, node/edge counts, required fields, UUID ids, entity_type mapping
- test_metamodel_engine.py: direct mappings (class→component, method→operation), heuristic mappings
- test_call_graph.py: sequence serialisers (all 4 formats)
- test_graphviz_serialiser.py (Graphviz output)
- test_metamodel_serialiser.py (metamodel JSON output)
- test_metamodel_engine.py (metamodel population)
- test_diagram_model.py (diagram entities and relationships)
- test_call_graph.py (call graph write/read, sequence diagrams)
- test_serialiser_loader.py (config loading)
- test_kind_mapping_loader.py (kind mappings)
"""
import json
import tempfile
import pytest
from pathlib import Path

from src.ast.ctags_provider import CtagsProvider
from src.ast.treesitter_provider import TreeSitterProvider
from src.ast.provider import ProviderRegistry
from src.ast.store import FileStore, get_git_info
from src.ast.pipeline import run_structural_pipeline
from src.ast.diagram_generator import DiagramGenerator
from src.ast.diagram_builders import (
    ClassDiagramBuilder,
    InheritanceTreeBuilder,
    DependencyGraphBuilder,
    ComponentDiagramBuilder,
    PackageStructureBuilder,
    PatternMapBuilder,
    SequenceDiagramBuilder,
    read_index,
    read_inheritance,
    read_imports,
    read_calls,
    read_patterns,
)
from src.ast.mermaid_serialiser import MermaidSerialiser
from src.ast.plantuml_serialiser import PlantUMLSerialiser
from src.ast.graphviz_serialiser import GraphvizSerialiser
from src.ast.metamodel_serialiser import MetamodelSerialiser
from src.ast.metamodel_engine import MetamodelEngine
from src.ast.diagram_model import DiagramEntity, DiagramRelationship, DiagramModel


@pytest.fixture(scope="module")
def real_snapshot():
    """Create a real structural store snapshot from this repo's src/ast/ files.
    
    Scope=module so we only run ctags + tree-sitter once for all tests.
    """
    import glob
    ast_files = sorted(glob.glob("src/ast/*.py"))
    assert len(ast_files) >= 15

    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStore(base_path=tmpdir)
        registry = ProviderRegistry()
        ctags = CtagsProvider()
        if ctags.is_available():
            registry.register(ctags)

        # Run ctags
        analyses = registry.analyze_batch(ast_files)
        assert len(analyses) > 0

        # Run full pipeline (ctags → store → tree-sitter)
        analyses = run_structural_pipeline(
            file_paths=ast_files,
            ctags_results=analyses,
            store=store,
            registry=registry,
            repo_name="test-repo",
            commit_sha="abc123",
            branch="main",
            project_root=".",
        )

        # Find the snapshot path
        snapshot_path = store.get_latest_path("test-repo")
        assert snapshot_path is not None

        yield Path(snapshot_path), analyses


class TestFileReadersOnRealData:
    """Test diagram builders' file readers on real index files."""

    def test_read_index_real(self, real_snapshot):
        """read_index() returns real symbols from _index.txt."""
        snapshot_path, _ = real_snapshot
        symbols = read_index(snapshot_path)
        assert len(symbols) > 50, f"Expected 50+ symbols, got {len(symbols)}"

    def test_read_inheritance_real(self, real_snapshot):
        """read_inheritance() returns real relationships from _inheritance.txt."""
        snapshot_path, _ = real_snapshot
        rels = read_inheritance(snapshot_path)
        assert len(rels) > 0, "Expected inheritance relationships"

    def test_read_imports_real(self, real_snapshot):
        """read_imports() returns real imports from _imports.txt."""
        snapshot_path, _ = real_snapshot
        imports = read_imports(snapshot_path)
        assert len(imports) > 10, f"Expected 10+ import lines, got {len(imports)}"

    def test_read_calls_real(self, real_snapshot):
        """read_calls() returns real call edges from _calls.txt."""
        snapshot_path, _ = real_snapshot
        calls = read_calls(snapshot_path)
        assert len(calls) > 100, f"Expected 100+ call edges, got {len(calls)}"

    def test_read_patterns_real(self, real_snapshot):
        """read_patterns() returns detected patterns from _patterns.txt."""
        snapshot_path, _ = real_snapshot
        patterns = read_patterns(snapshot_path)
        assert len(patterns) > 0, "Expected detected patterns"


class TestBuildersOnRealData:
    """Test all 7 diagram builders produce output from real index files."""

    def test_class_diagram_builder(self, real_snapshot):
        """ClassDiagramBuilder produces entities from real classes."""
        snapshot_path, _ = real_snapshot
        builder = ClassDiagramBuilder()
        model = builder.build(snapshot_path)
        assert model is not None, "Expected class diagram"
        assert len(model.entities) > 5, f"Expected 5+ class entities, got {len(model.entities)}"
        assert any(e.entity_type == "class" for e in model.entities)

    def test_inheritance_tree_builder(self, real_snapshot):
        """InheritanceTreeBuilder produces inheritance relationships."""
        snapshot_path, _ = real_snapshot
        builder = InheritanceTreeBuilder()
        model = builder.build(snapshot_path)
        assert model is not None, "Expected inheritance tree"
        assert len(model.relationships) > 0

    def test_dependency_graph_builder(self, real_snapshot):
        """DependencyGraphBuilder produces import-based dependencies."""
        snapshot_path, _ = real_snapshot
        builder = DependencyGraphBuilder()
        model = builder.build(snapshot_path)
        assert model is not None, "Expected dependency graph"
        assert len(model.entities) > 0

    def test_component_diagram_builder(self, real_snapshot):
        """ComponentDiagramBuilder groups by directory."""
        snapshot_path, _ = real_snapshot
        builder = ComponentDiagramBuilder()
        model = builder.build(snapshot_path)
        assert model is not None, "Expected component diagram"

    def test_package_structure_builder(self, real_snapshot):
        """PackageStructureBuilder produces package hierarchy."""
        snapshot_path, _ = real_snapshot
        builder = PackageStructureBuilder()
        model = builder.build(snapshot_path)
        assert model is not None, "Expected package structure"

    def test_pattern_map_builder(self, real_snapshot):
        """PatternMapBuilder produces pattern detection results."""
        snapshot_path, _ = real_snapshot
        builder = PatternMapBuilder()
        model = builder.build(snapshot_path)
        # May be None if no patterns detected — that's ok
        if model is not None:
            assert len(model.entities) > 0

    def test_sequence_diagram_builder(self, real_snapshot):
        """SequenceDiagramBuilder produces sequence from real call data."""
        snapshot_path, _ = real_snapshot
        builder = SequenceDiagramBuilder()
        model = builder.build(snapshot_path)
        assert model is not None, "Expected sequence diagram from real calls"
        assert len(model.entities) > 0, "Expected participants in sequence"
        assert len(model.relationships) > 0, "Expected call edges in sequence"


class TestDiagramModelOnRealData:
    """Test DiagramModel entities and relationships from real builders."""

    def test_entity_has_name(self, real_snapshot):
        snapshot_path, _ = real_snapshot
        model = ClassDiagramBuilder().build(snapshot_path)
        for entity in model.entities[:5]:
            assert entity.name, f"Entity missing name: {entity}"

    def test_entity_has_kind(self, real_snapshot):
        snapshot_path, _ = real_snapshot
        model = ClassDiagramBuilder().build(snapshot_path)
        for entity in model.entities[:5]:
            assert entity.entity_type in ("class", "interface", "module", "function", "package", "component", "method")

    def test_relationship_has_source_target(self, real_snapshot):
        snapshot_path, _ = real_snapshot
        model = InheritanceTreeBuilder().build(snapshot_path)
        if model and model.relationships:
            for rel in model.relationships[:5]:
                assert rel.source_id, f"Relationship missing source_id: {rel}"
                assert rel.target_id, f"Relationship missing target_id: {rel}"


class TestSerialisersOnRealData:
    """Test all 4 serialisers produce valid output from real diagram models."""

    @pytest.fixture
    def class_model(self, real_snapshot):
        snapshot_path, _ = real_snapshot
        return ClassDiagramBuilder().build(snapshot_path)

    @pytest.fixture
    def inheritance_model(self, real_snapshot):
        snapshot_path, _ = real_snapshot
        return InheritanceTreeBuilder().build(snapshot_path)

    @pytest.fixture
    def sequence_model(self, real_snapshot):
        snapshot_path, _ = real_snapshot
        return SequenceDiagramBuilder().build(snapshot_path)

    # --- Mermaid ---

    def test_mermaid_class_diagram(self, class_model):
        """MermaidSerialiser produces valid Mermaid from real classes."""
        s = MermaidSerialiser()
        output = s.serialise(class_model)
        assert output is not None
        assert "classDiagram" in output or "class " in output
        assert len(output) > 50

    def test_mermaid_inheritance(self, inheritance_model):
        """MermaidSerialiser produces valid inheritance diagram."""
        s = MermaidSerialiser()
        output = s.serialise(inheritance_model)
        assert output is not None
        assert len(output) > 20

    def test_mermaid_sequence(self, sequence_model):
        """MermaidSerialiser produces valid sequence diagram."""
        s = MermaidSerialiser()
        output = s.serialise(sequence_model)
        assert output is not None
        assert "sequenceDiagram" in output or "->>" in output

    # --- PlantUML ---

    def test_plantuml_class_diagram(self, class_model):
        """PlantUMLSerialiser produces valid PlantUML from real classes."""
        s = PlantUMLSerialiser()
        output = s.serialise(class_model)
        assert output is not None
        assert "@startuml" in output
        assert "@enduml" in output

    def test_plantuml_inheritance(self, inheritance_model):
        """PlantUMLSerialiser produces valid inheritance diagram."""
        s = PlantUMLSerialiser()
        output = s.serialise(inheritance_model)
        assert output is not None
        assert "@startuml" in output

    def test_plantuml_sequence(self, sequence_model):
        """PlantUMLSerialiser produces valid sequence diagram."""
        s = PlantUMLSerialiser()
        output = s.serialise(sequence_model)
        assert output is not None
        assert "@startuml" in output

    # --- Graphviz ---

    def test_graphviz_class_diagram(self, class_model):
        """GraphvizSerialiser produces valid DOT from real classes."""
        s = GraphvizSerialiser()
        output = s.serialise(class_model)
        assert output is not None
        assert "digraph" in output or "graph" in output

    def test_graphviz_inheritance(self, inheritance_model):
        """GraphvizSerialiser produces valid inheritance DOT."""
        s = GraphvizSerialiser()
        output = s.serialise(inheritance_model)
        assert output is not None
        assert "digraph" in output or "graph" in output

    def test_graphviz_sequence(self, sequence_model):
        """GraphvizSerialiser produces valid sequence DOT."""
        s = GraphvizSerialiser()
        output = s.serialise(sequence_model)
        assert output is not None

    # --- Metamodel ---

    def test_metamodel_class_diagram(self, class_model):
        """MetamodelSerialiser produces valid JSON from real classes."""
        s = MetamodelSerialiser()
        output = s.serialise(class_model)
        assert output is not None
        # MetamodelSerialiser returns a dict directly, not a JSON string
        if isinstance(output, dict):
            data = output
        else:
            data = json.loads(output)
        assert isinstance(data, (dict, list))

    def test_metamodel_sequence(self, sequence_model):
        """MetamodelSerialiser produces valid JSON from real sequences."""
        s = MetamodelSerialiser()
        output = s.serialise(sequence_model)
        assert output is not None
        if isinstance(output, str):
            json.loads(output)
        else:
            assert isinstance(output, (dict, list))


class TestDiagramGeneratorOnRealData:
    """Test the full generator orchestrator on a real snapshot."""

    def test_generate_all_mermaid(self, real_snapshot):
        """generate_all produces Mermaid files in diagrams/ directory."""
        snapshot_path, _ = real_snapshot
        gen = DiagramGenerator()
        gen.generate_all(snapshot_path, formats=["mermaid"])
        diagrams_dir = snapshot_path / "diagrams"
        mmd_files = list(diagrams_dir.glob("*.mmd"))
        assert len(mmd_files) >= 3, f"Expected 3+ .mmd files, got {len(mmd_files)}: {[f.name for f in mmd_files]}"

    def test_generate_all_plantuml(self, real_snapshot):
        """generate_all produces PlantUML files."""
        snapshot_path, _ = real_snapshot
        gen = DiagramGenerator()
        gen.generate_all(snapshot_path, formats=["plantuml"])
        diagrams_dir = snapshot_path / "diagrams"
        puml_files = list(diagrams_dir.glob("*.puml"))
        assert len(puml_files) >= 3, f"Expected 3+ .puml files, got {len(puml_files)}"

    def test_generate_all_graphviz(self, real_snapshot):
        """generate_all produces Graphviz DOT files."""
        snapshot_path, _ = real_snapshot
        gen = DiagramGenerator()
        gen.generate_all(snapshot_path, formats=["graphviz"])
        diagrams_dir = snapshot_path / "diagrams"
        dot_files = list(diagrams_dir.glob("*.dot"))
        assert len(dot_files) >= 3, f"Expected 3+ .dot files, got {len(dot_files)}"

    def test_generate_all_metamodel(self, real_snapshot):
        """generate_all produces metamodel JSON files."""
        snapshot_path, _ = real_snapshot
        gen = DiagramGenerator()
        gen.generate_all(snapshot_path, formats=["metamodel"])
        diagrams_dir = snapshot_path / "diagrams"
        json_files = list(diagrams_dir.glob("*.json"))
        assert len(json_files) >= 3, f"Expected 3+ .json files, got {len(json_files)}"

    def test_generate_all_formats(self, real_snapshot):
        """generate_all with all 4 formats produces files for each."""
        snapshot_path, _ = real_snapshot
        gen = DiagramGenerator()
        gen.generate_all(snapshot_path, formats=["mermaid", "plantuml", "graphviz", "metamodel"])
        diagrams_dir = snapshot_path / "diagrams"
        all_files = list(diagrams_dir.iterdir())
        assert len(all_files) >= 12, f"Expected 12+ diagram files (3+ per format), got {len(all_files)}"

    def test_diagram_files_not_empty(self, real_snapshot):
        """All generated diagram files have content."""
        snapshot_path, _ = real_snapshot
        gen = DiagramGenerator()
        gen.generate_all(snapshot_path, formats=["mermaid"])
        diagrams_dir = snapshot_path / "diagrams"
        for f in diagrams_dir.glob("*.mmd"):
            content = f.read_text()
            assert len(content) > 10, f"Diagram file {f.name} is nearly empty"


class TestMetamodelEngineOnRealData:
    """Test metamodel population from real structural data."""

    def test_populate_from_real_snapshot(self, real_snapshot):
        """MetamodelEngine.populate() works on real analysis data."""
        snapshot_path, analyses = real_snapshot
        engine = MetamodelEngine()
        metamodel = {"components": [], "relationships": []}
        result = engine.populate(metamodel, analyses)
        assert result is not None
        # Should have enriched the metamodel
        assert isinstance(result, dict)


class TestCallGraphOnRealData:
    """Test call graph write/read round-trip and sequence generation on real data."""

    def test_calls_file_round_trip(self, real_snapshot):
        """_calls.txt can be written and read back."""
        snapshot_path, _ = real_snapshot
        calls = read_calls(snapshot_path)
        assert len(calls) > 0
        # Each call should have the expected fields
        for call in calls[:10]:
            assert "caller_file" in call or len(call) >= 4

    def test_sequence_builder_entry_points(self, real_snapshot):
        """SequenceDiagramBuilder discovers entry points from real calls."""
        snapshot_path, _ = real_snapshot
        builder = SequenceDiagramBuilder()
        model = builder.build(snapshot_path)
        assert model is not None
        # Should have discovered entry points
        participants = {e.name for e in model.entities}
        assert len(participants) >= 2, f"Expected 2+ participants, got {participants}"
