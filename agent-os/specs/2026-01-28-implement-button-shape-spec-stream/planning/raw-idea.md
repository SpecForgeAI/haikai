# Raw Idea

Title: Implement button starts Shape-Spec stream (new session)

## Intent
Enable the Implement button in the Feature Implement screen to initiate a new Shape-Spec streaming conversation with the Software Architect (Claude Code proxy), using the Planner LLM's final spec intent as input.

## Context
- The Planner LLM has completed its work (scope, assumptions, acceptance criteria, open questions resolved).
- The user is viewing a Feature in the Implement tab and presses the Implement button.
- This spec only covers starting the streaming conversation and rendering streamed content.
- Question handling, looping, and orchestration are explicitly out of scope for this spec.

## Behavior
1. When the user clicks the Implement button:
   - Send a POST request to the Shape-Spec streaming endpoint:
     POST /api/v1/shape-spec/stream
   - Request body includes:
     - company: active project's organisation name
     - project: active project's name
     - message: the Planner LLM's final "spec intent", prefixed with `/shape-spec `
     - session_mode: "new"

2. Handle the streaming response (SSE):
   - Parse incoming JSON events.
   - For events of type "content":
     - Append the `delta` text incrementally to the chat UI
     - Render these as messages from the "Software Architect" role
   - For events of type "skill_invoked":
     - Ignore (no UI impact)
   - For events of type "done":
     - Mark the stream as complete and stop listening

3. UI state:
   - While the stream is active, prevent duplicate Implement actions.
   - After the stream completes, the chat remains visible with all streamed messages preserved.

## Out of Scope
- Handling "questions" events
- Open Questions table population
- Answer Open Questions flow
- Folder capture
- Orchestration triggering
- Error handling beyond basic stream failure visibility

## Success Criteria
- Clicking Implement reliably starts a new Shape-Spec streaming session.
- Streaming content is rendered live as Software Architect chat messages.
- The stream completes cleanly.
