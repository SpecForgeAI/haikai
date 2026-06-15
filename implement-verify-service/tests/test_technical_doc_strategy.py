"""
Unit tests for technical_doc_strategy.py
Tests LLM prompt generation for tech doc analysis.
"""

import pytest
from src.strategies.technical_doc_strategy import TechnicalDocAnalysisStrategy
from src.strategies.base_strategy import FileAnalysisContext


class TestTechnicalDocAnalysisStrategy:
    """Tests for TechnicalDocAnalysisStrategy."""
    
    @pytest.fixture
    def strategy(self):
        """Create strategy instance."""
        from unittest.mock import Mock; return TechnicalDocAnalysisStrategy(llm_client=Mock())
    
    @pytest.fixture
    def context(self):
        """Create analysis context."""
        return FileAnalysisContext(
            path="/staging/parsed/tech-stack.txt",
            category="technical_doc",
            standard_file="global/tech-stack.md"
        )
    
    def test_get_prompts_returns_tuple(self, strategy, context):
        """Test that get_prompts returns a tuple of 3 elements."""
        file_path = "/docs/tech-stack.pdf"
        content = "Sample technical documentation content"
        
        result = strategy.get_prompts(file_path, content, context)
        
        assert isinstance(result, tuple)
        assert len(result) == 3
    
    def test_get_prompts_system_prompt(self, strategy, context):
        """Test system prompt content."""
        file_path = "/docs/tech-stack.pdf"
        content = "Sample content"
        
        system_prompt, _, _ = strategy.get_prompts(file_path, content, context)
        
        assert "technical documentation analyst" in system_prompt.lower()
        assert "technology stack" in system_prompt.lower()
        assert "json" in system_prompt.lower()
    
    def test_get_prompts_user_prompt_includes_file_path(self, strategy, context):
        """Test that user prompt includes file path."""
        file_path = "/docs/tech-stack.pdf"
        content = "Sample content"
        
        _, user_prompt, _ = strategy.get_prompts(file_path, content, context)
        
        assert file_path in user_prompt
    
    def test_get_prompts_user_prompt_includes_content(self, strategy, context):
        """Test that user prompt includes document content."""
        file_path = "/docs/tech-stack.pdf"
        content = "We use React 18 and Django 4.2 for our stack"
        
        _, user_prompt, _ = strategy.get_prompts(file_path, content, context)
        
        assert content in user_prompt
    
    def test_get_prompts_user_prompt_has_json_structure(self, strategy, context):
        """Test that user prompt specifies expected JSON structure."""
        file_path = "/docs/tech-stack.pdf"
        content = "Sample content"
        
        _, user_prompt, _ = strategy.get_prompts(file_path, content, context)
        
        # Check for expected JSON keys
        assert "languages" in user_prompt
        assert "frameworks" in user_prompt
        assert "databases" in user_prompt
        assert "infrastructure" in user_prompt
        assert "third_party_services" in user_prompt
        assert "tools" in user_prompt
    
    def test_get_prompts_user_prompt_has_rules(self, strategy, context):
        """Test that user prompt includes extraction rules."""
        file_path = "/docs/tech-stack.pdf"
        content = "Sample content"
        
        _, user_prompt, _ = strategy.get_prompts(file_path, content, context)
        
        assert "Rules:" in user_prompt
        assert "explicitly mentioned" in user_prompt.lower()
        assert "version" in user_prompt.lower()
    
    def test_get_prompts_max_tokens(self, strategy, context):
        """Test that max_tokens is set appropriately."""
        file_path = "/docs/tech-stack.pdf"
        content = "Sample content"
        
        _, _, max_tokens = strategy.get_prompts(file_path, content, context)
        
        assert max_tokens == 4000
    
    def test_get_prompts_with_long_content(self, strategy, context):
        """Test prompts with very long content."""
        file_path = "/docs/tech-stack.pdf"
        content = "A" * 10000  # Very long content
        
        system_prompt, user_prompt, max_tokens = strategy.get_prompts(
            file_path, content, context
        )
        
        # Should still work
        assert len(system_prompt) > 0
        assert len(user_prompt) > 0
        assert content in user_prompt
    
    def test_get_prompts_with_special_characters(self, strategy, context):
        """Test prompts with special characters in content."""
        file_path = "/docs/tech-stack.pdf"
        content = "We use React >= 18.0 && TypeScript ~5.0 (with @types/node)"
        
        _, user_prompt, _ = strategy.get_prompts(file_path, content, context)
        
        # Special characters should be preserved
        assert content in user_prompt
    
    def test_get_prompts_different_file_paths(self, strategy, context):
        """Test that different file paths are reflected in prompts."""
        content = "Sample content"
        
        _, prompt1, _ = strategy.get_prompts("/docs/file1.pdf", content, context)
        _, prompt2, _ = strategy.get_prompts("/docs/file2.pdf", content, context)
        
        assert "/docs/file1.pdf" in prompt1
        assert "/docs/file2.pdf" in prompt2
        assert prompt1 != prompt2
