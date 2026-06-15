# Shape-Spec 3 — Trigger Orchestration when Questions Complete + Final Software Architect Message

## Intent
Once the Software Architect shape-spec streaming conversation has no further questions, automatically trigger the implementation orchestration using the emitted spec folder name, and then post a final "Software Architect" confirmation message in the chat.

## Context
- Shape-Spec 1: Implement starts a NEW shape-spec streaming session and renders streamed {type:"content"} as "Software Architect" messages.
- Shape-Spec 2: Streaming {type:"questions"} populates the Open Questions table; user answers via "Answer Open Questions" which continues the same stream session (no session_mode). The loop ends when a stream turn yields no questions. {type:"folder"} is stored in UI state for later use.
- The external services involved:
  1) Shape-spec stream (SSE):
     POST http://localhost:8000/api/v1/shape-spec/stream
     emits {type:"folder", folder:"..."} at some point
  2) Orchestration trigger (non-streaming):
     POST http://localhost:8000/api/v1/orchestrations
     body: { company, project, spec_intents:[folder] }

## Definition: "Questions Complete"
Questions are considered complete when:
- A stream turn finishes ({type:"done"}) AND
- That stream turn produced no usable questions (questions event missing, null, or empty array) AND
- The Open Questions table is empty/cleared.

## Behavior A — Trigger Orchestration
1. When "Questions Complete" occurs:
   - If a folder value has been captured from any prior {type:"folder"} event in the session:
     - Trigger orchestration via:
       POST http://localhost:8000/api/v1/orchestrations
       body:
         - company: active project's organisation name
         - project: active project's name
         - spec_intents: [<captured folder>]
   - If folder is missing/empty:
     - Do NOT call orchestration.
     - Show a simple visible error (chat bubble or existing error UI) stating orchestration cannot start because folder/spec intent is missing.

2. Orchestration must be triggered at most once per "Implement session":
   - Add a guard flag in UI state to prevent duplicate calls if the user replays actions or streams complete multiple times.
   - If orchestration has already been started, do nothing further.

## Behavior B — Final Chat Message on Success
3. If orchestration returns HTTP 200 or 201:
   - Append a "Software Architect" chat message bubble:
     "Okay, I'll start implementing the code change now. Speak to you soon!"
   - Disable or visually mark the Open Questions controls as complete (e.g., keep Answer button disabled because there are no questions).

## Behavior C — Error Handling (minimal)
4. If orchestration fails (non-200/201 or network error):
   - Show a simple visible error (reuse existing error patterns).
   - Do not retry automatically.
   - Do not append the success confirmation message.

## UI State
- During orchestration request:
  - Prevent duplicate orchestration triggers (disable relevant actions).
- After successful orchestration:
  - Ensure the chat history remains visible.
  - The success message is preserved in the chat transcript for the session.

## Out of Scope
- Polling orchestration status / progress
- Displaying live executor output or logs
- Persisting orchestration state to backend beyond existing session state
- Any modifications to shape-spec stream behavior (handled in specs 1–2)

## Success Criteria
- Orchestration is triggered exactly once when questions complete and folder is available.
- The correct request body is sent with spec_intents containing the folder name.
- On HTTP 200/201, the final "Software Architect" confirmation bubble is displayed.
- On failure or missing folder, a simple visible error is shown and no success bubble is posted.
