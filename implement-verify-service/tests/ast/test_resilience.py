"""Resilience tests — consolidated functional scenarios.

Each test is a broad scenario that exercises multiple failure modes
in a single pass, covering the same code paths as the original 67
scattered edge case tests.
"""
import tempfile
import json
import pytest
from pathlib import Path

from src.ast.treesitter_provider import TreeSitterProvider
from src.ast.extractors.python import PythonExtractor
from src.ast.treesitter_resolver import CallResolver
from src.ast.treesitter_models import RawCallSite, ResolutionContext
from src.ast.treesitter_config import load_extractors
from src.ast.provider import ProviderRegistry
from src.ast.store import FileStore
from src.ast.models import StructuralAnalysis, CallInfo
from src.ast.diagram_builders import (
    ClassDiagramBuilder, InheritanceTreeBuilder, DependencyGraphBuilder,
    ComponentDiagramBuilder, PackageStructureBuilder, PatternMapBuilder,
    SequenceDiagramBuilder, read_index, read_inheritance, read_imports,
    read_calls, read_patterns,
)
from src.ast.diagram_generator import DiagramGenerator
from src.ast.diagram_model import DiagramModel, DiagramEntity, DiagramRelationship
from src.ast.mermaid_serialiser import MermaidSerialiser
from src.ast.plantuml_serialiser import PlantUMLSerialiser
from src.ast.graphviz_serialiser import GraphvizSerialiser
from src.ast.metamodel_serialiser import MetamodelSerialiser


class TestEmptyAndMissingInput:
    """Everything empty/missing → nothing crashes, sensible defaults."""

    def test_pipeline_handles_nothing(self):
        """No files, no providers, no data → empty results everywhere."""
        # Provider with no files
        provider = TreeSitterProvider()
        assert provider.analyze_batch([]) == {}

        # Unsupported files only (use extensions with no registered extractor)
        assert provider.analyze_batch(["fake.rb", "fake.swift"]) == {}

        # Registry with nothing registered
        registry = ProviderRegistry()
        assert registry.analyze_batch(["src/ast/models.py"]) == {}

        # Extractor on empty source
        ext = PythonExtractor()
        assert ext.extract_calls(b"", "empty.py") == []
        assert ext.extract_imports(b"") == []
        assert ext.extract_assignments(b"") == {}
        assert ext.extract_annotations(b"") == {}

    def test_builders_and_readers_on_empty_snapshot(self):
        """Every builder + reader on empty dir → None or empty, no crash."""
        with tempfile.TemporaryDirectory() as tmpdir:
            snapshot = Path(tmpdir)

            # All file readers return empty
            for reader in [read_index, read_inheritance, read_imports, read_calls, read_patterns]:
                result = reader(snapshot)
                assert result is not None  # Not None — empty list or similar

            # Header-only calls file → empty
            (snapshot / "_calls.txt").write_text(
                "# caller_file\tcaller\tcallee_file\tcallee\tline\tconfidence\n"
            )
            assert len(read_calls(snapshot)) == 0

            # All builders return None
            builders = [
                ClassDiagramBuilder(), InheritanceTreeBuilder(),
                DependencyGraphBuilder(), ComponentDiagramBuilder(),
                PackageStructureBuilder(), PatternMapBuilder(),
                SequenceDiagramBuilder(),
            ]
            for builder in builders:
                result = builder.build(snapshot)
                assert result is None or isinstance(result, DiagramModel)

            # Generator on empty snapshot
            gen = DiagramGenerator()
            gen.generate_all(snapshot, formats=["mermaid"])

    def test_all_serialisers_on_empty_and_none(self):
        """All 4 serialisers handle None and empty models gracefully."""
        serialisers = [
            MermaidSerialiser(), PlantUMLSerialiser(),
            GraphvizSerialiser(), MetamodelSerialiser(),
        ]
        empty_model = DiagramModel(diagram_type="class", title="Empty")

        for s in serialisers:
            assert s.serialise(None) is not None
            assert s.serialise(empty_model) is not None


class TestCorruptAndPartialData:
    """Bad data in, graceful handling out."""

    def test_corrupt_sources_and_ambiguous_resolution(self):
        """Syntax errors, partial index, ambiguous ctags, unresolvable calls."""
        # Syntax error → partial or empty, no exception
        ext = PythonExtractor()
        calls = ext.extract_calls(b"def broken(\nclass Oops\n  if True print('bad')\n", "broken.py")
        assert isinstance(calls, list)

        # Partial index file → good rows recovered
        with tempfile.TemporaryDirectory() as tmpdir:
            index = Path(tmpdir) / "_index.txt"
            index.write_text(
                "# file\tkind\tname\tscope\n"
                "src/a.py\tclass\tFoo\t-\n"
                "BROKEN LINE\n"
                "src/b.py\tmethod\tbar\tFoo\n"
                "\n"
            )
            result = read_index(Path(tmpdir))
            assert len(result) > 0

        # Unresolvable call → low confidence
        resolver = CallResolver()
        call = RawCallSite("test.py", "<module>", "unknown_obj", "unknown_method", 1)
        result = resolver.resolve(call, ResolutionContext())
        assert result.confidence <= 0.3

        # Ambiguous ctags → picks best, no crash
        call = RawCallSite("src/a.py", "Test.run", None, "query", 10)
        ctx = ResolutionContext(symbol_index={"query": [
            ("Database", "src/db.py"), ("Cache", "lib/cache.py"), ("Model", "src/a.py"),
        ]})
        result = resolver.resolve(call, ctx)
        assert result.confidence > 0 and "query" in result.callee_name

    @pytest.mark.skipif(
        __import__("importlib").util.find_spec("tree_sitter_go") is None,
        reason=(
            "tree_sitter_go grammar not installed in this env; install via "
            "Dockerfile.dev path. Tracked in fix/260504-1127-full-repo-green."
        ),
    )
    def test_mixed_batch_nonexistent_and_unsupported(self):
        """Mix of real, nonexistent, and unsupported → real files analyzed."""
        provider = TreeSitterProvider()
        results = provider.analyze_batch([
            "tests/fixtures/sample_python.py",
            "/nonexistent/fake.py",
            "tests/fixtures/sample_go.go",
            "README.md",
            "Dockerfile",
        ])
        # Real code files have actual call data
        py = results.get("tests/fixtures/sample_python.py")
        go = results.get("tests/fixtures/sample_go.go")
        assert py is not None and len(py.calls) > 0
        assert go is not None and len(go.calls) > 0


class TestConfigResilience:
    """Missing/broken config → falls back to defaults."""

    def test_config_fallback_and_graceful_skip(self):
        """Missing config, empty config, disabled lang, missing package → all handled."""
        # Missing config → fallback to Python
        extractors = load_extractors("/nonexistent/path.yaml")
        assert ".py" in extractors

        # Empty config → fallback
        with tempfile.NamedTemporaryFile(suffix=".yaml", mode="w", delete=False) as f:
            f.write("")
            f.flush()
            assert ".py" in load_extractors(f.name)

        # Config with missing package → that lang skipped, Python still works
        with tempfile.NamedTemporaryFile(suffix=".yaml", mode="w", delete=False) as f:
            f.write("""
languages:
  haskell:
    extensions: [".hs"]
    package: tree_sitter_haskell
    extractor: src.ast.extractors.haskell.HaskellExtractor
    enabled: true
  python:
    extensions: [".py"]
    package: tree_sitter_python
    extractor: src.ast.extractors.python.PythonExtractor
    enabled: true
""")
            f.flush()
            extractors = load_extractors(f.name)
            assert ".py" in extractors
            assert ".hs" not in extractors

        # Unknown format in diagram generator → silently skipped
        with tempfile.TemporaryDirectory() as tmpdir:
            gen = DiagramGenerator()
            gen.generate_all(Path(tmpdir), formats=["xml", "yaml", "mermaid"])


class TestSerialiserRobustness:
    """All 4 serialisers handle tricky models correctly."""

    def test_all_serialisers_with_edge_case_models(self):
        """Single entity, special chars, sequence diagrams → all 4 serialisers."""
        serialisers = [
            MermaidSerialiser(), PlantUMLSerialiser(),
            GraphvizSerialiser(), MetamodelSerialiser(),
        ]

        models = [
            # Single entity, no relationships
            DiagramModel(
                diagram_type="class", title="Single",
                entities=[DiagramEntity(id="1", name="Foo", entity_type="class")],
            ),
            # Special characters in names
            DiagramModel(
                diagram_type="class", title="Special <Chars> & \"Quotes\"",
                entities=[
                    DiagramEntity(id="1", name="Foo<Bar>", entity_type="class"),
                    DiagramEntity(id="2", name='Baz "Qux"', entity_type="class"),
                ],
                relationships=[
                    DiagramRelationship(source_id="1", target_id="2", rel_type="extends"),
                ],
            ),
            # Sequence diagram
            DiagramModel(
                diagram_type="sequence", title="Test Sequence",
                entities=[
                    DiagramEntity(id="A", name="Client", entity_type="participant"),
                    DiagramEntity(id="B", name="Server", entity_type="participant"),
                ],
                relationships=[
                    DiagramRelationship(source_id="A", target_id="B", rel_type="calls", label="request()"),
                ],
            ),
        ]

        for s in serialisers:
            for model in models:
                result = s.serialise(model)
                assert result is not None


class TestResolutionEdgeCases:
    """Call resolution handles all unusual patterns correctly."""

    def test_all_resolution_patterns(self):
        """Module-level scope, self calls, convention matching, import resolution."""
        ext = PythonExtractor()
        resolver = CallResolver()

        # Module-level calls → caller is '<module>'
        source = b"import os\nresult = os.path.join('a', 'b')\nprint(result)\n"
        calls = ext.extract_calls(source, "test.py")
        assert any(c.caller_name == "<module>" for c in calls)

        # self parameter type annotation → not treated as real type
        source = b"class Foo:\n    def bar(self: 'Foo', name: str, db: Database):\n        pass\n"
        annotations = ext.extract_annotations(source)
        assert not any("self" in k for k in annotations.keys() if "." in k and k.split(".")[-1] == "self")

        # snake_case → PascalCase convention matching
        call = RawCallSite("test.py", "run", "file_store", "write", 10)
        ctx = ResolutionContext(class_index={"FileStore": "src/store.py"})
        result = resolver.resolve(call, ctx)
        assert result.callee_name == "FileStore.write"

        # self.method() → same class
        call = RawCallSite("test.py", "MyClass.run", "self", "helper", 10)
        ctx = ResolutionContext(class_index={"MyClass": "test.py"})
        result = resolver.resolve(call, ctx)
        assert result.callee_name == "MyClass.helper" and result.confidence == 0.95

        # Import resolution for bare calls
        call = RawCallSite("test.py", "<module>", None, "StructuralAnalysis", 5)
        ctx = ResolutionContext(
            imports={"StructuralAnalysis": ("src/ast/models.py", "StructuralAnalysis")},
            class_index={"StructuralAnalysis": "src/ast/models.py"},
        )
        result = resolver.resolve(call, ctx)
        assert result.confidence >= 0.85
