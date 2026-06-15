# Specification: Docker Dev TSX Runtime Fix

## Goal
Fix the "TypeError: Unknown file extension '.ts'" error in Docker dev containers for the Gateway and MCP Server by replacing ts-node/nodemon with tsx as the TypeScript runtime.

## User Stories
- As a developer, I want the Gateway and MCP Server containers to start without TypeScript extension errors so that I can develop and test features in Docker.
- As a developer, I want hot-reload to work when editing TypeScript files so that I can see changes without manually restarting containers.

## Specific Requirements

**Replace ts-node with tsx in Gateway package.json**
- Add `tsx` version `^4.0.0` to devDependencies
- Change the `dev` script from `ts-node src/server.ts` to `tsx watch src/server.ts`
- The `tsx watch` command provides built-in file watching and auto-restart
- No need for nodemon since tsx watch handles restarts natively
- Keep existing scripts (start, build, test, lint) unchanged

**Replace nodemon/ts-node with tsx in MCP Server package.json**
- Add `tsx` version `^4.0.0` to devDependencies
- Change the `dev` script from `nodemon --watch src --ext ts --exec ts-node src/index.ts` to `tsx watch src/index.ts`
- The `tsx watch` command replaces the nodemon + ts-node combination
- Optionally remove `nodemon` from devDependencies since it will no longer be used
- Keep existing scripts (start, build, test) unchanged

**Update Gateway Dockerfile.dev**
- Keep the existing structure which already uses `npm run dev`
- Change `npm install` to `npm ci` for deterministic dependency installation
- The Dockerfile already correctly exposes port 8081 and runs the dev script
- Comment should be updated to reference tsx instead of ts-node

**Update MCP Server Dockerfile.dev**
- Keep the existing structure which already uses `npm run dev`
- Change `npm install` to `npm ci` for deterministic dependency installation
- The Dockerfile already correctly exposes port 8090 and runs the dev script
- Comment should be updated to reference tsx instead of nodemon/ts-node

**Verify tsconfig.json compatibility**
- Both modules use `"module": "commonjs"` and `"target": "ES2020"`
- tsx is compatible with these settings without modification
- No changes required to tsconfig.json files

**Docker Compose volume mounts remain unchanged**
- Gateway volume: `./gateway/src:/app/src:delegated` works with tsx watch
- MCP Server volume: `./mcp-server/src:/app/src:delegated` works with tsx watch
- tsx watch will detect file changes through these mounted volumes

## Visual Design
No visual mockups provided for this specification.

## Existing Code to Leverage

**gateway/package.json (line 8)**
- Current dev script: `"dev": "ts-node src/server.ts"`
- Pattern to follow: keep script name as `dev`, just change the command
- Entry point confirmed at `src/server.ts`
- Already has ts-node in devDependencies (can be kept for other tooling or removed)

**gateway/Dockerfile.dev**
- Already structured correctly with package.json copy, npm install, and CMD npm run dev
- Only needs `npm install` changed to `npm ci` and comment update
- Exposes correct port 8081

**mcp-server/package.json (line 9)**
- Current dev script: `"dev": "nodemon --watch src --ext ts --exec ts-node src/index.ts"`
- Entry point confirmed at `src/index.ts`
- Has both nodemon and ts-node in devDependencies

**mcp-server/Dockerfile.dev**
- Already structured correctly with package.json copy, npm install, and CMD npm run dev
- Only needs `npm install` changed to `npm ci` and comment update
- Exposes correct port 8090

**docker-compose.yml volume configuration**
- Gateway: `./gateway/src:/app/src:delegated` at lines 107
- MCP Server: `./mcp-server/src:/app/src:delegated` at line 88
- No changes needed; tsx watch will work with these existing mounts

## Out of Scope
- Frontend TypeScript configuration or tsconfig.node.json changes
- Production Dockerfile changes (only Dockerfile.dev is modified)
- TypeScript build/compile step modifications
- Java services (architecture-model-service, architecture-read-service)
- Docker Compose file modifications
- Environment variable or .env file changes
- Adding tsx to dependencies (only devDependencies)
- Removing ts-node from devDependencies (optional cleanup, not required)
- Changes to tsconfig.json files
- Test configuration changes (jest.config.js)
