# Specification: Add MCP Tool save_product_artifacts

## Goal
Add a new MCP tool endpoint `save_product_artifacts` that atomically writes a `MISSION.MD` file to the project's `agent-os/product/` directory and upserts a minimal `ProductDefinition` record in `architecture-model-service`, with full gateway wiring so the tool is available (but not auto-invoked) for future increments.

## User Stories
- As the system (on behalf of a product manager conversation), I want to persist the product mission markdown to a well-known file path so that it is available as a durable artifact for downstream agents and human review.
- As the system, I want to upsert a minimal ProductDefinition (projectId + productName) in the architecture-model-service database so that the product record is established for future structured fields.

## Specific Requirements

**MCP Server: New Route File `saveProductArtifactsRoute.ts`**
- Create `mcp-server/src/routes/saveProductArtifactsRoute.ts` exporting a `saveProductArtifactsRouter` (Express `Router`)
- Single POST handler at `/` (mounted at `/mcp/tools/save_product_artifacts` via `tools.ts`)
- Follow the exact structural pattern of `saveOasSpecRoute.ts`: destructure body, validate, call `getOrCreateSession`, perform operations, call `updateSession`, return JSON response
- The handler must perform two sequential operations: (1) atomic file write, then (2) DB upsert via `archModelClient`
- On full success, respond HTTP 200 with body `{ writtenPaths: ["agent-os/product/MISSION.MD"], productUpserted: true }`
- Wrap all logic in try/catch and pass errors to `next(error)` for the centralized error handler

**MCP Server: Request Validation**
- `sessionId`: required, non-empty string (standard pattern via `createHttpError(400, ...)`)
- `projectParentFolder`: required, non-empty string
- `projectId`: required, must match UUID v4 regex pattern (e.g., `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`)
- `productName`: required, non-empty string, enforce a max-length constraint (e.g., 255 characters)
- `missionMarkdown`: required, non-empty string, enforce an upper bound of approximately 200KB (`204800` bytes) to prevent abuse
- `overwrite`: optional boolean, default `true`; when `false` and target file already exists, return HTTP 409 Conflict
- Return HTTP 400 with a descriptive message identifying the invalid field on any validation failure

**MCP Server: Atomic MISSION.MD File Write**
- Compute paths: `missionDir = path.join(projectParentFolder, 'agent-os', 'product')` and `missionFile = path.join(missionDir, 'MISSION.MD')`
- File name is `MISSION.MD` (uppercase); do NOT rename, migrate, or touch any existing lowercase `mission.md`
- Use `path.join` (not string concatenation) so both Unix and Windows path separators are handled correctly
- Ensure directory exists: `await fs.mkdir(missionDir, { recursive: true })`
- Atomic write pattern matching `transcriptWriter.ts`: write to `missionFile + '.tmp'` via `fs.writeFile`, then `fs.rename` temp to final; no explicit `fsync`
- If directory creation fails, throw HTTP 500 with the attempted path in the error message
- If `fs.writeFile` or `fs.rename` fails, throw HTTP 500 with the attempted path in the error message
- Track `writtenPaths` array; add `'agent-os/product/MISSION.MD'` (relative path) after successful rename

**MCP Server: ProductDefinition Upsert via archModelClient**
- Add new method `upsertProductDefinition(projectId: string, productName: string)` to the `ArchModelClient` class in `mcp-server/src/services/archModelClient.ts`
- The method calls `this.client.put<ProductDefinitionDto>(`/api/projects/${encodeURIComponent(projectId)}/product`, { productName })` mirroring the `saveOasSpec` pattern
- Add a `ProductDefinitionDto` interface (id, projectId, productName, createdAt, updatedAt) to a new types file or the existing types index
- In the route handler, call `archModelClient.upsertProductDefinition(projectId, productName)` after the file write succeeds
- If the upsert call throws an AxiosError, do NOT re-throw through the standard error handler; instead construct a custom HTTP 502 response that includes `writtenPaths` in the body for partial-failure recovery

**MCP Server: Partial Failure and Error Shape**
- If file write succeeds but DB upsert fails, respond with HTTP 502 and body: `{ error: { code: 502, message: "..." }, writtenPaths: ["agent-os/product/MISSION.MD"] }`
- This extends the existing `{ error: { code, message } }` shape from `errorHandler.ts` by adding `writtenPaths` at the top level of the response body
- There is NO automatic rollback of the written file; `writtenPaths` is reported for manual recovery only
- The route handler must catch the upsert error explicitly (not delegate to the global error handler) so it can attach `writtenPaths`

**MCP Server: Logging**
- Log at INFO level on success with the written file path and whether productUpserted
- Do NOT log the `missionMarkdown` content; log its byte length only (e.g., `missionMarkdownLength: Buffer.byteLength(missionMarkdown, 'utf8')`)
- Log at ERROR level on file write failure or DB upsert failure, including the attempted path and sanitized error message

**MCP Server: Types File `saveProductArtifacts.ts`**
- Create `mcp-server/src/types/saveProductArtifacts.ts` following the pattern of `saveOasSpec.ts`
- Define `SaveProductArtifactsRequest` interface with fields: `sessionId`, `projectParentFolder`, `projectId`, `productName`, `missionMarkdown`, `overwrite?`
- Define `SaveProductArtifactsResponse` interface with fields: `writtenPaths: string[]`, `productUpserted: boolean`
- Define `ProductDefinitionDto` interface with fields: `id: string`, `projectId: string`, `productName: string`, `createdAt: string`, `updatedAt: string`
- Export all from `mcp-server/src/types/index.ts` via `export * from './saveProductArtifacts'`

**MCP Server: Route Registration in `tools.ts`**
- Import `saveProductArtifactsRouter` from `'./saveProductArtifactsRoute'`
- Add `toolsRouter.use('/save_product_artifacts', saveProductArtifactsRouter)` alongside the existing `compute_oas_gaps` and `save_oas_spec` mounts

**Gateway: Tool Type Definitions in `gateway/src/types/tools.ts`**
- Add `'save_product_artifacts'` to the `ToolName` union type
- Add `'save_product_artifacts'` to the `ALLOWED_TOOL_NAMES` array
- Add `SaveProductArtifactsParams` interface with fields: `projectParentFolder: string`, `projectId: string`, `productName: string`, `missionMarkdown: string`, `overwrite?: boolean`
- Add `SaveProductArtifactsParams` to the `ToolParams` union type
- Add a new entry to `TOOL_DEFINITIONS` array with flat parameter schema (no nested objects) keeping `ToolParameterSchema` interface unchanged; required params: `projectParentFolder`, `projectId`, `productName`, `missionMarkdown`; optional: `overwrite` (type `boolean`)
- Export `SaveProductArtifactsParams` from `gateway/src/types/index.ts`

**Gateway: Tool Executor Wiring in `gateway/src/services/toolExecutor.ts`**
- Import `SaveProductArtifactsParams` from types
- Add to `TOOL_ENDPOINTS`: `save_product_artifacts: '/mcp/tools/save_product_artifacts'`
- Add to `TOOL_REQUIRED_PARAMS`: `save_product_artifacts: ['projectParentFolder', 'projectId', 'productName', 'missionMarkdown']`
- No custom validation logic needed beyond the existing required-param check; UUID and length validation is handled by the MCP server

**Unit Tests for New Route**
- Create `mcp-server/src/__tests__/saveProductArtifactsRoute.test.ts` following the pattern of `saveOasSpecRoute.test.ts`
- Mock `dotenv`, `axios`, `sessionManager`, and `fs` (for file write operations)
- Use `jest.resetModules()` and `jest.clearAllMocks()` in `beforeEach`; extract handler from `router.stack` for direct invocation
- Test cases: valid request full success, missing/invalid sessionId (400), invalid projectId non-UUID (400), productName exceeding max length (400), missionMarkdown empty (400), missionMarkdown over 200KB (400), file write failure (500), DB upsert failure with writtenPaths in response (502), overwrite=false with existing file (409), session is created/updated correctly

## Visual Design
No visual assets provided. This is a backend-only increment with no UI changes.

## Existing Code to Leverage

**`mcp-server/src/routes/saveOasSpecRoute.ts` -- Route handler pattern**
- Provides the exact structural template: Router export, single POST `/` handler, destructure body as typed request, validate each field with `createHttpError(400, ...)`, call `getOrCreateSession`, perform service call, call `updateSession`, return JSON
- The new route adds file I/O before the service call but otherwise follows the same flow
- Error delegation via `next(error)` pattern is used for all standard errors; partial-failure case requires explicit catch in the handler

**`mcp-server/src/services/archModelClient.ts` -- HTTP client singleton pattern**
- The new `upsertProductDefinition` method should follow the `saveOasSpec` method pattern: `this.client.put<T>(url, body)` returning `response.data`
- Uses `encodeURIComponent` for path parameters
- Throws AxiosError on failure with status code preserved for the error handler middleware

**`gateway/src/services/transcriptWriter.ts` -- Atomic file write pattern**
- Established three-step pattern: `fs.mkdir(dir, { recursive: true })`, `fs.writeFile(tempPath, content, 'utf8')`, `fs.rename(tempPath, finalPath)`
- Per-step try/catch with descriptive logging at each failure point
- Uses `path.join` for cross-platform path construction
- The MISSION.MD writer should replicate this exact approach, but throw errors instead of silently returning (the MCP route must report failure to the caller)

**`gateway/src/types/tools.ts` -- Tool definition and type registration pattern**
- Shows how to add a new tool: extend `ToolName` union, extend `ALLOWED_TOOL_NAMES` array, add params interface, extend `ToolParams` union, add entry to `TOOL_DEFINITIONS` with flat `ToolParameterSchema`
- `ToolParameterSchema` only supports `Record<string, { type, description?, enum? }>` -- no nested objects; all params must be top-level

**`gateway/src/services/toolExecutor.ts` -- Tool endpoint and required-param wiring**
- Add entry to `TOOL_ENDPOINTS` and `TOOL_REQUIRED_PARAMS` maps keyed by tool name
- The `executeTool` function automatically adds `sessionId` to the request body and routes to the correct MCP endpoint
- No per-tool custom executor logic needed; the standard `axios.post` flow handles everything

## Out of Scope
- Any changes to PM prompt, behavior, or conversation flow to invoke the tool (deferred to Increment 5)
- Any additional product artifacts beyond MISSION.MD (e.g., vision, principles, roadmap files)
- Any structured ProductDefinition fields beyond projectId and productName (e.g., description, goals)
- Any changes to conversation persistence logic or transcript writing
- Any UI changes or frontend modifications
- Any changes to the `ToolParameterSchema` interface (keeping flat params; nested `artifacts` object deferred)
- Migration or rename of any existing lowercase `mission.md` file
- Automatic rollback or cleanup of written MISSION.MD file if DB upsert fails
- Explicit `fsync`/`fdatasync` on file write (using the simpler `writeFile` + `rename` pattern)
- Any changes to Express JSON body parser limits (the ~200KB cap is validated at route level, not parser level)
