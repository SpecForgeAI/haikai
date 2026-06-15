"""
LLM client wrapper around LangChain's chat models.

This provides a simple, unified interface while leveraging LangChain's:
- Battle-tested retry logic
- Accurate token counting
- 60+ LLM provider support
- Streaming capabilities
- Built-in caching
"""
import os
import json
import re
from pathlib import Path
from typing import List, Dict, Any, Optional

import logging

from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langchain_core.language_models import BaseChatModel

logger = logging.getLogger(__name__)


class _AnthropicOAuthWrapper:
    """
    Thin wrapper around the Anthropic SDK for OAuth token authentication.
    
    LangChain's ChatAnthropic only supports api_key (X-Api-Key header),
    but OAuth tokens (sk-ant-oat01-...) require Bearer auth via the
    auth_token parameter. This wrapper provides the same interface as
    LangChain's BaseChatModel.invoke() for use with LLMClient.
    
    The Anthropic SDK's auth_token parameter sends:
      Authorization: Bearer {token}
    instead of:
      X-Api-Key: {key}
    """
    
    def __init__(self, model: str, auth_token: str, max_retries: int = 3, timeout: int = 180):
        from anthropic import Anthropic
        
        beta_features = [
            "oauth-2025-04-20",
        ]
        
        default_headers = {
            "anthropic-beta": ",".join(beta_features),
        }
        
        # Remove ANTHROPIC_API_KEY from env during init to prevent
        # the SDK from auto-reading it and sending BOTH X-Api-Key
        # and Authorization: Bearer headers (which causes 401)
        saved_key = os.environ.pop("ANTHROPIC_API_KEY", None)
        try:
            self.client = Anthropic(
                auth_token=auth_token,
                max_retries=max_retries,
                timeout=timeout,
                default_headers=default_headers,
            )
        finally:
            if saved_key is not None:
                os.environ["ANTHROPIC_API_KEY"] = saved_key
        
        self.model = model
        logger.info(f"Created _AnthropicOAuthWrapper with Bearer auth (model={model})")
        self._bound_tools = None

    def bind_tools(self, tools):
        """Bind tools for native function calling, returning self for chaining."""
        # Convert OpenAI-format tool schemas to Anthropic format
        anthropic_tools = []
        for tool in tools:
            fn = tool.get("function", tool)
            anthropic_tools.append({
                "name": fn["name"],
                "description": fn.get("description", ""),
                "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
            })
        bound = _AnthropicOAuthWrapper.__new__(_AnthropicOAuthWrapper)
        bound.client = self.client
        bound.model = self.model
        bound._bound_tools = anthropic_tools
        return bound

    def _convert_messages(self, messages):
        """Convert LangChain/dict messages to Anthropic API format."""
        system_parts = []
        api_messages = []

        for msg in messages:
            if isinstance(msg, SystemMessage):
                system_parts.append(msg.content)
            elif isinstance(msg, HumanMessage):
                api_messages.append({"role": "user", "content": msg.content})
            elif isinstance(msg, AIMessage):
                # Reconstruct content blocks if this message had tool calls
                content_blocks = []
                if msg.content:
                    content_blocks.append({"type": "text", "text": msg.content})
                if hasattr(msg, "tool_calls") and msg.tool_calls:
                    for tc in msg.tool_calls:
                        content_blocks.append({
                            "type": "tool_use",
                            "id": tc.get("id", ""),
                            "name": tc["name"],
                            "input": tc.get("args", {}),
                        })
                api_messages.append({
                    "role": "assistant",
                    "content": content_blocks if content_blocks else msg.content,
                })
            elif isinstance(msg, dict):
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if role == "system":
                    system_parts.append(content)
                elif role == "tool":
                    # Tool result message
                    api_messages.append({
                        "role": "user",
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": msg.get("tool_call_id", ""),
                            "content": content,
                        }],
                    })
                elif role == "assistant" and "tool_calls" in msg:
                    # Assistant message with tool calls
                    content_blocks = []
                    if content:
                        content_blocks.append({"type": "text", "text": content})
                    for tc in msg["tool_calls"]:
                        fn = tc.get("function", tc)
                        import json as _json
                        args = fn.get("arguments", "{}")
                        if isinstance(args, str):
                            try:
                                args = _json.loads(args)
                            except _json.JSONDecodeError:
                                args = {}
                        content_blocks.append({
                            "type": "tool_use",
                            "id": tc.get("id", ""),
                            "name": fn.get("name", ""),
                            "input": args,
                        })
                    api_messages.append({"role": "assistant", "content": content_blocks})
                else:
                    api_messages.append({"role": role, "content": content})

        return system_parts, api_messages

    def invoke(self, messages, **kwargs):
        """
        Invoke the Anthropic API with Bearer auth, matching LangChain's interface.

        Accepts LangChain message objects or dicts and returns an object
        with a .content attribute (like LangChain's AIMessage).
        Supports native tool calling when tools are bound via bind_tools().
        """
        system_parts, api_messages = self._convert_messages(messages)

        create_kwargs = {
            "model": self.model,
            "messages": api_messages,
        }

        if system_parts:
            create_kwargs["system"] = "\n\n".join(system_parts)

        max_tokens = kwargs.get("max_tokens", 4096)
        create_kwargs["max_tokens"] = max_tokens

        if self._bound_tools:
            create_kwargs["tools"] = self._bound_tools

        response = self.client.messages.create(**create_kwargs)

        return _SimpleResponse(response)


class _SimpleResponse:
    """Minimal response wrapper matching LangChain's AIMessage interface.

    Handles both text-only and tool-use responses from the Anthropic API.
    """

    def __init__(self, anthropic_response):
        text_parts = []
        self.tool_calls = []

        for block in anthropic_response.content:
            if hasattr(block, "text"):
                text_parts.append(block.text)
            elif block.type == "tool_use":
                self.tool_calls.append({
                    "id": block.id,
                    "name": block.name,
                    "args": block.input,
                })

        self.content = "\n".join(text_parts) if text_parts else ""


class LLMClient:
    """
    Unified LLM client that wraps LangChain's chat models.
    
    Provides a simple API while leveraging LangChain's provider support,
    retry logic, and token counting capabilities.
    """
    
    def __init__(self, provider: str, model: str, api_key: Optional[str] = None, **kwargs):
        """
        Initialize LLM client with specified provider.
        
        Args:
            provider: Provider name ('openai', 'anthropic', 'azure', 'google', 'custom')
            model: Model name/identifier
            api_key: API key for authentication (optional, uses env vars if not provided)
            **kwargs: Provider-specific configuration:
                For OpenAI:
                    - base_url: Custom base URL (for OpenAI-compatible APIs)
                    - organization: OpenAI organization ID
                For Anthropic:
                    - No additional parameters required
                For Azure:
                    - azure_endpoint: Azure endpoint URL (required)
                    - api_version: API version (default: '2024-02-15-preview')
                    - azure_deployment: Deployment name (uses model if not specified)
                For Google:
                    - No additional parameters required
                For Custom:
                    - base_url: Custom API base URL (required)
        
        Examples:
            >>> # OpenAI
            >>> client = LLMClient('openai', 'gpt-4', api_key='sk-...')
            
            >>> # Anthropic
            >>> client = LLMClient('anthropic', 'claude-3-opus-20240229')
            
            >>> # Azure OpenAI
            >>> client = LLMClient(
            ...     'azure',
            ...     'gpt-4',
            ...     azure_endpoint='https://your-resource.openai.azure.com',
            ...     azure_deployment='gpt-4-deployment'
            ... )
            
            >>> # Google Gemini
            >>> client = LLMClient('google', 'gemini-pro')
        """
        self.provider = provider.lower().strip()
        self.model = model
        self.api_key = api_key
        # Pop log_dir from kwargs so it's not passed to the LangChain client
        self.log_dir = Path(kwargs.pop("log_dir")) if kwargs.get("log_dir") else None
        self.config = kwargs
        self.token_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "calls": 0}
        self._turn_counter = 0

        if self.log_dir:
            (self.log_dir / "turns").mkdir(parents=True, exist_ok=True)

        # Initialize the appropriate LangChain chat model
        self.llm = self._create_chat_model()
    
    def _create_chat_model(self) -> BaseChatModel:
        """Create the appropriate LangChain chat model based on provider."""
        
        if self.provider == 'openai':
            from langchain_openai import ChatOpenAI
            
            api_key = self.api_key or os.getenv('OPENAI_API_KEY')
            if not api_key:
                raise ValueError("OpenAI API key not provided. Set OPENAI_API_KEY environment variable or pass api_key parameter.")
            
            return ChatOpenAI(
                model=self.model,
                api_key=api_key,
                base_url=self.config.get('base_url'),
                organization=self.config.get('organization'),
                max_retries=self.config.get('max_retries', 3),
                timeout=self.config.get('timeout', 180)
            )
        
        elif self.provider == 'anthropic':
            api_key = self.api_key or os.getenv('ANTHROPIC_API_KEY')
            if not api_key:
                raise ValueError("Anthropic API key not provided. Set ANTHROPIC_API_KEY environment variable or pass api_key parameter.")
            
            # OAuth tokens (sk-ant-oat...) require Bearer auth via auth_token parameter.
            # LangChain's ChatAnthropic only supports api_key (X-Api-Key header),
            # so for OAuth tokens we use a direct Anthropic SDK wrapper instead.
            if "sk-ant-oat" in api_key:
                return _AnthropicOAuthWrapper(
                    model=self.model,
                    auth_token=api_key,
                    max_retries=self.config.get('max_retries', 3),
                    timeout=self.config.get('timeout', 180)
                )
            
            from langchain_anthropic import ChatAnthropic
            return ChatAnthropic(
                model=self.model,
                api_key=api_key,
                max_retries=self.config.get('max_retries', 3),
                timeout=self.config.get('timeout', 180)
            )
        
        elif self.provider == 'azure':
            from langchain_openai import AzureChatOpenAI
            
            api_key = self.api_key or os.getenv('AZURE_OPENAI_API_KEY')
            azure_endpoint = self.config.get('azure_endpoint') or os.getenv('AZURE_OPENAI_ENDPOINT')
            
            if not api_key or not azure_endpoint:
                raise ValueError("Azure OpenAI API key and endpoint not provided. Set AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT environment variables or pass as parameters.")
            
            return AzureChatOpenAI(
                azure_deployment=self.config.get('azure_deployment', self.model),
                api_key=api_key,
                azure_endpoint=azure_endpoint,
                api_version=self.config.get('api_version', '2024-02-15-preview'),
                max_retries=self.config.get('max_retries', 3),
                timeout=self.config.get('timeout', 180)
            )
        
        elif self.provider == 'google':
            from langchain_google_genai import ChatGoogleGenerativeAI
            
            api_key = self.api_key or os.getenv('GOOGLE_API_KEY')
            if not api_key:
                raise ValueError("Google API key not provided. Set GOOGLE_API_KEY environment variable or pass api_key parameter.")
            
            return ChatGoogleGenerativeAI(
                model=self.model,
                google_api_key=api_key,
                max_retries=self.config.get('max_retries', 3),
                timeout=self.config.get('timeout', 180)
            )
        
        elif self.provider == 'custom':
            from langchain_openai import ChatOpenAI

            base_url = self.config.get('base_url')
            if not base_url:
                raise ValueError("Custom provider requires 'base_url' parameter")

            api_key = self.api_key or os.getenv('CUSTOM_API_KEY', 'dummy-key')

            return ChatOpenAI(
                model=self.model,
                api_key=api_key,
                base_url=base_url,
                max_retries=self.config.get('max_retries', 3),
                timeout=self.config.get('timeout', 3600)   # 1 hour wall-cap
            )
        
        else:
            raise ValueError(
                f"Unsupported LLM provider: '{self.provider}'. "
                f"Supported providers: 'openai', 'anthropic', 'azure', 'google', 'custom'"
            )
    
    def _convert_messages(self, messages: List[Dict[str, str]]) -> List:
        """Convert message format to LangChain format.

        Handles standard roles (system, user, assistant) plus tool-call
        messages used by the native function-calling path:
        - assistant messages with ``tool_calls`` become AIMessage with
          ``tool_calls`` and ``additional_kwargs``
        - ``role: "tool"`` messages become ToolMessage
        """
        from langchain_core.messages import ToolMessage

        lc_messages = []

        for msg in messages:
            role = msg.get('role', 'user')
            content = msg.get('content', '')

            if role == 'system':
                lc_messages.append(SystemMessage(content=content))
            elif role == 'user':
                lc_messages.append(HumanMessage(content=content))
            elif role == 'assistant':
                tool_calls = msg.get('tool_calls')
                if tool_calls:
                    # Assistant message that requested tool calls
                    lc_tool_calls = []
                    for tc in tool_calls:
                        args = tc.get("function", {}).get("arguments", "{}")
                        if isinstance(args, str):
                            import json as _json
                            try:
                                args = _json.loads(args)
                            except _json.JSONDecodeError:
                                args = {}
                        lc_tool_calls.append({
                            "id": tc.get("id", ""),
                            "name": tc.get("function", {}).get("name", ""),
                            "args": args,
                        })
                    lc_messages.append(AIMessage(content=content, tool_calls=lc_tool_calls))
                else:
                    lc_messages.append(AIMessage(content=content))
            elif role == 'tool':
                lc_messages.append(ToolMessage(
                    content=content,
                    tool_call_id=msg.get('tool_call_id', ''),
                ))
            else:
                lc_messages.append(HumanMessage(content=content))

        return lc_messages
    
    def _generate_streamed_via_openai(self, messages: List[Dict[str, str]],
                                       max_tokens: Optional[int] = None,
                                       inactivity_timeout: float = 90.0,
                                       wall_timeout: float = 3600.0,
                                       **kwargs) -> str:
        """Stream a completion using the OpenAI SDK directly.

        Aborts when no chunk has arrived for `inactivity_timeout` seconds —
        much more robust than a single fixed-wall timeout for long-running
        proxy-backed Claude sessions where Claude is genuinely working but
        any single request might exceed 3 minutes.

        Used for provider='custom' or provider='openai' when the caller sets
        `stream_inactivity_timeout` in the LLMClient config.
        """
        import time
        from openai import OpenAI

        base_url = self.config.get('base_url')
        api_key = self.api_key or os.getenv('CUSTOM_API_KEY', 'dummy-key')
        client = OpenAI(api_key=api_key, base_url=base_url)

        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            # Ask OpenAI-compatible servers to emit a final usage chunk so we
            # can track tokens for streamed calls (defaults to NULL choices,
            # populated `usage` field).
            # NOTE: the local proxy at localhost:3456 does NOT currently
            # honor stream_options.include_usage — token counts will be 0
            # for streamed calls until the proxy emits the usage chunk.
            "stream_options": {"include_usage": True},
        }
        if max_tokens is not None:
            body["max_tokens"] = max_tokens

        chunks: list[str] = []
        last_chunk_time = time.time()
        wall_start = last_chunk_time
        final_usage = None

        stream = client.chat.completions.create(**body)
        try:
            for chunk in stream:
                now = time.time()
                if now - last_chunk_time > inactivity_timeout:
                    raise TimeoutError(
                        f"No tokens for {inactivity_timeout}s "
                        f"(received {len(chunks)} chunks, total wall {now - wall_start:.0f}s)"
                    )
                if now - wall_start > wall_timeout:
                    raise TimeoutError(
                        f"Wall timeout {wall_timeout}s exceeded "
                        f"(received {len(chunks)} chunks)"
                    )
                last_chunk_time = now

                # Final usage chunk has empty choices but populated usage
                if getattr(chunk, "usage", None) is not None:
                    final_usage = chunk.usage

                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                content = getattr(delta, "content", None)
                if content:
                    chunks.append(content)
        finally:
            try:
                stream.response.close()
            except Exception:
                pass

        # Update token_usage from the final chunk's usage block
        if final_usage is not None:
            try:
                self.token_usage["prompt_tokens"]     += int(getattr(final_usage, "prompt_tokens", 0) or 0)
                self.token_usage["completion_tokens"] += int(getattr(final_usage, "completion_tokens", 0) or 0)
                self.token_usage["total_tokens"]      += int(getattr(final_usage, "total_tokens", 0) or 0)
            except Exception:
                pass

        return "".join(chunks)


    def generate(self, messages: List[Dict[str, str]],
                max_tokens: Optional[int] = None,
                **kwargs) -> str:
        """
        Generate a completion from the LLM.
        
        Args:
            messages: List of message dictionaries with 'role' and 'content'
            max_tokens: Maximum tokens to generate (optional, no limit if not specified)
            **kwargs: Additional provider-specific parameters
            
        Returns:
            Generated text response
            
        Raises:
            RuntimeError: If generation fails
            
        Examples:
            >>> messages = [
            ...     {'role': 'system', 'content': 'You are a helpful assistant.'},
            ...     {'role': 'user', 'content': 'Hello!'}
            ... ]
            >>> response = client.generate(messages)
        """
        # Streaming code path: when caller (or env) set
        # `stream_inactivity_timeout`, route through OpenAI SDK streaming with
        # an inactivity-based abort. Bypasses langchain's fixed wall timeout
        # so we can wait through long Claude-CLI sessions as long as tokens
        # keep arriving.
        sit = self.config.get("stream_inactivity_timeout")
        if sit is not None and self.provider in ("custom", "openai"):
            try:
                response_text = self._generate_streamed_via_openai(
                    messages,
                    max_tokens=max_tokens,
                    inactivity_timeout=float(sit),
                    wall_timeout=float(self.config.get("stream_wall_timeout", 3600)),
                    **kwargs,
                )
                # Track usage minimally — streaming doesn't return token counts
                self.token_usage["calls"] += 1
                # _log_turn doesn't accept raw_text; skip log for streamed mode
                return response_text
            except Exception as e:
                raise RuntimeError(f"Error generating with {self.provider} (streamed): {e}")

        try:
            # (Previously logged the first 20 chars of the API key /
            # OAuth token at INFO on every call — partial-key disclosure
            # in production logs. Removed per autoresearch:debug
            # 260504-1321 finding B2-1. If you need to diagnose auth
            # routing, log only the provider name + a fingerprint hash,
            # never raw key bytes.)

            # Convert to LangChain message format
            lc_messages = self._convert_messages(messages)
            
            # Call LangChain (has built-in retry logic)
            # For reasoning models, max_completion_tokens sets a separate budget
            # for output tokens (after reasoning tokens are used)
            invoke_kwargs = {**kwargs}

            # Check if max_completion_tokens is provided (for reasoning models)
            max_completion_tokens = invoke_kwargs.pop('max_completion_tokens', None)

            if max_completion_tokens is not None:
                # Reasoning models: use max_completion_tokens
                invoke_kwargs['max_completion_tokens'] = max_completion_tokens
            elif max_tokens is not None:
                # Standard models: use max_tokens
                invoke_kwargs['max_tokens'] = max_tokens

            self._log_turn("request", messages)
            response = self.llm.invoke(lc_messages, **invoke_kwargs)
            self._log_turn("response", None, response_obj=response)

            # DEBUG: Log the full response object to understand empty responses
            logger.info(f"[LLMClient.generate] response type: {type(response)}")
            logger.info(f"[LLMClient.generate] response.content type: {type(response.content)}")
            logger.info(f"[LLMClient.generate] response.content length: {len(response.content)}")
            if hasattr(response, 'response_metadata'):
                logger.info(f"[LLMClient.generate] response_metadata: {response.response_metadata}")
            if hasattr(response, 'additional_kwargs'):
                logger.info(f"[LLMClient.generate] additional_kwargs: {response.additional_kwargs}")

            # Track token usage
            self._track_usage(response)

            return response.content
        
        except Exception as e:
            raise RuntimeError(f"Error generating with {self.provider}: {str(e)}")
    
    def generate_with_tools(
        self,
        messages: List[Dict[str, str]],
        tools: List[Dict],
        max_tokens: int = 4096,
        **kwargs,
    ) -> Dict[str, Any]:
        """Generate a response with native function/tool calling.

        Returns a dict with:
          - ``content``: text content (may be empty when tool calls present)
          - ``tool_calls``: list of dicts with ``id``, ``name``, ``arguments``
          - ``raw``: the full response object for logging

        The caller is responsible for executing tools and appending
        tool-result messages before the next turn.
        """
        try:
            lc_messages = self._convert_messages(messages)

            invoke_kwargs = {**kwargs}
            if max_tokens is not None:
                invoke_kwargs["max_tokens"] = max_tokens

            # Bind tools to the model — LangChain's ChatOpenAI handles
            # conversion to the provider's format automatically.
            model_with_tools = self.llm.bind_tools(tools)
            self._log_turn("request", messages)
            response = model_with_tools.invoke(lc_messages, **invoke_kwargs)
            self._log_turn("response", None, response_obj=response)

            # Extract tool calls from LangChain AIMessage
            tool_calls = []
            if hasattr(response, "tool_calls") and response.tool_calls:
                for tc in response.tool_calls:
                    tool_calls.append({
                        "id": tc.get("id", ""),
                        "name": tc["name"],
                        "arguments": tc["args"],
                    })

            self._track_usage(response)

            return {
                "content": response.content if isinstance(response.content, str) else "",
                "tool_calls": tool_calls,
                "raw": response,
            }

        except Exception as e:
            raise RuntimeError(f"Error generating with tools ({self.provider}): {str(e)}")

    def _track_usage(self, response):
        """Accumulate token usage from a LangChain response."""
        meta = getattr(response, "response_metadata", {})
        usage = meta.get("usage", meta.get("token_usage", {}))
        if usage:
            self.token_usage["prompt_tokens"] += usage.get("prompt_tokens", usage.get("input_tokens", 0))
            self.token_usage["completion_tokens"] += usage.get("completion_tokens", usage.get("output_tokens", 0))
            self.token_usage["total_tokens"] += usage.get("total_tokens",
                usage.get("prompt_tokens", 0) + usage.get("completion_tokens", 0))
        self.token_usage["calls"] += 1

    def _log_turn(self, kind: str, payload, response_obj=None):
        """Write request/response to log_dir/turns/NNN_{kind}.json (no truncation)."""
        if not self.log_dir:
            return
        if kind == "request":
            self._turn_counter += 1
        turn_n = self._turn_counter
        out = self.log_dir / "turns" / f"{turn_n:03d}_{kind}.json"
        try:
            if kind == "request":
                data = {"turn": turn_n, "messages": payload, "model": self.model, "provider": self.provider}
            else:
                data = {
                    "turn": turn_n,
                    "content": getattr(response_obj, "content", "") if response_obj else "",
                    "tool_calls": [
                        {"id": tc.get("id", ""), "name": tc.get("name", ""), "args": tc.get("args", {})}
                        for tc in (getattr(response_obj, "tool_calls", []) or [])
                    ],
                    "response_metadata": getattr(response_obj, "response_metadata", {}),
                    "additional_kwargs": getattr(response_obj, "additional_kwargs", {}),
                }
            with open(out, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, default=str)
        except Exception as e:
            logger.warning(f"Failed to log turn {turn_n} {kind}: {e}")

    def generate_with_retry(self, messages: List[Dict[str, str]],
                           max_retries: int = 3,
                           max_tokens: int = 4000,
                           **kwargs) -> str:
        """
        Generate with automatic retry on failure.
        
        Note: LangChain already handles retries internally, so this method
        simply calls generate(). The max_retries parameter is kept for
        API compatibility but is not used (LangChain's configured retries apply).
        
        Args:
            messages: List of message dictionaries
            max_retries: Maximum number of retry attempts (for API compatibility)
            max_tokens: Maximum tokens to generate
            **kwargs: Additional provider-specific parameters
            
        Returns:
            Generated text response
            
        Raises:
            RuntimeError: If generation fails after all retries
        """
        return self.generate(messages, max_tokens, **kwargs)
    
    def generate_structured(self, messages: List[Dict[str, str]], 
                          schema: Dict[str, Any],
                          temperature: float = 0.7,
                          max_tokens: int = 4000) -> Dict[str, Any]:
        """
        Generate structured output matching a JSON schema.
        
        Args:
            messages: List of message dictionar            messages: List of message dictionaries
            max_tokens: Maximum tokens to generate
            
        Returns:
            Parsed JSON object matching the schema
            
        Raises:
            ValueError: If response cannot be parsed as JSON
        """
        # Add schema instruction to the last message
        schema_instruction = f"\n\nPlease respond with a JSON object matching this schema:\n{json.dumps(schema, indent=2)}"
        
        if messages:
            messages_copy = messages.copy()
            messages_copy[-1] = {
                'role': messages[-1]['role'],
                'content': messages[-1]['content'] + schema_instruction
            }
        else:
            messages_copy = messages
        
        response_text = self.generate(messages_copy, max_tokens)
        
        # Try to find JSON in the response
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass
        
        # If no JSON found, try to parse the entire response
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            raise ValueError(f"Could not parse JSON from response: {response_text[:200]}...")
    
    def count_tokens(self, text: str) -> int:
        """
        Estimate token count for text.
        
        Note: LangChain provides accurate token counting via callbacks.
        This is a simple estimation for quick checks.
        
        Args:
            text: Text to count tokens for
            
        Returns:
            Estimated token count
        """
        # Simple estimation: ~4 characters per token
        # For accurate counting, use LangChain's callbacks
        return len(text) // 4
    
    def generate_json(self, system_prompt: str, user_prompt: str, max_tokens: int = 4000) -> Dict[str, Any]:
        """
        Generate a JSON response from the LLM.
        
        Args:
            system_prompt: System prompt
            user_prompt: User prompt
            max_tokens: Maximum tokens to generate
            
        Returns:
            Parsed JSON object
        """
        messages = [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': user_prompt}
        ]
        
        response_text = self.generate(messages, max_tokens)
        
        # Try to find JSON in the response
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass
        
        # If no JSON found, try to parse the entire response
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            raise ValueError(f"Could not parse JSON from response: {response_text[:200]}...")

    def truncate_to_tokens(self, text: str, max_tokens: int) -> str:
        """
        Truncate text to fit within token limit.
        
        Args:
            text: Text to truncate
            max_tokens: Maximum number of tokens
            
        Returns:
            Truncated text
        """
        estimated_tokens = self.count_tokens(text)
        
        if estimated_tokens <= max_tokens:
            return text
        
        # Calculate approximate character limit
        char_limit = max_tokens * 4
        
        # Truncate and add ellipsis
        return text[:char_limit] + "..."
    
    @property
    def provider_name(self) -> str:
        """Get the provider name for this client."""
        return self.provider
    
    @staticmethod
    def get_supported_providers() -> List[str]:
        """
        Get list of supported provider names.
        
        Returns:
            List of supported provider names
        """
        return ['openai', 'anthropic', 'azure', 'google', 'custom']
