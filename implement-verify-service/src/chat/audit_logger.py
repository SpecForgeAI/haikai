"""
Audit Logger for Conversational Chat API.

This module provides logging functionality for tracking all conversational
interactions in a JSONL (JSON Lines) format for audit and retention purposes.
"""

import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


class AuditLogger:
    """
    Logger for tracking conversational interactions in JSONL format.
    
    Each message (user or assistant) is logged as a separate JSON object
    on a new line in the messages.jsonl file.
    """
    
    def __init__(self, chat_logs_dir: Path):
        """
        Initialize the audit logger.
        
        Args:
            chat_logs_dir: Directory where chat logs will be stored
        """
        self.chat_logs_dir = chat_logs_dir
        self.messages_file = chat_logs_dir / "messages.jsonl"
        
        # Create directory if it doesn't exist
        self.chat_logs_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"Initialized AuditLogger: {self.messages_file}")
    
    def log_user_message(self, message: str) -> Dict[str, Any]:
        """
        Log a user message.
        
        Args:
            message: The user's message content
            
        Returns:
            The logged message entry
        """
        entry = {
            "role": "user",
            "content": message,
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        }
        
        self._append_entry(entry)
        return entry
    
    def log_assistant_message(self, message: str) -> Dict[str, Any]:
        """
        Log an assistant message.
        
        Args:
            message: The assistant's message content
            
        Returns:
            The logged message entry
        """
        entry = {
            "role": "assistant",
            "content": message,
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        }
        
        self._append_entry(entry)
        return entry
    
    def log_skill_invocation(self, skill_name: str, details: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Log a skill invocation event.
        
        Args:
            skill_name: Name of the skill that was invoked
            details: Optional additional details about the invocation
            
        Returns:
            The logged event entry
        """
        entry = {
            "role": "system",
            "event": "skill_invoked",
            "skill": skill_name,
            "details": details or {},
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        }
        
        self._append_entry(entry)
        return entry
    
    def log_file_modification(self, file_path: str, operation: str = "modified") -> Dict[str, Any]:
        """
        Log a file modification event.
        
        Args:
            file_path: Path to the file that was modified
            operation: Type of operation (e.g., "created", "modified", "deleted")
            
        Returns:
            The logged event entry
        """
        entry = {
            "role": "system",
            "event": "file_modified",
            "path": file_path,
            "operation": operation,
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        }
        
        self._append_entry(entry)
        return entry
    
    def log_error(self, error_message: str, details: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Log an error event.
        
        Args:
            error_message: The error message
            details: Optional additional error details
            
        Returns:
            The logged error entry
        """
        entry = {
            "role": "system",
            "event": "error",
            "message": error_message,
            "details": details or {},
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        }
        
        self._append_entry(entry)
        return entry
    
    def _append_entry(self, entry: Dict[str, Any]):
        """
        Append an entry to the messages.jsonl file.
        
        Args:
            entry: The entry to append
        """
        try:
            with open(self.messages_file, 'a', encoding='utf-8') as f:
                f.write(json.dumps(entry, ensure_ascii=False) + '\n')
        except Exception as e:
            logger.error(f"Failed to write to audit log: {e}", exc_info=True)
    
    def get_history(self) -> List[Dict[str, Any]]:
        """
        Retrieve the full conversation history.
        
        Returns:
            List of message entries in chronological order
        """
        if not self.messages_file.exists():
            return []
        
        messages = []
        try:
            with open(self.messages_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            entry = json.loads(line)
                            messages.append(entry)
                        except json.JSONDecodeError as e:
                            logger.warning(f"Failed to parse log entry: {e}")
                            continue
        except Exception as e:
            logger.error(f"Failed to read audit log: {e}", exc_info=True)
        
        return messages
    
    def clear_history(self):
        """
        Clear the conversation history by removing the messages file.
        """
        if self.messages_file.exists():
            try:
                self.messages_file.unlink()
                logger.info(f"Cleared conversation history: {self.messages_file}")
            except Exception as e:
                logger.error(f"Failed to clear conversation history: {e}", exc_info=True)
