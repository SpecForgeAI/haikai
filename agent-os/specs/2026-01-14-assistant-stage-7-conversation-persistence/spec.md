# Specification: Implement Assistant Stage 7 - Full Conversation and Execution Persistence to Disk

## Goal

Persist a complete, deterministic, human-readable record of implement_feature conversations to disk, capturing the full Planner LLM conversation, all system prompts and injected context, the final validated handoff plan, and the external orchestration execution request and response into a single on-disk artefact per feature.

## User Stories

- As a developer using Specification-Driven Development, I want my Implement Assistant conversations persisted to disk so that I have a complete audit trail of planning decisions and execution results.
- As a team lead, I want to review the conversation history that led to a feature implementation so that I can understand the context and decisions made during planning.

## Specific Requirements

**Transcript Type Definitions**
- Define TranscriptRole union type with values: SYSTEM, USER, ASSISTANT, PLANNER_HANDOFF, ORCHESTRATION
- Define TranscriptPhase union type with values: bootstrap, refine, handoff
- Define TranscriptEntry interface with fields: timestamp (ISO-8601), phase, role, content
- Define ConversationTranscript interface with fields: sessionId, entries array, createdAt timestamp

**In-Memory Transcript Store**
- Implement InMemoryTranscriptStore class following the same patterns as existing sessionStore.ts
- Store transcripts in a Map keyed by sessionId for O(1) access
- Provide getOrCreate pattern that returns existing buffer or creates new one
- Implement appendEntry method that adds TranscriptEntry to the buffer
- Implement cleanup mechanism based on SESSION_TTL_HOURS configuration
- Export helper functions: initializeTranscript, getTranscript, appendTranscriptEntry, deleteTranscript

**Chat Route Integration for Transcript Appending**
- Only append transcript entries when context.mode === 'implement_feature'
- Append SYSTEM entry containing the full system prompt at the start of each turn
- Append USER entry with the user message content
- Append ASSISTANT entry with the LLM response content
- Append PLANNER_HANDOFF entry when phase=handoff validation succeeds, containing the validated handoff plan JSON
- Use context.phase to determine the transcript phase (default to 'refine' if absent)

**Orchestrations Route Integration**
- Append ORCHESTRATION entry after executeOrchestration completes (success or failure)
- Include structured metadata: endpoint path, company, project, feature_descriptions_count, timestamp
- Include response: success boolean, HTTP status code equivalent, response body (truncated if > 8000 chars)
- After appending ORCHESTRATION entry, trigger flush to disk via writeTranscriptToFile

**Transcript Writer Service**
- Implement deriveFolderName function that produces filesystem-safe folder name from workItemTitle + sessionId suffix
- Convert title to lowercase, replace spaces with hyphens, remove special characters, collapse multiple hyphens
- Truncate title portion to 50 characters maximum, append first 8 characters of sessionId as suffix
- Fallback to "conversation-{sessionId_prefix}" if title is empty or sanitizes to empty string

**Filesystem Write Layer**
- Build path as: {conversationPersistBasePath}/conversations/{folderName}/full-conversation.txt
- Use atomic write pattern: write to temp file (.tmp suffix) then rename to final path
- Create directory with recursive: true option to handle nested path creation
- Write file as UTF-8 plain text

**Transcript Formatting**
- Begin with header line: "=== IMPLEMENT ASSISTANT CONVERSATION TRANSCRIPT ==="
- Include metadata: Generated timestamp, Session ID, Created timestamp
- Format each entry with role marker line: "--- [ROLE] (phase: phase_value) @ timestamp ---"
- Add section header "=== FINAL HANDOFF PLAN (PLANNER OUTPUT) ===" before PLANNER_HANDOFF entries
- Add section header "=== ORCHESTRATION EXECUTION ===" before ORCHESTRATION entries
- Use blank lines between entries for readability

**Error Handling**
- Persistence failures MUST NOT block orchestration execution or returning results to frontend
- Log directory creation failures with warn level, skip file write attempt
- Log file write failures with error level, include sessionId and error message
- Log rename failures as "Partial persistence" with error level
- All filesystem operations wrapped in try-catch to prevent exceptions from propagating

## Visual Design

No visual assets provided - this is a backend-only feature with no UI changes.

## Existing Code to Leverage

**gateway/src/services/transcriptStore.ts**
- Fully implemented in-memory transcript store with Map-based storage
- Provides initializeTranscript, getTranscript, appendTranscriptEntry, deleteTranscript functions
- Includes cleanup mechanism and TTL-based expiration using SESSION_TTL_HOURS config
- Follows same patterns as sessionStore.ts for consistency

**gateway/src/services/transcriptWriter.ts**
- Fully implemented transcript writer with deriveFolderName, buildTranscriptPath, formatTranscript, writeTranscriptToFile
- Uses atomic write pattern (temp file + rename)
- Handles all error cases gracefully without throwing

**gateway/src/types/transcript.ts**
- Complete type definitions for TranscriptRole, TranscriptPhase, TranscriptEntry, ConversationTranscript
- Well-documented with JSDoc comments explaining each type

**gateway/src/routes/chat.ts**
- Already integrated with transcript appending for SYSTEM, USER, ASSISTANT entries
- Uses shouldAppendToTranscript helper to check for implement_feature mode
- Appends PLANNER_HANDOFF entry when handoff validation succeeds

**gateway/src/routes/orchestrations.ts**
- Already integrated with transcript appending for ORCHESTRATION entries
- Builds structured entry content with endpoint, company, project, feature count, response
- Triggers writeTranscriptToFile after orchestration completes
- Uses truncateContent helper to limit response body to 8000 characters

## Out of Scope

- No UI for browsing or replaying conversations
- No database-backed conversation storage
- No job polling or status tracking persistence
- No regeneration or re-execution from persisted files
- No streaming endpoint support for transcript persistence (only POST /api/chat)
- No conversation resume from persisted files
- No compression or archiving of old conversation files
- No multi-user access control or encryption of persisted files
- No real-time sync or backup of conversation files
- No retention policy or automatic cleanup of old conversation files on disk
