# Spec: Vite API Proxy Configuration

## Overview

Configure Vite's development server proxy to route all `/api` requests to the Java backend running on port 8080, eliminating 404 errors and HTML-as-JSON parsing failures.

## Problem Statement

### Current Behavior
- Frontend runs on Vite dev server at `localhost:5173`
- Backend runs on Java/Spring Boot at `localhost:8080`
- API calls use relative URLs (e.g., `fetch("/api/model/filenames")`)
- Without proxy configuration, these requests go to port 5173
- Vite returns `index.html` for unknown routes (SPA fallback)
- JSON parsing fails with: `"Unexpected token '<' ... is not valid JSON"`

### Root Cause
The `vite.config.ts` has no `server.proxy` configuration. Requests to `/api/*` are handled by Vite itself, which returns HTML instead of forwarding to the backend.

## Solution

Add a development server proxy configuration to `vite.config.ts` that forwards all `/api` requests to `http://localhost:8080`.

## Requirements

### Functional Requirements

1. **Proxy Configuration**
   - All requests matching `/api/*` must be forwarded to `http://localhost:8080`
   - Original path must be preserved (e.g., `/api/model` → `http://localhost:8080/api/model`)
   - Request headers, body, and method must be preserved
   - Response from backend must be returned unchanged to the browser

2. **No Code Changes to API Client**
   - The existing `modelApi.ts` already uses relative URLs correctly
   - No changes needed to fetch calls or API_BASE configuration

3. **Production Compatibility**
   - Relative URLs (`/api/...`) continue to work in production
   - No hard-coded localhost URLs in application code

### Non-Functional Requirements

1. **Developer Experience**
   - Proxy works automatically after Vite restart
   - No additional environment variables required for local development
   - Clear error messages if backend is unavailable

## Technical Design

### File Changes

#### `frontend/vite.config.ts`

Add `server.proxy` configuration:

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

### Configuration Explanation

| Option | Value | Purpose |
|--------|-------|---------|
| `target` | `http://localhost:8080` | Backend server URL |
| `changeOrigin` | `true` | Sets `Host` header to target origin (required for some backends) |
| `secure` | `false` | Allows proxying to non-HTTPS targets |

### Request Flow

```
Browser                    Vite (5173)                 Backend (8080)
   |                           |                            |
   |-- GET /api/model -------->|                            |
   |                           |-- GET /api/model --------->|
   |                           |                            |
   |                           |<-- 200 OK {json} ----------|
   |<-- 200 OK {json} ---------|                            |
```

## Affected Files

| File | Change Type | Description |
|------|-------------|-------------|
| `frontend/vite.config.ts` | Modify | Add server.proxy configuration |

## Out of Scope

- Backend controller changes
- API endpoint path changes
- Request/response payload changes
- Production deployment configuration
- HTTPS/SSL configuration

## Verification

### Manual Testing Steps

1. Start backend: `cd architecture-model-service && mvn spring-boot:run`
2. Restart frontend: Stop Vite, then `cd frontend && npm run dev`
3. Open browser to `http://localhost:5173`
4. Open browser DevTools → Network tab
5. Click File → Open...
6. Verify:
   - Request URL shows `/api/model/filenames`
   - Response is JSON array (not HTML)
   - No console errors about JSON parsing
7. Select a file and click OK
8. Verify:
   - Request URL shows `/api/model?filename=...`
   - Response is JSON object (not HTML)
   - Model loads correctly in the UI
9. Click File → Save As...
10. Enter a filename and click OK
11. Verify:
    - Request URL shows `PUT /api/model?filename=...`
    - Response is JSON (not HTML)
    - No errors in console

### Expected Network Behavior

| Action | Request | Expected Response |
|--------|---------|-------------------|
| Open dialog | `GET /api/model/filenames` | `200 OK` with `[{id, filename, ...}]` |
| Load model | `GET /api/model?filename=X` | `200 OK` with `{metamodel, entities, ...}` |
| Save model | `PUT /api/model?filename=X` | `200 OK` with `{id, filename, ...}` |

### Error Scenarios to Test

1. **Backend not running**
   - Expected: Network error (connection refused)
   - Not: HTML response or 404

2. **Invalid filename**
   - Expected: Backend error response (404 or 400)
   - Not: HTML from Vite

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Forgot to restart Vite | High | Proxy not active | Document in verification steps |
| Backend port changes | Low | Proxy fails | Use environment variable if needed |
| CORS issues | Low | Blocked requests | changeOrigin: true handles this |

## Success Criteria

1. All `/api/*` requests reach the backend on port 8080
2. JSON responses are parsed correctly (no HTML)
3. No "Unexpected token '<'" errors in console
4. Existing API client code unchanged
5. File → Open, Save As workflows function correctly
