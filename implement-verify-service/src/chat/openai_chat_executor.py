"""
OpenAI Chat Executor for ShapeSpec conversations.

Uses OpenAI's API as a fallback when Anthropic credentials aren't available.
Maintains the same interface as OAuthChatExecutor and ClaudeChatExecutor.
"""

import json
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Optional, Dict, Any, Generator, List
from datetime import datetime

import httpx

from .profiles_path import HAIKAI_PROFILES_ROOT

logger = logging.getLogger(__name__)


class OpenAIChatExecutor:
    """
    Wrapper class for executing conversational OpenAI API calls.
    
    Provides the same streaming interface as other chat executors
    but uses OpenAI's API (GPT-4, etc.) as the backend.
    """
    
    def __init__(
        self,
        company: str,
        project: str,
        workspace_dir: Path,
        openai_api_key: str,
        model: str,  # Required, no default
        session_uuid: Optional[str] = None,
        base_url: Optional[str] = None,
    ):
        """
        See ClaudeChatExecutor.__init__ for the `session_uuid` rationale (O3 fix).

        `base_url` (keyword-only-by-convention) overrides the OpenAI endpoint
        host so callers can route through an OpenAI-compatible proxy
        (e.g. a local Claude-via-OpenAI shim). When None, falls back to
        ``OPENAI_BASE_URL`` env, then to ``https://api.openai.com``. The
        ``/v1/chat/completions`` path is appended in ``stream_message``.
        """
        # Defense in depth: validate company/project at the executor
        # boundary too. See claude_chat_executor.__init__ for rationale.
        from src.path_safety import safe_segment
        company = safe_segment(company, "company")
        project = safe_segment(project, "project")

        self.company = company
        self.project = project
        self.openai_api_key = openai_api_key
        self.model = model
        self.base_url = (
            base_url
            or os.getenv("OPENAI_BASE_URL")
            or "https://api.openai.com"
        ).rstrip("/")

        session_string = f"{company}_{project}"
        self.session_uuid = session_uuid or str(uuid.uuid5(uuid.NAMESPACE_DNS, session_string))
        self.session_id = session_string
        
        self.workspace_dir = workspace_dir
        self.project_dir = workspace_dir / company / project
        self.chat_logs_dir = self.project_dir / "chat_logs"
        self.conversation_file = self.project_dir / ".conversation_history.json"
        
        self.project_dir.mkdir(parents=True, exist_ok=True)
        self.chat_logs_dir.mkdir(parents=True, exist_ok=True)
        
        self.conversation_history: List[Dict[str, Any]] = self._load_conversation()
        
        logger.info(f"Initialized OpenAIChatExecutor for {self.session_id}, model={self.model}")
    
    def _load_conversation(self) -> List[Dict[str, Any]]:
        if self.conversation_file.exists():
            try:
                with open(self.conversation_file, 'r') as f:
                    return json.load(f)
            except Exception:
                pass
        return []
    
    def _save_conversation(self):
        try:
            with open(self.conversation_file, 'w') as f:
                json.dump(self.conversation_history, f, indent=2)
        except Exception as e:
            logger.warning(f"Failed to save conversation: {e}")
    
    def _build_system_prompt(self) -> str:
        # Sibling executors (claude, oauth, kiro) all expand `{{PHASE N: @...}}`
        # template placeholders via `template_resolver.resolve_template` before
        # handing the command file to the LLM. Without expansion the LLM
        # receives literal `{{PHASE 1: @haikai/...}}` tokens, has no idea
        # what they reference, and either rambles or hangs. See
        # claude_chat_executor._setup_commands and ENABLING_KIRO_CLI.md.
        from .template_resolver import resolve_template
        profiles_dir = HAIKAI_PROFILES_ROOT / "default"
        shape_spec_path = profiles_dir / "commands" / "shape-spec" / "single-agent" / "shape-spec.md"

        system_parts = ["You are a software architect specializing in creating detailed specifications."]

        if shape_spec_path.exists():
            try:
                raw = shape_spec_path.read_text(encoding='utf-8')
                system_parts.append("\n\n" + resolve_template(raw, profiles_dir))
            except Exception as e:
                logger.warning(f"Failed to load/resolve shape-spec.md system prompt: {e}")

        return "\n".join(system_parts)
    
    def stream_message(
        self,
        message: str,
        is_new_session: bool = False,
        command_name: str = "shape-spec"
    ) -> Generator[Dict[str, Any], None, None]:
        start_time = datetime.now()
        
        if is_new_session:
            self.conversation_history = []
            self._save_conversation()
        
        ask_questions_content = []
        is_collecting_questions = False
        folder_buffer = None
        full_response = ""
        
        self.conversation_history.append({
            "role": "user",
            "content": message
        })
        
        try:
            system_prompt = self._build_system_prompt()
            
            messages = [{"role": "system", "content": system_prompt}]
            messages.extend(self.conversation_history)
            
            url = f"{self.base_url}/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {self.openai_api_key}",
                "Content-Type": "application/json",
            }
            body = {
                "model": self.model,
                "messages": messages,
                "max_completion_tokens": 16384,
                "stream": True,
            }
            
            with httpx.Client(timeout=120.0) as client:
                with client.stream("POST", url, json=body, headers=headers) as response:
                    response.raise_for_status()
                    
                    for line in response.iter_lines():
                        if not line.startswith("data: "):
                            continue
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        
                        try:
                            chunk = json.loads(data)
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            text = delta.get("content", "")
                            
                            if text:
                                full_response += text
                                
                                if "/ask-questions" in text or "ask-questions" in text:
                                    is_collecting_questions = True
                                
                                if not folder_buffer and "haikai/specs/" in text:
                                    match = re.search(r'haikai/specs/([^/\s`]+)', text)
                                    if match:
                                        folder_buffer = match.group(1)
                                
                                if is_collecting_questions:
                                    ask_questions_content.append(text)
                                
                                yield {"type": "content", "delta": text}
                        except json.JSONDecodeError:
                            continue
            
            self.conversation_history.append({
                "role": "assistant",
                "content": full_response
            })
            self._save_conversation()
            
            if ask_questions_content:
                questions = self._parse_questions_from_content(ask_questions_content)
                if questions:
                    yield {"type": "questions", "questions": questions}
            
            if folder_buffer:
                yield {"type": "folder", "folder": folder_buffer}
                
        except Exception as e:
            logger.error(f"Error streaming message: {e}", exc_info=True)
            yield {"type": "error", "message": str(e)}
    
    def get_session_file(self) -> Path:
        return self.conversation_file
    
    def clear_session(self) -> bool:
        try:
            self.conversation_history = []
            if self.conversation_file.exists():
                self.conversation_file.unlink()
            return True
        except Exception:
            return False
    
    def _parse_questions_from_content(self, content_chunks: list) -> list:
        """Parse questions from buffered /ask-questions content.

        Delegates to :mod:`src.chat.question_parser` — see that module for
        pattern details. Prior to this delegation the OpenAI executor was
        missing Pattern 2 (colon-separated IDs — the format the CLI Skill
        tool emits), so `/ask-questions` returned an empty list silently
        on the OpenAI backend.
        """
        from src.chat.question_parser import parse_questions

        return parse_questions(content_chunks)

    def persist_session_to_spec(self, spec_name: str) -> None:
        """No-op: OpenAI executor doesn't track resumable session state.

        Required by `ChatExecutorProtocol` so polymorphic callers
        (e.g., `api/__init__.py` shape-spec, orchestrator) don't
        `AttributeError` when this backend is active. OpenAI talks to
        the chat-completions API directly; conversation history is
        persisted via `_save_conversation`, not a spec-scoped session.
        """
        logger.debug(
            "persist_session_to_spec called on OpenAIChatExecutor (no-op); "
            "spec_name=%s", spec_name,
        )

    def restore_session_from_spec(self) -> Optional[str]:
        """No-op: OpenAI executor has no spec-scoped session to restore.

        Returns None so callers that branch on the result skip the
        resume path. See `persist_session_to_spec` for rationale.
        """
        logger.debug("restore_session_from_spec called on OpenAIChatExecutor (no-op)")
        return None
