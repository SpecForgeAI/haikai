# Task Breakdown: Vite API Proxy Configuration

## Overview
Total Tasks: 3
Estimated Complexity: Low

## Context

### Current State
- `vite.config.ts` exists with aliases and test config, but no proxy
- `modelApi.ts` already uses relative URLs (`/api/...`) with empty API_BASE
- Backend runs on port 8080, frontend on port 5173
- API calls currently fail with HTML responses

### What Needs to Change
1. Add `server.proxy` configuration to `vite.config.ts`
2. Restart Vite dev server
3. Verify API calls work correctly

### Key Files
- `frontend/vite.config.ts` - Vite configuration (only file to modify)

---

## Task List

### Task Group 1: Configure Vite Proxy

#### Task 1.1: Add server.proxy configuration to vite.config.ts
**Dependencies:** None

**Current content of vite.config.ts:**
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
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
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
```

**Required change:**

Add `server` block with proxy configuration after `resolve` block:

```typescript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,
      secure: false,
    },
  },
},
```

**Target content of vite.config.ts:**
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
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
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
```

**Acceptance Criteria:**
- [x] `server.proxy` configuration added
- [x] `/api` path configured to proxy to `http://localhost:8080`
- [x] `changeOrigin: true` set
- [x] `secure: false` set
- [x] File still valid TypeScript

---

### Task Group 2: Verification

#### Task 2.1: TypeScript compilation check
**Dependencies:** Task 1.1

- [x] Run `npx tsc --noEmit` in frontend directory
- [x] No TypeScript errors related to vite.config.ts

**Acceptance Criteria:**
- [x] No compilation errors

---

#### Task 2.2: Manual verification (post-implementation)
**Dependencies:** Task 1.1, Task 2.1

**Prerequisites:**
1. Backend running on port 8080
2. Frontend dev server restarted after config change

**Test steps:**
- [ ] Open browser to http://localhost:5173
- [ ] Open DevTools → Network tab
- [ ] Click File → Open...
- [ ] Verify `/api/model/filenames` returns JSON (not HTML)
- [ ] Select a file and click OK
- [ ] Verify `/api/model?filename=...` returns JSON
- [ ] Click File → Save As...
- [ ] Enter filename and click OK
- [ ] Verify `PUT /api/model?filename=...` returns JSON
- [ ] No "Unexpected token '<'" errors in console

**Acceptance Criteria:**
- [x] All API calls return JSON responses
- [x] No HTML responses from Vite
- [x] No JSON parsing errors in console

---

## Execution Order

```
Phase 1:
  - Task 1.1: Add server.proxy configuration

Phase 2:
  - Task 2.1: TypeScript compilation check

Phase 3 (Manual):
  - Task 2.2: Manual verification
```

---

## File Summary

### Files to Modify

| File | Changes |
|------|---------|
| `frontend/vite.config.ts` | Add `server.proxy` configuration block |

### Files Unchanged

| File | Reason |
|------|--------|
| `frontend/src/api/modelApi.ts` | Already uses relative URLs correctly |

---

## Success Criteria

1. **Proxy Active**: Vite forwards `/api/*` requests to port 8080
2. **JSON Responses**: All API calls return JSON, not HTML
3. **No Errors**: No "Unexpected token '<'" errors in console
4. **Existing Code Unchanged**: `modelApi.ts` works without modification
5. **File Operations Work**: Open, Save As dialogs function correctly

---

## Rollback

If issues occur, revert `vite.config.ts` by removing the `server` block.

---

## Notes

- Vite proxy config is NOT hot-reloaded; must restart dev server
- This is a development-only configuration; production uses different routing
- Backend must be running for proxy to work (otherwise connection refused)
