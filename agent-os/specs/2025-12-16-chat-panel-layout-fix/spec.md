# Spec: Chat Panel Layout Fix and Vite Proxy Routing

## Overview

Fix two issues with the frontend chat panel:
1. **Layout:** Chat panel should consume 100% available height with a stable pinned input area (no "jerking" when messages are added)
2. **Proxy:** Vite proxy routing should route `/api/chat` to Gateway (8081) while routing all other `/api` calls to architecture-model-service (8080)

## Problem Statement

### Current State

**Layout Issues:**
- The chat panel and message list may not properly stretch to full available height
- The input area may "jerk" or shift when new messages are added (flex-grow causing parent to expand rather than message list scrolling)
- Missing `min-height: 0` on flex containers prevents proper nested scrolling behavior
- Collapsed tab may not show a consistent full-height visual indicator

**Proxy Issues:**
- Current `vite.config.ts` proxies ALL `/api/*` calls to port 8080 (architecture-model-service)
- Chat API calls to `/api/chat` should go to Gateway on port 8081
- No separate configuration for chat vs model API targets

### Desired State

**Layout:**
- Chat panel fills 100% available height (from below TopBar to bottom of viewport)
- Message list is the only element that scrolls - input area stays pinned at bottom
- Adding messages never pushes the input area down (no jerking)
- Collapsed tab shows a full-height visual indicator (grey line spanning entire height)

**Proxy:**
- `/api/chat` and `/api/chat/stream` → Gateway (8081)
- All other `/api/*` → architecture-model-service (8080)
- Both targets configurable via environment variables

## Requirements

### Functional Requirements

#### 1. Chat Panel Layout Fixes

##### 1.1 MetaModelView Container

The `.container` class already has `height: 100%`, which inherits from `.main-content` in App.css (`height: calc(100vh - 60px)`). This is correct.

**Add `min-height: 0`** to enable proper nested flex scrolling:

```css
/* MetaModelView.module.css */
.container {
  display: flex;
  flex-direction: row;
  height: 100%;
  overflow: hidden;
  min-height: 0;  /* ADD: critical for nested flex scroll */
}
```

##### 1.2 ChatPanel Component Styles

Update `.panel` and `.collapsedTab` styles to ensure full-height stretch:

**Expanded Panel (`.panel`):**
```css
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;           /* ADD: critical for nested scroll */
  border-right: 1px solid #e0e0e0;
  background: white;
  position: relative;
  flex-shrink: 0;
  align-self: stretch;     /* ADD: ensure full height in flex row */
}
```

**Collapsed Tab (`.collapsedTab`):**
```css
.collapsedTab {
  width: 32px;
  height: 100%;
  min-height: 0;           /* ADD: support full height */
  align-self: stretch;     /* ADD: ensure full height in flex row */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 16px;
  gap: 8px;
  background: #f5f5f5;
  border-right: 1px solid #e0e0e0;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}
```

##### 1.3 Message List - Scrollable Region

The message list must be the only element that grows and scrolls. Update `ChatMessageList.module.css`:

```css
.container {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;             /* CHANGE: flex-grow:1, flex-shrink:1, flex-basis:0 */
  min-height: 0;           /* ADD: critical for scroll to work */
  overflow-y: auto;
  padding: 12px;
}
```

Key changes:
- `flex: 1 1 0` instead of `flex-grow: 1` - explicit basis of 0 prevents content from expanding parent
- `min-height: 0` - allows the container to shrink below its content height, enabling overflow scroll

##### 1.4 Input Area - Pinned at Bottom

The input area must NOT grow - it should remain fixed size at the bottom. Update `ChatInput.module.css`:

```css
.container {
  flex: 0 0 auto;          /* ADD: no grow, no shrink, auto size */
  border-top: 1px solid #e0e0e0;
  padding: 12px;
}
```

Key changes:
- `flex: 0 0 auto` - prevents the input from growing or shrinking, keeps it at its natural size

##### 1.5 Auto-Scroll Behavior

The current implementation in `ChatMessageList.tsx` already handles auto-scroll correctly:
- Tracks whether user has scrolled up
- Only auto-scrolls if user is at/near bottom

No changes needed to auto-scroll logic.

#### 2. Vite Proxy Routing

##### 2.1 Environment Variables

Add two environment variables for API targets. Create/update `.env.development`:

```env
# API Proxy Targets
VITE_MODEL_API_TARGET=http://localhost:8080
VITE_CHAT_API_TARGET=http://localhost:8081
```

Defaults should be provided in `vite.config.ts` if not set.

##### 2.2 Update vite.config.ts

Update proxy configuration with correct precedence (more specific routes first):

```typescript
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Load env file based on mode
  const env = loadEnv(mode, process.cwd(), '')

  const modelApiTarget = env.VITE_MODEL_API_TARGET || 'http://localhost:8080'
  const chatApiTarget = env.VITE_CHAT_API_TARGET || 'http://localhost:8081'

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@components': path.resolve(__dirname, './src/components'),
        '@contexts': path.resolve(__dirname, './src/contexts'),
        '@types': path.resolve(__dirname, './src/types'),
        '@utils': path.resolve(__dirname, './src/utils'),
        '@config': path.resolve(__dirname, './src/config'),
      },
    },
    server: {
      proxy: {
        // Chat routes - MUST come before /api to match first
        '/api/chat/stream': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        '/api/chat': {
          target: chatApiTarget,
          changeOrigin: true,
          secure: false,
        },
        // All other /api routes
        '/api': {
          target: modelApiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
    },
  }
})
```

**Key points:**
- Use `loadEnv` to read environment variables in config
- `/api/chat/stream` and `/api/chat` routes listed BEFORE `/api` for correct matching precedence
- Defaults provided for local development

##### 2.3 Frontend Chat API - Relative Paths

The current `chatApi.ts` already uses relative paths correctly:

```typescript
const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';
// Results in: fetch('/api/chat', ...)
```

**Verify** that `VITE_GATEWAY_BASE_URL` is NOT set in any `.env` file (it should remain empty so the proxy handles routing).

If `VITE_GATEWAY_BASE_URL` is set, it should be removed or set to empty string:

```env
# Remove or comment out:
# VITE_GATEWAY_BASE_URL=http://localhost:8081  # DON'T DO THIS

# Correct: leave unset or empty
VITE_GATEWAY_BASE_URL=
```

### Non-Functional Requirements

1. **No Jerking:** Input area must remain visually stable when messages are added
2. **Smooth Scrolling:** Message list scrolling should be smooth
3. **Restart Required:** Vite server must be restarted after config changes (document in verification steps)

## Technical Design

### Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/MetaModelView/MetaModelView.module.css` | Add `min-height: 0` to `.container` |
| `frontend/src/components/chat/ChatPanel.module.css` | Add `min-height: 0` and `align-self: stretch` to `.panel` and `.collapsedTab` |
| `frontend/src/components/chat/ChatMessageList.module.css` | Change to `flex: 1 1 0` and add `min-height: 0` |
| `frontend/src/components/chat/ChatInput.module.css` | Add `flex: 0 0 auto` to `.container` |
| `frontend/vite.config.ts` | Add chat proxy routes with environment variable support |

### Files to Create

| File | Description |
|------|-------------|
| `frontend/.env.development` | Environment variables for local development (if not exists) |

### CSS Changes Summary

```
┌─────────────────────────────────────────────────────────────┐
│  .main-content (App.css)                                    │
│  height: calc(100vh - 60px)                                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ .container (MetaModelView)                            │  │
│  │ display: flex; flex-direction: row;                   │  │
│  │ height: 100%; min-height: 0; ← ADD                    │  │
│  │ ┌──────────────┐ ┌──────────────────────────────────┐ │  │
│  │ │ ChatPanel    │ │ .mainContent                     │ │  │
│  │ │ .panel       │ │ (grid area)                      │ │  │
│  │ │ height: 100% │ │                                  │ │  │
│  │ │ min-height:0 │ │                                  │ │  │
│  │ │ align-self:  │ │                                  │ │  │
│  │ │   stretch    │ │                                  │ │  │
│  │ │ ┌──────────┐ │ │                                  │ │  │
│  │ │ │ Header   │ │ │                                  │ │  │
│  │ │ │ flex:0 0 │ │ │                                  │ │  │
│  │ │ │ auto     │ │ │                                  │ │  │
│  │ │ ├──────────┤ │ │                                  │ │  │
│  │ │ │ Messages │ │ │                                  │ │  │
│  │ │ │ flex:1 1 │ │ │                                  │ │  │
│  │ │ │ 0        │ │ │                                  │ │  │
│  │ │ │ min-h: 0 │ │ │                                  │ │  │
│  │ │ │ overflow │ │ │                                  │ │  │
│  │ │ │ -y: auto │ │ │                                  │ │  │
│  │ │ ├──────────┤ │ │                                  │ │  │
│  │ │ │ Input    │ │ │                                  │ │  │
│  │ │ │ flex:0 0 │ │ │                                  │ │  │
│  │ │ │ auto     │ │ │                                  │ │  │
│  │ │ └──────────┘ │ │                                  │ │  │
│  │ └──────────────┘ └──────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Proxy Routing Diagram

```
Browser (localhost:5173)
        │
        ├─── POST /api/chat ──────────────► Gateway (localhost:8081)
        │
        ├─── GET /api/chat/stream ────────► Gateway (localhost:8081)
        │
        ├─── GET /api/model/filenames ────► Model Service (localhost:8080)
        │
        ├─── GET /api/model ──────────────► Model Service (localhost:8080)
        │
        └─── PUT /api/model ──────────────► Model Service (localhost:8080)
```

## Out of Scope

- Backend/Gateway fixes (assume Gateway works once requests reach it)
- SSE streaming UI implementation changes
- Chat panel functionality changes (only layout/styling)
- Authentication/authorization

## Acceptance Criteria

### Layout

1. **Full Height:**
   - Collapsed chat tab spans the full height from below TopBar to bottom of viewport
   - Expanded chat panel fills the full available height

2. **No Jerking:**
   - Adding messages does NOT push the input area down
   - Input area remains visually stable at the bottom of the panel
   - Only the message list scrolls when messages are added

3. **Scrolling:**
   - Message list scrolls independently when content exceeds available height
   - Input area and header remain fixed (do not scroll with messages)

### Proxy

4. **Chat Routes:**
   - `POST /api/chat` is proxied to `http://localhost:8081`
   - `GET /api/chat/stream` is proxied to `http://localhost:8081`
   - Network tab in DevTools shows requests going to correct backend

5. **Model Routes:**
   - `GET /api/model/filenames` is proxied to `http://localhost:8080`
   - `GET /api/model` is proxied to `http://localhost:8080`
   - `PUT /api/model` is proxied to `http://localhost:8080`

6. **Configuration:**
   - Both targets are configurable via `VITE_MODEL_API_TARGET` and `VITE_CHAT_API_TARGET`
   - Defaults work without any `.env` file

## Verification Steps

### Layout Verification

1. Start the application: `npm run dev`
2. Navigate to Meta-Model view
3. Verify collapsed chat tab:
   - Grey border line spans full height (top to bottom of content area)
4. Click to expand chat panel
5. Verify expanded panel fills full height
6. Send multiple messages (enough to require scrolling)
7. Verify:
   - Message list scrolls to show new messages
   - Input area stays pinned at bottom (no movement/jerking)
   - Header stays pinned at top
8. Manually scroll up in message list, then send another message
9. Verify auto-scroll behavior (should scroll to bottom unless user scrolled up)

### Proxy Verification

1. Start all services:
   - `npm run dev` (frontend on 5173)
   - Gateway on 8081
   - architecture-model-service on 8080
2. Open browser DevTools → Network tab
3. Test model API:
   - Load a model file from File menu
   - Verify request URL is `/api/model?filename=...`
   - Verify no 500 error from Vite
4. Test chat API:
   - Open chat panel and send a message
   - Verify request URL is `/api/chat`
   - Verify request reaches Gateway (response includes sessionId)
5. Verify environment variables:
   - Change `VITE_CHAT_API_TARGET` in `.env.development`
   - Restart Vite server
   - Verify chat requests go to new target

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Vite proxy order matters | Medium | High | List specific routes before general /api route |
| CSS changes break other components | Low | Medium | Changes are scoped to chat-related CSS modules |
| Environment variables not loaded | Low | Medium | Use `loadEnv` in vite.config.ts |
| Restart required after config change | Low | Low | Document in verification steps |
