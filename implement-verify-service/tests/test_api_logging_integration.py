"""Integration tests for API logging functionality."""
import logging
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def test_workspace():
    """Create a temporary workspace for testing.

    Uses `mkdtemp` + manual cleanup with `ignore_errors=True` so the
    Windows FD held by the API's logging.FileHandler doesn't crash
    teardown. (`tempfile.TemporaryDirectory()` raises PermissionError
    on Windows when the dir still has an open file handle inside it.)"""
    temp_dir = Path(tempfile.mkdtemp())
    workspace = temp_dir / "test_workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    yield workspace
    shutil.rmtree(temp_dir, ignore_errors=True)


def _close_root_handlers():
    """Detach + close every handler on the root logger.

    The API attaches a FileHandler to the root logger at import time;
    leaving it open keeps the per-test workspace's log file locked on
    Windows. Closing here lets the workspace teardown succeed."""
    root = logging.getLogger()
    for h in list(root.handlers):
        try:
            h.close()
        except Exception:
            pass
        root.removeHandler(h)


@pytest.fixture
def test_client(test_workspace, monkeypatch):
    """Create a test client with a temporary workspace.

    Snapshot/restore `sys.modules` for `src.api*` so other test files
    that did `from src.api import app` at collection time keep a valid
    reference. Without the restore, the next test that uses `app` runs
    against a stale module whose patches no longer hit (this caused 18
    cross-file failures in full-suite runs)."""
    # Set environment variables for testing BEFORE importing the module
    monkeypatch.setenv('API_WORKSPACE_DIR', str(test_workspace))
    monkeypatch.setenv('STANDARDS_API_KEY', 'test-key')
    monkeypatch.setenv('OPENAI_API_KEY', 'test-openai-key')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('LLM_MODEL', 'gpt-4')

    # Snapshot existing src.api* modules so we can restore them.
    api_mod_names = [m for m in list(sys.modules) if m.startswith('src.api')]
    saved_modules = {name: sys.modules[name] for name in api_mod_names}

    _close_root_handlers()
    for name in api_mod_names:
        del sys.modules[name]

    from src.api import app

    client = TestClient(app)
    yield client

    # Tear down: close handlers (release log file FD on Windows) and
    # restore the originally-imported src.api* modules so subsequent
    # tests' top-level `from src.api import app` references remain valid.
    _close_root_handlers()
    for name in [m for m in list(sys.modules) if m.startswith('src.api')]:
        del sys.modules[name]
    sys.modules.update(saved_modules)


class TestAPILoggingIntegration:
    """Integration tests for API logging."""
    
    def test_log_directory_created_on_startup(self, test_workspace, test_client):
        """Test that log directory is created when API starts."""
        log_dir = test_workspace / "logs"
        
        # Make a simple request to ensure API is initialized
        response = test_client.get("/health")
        assert response.status_code == 200
        
        # Check that log directory was created
        assert log_dir.exists()
        assert log_dir.is_dir()
    
    def test_log_file_created_on_startup(self, test_workspace, test_client):
        """Test that log file is created when API starts."""
        log_dir = test_workspace / "logs"
        
        # Make a simple request to ensure API is initialized
        response = test_client.get("/health")
        assert response.status_code == 200
        
        # Check that at least one log file was created
        log_files = list(log_dir.glob("api_*.log"))
        assert len(log_files) > 0
        
        # Check that log file follows naming convention
        log_file = log_files[0]
        assert log_file.name.startswith("api_")
        assert log_file.name.endswith(".log")
    
    def test_log_file_contains_startup_messages(self, test_workspace, test_client):
        """Test that log file contains startup messages."""
        log_dir = test_workspace / "logs"
        
        # Make a simple request to ensure API is initialized
        response = test_client.get("/health")
        assert response.status_code == 200
        
        # Read the log file
        log_files = list(log_dir.glob("api_*.log"))
        assert len(log_files) > 0
        
        log_content = log_files[0].read_text()
        
        # Check for startup messages
        assert "Standards Extractor API starting" in log_content
        assert "API Workspace Directory:" in log_content
        assert "Log Directory:" in log_content
        assert "Log File:" in log_content
    
    def test_api_request_logged(self, test_workspace, test_client):
        """Test that API requests are logged."""
        log_dir = test_workspace / "logs"
        
        # Make a request to the product standards endpoint
        response = test_client.post(
            "/api/v1/standards/product/generate",
            json={"company": "test-co", "project": "test-proj", "recursive": True},
            headers={"Authorization": "Bearer test-key"}
        )
        
        # Read the log file
        log_files = list(log_dir.glob("api_*.log"))
        assert len(log_files) > 0
        
        log_content = log_files[0].read_text()
        
        # Check that request was logged
        assert "API Request: generate_product_standards" in log_content
        assert "company=test-co" in log_content
        assert "project=test-proj" in log_content
        assert "recursive=True" in log_content
    
    def test_operation_execution_logged(self, test_workspace, test_client):
        """Test that operation execution is logged."""
        log_dir = test_workspace / "logs"
        
        # Make a request to the product standards endpoint
        response = test_client.post(
            "/api/v1/standards/product/generate",
            json={"company": "test-co", "project": "test-proj", "recursive": True},
            headers={"Authorization": "Bearer test-key"}
        )
        
        # Read the log file
        log_files = list(log_dir.glob("api_*.log"))
        assert len(log_files) > 0
        
        log_content = log_files[0].read_text()
        
        # Check that operation execution was logged
        assert "OperationExecutor initialized" in log_content
        assert "Executing request: GenerateProductStandardsRequest" in log_content
        assert "Generating product standards" in log_content
        assert "Project directory:" in log_content
        assert "Global directory:" in log_content
    
    def test_api_response_logged(self, test_workspace, test_client):
        """Test that API responses are logged."""
        log_dir = test_workspace / "logs"
        
        # Make a request to the product standards endpoint
        response = test_client.post(
            "/api/v1/standards/product/generate",
            json={"company": "test-co", "project": "test-proj", "recursive": True},
            headers={"Authorization": "Bearer test-key"}
        )
        
        # Read the log file
        log_files = list(log_dir.glob("api_*.log"))
        assert len(log_files) > 0
        
        log_content = log_files[0].read_text()
        
        # Check that response was logged
        assert "API Response: generate_product_standards" in log_content
        assert "success=" in log_content
        assert "outputs=" in log_content
    
    def test_workspace_path_used_correctly(self, test_workspace, test_client):
        """Test that the configured workspace path is used.

        Drift: the M4 fix (`debug/260504-1448-mega-standards-audit`)
        made `output_dir` workspace-RELATIVE in API responses to avoid
        leaking the absolute server path. Verify the relative form
        (`test-co/test-proj`) AND that the absolute workspace path
        still appears in the on-disk log file (operator-facing)."""
        log_dir = test_workspace / "logs"

        response = test_client.post(
            "/api/v1/standards/product/generate",
            json={"company": "test-co", "project": "test-proj", "recursive": True},
            headers={"Authorization": "Bearer test-key"}
        )

        assert response.status_code == 200
        response_data = response.json()

        # Workspace-relative form (M4): no leading absolute path.
        assert response_data['output_dir'] == "test-co/test-proj"

        # The log file (operator-only) DOES still contain the absolute path.
        log_files = list(log_dir.glob("api_*.log"))
        assert len(log_files) > 0

        log_content = log_files[0].read_text()
        assert str(test_workspace) in log_content
    
    def test_log_file_readable_and_well_formatted(self, test_workspace, test_client):
        """Test that log file is readable and well-formatted."""
        log_dir = test_workspace / "logs"
        
        # Make a request
        response = test_client.get("/health")
        assert response.status_code == 200
        
        # Read the log file
        log_files = list(log_dir.glob("api_*.log"))
        assert len(log_files) > 0
        
        log_content = log_files[0].read_text()
        lines = log_content.strip().split('\n')
        
        # Check that each line has the expected format
        for line in lines:
            if line.strip():  # Skip empty lines
                # Each log line should have timestamp, logger name, level, and message
                # Format: YYYY-MM-DD HH:MM:SS,mmm - logger.name - LEVEL - message
                parts = line.split(' - ')
                assert len(parts) >= 3, f"Log line not properly formatted: {line}"
                
                # Check timestamp format (basic check)
                timestamp_part = parts[0]
                assert ',' in timestamp_part  # Should have milliseconds
                
                # Check that level is present
                assert any(level in line for level in ['INFO', 'WARNING', 'ERROR', 'DEBUG'])


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
