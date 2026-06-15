"""Tests for structural analysis API endpoints."""
import json
import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def set_api_key():
    """Set API key for the test, restore prior value on teardown.
    Pop-on-teardown leaks across test files (see
    fix/260504-1127-full-repo-green)."""
    prior = os.environ.get("STANDARDS_API_KEY")
    os.environ["STANDARDS_API_KEY"] = "test-key"
    try:
        yield
    finally:
        if prior is None:
            os.environ.pop("STANDARDS_API_KEY", None)
        else:
            os.environ["STANDARDS_API_KEY"] = prior


@pytest.fixture
def client():
    """FastAPI test client."""
    from src.api import app
    return TestClient(app)


@pytest.fixture
def auth_headers():
    return {"Authorization": "Bearer test-key"}


@pytest.fixture
def snapshot_with_data(tmp_path):
    """Create a snapshot directory with sample index files."""
    repo_dir = tmp_path / "test-repo"
    snapshot_dir = repo_dir / "abc1234"
    snapshot_dir.mkdir(parents=True)

    # _index.txt
    index = """# file\tkind\tname\tscope\tsignature\tline\tflags
src/api.py\tclass\tUserService\t-\t-\t10\t-
src/api.py\tmethod\tget_user\tUserService\t(self, user_id)\t20\t-
src/api.py\tfunction\tcreate_app\t-\t()\t5\tasync
"""
    (snapshot_dir / "_index.txt").write_text(index, encoding="utf-8")

    # _inheritance.txt
    inh = """# child\trel\tparent\tfile
UserService\textends\tBaseService\tsrc/api.py
"""
    (snapshot_dir / "_inheritance.txt").write_text(inh, encoding="utf-8")

    # _imports.txt
    imp = """# file\timports\tnames
src/api.py\tfastapi\tFastAPI
"""
    (snapshot_dir / "_imports.txt").write_text(imp, encoding="utf-8")

    # _patterns.txt
    pat = """# pattern\tconfidence\tsymbol\tfile\tevidence
factory\t0.8\tServiceFactory\tsrc/factory.py\tcreate methods
"""
    (snapshot_dir / "_patterns.txt").write_text(pat, encoding="utf-8")

    # _stats.txt
    stats = "files: 1\nsymbols: 3\n"
    (snapshot_dir / "_stats.txt").write_text(stats, encoding="utf-8")

    # latest pointer
    (repo_dir / "latest").write_text("abc1234", encoding="utf-8")

    return tmp_path


class TestAnalyzeEndpoint:
    def test_requires_auth(self, client):
        response = client.post("/api/v1/structural/analyze", json={"local_path": "/tmp"})
        assert response.status_code in (401, 403)  # no auth header

    def test_returns_400_for_missing_path(self, client, auth_headers):
        response = client.post(
            "/api/v1/structural/analyze",
            json={"local_path": "/nonexistent/path"},
            headers=auth_headers,
        )
        assert response.status_code == 400


class TestRawEndpoint:
    def test_returns_index_files(self, client, auth_headers, snapshot_with_data):
        with patch.dict(os.environ, {"AST_STORE_PATH": str(snapshot_with_data)}):
            response = client.post(
                "/api/v1/structural/test-repo/raw",
                json={"snapshot": "abc1234", "include": ["index", "inheritance"]},
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert "files" in data
        assert data["files"]["index"] is not None
        assert "UserService" in data["files"]["index"]

    def test_returns_404_for_unknown_repo(self, client, auth_headers, snapshot_with_data):
        with patch.dict(os.environ, {"AST_STORE_PATH": str(snapshot_with_data)}):
            response = client.post(
                "/api/v1/structural/nonexistent/raw",
                json={"snapshot": "latest"},
                headers=auth_headers,
            )
        assert response.status_code == 404


class TestQueryEndpoint:
    def test_query_classes(self, client, auth_headers, snapshot_with_data):
        with patch.dict(os.environ, {"AST_STORE_PATH": str(snapshot_with_data)}):
            response = client.post(
                "/api/v1/structural/test-repo/query",
                json={"question": "What classes exist?", "snapshot": "abc1234"},
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert "answer" in data
        assert "class" in data["answer"].lower() or "1" in data["answer"]
        assert data["method"] == "direct_lookup"

    def test_query_inheritance(self, client, auth_headers, snapshot_with_data):
        with patch.dict(os.environ, {"AST_STORE_PATH": str(snapshot_with_data)}):
            response = client.post(
                "/api/v1/structural/test-repo/query",
                json={"question": "Show inheritance hierarchy", "snapshot": "abc1234"},
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert len(data["evidence"]) >= 1


class TestMetamodelPopulateEndpoint:
    def test_populates_metamodel(self, client, auth_headers, snapshot_with_data):
        with patch.dict(os.environ, {"AST_STORE_PATH": str(snapshot_with_data)}):
            response = client.post(
                "/api/v1/structural/test-repo/metamodel/populate",
                json={
                    "metamodel": {"version_id": 1},
                    "snapshot": "abc1234",
                },
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert "metamodel" in data
        metamodel = data["metamodel"]
        assert "classes" in metamodel

    def test_version_check_rejects_unknown(self, client, auth_headers, snapshot_with_data):
        with patch.dict(os.environ, {"AST_STORE_PATH": str(snapshot_with_data)}):
            response = client.post(
                "/api/v1/structural/test-repo/metamodel/populate",
                json={
                    "metamodel": {"version_id": 99},
                    "snapshot": "abc1234",
                },
                headers=auth_headers,
            )
        assert response.status_code == 400
        body = response.json()
        detail = body.get("detail", str(body))
        assert "99" in detail


class TestDiagramsGenerateEndpoint:
    def test_generates_mermaid_by_default(self, client, auth_headers, snapshot_with_data):
        with patch.dict(os.environ, {"AST_STORE_PATH": str(snapshot_with_data)}):
            response = client.post(
                "/api/v1/structural/test-repo/diagrams/generate",
                json={"snapshot": "abc1234"},
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert "diagrams" in data
        assert len(data["files_written"]) > 0
        # Should have .mmd files
        assert any(f.endswith(".mmd") for f in data["files_written"])

    def test_generates_multiple_formats(self, client, auth_headers, snapshot_with_data):
        with patch.dict(os.environ, {"AST_STORE_PATH": str(snapshot_with_data)}):
            response = client.post(
                "/api/v1/structural/test-repo/diagrams/generate",
                json={
                    "snapshot": "abc1234",
                    "formats": ["mermaid", "plantuml", "graphviz"],
                },
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        files = data["files_written"]
        assert any(f.endswith(".mmd") for f in files)
        assert any(f.endswith(".puml") for f in files)
        assert any(f.endswith(".dot") for f in files)

    def test_returns_404_for_unknown_snapshot(self, client, auth_headers, snapshot_with_data):
        with patch.dict(os.environ, {"AST_STORE_PATH": str(snapshot_with_data)}):
            response = client.post(
                "/api/v1/structural/test-repo/diagrams/generate",
                json={"snapshot": "nonexistent"},
                headers=auth_headers,
            )
        assert response.status_code == 404
