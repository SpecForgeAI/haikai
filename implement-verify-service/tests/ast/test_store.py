"""Tests for the FileStore persistent structural store."""
import os
import tempfile
import shutil
from pathlib import Path

import pytest

from src.ast.models import (
    StructuralAnalysis, SymbolInfo, SymbolKind, InheritanceInfo, ImportInfo
)
from src.ast.store import FileStore, get_git_info


@pytest.fixture
def tmp_store(tmp_path):
    """Create a FileStore with a temporary base path."""
    return FileStore(base_path=str(tmp_path / "structural"))


@pytest.fixture
def sample_analyses():
    """Create sample structural analysis data for testing."""
    return {
        "src/api.py": StructuralAnalysis(
            file_path="src/api.py",
            language="Python",
            symbols=[
                SymbolInfo(name="create_app", kind=SymbolKind.FUNCTION, line_start=25, signature="()"),
                SymbolInfo(name="health_check", kind=SymbolKind.FUNCTION, line_start=45, signature="()", is_async=True),
            ],
            imports=[
                ImportInfo(module="fastapi", names=["FastAPI", "APIRouter"]),
                ImportInfo(module="src.file_analyzer", names=["FileAnalyzer"]),
            ],
            provider_used="ctags",
        ),
        "src/ast/provider.py": StructuralAnalysis(
            file_path="src/ast/provider.py",
            language="Python",
            symbols=[
                SymbolInfo(name="AnalysisProvider", kind=SymbolKind.CLASS, line_start=12, is_abstract=True),
                SymbolInfo(name="analyze_batch", kind=SymbolKind.METHOD, scope="AnalysisProvider",
                           line_start=20, signature="(self, file_paths: list[str])"),
                SymbolInfo(name="ProviderRegistry", kind=SymbolKind.CLASS, line_start=30),
                SymbolInfo(name="register", kind=SymbolKind.METHOD, scope="ProviderRegistry",
                           line_start=38, signature="(self, provider: AnalysisProvider)"),
                SymbolInfo(name="analyze_batch", kind=SymbolKind.METHOD, scope="ProviderRegistry",
                           line_start=45, signature="(self, file_paths: list[str])"),
            ],
            inheritance=[
                InheritanceInfo(class_name="AnalysisProvider", bases=["ABC"], is_abstract=True),
            ],
            imports=[
                ImportInfo(module="abc", names=["ABC", "abstractmethod"]),
                ImportInfo(module="src.ast.models", names=["StructuralAnalysis"]),
            ],
            provider_used="ctags",
        ),
        "src/ast/ctags_provider.py": StructuralAnalysis(
            file_path="src/ast/ctags_provider.py",
            language="Python",
            symbols=[
                SymbolInfo(name="CtagsProvider", kind=SymbolKind.CLASS, line_start=15, inherits="AnalysisProvider"),
                SymbolInfo(name="analyze_batch", kind=SymbolKind.METHOD, scope="CtagsProvider",
                           line_start=60, signature="(self, file_paths: list[str])"),
                SymbolInfo(name="_map_tag", kind=SymbolKind.METHOD, scope="CtagsProvider",
                           line_start=85, signature="(self, tag: dict)"),
            ],
            inheritance=[
                InheritanceInfo(class_name="CtagsProvider", bases=["AnalysisProvider"]),
            ],
            imports=[
                ImportInfo(module="src.ast.models", names=["StructuralAnalysis", "SymbolInfo", "SymbolKind"]),
                ImportInfo(module="src.ast.provider", names=["AnalysisProvider"]),
            ],
            provider_used="ctags",
        ),
    }


class TestFileStoreSnapshot:
    """Test snapshot creation and file output."""

    def test_write_snapshot_creates_directory_structure(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234def5678",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        snapshot_path = Path(path)
        assert snapshot_path.exists()
        assert (snapshot_path / "_meta.yaml").exists()
        assert (snapshot_path / "_index.txt").exists()
        assert (snapshot_path / "_inheritance.txt").exists()
        assert (snapshot_path / "_imports.txt").exists()
        assert (snapshot_path / "_patterns.txt").exists()
        assert (snapshot_path / "_stats.txt").exists()

    def test_write_snapshot_creates_struct_files(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        snapshot_path = Path(path)
        assert (snapshot_path / "src" / "api.py.struct").exists()
        assert (snapshot_path / "src" / "ast" / "provider.py.struct").exists()
        assert (snapshot_path / "src" / "ast" / "ctags_provider.py.struct").exists()

    def test_snapshot_uses_short_sha(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234def5678",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        assert "abc1234" in path
        assert "def5678" not in path


class TestIndexFile:
    """Test _index.txt format and content."""

    def test_index_is_tab_separated(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        index_content = (Path(path) / "_index.txt").read_text()
        # Skip header, check data lines are tab-separated with 7 fields
        for line in index_content.splitlines():
            if line.startswith("#"):
                continue
            parts = line.split("\t")
            assert len(parts) == 7, f"Expected 7 tab-separated fields, got {len(parts)}: {line}"

    def test_index_contains_all_symbols(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        index_content = (Path(path) / "_index.txt").read_text()
        total_symbols = sum(len(a.symbols) for a in sample_analyses.values())
        data_lines = [l for l in index_content.splitlines() if not l.startswith("#") and l.strip()]
        assert len(data_lines) == total_symbols

    def test_index_grepable_for_class(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        index_content = (Path(path) / "_index.txt").read_text()
        class_lines = [l for l in index_content.splitlines() if "\tclass\t" in l]
        assert len(class_lines) == 3  # AnalysisProvider, ProviderRegistry, CtagsProvider

    def test_index_grepable_for_async(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        index_content = (Path(path) / "_index.txt").read_text()
        async_lines = [l for l in index_content.splitlines() if "async" in l]
        assert len(async_lines) >= 1  # health_check is async

    def test_index_grepable_for_extends(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        index_content = (Path(path) / "_index.txt").read_text()
        extends_lines = [l for l in index_content.splitlines() if "extends:" in l]
        assert len(extends_lines) >= 1  # CtagsProvider extends AnalysisProvider


class TestInheritanceFile:
    """Test _inheritance.txt format and content."""

    def test_inheritance_contains_relationships(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        inh_content = (Path(path) / "_inheritance.txt").read_text()
        assert "CtagsProvider\textends\tAnalysisProvider" in inh_content
        assert "AnalysisProvider\textends\tABC" in inh_content

    def test_inheritance_is_grepable(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        inh_content = (Path(path) / "_inheritance.txt").read_text()
        # "What extends AnalysisProvider?"
        matches = [l for l in inh_content.splitlines() if "\tAnalysisProvider" in l and not l.startswith("#")]
        assert len(matches) >= 1


class TestImportsFile:
    """Test _imports.txt format and content."""

    def test_imports_contains_entries(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        imp_content = (Path(path) / "_imports.txt").read_text()
        data_lines = [l for l in imp_content.splitlines() if not l.startswith("#") and l.strip()]
        total_imports = sum(len(a.imports) for a in sample_analyses.values())
        assert len(data_lines) == total_imports

    def test_imports_grepable_for_module(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        imp_content = (Path(path) / "_imports.txt").read_text()
        fastapi_lines = [l for l in imp_content.splitlines() if "fastapi" in l]
        assert len(fastapi_lines) >= 1


class TestStructFile:
    """Test per-file .struct format."""

    def test_struct_contains_file_metadata(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        struct_content = (Path(path) / "src" / "api.py.struct").read_text()
        assert "File: src/api.py" in struct_content
        assert "Language: Python" in struct_content
        assert "Provider: ctags" in struct_content

    def test_struct_contains_symbols(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        struct_content = (Path(path) / "src" / "ast" / "provider.py.struct").read_text()
        assert "AnalysisProvider" in struct_content
        assert "ProviderRegistry" in struct_content
        assert "analyze_batch" in struct_content

    def test_struct_contains_imports(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        struct_content = (Path(path) / "src" / "ast" / "ctags_provider.py.struct").read_text()
        assert "Imports:" in struct_content
        assert "src.ast.models" in struct_content

    def test_struct_contains_inheritance(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        struct_content = (Path(path) / "src" / "ast" / "ctags_provider.py.struct").read_text()
        assert "Inheritance:" in struct_content
        assert "CtagsProvider" in struct_content
        assert "AnalysisProvider" in struct_content


class TestStatsFile:
    """Test _stats.txt content."""

    def test_stats_contains_counts(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        stats_content = (Path(path) / "_stats.txt").read_text()
        assert "Repository: test-repo" in stats_content
        assert "Files: 3" in stats_content
        assert "By Kind:" in stats_content
        assert "By Language:" in stats_content


class TestLatestPointer:
    """Test latest symlink/pointer management."""

    def test_latest_txt_updated(self, tmp_store, sample_analyses):
        path = tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        latest_file = Path(tmp_store.base_path) / "test-repo" / "latest.txt"
        assert latest_file.exists()
        assert latest_file.read_text().strip() == "abc1234"

    def test_get_latest_path(self, tmp_store, sample_analyses):
        tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        latest = tmp_store.get_latest_path("test-repo")
        assert latest is not None
        assert "abc1234" in latest

    def test_latest_updates_on_new_snapshot(self, tmp_store, sample_analyses):
        tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="def5678",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        latest_file = Path(tmp_store.base_path) / "test-repo" / "latest.txt"
        assert latest_file.read_text().strip() == "def5678"


class TestSnapshotPruning:
    """Test snapshot pruning."""

    def test_prune_keeps_max_snapshots(self, tmp_store, sample_analyses):
        tmp_store.max_snapshots = 2
        for i in range(4):
            tmp_store.write_snapshot(
                repo_name="test-repo",
                commit_sha=f"sha{i:04d}00",
                branch="main",
                provider="ctags",
                analyses=sample_analyses,
                project_root=".",
            )
        snapshots = tmp_store.list_snapshots("test-repo")
        assert len(snapshots) <= 2


class TestListSnapshots:
    """Test snapshot listing."""

    def test_list_snapshots_returns_metadata(self, tmp_store, sample_analyses):
        tmp_store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc1234",
            branch="main",
            provider="ctags",
            analyses=sample_analyses,
            project_root=".",
        )
        snapshots = tmp_store.list_snapshots("test-repo")
        assert len(snapshots) == 1
        assert snapshots[0]["repo"] == "test-repo"
        assert snapshots[0]["provider"] == "ctags"

    def test_list_snapshots_empty_repo(self, tmp_store):
        snapshots = tmp_store.list_snapshots("nonexistent")
        assert snapshots == []


class TestGetGitInfo:
    """Test git metadata extraction."""

    def test_get_git_info_returns_dict(self):
        info = get_git_info(".")
        assert "repo_name" in info
        assert "commit_sha" in info
        assert "branch" in info

    def test_get_git_info_has_commit_sha(self):
        info = get_git_info(".")
        # We're in a git repo so this should have a value
        assert len(info["commit_sha"]) >= 7


class TestPatternDetection:
    """Test design pattern detection."""

    def test_detects_factory_pattern(self, tmp_store):
        analyses = {
            "src/factory.py": StructuralAnalysis(
                file_path="src/factory.py",
                language="Python",
                symbols=[
                    SymbolInfo(name="HandlerFactory", kind=SymbolKind.CLASS, line_start=1),
                    SymbolInfo(name="create_handler", kind=SymbolKind.METHOD, scope="HandlerFactory", line_start=5),
                    SymbolInfo(name="create_processor", kind=SymbolKind.METHOD, scope="HandlerFactory", line_start=15),
                ],
                provider_used="ctags",
            ),
        }
        patterns = tmp_store._detect_patterns(analyses)
        pattern_types = [p["pattern"] for p in patterns]
        assert "factory" in pattern_types

    def test_detects_observer_pattern(self, tmp_store):
        analyses = {
            "src/events.py": StructuralAnalysis(
                file_path="src/events.py",
                language="Python",
                symbols=[
                    SymbolInfo(name="EventBus", kind=SymbolKind.CLASS, line_start=1),
                    SymbolInfo(name="subscribe", kind=SymbolKind.METHOD, scope="EventBus", line_start=5),
                    SymbolInfo(name="notify", kind=SymbolKind.METHOD, scope="EventBus", line_start=15),
                    SymbolInfo(name="emit", kind=SymbolKind.METHOD, scope="EventBus", line_start=25),
                ],
                provider_used="ctags",
            ),
        }
        patterns = tmp_store._detect_patterns(analyses)
        pattern_types = [p["pattern"] for p in patterns]
        assert "observer" in pattern_types
