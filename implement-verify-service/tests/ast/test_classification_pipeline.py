"""Integration test: classification pipeline end-to-end.

Runs the full pipeline on this repo. Classification always runs —
YAML fast path with no LLM client (no API key needed for tests).
"""
import tempfile
import pytest
import yaml
from pathlib import Path

from src.ast.ctags_provider import CtagsProvider
from src.ast.store import FileStore
from src.ast.provider import ProviderRegistry
from src.ast.pipeline import run_structural_pipeline
# endpoint_config removed — YAML pattern loading no longer used
# Detection is now LLM-driven via agentic discovery

pytestmark = pytest.mark.skipif(
    not CtagsProvider().is_available(),
    reason="ctags not installed",
)


@pytest.fixture(scope="module")
def pipeline_result():
    """Run full pipeline on src/ — classification runs automatically."""
    py_files = [str(f) for f in Path("src").rglob("*.py")
                if f.name != "__init__.py"]

    ctags = CtagsProvider()
    ctags_results = ctags.analyze_batch(py_files)

    with tempfile.TemporaryDirectory() as tmp:
        store = FileStore(
            base_path=str(Path(tmp) / "structural"),
            config={"diagrams": {"auto_generate": False}},
        )
        registry = ProviderRegistry()

        analyses = run_structural_pipeline(
            file_paths=py_files,
            ctags_results=ctags_results,
            store=store,
            registry=registry,
            repo_name="test",
            commit_sha="abc1234",
            branch="main",
            project_root=".",
            llm_client=None,  # YAML-only, no LLM cost
        )

        snapshot_path = store.get_latest_path("test")
        yield snapshot_path, analyses


class TestClassificationPipelineIntegration:
    def test_interactions_file_produced(self, pipeline_result):
        snapshot_path, _ = pipeline_result
        assert (Path(snapshot_path) / "_interactions.txt").exists()

    def test_interactions_have_provenance(self, pipeline_result):
        snapshot_path, _ = pipeline_result
        content = (Path(snapshot_path) / "_interactions.txt").read_text()
        assert "classified_by" in content
        # Without LLM, interactions come from YAML classification only.
        # With agentic discovery (no AST detection), YAML may find nothing.
        # Just verify the file format is correct.

    def test_interactions_data_format(self, pipeline_result):
        """With no LLM client, interactions may be empty (discovery is LLM-driven)."""
        snapshot_path, _ = pipeline_result
        content = (Path(snapshot_path) / "_interactions.txt").read_text()
        # Header should always be present
        assert "classified_by" in content or "type" in content

    def test_classification_meta_produced(self, pipeline_result):
        snapshot_path, _ = pipeline_result
        assert (Path(snapshot_path) / "_classification_meta.yaml").exists()

    def test_classification_meta_content(self, pipeline_result):
        snapshot_path, _ = pipeline_result
        content = (Path(snapshot_path) / "_classification_meta.yaml").read_text()
        meta = yaml.safe_load(content)
        stats = meta["classification"]["stats"]
        # Without LLM, no discovery happens — interactions come from agentic discovery
        assert stats["llm_classified"] == 0
        assert isinstance(stats["total_interactions"], int)

    def test_endpoints_still_produced(self, pipeline_result):
        snapshot_path, _ = pipeline_result
        assert (Path(snapshot_path) / "_endpoints.txt").exists()

    def test_existing_store_files_intact(self, pipeline_result):
        snapshot_path, _ = pipeline_result
        for f in ["_index.txt", "_calls.txt", "_imports.txt", "_meta.yaml"]:
            assert (Path(snapshot_path) / f).exists(), f"{f} missing"

    def test_no_llm_means_yaml_only(self, pipeline_result):
        """Without LLM client, only YAML classification runs — no LLM cost."""
        snapshot_path, _ = pipeline_result
        content = (Path(snapshot_path) / "_classification_meta.yaml").read_text()
        meta = yaml.safe_load(content)
        assert meta["classification"]["stats"]["llm_classified"] == 0
