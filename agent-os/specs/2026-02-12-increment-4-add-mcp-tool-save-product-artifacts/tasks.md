# Task Breakdown: Add MCP Tool save_product_artifacts

## Overview
Total Tasks: 29 (across 4 task groups)

This increment adds a new MCP tool endpoint `save_product_artifacts` that atomically writes a `MISSION.MD` file and upserts a minimal `ProductDefinition` record, with full gateway wiring. Changes span two services: **mcp-server** (primary) and **gateway** (secondary). No changes are needed in architecture-model-service (the PUT endpoint already exists from Increment 1).

## Task List

### MCP Server: Types and Client Method

#### Task Group 1: MCP Server Foundation (Types + archModelClient)
**Dependencies:** None

- [x] 1.0 Complete MCP server types and archModelClient method
  - [x] 1.1 Write 3 focused tests for the new archModelClient method
    - Test file: `mcp-server/src/__tests__/archModelClient.test.ts` (new file)
    - Mock `axios` to intercept HTTP calls from the client
    - Test 1: `upsertProductDefinition` calls PUT `/api/projects/{projectId}/product` with correct body `{ productName }` and returns `ProductDefinitionDto`
    - Test 2: `upsertProductDefinition` properly encodes `projectId` in URL via `encodeURIComponent`
    - Test 3: `upsertProductDefinition` throws AxiosError when backend returns 500 (error preserved for caller)
  - [x] 1.2 Create types file `mcp-server/src/types/saveProductArtifacts.ts`
    - Follow pattern from: `mcp-server/src/types/saveOasSpec.ts`
    - Define `SaveProductArtifactsRequest` interface with fields: `sessionId: string`, `projectParentFolder: string`, `projectId: string`, `productName: string`, `missionMarkdown: string`, `overwrite?: boolean`
    - Define `SaveProductArtifactsResponse` interface with fields: `writtenPaths: string[]`, `productUpserted: boolean`
    - Define `ProductDefinitionDto` interface with fields: `id: string`, `projectId: string`, `productName: string`, `createdAt: string`, `updatedAt: string`
  - [x] 1.3 Export new types from `mcp-server/src/types/index.ts`
    - Add `export * from './saveProductArtifacts'` at the bottom, following the pattern of the existing `export * from './saveOasSpec'` line
  - [x] 1.4 Add `upsertProductDefinition` method to `mcp-server/src/services/archModelClient.ts`
    - Add import for `ProductDefinitionDto` from `'../types'`
    - Add method to the `ArchModelClient` class following the `saveOasSpec` method pattern
    - Method signature: `async upsertProductDefinition(projectId: string, productName: string): Promise<ProductDefinitionDto>`
    - Implementation: `this.client.put<ProductDefinitionDto>(`/api/projects/${encodeURIComponent(projectId)}/product`, { productName })` returning `response.data`
    - JSDoc: document that it calls the architecture-model-service PUT endpoint and throws AxiosError on failure
  - [x] 1.5 Ensure archModelClient tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify the new method integrates correctly with the existing singleton pattern
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- All 3 tests from 1.1 pass
- `SaveProductArtifactsRequest`, `SaveProductArtifactsResponse`, and `ProductDefinitionDto` are exported from types index
- `upsertProductDefinition` method follows the same axios pattern as `saveOasSpec`
- No changes to existing types or methods

**Key Reference Files:**
- `mcp-server/src/types/saveOasSpec.ts` -- type file pattern
- `mcp-server/src/types/index.ts` -- re-export pattern
- `mcp-server/src/services/archModelClient.ts` -- client method pattern

---

### MCP Server: Route Handler

#### Task Group 2: MCP Server Route (Validation, File Write, Upsert, Registration)
**Dependencies:** Task Group 1

- [x] 2.0 Complete MCP server route handler and registration
  - [x] 2.1 Write 8 focused tests for the route handler
    - Test file: `mcp-server/src/__tests__/saveProductArtifactsRoute.test.ts`
    - Follow pattern from: `mcp-server/src/__tests__/saveOasSpecRoute.test.ts`
    - Mock `dotenv`, `axios`, `sessionManager`, and `fs` (via `jest.mock('fs', () => ({ promises: { mkdir, writeFile, rename, access } }))`)
    - Use `jest.resetModules()` and `jest.clearAllMocks()` in `beforeEach`; extract handler from `router.stack` for direct invocation
    - Test 1: Valid request with full success -- file write and DB upsert both succeed; response is HTTP 200 with `{ writtenPaths: ["agent-os/product/MISSION.MD"], productUpserted: true }`
    - Test 2: Missing sessionId returns 400 with message containing "sessionId"
    - Test 3: Invalid projectId (non-UUID string like "not-a-uuid") returns 400 with message containing "projectId"
    - Test 4: productName exceeding 255 characters returns 400 with message containing "productName"
    - Test 5: Empty missionMarkdown returns 400 with message containing "missionMarkdown"
    - Test 6: missionMarkdown over 200KB (204800 bytes) returns 400 with message containing "missionMarkdown"
    - Test 7: File write failure (fs.writeFile rejects) returns 500 via next(error)
    - Test 8: DB upsert failure after successful file write returns HTTP 502 with body containing both `error` object and `writtenPaths: ["agent-os/product/MISSION.MD"]`
  - [x] 2.2 Create route file `mcp-server/src/routes/saveProductArtifactsRoute.ts`
    - Follow the structural pattern of `saveOasSpecRoute.ts`: `Router` export, single POST `/` handler, destructure body as `SaveProductArtifactsRequest`, validate each field, call `getOrCreateSession`, perform operations, call `updateSession`, return JSON
    - Import `Router, Request, Response, NextFunction` from `'express'`
    - Import `archModelClient` from `'../services/archModelClient'`
    - Import `getOrCreateSession, updateSession` from `'../services/sessionManager'`
    - Import `createHttpError` from `'../middleware/errorHandler'`
    - Import `SaveProductArtifactsRequest, SaveProductArtifactsResponse` from `'../types'`
    - Import `promises as fs` from `'fs'` and `path` from `'path'`
    - Export `saveProductArtifactsRouter` as a `Router()`
  - [x] 2.3 Implement request validation in the route handler
    - `sessionId`: required, non-empty string -- `createHttpError(400, 'sessionId is required and must be a non-empty string')`
    - `projectParentFolder`: required, non-empty string -- `createHttpError(400, 'projectParentFolder is required and must be a non-empty string')`
    - `projectId`: required, must match UUID v4 regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` -- `createHttpError(400, 'projectId is required and must be a valid UUID')`
    - `productName`: required, non-empty string, max 255 characters -- `createHttpError(400, 'productName is required, must be a non-empty string, and must not exceed 255 characters')`
    - `missionMarkdown`: required, non-empty string, max 204800 bytes (check via `Buffer.byteLength(missionMarkdown, 'utf8')`) -- `createHttpError(400, 'missionMarkdown is required, must be a non-empty string, and must not exceed 200KB')`
    - `overwrite`: optional boolean, default to `true` if not provided
  - [x] 2.4 Implement atomic MISSION.MD file write logic
    - Compute `missionDir = path.join(projectParentFolder, 'agent-os', 'product')`
    - Compute `missionFile = path.join(missionDir, 'MISSION.MD')`
    - If `overwrite` is `false`, check file existence via `fs.access(missionFile)` -- if file exists, throw `createHttpError(409, 'MISSION.MD already exists and overwrite is false')`
    - Create directory: `await fs.mkdir(missionDir, { recursive: true })` -- wrap in try/catch, throw HTTP 500 with path on failure
    - Write temp file: `await fs.writeFile(missionFile + '.tmp', missionMarkdown, 'utf8')` -- wrap in try/catch, throw HTTP 500 with path on failure
    - Atomic rename: `await fs.rename(missionFile + '.tmp', missionFile)` -- wrap in try/catch, throw HTTP 500 with path on failure
    - After successful rename, set `writtenPaths = ['agent-os/product/MISSION.MD']` (relative path)
  - [x] 2.5 Implement ProductDefinition upsert with partial-failure handling
    - After file write succeeds, call `archModelClient.upsertProductDefinition(projectId, productName)` inside a dedicated try/catch
    - On success: set `productUpserted = true`
    - On AxiosError failure: do NOT delegate to `next(error)`; instead respond directly with `res.status(502).json({ error: { code: 502, message: '<sanitized error message>' }, writtenPaths })` -- this extends the existing error shape by adding `writtenPaths` at the top level
    - Return early after sending the 502 response (do not fall through to the success response)
  - [x] 2.6 Implement success response and session update
    - Call `updateSession(sessionId, { productName })` after both operations succeed
    - Respond with HTTP 200: `res.json({ writtenPaths, productUpserted: true } as SaveProductArtifactsResponse)`
    - Wrap entire handler body in try/catch with `next(error)` for unexpected errors
  - [x] 2.7 Add logging throughout the handler
    - Log at INFO on success: include `missionFile` path, `productUpserted`, and `missionMarkdownLength: Buffer.byteLength(missionMarkdown, 'utf8')` -- do NOT log the markdown content itself
    - Log at ERROR on file write failure: include attempted path and sanitized error message
    - Log at ERROR on DB upsert failure: include projectId and sanitized error message
  - [x] 2.8 Register route in `mcp-server/src/routes/tools.ts`
    - Add import: `import { saveProductArtifactsRouter } from './saveProductArtifactsRoute'`
    - Add mount: `toolsRouter.use('/save_product_artifacts', saveProductArtifactsRouter)` alongside existing `compute_oas_gaps` and `save_oas_spec` mounts
  - [x] 2.9 Ensure route handler tests pass
    - Run ONLY the 8 tests written in 2.1
    - Verify all validation, file write, upsert, and error scenarios work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- All 8 tests from 2.1 pass
- Route is accessible at POST `/mcp/tools/save_product_artifacts` via tools router
- Validation rejects invalid inputs with descriptive 400 errors
- Atomic file write follows the established temp-file-then-rename pattern
- Partial failure (file written, DB failed) returns 502 with `writtenPaths` in body
- Full success returns 200 with `{ writtenPaths, productUpserted: true }`
- No missionMarkdown content is logged (only byte length)

**Key Reference Files:**
- `mcp-server/src/routes/saveOasSpecRoute.ts` -- route handler pattern
- `mcp-server/src/__tests__/saveOasSpecRoute.test.ts` -- test pattern
- `gateway/src/services/transcriptWriter.ts` -- atomic file write pattern (mkdir, writeFile temp, rename)
- `mcp-server/src/routes/tools.ts` -- route registration mount point
- `mcp-server/src/middleware/errorHandler.ts` -- error response shape

---

### Gateway: Tool Wiring

#### Task Group 3: Gateway Tool Definitions and Executor Wiring
**Dependencies:** Task Group 2 (the MCP endpoint must exist for integration, but gateway changes are structurally independent)

- [x] 3.0 Complete gateway tool wiring for save_product_artifacts
  - [x] 3.1 Write 4 focused tests for gateway tool wiring
    - Test file: `gateway/src/__tests__/toolExecutor.test.ts` (new file or extend existing)
    - Test 1: `isToolAllowed('save_product_artifacts')` returns `true`
    - Test 2: `validateToolArguments('save_product_artifacts', { projectParentFolder: '/path', projectId: 'uuid', productName: 'name', missionMarkdown: '# Mission' })` returns `{ valid: true }`
    - Test 3: `validateToolArguments('save_product_artifacts', { projectParentFolder: '/path', productName: 'name', missionMarkdown: '# Mission' })` returns `{ valid: false }` with error mentioning "projectId"
    - Test 4: `TOOL_DEFINITIONS` contains an entry with `function.name === 'save_product_artifacts'` and `function.parameters.required` includes all 4 required params
  - [x] 3.2 Add type definitions to `gateway/src/types/tools.ts`
    - Add `'save_product_artifacts'` to the `ToolName` union type (after `'save_oas_spec'`)
    - Add `'save_product_artifacts'` to the `ALLOWED_TOOL_NAMES` array
    - Add `SaveProductArtifactsParams` interface:
      ```
      export interface SaveProductArtifactsParams {
        projectParentFolder: string;
        projectId: string;
        productName: string;
        missionMarkdown: string;
        overwrite?: boolean;
      }
      ```
    - Add `SaveProductArtifactsParams` to the `ToolParams` union type
    - Add new entry to `TOOL_DEFINITIONS` array:
      ```
      {
        type: 'function',
        function: {
          name: 'save_product_artifacts',
          description: 'Save product artifacts: writes MISSION.MD to agent-os/product/ and upserts a minimal ProductDefinition record',
          parameters: {
            type: 'object',
            required: ['projectParentFolder', 'projectId', 'productName', 'missionMarkdown'],
            properties: {
              projectParentFolder: { type: 'string', description: 'Absolute path to the project root folder' },
              projectId: { type: 'string', description: 'Project UUID (v4 format)' },
              productName: { type: 'string', description: 'Product name (max 255 characters)' },
              missionMarkdown: { type: 'string', description: 'Full markdown content for MISSION.MD' },
              overwrite: { type: 'boolean', description: 'Whether to overwrite existing MISSION.MD (default: true)' }
            }
          }
        }
      }
      ```
    - Do NOT change the `ToolParameterSchema` interface -- keep flat params only
  - [x] 3.3 Export new type from `gateway/src/types/index.ts`
    - Add `SaveProductArtifactsParams` to the named exports from `'./tools'`
  - [x] 3.4 Add wiring to `gateway/src/services/toolExecutor.ts`
    - Add import: `SaveProductArtifactsParams` to the import list from `'../types'`
    - Add to `TOOL_ENDPOINTS`: `save_product_artifacts: '/mcp/tools/save_product_artifacts'`
    - Add to `TOOL_REQUIRED_PARAMS`: `save_product_artifacts: ['projectParentFolder', 'projectId', 'productName', 'missionMarkdown']`
    - No custom validation logic needed beyond the existing required-param check -- UUID and length validation are handled by the MCP server
  - [x] 3.5 Ensure gateway tool wiring tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify the tool appears in definitions, is allowed, and validates correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- All 4 tests from 3.1 pass
- `save_product_artifacts` appears in `ToolName`, `ALLOWED_TOOL_NAMES`, `TOOL_ENDPOINTS`, `TOOL_REQUIRED_PARAMS`, and `TOOL_DEFINITIONS`
- `SaveProductArtifactsParams` is exported from gateway types index
- The `ToolParameterSchema` interface is unchanged
- No existing tool definitions are modified

**Key Reference Files:**
- `gateway/src/types/tools.ts` -- type definitions and TOOL_DEFINITIONS array
- `gateway/src/types/index.ts` -- re-export pattern
- `gateway/src/services/toolExecutor.ts` -- endpoint and required-params maps

---

### Cross-Service Verification

#### Task Group 4: Test Review and Integration Verification
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 3 tests written by Task Group 1 (archModelClient method)
    - Review the 8 tests written by Task Group 2 (route handler)
    - Review the 4 tests written by Task Group 3 (gateway wiring)
    - Total existing tests: 15 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Check if `overwrite=false` with existing file (409 Conflict) is covered -- if not, flag as gap
    - Check if session management (getOrCreateSession + updateSession calls) is verified in the route handler success path
    - Check if the gateway `executeTool` function correctly routes to the new endpoint (integration-level)
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
  - [x] 4.3 Write up to 5 additional strategic tests to fill gaps
    - Potential Test A: Route handler with `overwrite=false` and file already exists (mock `fs.access` to resolve) returns HTTP 409 Conflict
    - Potential Test B: Route handler success path calls `getOrCreateSession(sessionId)` and `updateSession(sessionId, { productName })` with correct arguments
    - Potential Test C: Route handler computes correct file paths using `path.join` (verify `missionDir` and `missionFile` values passed to fs calls)
    - Potential Test D: Gateway `executeTool('save_product_artifacts', ...)` constructs correct URL and request body (mock axios.post)
    - Potential Test E: Route handler does not log missionMarkdown content (verify logger call args do not contain the markdown string)
    - Only write tests that fill actual gaps identified in 4.2 -- skip any that duplicate existing coverage
  - [x] 4.4 Run feature-specific tests only
    - Run all tests from `mcp-server/src/__tests__/archModelClient.test.ts` (Task 1.1)
    - Run all tests from `mcp-server/src/__tests__/saveProductArtifactsRoute.test.ts` (Tasks 2.1 + any additions from 4.3)
    - Run all tests from `gateway/src/__tests__/toolExecutor.test.ts` (Task 3.1 + any additions from 4.3)
    - Expected total: approximately 15-20 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass
  - [x] 4.5 Verify TypeScript compilation across both services
    - Run `npx tsc --noEmit` in `mcp-server/` directory to verify no type errors
    - Run `npx tsc --noEmit` in `gateway/` directory to verify no type errors
    - Confirm no import/export errors from new types

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 15-20 tests total)
- No more than 5 additional tests added when filling gaps
- TypeScript compiles without errors in both mcp-server and gateway
- Critical workflows covered: validation, file write, DB upsert, partial failure, gateway routing
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: MCP Server Foundation** -- Types and archModelClient method (no dependencies; establishes the data contracts and client method that everything else builds on)
2. **Task Group 2: MCP Server Route** -- Route handler with validation, file write, upsert, and registration (depends on types and client from Group 1)
3. **Task Group 3: Gateway Tool Wiring** -- Type definitions, tool definitions, and executor wiring (structurally independent from Group 2 but logically follows it; the MCP endpoint must exist for end-to-end integration)
4. **Task Group 4: Test Review and Integration Verification** -- Gap analysis, additional tests, full feature test run, and TypeScript compilation check (depends on all prior groups)

## Files Created (New)

| File | Task |
|------|------|
| `mcp-server/src/types/saveProductArtifacts.ts` | 1.2 |
| `mcp-server/src/routes/saveProductArtifactsRoute.ts` | 2.2 |
| `mcp-server/src/__tests__/archModelClient.test.ts` | 1.1 |
| `mcp-server/src/__tests__/saveProductArtifactsRoute.test.ts` | 2.1 |
| `gateway/src/__tests__/toolExecutor.test.ts` (new or extended) | 3.1 |

## Files Modified (Existing)

| File | Task | Change |
|------|------|--------|
| `mcp-server/src/types/index.ts` | 1.3 | Add `export * from './saveProductArtifacts'` |
| `mcp-server/src/services/archModelClient.ts` | 1.4 | Add `upsertProductDefinition` method + `ProductDefinitionDto` import |
| `mcp-server/src/routes/tools.ts` | 2.8 | Import and mount `saveProductArtifactsRouter` |
| `gateway/src/types/tools.ts` | 3.2 | Add to ToolName, ALLOWED_TOOL_NAMES, ToolParams, TOOL_DEFINITIONS; add SaveProductArtifactsParams interface |
| `gateway/src/types/index.ts` | 3.3 | Add `SaveProductArtifactsParams` to exports |
| `gateway/src/services/toolExecutor.ts` | 3.4 | Add to TOOL_ENDPOINTS, TOOL_REQUIRED_PARAMS; add import |
