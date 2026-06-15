# Spec Requirements: Increment 4 -- Add MCP Tool: save_product_artifacts (MISSION.MD Writer + Minimal DB Upsert)

## Initial Description

Add an extensible MCP tool that persists the product "view" at commit time. In v0.1 it will:
(1) write Agent-OS product mission file to `<projectParentFolder>/agent-os/product/MISSION.MD`
(2) upsert minimal ProductDefinition in architecture-model-service (projectId + productName)
This increment introduces the tool and wiring in gateway + mcp-server, but does not change the PM conversation flow (confirmation + invocation wiring is Increment 5).

### Scope from Raw Idea

**Include:**
- mcp-server: new tool endpoint POST /mcp/tools/save_product_artifacts
- mcp-server: atomic file writer for MISSION.MD under agent-os/product/
- mcp-server: call architecture-model-service to upsert minimal ProductDefinition
- gateway: add tool definition + allowlist entry + executor wiring for save_product_artifacts
- shared: strong input validation + clear success/failure responses

**Exclude:**
- any changes to PM prompt/behavior to call the tool (Increment 5)
- any additional product artifacts beyond MISSION.MD
- any structured ProductDefinition fields beyond projectId + productName
- any changes to conversation persistence
- any UI changes

### Systems
- Primary: mcp-server
- Secondary: gateway
- Dependency: architecture-model-service (ProductDefinition PUT endpoint from Increment 1)

## Requirements Discussion

### First Round Questions

**Q1:** The spec says the tool should write `MISSION.MD` (uppercase), but the existing file at `agent-os/product/mission.md` is lowercase. Should we write the file as `MISSION.MD` (uppercase) exactly as stated in the spec to distinguish the tool-written artifact from the hand-maintained one, or should we match the existing lowercase `mission.md` convention?
**Answer:** Write `MISSION.MD` (uppercase) as specified. If legacy `agent-os/product/mission.md` exists, leave it untouched (no rename/migration in v0.1).

**Q2:** The spec explicitly calls for `fsync/close` before rename. The existing atomic write pattern in `gateway/src/services/transcriptWriter.ts` uses `fs.writeFile` + `fs.rename` but does NOT explicitly call `fsync`. Should we follow the spec's stricter requirement and add explicit `fsync` (via `fd.datasync()`), or match the existing simpler pattern?
**Answer:** Match the existing simpler atomic pattern (write temp + rename) without explicit fsync. Keep consistency and avoid platform edge cases for now.

**Q3:** Existing MCP tools use `getOrCreateSession(sessionId)` which auto-creates a session if one does not exist. The spec says "validate request (sessionId active, ...)" which implies checking that the session already exists. Should we follow the existing lenient `getOrCreateSession` pattern, or require a pre-existing session?
**Answer:** Follow existing lenient `getOrCreateSession(sessionId)` behavior (do not require a pre-existing session) to stay consistent with other tools.

**Q4:** The existing MCP error handler wraps errors in `{ error: { code, message } }` format. The spec mentions returning `writtenPaths` to aid recovery when the file was written but DB upsert fails. Should we construct a custom error response body for this partial-failure scenario that extends but stays compatible with the existing error shape?
**Answer:** Yes. Extend the existing error shape to include `writtenPaths` for partial failure (e.g., error includes `writtenPaths`) so recovery is possible.

**Q5:** The spec says "strong input validation" including checking `projectId` is a UUID string. Existing tools validate fields as "non-empty string" but do not validate UUID format. Should we add UUID format validation for `projectId`, and also add max-length checks for `productName` and `missionMarkdown`?
**Answer:** Yes: validate `projectId` is UUID format; add max-length for `productName`; for `missionMarkdown` only enforce non-empty and a reasonable upper bound (e.g., 200KB) to prevent abuse.

**Q6:** The existing OpenAI tool definitions in `gateway/src/types/tools.ts` use flat `properties` with simple `type: 'string'` schemas. The spec defines a nested `artifacts: { missionMarkdown }` structure. The current `ToolParameterSchema` interface only supports one level deep. Should we extend `ToolParameterSchema` to support nested object properties, or flatten the parameters?
**Answer:** Flatten parameters (`missionMarkdown` top-level) to avoid changing `ToolParameterSchema` in this increment; keep artifacts nesting for later.

**Q7:** Should we add a new method to the existing `archModelClient` singleton (e.g., `upsertProductDefinition(projectId, productName)`) following the same pattern as the existing `saveOasSpec` method?
**Answer:** Yes: add `upsertProductDefinition(projectId, productName)` to `archModelClient`, mirroring existing client patterns.

**Q8:** Should we document that there is no automatic rollback of the file write if DB upsert fails (only `writtenPaths` reported for manual recovery), or is there an expectation of automatic cleanup/rollback?
**Answer:** Yes: explicitly document that there is no automatic rollback of the file write if DB upsert fails (only `writtenPaths` reported for manual recovery).

### Existing Code to Reference

**Similar Features Identified:**

- Feature: `save_oas_spec` MCP tool route - Path: `mcp-server/src/routes/saveOasSpecRoute.ts`
  - Closest analogue for the new route. Same pattern: validate inputs, call `getOrCreateSession`, call `archModelClient`, update session, return response.
- Feature: `save_oas_spec` route test - Path: `mcp-server/src/__tests__/saveOasSpecRoute.test.ts`
  - Testing pattern: jest mocks for dotenv, axios, sessionManager. Uses `resetModules`/`clearAllMocks` in `beforeEach`. Extracts handler from router stack for direct invocation.
- Feature: `compute_oas_gaps` route - Path: `mcp-server/src/routes/computeOasGapsRoute.ts`
  - Alternative route pattern reference (separate Router file mounted in `tools.ts`).
- Feature: archModelClient singleton - Path: `mcp-server/src/services/archModelClient.ts`
  - Existing HTTP client class with `saveOasSpec()` method pattern to follow when adding `upsertProductDefinition()`. Uses `axios.create` with base URL from config.
- Feature: MCP tools router (mount point) - Path: `mcp-server/src/routes/tools.ts`
  - Where new route must be imported and mounted (e.g., `toolsRouter.use('/save_product_artifacts', saveProductArtifactsRouter)`).
- Feature: MCP server entry point - Path: `mcp-server/src/index.ts`
  - No changes needed here; routes are mounted via `tools.ts`.
- Feature: MCP error handler - Path: `mcp-server/src/middleware/errorHandler.ts`
  - Current error response shape: `{ error: { code, message } }` via `McpToolResponse<never>`. Will need extension for `writtenPaths` in partial failure case.
- Feature: MCP types index - Path: `mcp-server/src/types/index.ts`
  - Where new request/response types (e.g., `SaveProductArtifactsRequest`, `SaveProductArtifactsResponse`) must be exported.
- Feature: `SaveOasSpecRequest` type - Path: `mcp-server/src/types/saveOasSpec.ts`
  - Pattern for defining request/response interfaces in a dedicated type file.
- Feature: Atomic file write pattern - Path: `gateway/src/services/transcriptWriter.ts`
  - Established pattern: `fs.mkdir(dir, { recursive: true })` then `fs.writeFile(tempPath)` then `fs.rename(tempPath, finalPath)`. Non-blocking error handling with `try/catch` per step.
- Feature: Gateway tool executor - Path: `gateway/src/services/toolExecutor.ts`
  - Contains `TOOL_ENDPOINTS` map, `TOOL_REQUIRED_PARAMS` map, `isToolAllowed()`, `validateToolArguments()`, `executeTool()`, and `executeToolCall()`. All need extension for the new tool.
- Feature: Gateway tool type definitions - Path: `gateway/src/types/tools.ts`
  - Contains `ToolName` union type, `ALLOWED_TOOL_NAMES` array, `ToolParameterSchema` interface, tool param interfaces (`SaveOasSpecParams`, etc.), `ToolParams` union, and `TOOL_DEFINITIONS` array. All need extension.
- Feature: Gateway types index - Path: `gateway/src/types/index.ts`
  - Re-exports all tool types; must be updated to export new `SaveProductArtifactsParams`.
- Feature: Gateway config - Path: `gateway/src/config.ts`
  - Already has `mcpBaseUrl` configured (default `http://localhost:8090`). No config changes needed.
- Feature: ProductDefinition controller (dependency) - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProductDefinitionController.java`
  - PUT endpoint at `/api/projects/{projectId}/product` with body `{ "productName": "..." }`. Returns `ProductDefinitionDto` with HTTP 200.
- Feature: ProductDefinitionDto (dependency) - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ProductDefinitionDto.java`
  - Java record returning: `id` (UUID), `projectId` (UUID), `productName` (String), `createdAt` (Instant), `updatedAt` (Instant).
- Feature: MCP server config - Path: `mcp-server/src/config.ts`
  - Already has `ARCH_MODEL_SERVICE_BASE_URL` (default `http://localhost:8080`). No config changes needed.
- Feature: Session manager - Path: `mcp-server/src/services/sessionManager.ts`
  - Provides `getOrCreateSession(sessionId)`, `updateSession(sessionId, updates)` -- existing pattern to follow.

### Follow-up Questions

No follow-up questions were needed. All 8 questions were answered clearly and completely in the first round.

## Visual Assets

### Files Provided:
No visual assets provided. (Mandatory bash check of `planning/visuals/` directory confirmed no `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, or `.pdf` files present.)

### Visual Insights:
Not applicable -- this is a backend-only increment with no UI changes.

## Requirements Summary

### Functional Requirements

**MCP Server -- New Tool Endpoint:**
- New Express route at POST `/mcp/tools/save_product_artifacts` in a dedicated route file
- Route mounted in `mcp-server/src/routes/tools.ts` following the pattern of `computeOasGapsRouter` and `saveOasSpecRouter`
- Request parameters (flattened, no nested `artifacts` object):
  - `sessionId`: string (required, non-empty)
  - `projectParentFolder`: string (required, non-empty)
  - `projectId`: string (required, must be valid UUID format)
  - `productName`: string (required, non-empty, max-length enforced)
  - `missionMarkdown`: string (required, non-empty, max ~200KB upper bound)
  - `overwrite`: boolean (optional, default `true`)
- Session management: use lenient `getOrCreateSession(sessionId)` (auto-creates if missing)

**MCP Server -- Atomic File Write:**
- Compute mission path: `missionDir = <projectParentFolder>/agent-os/product`, `missionFile = missionDir/MISSION.MD`
- File name is `MISSION.MD` (uppercase); do NOT rename or migrate existing lowercase `mission.md`
- Ensure directory exists: `fs.mkdir(dirPath, { recursive: true })`
- Atomic write pattern: `fs.writeFile(tempPath)` then `fs.rename(tempPath, finalPath)` (no explicit fsync)
- Follow the established pattern from `gateway/src/services/transcriptWriter.ts`

**MCP Server -- ProductDefinition Upsert:**
- Add new method `upsertProductDefinition(projectId: string, productName: string)` to `archModelClient` singleton
- Method calls PUT `/api/projects/{projectId}/product` on architecture-model-service with body `{ "productName": "<productName>" }`
- Mirror the pattern of the existing `saveOasSpec` method in `archModelClient`

**MCP Server -- Success Response:**
- On full success, respond with: `{ writtenPaths: ["agent-os/product/MISSION.MD"], productUpserted: true }`

**MCP Server -- Error Handling:**
- Invalid payload: HTTP 400 with message + field-level errors
- Validate `projectId` as UUID format (regex or similar)
- Validate `productName` has max-length constraint
- Validate `missionMarkdown` is non-empty and under ~200KB
- File write failure: HTTP 500 with message, include path attempted
- Model-service failure: HTTP 502 with message + propagated status code (sanitized)
- Partial failure (file written but DB upsert fails): return failure status and include `writtenPaths` array in the error response body, extending the existing `{ error: { code, message } }` shape
- Never partially claim success
- No automatic rollback of written file if DB upsert fails; `writtenPaths` reported for manual recovery only

**MCP Server -- Logging:**
- Use consistent logging with request correlation ID if present
- Do NOT log `missionMarkdown` content (log its length only)
- No secrets in logs

**Gateway -- Tool Integration:**
- Add `'save_product_artifacts'` to `ToolName` union type in `gateway/src/types/tools.ts`
- Add `'save_product_artifacts'` to `ALLOWED_TOOL_NAMES` array
- Add `TOOL_ENDPOINTS` mapping: `save_product_artifacts: '/mcp/tools/save_product_artifacts'`
- Add `TOOL_REQUIRED_PARAMS` mapping: `save_product_artifacts: ['projectParentFolder', 'projectId', 'productName', 'missionMarkdown']`
- Add new `SaveProductArtifactsParams` interface (flattened: `projectParentFolder`, `projectId`, `productName`, `missionMarkdown`, optional `overwrite`)
- Add to `ToolParams` union type
- Add OpenAI tool definition to `TOOL_DEFINITIONS` array with flat parameter schema (no nested objects -- keep `ToolParameterSchema` interface unchanged)
- Export new types from `gateway/src/types/index.ts`
- Do NOT auto-invoke the tool; only provide the capability for later increments (Increment 5)

**Gateway -- Configuration:**
- MCP server base URL (`mcpBaseUrl`) is already configured at `http://localhost:8090` -- no changes needed
- Architecture-model-service base URL is already available in mcp-server config (`ARCH_MODEL_SERVICE_BASE_URL` at `http://localhost:8080`) -- no changes needed

### Reusability Opportunities

- **Route pattern**: Model new `saveProductArtifactsRoute.ts` directly after `saveOasSpecRoute.ts` (same structure: validate, session, service call, respond)
- **archModelClient pattern**: The new `upsertProductDefinition()` method follows the same axios PUT pattern as `saveOasSpec()`
- **Atomic file write pattern**: Reuse the `fs.writeFile` + `fs.rename` approach from `transcriptWriter.ts`
- **Test pattern**: Model tests after `saveOasSpecRoute.test.ts` (jest mocks for dotenv, axios, sessionManager; extract handler from router stack)
- **Gateway tool wiring pattern**: Follow exact same additions as were done for `save_oas_spec` across `tools.ts` (types) and `toolExecutor.ts`
- **Validation pattern**: Follow existing `createHttpError(400, message)` pattern for input validation; extend for UUID regex check

### Scope Boundaries

**In Scope:**
- mcp-server: new route file `saveProductArtifactsRoute.ts` with POST handler
- mcp-server: new types file for `SaveProductArtifactsRequest` and `SaveProductArtifactsResponse`
- mcp-server: new method `upsertProductDefinition()` on `archModelClient`
- mcp-server: mount new route in `tools.ts`
- mcp-server: export new types from `types/index.ts`
- gateway: extend `ToolName`, `ALLOWED_TOOL_NAMES`, `TOOL_ENDPOINTS`, `TOOL_REQUIRED_PARAMS`, `TOOL_DEFINITIONS`
- gateway: add `SaveProductArtifactsParams` interface and export
- Input validation: UUID format for projectId, max-length for productName, non-empty + size cap for missionMarkdown
- Extended error shape with `writtenPaths` for partial failure recovery
- Unit tests for the new route handler

**Out of Scope:**
- Any changes to PM prompt/behavior to call the tool (deferred to Increment 5)
- Any additional product artifacts beyond MISSION.MD
- Any structured ProductDefinition fields beyond projectId + productName
- Any changes to conversation persistence
- Any UI changes
- Any changes to `ToolParameterSchema` interface (keeping flat params for now; nested `artifacts` object deferred)
- Migration or rename of existing lowercase `mission.md` file
- Automatic rollback/cleanup of written file if DB upsert fails
- Explicit `fsync` on file write (using simpler `writeFile` + `rename` pattern)

### Technical Considerations

- **Integration point -- architecture-model-service**: PUT `/api/projects/{projectId}/product` with body `{ "productName": "..." }` returns `ProductDefinitionDto` (id, projectId, productName, createdAt, updatedAt). This endpoint is conditional on `app.features.include-database=true`.
- **File path construction**: `<projectParentFolder>/agent-os/product/MISSION.MD` -- must handle both Unix and Windows path separators since the codebase runs on Windows (as evidenced by the development environment).
- **Existing config sufficiency**: Both `ARCH_MODEL_SERVICE_BASE_URL` in mcp-server and `mcpBaseUrl` in gateway are already configured. No new environment variables needed.
- **No breaking changes**: The new tool is additive. Existing `ToolName` union, `ALLOWED_TOOL_NAMES`, `TOOL_ENDPOINTS`, `TOOL_REQUIRED_PARAMS`, and `TOOL_DEFINITIONS` are extended (not modified).
- **Tool naming stability**: Name `save_product_artifacts` chosen to be extensible for future additive artifacts (vision, principles, etc.) without renaming.
- **JSON body size**: Express `json()` middleware with default limit applies. The ~200KB missionMarkdown cap is enforced at the route validation level, not at the Express parser level.
- **Error response extension**: The `McpToolResponse<T>` type and `McpErrorResponse` type in `mcp-server/src/types/index.ts` may need a minor extension to support optional `writtenPaths` field in error responses, or the route handler can construct a custom response body for the partial failure case.
