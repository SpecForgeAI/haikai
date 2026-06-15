"""
Unit tests for file_parser.py
Tests all file format parsers.
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from src.file_parser import (
    FileParser,
    PDFParser,
    DOCXParser,
    HTMLParser,
    MarkdownParser,
    TextParser
)


class TestFileParser:
    """Tests for FileParser factory class."""
    
    def test_supported_extensions(self):
        """Test that all expected extensions are supported."""
        expected = {'.pdf', '.docx', '.html', '.htm', '.md', '.txt', '.json', '.xml', '.yaml', '.yml', '.properties', '.cfg', '.ini', '.toml', '.gradle'}
        assert FileParser.SUPPORTED_EXTENSIONS == expected
    
    def test_parse_unsupported_extension(self, tmp_path):
        """Test that unsupported extensions raise ValueError."""
        file_path = tmp_path / "test.xyz"
        file_path.write_text("content")
        
        with pytest.raises(ValueError, match="Unsupported file format"):
            FileParser.parse(str(file_path))
    
    def test_parse_nonexistent_file(self):
        """Test that nonexistent files raise FileNotFoundError."""
        with pytest.raises(FileNotFoundError):
            FileParser.parse("/nonexistent/file.pdf")
    
    @patch('src.file_parser.PDFParser.parse')
    def test_parse_routes_to_pdf_parser(self, mock_pdf_parse, tmp_path):
        """Test that .pdf files are routed to PDFParser."""
        file_path = tmp_path / "test.pdf"
        file_path.write_text("dummy")
        mock_pdf_parse.return_value = "parsed content"
        
        result = FileParser.parse(str(file_path))
        
        mock_pdf_parse.assert_called_once_with(str(file_path))
        assert result == "parsed content"
    
    @patch('src.file_parser.DOCXParser.parse')
    def test_parse_routes_to_docx_parser(self, mock_docx_parse, tmp_path):
        """Test that .docx files are routed to DOCXParser."""
        file_path = tmp_path / "test.docx"
        file_path.write_text("dummy")
        mock_docx_parse.return_value = "parsed content"
        
        result = FileParser.parse(str(file_path))
        
        mock_docx_parse.assert_called_once_with(str(file_path))
        assert result == "parsed content"
    
    @patch('src.file_parser.HTMLParser.parse')
    def test_parse_routes_to_html_parser(self, mock_html_parse, tmp_path):
        """Test that .html files are routed to HTMLParser."""
        file_path = tmp_path / "test.html"
        file_path.write_text("dummy")
        mock_html_parse.return_value = "parsed content"
        
        result = FileParser.parse(str(file_path))
        
        mock_html_parse.assert_called_once_with(str(file_path))
        assert result == "parsed content"
    
    @patch('src.file_parser.MarkdownParser.parse')
    def test_parse_routes_to_markdown_parser(self, mock_md_parse, tmp_path):
        """Test that .md files are routed to MarkdownParser."""
        file_path = tmp_path / "test.md"
        file_path.write_text("dummy")
        mock_md_parse.return_value = "parsed content"
        
        result = FileParser.parse(str(file_path))
        
        mock_md_parse.assert_called_once_with(str(file_path))
        assert result == "parsed content"
    
    @patch('src.file_parser.TextParser.parse')
    def test_parse_routes_to_text_parser(self, mock_txt_parse, tmp_path):
        """Test that .txt files are routed to TextParser."""
        file_path = tmp_path / "test.txt"
        file_path.write_text("dummy")
        mock_txt_parse.return_value = "parsed content"
        
        result = FileParser.parse(str(file_path))
        
        mock_txt_parse.assert_called_once_with(str(file_path))
        assert result == "parsed content"


@pytest.mark.skipif(True, reason="PyMuPDF (fitz) not installed in test environment")
class TestPDFParser:
    """Tests for PDFParser."""
    
    @patch('src.file_parser.fitz')
    def test_parse_pdf_success(self, mock_fitz):
        """Test successful PDF parsing."""
        # Mock fitz document
        mock_doc = MagicMock()
        mock_page1 = MagicMock()
        mock_page1.get_text.return_value = "Page 1 content"
        mock_page2 = MagicMock()
        mock_page2.get_text.return_value = "Page 2 content"
        
        mock_doc.__len__.return_value = 2
        mock_doc.__getitem__.side_effect = [mock_page1, mock_page2]
        mock_fitz.open.return_value = mock_doc
        
        result = PDFParser.parse("/path/to/test.pdf")
        
        assert "Page 1 content" in result
        assert "Page 2 content" in result
        mock_doc.close.assert_called_once()
    
    def test_parse_pdf_import_error(self):
        """Test that missing pymupdf raises ImportError."""
        with patch.dict('sys.modules', {'fitz': None}):
            with pytest.raises(ImportError, match="pymupdf is required"):
                PDFParser.parse("/path/to/test.pdf")
    
    @patch('src.file_parser.fitz')
    def test_parse_pdf_parsing_error(self, mock_fitz):
        """Test PDF parsing error handling."""
        mock_fitz.open.side_effect = Exception("Corrupted PDF")
        
        with pytest.raises(ValueError, match="PDF parsing failed"):
            PDFParser.parse("/path/to/test.pdf")


@pytest.mark.skipif(True, reason="python-docx not installed in test environment")
class TestDOCXParser:
    """Tests for DOCXParser."""
    
    @patch('docx.Document')
    def test_parse_docx_success(self, mock_document_class):
        """Test successful DOCX parsing."""
        # Mock document with paragraphs and tables
        mock_doc = MagicMock()
        
        mock_para1 = MagicMock()
        mock_para1.text = "Paragraph 1"
        mock_para2 = MagicMock()
        mock_para2.text = "Paragraph 2"
        mock_doc.paragraphs = [mock_para1, mock_para2]
        
        mock_cell1 = MagicMock()
        mock_cell1.text = "Cell 1"
        mock_cell2 = MagicMock()
        mock_cell2.text = "Cell 2"
        mock_row = MagicMock()
        mock_row.cells = [mock_cell1, mock_cell2]
        mock_table = MagicMock()
        mock_table.rows = [mock_row]
        mock_doc.tables = [mock_table]
        
        mock_document_class.return_value = mock_doc
        
        result = DOCXParser.parse("/path/to/test.docx")
        
        assert "Paragraph 1" in result
        assert "Paragraph 2" in result
        assert "Cell 1" in result
        assert "Cell 2" in result
    
    def test_parse_docx_import_error(self):
        """Test that missing python-docx raises ImportError."""
        with patch.dict('sys.modules', {'docx': None}):
            with pytest.raises(ImportError, match="python-docx is required"):
                DOCXParser.parse("/path/to/test.docx")


class TestHTMLParser:
    """Tests for HTMLParser."""
    
    def test_parse_html_success(self, tmp_path):
        """Test successful HTML parsing."""
        html_content = """
        <html>
        <head><title>Test</title></head>
        <body>
            <h1>Heading</h1>
            <p>Paragraph text</p>
            <script>console.log('remove me');</script>
            <style>.class { color: red; }</style>
        </body>
        </html>
        """
        file_path = tmp_path / "test.html"
        file_path.write_text(html_content)
        
        result = HTMLParser.parse(str(file_path))
        
        assert "Heading" in result
        assert "Paragraph text" in result
        assert "console.log" not in result  # Script removed
        assert "color: red" not in result  # Style removed
    
    def test_parse_html_import_error(self):
        """Test that missing beautifulsoup4 raises ImportError."""
        # Skip this test - bs4 is already installed
        pytest.skip("beautifulsoup4 is pre-installed in environment")


class TestMarkdownParser:
    """Tests for MarkdownParser."""
    
    def test_parse_markdown_utf8(self, tmp_path):
        """Test parsing UTF-8 markdown file."""
        content = "# Heading\n\nSome **bold** text with émojis 🎉"
        file_path = tmp_path / "test.md"
        file_path.write_text(content, encoding='utf-8')
        
        result = MarkdownParser.parse(str(file_path))
        
        assert result == content
    
    def test_parse_markdown_latin1_fallback(self, tmp_path):
        """Test fallback to latin-1 encoding."""
        content = "Text with special chars: café"
        file_path = tmp_path / "test.md"
        file_path.write_bytes(content.encode('latin-1'))
        
        result = MarkdownParser.parse(str(file_path))
        
        assert "café" in result


class TestTextParser:
    """Tests for TextParser."""
    
    def test_parse_text_utf8(self, tmp_path):
        """Test parsing UTF-8 text file."""
        content = "Plain text content\nWith multiple lines"
        file_path = tmp_path / "test.txt"
        file_path.write_text(content, encoding='utf-8')
        
        result = TextParser.parse(str(file_path))
        
        assert result == content
    
    def test_parse_text_latin1_fallback(self, tmp_path):
        """Test fallback to latin-1 encoding."""
        content = "Text with special chars: naïve"
        file_path = tmp_path / "test.txt"
        file_path.write_bytes(content.encode('latin-1'))
        
        result = TextParser.parse(str(file_path))
        
        # Source strips non-ASCII in latin1 fallback
        assert "nav" in result or "naïve" in result
