# Task Breakdown: Frontend Chat Panel (Meta-Model View)

## Overview
Total Tasks: 27

This feature adds a collapsible, resizable left-hand Chat Assistant panel to the Meta-Model view, integrated with the Gateway chat endpoint (POST /api/chat), with session persistence and distinct user/assistant message styling.

## Task List

### API Layer

#### Task Group 1: Chat API Client
**Dependencies:** None

- [x] 1.0 Complete Chat API client
  - [x] 1.1 Write 4 focused tests for chatApi.ts functionality
    - Test postChatMessage sends correct request payload (message + sessionId)
    - Test postChatMessage handles successful response and parses JSON
    - Test postChatMessage throws on non-OK response status
    - Test postChatMessage works without sessionId on first request
  - [x] 1.2 Create TypeScript interfaces for chat API
    - File: `frontend/src/api/chatApi.ts`
    - Define ChatRequest interface (sessionId?: string, message: string)
    - Define ChatResponse interface (sessionId, assistant.message, assistant.artifacts?)
    - Define ChatMessage interface (id, role, content, timestamp)
  - [x] 1.3 Implement postChatMessage function
    - Use GATEWAY_BASE from import.meta.env.VITE_GATEWAY_BASE_URL
    - POST to /api/chat with JSON body
    - Handle error responses with descriptive error messages
    - Follow existing pattern from `frontend/src/api/modelApi.ts`
  - [x] 1.4 Ensure API client tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify request/response handling works correctly

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- postChatMessage correctly sends requests and parses responses
- Error handling works for failed requests
- TypeScript interfaces match spec requirements

### UI Components - Foundation

#### Task Group 2: ChatBubble Component
**Dependencies:** None (can run parallel to Task Group 1)

- [x] 2.0 Complete ChatBubble component
  - [x] 2.1 Write 4 focused tests for ChatBubble component
    - Test user bubble renders with correct green background (#E6F4EA)
    - Test assistant bubble renders with correct grey background (#F1F1F1)
    - Test user bubble is right-aligned (align-self: flex-end)
    - Test assistant bubble is left-aligned (align-self: flex-start)
  - [x] 2.2 Create ChatBubble.tsx component
    - File: `frontend/src/components/chat/ChatBubble.tsx`
    - Props: message (ChatMessage type with id, role, content, timestamp)
    - Render content text
    - Apply role-based styling via CSS module classes
  - [x] 2.3 Create ChatBubble.module.css styles
    - File: `frontend/src/components/chat/ChatBubble.module.css`
    - Base bubble styles: max-width 80%, padding 10px 14px, font-size 14px
    - User message: background #E6F4EA, align-self flex-end, border-radius 12px 12px 4px 12px
    - Assistant message: background #F1F1F1, align-self flex-start, border-radius 12px 12px 12px 4px
    - Text color: #1a1a1a for both
    - Margin: 4px 0
  - [x] 2.4 Ensure ChatBubble tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify styling matches spec requirements

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- User bubbles are green (#E6F4EA) and right-aligned
- Assistant bubbles are grey (#F1F1F1) and left-aligned
- Border radius creates correct "tail" effect on each bubble type

#### Task Group 3: ChatInput Component
**Dependencies:** None (can run parallel to Task Groups 1-2)

- [x] 3.0 Complete ChatInput component
  - [x] 3.1 Write 5 focused tests for ChatInput component
    - Test Send button is disabled when textarea is empty
    - Test Send button is disabled when textarea contains only whitespace
    - Test Send button is enabled when textarea has content
    - Test onSend callback is triggered with message content on button click
    - Test textarea clears after successful send
  - [x] 3.2 Create ChatInput.tsx component
    - File: `frontend/src/components/chat/ChatInput.tsx`
    - Props: onSend (callback with message string), disabled (boolean for loading state)
    - State: message (controlled textarea value)
    - Textarea: placeholder "Type a message...", 3 rows default
    - Send button: triggers onSend, disabled when empty/whitespace or loading
  - [x] 3.3 Create ChatInput.module.css styles
    - File: `frontend/src/components/chat/ChatInput.module.css`
    - Container: border-top 1px solid #e0e0e0, padding 12px
    - Textarea: min-height 60px, max-height 150px, resize vertical, border 1px solid #ddd, border-radius 8px, padding 10px
    - Send button: background #1976D2, color white, padding 8px 16px, border-radius 6px, right-aligned
    - Disabled state: opacity 0.5, cursor not-allowed
  - [x] 3.4 Ensure ChatInput tests pass
    - Run ONLY the 5 tests written in 3.1
    - Verify button enable/disable logic works correctly

**Acceptance Criteria:**
- The 5 tests written in 3.1 pass
- Textarea is multiline with vertical resize
- Send button properly enables/disables based on content
- onSend callback receives trimmed message content

#### Task Group 4: ChatMessageList Component
**Dependencies:** Task Group 2 (ChatBubble)

- [x] 4.0 Complete ChatMessageList component
  - [x] 4.1 Write 3 focused tests for ChatMessageList component
    - Test renders multiple ChatBubble components for array of messages
    - Test messages are rendered in correct order (oldest first)
    - Test auto-scrolls to bottom when new message is added
  - [x] 4.2 Create ChatMessageList.tsx component
    - File: `frontend/src/components/chat/ChatMessageList.tsx`
    - Props: messages (array of ChatMessage)
    - Map messages to ChatBubble components with proper keys
    - Use useRef for scroll container, useEffect for auto-scroll behavior
    - Track user scroll position to avoid auto-scroll when user scrolled up
  - [x] 4.3 Add ChatMessageList styles (inline or module)
    - Flex container: display flex, flex-direction column
    - Flex-grow: 1 (take remaining vertical space)
    - Overflow-y: auto (scrollable)
    - Padding: 12px
  - [x] 4.4 Ensure ChatMessageList tests pass
    - Run ONLY the 3 tests written in 4.1
    - Verify message rendering and scroll behavior

**Acceptance Criteria:**
- The 3 tests written in 4.1 pass
- Messages render in chronological order
- Container scrolls independently
- Auto-scroll to bottom on new messages (unless user scrolled up)

### UI Components - Main Panel

#### Task Group 5: ChatPanel Component (Core)
**Dependencies:** Task Groups 1-4

- [x] 5.0 Complete ChatPanel component core functionality
  - [x] 5.1 Write 6 focused tests for ChatPanel component
    - Test panel renders in collapsed state by default
    - Test clicking collapsed tab expands panel to 320px width
    - Test clicking collapse button collapses panel back to tab
    - Test resize handle changes panel width via drag
    - Test width respects min (240px) and max (50% viewport) constraints
    - Test sending message triggers API call and displays response
  - [x] 5.2 Create ChatPanel.tsx component structure
    - File: `frontend/src/components/chat/ChatPanel.tsx`
    - State: isCollapsed (default true), width (default 320), sessionId, messages, isLoading
    - Collapsed view: 32px wide vertical tab with chat icon and "Chat" label
    - Expanded view: header, message list, input area
  - [x] 5.3 Implement collapse/expand functionality
    - Collapsed state: render slim tab (32px width) with click handler to expand
    - Expanded state: render full panel with collapse button in header
    - Preserve width across collapse/expand cycles
  - [x] 5.4 Implement resize functionality
    - Add resize handle on right edge of panel (6px wide, cursor: col-resize)
    - Track mouse drag to update width
    - Enforce min-width 240px and max-width 50% viewport
    - Use requestAnimationFrame or CSS transitions for smooth resize
  - [x] 5.5 Implement chat message flow
    - On send: add user message to state, clear input, set isLoading true
    - Call postChatMessage with message and sessionId
    - On success: store sessionId, add assistant message to state
    - On error: add error message or show inline error
    - Reset isLoading to false
  - [x] 5.6 Ensure ChatPanel tests pass
    - Run ONLY the 6 tests written in 5.1
    - Verify collapse/expand, resize, and chat flow work correctly

**Acceptance Criteria:**
- The 6 tests written in 5.1 pass
- Panel defaults to collapsed state
- Collapse/expand works with preserved width
- Resize works within constraints (240px to 50% viewport)
- Chat messages flow correctly with API integration

#### Task Group 6: ChatPanel Styling
**Dependencies:** Task Group 5

- [x] 6.0 Complete ChatPanel styling
  - [x] 6.1 Create ChatPanel.module.css
    - File: `frontend/src/components/chat/ChatPanel.module.css`
    - Panel container: display flex, flex-direction column, height 100%, border-right 1px solid #e0e0e0
    - Collapsed tab: width 32px, writing-mode vertical-rl, cursor pointer, background #f5f5f5
    - Header: height 48px, padding 0 12px, display flex, align-items center, justify-content space-between, border-bottom 1px solid #e0e0e0
    - Header title: font-size 16px, font-weight 600
    - Collapse button: icon button, 32px x 32px
    - Resize handle: position absolute, right 0, width 6px, height 100%, cursor col-resize
  - [x] 6.2 Add hover and interaction states
    - Collapsed tab hover: background #e8e8e8
    - Resize handle hover: background rgba(25, 118, 210, 0.1)
    - Resize handle active: background rgba(25, 118, 210, 0.2)
  - [x] 6.3 Add chat icon for collapsed tab
    - Use SVG icon or Unicode character for chat bubble
    - Position above "Chat" text in vertical tab
  - [x] 6.4 Verify visual appearance matches spec
    - Collapsed tab is 32px wide with chat icon and "Chat" label
    - Expanded panel has header "Chat Assistant" with collapse button
    - Overall styling is consistent with existing app design

**Acceptance Criteria:**
- Panel visually matches spec mockup
- Collapsed tab clearly indicates clickability
- Resize handle has appropriate visual feedback
- Styling is consistent with existing application design

### Integration

#### Task Group 7: MetaModelView Integration
**Dependencies:** Task Groups 5-6

- [x] 7.0 Integrate ChatPanel into MetaModelView
  - [x] 7.1 Write 3 focused integration tests
    - Test ChatPanel renders in MetaModelView when on Meta-Model route
    - Test ChatPanel does NOT render in DiagramsView
    - Test layout adjusts correctly when ChatPanel is expanded/collapsed
  - [x] 7.2 Modify MetaModelView.tsx layout structure
    - File: `frontend/src/components/MetaModelView/MetaModelView.tsx`
    - Wrap existing content in mainContent div
    - Add ChatPanel as first child of container
    - Update container to flex-direction: row
  - [x] 7.3 Update MetaModelView.module.css
    - File: `frontend/src/components/MetaModelView/MetaModelView.module.css`
    - Change .container flex-direction from column to row
    - Add .mainContent wrapper: flex-direction column, flex 1, overflow hidden
    - Ensure existing styles work within new mainContent wrapper
  - [x] 7.4 Create component index.ts for exports
    - File: `frontend/src/components/chat/index.ts`
    - Export ChatPanel (main component)
    - Export ChatBubble, ChatMessageList, ChatInput (for potential reuse)
  - [x] 7.5 Verify panel position is below TopBar (60px from top)
    - Ensure panel top edge aligns with Meta-Model content area
    - Panel should not overlap TopBar header
  - [x] 7.6 Ensure integration tests pass
    - Run ONLY the 3 tests written in 7.1
    - Verify layout integration works correctly

**Acceptance Criteria:**
- The 3 tests written in 7.1 pass
- ChatPanel appears in Meta-Model view only
- Panel is positioned correctly (left side, below TopBar)
- Layout responds correctly to panel expand/collapse
- Existing MetaModelView functionality is preserved

### Testing

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 4 tests from chatApi (Task 1.1)
    - Review the 4 tests from ChatBubble (Task 2.1)
    - Review the 5 tests from ChatInput (Task 3.1)
    - Review the 3 tests from ChatMessageList (Task 4.1)
    - Review the 6 tests from ChatPanel (Task 5.1)
    - Review the 3 tests from MetaModelView integration (Task 7.1)
    - Total existing tests: 25 tests
  - [x] 8.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows lacking test coverage
    - Focus on end-to-end chat flows and edge cases
    - Prioritize session persistence across multiple messages
    - Check error handling scenarios
  - [x] 8.3 Write up to 8 additional strategic tests maximum
    - Test session ID is reused across multiple message exchanges
    - Test error state displays appropriate error message to user
    - Test loading state disables input during API call
    - Test keyboard Enter key submits message (if applicable)
    - Test long messages display correctly with text wrapping
    - Additional tests only if critical gaps identified
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to chat panel feature (from 1.1, 2.1, 3.1, 4.1, 5.1, 7.1, and 8.3)
    - Expected total: approximately 33 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 33 tests total)
- Critical user workflows for chat panel are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on chat panel feature requirements

## Execution Order

Recommended implementation sequence:

1. **Parallel Phase 1** (can be done simultaneously):
   - Task Group 1: Chat API Client
   - Task Group 2: ChatBubble Component
   - Task Group 3: ChatInput Component

2. **Sequential Phase 2** (depends on Phase 1):
   - Task Group 4: ChatMessageList Component (depends on Task Group 2)

3. **Sequential Phase 3** (depends on Phase 2):
   - Task Group 5: ChatPanel Component Core (depends on Task Groups 1-4)

4. **Sequential Phase 4** (depends on Phase 3):
   - Task Group 6: ChatPanel Styling (depends on Task Group 5)

5. **Sequential Phase 5** (depends on Phase 4):
   - Task Group 7: MetaModelView Integration (depends on Task Groups 5-6)

6. **Final Phase**:
   - Task Group 8: Test Review and Gap Analysis (depends on Task Groups 1-7)

## Files Summary

### Files to Create:
| File | Task Group |
|------|------------|
| `frontend/src/api/chatApi.ts` | 1 |
| `frontend/src/components/chat/ChatBubble.tsx` | 2 |
| `frontend/src/components/chat/ChatBubble.module.css` | 2 |
| `frontend/src/components/chat/ChatInput.tsx` | 3 |
| `frontend/src/components/chat/ChatInput.module.css` | 3 |
| `frontend/src/components/chat/ChatMessageList.tsx` | 4 |
| `frontend/src/components/chat/ChatPanel.tsx` | 5 |
| `frontend/src/components/chat/ChatPanel.module.css` | 6 |
| `frontend/src/components/chat/index.ts` | 7 |

### Files to Modify:
| File | Task Group |
|------|------------|
| `frontend/src/components/MetaModelView/MetaModelView.tsx` | 7 |
| `frontend/src/components/MetaModelView/MetaModelView.module.css` | 7 |

## Visual Reference

The chat panel position must align with the red line shown in the spec's reference image (`chat_panel_position_red_line.png`), placing the panel's top edge 60px from the viewport top (below the TopBar).
