"""
Early exit detector for irrelevant documents.
Quickly identifies non-technical content to skip expensive LLM processing.
"""

import re
import logging
from typing import Tuple, List, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class RelevanceScore:
    """Document relevance assessment."""
    is_relevant: bool
    confidence: float  # 0.0 to 1.0
    reasons: List[str]
    technical_signals: int
    non_technical_signals: int


class EarlyExitDetector:
    """Fast heuristic-based detector for irrelevant documents."""
    
    # Strong technical indicators (high confidence)
    TECHNICAL_PATTERNS = [
        # Programming languages
        r'\b(python|java|javascript|typescript|c\+\+|ruby|go|rust|php|swift)\b',
        # Frameworks
        r'\b(react|angular|vue|django|flask|spring|express|rails)\b',
        # Databases
        r'\b(mysql|postgresql|mongodb|redis|elasticsearch|cassandra)\b',
        # Cloud/DevOps
        r'\b(aws|azure|gcp|docker|kubernetes|terraform|jenkins|github|gitlab)\b',
        # Code patterns
        r'(function|class|import|export|const|let|var|def|public|private)',
        r'(\{|\}|\(|\)|\[|\]|=>|->)',
        # Version patterns
        r'\b(v?\d+\.\d+\.\d+|version \d+)\b',
        # Tech docs language
        r'\b(api|endpoint|configuration|implementation|deployment|install)\b',
    ]
    
    # Strong non-technical indicators
    NON_TECHNICAL_PATTERNS = [
        # Historical/biographical
        r'\b(born|died|century|historical|biography|life story)\b',
        # News/media
        r'\b(breaking news|latest updates|subscribe|newsletter|trending)\b',
        # General encyclopedia
        r'\b(wikipedia|encyclopedia|general knowledge)\b',
        # Commerce
        r'\b(buy now|add to cart|checkout|shopping|price|discount)\b',
        # Social
        r'\b(share on|like us|follow us|tweet)\b',
    ]
    
    # Technical keywords (weighted scoring)
    TECHNICAL_KEYWORDS = [
        'api', 'sdk', 'cli', 'library', 'framework', 'package', 'module',
        'dependency', 'configuration', 'deployment', 'production', 'staging',
        'development', 'testing', 'debugging', 'logging', 'monitoring',
        'authentication', 'authorization', 'encryption', 'security',
        'database', 'query', 'index', 'cache', 'performance', 'optimization',
        'architecture', 'design pattern', 'microservice', 'container',
        'repository', 'commit', 'branch', 'merge', 'pull request',
    ]
    
    def __init__(self, min_confidence: float = 0.7):
        """
        Initialize detector.
        
        Args:
            min_confidence: Minimum confidence threshold for early exit
        """
        self.min_confidence = min_confidence
        
        # Compile patterns
        self.tech_patterns = [re.compile(p, re.IGNORECASE) for p in self.TECHNICAL_PATTERNS]
        self.non_tech_patterns = [re.compile(p, re.IGNORECASE) for p in self.NON_TECHNICAL_PATTERNS]
        
        logger.info(f"EarlyExitDetector initialized (min_confidence={min_confidence})")
    
    def assess_relevance(self, content: str, url: Optional[str] = None) -> RelevanceScore:
        """
        Quickly assess if document is relevant for technical extraction.
        
        Args:
            content: Document content (first ~5KB is usually enough)
            url: Optional URL for additional heuristics
        
        Returns:
            RelevanceScore with assessment
        """
        # Use first 5KB for fast assessment
        sample = content[:5000] if len(content) > 5000 else content
        sample_lower = sample.lower()
        
        reasons = []
        tech_signals = 0
        non_tech_signals = 0
        
        # Check URL patterns
        if url:
            url_lower = url.lower()
            if any(x in url_lower for x in ['docs', 'documentation', 'api', 'guide', 'tutorial', 'reference']):
                tech_signals += 2
                reasons.append("Technical documentation URL")
            
            if any(x in url_lower for x in ['wikipedia', 'news', 'blog', 'article', 'about']):
                non_tech_signals += 1
                reasons.append("Non-technical URL pattern")
        
        # Check strong technical patterns
        for pattern in self.tech_patterns:
            matches = pattern.findall(sample)
            if matches:
                tech_signals += len(set(matches))  # Unique matches
        
        if tech_signals > 0:
            reasons.append(f"Found {tech_signals} technical patterns")
        
        # Check strong non-technical patterns
        for pattern in self.non_tech_patterns:
            matches = pattern.findall(sample)
            if matches:
                non_tech_signals += len(set(matches))
        
        if non_tech_signals > 0:
            reasons.append(f"Found {non_tech_signals} non-technical patterns")
        
        # Check technical keywords density
        keyword_count = sum(1 for kw in self.TECHNICAL_KEYWORDS if kw in sample_lower)
        if keyword_count >= 5:
            tech_signals += keyword_count // 2
            reasons.append(f"High technical keyword density ({keyword_count} keywords)")
        
        # Calculate confidence
        total_signals = tech_signals + non_tech_signals
        
        if total_signals == 0:
            # No clear signals - assume relevant (be conservative)
            confidence = 0.5
            is_relevant = True
            reasons.append("No clear signals - defaulting to relevant")
        else:
            # Strong technical signals = high confidence relevant
            # Strong non-technical signals = high confidence irrelevant
            tech_ratio = tech_signals / total_signals
            
            if tech_ratio >= 0.7:
                is_relevant = True
                confidence = tech_ratio
            elif tech_ratio <= 0.3:
                is_relevant = False
                confidence = 1.0 - tech_ratio
            else:
                # Mixed signals - assume relevant
                is_relevant = True
                confidence = 0.5
                reasons.append("Mixed signals - defaulting to relevant")
        
        score = RelevanceScore(
            is_relevant=is_relevant,
            confidence=confidence,
            reasons=reasons,
            technical_signals=tech_signals,
            non_technical_signals=non_tech_signals
        )
        
        logger.info(
            f"Relevance assessment: relevant={is_relevant}, "
            f"confidence={confidence:.2f}, "
            f"tech={tech_signals}, non_tech={non_tech_signals}"
        )
        
        return score
    
    def should_skip(self, content: str, url: Optional[str] = None) -> Tuple[bool, str]:
        """
        Determine if document should be skipped.
        
        Returns:
            (should_skip, reason)
        """
        score = self.assess_relevance(content, url)
        
        # Only skip if high confidence irrelevant
        if not score.is_relevant and score.confidence >= self.min_confidence:
            reason = f"Irrelevant document (confidence={score.confidence:.2f}): {', '.join(score.reasons)}"
            logger.info(f"Early exit: {reason}")
            return True, reason
        
        return False, ""


# Global detector instance (enabled via env var)
_detector_instance: Optional[EarlyExitDetector] = None


def get_detector() -> Optional[EarlyExitDetector]:
    """Get global detector instance (or None if disabled)."""
    import os
    global _detector_instance
    
    if os.getenv("ENABLE_EARLY_EXIT", "false").lower() == "true":
        if _detector_instance is None:
            min_confidence = float(os.getenv("EARLY_EXIT_MIN_CONFIDENCE", "0.7"))
            _detector_instance = EarlyExitDetector(min_confidence=min_confidence)
        return _detector_instance
    
    return None
