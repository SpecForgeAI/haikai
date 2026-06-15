"""
Repository fetcher for GitHub, GitLab, and Bitbucket.
Supports fetching files from remote repositories via APIs.
"""
import logging
import re
import base64
from typing import Dict, List, Optional, Tuple
from github import Github
from gitlab import Gitlab
import requests

logger = logging.getLogger(__name__)


class RepositoryFetcher:
    """Fetches files from remote repositories."""
    
    def __init__(self, github_token: Optional[str] = None,
                 gitlab_token: Optional[str] = None,
                 bitbucket_username: Optional[str] = None,
                 bitbucket_password: Optional[str] = None):
        """Initialize repository fetcher with optional authentication."""
        self.github_client = Github(github_token) if github_token else None
        self.gitlab_client = Gitlab('https://gitlab.com', private_token=gitlab_token) if gitlab_token else None
        self.bitbucket_username = bitbucket_username
        self.bitbucket_password = bitbucket_password
    
    def parse_repo_url(self, url: str) -> Tuple[str, str, str, Optional[str], Optional[str], bool]:
        """
        Parse a repository URL to extract platform, owner, repo, branch, path, and type.
        
        Args:
            url: Repository URL (can point to repo, directory, or file)
            
        Returns:
            Tuple of (platform, owner, repo_name, branch, path, is_file)
            - platform: 'github', 'gitlab', or 'bitbucket'
            - owner: Repository owner/organization
            - repo_name: Repository name
            - branch: Branch name (None if not specified)
            - path: Path within repository (None for root)
            - is_file: True if URL points to a single file, False otherwise
        """
        # Remove .git suffix if present
        if url.endswith('.git'):
            url = url[:-4]
        
        # GitHub patterns
        # /blob/branch/path/to/file.ext - single file
        # /tree/branch/path/to/dir - directory
        # /branch - just repo
        github_pattern = r'github\.com[:/]([^/]+)/([^/]+?)(?:/(blob|tree)/([^/]+?)(?:/(.+))?)?$'
        
        match = re.search(github_pattern, url)
        if match:
            owner = match.group(1)
            repo = match.group(2)
            url_type = match.group(3)  # 'blob' or 'tree'
            branch = match.group(4)
            path = match.group(5)
            
            # Strip trailing slashes from path
            if path:
                path = path.rstrip('/')
            
            is_file = (url_type == 'blob')
            
            return ('github', owner, repo, branch, path, is_file)
        
        # GitLab patterns
        gitlab_pattern = r'gitlab\.com[:/]([^/]+)/([^/]+?)(?:/-/(blob|tree)/([^/]+?)(?:/(.+))?)?$'
        
        match = re.search(gitlab_pattern, url)
        if match:
            owner = match.group(1)
            repo = match.group(2)
            url_type = match.group(3)
            branch = match.group(4)
            path = match.group(5)
            
            # Strip trailing slashes from path
            if path:
                path = path.rstrip('/')
            
            is_file = (url_type == 'blob')
            
            return ('gitlab', owner, repo, branch, path, is_file)
        
        # Bitbucket patterns
        bitbucket_pattern = r'bitbucket\.org[:/]([^/]+)/([^/]+?)(?:/src/([^/]+?)(?:/(.+))?)?$'
        
        match = re.search(bitbucket_pattern, url)
        if match:
            owner = match.group(1)
            repo = match.group(2)
            branch = match.group(3)
            path = match.group(4)
            
            # Strip trailing slashes from path
            if path:
                path = path.rstrip('/')
            
            # Bitbucket doesn't distinguish in URL, need to check if path has extension
            is_file = bool(path and '.' in path.split('/')[-1])
            
            return ('bitbucket', owner, repo, branch, path, is_file)
        
        raise ValueError(f"Unable to parse repository URL: {url}")
    
    def fetch_file_content(self, url: str, file_path: str) -> Optional[str]:
        """
        Fetch content of a specific file from a repository.
        
        Args:
            url: Repository URL
            file_path: Path to file within repository
            
        Returns:
            File content as string, or None if not found
        """
        platform, owner, repo, branch, _, _ = self.parse_repo_url(url)
        
        if platform == 'github':
            return self._fetch_github_file(owner, repo, file_path, branch)
        elif platform == 'gitlab':
            return self._fetch_gitlab_file(owner, repo, file_path, branch)
        elif platform == 'bitbucket':
            return self._fetch_bitbucket_file(owner, repo, file_path, branch)
        
        return None
    
    def list_repository_files(self, url: str, recursive: bool = True,
                             max_files: int = 1000) -> List[Dict]:
        """
        List files from a repository, directory, or return single file.
        
        Args:
            url: Repository URL (can point to repo, directory, or file)
            recursive: Whether to list files recursively (ignored for single files)
            max_files: Maximum number of files to return
            
        Returns:
            List of file dictionaries with 'path', 'size', 'url' keys
        """
        platform, owner, repo, branch, path, is_file = self.parse_repo_url(url)
        
        # If URL points to a single file, return just that file
        if is_file:
            file_info = {
                'path': path,
                'size': 0,  # Will be determined when fetched
                'url': url,
                'is_single_file': True
            }
            return [file_info]
        
        # Otherwise, list files from directory or entire repo
        if platform == 'github':
            files = self._list_github_files(owner, repo, branch, recursive, max_files)
        elif platform == 'gitlab':
            files = self._list_gitlab_files(owner, repo, branch, recursive, max_files)
        elif platform == 'bitbucket':
            files = self._list_bitbucket_files(owner, repo, branch, recursive, max_files)
        else:
            return []
        
        # Filter by path if specified
        if path:
            files = [f for f in files if f['path'].startswith(path + '/') or f['path'] == path]
        
        return files
    
    def _fetch_github_file(self, owner: str, repo: str, file_path: str, branch: str) -> Optional[str]:
        """Fetch file from GitHub."""
        if not self.github_client:
            # Try anonymous access for public repos
            self.github_client = Github()
        
        try:
            repository = self.github_client.get_repo(f"{owner}/{repo}")
            
            # If branch is None, use default branch
            if not branch:
                branch = repository.default_branch
            
            content = repository.get_contents(file_path, ref=branch)
            
            if isinstance(content, list):
                return None  # It's a directory
            
            return base64.b64decode(content.content).decode('utf-8')
        except Exception as e:
            logger.error(f"Error fetching GitHub file: {e}", exc_info=True)
            return None
    
    def _list_github_files(self, owner: str, repo: str, branch: str,
                          recursive: bool, max_files: int) -> List[Dict]:
        """List files from GitHub repository."""
        if not self.github_client:
            # Try anonymous access for public repos
            self.github_client = Github()
        
        try:
            repository = self.github_client.get_repo(f"{owner}/{repo}")
            
            # If branch is None, use default branch
            if not branch:
                branch = repository.default_branch
            
            tree = repository.get_git_tree(branch, recursive=recursive)
            
            files = []
            for item in tree.tree[:max_files]:
                if item.type == 'blob':  # It's a file
                    files.append({
                        'path': item.path,
                        'size': item.size,
                        'url': item.url
                    })
            
            return files
        except Exception as e:
            logger.error(f"Error listing GitHub files: {e}", exc_info=True)
            return []
    
    def _fetch_gitlab_file(self, owner: str, repo: str, file_path: str, branch: str) -> Optional[str]:
        """Fetch file from GitLab."""
        if not self.gitlab_client:
            self.gitlab_client = Gitlab('https://gitlab.com')
        
        try:
            project = self.gitlab_client.projects.get(f"{owner}/{repo}")
            file_content = project.files.get(file_path, ref=branch or 'main')
            return base64.b64decode(file_content.content).decode('utf-8')
        except Exception as e:
            logger.error(f"Error fetching GitLab file: {e}", exc_info=True)
            return None
    
    def _list_gitlab_files(self, owner: str, repo: str, branch: str,
                          recursive: bool, max_files: int) -> List[Dict]:
        """List files from GitLab repository."""
        if not self.gitlab_client:
            self.gitlab_client = Gitlab('https://gitlab.com')
        
        try:
            project = self.gitlab_client.projects.get(f"{owner}/{repo}")
            tree = project.repository_tree(ref=branch or 'main', recursive=recursive, per_page=max_files)
            
            files = []
            for item in tree:
                if item['type'] == 'blob':
                    files.append({
                        'path': item['path'],
                        'size': 0,  # GitLab API doesn't provide size in tree
                        'url': item['path']
                    })
            
            return files
        except Exception as e:
            logger.error(f"Error listing GitLab files: {e}", exc_info=True)
            return []
    
    def _fetch_bitbucket_file(self, owner: str, repo: str, file_path: str, branch: str) -> Optional[str]:
        """Fetch file from Bitbucket."""
        try:
            url = f"https://api.bitbucket.org/2.0/repositories/{owner}/{repo}/src/{branch or 'master'}/{file_path}"
            
            if self.bitbucket_username and self.bitbucket_password:
                response = requests.get(url, auth=(self.bitbucket_username, self.bitbucket_password))
            else:
                response = requests.get(url)
            
            if response.status_code == 200:
                return response.text
            return None
        except Exception as e:
            logger.error(f"Error fetching Bitbucket file: {e}", exc_info=True)
            return None
    
    def _list_bitbucket_files(self, owner: str, repo: str, branch: str,
                             recursive: bool, max_files: int) -> List[Dict]:
        """List files from Bitbucket repository."""
        try:
            url = f"https://api.bitbucket.org/2.0/repositories/{owner}/{repo}/src/{branch or 'master'}/"
            
            if self.bitbucket_username and self.bitbucket_password:
                response = requests.get(url, auth=(self.bitbucket_username, self.bitbucket_password))
            else:
                response = requests.get(url)
            
            if response.status_code != 200:
                logger.error(f"Error listing Bitbucket files: HTTP {response.status_code}")
                return []
            
            data = response.json()
            files = []
            
            for item in data.get('values', [])[:max_files]:
                if item['type'] == 'commit_file':
                    files.append({
                        'path': item['path'],
                        'size': item.get('size', 0),
                        'url': item.get('links', {}).get('self', {}).get('href', '')
                    })
            
            return files
        except Exception as e:
            logger.error(f"Error listing Bitbucket files: {e}", exc_info=True)
            return []

    def download_file(self, url: str, file_path: str, local_path: str) -> bool:
        """
        Download a file from repository to local path.
        
        Args:
            url: Repository URL
            file_path: Path to file within repository
            local_path: Local path to save file
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Parse URL to get repository info
            platform, owner, repo, branch, url_path, is_file = self.parse_repo_url(url)
            
            # If URL points to a single file, use that path
            if is_file and url_path:
                actual_file_path = url_path
            else:
                actual_file_path = file_path
            
            # Fetch file content
            if platform == 'github':
                content = self._fetch_github_file(owner, repo, actual_file_path, branch)
            elif platform == 'gitlab':
                content = self._fetch_gitlab_file(owner, repo, actual_file_path, branch)
            elif platform == 'bitbucket':
                content = self._fetch_bitbucket_file(owner, repo, actual_file_path, branch)
            else:
                return False
            
            if content is None:
                return False
            
            # Create parent directories
            from pathlib import Path
            Path(local_path).parent.mkdir(parents=True, exist_ok=True)
            
            # Write content to file
            with open(local_path, 'w', encoding='utf-8') as f:
                f.write(content)
            
            return True
        except Exception as e:
            logger.error(f"Error downloading file {file_path}: {e}", exc_info=True)
            return False
