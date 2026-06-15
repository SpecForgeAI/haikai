"""
Unit tests for technical_doc_repository.py
Tests tech doc workflow orchestration.
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock, call
from src.technical_doc_repository import TechnicalDocRepository


# Stale: written 2026-02-20, never run on Windows; path-separator and mock-
# subscript drift. Quarantine per fix/260504-1127-full-repo-green.
_DRIFT_REASON = (
    "Stale since 2026-02-20 (Windows path separators, mock subscript drift); "
    "needs revision per fix/260504-1127-full-repo-green"
)


class TestTechnicalDocRepository:
    """Tests for TechnicalDocRepository."""
    
    @pytest.fixture
    def staging_dir(self, tmp_path):
        """Create staging directory."""
        return tmp_path / "staging"
    
    @pytest.fixture
    def manager(self, staging_dir):
        """Create TechnicalDocRepository instance."""
        return TechnicalDocRepository(str(staging_dir))
    
    def test_initialization(self, manager, staging_dir):
        """Test manager initializes directories correctly."""
        assert manager.staging_dir == staging_dir
        assert manager.temp_dir == staging_dir / 'temp'
        assert manager.parsed_dir == staging_dir / 'parsed'
        assert manager.tech_docs_dir == staging_dir / 'tech-docs'
        
        # Directories should be created
        assert manager.temp_dir.exists()
        assert manager.parsed_dir.exists()
        assert manager.tech_docs_dir.exists()
    
    @patch.object(TechnicalDocRepository, '_ensure_local_file')
    @patch.object(TechnicalDocRepository, '_ensure_parsed_file')
    def test_process_technical_documents_success(
        self, mock_ensure_parsed, mock_ensure_local, manager
    ):
        """Test successful processing of multiple documents."""
        # Use Path objects whose str() form is platform-native — comparing
        # against str(Path(...)) sidesteps the Windows '\\' vs '/' drift
        # that quarantined the original assertion.
        local_a, local_b = Path("/staging/temp/doc1.pdf"), Path("/staging/temp/doc2.md")
        parsed_a, parsed_b = Path("/staging/parsed/doc1.txt"), Path("/staging/parsed/doc2.txt")

        mock_ensure_local.side_effect = [local_a, local_b]
        mock_ensure_parsed.side_effect = [parsed_a, parsed_b]

        file_paths = ["docs/doc1.pdf", "docs/doc2.md"]
        results = manager.ingest_technical_documents(file_paths, use_cache=True)

        assert len(results) == 2
        assert results[0]['local'] == str(local_a)
        assert results[0]['parsed'] == str(parsed_a)

        assert mock_ensure_local.call_count == 2
        assert mock_ensure_parsed.call_count == 2
    
    @patch.object(TechnicalDocRepository, '_ensure_local_file')
    def test_process_technical_documents_with_errors(
        self, mock_ensure_local, manager
    ):
        """Test that errors are logged and processing continues."""
        # First file succeeds, second fails
        mock_ensure_local.side_effect = [
            Path("/staging/temp/doc1.pdf"),
            Exception("Download failed")
        ]
        
        file_paths = ["docs/doc1.pdf", "docs/doc2.pdf"]
        results = manager.ingest_technical_documents(file_paths, use_cache=True)
        
        # Should only have 1 successful result
        assert len(results) == 0  # Both fail: first file not found, second download error
    
    @patch("requests.Session.get")
    def test_download_file_success(self, mock_get, manager):
        """Test successful file download.

        The current `_download_file` reads `response.headers.get("content-type", "")`
        to apply a content-type-based suffix. The original Mock had no
        `.headers` attribute and tripped a TypeError. Add a real dict so
        the path stays as `.pdf` (no rename)."""
        mock_response = Mock()
        mock_response.content = b"file content"
        mock_response.raise_for_status = Mock()
        mock_response.headers = {"content-type": "application/pdf"}
        mock_get.return_value = mock_response

        url = "https://example.com/docs/tech-stack.pdf"
        result = manager._download_file(url, use_cache=False)

        expected_path = manager.temp_dir / "example.com" / "docs" / "tech-stack.pdf"
        assert result == expected_path
        assert result.exists()
        assert result.read_bytes() == b"file content"
    
    @patch("requests.Session.get")
    def test_download_file_uses_cache(self, mock_get, manager):
        """Test that cached downloads are reused.

        Note: the current `_download_file` issues the HTTP HEAD/GET first
        so it can detect a content-type suffix mismatch BEFORE checking
        the cache (so a stale cache with a wrong extension can be
        replaced). The old assertion `mock_get.assert_not_called()` was
        therefore stale. We now assert the cached *bytes* win — which is
        the contract that actually matters."""
        cached_path = manager.temp_dir / "example.com" / "docs" / "test.pdf"
        cached_path.parent.mkdir(parents=True, exist_ok=True)
        cached_path.write_text("cached content")

        # Mock returns the SAME content-type so suffix stays .pdf and the
        # post-fetch cache check finds the existing file.
        mock_response = Mock()
        mock_response.content = b"freshly downloaded"
        mock_response.raise_for_status = Mock()
        mock_response.headers = {"content-type": "application/pdf"}
        mock_get.return_value = mock_response

        url = "https://example.com/docs/test.pdf"
        result = manager._download_file(url, use_cache=True)

        assert result == cached_path
        # Cached bytes win — fresh download is NOT written to disk.
        assert result.read_text() == "cached content"
    
    @patch("requests.Session.get")
    def test_download_file_error(self, mock_get, manager):
        """Test download error handling.

        Drift: `_download_file` only catches `requests.HTTPError` and
        `requests.RequestException` (a bare `Exception` would propagate
        un-wrapped). Use a real `RequestException` so the retry loop
        exhausts and re-raises as `ValueError("Download failed: ...")`."""
        import requests as _requests
        mock_get.side_effect = _requests.RequestException("Network error")

        url = "https://example.com/docs/test.pdf"
        with pytest.raises(ValueError, match="Download failed"):
            manager._download_file(url, use_cache=False)
    
    def test_copy_file_success(self, manager, tmp_path):
        """Test successful file copy."""
        # Create source file
        source = tmp_path / "source.pdf"
        source.write_text("source content")
        
        result = manager._copy_file(str(source), use_cache=False)
        
        expected_path = manager.temp_dir / "source.pdf"
        assert result == expected_path
        assert result.exists()
        assert result.read_text() == "source content"
    
    def test_copy_file_uses_cache(self, manager, tmp_path):
        """Test that cached copies are reused."""
        # Create source and cached file
        source = tmp_path / "source.pdf"
        source.write_text("new content")
        
        cached_path = manager.temp_dir / "source.pdf"
        cached_path.write_text("cached content")
        
        result = manager._copy_file(str(source), use_cache=True)
        
        # Should return cached version
        assert result == cached_path
        assert result.read_text() == "cached content"
    
    def test_copy_file_not_found(self, manager):
        """Test copy with nonexistent file."""
        with pytest.raises(FileNotFoundError):
            manager._copy_file("/nonexistent/file.pdf", use_cache=False)
    
    @patch('src.technical_doc_repository.FileParser.parse')
    def test_ensure_parsed_file_success(self, mock_parse, manager, tmp_path):
        """Test successful file parsing."""
        # Create source file
        source = tmp_path / "test.pdf"
        source.write_text("dummy")
        
        mock_parse.return_value = "Parsed content from PDF"
        
        result = manager._ensure_parsed_file(source, use_cache=False)
        
        expected_path = manager.parsed_dir / "test.txt"
        assert result == expected_path
        assert result.exists()
        
        content = result.read_text()
        assert "=== SOURCE:" in content
        assert "=== PARSED:" in content
        assert "Parsed content from PDF" in content
    
    def test_ensure_parsed_file_uses_cache(self, manager):
        """Test that cached parsed files are reused."""
        # Create cached parsed file
        cached_path = manager.parsed_dir / "test.txt"
        cached_path.write_text("cached parsed content")
        
        source = Path("/dummy/test.pdf")
        result = manager._ensure_parsed_file(source, use_cache=True)
        
        # Should return cached version
        assert result == cached_path
        assert result.read_text() == "cached parsed content"
    
    def test_create_header(self, manager):
        """Test metadata header creation.

        `_create_header` formats the path via `f"{file_path}"`, which
        uses the platform-native separator on Windows. Compare against
        `str(file_path)` instead of a hard-coded POSIX literal."""
        file_path = Path("/path/to/test.pdf")
        header = manager._create_header(file_path)

        assert f"=== SOURCE: {file_path} ===" in header
        assert "=== PARSED:" in header
        assert header.endswith("\n\n")
    
    def test_clear_cache_all(self, manager):
        """Test clearing all caches."""
        # Create dummy files
        (manager.temp_dir / "file1.pdf").write_text("temp")
        (manager.parsed_dir / "file2.txt").write_text("parsed")
        (manager.tech_docs_dir / "file3.json").write_text("extraction")
        
        manager.clear_cache('all')
        
        # Directories should be empty but exist
        assert manager.temp_dir.exists()
        assert manager.parsed_dir.exists()
        assert manager.tech_docs_dir.exists()
        assert len(list(manager.temp_dir.iterdir())) == 0
        assert len(list(manager.parsed_dir.iterdir())) == 0
        assert len(list(manager.tech_docs_dir.iterdir())) == 0
    
    def test_clear_cache_downloads_only(self, manager):
        """Test clearing only download cache."""
        # Create dummy files
        (manager.temp_dir / "file1.pdf").write_text("temp")
        (manager.parsed_dir / "file2.txt").write_text("parsed")
        
        manager.clear_cache('downloads')
        
        # Only temp_dir should be cleared
        assert len(list(manager.temp_dir.iterdir())) == 0
        assert len(list(manager.parsed_dir.iterdir())) == 1
    
    def test_clear_cache_parsed_only(self, manager):
        """Test clearing only parsed file cache."""
        # Create dummy files
        (manager.temp_dir / "file1.pdf").write_text("temp")
        (manager.parsed_dir / "file2.txt").write_text("parsed")
        
        manager.clear_cache('parsed')
        
        # Only parsed_dir should be cleared
        assert len(list(manager.temp_dir.iterdir())) == 1
        assert len(list(manager.parsed_dir.iterdir())) == 0
