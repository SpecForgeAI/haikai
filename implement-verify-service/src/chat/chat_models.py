"""
Pydantic models for the conversational chat API.
"""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class ChatMessageRequest(BaseModel):
    """Request model for sending a chat message."""
    company: str = Field(..., description="Company name")
    project: str = Field(..., description="Project name")
    message: str = Field(..., description="User message to send to Claude")
    session_mode: str = Field(
        "resume",
        description="Session mode: 'resume' (default, continue existing), 'new' (create fresh session)"
    )


class ChatHistoryRequest(BaseModel):
    """Request model for retrieving chat history."""
    company: str = Field(..., description="Company name")
    project: str = Field(..., description="Project name")


class ChatClearRequest(BaseModel):
    """Request model for clearing chat history."""
    company: str = Field(..., description="Company name")
    project: str = Field(..., description="Project name")


class MessageEntry(BaseModel):
    """A single message entry in the conversation history."""
    role: str = Field(..., description="Role: 'user', 'assistant', or 'system'")
    content: Optional[str] = Field(None, description="Message content")
    timestamp: str = Field(..., description="ISO 8601 timestamp")
    event: Optional[str] = Field(None, description="Event type for system messages")
    skill: Optional[str] = Field(None, description="Skill name for skill_invoked events")
    path: Optional[str] = Field(None, description="File path for file_modified events")
    operation: Optional[str] = Field(None, description="Operation type for file_modified events")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional details")


class ChatHistoryResponse(BaseModel):
    """Response model for chat history."""
    messages: List[MessageEntry] = Field(..., description="List of messages in chronological order")


class ChatClearResponse(BaseModel):
    """Response model for clearing chat history."""
    success: bool = Field(..., description="Whether the operation was successful")
    message: str = Field(..., description="Status message")
