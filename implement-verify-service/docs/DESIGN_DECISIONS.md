# Design Decisions

This document records key design decisions made during the development of the Standards Extractor, including rationale and alternatives considered.

## Conversational Chat API

### Automatic /shape-spec Prefix for New Sessions

**Decision Date:** 2026-01-28  
**Status:** Implemented

**Decision:** When `session_mode: "new"` is used in the chat API, the user's message is automatically prefixed with `/shape-spec`. For `session_mode: "resume"` (default), messages are sent as-is without modification.

**Rationale:**

The `/api/v1/shape-spec/stream` endpoint is specifically designed for the shape-spec workflow, which is the primary use case for conversational specification refinement. Requiring users to explicitly type `/shape-spec` every time they start a new conversation is repetitive and reduces the user experience quality.

By automatically prefixing new sessions with `/shape-spec`, we achieve:

1. **Better UX**: Starting a new shape-spec is the primary use case, so it should be the easiest
2. **Clearer Intent**: `session_mode: "new"` semantically implies "I want to start a new shape-spec conversation"
3. **Flexibility**: Resume mode still allows full control for advanced use cases where users might want to invoke other skills
4. **Less Repetitive**: Users don't have to type `/shape-spec` every time they start fresh
5. **API Consistency**: The endpoint name `/shape-spec/stream` clearly indicates its purpose

**Implementation:**

```python
# In ClaudeChatExecutor.stream_message()
if is_new_session:
    message = f"/shape-spec {message}"
    logger.info(f"New session: automatically prefixed message with /shape-spec")
```

**Alternatives Considered:**

**Option 1 (Chosen):** Keep it simple - `session_mode: "new"` always means new shape-spec conversation
- ✅ Simple and intuitive
- ✅ Matches the API endpoint name
- ✅ Covers 95% of use cases
- ❌ Cannot start fresh with other skills

**Option 2:** Add a `skill` parameter for flexibility
```json
{
  "session_mode": "new",
  "skill": "plan-product",  // optional, defaults to "shape-spec"
  "message": "..."
}
```
- ✅ More flexible
- ✅ Supports all Haikai skills
- ❌ More complex API surface
- ❌ Violates single responsibility (endpoint is for shape-spec)
- ❌ Users can already achieve this with `session_mode: "resume"` and explicit skill invocation

**Recommendation for Future:**

If there's demand for starting fresh conversations with other skills, consider creating dedicated endpoints:
- `/api/v1/plan-product/stream` - For product planning conversations
- `/api/v1/implement-tasks/stream` - For implementation conversations
- etc.

This maintains clear separation of concerns and keeps each endpoint focused on its primary use case, following REST API best practices.

**Related:**
- Implementation: `src/chat/claude_chat_executor.py` line 196-198
- API Documentation: `docs/CHAT_API.md`
- User Documentation: `README.md`
