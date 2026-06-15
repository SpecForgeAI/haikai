"""
Regression tests for PlanProduct SSE endpoint.

Tests that the /plan-product streaming endpoint correctly:
1. Loads the plan-product Haikai command template
2. Streams SSE events (content, done, questions)
3. Maintains conversation sessions
4. Generates product planning files (mission.md, roadmap.md, tech-stack.md)
"""

import json
import pytest


# Stale: the /plan-product session prefix logic now emits /explain-failure
# in the new-session retry path and varies the resume payload. Quarantine
# per fix/260504-1127-full-repo-green; needs revision against current
# claude_chat_executor session-recovery behavior.
_DRIFT_REASON = (
    "Stale: /plan-product prefix + retry behavior drifted; needs revision "
    "per fix/260504-1127-full-repo-green"
)
import subprocess
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from typing import Generator, Dict, Any, List
import sys
import tempfile
import shutil

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from chat.claude_chat_executor import ClaudeChatExecutor
from chat.openai_chat_executor import OpenAIChatExecutor


# =============================================================================
# Unit Tests: Executor Command Configuration
# =============================================================================

class TestExecutorCommandConfig:
    """Unit tests for command_name parameter in chat executors."""

    def test_claude_executor_stream_message_accepts_command_name(self):
        """stream_message should accept command_name parameter."""
        import inspect
        sig = inspect.signature(ClaudeChatExecutor.stream_message)
        assert 'command_name' in sig.parameters, "stream_message must accept 'command_name'"
        assert sig.parameters['command_name'].default == "shape-spec"

    def test_oauth_executor_stream_message_accepts_command_name(self):
        """OAuthChatExecutor.stream_message should accept command_name parameter."""
        try:
            from chat.oauth_chat_executor import OAuthChatExecutor
        except ImportError:
            pytest.skip("OAuthChatExecutor not available")

        import inspect
        sig = inspect.signature(OAuthChatExecutor.stream_message)
        assert 'command_name' in sig.parameters, "stream_message must accept 'command_name'"
        assert sig.parameters['command_name'].default == "shape-spec"


# =============================================================================
# Unit Tests: Plan Product Template Exists
# =============================================================================

class TestPlanProductTemplateFiles:
    """Verify plan-product Haikai command files exist."""

    def test_plan_product_command_exists(self):
        """Main plan-product.md command file must exist."""
        project_root = Path(__file__).parent.parent
        path = project_root / "haikai-profiles" / "default" / "commands" / "plan-product" / "single-agent" / "plan-product.md"
        assert path.exists(), f"Missing: {path}"

    def test_plan_product_phase_files_exist(self):
        """All 4 phase files for plan-product must exist."""
        project_root = Path(__file__).parent.parent
        base = project_root / "haikai-profiles" / "default" / "commands" / "plan-product" / "single-agent"

        required_files = [
            "1-product-concept.md",
            "2-create-mission.md",
            "3-create-roadmap.md",
            "4-create-tech-stack.md",
        ]
        for f in required_files:
            assert (base / f).exists(), f"Missing phase file: {f}"

    def test_plan_product_workflow_files_exist(self):
        """Workflow files referenced by plan-product phases must exist."""
        project_root = Path(__file__).parent.parent
        base = project_root / "haikai-profiles" / "default" / "workflows" / "planning"

        required_files = [
            "gather-product-info.md",
            "create-product-mission.md",
            "create-product-roadmap.md",
            "create-product-tech-stack.md",
        ]
        for f in required_files:
            assert (base / f).exists(), f"Missing workflow file: {f}"


# =============================================================================
# Integration Tests: Stream Message with Plan Product Command
# =============================================================================

class TestStreamMessagePlanProduct:
    """Integration tests for stream_message with command_name='plan-product'."""

    @pytest.fixture
    def temp_workspace(self):
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.fixture
    def mock_executor(self, temp_workspace):
        """Create a ClaudeChatExecutor with mocked internals."""
        with patch.object(ClaudeChatExecutor, '__init__', return_value=None):
            executor = ClaudeChatExecutor.__new__(ClaudeChatExecutor)
            executor.company = "test_company"
            executor.project = "test_project"
            executor.session_uuid = "test-uuid-pp-1234"
            executor.session_id = "test_company_test_project"
            executor.anthropic_api_key = "fake-key"
            executor.workspace_dir = temp_workspace
            executor.project_dir = temp_workspace / "test_company" / "test_project"
            executor.claude_dir = executor.project_dir / ".claude"
            executor.sessions_dir = executor.claude_dir / "sessions"
            executor.chat_logs_dir = executor.project_dir / "chat_logs"
            executor.claude_cli_path = Path("/fake/claude")
            executor.extra_dirs = []  # set by real __init__ (added in b44ac09); __new__ bypasses it

            executor.project_dir.mkdir(parents=True, exist_ok=True)
            executor.claude_dir.mkdir(parents=True, exist_ok=True)
            executor.sessions_dir.mkdir(parents=True, exist_ok=True)
            executor.chat_logs_dir.mkdir(parents=True, exist_ok=True)

            return executor

    def _create_mock_process(self, stdout_lines: List[str], returncode: int = 0):
        mock_process = MagicMock()
        mock_process.stdout = iter(stdout_lines)
        mock_process.stderr = MagicMock()
        mock_process.stderr.read.return_value = ""
        mock_process.wait.return_value = None
        mock_process.returncode = returncode
        return mock_process

    def test_plan_product_command_prefix_in_new_session(self, mock_executor):
        """New session with command_name=plan-product should prefix message.

        We capture the FIRST subprocess.Popen call's argv, not the last —
        the executor retries on missing `/ask-questions` invocation, and
        the retry prompt is `/explain-failure ...` which would mask the
        initial `/plan-product` prefix the test is asserting on.
        """
        first_call_args = []

        def capture_popen(cli_args, **kwargs):
            if not first_call_args:
                first_call_args.append(list(cli_args))
            return self._create_mock_process([
                json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": "Starting..."}]}})
            ])

        with patch('subprocess.Popen', side_effect=capture_popen):
            list(mock_executor.stream_message(
                "My app idea", is_new_session=True, command_name="plan-product"
            ))

        assert first_call_args, "subprocess.Popen was never called"
        prompt = first_call_args[0][-1]
        assert prompt.startswith("/plan-product "), f"Expected /plan-product prefix, got: {prompt[:50]}"

    def test_plan_product_streams_content_events(self, mock_executor):
        """Plan-product should stream content events."""
        stdout_lines = [
            json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": "Let me gather your product info.\n\n"}]}}),
            json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": "What is the core product idea?"}]}}),
        ]

        with patch('subprocess.Popen') as mock_popen:
            mock_popen.return_value = self._create_mock_process(stdout_lines)
            events = list(mock_executor.stream_message(
                "Build a task app", is_new_session=True, command_name="plan-product"
            ))

        event_types = [e["type"] for e in events]
        assert "content" in event_types

    def test_plan_product_resume_no_prefix(self, mock_executor):
        """Resumed session should NOT prefix with /plan-product.

        Capture the FIRST Popen call (see test above for retry-prompt
        rationale)."""
        first_call_args = []

        def capture_popen(cli_args, **kwargs):
            if not first_call_args:
                first_call_args.append(list(cli_args))
            return self._create_mock_process([
                json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": "Continuing..."}]}})
            ])

        with patch('subprocess.Popen', side_effect=capture_popen):
            list(mock_executor.stream_message(
                "Use React for the frontend", is_new_session=False, command_name="plan-product"
            ))

        assert first_call_args, "subprocess.Popen was never called"
        prompt = first_call_args[0][-1]
        assert not prompt.startswith("/plan-product"), f"Resume should NOT prefix, got: {prompt[:50]}"
        assert prompt == "Use React for the frontend"


# =============================================================================
# E2E Tests (require running API)
# =============================================================================

class TestPlanProductSSEEndpoint:
    """End-to-end tests for /api/v1/plan-product/stream endpoint."""

    @pytest.fixture
    def api_base_url(self):
        import os
        return os.environ.get("API_BASE_URL", "http://localhost:8000")

    @pytest.fixture
    def api_key(self):
        import os
        return os.environ.get("STANDARDS_API_KEY", "changeit")

    @pytest.mark.skip(reason="Requires running API with valid LLM credentials")
    def test_new_plan_product_session_streams_events(self, api_base_url, api_key):
        """E2E: New plan-product session should stream SSE events."""
        import httpx
        import time

        request_data = {
            "company": "e2e_test",
            "project": f"plan_product_{int(time.time())}",
            "message": "I'm building a task management app for small teams.",
            "session_mode": "new"
        }

        events = []
        with httpx.stream(
            "POST", f"{api_base_url}/api/v1/plan-product/stream",
            json=request_data,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=180.0
        ) as response:
            assert response.status_code == 200
            for line in response.iter_lines():
                if line.startswith("data: "):
                    events.append(json.loads(line[6:]))

        event_types = [e.get("type") for e in events]
        assert "content" in event_types


# =============================================================================
# Regression Tests
# =============================================================================

class TestPlanProductRegressions:
    """Regression tests for plan-product specific scenarios."""

    def test_plan_product_template_references_resolved(self):
        """Plan-product command should reference workflow files that exist."""
        project_root = Path(__file__).parent.parent
        plan_product_path = project_root / "haikai-profiles" / "default" / "commands" / "plan-product" / "single-agent" / "plan-product.md"

        content = plan_product_path.read_text()

        assert "1-product-concept" in content or "PHASE 1" in content
        assert "2-create-mission" in content or "PHASE 2" in content
        assert "3-create-roadmap" in content or "PHASE 3" in content
        assert "4-create-tech-stack" in content or "PHASE 4" in content

    def test_oauth_executor_stream_accepts_plan_product(self):
        """OAuthChatExecutor.stream_message should accept command_name='plan-product'."""
        try:
            from chat.oauth_chat_executor import OAuthChatExecutor
        except ImportError:
            pytest.skip("OAuthChatExecutor not available")

        import inspect
        sig = inspect.signature(OAuthChatExecutor.stream_message)
        assert 'command_name' in sig.parameters


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
