# Specification: Normalize API Identifiers, Sanitize Newlines, Fix Streaming

## Goal
Ensure consistent API request formatting by normalizing company/project identifiers, sanitizing newline characters in spec intent messages, and fixing streaming message persona attribution so that Software Architect messages remain stable and each content delta creates a new chat bubble.

## User Stories
- As a user, I want company and project names to be consistently normalized so that API requests work correctly regardless of how I entered the names.
- As a developer, I want spec intent messages to be newline-free so that upstream parsing receives clean single-line messages.
- As a user, I want streamed messages to always show "Software Architect" persona and appear as individual message bubbles so that the chat experience is clear and consistent.

## Specific Requirements

**A) Create normalizeIdentifier utility**
- Create new file `src/utils/normalizeIdentifier.ts`
- Export function `normalizeIdentifier(input: string): string`
- Algorithm: (1) trim leading/trailing whitespace, (2) toLowerCase, (3) replace one or more consecutive whitespace with single hyphen
- Example: "  Rivvy   Studios  " becomes "rivvy-studios"
- Handle edge cases: empty string returns empty string, null/undefined returns empty string

**B) Apply normalization to all /api/v1 requests**
- Call `normalizeIdentifier()` on both `company` and `project` fields
- Apply right before building request payloads in `startOrchestration()` in `orchestrationApi.ts`
- Apply in `useShapeSpecStream.ts` before building request body in `startStream()`
- Same normalization logic applied identically to both company and project

**C) Sanitize spec intent message before API call**
- Apply sanitization AFTER `composeSpecIntent()` returns, BEFORE sending request
- Replace all newline variants (\r\n, \n, \r) with single space
- Collapse repeated/consecutive spaces into single space
- Trim leading and trailing spaces
- Final outbound message must be completely newline-free
- Create sanitization in the calling code (e.g., `startShapeSpecStreamCallback` in ImplementationAssistantPanel)

**D) Store persona on ChatMessage for stable attribution**
- Extend `ChatMessage` interface in `chatApi.ts` with optional `persona?: 'Product Owner' | 'Software Architect'` field
- Set persona when creating message, not derived from current phase
- Streaming messages created during shape-spec flow get persona: 'Software Architect'
- Persona must not change after message creation

**E) Ensure streamed messages always show "Software Architect"**
- Track streaming messages explicitly as "Software Architect" persona
- Do not rely on phase value staying constant (phases can change during execution)
- Set persona at message creation time in streaming callbacks
- ChatMessageList should use message.persona for rendering when available

**F) Split streamed content into individual message bubbles**
- Each content/delta SSE event creates a NEW ChatMessage with a new unique ID
- Set role: 'assistant' on each new message
- Set content to ONLY the delta content (no accumulation across messages)
- Skip creating message for empty or whitespace-only deltas (no empty bubbles)
- Preserve message ordering as received from stream
- Remove accumulated content pattern (streamedContentRef accumulation)

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**`src/utils/sanitize.ts`**
- Contains model sanitization utilities for backend save
- Pattern to follow: pure functions that transform data before API calls
- Similar purpose (sanitize before sending to backend)
- Same file organization pattern with clear function exports

**`src/utils/idGenerator.ts`**
- Contains `generateMessageId()` pattern for unique IDs
- `generatePrefixedId(prefix: string)` generates timestamp-based prefixed IDs
- Use for generating new message IDs for each delta

**`src/api/chatApi.ts`**
- Defines `ChatMessage` interface (id, role, content, timestamp)
- Location to extend with persona field
- Has existing message entry conversion helper functions

**`src/hooks/useShapeSpecStream.ts`**
- Contains SSE stream parsing and event routing logic
- Uses fetch API with ReadableStream for POST-based SSE
- Has `onContent` callback where delta processing occurs
- Builds request body with company/project fields to normalize

**`src/api/orchestrationApi.ts`**
- `startOrchestration()` builds request body with company/project fields
- Location to apply normalization before sending request
- Uses same GATEWAY_BASE pattern as other API calls

## Out of Scope
- Do not change backend API contracts or response formats
- Do not handle `skill_invoked` SSE events (remain ignored per existing behavior)
- Do not add orchestration polling or progress logic
- Do not modify spec intent composition logic in `composeSpecIntent()` itself
- Do not change how non-streaming messages are created or displayed
- Do not persist persona to ImplementChatUiState or conversation history on disk
- Do not change ChatBubble styling or visual appearance
- Do not modify the QuestionsTable or answer flow logic
- Do not add new SSE event types or handlers
- Do not change the session management or sessionMode logic
