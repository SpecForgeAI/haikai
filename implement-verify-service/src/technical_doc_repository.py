"""
Technical Document Manager
Orchestrates the workflow for processing technical documentation files.
Single Responsibility: Manage tech doc download, caching, and parsing workflow.
"""

from pathlib import Path
from typing import List, Dict, Optional
from datetime import datetime
from urllib.parse import urlparse
import shutil
import requests
import logging
import re
import time

try:
    import cloudscraper
    CLOUDSCRAPER_AVAILABLE = True
except ImportError:
    CLOUDSCRAPER_AVAILABLE = False

from .file_parser import FileParser

logger = logging.getLogger(__name__)


class TechnicalDocRepository:
    """
    Manages technical document processing workflow.
    Handles downloading, caching, and parsing of technical documents.
    """
    
    def __init__(self, staging_dir: str):
        """
        Initialize TechnicalDocRepository.
        
        Args:
            staging_dir: Path to staging directory for caching files
        """
        self.staging_dir = Path(staging_dir)
        self.temp_dir = self.staging_dir / 'temp'
        self.parsed_dir = self.staging_dir / 'parsed'
        self.tech_docs_dir = self.staging_dir / 'tech-docs'
        self.file_parser = FileParser()
        
        # Store content-type metadata for files
        self._file_content_types = {}
        
        # Create persistent session for better cookie/connection handling
        self.session = requests.Session()
        
        # Create cloudscraper session for bypassing anti-bot protection
        if CLOUDSCRAPER_AVAILABLE:
            self.scraper = cloudscraper.create_scraper(
                browser={
                    'browser': 'chrome',
                    'platform': 'windows',
                    'desktop': True
                }
            )
        else:
            self.scraper = None
        
        # Set default headers that work across most sites
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
        })

        # Create directories
        self.temp_dir.mkdir(parents=True, exist_ok=True)
        self.parsed_dir.mkdir(parents=True, exist_ok=True)
        self.tech_docs_dir.mkdir(parents=True, exist_ok=True)

    def ingest_technical_documents(
        self,
        file_paths: List[str],
        use_cache: bool = False
    ) -> List[Dict]:
        """
        Process a list of technical documents.
        Downloads/copies files, parses them, and prepares for LLM analysis.

        Args:
            file_paths: List of file paths or URLs to process
            use_cache: Whether to use cached files if available

        Returns:
            List of dicts with 'original', 'local', and 'parsed' paths
        """
        results = []

        for file_path in file_paths:
            try:
                logger.info(f"Processing technical document: {file_path}")

                # Step 1: Ensure file is local
                local_path = self._ensure_local_file(file_path, use_cache)
                logger.info(f"  Local file: {local_path}")

                # Step 2: Parse to text
                parsed_path = self._ensure_parsed_file(local_path, use_cache)
                logger.info(f"  Parsed file: {parsed_path}")

                results.append({
                    'original': file_path,
                    'local': str(local_path),
                    'parsed': str(parsed_path)
                })

            except Exception as e:
                logger.error(f"Failed to process {file_path}: {e}")
                logger.warning(f"  Skipping this document and continuing...")
                continue

        logger.info(f"Successfully processed {len(results)} of {len(file_paths)} documents")
        return results

    def _ensure_local_file(self, file_path: str, use_cache: bool) -> Path:
        """
        Ensure file is available locally (download or copy if needed).

        Args:
            file_path: File path or URL
            use_cache: Whether to use cached version

        Returns:
            Path to local file
        """
        if file_path.startswith('http://') or file_path.startswith('https://'):
            return self._download_file(file_path, use_cache)
        else:
            return self._copy_file(file_path, use_cache)

    def _ensure_parsed_file(self, file_path: Path, use_cache: bool) -> Path:
        """
        Ensure file is parsed to text format.

        Args:
            file_path: Path to file to parse
            use_cache: Whether to use cached parsed version

        Returns:
            Path to parsed text file
        """
        parsed_path = self.parsed_dir / f"{file_path.stem}.txt"

        if use_cache and parsed_path.exists():
            logger.info(f"  Using cached parsed file: {parsed_path}")
            return parsed_path

        # Parse file using FileParser
        logger.info(f"  Parsing file: {file_path}")

        # Get content_type from metadata dictionary
        content_type = self._file_content_types.get(str(file_path))

        content = self.file_parser.parse(str(file_path), content_type=content_type)

        # Add metadata header
        header = self._create_header(file_path)
        full_content = header + content

        # Save parsed content
        parsed_path.write_text(full_content, encoding='utf-8')
        logger.info(f"  Saved parsed content ({len(content)} chars)")

        return parsed_path

    def _convert_github_url_to_raw(self, url: str) -> str:
        """
        Convert GitHub blob URLs to raw content URLs.
        
        Examples:
            https://github.com/owner/repo/blob/main/path/file.md
            -> https://raw.githubusercontent.com/owner/repo/main/path/file.md
            
            https://github.com/owner/repo/blob/branch-name/path/file.md
            -> https://raw.githubusercontent.com/owner/repo/branch-name/path/file.md
        
        Args:
            url: GitHub URL (blob or raw)
            
        Returns:
            Raw content URL
        """
        # Pattern to match GitHub blob URLs
        github_blob_pattern = r'https?://github\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.+)'
        match = re.match(github_blob_pattern, url)
        
        if match:
            owner, repo, branch, path = match.groups()
            raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"
            logger.info(f"  Converted GitHub blob URL to raw URL")
            logger.info(f"    Original: {url}")
            logger.info(f"    Raw: {raw_url}")
            return raw_url
        
        # If not a blob URL, return as-is
        return url

    def _download_file(self, url: str, use_cache: bool) -> Path:
        original_url = url
        url = self._convert_github_url_to_raw(url)

        parsed_url = urlparse(url)

        rel_path = self._url_to_local_relpath(parsed_url)
        local_path = self.temp_dir / parsed_url.netloc / rel_path

        logger.info(f"  Downloading from: {url}")
        
        # Domain-specific header customization
        extra_headers = {}
        
        # Add Referer for sites that check it
        if 'medium.com' in parsed_url.netloc:
            extra_headers['Referer'] = 'https://www.google.com/'
            extra_headers['DNT'] = '1'
        elif 'aws.amazon.com' in parsed_url.netloc or 'docs.aws.amazon.com' in parsed_url.netloc:
            extra_headers['Referer'] = 'https://aws.amazon.com/'
        
        max_retries = 3
        retry_delay = 2  # seconds
        last_exception = None
        
        for attempt in range(max_retries):
            try:
                # Use session for better cookie/connection handling
                response = self.session.get(
                    url, 
                    headers=extra_headers,
                    timeout=30,
                    allow_redirects=True
                )
                response.raise_for_status()

                content_type = response.headers.get("content-type", "")
                logger.info(f"  Content-Type: {content_type}")

                local_path = self._apply_content_type_suffix(local_path, content_type)

                # cache check after final name is known
                if use_cache and local_path.exists():
                    logger.info(f"  Using cached download: {local_path}")
                    return local_path

                local_path.parent.mkdir(parents=True, exist_ok=True)
                local_path.write_bytes(response.content)
                logger.info(f"  Downloaded {len(response.content)} bytes to {local_path}")

                self._file_content_types[str(local_path)] = content_type
                
                # Add small delay to avoid rate limiting
                time.sleep(0.5)
                
                return local_path

            except requests.HTTPError as e:
                last_exception = e
                # Try cloudscraper for 403 errors (Cloudflare/anti-bot protection)
                if e.response.status_code == 403 and self.scraper and attempt == 0:
                    logger.warning(f"  Got 403, trying cloudscraper to bypass anti-bot protection...")
                    try:
                        response = self.scraper.get(
                            url,
                            timeout=30,
                            allow_redirects=True
                        )
                        response.raise_for_status()
                        
                        content_type = response.headers.get("content-type", "")
                        logger.info(f"  Cloudscraper success! Content-Type: {content_type}")
                        
                        local_path = self._apply_content_type_suffix(local_path, content_type)
                        
                        if use_cache and local_path.exists():
                            logger.info(f"  Using cached download: {local_path}")
                            return local_path
                        
                        local_path.parent.mkdir(parents=True, exist_ok=True)
                        local_path.write_bytes(response.content)
                        logger.info(f"  Downloaded {len(response.content)} bytes via cloudscraper")
                        
                        self._file_content_types[str(local_path)] = content_type
                        time.sleep(1.0)  # Longer delay after cloudscraper
                        
                        return local_path
                    except Exception as scraper_error:
                        logger.warning(f"  Cloudscraper also failed: {scraper_error}")
                        # Continue to retry logic below
                
                if attempt < max_retries - 1:
                    logger.warning(f"  Download attempt {attempt + 1} failed, retrying in {retry_delay}s: {e}")
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                else:
                    logger.error(f"Failed to download {url}: {e}")
                    raise ValueError(f"Download failed: {e}")
                    
            except requests.RequestException as e:
                last_exception = e
                if attempt < max_retries - 1:
                    logger.warning(f"  Download attempt {attempt + 1} failed, retrying in {retry_delay}s: {e}")
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                else:
                    logger.error(f"Failed to download {url}: {e}")
                    raise ValueError(f"Download failed: {e}")

    def _get_extension_from_content_type(self, content_type: str) -> Optional[str]:
        """
        Detect file extension from Content-Type header.

        Args:
            content_type: Content-Type header value

        Returns:
            File extension (e.g., '.pdf') or None if not recognized
        """
        # Handle Content-Type with parameters (e.g., 'text/html; charset=utf-8')
        mime_type = content_type.split(';')[0].strip().lower()

        # Mapping of MIME types to extensions
        mime_to_ext = {
            'application/pdf': '.pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
            'text/html': '.html',
            'application/xhtml+xml': '.html',
            'text/markdown': '.md',
            'text/plain': '.txt',
            'text/x-markdown': '.md',
        }

        if mime_type in mime_to_ext:
            return mime_to_ext[mime_type]

        # Fallback: match by main type
        main_type = mime_type.split('/')[0]
        if main_type == 'text':
            return '.txt'
        elif main_type == 'application':
            if 'pdf' in mime_type:
                return '.pdf'
            elif 'word' in mime_type or 'docx' in mime_type:
                return '.docx'

        return None
    
    def _copy_file(self, file_path: str, use_cache: bool) -> Path:
        """
        Copy local file to staging/temp/.
        
        Resolves the file path in order:
        1. Absolute path as-is
        2. Relative to current working directory
        3. Relative to staging directory parent (workspace)
        
        Args:
            file_path: Path to local file
            use_cache: Whether to use cached version
            
        Returns:
            Path to copied file
        """
        source = Path(file_path)
        
        if not source.exists():
            # Try relative to staging dir parent (the workspace)
            workspace_relative = self.staging_dir.parent / file_path
            if workspace_relative.exists():
                source = workspace_relative
                logger.info(f"  Resolved relative path to workspace: {source}")
            else:
                raise FileNotFoundError(
                    f"File not found: {file_path} "
                    f"(also tried {workspace_relative}). "
                    f"Provide an absolute path or a path relative to the API workspace."
                )
        
        # Use original filename in temp directory
        dest = self.temp_dir / source.name
        
        if use_cache and dest.exists():
            logger.info(f"  Using cached file: {dest}")
            return dest
        
        # Copy file
        logger.info(f"  Copying file to: {dest}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest)
        
        return dest
    
    def _create_header(self, file_path: Path) -> str:
        """
        Create metadata header for parsed file.
        
        Args:
            file_path: Path to source file
            
        Returns:
            Header string with metadata
        """
        timestamp = datetime.now().isoformat()
        header = f"=== SOURCE: {file_path} ===\n"
        header += f"=== PARSED: {timestamp} ===\n\n"
        return header
    
    def clear_cache(self, cache_type: str = 'all'):
        """
        Clear cached files.
        
        Args:
            cache_type: Type of cache to clear ('all', 'downloads', 'parsed', 'extractions')
        """
        if cache_type in ['all', 'downloads']:
            if self.temp_dir.exists():
                shutil.rmtree(self.temp_dir)
                self.temp_dir.mkdir(parents=True, exist_ok=True)
                logger.info("Cleared download cache")
        
        if cache_type in ['all', 'parsed']:
            if self.parsed_dir.exists():
                shutil.rmtree(self.parsed_dir)
                self.parsed_dir.mkdir(parents=True, exist_ok=True)
                logger.info("Cleared parsed file cache")
        
        if cache_type in ['all', 'extractions']:
            if self.tech_docs_dir.exists():
                shutil.rmtree(self.tech_docs_dir)
                self.tech_docs_dir.mkdir(parents=True, exist_ok=True)
                logger.info("Cleared extraction cache")

    def _url_to_local_relpath(self, parsed_url) -> str:
        """
        Build a safe relative file path for a URL.
        - Empty path or trailing slash => .../index
        """
        rel = parsed_url.path.lstrip("/")  # may be ""
        if not rel or rel.endswith("/"):
            rel = (rel + "index") if rel else "index"
        return rel

    def _apply_content_type_suffix(self, local_path: Path, content_type: str) -> Path:
        """
        Ensure local_path has a real extension.
        Also fixes the 'domain.tld' filename case (e.g., react-typescript-style-guide.com)
        when the server returns HTML.
        """
        mime = (content_type or "").split(";")[0].strip().lower()

        # If path looks like "something.com" but response is HTML, treat it as "no suffix"
        fake_tlds = {".com", ".io", ".net", ".org", ".co", ".dev", ".app", ".ai"}
        if local_path.suffix.lower() in fake_tlds and mime in {"text/html", "application/xhtml+xml"}:
            local_path = local_path.with_suffix("")

        if not local_path.suffix:
            ext = self._get_extension_from_content_type(content_type) or ".txt"
            local_path = local_path.with_suffix(ext)

        return local_path