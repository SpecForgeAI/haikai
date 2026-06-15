"""Real integration tests for structural CLI commands.

These tests use actual ctags (no mocks) against real fixture files.
Requires universal-ctags to be installed.
"""
import json
import shutil
import time
from pathlib import Path

import pytest
import yaml
from click.testing import CliRunner

from src.cli import cli


# Skip entire module if ctags not available
pytestmark = pytest.mark.skipif(
    shutil.which("ctags") is None,
    reason="universal-ctags not installed"
)


@pytest.fixture
def project_dir(tmp_path):
    """Create a realistic multi-language fixture project."""
    # Python FastAPI app
    py_dir = tmp_path / "src"
    py_dir.mkdir()
    (py_dir / "main.py").write_text(
        'from fastapi import FastAPI\n'
        'import requests\n'
        'import redis\n'
        '\n'
        'app = FastAPI()\n'
        '\n'
        'class OrderService:\n'
        '    def get_order(self, order_id: int):\n'
        '        return {"id": order_id}\n'
        '\n'
        '    def create_order(self, data: dict):\n'
        '        return {"status": "created"}\n'
        '\n'
        'class UserClient:\n'
        '    def fetch_user(self, user_id):\n'
        '        return requests.get(f"/api/users/{user_id}")\n'
        '\n'
        'class CacheManager:\n'
        '    def __init__(self):\n'
        '        self.client = redis.Redis()\n'
        '\n'
        '    def get_cached(self, key):\n'
        '        return self.client.get(key)\n'
        '\n'
        '    def set_cached(self, key, value):\n'
        '        return self.client.set(key, value)\n'
    )
    (py_dir / "models.py").write_text(
        'from dataclasses import dataclass\n'
        '\n'
        '@dataclass\n'
        'class Order:\n'
        '    id: int\n'
        '    product: str\n'
        '    quantity: int\n'
        '\n'
        '@dataclass\n'
        'class User:\n'
        '    id: int\n'
        '    name: str\n'
        '    email: str\n'
    )

    # Java Spring-like file
    java_dir = tmp_path / "src" / "main" / "java"
    java_dir.mkdir(parents=True)
    (java_dir / "OrderController.java").write_text(
        'package com.example.orders;\n'
        '\n'
        'import org.springframework.web.bind.annotation.GetMapping;\n'
        'import org.springframework.web.bind.annotation.PostMapping;\n'
        'import org.springframework.web.bind.annotation.RestController;\n'
        '\n'
        '@RestController\n'
        'public class OrderController {\n'
        '\n'
        '    @GetMapping("/api/orders")\n'
        '    public List<Order> listOrders() {\n'
        '        return orderService.findAll();\n'
        '    }\n'
        '\n'
        '    @PostMapping("/api/orders")\n'
        '    public Order createOrder(Order order) {\n'
        '        return orderService.save(order);\n'
        '    }\n'
        '}\n'
    )
    (java_dir / "OrderRepository.java").write_text(
        'package com.example.orders;\n'
        '\n'
        'import org.springframework.data.jpa.repository.JpaRepository;\n'
        '\n'
        'public interface OrderRepository extends JpaRepository<Order, Long> {\n'
        '    List<Order> findByStatus(String status);\n'
        '}\n'
    )

    # TypeScript Express-like file
    ts_dir = tmp_path / "frontend"
    ts_dir.mkdir()
    (ts_dir / "api.ts").write_text(
        'import express from "express";\n'
        'import axios from "axios";\n'
        '\n'
        'const router = express.Router();\n'
        '\n'
        'interface OrderDTO {\n'
        '  id: number;\n'
        '  product: string;\n'
        '}\n'
        '\n'
        'class OrderApiClient {\n'
        '  async fetchOrders(): Promise<OrderDTO[]> {\n'
        '    const res = await axios.get("/api/orders");\n'
        '    return res.data;\n'
        '  }\n'
        '}\n'
        '\n'
        'export { router, OrderApiClient };\n'
    )

    # Initialize as git repo for git info detection
    import subprocess
    subprocess.run(["git", "init"], cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "add", "."], cwd=str(tmp_path), capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "initial", "--allow-empty"],
        cwd=str(tmp_path), capture_output=True,
        env={**dict(__import__('os').environ), "GIT_AUTHOR_NAME": "test", "GIT_AUTHOR_EMAIL": "test@test.com",
             "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@test.com"}
    )

    return tmp_path


class TestFullPipelineIntegration:
    """End-to-end: analyze → list-stores → extract-endpoints."""

    def test_analyze_creates_snapshot(self, project_dir):
        runner = CliRunner()
        result = runner.invoke(cli, [
            "analyze", "--project-dir", str(project_dir), "--no-treesitter"
        ])
        assert result.exit_code == 0, f"analyze failed: {result.output}"
        assert "Symbols:" in result.output
        assert "Files discovered:" in result.output

        # Verify snapshot directory created
        store = project_dir / ".specforge" / "structural"
        assert store.exists()
        # Find the repo dir (auto-detected name)
        repo_dirs = [d for d in store.iterdir() if d.is_dir()]
        assert len(repo_dirs) >= 1

    def test_list_stores_shows_snapshot(self, project_dir):
        runner = CliRunner()
        # First analyze
        runner.invoke(cli, [
            "analyze", "--project-dir", str(project_dir), "--no-treesitter"
        ])
        # Then list
        result = runner.invoke(cli, [
            "list-stores", "--project-dir", str(project_dir)
        ])
        assert result.exit_code == 0, f"list-stores failed: {result.output}"
        assert "files" in result.output
        assert "(latest)" in result.output

    def test_extract_from_real_snapshot(self, project_dir):
        runner = CliRunner()
        # Analyze first
        analyze_result = runner.invoke(cli, [
            "analyze", "--project-dir", str(project_dir), "--no-treesitter"
        ])
        assert analyze_result.exit_code == 0

        # Find snapshot path from output (last non-empty line)
        lines = [l.strip() for l in analyze_result.output.strip().split("\n") if l.strip()]
        snapshot_path = lines[-1]
        assert Path(snapshot_path).exists(), f"Snapshot not found: {snapshot_path}"

        # Extract endpoints
        result = runner.invoke(cli, [
            "extract-endpoints", "--store-path", snapshot_path
        ])
        assert result.exit_code == 0, f"extract-endpoints failed: {result.output}"
        assert (Path(snapshot_path) / "_extraction_meta.yaml").exists()

    def test_extract_json_format(self, project_dir):
        runner = CliRunner()
        analyze_result = runner.invoke(cli, [
            "analyze", "--project-dir", str(project_dir), "--no-treesitter"
        ])
        lines = [l.strip() for l in analyze_result.output.strip().split("\n") if l.strip()]
        snapshot_path = lines[-1]

        result = runner.invoke(cli, [
            "extract-endpoints", "--store-path", snapshot_path, "--format", "json"
        ])
        assert result.exit_code == 0

    def test_extraction_meta_has_correct_structure(self, project_dir):
        """extract-endpoints writes _extraction_meta.yaml with the
        documented schema. The `--no-llm` flag was removed in d0227fe
        (extract-endpoints is now always pattern-only), so we drop it
        from the invocation; `classification` is still hard-coded to
        "yaml_only" in cli.py."""
        runner = CliRunner()
        analyze_result = runner.invoke(cli, [
            "analyze", "--project-dir", str(project_dir), "--no-treesitter"
        ])
        lines = [l.strip() for l in analyze_result.output.strip().split("\n") if l.strip()]
        snapshot_path = lines[-1]

        runner.invoke(cli, [
            "extract-endpoints", "--store-path", snapshot_path,
        ])

        meta_file = Path(snapshot_path) / "_extraction_meta.yaml"
        assert meta_file.exists()
        meta = yaml.safe_load(meta_file.read_text())
        assert "extraction" in meta
        assert "timestamp" in meta["extraction"]
        assert "stats" in meta["extraction"]
        assert "endpoints_found" in meta["extraction"]["stats"]
        assert "interactions_found" in meta["extraction"]["stats"]
        assert meta["extraction"]["classification"] == "yaml_only"

    def test_snapshot_has_all_index_files(self, project_dir):
        runner = CliRunner()
        analyze_result = runner.invoke(cli, [
            "analyze", "--project-dir", str(project_dir), "--no-treesitter"
        ])
        lines = [l.strip() for l in analyze_result.output.strip().split("\n") if l.strip()]
        snapshot_path = Path(lines[-1])

        expected_files = ["_index.txt", "_inheritance.txt", "_imports.txt",
                          "_meta.yaml", "_stats.txt", "_patterns.txt"]
        for f in expected_files:
            assert (snapshot_path / f).exists(), f"Missing {f} in snapshot"

    def test_meta_yaml_has_correct_fields(self, project_dir):
        runner = CliRunner()
        analyze_result = runner.invoke(cli, [
            "analyze", "--project-dir", str(project_dir), "--no-treesitter"
        ])
        lines = [l.strip() for l in analyze_result.output.strip().split("\n") if l.strip()]
        snapshot_path = Path(lines[-1])

        meta = yaml.safe_load((snapshot_path / "_meta.yaml").read_text())
        assert "repo" in meta
        assert "commit" in meta
        assert "branch" in meta
        assert "analyzed_at" in meta
        assert "file_count" in meta
        assert meta["file_count"] == 5  # 2 py + 2 java + 1 ts

    def test_index_contains_expected_symbols(self, project_dir):
        runner = CliRunner()
        analyze_result = runner.invoke(cli, [
            "analyze", "--project-dir", str(project_dir), "--no-treesitter"
        ])
        lines = [l.strip() for l in analyze_result.output.strip().split("\n") if l.strip()]
        snapshot_path = Path(lines[-1])

        index = (snapshot_path / "_index.txt").read_text()
        # Should find our classes
        assert "OrderService" in index
        assert "OrderController" in index
        assert "OrderApiClient" in index
        assert "CacheManager" in index
        # Should find methods
        assert "get_order" in index
        assert "create_order" in index
        assert "listOrders" in index

    def test_inheritance_detects_relationships(self, project_dir):
        runner = CliRunner()
        analyze_result = runner.invoke(cli, [
            "analyze", "--project-dir", str(project_dir), "--no-treesitter"
        ])
        lines = [l.strip() for l in analyze_result.output.strip().split("\n") if l.strip()]
        snapshot_path = Path(lines[-1])

        inheritance = (snapshot_path / "_inheritance.txt").read_text()
        # Java interface extends JpaRepository
        assert "JpaRepository" in inheritance

    def test_custom_store_dir(self, project_dir):
        custom_store = project_dir / "my-output"
        runner = CliRunner()
        result = runner.invoke(cli, [
            "analyze", "--project-dir", str(project_dir),
            "--store-dir", str(custom_store), "--no-treesitter"
        ])
        assert result.exit_code == 0
        assert custom_store.exists()

    def test_custom_repo_name(self, project_dir):
        runner = CliRunner()
        result = runner.invoke(cli, [
            "analyze", "--project-dir", str(project_dir),
            "--repo-name", "my-custom-name", "--no-treesitter"
        ])
        assert result.exit_code == 0
        store = project_dir / ".specforge" / "structural" / "my-custom-name"
        assert store.exists()

    def test_endpoints_only_flag(self, project_dir):
        runner = CliRunner()
        analyze_result = runner.invoke(cli, [
            "analyze", "--project-dir", str(project_dir), "--no-treesitter"
        ])
        lines = [l.strip() for l in analyze_result.output.strip().split("\n") if l.strip()]
        snapshot_path = Path(lines[-1])

        # Remove any files left by analyze so we can verify extract-endpoints behavior
        for f in ["_endpoints.txt", "_interactions.txt"]:
            p = Path(snapshot_path) / f
            if p.exists():
                p.unlink()

        result = runner.invoke(cli, [
            "extract-endpoints", "--store-path", str(snapshot_path), "--endpoints-only"
        ])
        assert result.exit_code == 0
        # --endpoints-only should not create _interactions.txt
        assert not (Path(snapshot_path) / "_interactions.txt").exists()

    def test_interactions_only_flag(self, project_dir):
        runner = CliRunner()
        analyze_result = runner.invoke(cli, [
            "analyze", "--project-dir", str(project_dir), "--no-treesitter"
        ])
        lines = [l.strip() for l in analyze_result.output.strip().split("\n") if l.strip()]
        snapshot_path = Path(lines[-1])

        # Remove any files left by analyze so we can verify extract-endpoints behavior
        for f in ["_endpoints.txt", "_interactions.txt"]:
            p = Path(snapshot_path) / f
            if p.exists():
                p.unlink()

        result = runner.invoke(cli, [
            "extract-endpoints", "--store-path", str(snapshot_path), "--interactions-only"
        ])
        assert result.exit_code == 0
        # --interactions-only should not create _endpoints.txt
        assert not (Path(snapshot_path) / "_endpoints.txt").exists()


class TestPerformanceIntegration:
    """Performance tests with real ctags."""

    def test_analyze_five_files_under_10s(self, project_dir):
        runner = CliRunner()
        start = time.time()
        result = runner.invoke(cli, [
            "analyze", "--project-dir", str(project_dir), "--no-treesitter"
        ])
        elapsed = time.time() - start
        assert result.exit_code == 0
        assert elapsed < 10.0, f"Analysis took {elapsed:.2f}s"

    def test_extract_under_5s(self, project_dir):
        runner = CliRunner()
        analyze_result = runner.invoke(cli, [
            "analyze", "--project-dir", str(project_dir), "--no-treesitter"
        ])
        lines = [l.strip() for l in analyze_result.output.strip().split("\n") if l.strip()]
        snapshot_path = lines[-1]

        start = time.time()
        result = runner.invoke(cli, [
            "extract-endpoints", "--store-path", snapshot_path
        ])
        elapsed = time.time() - start
        assert result.exit_code == 0
        assert elapsed < 5.0, f"Extraction took {elapsed:.2f}s"
