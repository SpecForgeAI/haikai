# Specification: Fix /api/v1 Streaming Chat Bubbles

## Goal
Fix incomplete implementation from previous spec where /api/v1 streaming messages are not being stamped with persona at creation time and streaming content is still accumulating into a single bubble via `streamedContentRef` instead of creating separate bubbles per delta.

## User Stories
- As a user, I want each streamed content delta from the Software Architect to appear as its own chat bubble so that I can see the conversation flow naturally
- As a user, I want all Software Architect messages to be consistently labeled with the "Software Architect" persona so that I know who is responding

## Specific Requirements

**A1: Stamp persona on all /api/v1-sourced messages at creation time**
- Every ChatMessage created in the /api/v1 streaming flow must have `persona: 'Software Architect'` set explicitly at creation time
- Do NOT rely on phase-based fallback from `currentPhase` prop in ChatMessageList
- Applies to: streaming content messages, success messages, error messages
- The persona field must remain stable after stream completion (no post-stream mutation)

**A2: Apply persona to startShapeSpecStreamCallback onContent handler**
- Currently creates message without persona in the initial message creation
- When creating the initial message before streaming, stamp `persona: 'Software Architect'`
- All delta updates via `setMessages` map should preserve the persona field

**A3: Apply persona to handleAnswerStreamedQuestions onContent handler**
- Same pattern as startShapeSpecStreamCallback
- Initial message creation must include `persona: 'Software Architect'`
- User message (composed Q/A) should NOT have persona (user messages never have persona)

**A4: Apply persona to triggerOrchestration success and error messages**
- Success message ("Okay, I'll start implementing...") must include `persona: 'Software Architect'`
- All error messages (missing folder, API failure) must include `persona: 'Software Architect'`

**B1: Split streaming into multiple bubbles - new message per delta**
- Each `{type:"content", delta}` SSE event must create a NEW ChatMessage (not append to existing)
- Remove the accumulation pattern that currently appends delta to `streamedContentRef.current`
- New message for each delta has: unique id (generateMessageId), role: 'assistant', persona: 'Software Architect', content: delta only, timestamp: new Date()

**B2: Skip empty/whitespace-only deltas**
- Before creating a new message, check if delta is empty or whitespace-only
- If `!delta || !delta.trim()`, skip creating a message (do not add empty bubbles)
- This prevents visual clutter from empty SSE events

**B3: Remove accumulator state and refs**
- Remove `streamingMessageId` state variable entirely (no longer needed)
- Remove `streamedContentRef` ref entirely (no longer needed)
- Update any code that resets these (workItemId change, error handlers, onDone handlers)
- Remove the `initialMessage` creation pattern that creates an empty message before streaming

**B4: Update onDone handlers to not reference accumulator state**
- startShapeSpecStreamCallback onDone: remove references to streamedContentRef and streamingMessageId
- handleAnswerStreamedQuestions onDone: remove references to streamedContentRef and streamingMessageId
- onError handlers: remove accumulator reset logic, just set isStreaming false

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**ChatMessage interface with persona field (chatApi.ts line 547-562)**
- Interface already has optional `persona?: ChatMessagePersona` field
- ChatMessagePersona type is `'Product Owner' | 'Software Architect'`
- Just need to stamp this field at message creation time

**ChatMessageList persona handling (ChatMessageList.tsx line 156-175)**
- Already checks `message.persona` first before falling back to phase-based lookup
- Uses `getColorForPersona()` to map 'Software Architect' to purple
- No changes needed here - will automatically use stamped persona

**generateMessageId helper (ImplementationAssistantPanel.tsx line 274-276)**
- Existing helper to generate unique message IDs
- Reuse for each new delta message

**triggerOrchestration function (ImplementationAssistantPanel.tsx line 1207-1287)**
- Already creates success/error ChatMessages
- Just need to add persona field to each message creation

**startShapeSpecStreamCallback (ImplementationAssistantPanel.tsx line 1461-1590)**
- Contains onContent handler that currently accumulates to streamedContentRef
- Contains initial message creation that needs persona stamped
- onDone/onError handlers need cleanup of accumulator references

## Out of Scope
- Message persistence/rehydration changes (how messages are saved to disk)
- ChatBubble component styling changes (colors, layout)
- Backend contract changes (SSE event structure)
- Delta grouping/aggregation logic (each delta = one bubble, no batching)
- Making persona field globally required (keep optional with phase fallback)
- Changes to non-/api/v1 message flows (Product Owner messages unchanged)
- ChatMessageList component changes (already handles stored persona correctly)
