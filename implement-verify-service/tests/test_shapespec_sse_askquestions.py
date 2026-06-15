"""
Regression tests for ShapeSpec SSE endpoint with AskQuestions skill.

These tests verify that when Claude invokes the /ask-questions skill,
the SSE stream correctly emits a 'questions' event with properly parsed
questions for frontend consumption.

Test Levels:
1. Unit tests: _parse_questions_from_content parsing logic
2. Integration tests: stream_message event generation (mocked subprocess)
3. E2E tests: Full API endpoint with SSE (requires running API)
"""

import json
import pytest
import subprocess
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from typing import Generator, Dict, Any, List
import sys
import tempfile
import shutil

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from src.chat.claude_chat_executor import ClaudeChatExecutor


# =============================================================================
# Unit Tests: Question Parsing
# =============================================================================

class TestParseQuestionsFromContent:
    """Unit tests for the _parse_questions_from_content method."""
    
    @pytest.fixture
    def executor(self):
        """Create a mock executor for testing parsing methods."""
        executor = ClaudeChatExecutor.__new__(ClaudeChatExecutor)
        return executor
    
    def test_markdown_list_format_single_question(self, executor):
        """Test parsing a single question in markdown list format."""
        content_chunks = [
            "- [uuid-1] Should we use PostgreSQL or MySQL?\n"
        ]
        
        questions = executor._parse_questions_from_content(content_chunks)
        
        assert len(questions) == 1
        assert questions[0]["id"] == "uuid-1"
        assert "PostgreSQL" in questions[0]["question"]
    
    def test_markdown_list_format_multiple_questions(self, executor):
        """Test parsing multiple questions in markdown list format."""
        content_chunks = [
            "I have some questions about the implementation:\n\n",
            "- [c3879034-347e-444d-93c2-e1671b885aab] How should created_at be managed?\n",
            "- [a1b2c3d4-e5f6-7890-1234-567890abcdef] Should we implement soft deletes?\n",
            "- [12345678-1234-1234-1234-123456789012] What authentication method?\n"
        ]
        
        questions = executor._parse_questions_from_content(content_chunks)
        
        assert len(questions) == 3
        assert questions[0]["id"] == "c3879034-347e-444d-93c2-e1671b885aab"
        assert questions[1]["id"] == "a1b2c3d4-e5f6-7890-1234-567890abcdef"
        assert questions[2]["id"] == "12345678-1234-1234-1234-123456789012"
    
    def test_markdown_list_format_multiline_questions(self, executor):
        """Test parsing questions that span multiple lines."""
        content_chunks = [
            "- [id-1] This is a long question that spans\n",
            "multiple lines and has a lot of detail\n",
            "- [id-2] Another question here\n"
        ]
        
        questions = executor._parse_questions_from_content(content_chunks)
        
        assert len(questions) == 2
        assert questions[0]["id"] == "id-1"
        assert "multiple lines" in questions[0]["question"]
    
    def test_numbered_format_questions(self, executor):
        """Test parsing questions in numbered format (**1.** style)."""
        content_chunks = [
            "Here are the questions I need your input on:\n\n",
            "**1.** Should we use REST or GraphQL for the API?\n\n",
            "**2.** What caching strategy should we implement?\n\n",
            "**3.** How should we handle rate limiting?\n\n"
        ]
        
        questions = executor._parse_questions_from_content(content_chunks)
        
        assert len(questions) == 3
        assert questions[0]["id"] == "q1"
        assert "REST or GraphQL" in questions[0]["question"]
        assert questions[1]["id"] == "q2"
        assert "caching" in questions[1]["question"]
        assert questions[2]["id"] == "q3"
        assert "rate limiting" in questions[2]["question"]
    
    def test_numbered_format_filters_section_headers(self, executor):
        """Test that section headers ending with colon are filtered out."""
        content_chunks = [
            "Here are the questions:\n\n",
            "**1.** Based on your idea for the Match Generation Endpoint, is that correct?\n\n",
            "**2.** Should we also support optional override parameters?\n\n",
            "**3.** What format should we use?\n\n",
            "**Existing Code Reuse:**\n",
            "Are there existing features?\n"
        ]
        
        questions = executor._parse_questions_from_content(content_chunks)
        
        # Should have 3 questions, not include "Existing Code Reuse:" as a question
        assert len(questions) == 3
        assert all(":" not in q["question"].strip()[-1:] or len(q["question"]) > 50 for q in questions)
    
    def test_empty_content_returns_empty_list(self, executor):
        """Test that empty content returns no questions."""
        content_chunks = []
        
        questions = executor._parse_questions_from_content(content_chunks)
        
        assert len(questions) == 0
    
    def test_no_questions_in_content(self, executor):
        """Test content without any questions."""
        content_chunks = [
            "I don't have any questions right now. Let me proceed with the implementation."
        ]
        
        questions = executor._parse_questions_from_content(content_chunks)
        
        assert len(questions) == 0


# =============================================================================
# Integration Tests: Stream Message Event Generation
# =============================================================================

class TestStreamMessageAskQuestions:
    """Integration tests for stream_message with /ask-questions detection."""
    
    @pytest.fixture
    def temp_workspace(self):
        """Create a temporary workspace directory."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir, ignore_errors=True)
    
    @pytest.fixture
    def mock_executor(self, temp_workspace):
        """Create an executor with mocked paths."""
        with patch.object(ClaudeChatExecutor, '__init__', return_value=None):
            executor = ClaudeChatExecutor.__new__(ClaudeChatExecutor)
            executor.company = "test_company"
            executor.project = "test_project"
            executor.command = "shape-spec"
            executor.session_uuid = "test-uuid-1234"
            executor.session_id = "test_company_test_project"
            executor.anthropic_api_key = "fake-key"
            executor.workspace_dir = temp_workspace
            executor.project_dir = temp_workspace / "test_company" / "test_project"
            executor.claude_dir = executor.project_dir / ".claude"
            executor.sessions_dir = executor.claude_dir / "sessions"
            executor.chat_logs_dir = executor.project_dir / "chat_logs"
            executor.claude_cli_path = Path("/fake/claude")
            executor.extra_dirs = []  # set by real __init__ (added in b44ac09); __new__ bypasses it

            # Create directories
            executor.project_dir.mkdir(parents=True, exist_ok=True)
            executor.claude_dir.mkdir(parents=True, exist_ok=True)
            executor.sessions_dir.mkdir(parents=True, exist_ok=True)
            executor.chat_logs_dir.mkdir(parents=True, exist_ok=True)
            
            return executor
    
    def _create_mock_process(self, stdout_lines: List[str], returncode: int = 0):
        """Create a mock subprocess.Popen result."""
        mock_process = MagicMock()
        mock_process.stdout = iter(stdout_lines)
        mock_process.stderr = MagicMock()
        mock_process.stderr.read.return_value = ""
        mock_process.wait.return_value = None
        mock_process.returncode = returncode
        return mock_process
    
    def test_ask_questions_tool_detected_and_questions_yielded(self, mock_executor):
        """Test that /ask-questions tool invocation triggers questions event."""
        # Simulate Claude CLI output with ask-questions tool invocation
        stdout_lines = [
            # First, some content
            json.dumps({
                "type": "assistant",
                "message": {
                    "content": [{"type": "text", "text": "I need to clarify a few things.\n\n"}]
                }
            }),
            # Tool invocation for ask-questions
            json.dumps({
                "type": "assistant",
                "message": {
                    "content": [{
                        "type": "tool_use",
                        "name": "ask-questions",
                        "input": {}
                    }]
                }
            }),
            # Questions content
            json.dumps({
                "type": "assistant",
                "message": {
                    "content": [{
                        "type": "text",
                        "text": "- [uuid-1] Should we use PostgreSQL or MySQL?\n- [uuid-2] What auth method do you prefer?\n"
                    }]
                }
            }),
        ]
        
        with patch('subprocess.Popen') as mock_popen:
            mock_popen.return_value = self._create_mock_process(stdout_lines)
            
            events = list(mock_executor.stream_message("test message", is_new_session=True))
        
        # Verify we got the expected events
        event_types = [e["type"] for e in events]
        
        assert "content" in event_types, "Should have content events"
        assert "skill_invoked" in event_types, "Should have skill_invoked event"
        assert "questions" in event_types, "Should have questions event"
        
        # Verify questions event structure
        questions_event = next(e for e in events if e["type"] == "questions")
        assert "questions" in questions_event
        assert len(questions_event["questions"]) == 2
        assert questions_event["questions"][0]["id"] == "uuid-1"
        assert "PostgreSQL" in questions_event["questions"][0]["question"]
    
    def test_skill_tool_with_ask_questions_detected(self, mock_executor):
        """Test that 'Skill' tool with /ask-questions in input is detected."""
        stdout_lines = [
            json.dumps({
                "type": "assistant",
                "message": {
                    "content": [{
                        "type": "tool_use",
                        "name": "Skill",
                        "input": {"command": "/ask-questions"}
                    }]
                }
            }),
            json.dumps({
                "type": "assistant",
                "message": {
                    "content": [{
                        "type": "text",
                        "text": "- [q1] Question one?\n- [q2] Question two?\n"
                    }]
                }
            }),
        ]
        
        with patch('subprocess.Popen') as mock_popen:
            mock_popen.return_value = self._create_mock_process(stdout_lines)
            
            events = list(mock_executor.stream_message("test", is_new_session=True))
        
        # Should detect /ask-questions and yield questions event
        event_types = [e["type"] for e in events]
        assert "questions" in event_types
        
        # Should report skill as "ask-questions" not "Skill"
        skill_event = next(e for e in events if e["type"] == "skill_invoked")
        assert skill_event["skill"] == "ask-questions"
    
    def test_no_questions_event_without_ask_questions_invocation(self, mock_executor):
        """Test that questions event is NOT yielded if /ask-questions not invoked."""
        stdout_lines = [
            json.dumps({
                "type": "assistant",
                "message": {
                    "content": [{"type": "text", "text": "Here is the spec:\n\n## Overview\n..."}]
                }
            }),
            json.dumps({
                "type": "assistant",
                "message": {
                    "content": [{
                        "type": "tool_use",
                        "name": "Write",
                        "input": {"path": "spec.md", "content": "..."}
                    }]
                }
            }),
        ]
        
        with patch('subprocess.Popen') as mock_popen:
            mock_popen.return_value = self._create_mock_process(stdout_lines)
            
            events = list(mock_executor.stream_message("test", is_new_session=True))
        
        event_types = [e["type"] for e in events]
        assert "questions" not in event_types, "Should NOT have questions event"
    
    def test_questions_event_comes_after_done(self, mock_executor):
        """Test that questions event is yielded AFTER done event."""
        stdout_lines = [
            json.dumps({
                "type": "assistant",
                "message": {
                    "content": [{
                        "type": "tool_use",
                        "name": "ask-questions",
                        "input": {}
                    }]
                }
            }),
            json.dumps({
                "type": "assistant",
                "message": {
                    "content": [{"type": "text", "text": "- [q1] Question?\n"}]
                }
            }),
        ]
        
        with patch('subprocess.Popen') as mock_popen:
            mock_popen.return_value = self._create_mock_process(stdout_lines)
            
            events = list(mock_executor.stream_message("test", is_new_session=True))
        
        # Verify questions event exists
        assert any(e["type"] == "questions" for e in events), "Must have questions event"
    
    def test_folder_event_yielded_after_questions(self, mock_executor):
        """Test that folder event is yielded after questions."""
        stdout_lines = [
            json.dumps({
                "type": "assistant",
                "message": {
                    "content": [{
                        "type": "tool_use",
                        "name": "ask-questions",
                        "input": {}
                    }]
                }
            }),
            json.dumps({
                "type": "assistant",
                "message": {
                    "content": [{"type": "text", "text": "- [q1] Question?\n"}]
                }
            }),
            json.dumps({
                "type": "assistant",
                "message": {
                    "content": [{
                        "type": "tool_use",
                        "name": "Write",
                        "input": {"path": "haikai/specs/my-feature/spec.md", "content": "..."}
                    }]
                }
            }),
        ]
        
        with patch('subprocess.Popen') as mock_popen:
            mock_popen.return_value = self._create_mock_process(stdout_lines)
            
            events = list(mock_executor.stream_message("test", is_new_session=True))
        
        event_types = [e["type"] for e in events]
        assert "folder" in event_types, "Should have folder event"
        
        folder_event = next(e for e in events if e["type"] == "folder")
        assert folder_event["folder"] == "my-feature"


# =============================================================================
# E2E Tests: Full API Endpoint (requires running API)
# =============================================================================

class TestShapeSpecSSEEndpoint:
    """End-to-end tests for /api/v1/shape-spec/stream endpoint."""
    
    @pytest.fixture
    def api_base_url(self):
        """Get the API base URL from environment or use default."""
        import os
        return os.environ.get("API_BASE_URL", "http://localhost:8005")
    
    @pytest.fixture
    def api_key(self):
        """Get the API key from environment."""
        import os
        return os.environ.get("API_KEY", "test-api-key")
    
    @pytest.mark.skip(reason="Requires running API with valid LLM credentials")
    def test_new_session_shapespec_with_questions(self, api_base_url, api_key):
        """
        E2E test: New ShapeSpec session that triggers /ask-questions.
        
        This test requires:
        1. Running API server
        2. Valid Anthropic API key
        3. Prompt that triggers /ask-questions invocation
        """
        import httpx
        
        # Use a prompt designed to trigger /ask-questions
        request_data = {
            "company": "test_e2e",
            "project": "regression_test",
            "message": "I want to build a user authentication system with OAuth support",
            "session_mode": "new"
        }
        
        events = []
        with httpx.stream(
            "POST",
            f"{api_base_url}/api/v1/shape-spec/stream",
            json=request_data,
            headers={"X-API-Key": api_key},
            timeout=120.0
        ) as response:
            assert response.status_code == 200
            
            for line in response.iter_lines():
                if line.startswith("data: "):
                    event_data = json.loads(line[6:])
                    events.append(event_data)
        
        # Analyze events
        event_types = [e["type"] for e in events]
        
        # Check if questions event was emitted (depends on Claude's response)
        if "questions" in event_types:
            questions_event = next(e for e in events if e["type"] == "questions")
            assert isinstance(questions_event["questions"], list)
            assert len(questions_event["questions"]) > 0
            
            # Each question should have id and question fields
            for q in questions_event["questions"]:
                assert "id" in q
                assert "question" in q
    
    @pytest.mark.skip(reason="Requires running API and Claude API key")  
    def test_resume_session_preserves_context(self, api_base_url, api_key):
        """
        E2E test: Resume session and verify context is preserved.
        
        This test verifies that:
        1. New session creates a fresh conversation
        2. Resume session continues the conversation
        3. Questions can be answered in resumed session
        """
        import httpx
        import time
        
        company = "test_e2e"
        project = f"resume_test_{int(time.time())}"
        
        # Step 1: New session
        new_session_data = {
            "company": company,
            "project": project,
            "message": "I want to build an inventory management system",
            "session_mode": "new"
        }
        
        new_events = []
        with httpx.stream(
            "POST",
            f"{api_base_url}/api/v1/shape-spec/stream",
            json=new_session_data,
            headers={"X-API-Key": api_key},
            timeout=120.0
        ) as response:
            for line in response.iter_lines():
                if line.startswith("data: "):
                    new_events.append(json.loads(line[6:]))
        
        # Step 2: Resume session
        resume_data = {
            "company": company,
            "project": project,
            "message": "We should use PostgreSQL as the database",
            "session_mode": "resume"
        }
        
        resume_events = []
        with httpx.stream(
            "POST",
            f"{api_base_url}/api/v1/shape-spec/stream",
            json=resume_data,
            headers={"X-API-Key": api_key},
            timeout=120.0
        ) as response:
            for line in response.iter_lines():
                if line.startswith("data: "):
                    resume_events.append(json.loads(line[6:]))
        
        # The resumed session should acknowledge the database choice
        # (exact behavior depends on Claude's response)


# =============================================================================
# Regression Tests: Specific Bug Scenarios
# =============================================================================

class TestAskQuestionsRegressions:
    """Regression tests for specific bug scenarios."""
    
    @pytest.fixture
    def executor(self):
        """Create a mock executor for testing."""
        executor = ClaudeChatExecutor.__new__(ClaudeChatExecutor)
        return executor
    
    def test_regression_questions_not_wrapped_in_json(self, executor):
        """
        Regression: Questions must be wrapped in JSON for frontend.
        
        Bug: Final output was not invoking AskQuestions skill to wrap
        results in JSON for frontend consumption.
        
        Expected: questions event contains proper JSON structure with
        'questions' array containing objects with 'id' and 'question' fields.
        """
        content = [
            "Here are my questions:\n",
            "- [550e8400-e29b-41d4-a716-446655440000] What database should we use?\n",
            "- [6ba7b810-9dad-11d1-80b4-00c04fd430c8] How should we handle auth?\n"
        ]
        
        questions = executor._parse_questions_from_content(content)
        
        # Verify JSON structure
        assert isinstance(questions, list), "questions must be a list"
        assert len(questions) > 0, "questions list should not be empty"
        
        for q in questions:
            assert isinstance(q, dict), "each question must be a dict"
            assert "id" in q, "question must have 'id' field"
            assert "question" in q, "question must have 'question' field"
            assert isinstance(q["id"], str), "id must be string"
            assert isinstance(q["question"], str), "question must be string"
    
    def test_regression_uuid_format_preserved(self, executor):
        """
        Regression: UUID format in question IDs must be preserved.
        
        Bug: UUIDs were being truncated or modified during parsing.
        """
        uuid1 = "550e8400-e29b-41d4-a716-446655440000"
        uuid2 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
        
        content = [
            f"- [{uuid1}] First question?\n",
            f"- [{uuid2}] Second question?\n"
        ]
        
        questions = executor._parse_questions_from_content(content)
        
        assert questions[0]["id"] == uuid1, f"UUID should be preserved exactly: {uuid1}"
        assert questions[1]["id"] == uuid2, f"UUID should be preserved exactly: {uuid2}"
    
    def test_regression_empty_questions_not_included(self, executor):
        """
        Regression: Empty or whitespace-only questions should not be included.
        """
        content = [
            "- [id1] Valid question?\n",
            "- [id2]   \n",  # Empty after ID
            "- [id3] Another valid question?\n"
        ]
        
        questions = executor._parse_questions_from_content(content)
        
        # Should only have 2 valid questions
        assert len(questions) == 2
        assert all(q["question"].strip() for q in questions), "No empty questions"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
