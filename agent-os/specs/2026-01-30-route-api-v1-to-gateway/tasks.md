# Task Breakdown: Route /api/v1 to Gateway via Vite Proxy

## Overview
Total Tasks: 4

This is a small, focused configuration change to add a proxy rule in `frontend/vite.config.ts`. The task breakdown is appropriately sized for this simple change.

## Task List

### Configuration Change

#### Task Group 1: Add /api/v1 Proxy Rule
**Dependencies:** None

- [x] 1.0 Complete proxy configuration update
  - [x] 1.1 Add `/api/v1` proxy rule to `frontend/vite.config.ts`
    - Insert new rule AFTER `/api/chat` and BEFORE `/api` catch-all
    - Target: `chatApiTarget` (existing variable, defaults to `http://localhost:8081`)
    - Options: `changeOrigin: true`, `secure: false`
    - Add comment: `// Gateway v1 API routes - MUST come before /api to match first`
  - [x] 1.2 Verify rule ordering is correct
    - Final order: `/api/chat/stream`, `/api/chat`, `/api/v1`, `/api`
    - Confirm no existing rules were modified
  - [x] 1.3 Verify the change works correctly
    - Start Vite dev server
    - Confirm `/api/v1/*` requests route to Gateway (port 8081)
    - Confirm `/api/chat/*` requests still route to Gateway (port 8081)
    - Confirm other `/api/*` requests still route to model service (port 8080)

**Acceptance Criteria:**
- New `/api/v1` proxy rule exists in `vite.config.ts`
- Rule is positioned before the generic `/api` catch-all
- Rule uses existing `chatApiTarget` variable
- All existing proxy rules remain unchanged
- Vite dev server proxies `/api/v1/*` requests to Gateway correctly

## Reference

**File to modify:** `frontend/vite.config.ts`

**Existing proxy rule pattern (lines 34-38):**
```typescript
'/api/chat': {
  target: chatApiTarget,
  changeOrigin: true,
  secure: false,
},
```

**New rule to add (insert between `/api/chat` and `/api`):**
```typescript
// Gateway v1 API routes - MUST come before /api to match first
'/api/v1': {
  target: chatApiTarget,
  changeOrigin: true,
  secure: false,
},
```

## Execution Order

1. Task Group 1 (single group - all subtasks in sequence)
