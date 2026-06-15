"""
Tests for OAuth token support in LLMClient.

Verifies that:
1. OAuth tokens (sk-ant-oat01-...) route to _AnthropicOAuthWrapper
2. Regular API keys still route to LangChain's ChatAnthropic
3. The OAuth wrapper sends Bearer auth (not X-Api-Key)
4. The OAuth wrapper implements the same interface as LangChain models
5. Factory routing in create_chat_executor works for all executor types
"""
import os
import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path


# Stale: _AnthropicOAuthWrapper.invoke return shape and message-conversion
# pathway have drifted (return now wraps content in {"content": [{...}]}
# blocks; LangChain BaseMessage attr access changed). Quarantine per
# fix/260504-1127-full-repo-green; needs revision against current wrapper.
_DRIFT_REASON = (
    "Stale: OAuth wrapper invoke shape + message-conversion drift; "
    "needs revision per fix/260504-1127-full-repo-green"
)


class TestLLMClientOAuthRouting:
    """Test that LLMClient routes OAuth tokens correctly."""

    def test_oauth_token_uses_wrapper(self):
        """OAuth tokens should route to _AnthropicOAuthWrapper, not ChatAnthropic."""
        from src.llm_client import LLMClient, _AnthropicOAuthWrapper
        
        client = LLMClient(
            'anthropic',
            'claude-haiku-4-5-20251001',
            api_key='sk-ant-oat01-test-token-12345'
        )
        assert isinstance(client.llm, _AnthropicOAuthWrapper)

    def test_regular_api_key_uses_langchain(self):
        """Regular API keys should route to LangChain's ChatAnthropic."""
        from src.llm_client import LLMClient
        from langchain_anthropic import ChatAnthropic
        
        client = LLMClient(
            'anthropic',
            'claude-haiku-4-5-20251001',
            api_key='sk-ant-api03-regular-key-12345'
        )
        assert isinstance(client.llm, ChatAnthropic)

    def test_oauth_wrapper_sends_bearer_auth(self):
        """OAuth wrapper should send Authorization: Bearer header."""
        from src.llm_client import _AnthropicOAuthWrapper
        
        wrapper = _AnthropicOAuthWrapper(
            model='claude-haiku-4-5-20251001',
            auth_token='sk-ant-oat01-test-token-12345'
        )
        headers = wrapper.client.auth_headers
        assert 'Authorization' in headers
        assert headers['Authorization'] == 'Bearer sk-ant-oat01-test-token-12345'

    def test_oauth_wrapper_no_x_api_key(self):
        """OAuth wrapper should NOT send X-Api-Key header."""
        from src.llm_client import _AnthropicOAuthWrapper
        
        wrapper = _AnthropicOAuthWrapper(
            model='claude-haiku-4-5-20251001',
            auth_token='sk-ant-oat01-test-token-12345'
        )
        headers = wrapper.client.auth_headers
        assert 'X-Api-Key' not in headers

    def test_oauth_wrapper_env_isolation(self):
        """OAuth wrapper should not leak ANTHROPIC_API_KEY removal into env."""
        from src.llm_client import _AnthropicOAuthWrapper
        
        os.environ['ANTHROPIC_API_KEY'] = 'sk-ant-api03-env-key'
        try:
            wrapper = _AnthropicOAuthWrapper(
                model='claude-haiku-4-5-20251001',
                auth_token='sk-ant-oat01-test-token-12345'
            )
            # Env var should be restored after init
            assert os.environ.get('ANTHROPIC_API_KEY') == 'sk-ant-api03-env-key'
            # But wrapper should only have Bearer auth
            assert 'X-Api-Key' not in wrapper.client.auth_headers
        finally:
            del os.environ['ANTHROPIC_API_KEY']

    def test_oauth_wrapper_includes_beta_header(self):
        """OAuth wrapper should include oauth-2025-04-20 beta header."""
        from src.llm_client import _AnthropicOAuthWrapper
        
        wrapper = _AnthropicOAuthWrapper(
            model='claude-haiku-4-5-20251001',
            auth_token='sk-ant-oat01-test-token-12345'
        )
        # Check default_headers on the client
        default_headers = wrapper.client._custom_headers
        # The anthropic-beta header should contain oauth-2025-04-20
        beta = default_headers.get('anthropic-beta', '')
        assert 'oauth-2025-04-20' in beta


class TestOAuthWrapperInterface:
    """Test that _AnthropicOAuthWrapper matches the LangChain interface."""

    def test_invoke_method_exists(self):
        """Wrapper must have invoke() method like LangChain models."""
        from src.llm_client import _AnthropicOAuthWrapper
        
        wrapper = _AnthropicOAuthWrapper(
            model='claude-haiku-4-5-20251001',
            auth_token='sk-ant-oat01-test'
        )
        assert hasattr(wrapper, 'invoke')
        assert callable(wrapper.invoke)

    @patch('anthropic.Anthropic')
    def test_invoke_converts_langchain_messages(self, mock_anthropic_cls):
        """invoke() should convert LangChain messages to Anthropic format."""
        from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
        from src.llm_client import _AnthropicOAuthWrapper
        
        # Setup mock
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_block = MagicMock()
        mock_block.text = "Hello!"
        mock_response.content = [mock_block]
        mock_client.messages.create.return_value = mock_response
        mock_client.auth_headers = {'Authorization': 'Bearer test'}
        mock_anthropic_cls.return_value = mock_client
        
        wrapper = _AnthropicOAuthWrapper(
            model='claude-haiku-4-5-20251001',
            auth_token='sk-ant-oat01-test'
        )
        wrapper.client = mock_client
        
        messages = [
            SystemMessage(content="You are helpful."),
            HumanMessage(content="Hi!"),
            AIMessage(content="Hello!"),
            HumanMessage(content="How are you?"),
        ]
        
        result = wrapper.invoke(messages)
        
        # Verify the call. The current _convert_messages emits content as
        # a list of typed blocks (`[{"text": ..., "type": "text"}]`) for
        # assistant messages — Anthropic API accepts both string and
        # block-list forms; the wrapper standardised on blocks.
        call_kwargs = mock_client.messages.create.call_args[1]
        assert call_kwargs['model'] == 'claude-haiku-4-5-20251001'
        assert call_kwargs['system'] == "You are helpful."
        assert len(call_kwargs['messages']) == 3
        # Inspect each message — accept either string or typed-block content
        def _content(msg):
            c = msg["content"]
            if isinstance(c, list):
                return "".join(b.get("text", "") for b in c if b.get("type") == "text")
            return c
        assert call_kwargs['messages'][0]['role'] == "user"
        assert _content(call_kwargs['messages'][0]) == "Hi!"
        assert call_kwargs['messages'][1]['role'] == "assistant"
        assert _content(call_kwargs['messages'][1]) == "Hello!"
        assert call_kwargs['messages'][2]['role'] == "user"
        assert _content(call_kwargs['messages'][2]) == "How are you?"
        assert result.content == "Hello!"


class TestSimpleResponse:
    """Test the _SimpleResponse wrapper."""

    def test_single_text_block(self):
        """Should extract text from single content block."""
        from src.llm_client import _SimpleResponse
        
        mock_response = MagicMock()
        mock_block = MagicMock()
        mock_block.text = "Test response"
        mock_response.content = [mock_block]
        
        result = _SimpleResponse(mock_response)
        assert result.content == "Test response"

    def test_multiple_text_blocks(self):
        """Should join multiple text blocks."""
        from src.llm_client import _SimpleResponse
        
        mock_response = MagicMock()
        block1 = MagicMock()
        block1.text = "Part 1"
        block2 = MagicMock()
        block2.text = "Part 2"
        mock_response.content = [block1, block2]
        
        result = _SimpleResponse(mock_response)
        assert result.content == "Part 1\nPart 2"

    def test_non_text_blocks_ignored(self):
        """Should ignore non-text blocks. The current _SimpleResponse
        treats blocks via `hasattr(block, 'text')` and `block.type ==
        'tool_use'`. A tool_use block lacks `.text` but has `.type`."""
        from src.llm_client import _SimpleResponse

        mock_response = MagicMock()
        text_block = MagicMock(spec=["text"])
        text_block.text = "Hello"
        # Tool-use block: has .type, .id, .name, .input — no .text
        tool_block = MagicMock(spec=["type", "id", "name", "input"])
        tool_block.type = "tool_use"
        tool_block.id = "tool_1"
        tool_block.name = "calculator"
        tool_block.input = {"x": 1}
        mock_response.content = [text_block, tool_block]

        result = _SimpleResponse(mock_response)
        # Text content is the text block only — tool_use is captured
        # separately on .tool_calls.
        assert result.content == "Hello"
        assert len(result.tool_calls) == 1
        assert result.tool_calls[0]["name"] == "calculator"


class TestChatExecutorFactory:
    """Test that create_chat_executor routes correctly."""

    def test_oauth_token_routes_to_oauth_executor(self):
        """OAuth tokens should create OAuthChatExecutor."""
        from src.chat.oauth_chat_executor import OAuthChatExecutor
        import tempfile
        
        with tempfile.TemporaryDirectory() as tmpdir:
            executor = OAuthChatExecutor(
                company="test",
                project="test",
                workspace_dir=Path(tmpdir),
                anthropic_api_key="sk-ant-oat01-test-token"
            )
            assert isinstance(executor, OAuthChatExecutor)
            assert executor.is_oauth_token is True

    def test_oauth_executor_uses_bearer_auth(self):
        """OAuthChatExecutor should use Bearer auth."""
        from src.chat.oauth_chat_executor import OAuthChatExecutor
        import tempfile
        
        with tempfile.TemporaryDirectory() as tmpdir:
            executor = OAuthChatExecutor(
                company="test",
                project="test",
                workspace_dir=Path(tmpdir),
                anthropic_api_key="sk-ant-oat01-test-token"
            )
            headers = executor.client.auth_headers
            assert 'Authorization' in headers
            assert headers['Authorization'] == 'Bearer sk-ant-oat01-test-token'
            assert 'X-Api-Key' not in headers
