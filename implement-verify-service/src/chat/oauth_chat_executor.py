"""
OAuth Chat Executor for Anthropic API.

This module provides a wrapper around the Anthropic Python SDK to enable
conversational, streaming interactions using OAuth tokens (sk-ant-oat01-...).

The key requirements for OAuth tokens to work with the Anthropic API:
1. Use auth_token parameter (not api_key) - sends Authorization: Bearer header
2. CRITICAL: Do NOT pass api_key at all — if the ANTHROPIC_API_KEY env var is set,
   the SDK will auto-read it and send an X-Api-Key header alongside Bearer,
   which causes a 401 "invalid x-api-key" error. Remove it from env before init.
3. Include anthropic-beta: claude-code-20250219,oauth-2025-04-20,...
4. Set user-agent: claude-cli/<version> (external, cli)
5. Set x-app: cli
6. CRITICAL: System prompt MUST be sent as structured blocks (list of dicts),
   with the Claude Code identity as the FIRST block:
   [{"type": "text", "text": "You are Claude Code...", "cache_control": {"type": "ephemeral"}}]
"""

import json
import logging
import re
import uuid
from pathlib import Path
from typing import Optional, Dict, Any, Generator, List
from datetime import datetime

from anthropic import Anthropic

from .profiles_path import HAIKAI_PROFILES_ROOT
from .tool_executor import ToolExecutor

logger = logging.getLogger(__name__)

# Claude Code version to mimic
CLAUDE_CODE_VERSION = "2.1.2"

# Required system prompt prefix for OAuth tokens
CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."


class OAuthChatExecutor:
    """
    Wrapper class for executing conversational Anthropic API calls with OAuth tokens.
    
    This class provides a streaming interface for conversational interactions
    using OAuth tokens from Claude Max/Pro subscriptions.
    """
    
    def __init__(
        self,
        company: str,
        project: str,
        workspace_dir: Path,
        anthropic_api_key: str,
        model: str = "claude-opus-4-5",
        session_uuid: Optional[str] = None,
    ):
        """
        Initialize the OAuth Chat executor.

        Args:
            company: Company name for session identification
            project: Project name for session identification
            workspace_dir: Base workspace directory
            anthropic_api_key: Anthropic OAuth token (sk-ant-oat01-...)
            model: Model to use (default: claude-opus-4-5)
            session_uuid: Optional explicit session UUID. When None, a
                deterministic v5 UUID is derived from `{company}_{project}`.
                See ClaudeChatExecutor for rationale (O3 fix).
        """
        # Defense in depth: validate company/project at the executor
        # boundary too. See claude_chat_executor.__init__ for rationale.
        from src.path_safety import safe_segment
        company = safe_segment(company, "company")
        project = safe_segment(project, "project")

        self.company = company
        self.project = project
        self.anthropic_api_key = anthropic_api_key
        self.model = model

        # session_uuid: caller-supplied (recovery) OR deterministic v5.
        session_string = f"{company}_{project}"
        self.session_uuid = session_uuid or str(uuid.uuid5(uuid.NAMESPACE_DNS, session_string))
        self.session_id = session_string
        
        # Setup workspace paths
        self.workspace_dir = workspace_dir
        self.project_dir = workspace_dir / company / project
        self.chat_logs_dir = self.project_dir / "chat_logs"
        self.conversation_file = self.project_dir / ".conversation_history.json"
        
        # Create directories
        self.project_dir.mkdir(parents=True, exist_ok=True)
        self.chat_logs_dir.mkdir(parents=True, exist_ok=True)
        
        # Detect if this is an OAuth token
        self.is_oauth_token = "sk-ant-oat" in anthropic_api_key
        
        # Create Anthropic client with OAuth-compatible headers
        self._create_client()
        
        # Load conversation history
        self.conversation_history: List[Dict[str, Any]] = self._load_conversation()
        
        # Initialize tool executor
        self.tool_executor = ToolExecutor(self.project_dir)
        
        logger.info(f"Initialized OAuthChatExecutor for {self.session_id}")
        logger.info(f"  Session UUID: {self.session_uuid}")
        logger.info(f"  OAuth token: {self.is_oauth_token}")
        logger.info(f"  Model: {self.model}")
    
    def _refresh_oauth_token(self):
        """Re-read the current OAuth token from the CLI credentials file.

        OAuth/subscription access tokens are short-lived and the Claude CLI
        rotates them; a worker that captured one at startup gets 401s once it's
        refreshed elsewhere. When CLAUDE_OAUTH_CREDENTIALS_FILE points at the
        CLI's `.credentials.json`, read the *current* token before each call so
        the worker always tracks the live token. Opt-in; no-op without the env.
        """
        import os
        path = os.environ.get("CLAUDE_OAUTH_CREDENTIALS_FILE")
        if not path or not self.is_oauth_token:
            return
        try:
            with open(path, "r", encoding="utf-8") as f:
                tok = (json.load(f).get("claudeAiOauth") or {}).get("accessToken")
            if tok and tok != self.anthropic_api_key:
                self.anthropic_api_key = tok
                logger.info("Refreshed OAuth token from credentials file")
        except Exception as e:
            logger.warning(f"OAuth token refresh failed (using existing): {e}")

    def _create_client(self):
        """Create Anthropic client with OAuth-compatible headers.

        CRITICAL: For OAuth tokens, we must prevent the SDK from reading
        ANTHROPIC_API_KEY from the environment, otherwise it sends BOTH
        X-Api-Key and Authorization: Bearer headers, causing auth failures.
        """
        import os
        self._refresh_oauth_token()

        beta_features = [
            "claude-code-20250219",
            "oauth-2025-04-20",
            "fine-grained-tool-streaming-2025-05-14",
            "interleaved-thinking-2025-05-14"
        ]
        
        default_headers = {
            "accept": "application/json",
            "anthropic-dangerous-direct-browser-access": "true",
            "anthropic-beta": ",".join(beta_features),
            "user-agent": f"claude-cli/{CLAUDE_CODE_VERSION} (external, cli)",
            "x-app": "cli",
        }
        
        if self.is_oauth_token:
            # Temporarily remove ANTHROPIC_API_KEY from env to prevent SDK
            # from auto-reading it and sending X-Api-Key alongside Bearer
            saved_key = os.environ.pop("ANTHROPIC_API_KEY", None)
            try:
                self.client = Anthropic(
                    auth_token=self.anthropic_api_key,
                    default_headers=default_headers,
                )
            finally:
                # Restore env var for other code that might need it
                if saved_key is not None:
                    os.environ["ANTHROPIC_API_KEY"] = saved_key
            logger.info("Created Anthropic client with OAuth token (Bearer auth)")
        else:
            # Regular API keys use api_key parameter
            self.client = Anthropic(
                api_key=self.anthropic_api_key,
                default_headers=default_headers,
            )
            logger.info("Created Anthropic client with API key")
    
    def _load_conversation(self) -> List[Dict[str, Any]]:
        """Load conversation history from file."""
        if self.conversation_file.exists():
            try:
                with open(self.conversation_file, 'r') as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Failed to load conversation history: {e}")
        return []
    
    def _save_conversation(self):
        """Save conversation history to file."""
        try:
            with open(self.conversation_file, 'w') as f:
                json.dump(self.conversation_history, f, indent=2)
        except Exception as e:
            logger.warning(f"Failed to save conversation history: {e}")
    
    def _resolve_template(self, content: str, depth: int = 0) -> str:
        """Delegate to the shared resolver (see `src/chat/template_resolver.py`).

        The OAuth executor doesn't receive `profiles_dir` from callers,
        so we compute it from the repo layout.
        """
        from .template_resolver import resolve_template  # lazy
        profiles_dir = HAIKAI_PROFILES_ROOT / "default"
        return resolve_template(content, profiles_dir, depth)
    
    def _build_system_blocks(self, command_name: str = "shape-spec") -> list:
        """
        Build the system prompt as structured blocks with compiled templates.
        
        For OAuth tokens, the Claude Code identity MUST be the first block.
        Unlike the CLI executor which has built-in template resolution,
        the OAuth executor must compile all {{...}} references into the
        system prompt directly.
        
        Returns:
            List of system prompt blocks for the messages API.
        """
        profiles_dir = HAIKAI_PROFILES_ROOT / "default"

        # Load and compile command template (resolving all template refs)
        command_path = profiles_dir / "commands" / command_name / "single-agent" / f"{command_name}.md"
        command_content = ""
        if command_path.exists():
            try:
                raw = command_path.read_text(encoding='utf-8')
                command_content = self._resolve_template(raw)
                logger.info(f"Compiled {command_name} template: {len(raw)} -> {len(command_content)} chars")
            except Exception as e:
                logger.warning(f"Failed to compile {command_name} command: {e}")
        
        # Load the /ask-questions skill description
        ask_questions_path = profiles_dir / "commands" / "ask-questions" / "single-agent" / "ask-questions.md"
        ask_questions_content = ""
        if ask_questions_path.exists():
            try:
                ask_questions_content = ask_questions_path.read_text(encoding='utf-8')
            except Exception as e:
                logger.warning(f"Failed to load ask-questions skill: {e}")
        
        # Build system blocks — Claude Code identity MUST be first
        blocks = [
            {
                "type": "text",
                "text": CLAUDE_CODE_IDENTITY,
                "cache_control": {"type": "ephemeral"},
            }
        ]
        
        if command_content:
            blocks.append({
                "type": "text",
                "text": command_content,
                "cache_control": {"type": "ephemeral"},
            })
        
        if ask_questions_content:
            blocks.append({
                "type": "text",
                "text": f"## Available Skill: /ask-questions\n\n{ask_questions_content}",
                "cache_control": {"type": "ephemeral"},
            })
        
        return blocks
    
    def stream_message(
        self,
        message: str,
        is_new_session: bool = False,
        command_name: str = "shape-spec"
    ) -> Generator[Dict[str, Any], None, None]:
        """
        Stream a message to Claude and yield response chunks.
        
        Args:
            message: User message to send to Claude
            is_new_session: If True, start fresh conversation
            
        Yields:
            Dictionary events with structure:
                {"type": "content", "delta": str}
                {"type": "skill_invoked", "skill": str}
                {"type": "error", "message": str}
                {"type": "questions", "questions": list}
                {"type": "folder", "folder": str}
        """
        start_time = datetime.now()
        
        # Clear history for new sessions
        if is_new_session:
            self.conversation_history = []
            self._save_conversation()
            logger.info("Started new session - cleared conversation history")
        
        # Buffers for post-processing
        questions_buffer = []
        folder_buffer = None
        ask_questions_content = []
        is_collecting_questions = False
        full_response = ""
        
        # Automatically log the workflow for new sessions
        if is_new_session:
            # Note: We don't actually prefix because we're using direct API
            # The command behavior is embedded in the system prompt
            logger.info(f"New session: {command_name} workflow enabled via system prompt")
        
        # Add user message to history
        self.conversation_history.append({
            "role": "user",
            "content": message
        })
        
        try:
            # Build system blocks (structured format required for OAuth)
            system_blocks = self._build_system_blocks(command_name=command_name)
            
            # Tool calling loop - continue until no more tools
            while True:
                # Refresh the client so each call uses the live OAuth token
                # (no-op unless CLAUDE_OAUTH_CREDENTIALS_FILE is set).
                self._create_client()
                # Create streaming message with tools
                with self.client.messages.stream(
                    model=self.model,
                    max_tokens=8192,
                    system=system_blocks,
                    messages=self.conversation_history,
                    tools=self.tool_executor.get_tool_schemas(),
                ) as stream:
                    # Stream text content
                    for text in stream.text_stream:
                        full_response += text
                        
                        # Check for /ask-questions invocation in response
                        if "/ask-questions" in text or "ask-questions" in text:
                            is_collecting_questions = True
                            logger.info("Detected /ask-questions in response")
                        
                        # Detect folder from haikai/specs/ references
                        if not folder_buffer and "haikai/specs/" in text:
                            match = re.search(r'haikai/specs/([^/\s`]+)', text)
                            if match:
                                folder_buffer = match.group(1)
                                logger.info(f"Detected spec folder: {folder_buffer}")
                        
                        # If collecting questions, buffer content
                        if is_collecting_questions:
                            ask_questions_content.append(text)
                        
                        yield {"type": "content", "delta": text}
                    
                    # Get final message to check for tool calls
                    final_message = stream.get_final_message()
                
                # Build assistant content from final message
                assistant_content = []
                tool_uses = []
                
                for block in final_message.content:
                    if block.type == "text":
                        assistant_content.append({
                            "type": "text",
                            "text": block.text
                        })
                    elif block.type == "tool_use":
                        assistant_content.append({
                            "type": "tool_use",
                            "id": block.id,
                            "name": block.name,
                            "input": block.input
                        })
                        tool_uses.append(block)
                
                # Add assistant response to history
                self.conversation_history.append({
                    "role": "assistant",
                    "content": assistant_content
                })
                self._save_conversation()
                
                # If no tool uses, we're done
                if not tool_uses:
                    break
                
                # Execute tools
                logger.info(f"Executing {len(tool_uses)} tool calls...")
                tool_results = []
                
                for tool_use in tool_uses:
                    # Execute the tool
                    result_content = self.tool_executor.execute_tool(
                        tool_use.name,
                        tool_use.input
                    )
                    
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use.id,
                        "content": result_content
                    })
                    
                    # Yield events
                    if tool_use.name == "write_to_file":
                        yield {
                            "type": "file_modified",
                            "path": tool_use.input.get("path", "")
                        }
                    
                    yield {
                        "type": "skill_invoked",
                        "skill": tool_use.name
                    }
                
                # Add tool results to conversation
                self.conversation_history.append({
                    "role": "user",
                    "content": tool_results
                })
                self._save_conversation()
                
                # Continue loop to get Claude's response to tool results
                full_response = ""
            
            end_time = datetime.now()
            execution_time = (end_time - start_time).total_seconds()
            logger.info(f"Message completed in {execution_time:.2f}s")
            
            # Parse questions from response if /ask-questions was detected
            if ask_questions_content:
                questions_buffer = self._parse_questions_from_content(ask_questions_content)
                if questions_buffer:
                    logger.info(f"Parsed {len(questions_buffer)} questions")
            
            # Yield questions event
            if questions_buffer:
                yield {"type": "questions", "questions": questions_buffer}
            
            # Yield folder event
            if folder_buffer:
                yield {"type": "folder", "folder": folder_buffer}
                
        except Exception as e:
            error_msg = f"Error streaming message: {str(e)}"
            logger.error(error_msg, exc_info=True)
            yield {"type": "error", "message": error_msg}
    
    def get_session_file(self) -> Path:
        """Get the path to the conversation history file."""
        return self.conversation_file
    
    def clear_session(self) -> bool:
        """Clear the conversation session."""
        try:
            self.conversation_history = []
            if self.conversation_file.exists():
                self.conversation_file.unlink()
            logger.info(f"Cleared session for {self.session_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to clear session: {e}")
            return False
    
    def _parse_questions_from_content(self, content_chunks: list) -> list:
        """Parse questions from buffered /ask-questions content.

        Delegates to :mod:`src.chat.question_parser` — see that module for
        pattern details. Kept as an instance method so existing callers
        and polymorphic dispatch keep working.
        """
        from src.chat.question_parser import parse_questions

        return parse_questions(content_chunks)

    def persist_session_to_spec(self, spec_name: str) -> None:
        """No-op: OAuth executor doesn't track resumable session state.

        Required by `ChatExecutorProtocol` so polymorphic callers
        (e.g., `api/__init__.py` shape-spec, orchestrator) don't
        `AttributeError` when this backend is active. The OAuth
        executor talks to the Anthropic API directly and persists
        conversation history via `_save_conversation`, not via a
        session id pinned to a spec.
        """
        logger.debug(
            "persist_session_to_spec called on OAuthChatExecutor (no-op); "
            "spec_name=%s", spec_name,
        )

    def restore_session_from_spec(self) -> Optional[str]:
        """No-op: OAuth executor has no spec-scoped session to restore.

        Returns None so callers that branch on the result skip the
        resume path. See `persist_session_to_spec` for rationale.
        """
        logger.debug("restore_session_from_spec called on OAuthChatExecutor (no-op)")
        return None
