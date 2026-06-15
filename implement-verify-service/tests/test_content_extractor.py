"""
Unit tests for ContentExtractor class.
Tests the two-step LLM process for content filtering.
"""

import pytest
from unittest.mock import Mock, MagicMock
from src.content_extractor import ContentExtractor


class TestContentExtractor:
    """Test ContentExtractor functionality."""
    
    def test_init(self):
        """Test ContentExtractor initialization."""
        mock_llm = Mock()
        extractor = ContentExtractor(mock_llm)
        
        assert extractor.llm_client == mock_llm
    
    def test_extract_calls_both_steps(self):
        """Test that extract() calls both analyze and extract steps."""
        mock_llm = Mock()
        mock_llm.generate = MagicMock(side_effect=[
            "Analysis: Tech stack document",  # First call: analysis
            "Extracted: React, Node.js"  # Second call: extraction
        ])
        
        extractor = ContentExtractor(mock_llm)
        
        result = extractor.extract(
            parsed_content="Sample document about React and Node.js",
            use_case='tech_stack'
        )
        
        # Should call LLM twice (analyze + extract)
        assert mock_llm.generate.call_count == 2
        assert result == "Extracted: React, Node.js"
    
    def test_analyze_structure_uses_first_5000_chars(self):
        """Test that analysis only uses first 5000 chars for efficiency."""
        mock_llm = Mock()
        mock_llm.generate = MagicMock(return_value="Analysis result")
        
        extractor = ContentExtractor(mock_llm)
        
        # Create content longer than 5000 chars
        long_content = "x" * 10000
        
        analysis = extractor._analyze_structure(long_content, 'tech_stack')
        
        # Check that prompt contains truncated content
        call_args = mock_llm.generate.call_args
        messages = call_args[0][0]
        user_message = messages[1]['content']
        
        # Should contain first 5000 chars + continuation marker
        assert "xxx" in user_message  # Part of the content
        assert "document continues" in user_message.lower()
        assert len(user_message) < len(long_content)  # Truncated
    
    def test_analyze_structure_handles_short_content(self):
        """Test that short content is not truncated."""
        mock_llm = Mock()
        mock_llm.generate = MagicMock(return_value="Analysis result")
        
        extractor = ContentExtractor(mock_llm)
        
        short_content = "Short document"
        
        analysis = extractor._analyze_structure(short_content, 'tech_stack')
        
        call_args = mock_llm.generate.call_args
        messages = call_args[0][0]
        user_message = messages[1]['content']
        
        # Should contain full content
        assert short_content in user_message
        assert "document continues" not in user_message.lower()
    
    def test_extract_relevant_uses_analysis(self):
        """Test that extraction step uses analysis from first step."""
        mock_llm = Mock()
        mock_llm.generate = MagicMock(return_value="Extracted content")
        
        extractor = ContentExtractor(mock_llm)
        
        analysis = "Document type: Architecture guide"
        content = "Full document content"
        
        result = extractor._extract_relevant(content, analysis, 'tech_stack')
        
        # Check that prompt includes both analysis and content
        call_args = mock_llm.generate.call_args
        messages = call_args[0][0]
        user_message = messages[1]['content']
        
        assert analysis in user_message
        assert content in user_message
        assert 'tech_stack' in user_message
    
    def test_extract_handles_analysis_failure(self):
        """Test fallback when analysis fails."""
        mock_llm = Mock()
        mock_llm.generate = MagicMock(side_effect=Exception("LLM error"))
        
        extractor = ContentExtractor(mock_llm)
        
        content = "Sample content"
        
        # Should not raise, should return fallback analysis
        analysis = extractor._analyze_structure(content, 'tech_stack')
        
        assert 'tech_stack' in analysis.lower()
        assert 'technical documentation' in analysis.lower()
    
    def test_extract_handles_extraction_failure(self):
        """Test fallback when extraction fails."""
        mock_llm = Mock()
        mock_llm.generate = MagicMock(side_effect=Exception("LLM error"))
        
        extractor = ContentExtractor(mock_llm)
        
        content = "Sample content"
        analysis = "Analysis result"
        
        # Should return original content as fallback
        result = extractor._extract_relevant(content, analysis, 'tech_stack')
        
        assert result == content
    
    def test_extract_end_to_end_success(self):
        """Test complete extraction flow with successful LLM calls."""
        mock_llm = Mock()
        
        # Mock LLM responses
        analysis_response = """Document type: Technical architecture guide
Main topics: Backend services, databases, infrastructure
Relevant for tech_stack: Sections 2-4 about technology choices
Exclude: Marketing content in section 1"""
        
        extraction_response = """Backend: Java, Spring Boot, Node.js
Databases: PostgreSQL, Redis
Infrastructure: Docker, Kubernetes, AWS"""
        
        mock_llm.generate = MagicMock(side_effect=[
            analysis_response,
            extraction_response
        ])
        
        extractor = ContentExtractor(mock_llm)
        
        original_content = """
        Section 1: Why choose our platform (marketing)
        Section 2: Backend built with Java and Spring Boot
        Section 3: PostgreSQL for data, Redis for caching
        Section 4: Deployed on AWS with Docker and Kubernetes
        Section 5: Contact us (footer)
        """
        
        result = extractor.extract(original_content, 'tech_stack')
        
        # Should return extracted content
        assert result == extraction_response
        
        # Should have called LLM twice
        assert mock_llm.generate.call_count == 2
    
    def test_extract_with_different_use_cases(self):
        """Test that use_case parameter is properly used in prompts."""
        mock_llm = Mock()
        mock_llm.generate = MagicMock(return_value="Result")
        
        extractor = ContentExtractor(mock_llm)
        
        content = "Sample content"
        
        # Test with different use cases
        extractor.extract(content, 'tech_stack')
        extractor.extract(content, 'coding_style')
        extractor.extract(content, 'testing_rules')
        
        # Check that use_case appears in prompts
        calls = mock_llm.generate.call_args_list
        
        # First pair of calls (tech_stack)
        assert 'tech_stack' in str(calls[0])
        assert 'tech_stack' in str(calls[1])
        
        # Second pair (coding_style)
        assert 'coding_style' in str(calls[2])
        assert 'coding_style' in str(calls[3])
        
        # Third pair (testing_rules)
        assert 'testing_rules' in str(calls[4])
        assert 'testing_rules' in str(calls[5])
    
    def test_extract_reduces_content_size(self):
        """Test that extraction typically reduces content size."""
        mock_llm = Mock()
        
        # Simulate realistic extraction (removes noise)
        original_size = 10000
        extracted_size = 3000
        
        mock_llm.generate = MagicMock(side_effect=[
            "Analysis: Relevant sections are 2-4",
            "x" * extracted_size  # Extracted content (smaller)
        ])
        
        extractor = ContentExtractor(mock_llm)
        
        original_content = "x" * original_size
        result = extractor.extract(original_content, 'tech_stack')
        
        # Extracted content should be smaller
        assert len(result) < len(original_content)
        assert len(result) == extracted_size


class TestContentExtractorIntegration:
    """Integration tests for ContentExtractor with real-ish scenarios."""
    
    def test_realistic_tech_doc_extraction(self):
        """Test extraction with realistic technical document structure."""
        mock_llm = Mock()
        
        # Realistic responses
        analysis = """Document type: Company tech stack guide
Main sections: Introduction, Backend, Frontend, Infrastructure, Contact
Relevant: Backend, Frontend, Infrastructure sections
Exclude: Introduction (marketing), Contact (footer)"""
        
        extraction = """Backend:
- Language: Python 3.11
- Framework: Django 4.2
- API: Django REST Framework

Frontend:
- Framework: React 18
- State: Redux
- Styling: Tailwind CSS

Infrastructure:
- Cloud: AWS
- Containers: Docker
- Orchestration: Kubernetes"""
        
        mock_llm.generate = MagicMock(side_effect=[analysis, extraction])
        
        extractor = ContentExtractor(mock_llm)
        
        original_doc = """
        # Our Amazing Platform
        
        We're revolutionizing the industry with cutting-edge technology!
        Join thousands of happy customers today.
        
        ## Backend Architecture
        
        Our backend is built with Python 3.11 and Django 4.2.
        We use Django REST Framework for our APIs.
        
        ## Frontend Stack
        
        The frontend uses React 18 with Redux for state management.
        Styling is handled by Tailwind CSS.
        
        ## Infrastructure
        
        We deploy on AWS using Docker containers orchestrated by Kubernetes.
        
        ## Contact Us
        
        Email: sales@example.com
        Phone: 1-800-EXAMPLE
        """
        
        result = extractor.extract(original_doc, 'tech_stack')
        
        # Should extract only tech stack info
        assert 'Python' in result
        assert 'Django' in result
        assert 'React' in result
        assert 'AWS' in result
        
        # Marketing content should be filtered out
        assert 'revolutionizing' not in result.lower()
        assert 'happy customers' not in result.lower()
