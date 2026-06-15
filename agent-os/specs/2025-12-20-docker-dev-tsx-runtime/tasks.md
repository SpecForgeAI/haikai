# Task Breakdown: Docker Dev TSX Runtime Fix

## Overview
Total Tasks: 14

**Problem:** Docker dev containers for Gateway and MCP Server fail with "TypeError: Unknown file extension '.ts'" when using ts-node/nodemon.

**Solution:** Replace ts-node/nodemon with tsx, which provides seamless TypeScript execution with built-in file watching.

## Task List

### MCP Server Module

#### Task Group 1: MCP Server package.json Updates
**Dependencies:** None

- [x] 1.0 Complete MCP Server package.json changes
  - [x] 1.1 Add tsx to devDependencies in `mcp-server/package.json`
    - Add `"tsx": "^4.0.0"` to the devDependencies section
    - Location: After line 34 (after ts-node entry)
  - [x] 1.2 Update dev script in `mcp-server/package.json`
    - Change line 9 from: `"dev": "nodemon --watch src --ext ts --exec ts-node src/index.ts"`
    - Change line 9 to: `"dev": "tsx watch src/index.ts"`
  - [x] 1.3 (Optional) Remove nodemon from devDependencies
    - Remove line 31: `"nodemon": "^3.0.2",`
    - This is optional since tsx watch replaces nodemon functionality

**Acceptance Criteria:**
- tsx is listed in devDependencies with version ^4.0.0
- dev script uses `tsx watch src/index.ts`
- package.json is valid JSON (no syntax errors)

---

#### Task Group 2: MCP Server Dockerfile.dev Updates
**Dependencies:** Task Group 1

- [x] 2.0 Complete MCP Server Dockerfile.dev changes
  - [x] 2.1 Update npm install to npm ci in `mcp-server/Dockerfile.dev`
    - Change line 11 from: `RUN npm install`
    - Change line 11 to: `RUN npm ci`
  - [x] 2.2 Update comment to reference tsx in `mcp-server/Dockerfile.dev`
    - Change line 10 from: `# Install dependencies (includes devDependencies for nodemon and ts-node)`
    - Change line 10 to: `# Install dependencies (includes devDependencies for tsx)`
  - [x] 2.3 Update CMD comment in `mcp-server/Dockerfile.dev`
    - Change line 18 from: `# Start the development server (uses nodemon with ts-node for hot-reload)`
    - Change line 18 to: `# Start the development server (uses tsx watch for hot-reload)`

**Acceptance Criteria:**
- Dockerfile uses `npm ci` for deterministic installs
- Comments accurately describe tsx usage
- Dockerfile structure remains valid

---

### Gateway Module

#### Task Group 3: Gateway package.json Updates
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 3.0 Complete Gateway package.json changes
  - [x] 3.1 Add tsx to devDependencies in `gateway/package.json`
    - Add `"tsx": "^4.0.0"` to the devDependencies section
    - Location: After line 44 (after ts-node entry)
  - [x] 3.2 Update dev script in `gateway/package.json`
    - Change line 8 from: `"dev": "ts-node src/server.ts"`
    - Change line 8 to: `"dev": "tsx watch src/server.ts"`

**Acceptance Criteria:**
- tsx is listed in devDependencies with version ^4.0.0
- dev script uses `tsx watch src/server.ts`
- package.json is valid JSON (no syntax errors)

---

#### Task Group 4: Gateway Dockerfile.dev Updates
**Dependencies:** Task Group 3

- [x] 4.0 Complete Gateway Dockerfile.dev changes
  - [x] 4.1 Update npm install to npm ci in `gateway/Dockerfile.dev`
    - Change line 11 from: `RUN npm install`
    - Change line 11 to: `RUN npm ci`
  - [x] 4.2 Update comment to reference tsx in `gateway/Dockerfile.dev`
    - Change line 10 from: `# Install dependencies (includes devDependencies for ts-node)`
    - Change line 10 to: `# Install dependencies (includes devDependencies for tsx)`
  - [x] 4.3 Update CMD comment in `gateway/Dockerfile.dev`
    - Change line 18 from: `# Start the development server (runs ts-node src/server.ts)`
    - Change line 18 to: `# Start the development server (uses tsx watch for hot-reload)`

**Acceptance Criteria:**
- Dockerfile uses `npm ci` for deterministic installs
- Comments accurately describe tsx usage
- Dockerfile structure remains valid

---

### Verification

#### Task Group 5: Build and Runtime Verification
**Dependencies:** Task Groups 1-4

- [x] 5.0 Verify Docker dev environment works correctly
  - [x] 5.1 Rebuild containers with new configuration
    - Run: `docker compose build arch-gateway arch-mcp-server`
    - Verify build completes without errors
  - [x] 5.2 Start containers and verify no TypeScript extension errors
    - Run: `docker compose up arch-gateway arch-mcp-server`
    - Verify NO "ERR_UNKNOWN_FILE_EXTENSION" errors in logs
    - Verify NO "TypeError: Unknown file extension '.ts'" errors
  - [x] 5.3 Verify MCP Server starts correctly
    - Run: `docker compose logs -f arch-mcp-server`
    - Confirm tsx watch is running
    - Confirm server is listening on port 8090
  - [x] 5.4 Verify Gateway starts correctly
    - Run: `docker compose logs -f arch-gateway`
    - Confirm tsx watch is running
    - Confirm server is listening on port 8081
  - [x] 5.5 Verify hot-reload functionality (MCP Server)
    - Edit any .ts file in `mcp-server/src/`
    - Confirm container logs show tsx detecting change and restarting
  - [x] 5.6 Verify hot-reload functionality (Gateway)
    - Edit any .ts file in `gateway/src/`
    - Confirm container logs show tsx detecting change and restarting

**Acceptance Criteria:**
- Both containers start without TypeScript extension errors
- tsx watch is running in both containers
- File changes trigger automatic restarts
- Services respond on their respective ports (8081, 8090)

---

## Execution Order

Recommended implementation sequence:

1. **Task Groups 1 & 3 (parallel)** - Update package.json files for both modules
2. **Task Groups 2 & 4 (parallel)** - Update Dockerfile.dev files for both modules
3. **Task Group 5** - Verify the complete solution works

## File Summary

| File | Changes |
|------|---------|
| `mcp-server/package.json` | Add tsx dep, update dev script |
| `mcp-server/Dockerfile.dev` | npm ci, update comments |
| `gateway/package.json` | Add tsx dep, update dev script |
| `gateway/Dockerfile.dev` | npm ci, update comments |

## Notes

- **No changes required** to:
  - `docker-compose.yml` - Volume mounts already work with tsx watch
  - `tsconfig.json` files - tsx is compatible with existing config
  - Production Dockerfiles - Only dev containers are affected
  - Frontend or Java services - Out of scope

- **tsx watch advantages over nodemon + ts-node:**
  - Single dependency instead of two
  - Faster startup and reload times
  - Built-in TypeScript support without configuration
  - Native ESM and CommonJS support
