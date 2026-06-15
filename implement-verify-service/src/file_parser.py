"""
File parsing utilities for converting various file formats to text.
Single Responsibility: Convert file formats to plain text.
"""

from pathlib import Path
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class FileParser:
    """
    Factory for parsing files to text.
    Delegates to specific parser classes based on file extension.
    """
    
    SUPPORTED_EXTENSIONS = {'.pdf', '.docx', '.html', '.htm', '.md', '.txt', '.json', '.xml', '.yaml', '.yml', '.properties', '.cfg', '.ini', '.toml', '.gradle'}
    
    # Mapping of MIME types to file extensions
    MIME_TYPE_TO_EXTENSION = {
        'application/pdf': '.pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'text/html': '.html',
        'application/xhtml+xml': '.html',
        'text/markdown': '.md',
        'text/plain': '.txt',
        'text/x-markdown': '.md',
        'application/json': '.json',
    }

    @staticmethod
    def parse(file_path: str, content_type: Optional[str] = None) -> str:
        """
        Parse any supported file format to plain text.

        Args:
            file_path: Path to file to parse
            content_type: Optional MIME type (used for URL-downloaded files without extensions)

        Returns:
            Parsed text content

        Raises:
            ValueError: If file format is not supported
            FileNotFoundError: If file does not exist
        """
        path = Path(file_path)

        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        extension = path.suffix.lower()

        # If no extension, try to detect from content_type
        if not extension and content_type:
            extension = FileParser._detect_extension_from_mime_type(content_type)
            logger.info(f"Detected extension '{extension}' from MIME type: {content_type}")

        if extension not in FileParser.SUPPORTED_EXTENSIONS:
            raise ValueError(f"Unsupported file format: {extension}")

        # Route to appropriate parser
        if extension == '.pdf':
            return PDFParser.parse(file_path)
        elif extension == '.docx':
            return DOCXParser.parse(file_path)
        elif extension in ['.html', '.htm']:
            return HTMLParser.parse(file_path)
        elif extension == '.md':
            return MarkdownParser.parse(file_path)
        elif extension == '.txt':
            return TextParser.parse(file_path)
        elif extension == '.json':
            return JSONParser.parse(file_path)
        elif extension in ['.xml', '.yaml', '.yml', '.properties', '.cfg', '.ini', '.toml', '.gradle']:
            return TextFileParser.parse(file_path)
        else:
            raise ValueError(f"No parser available for: {extension}")

    @staticmethod
    def _detect_extension_from_mime_type(content_type: str) -> str:
        """
        Detect file extension from MIME type.

        Args:
            content_type: MIME type string (e.g., 'application/pdf')

        Returns:
            File extension (e.g., '.pdf')

        Raises:
            ValueError: If MIME type is not supported
        """
        # Handle MIME types with parameters (e.g., 'text/html; charset=utf-8')
        mime_type = content_type.split(';')[0].strip().lower()

        if mime_type in FileParser.MIME_TYPE_TO_EXTENSION:
            return FileParser.MIME_TYPE_TO_EXTENSION[mime_type]

        # Fallback: try to match partial MIME types
        for known_mime, ext in FileParser.MIME_TYPE_TO_EXTENSION.items():
            if mime_type.startswith(known_mime.split('/')[0]):  # Match by type (e.g., 'text/')
                return ext

        raise ValueError(f"Unsupported MIME type: {content_type}")


class PDFParser:
    """Parser for PDF files using pymupdf (fitz)."""
    
    @staticmethod
    def parse(file_path: str) -> str:
        """
        Parse PDF file to text.
        
        Args:
            file_path: Path to PDF file
            
        Returns:
            Extracted text content
        """
        try:
            import fitz  # pymupdf
        except ImportError:
            raise ImportError(
                "pymupdf is required for PDF parsing. "
                "Install with: pip install pymupdf"
            )
        
        try:
            doc = fitz.open(file_path)
            text_parts = []
            
            for page_num in range(len(doc)):
                page = doc[page_num]
                text_parts.append(page.get_text())
            
            doc.close()
            return '\n\n'.join(text_parts)
            
        except Exception as e:
            logger.error(f"Failed to parse PDF {file_path}: {e}")
            raise ValueError(f"PDF parsing failed: {e}")


class DOCXParser:
    """Parser for DOCX files using python-docx."""
    
    @staticmethod
    def parse(file_path: str) -> str:
        """
        Parse DOCX file to text.
        
        Args:
            file_path: Path to DOCX file
            
        Returns:
            Extracted text content
        """
        try:
            from docx import Document
        except ImportError:
            raise ImportError(
                "python-docx is required for DOCX parsing. "
                "Install with: pip install python-docx"
            )
        
        try:
            doc = Document(file_path)
            text_parts = []
            
            # Extract paragraphs
            for paragraph in doc.paragraphs:
                if paragraph.text.strip():
                    text_parts.append(paragraph.text)
            
            # Extract tables
            for table in doc.tables:
                for row in table.rows:
                    row_text = ' | '.join(cell.text for cell in row.cells)
                    if row_text.strip():
                        text_parts.append(row_text)
            
            return '\n\n'.join(text_parts)
            
        except Exception as e:
            logger.error(f"Failed to parse DOCX {file_path}: {e}")
            raise ValueError(f"DOCX parsing failed: {e}")


class HTMLParser:
    """Parser for HTML files using BeautifulSoup (safe, generic)."""

    @staticmethod
    def parse(file_path: str) -> str:
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            raise ImportError(
                "beautifulsoup4 is required for HTML parsing. "
                "Install with: pip install beautifulsoup4"
            )

        try:
            # Read bytes -> decode safely (prevents odd encoding crashes)
            with open(file_path, "rb") as f:
                raw = f.read()
            html = raw.decode("utf-8", errors="replace")

            # Prefer lxml if installed; otherwise html.parser
            try:
                soup = BeautifulSoup(html, "lxml")
            except Exception:
                soup = BeautifulSoup(html, "html.parser")

            # Remove obvious non-content blocks
            for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
                tag.decompose()

            # Pick a reasonable main container without “bespoke” rules
            main = (
                soup.find("main")
                or soup.find("article")
                or soup.find(attrs={"role": "main"})
                or (soup.body if soup.body else soup)
            )

            text = main.get_text(separator="\n", strip=True)

            # Normalize whitespace
            import re
            text = re.sub(r"\n{3,}", "\n\n", text).strip()

            if not text:
                raise ValueError("HTML parsing produced empty text")

            return text

        except Exception as e:
            logger.error(f"Failed to parse HTML {file_path}: {e}")
            raise ValueError(f"HTML parsing failed: {e}")


class MarkdownParser:
    """Parser for Markdown files (direct text read)."""
    
    @staticmethod
    def parse(file_path: str) -> str:
        """
        Parse Markdown file to text.
        
        Args:
            file_path: Path to Markdown file
            
        Returns:
            File content as text
        """
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        except UnicodeDecodeError:
            # Fallback to latin-1
            with open(file_path, 'r', encoding='latin-1') as f:
                return f.read()
        except Exception as e:
            logger.error(f"Failed to parse Markdown {file_path}: {e}")
            raise ValueError(f"Markdown parsing failed: {e}")


class TextParser:
    """Parser for plain text files (direct read)."""

    @staticmethod
    def parse(file_path: str) -> str:
        """
        Parse HTML file to text, extracting main content and removing obvious boilerplate.

        Generic approach:
          1) Parse HTML
          2) Remove obvious non-content tags
          3) Select main content (<main>/<article>/<role=main> else best-density node)
          4) Extract text and normalize whitespace
        """
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            raise ImportError(
                "beautifulsoup4 is required for HTML parsing. "
                "Install with: pip install beautifulsoup4"
            )

        def _clean_text(text: str) -> str:
            import re
            if not text:
                return ""
            # Normalize line endings & whitespace
            text = text.replace("\r\n", "\n").replace("\r", "\n")
            # Collapse runs of spaces/tabs
            text = re.sub(r"[ \t]+", " ", text)
            # Collapse 3+ newlines
            text = re.sub(r"\n{3,}", "\n\n", text)
            return text.strip()

        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                html_content = f.read()

            soup = BeautifulSoup(html_content, "html.parser")

            # 1) Remove obvious non-content tags (safe: list() snapshot)
            for tag in list(soup.find_all(["script", "style", "noscript", "svg", "iframe", "form"])):
                tag.decompose()

            # 2) Candidate selection: prefer semantic main containers
            main = (
                    soup.find("main")
                    or soup.find("article")
                    or soup.find(attrs={"role": "main"})
            )

            # 3) Fallback heuristic: pick a container with best text density and low link density
            if main is None:
                body = soup.find("body") or soup

                # Consider only common content containers to reduce noise
                candidates = body.find_all(["article", "main", "section", "div"], recursive=True)
                if not candidates:
                    candidates = [body]

                best_node = None
                best_score = float("-inf")

                for node in candidates:
                    # Skip tiny nodes early
                    text = node.get_text(" ", strip=True)
                    if len(text) < 200:
                        continue

                    # Link density heuristic
                    link_text_len = 0
                    for a in node.find_all("a"):
                        link_text_len += len(a.get_text(" ", strip=True))

                    total_text_len = len(text)
                    link_density = (link_text_len / total_text_len) if total_text_len else 1.0

                    # Penalize lots of links; reward lots of text
                    # Score tuned to be simple and generic
                    score = total_text_len * (1.0 - min(link_density, 0.95))

                    if score > best_score:
                        best_score = score
                        best_node = node

                main = best_node or body

            # 4) Extract text
            raw_text = main.get_text("\n", strip=True) if main else soup.get_text("\n", strip=True)
            text = _clean_text(raw_text)

            if not text:
                # Best-effort: fall back to whole doc text
                fallback = _clean_text(soup.get_text("\n", strip=True))
                if fallback:
                    return fallback
                raise ValueError("No text content extracted from HTML.")

            return text

        except Exception as e:
            logger.error(f"Failed to parse HTML {file_path}: {e}")
            raise ValueError(f"HTML parsing failed: {e}")


class TextFileParser:
    """Parser for text-based config files (XML, YAML, properties, etc.)."""
    
    @staticmethod
    def parse(file_path: str) -> str:
        """
        Parse text-based configuration file.
        
        Args:
            file_path: Path to file
            
        Returns:
            File content as text
        """
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except UnicodeDecodeError:
            with open(file_path, "r", encoding="latin-1") as f:
                return f.read()
        except Exception as e:
            logger.error(f"Failed to parse file {file_path}: {e}")
            raise ValueError(f"File parsing failed: {e}")


class JSONParser:
    """Parser for JSON files (direct read)."""
    
    @staticmethod
    def parse(file_path: str) -> str:
        """
        Parse JSON file.
        
        Args:
            file_path: Path to JSON file
            
        Returns:
            File content as text
        """
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        except Exception as e:
            logger.error(f"Failed to parse JSON file {file_path}: {e}")
            raise ValueError(f"JSON parsing failed: {e}")
