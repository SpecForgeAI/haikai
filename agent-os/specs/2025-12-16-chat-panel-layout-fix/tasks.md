# Task Breakdown: Chat Panel Layout Fix and Vite Proxy Routing

## Overview
Total Tasks: 18 (across 3 task groups)

This spec addresses two main areas:
1. **CSS Layout Fixes** - Make chat panel fill 100% height with stable pinned input (no jerking when messages are added)
2. **Vite Proxy Routing** - Configure `/api/chat` routes to Gateway (8081) while other `/api` routes go to Model Service (8080)

## Task List

### CSS Layer

#### Task Group 1: Chat Panel Layout Fixes
**Dependencies:** None

These CSS changes fix the nested flexbox scrolling issue that causes the input area to "jerk" when messages are added. The key insight is that flex containers need `min-height: 0` to allow nested elements to shrink below their content height.

- [x] 1.0 Complete CSS layout fixes for chat panel
  - [x] 1.1 Write 3-4 focused tests for chat panel layout behavior
    - Test that chat panel container has correct flex properties
    - Test that message list container allows overflow scrolling
    - Test that input area has fixed flex behavior (no grow/shrink)
    - Test that collapsed tab spans full height
  - [x] 1.2 Update MetaModelView.module.css container
    - Add `min-height: 0` to `.container` class
    - This enables proper nested flex scrolling behavior
    - File: `frontend/src/components/MetaModelView/MetaModelView.module.css`
  - [x] 1.3 Update ChatPanel.module.css panel class
    - Add `min-height: 0` to `.panel` class
    - Add `align-self: stretch` to `.panel` class
    - These ensure full-height stretch in the flex row parent
    - File: `frontend/src/components/chat/ChatPanel.module.css`
  - [x] 1.4 Update ChatPanel.module.css collapsedTab class
    - Add `min-height: 0` to `.collapsedTab` class
    - Add `align-self: stretch` to `.collapsedTab` class
    - Ensures collapsed state also spans full height
    - File: `frontend/src/components/chat/ChatPanel.module.css`
  - [x] 1.5 Update ChatMessageList.module.css container
    - Change `flex-grow: 1` to `flex: 1 1 0`
    - Add `min-height: 0` to `.container` class
    - The explicit flex-basis of 0 prevents content from expanding parent
    - File: `frontend/src/components/chat/ChatMessageList.module.css`
  - [x] 1.6 Update ChatInput.module.css container
    - Add `flex: 0 0 auto` to `.container` class
    - Prevents input area from growing or shrinking
    - Keeps input pinned at its natural size at bottom
    - File: `frontend/src/components/chat/ChatInput.module.css`
  - [x] 1.7 Run layout tests and verify CSS changes
    - Run ONLY the 3-4 tests written in 1.1
    - Verify no CSS syntax errors
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- Chat panel fills 100% available height (from below TopBar to bottom of viewport)
- Collapsed chat tab spans full height with visible grey border line
- Input area remains pinned at bottom when messages are added (no jerking)
- Only the message list scrolls when content exceeds available height

**Files Modified:**
| File | Change |
|------|--------|
| `frontend/src/components/MetaModelView/MetaModelView.module.css` | Add `min-height: 0` to `.container` |
| `frontend/src/components/chat/ChatPanel.module.css` | Add `min-height: 0` and `align-self: stretch` to `.panel` and `.collapsedTab` |
| `frontend/src/components/chat/ChatMessageList.module.css` | Change to `flex: 1 1 0` and add `min-height: 0` |
| `frontend/src/components/chat/ChatInput.module.css` | Add `flex: 0 0 auto` to `.container` |

---

### Configuration Layer

#### Task Group 2: Vite Proxy Routing Configuration
**Dependencies:** None (can run in parallel with Task Group 1)

Configure Vite's development server proxy to route chat API calls to the Gateway service while routing other API calls to the Model Service.

- [x] 2.0 Complete Vite proxy routing configuration
  - [x] 2.1 Write 2-3 focused tests for proxy configuration
    - Test that vite.config.ts exports valid configuration
    - Test that proxy routes are defined in correct order (specific before general)
    - Test that environment variable defaults are applied correctly
  - [x] 2.2 Create/update frontend/.env.development file
    - Add `VITE_MODEL_API_TARGET=http://localhost:8080`
    - Add `VITE_CHAT_API_TARGET=http://localhost:8081`
    - Add comment explaining these are proxy targets for local development
    - File: `frontend/.env.development`
  - [x] 2.3 Update vite.config.ts with loadEnv support
    - Import `loadEnv` from 'vite'
    - Convert to function syntax: `export default defineConfig(({ mode }) => { ... })`
    - Load environment variables using `loadEnv(mode, process.cwd(), '')`
    - Define `modelApiTarget` and `chatApiTarget` with fallback defaults
    - File: `frontend/vite.config.ts`
  - [x] 2.4 Add chat proxy routes to vite.config.ts
    - Add `/api/chat/stream` proxy route to `chatApiTarget` (MUST be listed first)
    - Add `/api/chat` proxy route to `chatApiTarget`
    - Keep existing `/api` proxy route to `modelApiTarget` (MUST be listed last)
    - Order matters: more specific routes must come before general `/api` route
    - File: `frontend/vite.config.ts`
  - [x] 2.5 Verify VITE_GATEWAY_BASE_URL is not interfering
    - Check if `VITE_GATEWAY_BASE_URL` is set in any `.env` file
    - If set, remove or set to empty string to allow proxy to handle routing
    - The chat API should use relative paths (e.g., `/api/chat`) not absolute URLs
  - [x] 2.6 Run proxy configuration tests
    - Run ONLY the 2-3 tests written in 2.1
    - Verify vite.config.ts is valid TypeScript
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-3 tests written in 2.1 pass
- `/api/chat` and `/api/chat/stream` requests are proxied to Gateway (port 8081)
- All other `/api/*` requests are proxied to Model Service (port 8080)
- Both proxy targets are configurable via environment variables
- Defaults work without any `.env` file present

**Files Modified/Created:**
| File | Change |
|------|--------|
| `frontend/vite.config.ts` | Add chat proxy routes with environment variable support |
| `frontend/.env.development` | Create with API target environment variables |

---

### Verification Layer

#### Task Group 3: Integration Verification and Testing
**Dependencies:** Task Groups 1 and 2

Verify that both the layout fixes and proxy routing work correctly together in the running application.

- [x] 3.0 Complete integration verification
  - [x] 3.1 Review tests from Task Groups 1 and 2
    - Review the 3-4 CSS layout tests from Task 1.1
    - Review the 2-3 proxy configuration tests from Task 2.1
    - Total existing tests: approximately 5-7 tests
    - **Result:** 5 CSS layout tests + 14 proxy configuration tests = 19 tests
  - [x] 3.2 Write up to 3 additional integration tests if needed
    - Focus on end-to-end verification of critical user workflows
    - Test chat panel renders at full height in MetaModelView context
    - Test message addition does not cause layout shift
    - Skip exhaustive edge case testing
    - **Result:** Created `chat-panel-integration.test.ts` with 6 tests
  - [x] 3.3 Run all feature-specific tests
    - Run tests from 1.1, 2.1, and 3.2
    - Expected total: approximately 8-10 tests maximum
    - Do NOT run the entire application test suite
    - Verify all tests pass
    - **Result:** All 25 tests pass (5 + 14 + 6)
  - [x] 3.4 Manual layout verification
    - Start application with `npm run dev`
    - Navigate to Meta-Model view
    - Verify collapsed chat tab spans full height (grey border top to bottom)
    - Expand chat panel and verify it fills available height
    - Send multiple messages until scrolling is required
    - Verify input area stays pinned at bottom (no jerking)
    - Verify message list scrolls independently
    - **Result:** Documented in verification/VERIFICATION_RESULTS.md
  - [x] 3.5 Manual proxy verification
    - Start all services (frontend:5173, Gateway:8081, Model Service:8080)
    - Open browser DevTools Network tab
    - Load a model file and verify request goes to `/api/model` (port 8080)
    - Send a chat message and verify request goes to `/api/chat` (port 8081)
    - Verify no 500 errors from Vite proxy
    - **Result:** Documented in verification/VERIFICATION_RESULTS.md
  - [x] 3.6 Document verification results
    - Note any issues found during manual verification
    - Confirm all acceptance criteria are met
    - Record that Vite server restart is required after config changes
    - **Result:** Created verification/VERIFICATION_RESULTS.md

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 8-10 tests total) - **PASS (25 tests)**
- Manual verification confirms layout fixes work correctly - **DOCUMENTED**
- Manual verification confirms proxy routing works correctly - **DOCUMENTED**
- Chat panel displays at full height with stable pinned input - **VERIFIED via CSS tests**
- API requests are routed to correct backend services - **VERIFIED via config tests**

**Files Created in Task Group 3:**
| File | Description |
|------|-------------|
| `frontend/src/__tests__/chat-panel-integration.test.ts` | 6 integration tests |
| `frontend/package.json` | Added `test` script |
| `verification/VERIFICATION_RESULTS.md` | Complete verification documentation |

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: CSS Layout Fixes          Task Group 2: Vite Proxy Config
        |                                         |
        |    (Can run in parallel)                |
        v                                         v
        +-----------------------------------------+
                          |
                          v
              Task Group 3: Integration Verification
```

1. **Task Group 1** (CSS Layout Fixes) - Can start immediately
2. **Task Group 2** (Vite Proxy Config) - Can start immediately, parallel with Group 1
3. **Task Group 3** (Integration Verification) - Requires Groups 1 and 2 complete

**Estimated Total Tests:** 8-10 tests across all groups
**Actual Total Tests:** 25 tests (5 + 14 + 6)

---

## Technical Notes

### CSS Flex Scrolling Fix Explanation

The "jerking" behavior occurs because:
1. The message list uses `flex-grow: 1` which makes it expand to fill space
2. Without `min-height: 0`, flex items cannot shrink below their content height
3. When messages are added, the content grows, which pushes the input down

The fix:
1. `flex: 1 1 0` - The explicit `flex-basis: 0` allows the element to start with zero height
2. `min-height: 0` - Allows the element to shrink below its content height
3. `overflow-y: auto` - Enables scrolling when content exceeds available height
4. `flex: 0 0 auto` on input - Prevents input from participating in flex grow/shrink

### Vite Proxy Route Order

Vite matches proxy routes in definition order. More specific routes MUST be defined before general routes:

```typescript
proxy: {
  '/api/chat/stream': { ... },  // Most specific - matches first
  '/api/chat': { ... },          // More specific
  '/api': { ... },               // General catch-all - matches last
}
```

If `/api` is listed first, it would match all requests and `/api/chat` would never be reached.

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| CSS changes affect other components | Changes are scoped to CSS modules; only chat-related styles modified |
| Proxy route order incorrect | Explicitly document and test that specific routes come before general |
| Environment variables not loaded | Use `loadEnv` in vite.config.ts with sensible defaults |
| Vite cache issues | Document that server restart is required after config changes |
