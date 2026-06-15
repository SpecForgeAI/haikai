# Task Breakdown: Fix Missing tsconfig.node.json in Frontend Docker Dev Container

## Overview
Total Tasks: 5

## Problem Summary
The frontend Docker dev container fails to start because Vite requires both `tsconfig.json` and `tsconfig.node.json` to exist, but only `tsconfig.json` is currently mounted as a volume in docker-compose.yml.

## Task List

### Implementation

#### Task Group 1: Add Volume Mount
**Dependencies:** None

- [x] 1.0 Complete volume mount addition
  - [x] 1.1 Open `docker-compose.yml` at project root
    - File path: `C:/Workspaces/SSD/architecture-store-and-diagrams/docker-compose.yml`
  - [x] 1.2 Locate the frontend service volumes section (lines 126-131)
    - Current last volume mount is at line 131: `./frontend/tsconfig.json:/app/tsconfig.json:delegated`
  - [x] 1.3 Add new volume mount line after line 131
    - Insert: `- ./frontend/tsconfig.node.json:/app/tsconfig.node.json:delegated`
    - Maintain proper YAML indentation (6 spaces to align with other volume entries)
    - The new line should appear before line 132 (which contains `environment:`)

**Expected Result After Change:**
```yaml
    volumes:
      - ./frontend/src:/app/src:delegated
      - ./frontend/public:/app/public:delegated
      - ./frontend/index.html:/app/index.html:delegated
      - ./frontend/vite.config.ts:/app/vite.config.ts:delegated
      - ./frontend/tsconfig.json:/app/tsconfig.json:delegated
      - ./frontend/tsconfig.node.json:/app/tsconfig.node.json:delegated
    environment:
```

**Acceptance Criteria:**
- New volume mount line is added to frontend service
- YAML syntax is valid
- Indentation matches existing volume entries
- `:delegated` flag is included for consistency

---

### Verification

#### Task Group 2: Verify the Fix
**Dependencies:** Task Group 1

- [x] 2.0 Complete verification
  - [x] 2.1 Validate docker-compose.yml syntax
    - Run: `docker compose config` from project root
    - Confirm no YAML parsing errors
  - [x] 2.2 Rebuild and start the frontend container
    - Run: `docker compose up --build frontend`
    - Confirm no "Cannot find tsconfig.node.json" errors in output
    - Confirm Vite dev server starts successfully
  - [x] 2.3 Verify HMR functionality (optional manual check)
    - Access http://localhost:5173 in browser
    - Modify a React component in `frontend/src/`
    - Confirm hot reload works without full page refresh

**Acceptance Criteria:**
- docker-compose.yml passes syntax validation
- Frontend container starts without tsconfig-related errors
- Vite dev server is accessible on port 5173
- No changes to any other services are required

---

## Execution Order

1. Implementation (Task Group 1) - Add the volume mount
2. Verification (Task Group 2) - Validate the fix works

## Files Modified

| File | Change |
|------|--------|
| `docker-compose.yml` | Add 1 line to frontend service volumes section |

## Files NOT Modified (Out of Scope)

- `frontend/Dockerfile.dev`
- `frontend/vite.config.ts`
- `frontend/tsconfig.json`
- `frontend/tsconfig.node.json`
- Any backend service configurations
