# Raw Idea

**Increment 2: Unified Chat Panel v1 (Frontend)**

This is Increment 2 of an 11-increment unified conversation engine plan. Increment 1 (Backend) is complete — POST /api/chat/v2 endpoint, persona/task registries, thread persistence, and prompt composition pipeline are all working. Now we need the frontend chat panel component that consumes it.

Key areas:
1. Reusable React chat panel component (UnifiedChatPanel) — renders conversation thread, text input, @-mention persona selection, task menu, structured responses, file attachment, resizable/collapsible
2. Chat API client service — calls POST /api/chat/v2, handles responses
3. Chat state management — React context/state for thread messages, active persona/task, loading, panel state
4. Message rendering — user/assistant/system messages with persona attribution, structured response tables, error display
5. Task menu hook — displays clickable task options when persona returns task list
