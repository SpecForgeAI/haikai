"""API endpoints for chat session memory.

Provides REST endpoints for listing sessions, viewing history,
resuming sessions, managing preferences, and deleting sessions.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.chat.memory_middleware import ChatMemoryMiddleware

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/chat", tags=["chat-memory"])


# --- Request/Response models ---

class SessionListRequest(BaseModel):
    company: str
    project: str


class SessionHistoryRequest(BaseModel):
    limit: int = Field(50, ge=1, le=500)


class ResumeSessionRequest(BaseModel):
    company: str
    project: str
    user_id: str = ""


class PreferenceSetRequest(BaseModel):
    company: str
    project: str
    category: str
    key: str
    value: str
    user_id: str = ""


# --- Endpoints ---

@router.get("/sessions")
async def list_sessions(company: str, project: str):
    """List all chat sessions for a project."""
    middleware = ChatMemoryMiddleware(project, company)
    sessions = middleware.list_sessions()
    return {"sessions": sessions}


@router.get("/sessions/{session_id}/history")
async def get_session_history(session_id: str, limit: int = 50):
    """Get conversation history for a session."""
    middleware = ChatMemoryMiddleware("", "")
    history = middleware.store.get_history(session_id, limit=limit)
    if not history and not middleware.store.get_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"messages": history}


@router.post("/sessions/resume")
async def resume_session(request: ResumeSessionRequest):
    """Resume a session with context injection."""
    middleware = ChatMemoryMiddleware(
        request.project, request.company, user_id=request.user_id
    )
    session_id, context = middleware.on_session_start()
    return {
        "session_id": session_id,
        "context": context,
        "has_context": bool(context),
    }


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a session and all associated data."""
    middleware = ChatMemoryMiddleware("", "")
    session = middleware.store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    middleware.delete_session(session_id)
    return {"deleted": True, "session_id": session_id}


@router.get("/sessions/{session_id}/preferences")
async def get_session_preferences(session_id: str):
    """Get preferences associated with a session's project."""
    middleware = ChatMemoryMiddleware("", "")
    session = middleware.store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    prefs = middleware.store.get_preferences(session["project"])
    return {"preferences": prefs}


@router.post("/preferences")
async def set_preference(request: PreferenceSetRequest):
    """Explicitly set a user preference."""
    middleware = ChatMemoryMiddleware(request.project, request.company)
    middleware.store.set_preference(
        request.project, request.category, request.key, request.value,
        user_id=request.user_id,
    )
    return {"set": True, "category": request.category, "key": request.key, "value": request.value}


@router.get("/extractions")
async def get_extractions(company: str, project: str, limit: int = 10):
    """Get recent extraction results for a project."""
    middleware = ChatMemoryMiddleware(project, company)
    extractions = middleware.store.get_extractions(project, company, limit=limit)
    return {"extractions": extractions}
