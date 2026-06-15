# Spec Requirements: Fix /api/v1 Streaming Chat Bubbles

## Initial Description

Fix /api/v1 streaming chat bubbles - force "Software Architect" persona and split stream into multiple bubbles

For all messages from /api/v1/* endpoints (e.g., /api/v1/shape-spec/stream), ensure:
1) Chat bubbles are consistently labeled "Software Architect" (never "Product Owner", never phase-dependent)
2) Streaming content renders as multiple distinct message bubbles (one per streamed content event), rather than a single growing bubble

**Note:** This is a BUG FIX for a previous spec that didn't fully implement the streaming changes correctly.

## Requirements Discussion

### First Round Questions

**Q1:** Is the current behavior (growing single bubble) a bug or was it intentional? Should I assume the intended behavior is "new bubble per content event"?
**Answer:** Yes - it's a bug/regression. The intended behavior is "new bubble per content event"; any remaining accumulation logic must be removed/fixed.

**Q2:** For persona stamping, should we stamp `persona: 'Software Architect'` directly on each ChatMessage at creation time for /api/v1-sourced messages, or should we add a fallback lookup somewhere else?
**Answer:** Yes - stamp `persona: 'Software Architect'` directly on each ChatMessage at creation time for /api/v1-sourced messages. Do not rely on phase fallback.

**Q3:** What is the intended UX for rapidly-arriving stream events? Should each `{type:"content", delta}` become its own bubble immediately (no grouping)?
**Answer:** Intended UX is exactly as spec'd: each `{type:"content", delta}` becomes its own bubble (no grouping) for now. We can add grouping later if needed.

**Q4:** Are there any non-content messages (e.g., success/error messages like "Okay, I'll start implementing...") that should also be stamped with the Software Architect persona?
**Answer:** Yes - any messages that are part of the implementation/Software Architect flow (including success/error bubbles like "Okay, I'll start implementing...") must also be stamped `persona: 'Software Architect'`.

**Q5:** Should we remove the accumulator-related state/refs that were used for the growing-bubble streaming (e.g., `streamingMessageId`, `streamedContentRef`) in the /api/v1 streaming path?
**Answer:** Yes - remove the accumulator-related state/refs used for growing-bubble streaming (e.g., `streamingMessageId`, `streamedContentRef`) in the /api/v1 streaming path, since they are no longer needed.

**Q6:** Should the persona field on ChatMessage become required (non-optional) to prevent future regressions, or should it remain optional with a phase-based fallback for backward compatibility?
**Answer:** Keep persona OPTIONAL with phase-based fallback for backward compatibility. Only enforce persona stamping for /api/v1-sourced messages; do not make it globally required.

**Q7:** Is there anything else you want to explicitly EXCLUDE from this fix (e.g., message persistence changes, styling changes, backend contract changes)?
**Answer:** Out of scope: message persistence/rehydration changes, ChatBubble styling changes, any backend contract changes, and any new grouping/aggregation logic for streamed deltas.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Shape-Spec streaming implementation - Path: Current streaming handler for /api/v1/shape-spec/stream
- Feature: ChatMessage model - Path: TypeScript interfaces for chat messages
- Feature: ChatPanel/ChatBubble components - Path: React components rendering chat UI
- Feature: Accumulator state/refs - Path: `streamingMessageId`, `streamedContentRef` (to be removed)

### Follow-up Questions

No follow-up questions were needed. The user's answers are comprehensive and provide clear guidance on all implementation decisions.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A - No visual files were found in the planning/visuals folder.

## Requirements Summary

### Functional Requirements

**Bug Fix - Multiple Bubbles Instead of Single Growing Bubble:**
- Each `{type:"content", delta}` SSE event must create a NEW distinct chat bubble
- Do NOT accumulate/append content to an existing bubble
- Remove the growing-bubble streaming behavior entirely for /api/v1 paths

**Persona Stamping:**
- Stamp `persona: 'Software Architect'` directly on each ChatMessage at creation time for all /api/v1-sourced messages
- Do NOT rely on phase-based fallback for persona resolution
- All messages in the Software Architect flow must be stamped, including:
  - Content delta messages from streaming
  - Success messages (e.g., "Okay, I'll start implementing...")
  - Error messages

**State Cleanup:**
- Remove accumulator-related state/refs that are no longer needed:
  - `streamingMessageId` (or equivalent)
  - `streamedContentRef` (or equivalent)
  - Any other refs/state used for the growing-bubble pattern in /api/v1 streaming

**Backward Compatibility:**
- Keep the `persona` field OPTIONAL on ChatMessage type
- Phase-based fallback remains available for non-/api/v1 message sources
- Only /api/v1-sourced messages require explicit persona stamping

### Reusability Opportunities

- ChatMessage model: Existing model remains, just ensure persona is stamped at creation
- ChatPanel/ChatBubble components: No changes needed to rendering components
- Existing error display patterns: Reuse for error bubbles, just ensure persona is stamped

### Scope Boundaries

**In Scope:**
- Fixing streaming to create one bubble per content event (not growing bubble)
- Stamping `persona: 'Software Architect'` on all /api/v1-sourced messages at creation time
- Removing unused accumulator state/refs (`streamingMessageId`, `streamedContentRef`, etc.)
- Ensuring success/error messages in the Software Architect flow are persona-stamped

**Out of Scope:**
- Message persistence/rehydration changes
- ChatBubble styling changes
- Any backend contract changes
- Any new grouping/aggregation logic for streamed deltas
- Making persona field globally required (keep optional with phase fallback)
- Changes to non-/api/v1 message flows

### Technical Considerations

**Message Creation Pattern:**
- When handling `{type:"content", delta}` events from /api/v1 streams:
  - Create a NEW ChatMessage for each event
  - Explicitly set `persona: 'Software Architect'` at creation time
  - Do NOT look up or mutate existing messages

**State Architecture:**
- Remove streaming accumulation state that is no longer needed
- Each content event results in `addMessage()` (or equivalent), not `updateMessage()`

**Persona Resolution:**
- For /api/v1 paths: Explicit stamping, no fallback
- For other paths: Continue using phase-based fallback (unchanged)

**Streaming Handler Changes:**
- /api/v1 streaming handler must be modified to:
  1. NOT accumulate content
  2. Create new message per content delta
  3. Stamp persona explicitly on every message
