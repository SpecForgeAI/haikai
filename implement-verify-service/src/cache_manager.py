"""
Cache manager for document content and LLM extraction results.
Reduces redundant processing and LLM calls.
"""

import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class CacheManager:
    """Manages caching of documents and LLM results."""
    
    def __init__(self, cache_dir: str = "/app/cache", ttl_hours: int = 24):
        """
        Initialize cache manager.
        
        Args:
            cache_dir: Directory for cache storage
            ttl_hours: Time-to-live for cache entries in hours
        """
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.ttl_seconds = ttl_hours * 3600
        
        self.doc_cache_dir = self.cache_dir / "documents"
        self.llm_cache_dir = self.cache_dir / "llm_results"
        
        self.doc_cache_dir.mkdir(exist_ok=True)
        self.llm_cache_dir.mkdir(exist_ok=True)
        
        logger.info(f"CacheManager initialized (cache_dir={cache_dir}, ttl={ttl_hours}h)")
    
    def _hash_key(self, key: str) -> str:
        """Generate hash for cache key."""
        return hashlib.sha256(key.encode()).hexdigest()
    
    def _is_expired(self, cache_path: Path) -> bool:
        """Check if cache entry is expired."""
        if not cache_path.exists():
            return True
        
        mtime = cache_path.stat().st_mtime
        age_seconds = datetime.now().timestamp() - mtime
        
        return age_seconds > self.ttl_seconds
    
    # === Document Caching ===
    
    def get_document(self, url: str) -> Optional[str]:
        """
        Get cached document content by URL.
        
        Returns:
            Cached content or None if not found/expired
        """
        cache_key = self._hash_key(url)
        cache_path = self.doc_cache_dir / f"{cache_key}.txt"
        
        if self._is_expired(cache_path):
            logger.debug(f"Document cache miss (expired): {url}")
            return None
        
        try:
            content = cache_path.read_text(encoding='utf-8')
            logger.info(f"Document cache hit: {url}")
            return content
        except Exception as e:
            logger.error(f"Error reading document cache: {e}")
            return None
    
    def set_document(self, url: str, content: str) -> None:
        """Cache document content by URL."""
        cache_key = self._hash_key(url)
        cache_path = self.doc_cache_dir / f"{cache_key}.txt"
        
        try:
            cache_path.write_text(content, encoding='utf-8')
            
            # Save metadata
            meta_path = self.doc_cache_dir / f"{cache_key}.meta.json"
            meta = {
                "url": url,
                "cached_at": datetime.now().isoformat(),
                "size_bytes": len(content)
            }
            meta_path.write_text(json.dumps(meta, indent=2), encoding='utf-8')
            
            logger.info(f"Document cached: {url} ({len(content)} bytes)")
        except Exception as e:
            logger.error(f"Error caching document: {e}")
    
    # === LLM Result Caching ===
    
    def get_llm_result(self, content_hash: str, category: str) -> Optional[Dict[str, Any]]:
        """
        Get cached LLM extraction result.
        
        Args:
            content_hash: Hash of the document content
            category: Analysis category (e.g., 'tech_stack')
        
        Returns:
            Cached result or None if not found/expired
        """
        cache_key = self._hash_key(f"{content_hash}:{category}")
        cache_path = self.llm_cache_dir / f"{cache_key}.json"
        
        if self._is_expired(cache_path):
            logger.debug(f"LLM result cache miss (expired): {category}")
            return None
        
        try:
            result = json.loads(cache_path.read_text(encoding='utf-8'))
            logger.info(f"LLM result cache hit: {category}")
            return result
        except Exception as e:
            logger.error(f"Error reading LLM result cache: {e}")
            return None
    
    def set_llm_result(self, content_hash: str, category: str, result: Dict[str, Any]) -> None:
        """Cache LLM extraction result."""
        cache_key = self._hash_key(f"{content_hash}:{category}")
        cache_path = self.llm_cache_dir / f"{cache_key}.json"
        
        try:
            # Add cache metadata
            cached_result = {
                "cached_at": datetime.now().isoformat(),
                "content_hash": content_hash,
                "category": category,
                "result": result
            }
            cache_path.write_text(json.dumps(cached_result, indent=2), encoding='utf-8')
            
            logger.info(f"LLM result cached: {category}")
        except Exception as e:
            logger.error(f"Error caching LLM result: {e}")
    
    def hash_content(self, content: str) -> str:
        """Generate hash for document content."""
        return hashlib.sha256(content.encode()).hexdigest()[:16]
    
    # === Cache Management ===
    
    def clear_expired(self) -> int:
        """
        Remove expired cache entries.
        
        Returns:
            Number of entries removed
        """
        removed = 0
        
        for cache_dir in [self.doc_cache_dir, self.llm_cache_dir]:
            for cache_file in cache_dir.glob("*"):
                if cache_file.suffix not in ['.txt', '.json']:
                    continue
                
                if self._is_expired(cache_file):
                    try:
                        cache_file.unlink()
                        # Remove metadata file if exists
                        meta_file = cache_file.with_suffix('.meta.json')
                        if meta_file.exists():
                            meta_file.unlink()
                        removed += 1
                    except Exception as e:
                        logger.error(f"Error removing expired cache: {e}")
        
        if removed > 0:
            logger.info(f"Removed {removed} expired cache entries")
        
        return removed
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        doc_count = len(list(self.doc_cache_dir.glob("*.txt")))
        llm_count = len(list(self.llm_cache_dir.glob("*.json")))
        
        doc_size = sum(f.stat().st_size for f in self.doc_cache_dir.glob("*.txt"))
        llm_size = sum(f.stat().st_size for f in self.llm_cache_dir.glob("*.json"))
        
        return {
            "documents": {
                "count": doc_count,
                "size_mb": doc_size / (1024 * 1024)
            },
            "llm_results": {
                "count": llm_count,
                "size_mb": llm_size / (1024 * 1024)
            },
            "total_size_mb": (doc_size + llm_size) / (1024 * 1024)
        }


# Global cache instance (enabled via env var)
_cache_instance: Optional[CacheManager] = None


def get_cache() -> Optional[CacheManager]:
    """Get global cache instance (or None if caching disabled)."""
    global _cache_instance
    
    if os.getenv("ENABLE_CACHE", "false").lower() == "true":
        if _cache_instance is None:
            cache_dir = os.getenv("CACHE_DIR", "/app/cache")
            ttl_hours = int(os.getenv("CACHE_TTL_HOURS", "24"))
            _cache_instance = CacheManager(cache_dir=cache_dir, ttl_hours=ttl_hours)
        return _cache_instance
    
    return None
