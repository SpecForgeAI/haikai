# Feature Spec: Chat API Extension for Questions and Folder Events

**Author:** Manus AI  
**Date:** 2026-01-28  
**Status:** In Review

## 1. Overview

This document outlines the requirements, design, and implementation details for extending the conversational chat API to support a more interactive and orchestrated workflow between a Planner LLM (Product Owner) and an Implementation LLM (Software Architect). The primary goal is to enable the Implementation LLM (Claude Code) to ask clarifying questions and signal when a specification is ready for implementation, providing a more robust and automated handoff process.

This extension introduces two new event types to the Server-Sent Events (SSE) stream:

- `questions`: A structured list of questions from the Implementation LLM
- `folder`: The directory where the specification has been created

This enables a client application to orchestrate a multi-step conversation, gather user input for clarifying questions, and trigger an implementation workflow once the specification is complete.

## 2. Requirements

### 2.1. Functional Requirements

- **FR1: Ask Questions Skill:** The Implementation LLM (Claude) must be able to explicitly ask clarifying questions using a dedicated Haikai skill (`/ask-questions`).
- **FR2: Structured Question Format:** The questions must be provided in a structured format that is easy for a client application to parse and display.
- **FR3: Folder Name Detection:** The API must detect when a specification has been created and provide the folder name to the client.
- **FR4: New SSE Event Types:** The API must introduce two new event types (`questions` and `folder`) to the SSE stream.
- **FR5: Post-Processing Extraction:** Question and folder information must be extracted after the Implementation LLM has finished its response and sent after the `done` event.

### 2.2. Non-Functional Requirements

- **NFR1: Reliability:** The mechanism for asking questions and providing the folder name must be reliable and not dependent on parsing natural language from the LLM response.
- **NFR2: Simplicity:** The implementation should be as simple as possible while still meeting the functional requirements.
- **NFR3: Extensibility:** The design should be extensible to support future enhancements, such as different question formats or additional metadata.

## 3. Design

### 3.1. Architecture

The existing conversational chat API architecture will be extended to support the new event types. The core components involved are:

- **`ClaudeChatExecutor`:** The primary class responsible for managing the Claude CLI subprocess and processing the SSE stream.
- **Haikai Skills:** A new skill (`/ask-questions`) will be created to enable explicit question asking.
- **API Router:** The FastAPI router will be updated to handle the new event types and data structures.

### 3.2. `/ask-questions` Skill

A new Haikai skill will be created to allow Claude to ask questions in a structured format.

- **Skill Name:** `/ask-questions`
- **Location:** `haikai-profiles/default/commands/ask-questions/single-agent/ask-questions.md`
- **Input Format:** Markdown list, where each list item is a question with a unique ID.

**Example Usage by Claude:**
```
/ask-questions
- [c3879034-347e-444d-93c2-e1671b885aab] How should created_at/updated_at be managed—database defaults/triggers or application-managed timestamps?
- [a1b2c3d4-e5f6-7890-1234-567890abcdef] Should we implement soft deletes or hard deletes for user records?
```

### 3.3. Folder Name Detection

The folder name will be detected by monitoring when Claude invokes the `/write-spec` skill. The `ClaudeChatExecutor` will parse the `skill_invoked` events and extract the folder name from the file path created by the `/write-spec` skill.

- **Trigger:** `skill_invoked` event with `skill: "write-spec"`
- **Extraction Logic:** Extract the parent directory of the file path created by `/write-spec`.
- **Timing:** The last `/write-spec` invocation in a session will be used to determine the final folder name.

### 3.4. SSE Event Stream

The SSE stream will be extended with two new event types, which will be sent *after* the `done` event to ensure all content has been streamed to the client first.

**New Event Types:**

1.  **`questions`**
    ```json
    {
      "type": "questions",
      "questions": [
        {
          "id": "c3879034-347e-444d-93c2-e1671b885aab",
          "question": "How should created_at/updated_at be managed—database defaults/triggers or application-managed timestamps?"
        }
      ]
    }
    ```

2.  **`folder`**
    ```json
    {
      "type": "folder",
      "folder": "2026-01-28-user-authentication"
    }
    ```

**Event Sequence:**
```
data: {"type": "content", "delta": "I have some questions..."}
data: {"type": "skill_invoked", "skill": "ask-questions"}
data: {"type": "done"}
data: {"type": "questions", "questions": [...]}
data: {"type": "folder", "folder": "..."}
```

## 4. Implementation Plan

1.  **Create `/ask-questions` Skill:**
    - Create the skill definition file in the Haikai profiles directory.
    - Update the `ClaudeChatExecutor` to recognize and parse the skill.

2.  **Update `ClaudeChatExecutor`:**
    - Add logic to detect `/ask-questions` skill invocation and parse the questions.
    - Add logic to detect `/write-spec` skill invocation and extract the folder name.
    - Buffer the questions and folder name during the session.
    - After the `done` event, yield the `questions` and `folder` events.

3.  **Update API Models:**
    - Add `questions` and `folder` event types to the Pydantic models for validation.

4.  **Update Documentation:**
    - Update `docs/CHAT_API.md` with the new event types and examples.
    - Update `README.md` with the new workflow.

## 5. Testing Strategy

- **Unit Tests:**
    - Test the parsing logic for the `/ask-questions` skill.
    - Test the folder name extraction from the `/write-spec` skill.
- **Integration Tests:**
    - Create a test that simulates a full conversation with questions and folder creation.
    - Verify that the `questions` and `folder` events are sent correctly after the `done` event.
- **Manual Testing:**
    - Use `curl` or a simple client to test the end-to-end workflow.

## 6. Edge Cases and Risks

- **Risk:** Claude doesn't invoke `/ask-questions` but still has questions in its text.
  - **Mitigation:** This is an accepted risk. The design relies on explicit skill invocation for reliability. Future enhancements could add natural language parsing as a fallback.
- **Risk:** Claude never invokes `/write-spec`.
  - **Mitigation:** The `folder` event will not be sent. The client application should handle this case gracefully.

## 7. References

- [1] Original conversation with end-user: `pasted_content_6.txt`
