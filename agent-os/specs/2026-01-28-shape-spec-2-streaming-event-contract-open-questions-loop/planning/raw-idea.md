# Shape-Spec 2 — Streaming event contract + Open Questions loop (Answer Open Questions)

## Intent
Extend the Implement screen "Software Architect" interaction so that streamed shape-spec events can populate the Open Questions table, and the user can answer those questions to continue the same shape-spec streaming session until no further questions are returned.

## Context
- Shape-Spec 1 is in place: Implement starts a NEW shape-spec streaming session and renders streamed {type:"content"} as "Software Architect" chat messages, ignoring {type:"skill_invoked"}, completing on {type:"done"}.
- The shape-spec streaming endpoint is external:
  POST http://localhost:8000/api/v1/shape-spec/stream (SSE)
- This spec introduces:
  - handling {type:"questions"} events
  - the "Answer Open Questions" loop via subsequent stream calls (no session_mode)
  - capturing {type:"folder"} for later orchestration (but orchestration is out of scope here)

## Event Contract (Streaming SSE)
The frontend must handle these event payloads:
- { "type": "skill_invoked", "skill": "..." } → ignore
- { "type": "content", "delta": "..." } → render (existing behavior)
- { "type": "questions", "questions": [ { "id": "<id>", "question": "<text>" }, ... ] } → populate Open Questions
- { "type": "folder", "folder": "<folder-name>" } → store latest folder value (for next spec)
- { "type": "done" } → end of this stream turn

## Behavior A — Populate Open Questions table from stream
1. When a stream emits {type:"questions"}:
   - Replace the Open Questions table rows with these questions (treat as the current "active" question set).
   - Each question row must preserve:
     - id (from payload)
     - question text (from payload)
     - answer field editable by the user
     - status shown as Open (initially)
   - Enable the "Answer Open Questions" button only when:
     - there is at least one active question AND
     - none of the active questions have an empty answer

2. When the user edits answers:
   - Update local UI state for the answers (do not persist to backend in this spec).
   - Button enablement updates live based on completeness.

## Behavior B — Answer Open Questions triggers a continuation stream call
3. When the user clicks "Answer Open Questions":
   - Compose a single message string containing all answers for the active questions, suitable for an LLM follow-up (format is flexible; keep it simple and readable; include question ids or question text + answer).
   - POST to the same streaming endpoint:
     POST http://localhost:8000/api/v1/shape-spec/stream
     Body:
       - company: active project organisation name
       - project: active project name
       - message: the composed answers text
     NOTE: Do NOT set session_mode on follow-up calls (continuation behavior).

4. During this follow-up stream:
   - Continue rendering {type:"content"} as "Software Architect" chat messages (existing behavior from spec 1).
   - Handle {type:"questions"} again:
     - If questions are returned, they become the new active question set (replace rows), and the loop continues.
   - Handle {type:"folder"}:
     - Store/overwrite the latest folder value in state (needed for spec 3).
   - On {type:"done"}:
     - Mark stream complete.
     - If no questions were received in this stream turn, consider "questions complete" for now (but do not orchestrate here).

## Behavior C — Looping rules
5. The user may repeat "Answer Open Questions" multiple times:
   - Each time, it continues the same conversation (no session_mode).
   - Each time, Open Questions table is replaced by the latest returned questions (if any).
   - If a stream turn returns no questions (missing/null/empty), the Open Questions table should become empty/cleared and the button disabled.

## UI State & Guardrails
- While a stream call is active (either initial or follow-up), prevent duplicate submissions for that action (disable Implement/Answer buttons as appropriate).
- Ensure the Software Architect streamed message history remains visible.
- Minimal error handling:
  - If stream fails to connect/parse/terminates unexpectedly, show a simple visible error state (reuse existing error patterns).
  - No retry/backoff logic in this spec.

## Out of Scope
- Triggering POST http://localhost:8000/api/v1/orchestrations
- Any "implementation started" confirmation bubble
- Persisting questions/answers/transcript to backend beyond existing UI state
- Any transformation of planner content; this spec assumes the initial session was already started by spec 1

## Success Criteria
- {type:"questions"} events populate the Open Questions table.
- "Answer Open Questions" becomes enabled only when all answers are filled.
- Clicking "Answer Open Questions" sends a continuation stream request (no session_mode) and renders streamed content.
- The loop repeats correctly if more questions arrive.
- If no questions arrive, the table clears and the Answer button disables, with the latest folder (if received) retained for the next step.
