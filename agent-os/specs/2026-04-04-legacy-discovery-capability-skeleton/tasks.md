# Task Breakdown: Legacy Discovery Capability Skeleton

## Overview
Total Tasks: 6 task groups, approximately 35 sub-tasks

This is increment 1 of 16 for the Legacy/Current-State Discovery capability. The skeleton establishes a new standalone micro-service, an analyzer-pack extension-point model, minimal gateway awareness, and Docker Compose integration -- all returning stub responses only.

## Task List

### Discovery Service Foundation

#### Task Group 1: Project Scaffolding and Configuration
**Dependencies:** None

- [x] 1.0 Complete project scaffolding and configuration files
  - [x] 1.1 Create `discovery-service/` top-level directory with standard sub-directories
    - Create directories: `discovery-service/src/`, `src/routes/`, `src/services/`, `src/types/`, `src/middleware/`, `src/__tests__/`
  - [x] 1.2 Create `discovery-service/package.json`
    - Name: `@arch-model/discovery-service`
    - Mirror dependency versions from `mcp-server/package.json`
    - Dependencies: `express@^4.18.2`, `dotenv@^16.3.1`, `uuid@^9.0.1`
    - DevDependencies: `@types/express@^4.17.21`, `@types/jest@^29.5.11`, `@types/node@^20.10.4`, `@types/uuid@^9.0.7`, `jest@^29.7.0`, `ts-jest@^29.1.1`, `ts-node@^10.9.2`, `tsx@^4.0.0`, `typescript@^5.3.3`
    - Scripts: `build` (tsc), `start` (node dist/index.js), `dev` (tsx watch src/index.ts), `test` (jest)
  - [x] 1.3 Create `discovery-service/tsconfig.json`
    - Match `mcp-server/tsconfig.json` exactly: ES2020 target, commonjs module, strict mode, rootDir `./src`, outDir `./dist`, esModuleInterop, skipLibCheck, forceConsistentCasingInFileNames, resolveJsonModule, declaration, declarationMap, sourceMap
    - Include `src/**/*`, exclude `node_modules`, `dist`, `src/__tests__`
  - [x] 1.4 Create `discovery-service/jest.config.js`
    - Match `mcp-server/jest.config.js` pattern: ts-jest preset, node environment, roots `<rootDir>/src`, testMatch `**/__tests__/**/*.test.ts`
  - [x] 1.5 Create `discovery-service/src/config.ts`
    - Follow `mcp-server/src/config.ts` pattern (import dotenv, call dotenv.config())
    - Export `PORT: number` from `process.env.PORT` with default `8091`
    - Export `ARCHITECTURE_MODEL_SERVICE_BASE_URL: string` from env with default `http://localhost:8080` (placeholder, not called at runtime)
  - [x] 1.6 Run `npm install` in `discovery-service/` to generate `package-lock.json` and verify dependency resolution

**Acceptance Criteria:**
- Directory structure matches the spec: `src/`, `src/routes/`, `src/services/`, `src/types/`, `src/middleware/`, `src/__tests__/`
- `package.json` has correct name, all specified dependencies, and all four scripts
- `tsconfig.json` compiles successfully with `npx tsc --noEmit` (once source files exist)
- `jest.config.js` is valid (tested in Task Group 4)
- `config.ts` exports PORT (default 8091) and ARCHITECTURE_MODEL_SERVICE_BASE_URL (default http://localhost:8080)

---

### Types and Interfaces

#### Task Group 2: Type Definitions and Analyzer-Pack Contract
**Dependencies:** Task Group 1

- [x] 2.0 Complete all type definitions and interfaces
  - [x] 2.1 Create `discovery-service/src/types/analyzerPack.ts`
    - Define `AnalyzerPack` interface: `id: string`, `name: string`, `description: string`, `supportedPhases: string[]`, `analyze(input: AnalyzerInput): Promise<AnalyzerResult>`
    - Define `AnalyzerInput` type: `projectId: string`, `phase: string`, `step: string`, `context: Record<string, unknown>`
    - Define `AnalyzerResult` type: `analyzerId: string`, `phase: string`, `step: string`, `findings: AnalyzerFinding[]`, `metadata: Record<string, unknown>`
    - Define `AnalyzerFinding` type: `id: string`, `category: string`, `summary: string`, `detail: string`, `severity: 'info' | 'warning' | 'critical'`
  - [x] 2.2 Create `discovery-service/src/types/projectContext.ts`
    - Define `DiscoveryProjectContext` interface: `projectId: string`, `projectFolderPath?: string`, `repoUrl?: string`
    - Define `DiscoveryRequest` interface: `projectId: string`, `phase: string`, `step: string`, `options?: Record<string, unknown>`
  - [x] 2.3 Create `discovery-service/src/types/index.ts` barrel export
    - Re-export all types from `analyzerPack.ts` and `projectContext.ts`

**Acceptance Criteria:**
- All five interfaces/types are defined: `AnalyzerPack`, `AnalyzerInput`, `AnalyzerResult`, `AnalyzerFinding`, `DiscoveryProjectContext`, `DiscoveryRequest`
- Barrel `index.ts` exports all types
- `npx tsc --noEmit` passes with no type errors in the types directory

---

### Middleware and Services

#### Task Group 3: Middleware, Analyzer Registry, and Stub Analyzer
**Dependencies:** Task Group 2

- [x] 3.0 Complete middleware and service layer
  - [x] 3.1 Write 5 focused tests for middleware and services in `discovery-service/src/__tests__/services.test.ts`
    - Test 1: `initializeAnalyzerRegistry()` populates the registry with the `stub-noop` analyzer
    - Test 2: `getAnalyzerRegistry()` returns a Map containing the registered stub analyzer
    - Test 3: `registerAnalyzerPack()` adds a new analyzer to the registry
    - Test 4: Stub analyzer `analyze()` returns an `AnalyzerResult` with empty `findings` array and `metadata: { stub: true }`
    - Test 5: Stub analyzer has correct metadata (id: `stub-noop`, name: `Stub No-Op Analyzer`, supportedPhases: `['phase0', 'phase1']`)
  - [x] 3.2 Create `discovery-service/src/middleware/errorHandler.ts`
    - Simplified version of `mcp-server/src/middleware/errorHandler.ts`
    - Define `HttpError` interface extending `Error` with optional `statusCode: number`
    - Export `errorHandler(err, req, res, next)` middleware: catches errors, returns `{ error: { code, message } }` JSON
    - Export `createHttpError(statusCode, message)` utility
    - Omit Axios-specific error handling (no backend calls in this increment)
  - [x] 3.3 Create `discovery-service/src/middleware/requestLogger.ts`
    - Follow `mcp-server/src/middleware/requestLogger.ts` pattern
    - Log incoming requests to `/discovery/` routes with method, path, and response status/duration
    - Use `res.on('finish')` callback to log response status and duration
  - [x] 3.4 Create `discovery-service/src/services/stubAnalyzerPack.ts`
    - Implement `AnalyzerPack` interface
    - Properties: `id: 'stub-noop'`, `name: 'Stub No-Op Analyzer'`, `description: 'Reference stub implementation for analyzer packs'`, `supportedPhases: ['phase0', 'phase1']`
    - `analyze()` method returns `{ analyzerId: 'stub-noop', phase: input.phase, step: input.step, findings: [], metadata: { stub: true } }`
  - [x] 3.5 Create `discovery-service/src/services/analyzerRegistry.ts`
    - Follow the `gateway/src/services/contextResolvers.ts` registry pattern
    - Private module-level `Map<string, AnalyzerPack>` variable
    - Export `initializeAnalyzerRegistry()`: creates fresh Map, registers the `stubAnalyzerPack`, logs count (e.g., `[Discovery] Analyzer registry initialized with N packs`)
    - Export `getAnalyzerRegistry(): Map<string, AnalyzerPack>` getter
    - Export `registerAnalyzerPack(pack: AnalyzerPack): void` for future use by real analyzers
  - [x] 3.6 Ensure services tests pass
    - Run `npx jest --testPathPattern="services.test"` in `discovery-service/`
    - All 5 tests from 3.1 should pass

**Acceptance Criteria:**
- All 5 tests from 3.1 pass
- Error handler middleware returns correct JSON shape for both HttpError and generic Error
- Request logger logs method, path, status, and duration for `/discovery/` routes
- Stub analyzer implements the `AnalyzerPack` interface and returns empty findings
- Registry initializes with stub, supports registration of additional packs

---

### Route Layer

#### Task Group 4: Express Routes and Application Entry Point
**Dependencies:** Task Group 3

- [x] 4.0 Complete route layer and Express app entry point
  - [x] 4.1 Write 7 focused tests for routes and health check in `discovery-service/src/__tests__/routes.test.ts`
    - Test 1: `GET /health` returns 200 with `{ status: 'ok', timestamp: <ISO string> }` shape
    - Test 2: `POST /discovery/phase0/frame` with valid `{ projectId: 'p1' }` returns 200 with `{ phase: 'phase0', step: 'frame', status: 'stub', projectId: 'p1' }`
    - Test 3: `POST /discovery/phase0/frame` with missing/empty projectId returns 400
    - Test 4: `POST /discovery/phase1/1a` with valid `{ projectId: 'p1' }` returns 200 with `{ phase: 'phase1', step: '1a', status: 'stub', projectId: 'p1' }`
    - Test 5: `POST /discovery/phase1/1d` with valid projectId returns 200 (boundary test for last valid step)
    - Test 6: `POST /discovery/phase1/2a` (invalid step) returns 400
    - Test 7: `POST /discovery/phase1/1b` with missing projectId returns 400
  - [x] 4.2 Create Phase 0 route handler in `discovery-service/src/routes/phase0.ts`
    - Export an Express Router
    - `POST /frame` handler: extract `projectId` from `req.body`, validate non-empty string (return 400 with `{ error: { code: 400, message: 'projectId is required' } }` if missing), return `{ phase: 'phase0', step: 'frame', status: 'stub', projectId }`
  - [x] 4.3 Create Phase 1 route handler in `discovery-service/src/routes/phase1.ts`
    - Export an Express Router
    - `POST /:step` handler: extract `step` from `req.params` and `projectId` from `req.body`
    - Validate `step` is one of `['1a', '1b', '1c', '1d']` (return 400 with `{ error: { code: 400, message: 'Invalid step. Must be one of: 1a, 1b, 1c, 1d' } }` if not)
    - Validate `projectId` is non-empty string (return 400 if missing)
    - Return `{ phase: 'phase1', step, status: 'stub', projectId }`
  - [x] 4.4 Create discovery routes barrel in `discovery-service/src/routes/index.ts`
    - Export a single `discoveryRouter` (Express Router)
    - Mount phase0 router at `/phase0`
    - Mount phase1 router at `/phase1`
  - [x] 4.5 Create `discovery-service/src/index.ts` (Express application entry point)
    - Follow `mcp-server/src/index.ts` pattern exactly
    - Import `PORT` from `./config`
    - Import `requestLogger` from `./middleware/requestLogger`
    - Import `errorHandler` from `./middleware/errorHandler`
    - Import `discoveryRouter` from `./routes`
    - Import `initializeAnalyzerRegistry` from `./services/analyzerRegistry`
    - Create Express app, apply `express.json()` body parser
    - Apply `requestLogger` middleware
    - Mount discovery router at `/discovery`
    - Add health check at `GET /health` returning `{ status: 'ok', timestamp: new Date().toISOString() }`
    - Apply error handler middleware (after routes)
    - Call `initializeAnalyzerRegistry()`
    - `app.listen(PORT, ...)` with startup log: `[Discovery Service] Started on port ${PORT}`
    - Export `app` for test usage
  - [x] 4.6 Ensure route tests pass
    - Run `npx jest --testPathPattern="routes.test"` in `discovery-service/`
    - All 7 tests from 4.1 should pass

**Acceptance Criteria:**
- All 7 tests from 4.1 pass
- Health check returns correct shape with 200 status
- Phase 0 frame route returns stub response and validates projectId
- Phase 1 route validates both step parameter (1a-1d) and projectId
- Invalid inputs return 400 with descriptive error messages
- Express app mounts all routes, middleware, and health check in correct order
- `app` is exported for test usage

---

### Gateway Integration

#### Task Group 5: Minimal Gateway Awareness
**Dependencies:** Task Group 1 (only needs to know the discovery service exists; does not depend on the service being fully built)

- [x] 5.0 Complete minimal gateway awareness for the discovery capability
  - [x] 5.1 Write 2 focused tests for gateway discovery route in `gateway/src/__tests__/discovery.test.ts`
    - Test 1: `GET /api/v1/discovery` returns 200 with `{ capability: 'discovery', status: 'registered', version: '0.1.0' }`
    - Test 2: Verify response Content-Type is `application/json`
  - [x] 5.2 Add `discoveryServiceBaseUrl` to gateway config
    - In `gateway/src/config.ts`: add `discoveryServiceBaseUrl: string` to the `Config` interface
    - In `loadConfig()`: add `discoveryServiceBaseUrl: process.env.DISCOVERY_SERVICE_URL || 'http://localhost:8091'`
  - [x] 5.3 Create `gateway/src/routes/discovery.ts`
    - Export `discoveryRouter` (Express Router)
    - Single `GET /` endpoint returning `{ capability: 'discovery', status: 'registered', version: '0.1.0' }`
    - No proxy logic, no tool wiring
  - [x] 5.4 Export `discoveryRouter` from `gateway/src/routes/index.ts`
    - Add export line following the existing barrel pattern: `export { discoveryRouter } from './discovery';`
  - [x] 5.5 Mount discovery router in `gateway/src/server.ts`
    - Import `discoveryRouter` from `./routes`
    - Add `app.use('/api/v1/discovery', discoveryRouter);` following the existing route mounting pattern
    - Add corresponding console.log line for the discovery endpoint
  - [x] 5.6 Ensure gateway discovery tests pass
    - Run the 2 tests from 5.1
    - Verify no regressions in existing gateway route exports

**Acceptance Criteria:**
- Both tests from 5.1 pass
- `discoveryServiceBaseUrl` is available in gateway config with default `http://localhost:8091`
- `GET /api/v1/discovery` returns the correct JSON capability descriptor
- Discovery router is properly exported from the routes barrel
- Gateway server mounts the route without breaking existing routes

---

### Infrastructure and Docker

#### Task Group 6: Dockerfile and Docker Compose Integration
**Dependencies:** Task Group 1

- [x] 6.0 Complete Docker infrastructure for the discovery service
  - [x] 6.1 Create `discovery-service/Dockerfile.dev`
    - Follow `mcp-server/Dockerfile.dev` exactly
    - `FROM node:20-alpine`
    - `WORKDIR /app`
    - `COPY package.json package-lock.json ./`
    - `RUN npm ci`
    - `EXPOSE 8091`
    - `CMD ["npm", "run", "dev"]`
  - [x] 6.2 Add `discovery-service` entry to `docker-compose.yml`
    - Follow the `mcp-server` service block pattern
    - Build context: `./discovery-service`, dockerfile: `Dockerfile.dev`
    - Container name: `arch-discovery-service`
    - Port mapping: `8091:8091`
    - Volume mount: `./discovery-service/src:/app/src:delegated`
    - Environment: `PORT: 8091`
    - Network: `arch-tool-network`
    - No `depends_on` (no backend calls in this skeleton increment)

**Acceptance Criteria:**
- `Dockerfile.dev` matches the mcp-server pattern with port 8091
- Docker Compose entry follows the mcp-server pattern
- Service is on `arch-tool-network`
- Source volume mount enables hot-reload during development

---

### Integration Verification

#### Task Group 7: Full Test Suite and Integration Smoke Test
**Dependencies:** Task Groups 1-6

- [x] 7.0 Verify all tests pass and the service starts correctly
  - [x] 7.1 Run the full discovery-service test suite
    - Run `npx jest` in `discovery-service/`
    - Expected: all 12 tests pass (5 from services.test.ts + 7 from routes.test.ts)
  - [x] 7.2 Verify TypeScript compilation
    - Run `npx tsc --noEmit` in `discovery-service/`
    - Verify zero type errors
  - [x] 7.3 Run the gateway discovery tests
    - Run the 2 tests from 5.1
    - Verify no regressions in existing gateway tests that are known to pass (do NOT count pre-existing failures)
  - [x] 7.4 Smoke test: verify the service starts and responds
    - Start the discovery service (e.g., `npx tsx src/index.ts`)
    - Verify `GET http://localhost:8091/health` returns `{ status: 'ok' }`
    - Verify `POST http://localhost:8091/discovery/phase0/frame` with `{ "projectId": "test" }` returns the stub response
    - Verify `POST http://localhost:8091/discovery/phase1/1a` with `{ "projectId": "test" }` returns the stub response
    - Verify `POST http://localhost:8091/discovery/phase1/invalid` returns 400
    - Stop the service

**Acceptance Criteria:**
- All 12 discovery-service tests pass
- All 2 gateway discovery tests pass
- TypeScript compiles without errors
- Service starts, responds to health check, and returns correct stub responses for all pipeline routes
- Invalid inputs are properly rejected with 400 status codes

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Project Scaffolding** -- Create the directory structure, package.json, tsconfig, jest config, and config module. This is the foundation everything else depends on.
2. **Task Group 2: Type Definitions** -- Define all interfaces and types. These are needed by the service layer and routes.
3. **Task Group 3: Middleware and Services** -- Build the error handler, request logger, stub analyzer pack, and analyzer registry. Write and run service-level tests.
4. **Task Group 4: Routes and Entry Point** -- Build the Phase 0 and Phase 1 route handlers, the routes barrel, and the Express app entry point. Write and run route-level tests.
5. **Task Group 5: Gateway Awareness** -- Add the discovery config, route, and mounting to the gateway. Can run in parallel with Task Groups 3-4 since it only depends on knowing the service exists (Task Group 1).
6. **Task Group 6: Docker Infrastructure** -- Create the Dockerfile and Docker Compose entry. Can run in parallel with Task Groups 3-5 since it only depends on the package.json existing (Task Group 1).
7. **Task Group 7: Integration Verification** -- Run all tests, verify compilation, and smoke test the running service.

### Parallelism Opportunities

```
Task Group 1 (scaffolding)
    |
    v
Task Group 2 (types)
    |
    +--> Task Group 3 (middleware/services) --> Task Group 4 (routes/entry) --+
    |                                                                         |
    +--> Task Group 5 (gateway awareness) ------------------------------------+
    |                                                                         |
    +--> Task Group 6 (docker infrastructure) --------------------------------+
                                                                              |
                                                                              v
                                                                   Task Group 7 (integration)
```

Task Groups 3/4 are sequential (routes depend on middleware/services), but Task Groups 5 and 6 can proceed in parallel with 3 and 4 since they have no code dependencies on the service internals.
