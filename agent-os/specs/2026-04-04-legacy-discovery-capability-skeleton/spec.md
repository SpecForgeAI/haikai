# Specification: Legacy Discovery Capability Skeleton

## Goal
Create the foundational skeleton for a new standalone discovery micro-service with a Phase 0/Phase 1 pipeline structure, an analyzer-pack extension-point model, minimal gateway awareness, and Docker Compose integration -- establishing the architecture for 15 subsequent increments without implementing any real discovery logic.

## User Stories
- As a platform developer, I want a well-structured discovery service skeleton so that I can incrementally add real analyzers and pipeline logic in future increments without refactoring the foundation.
- As a platform developer, I want the gateway to be minimally aware of the discovery capability so that future increments can wire up full proxy routing without restructuring gateway code.

## Specific Requirements

**New discovery-service directory and project scaffolding**
- Create a new top-level directory `discovery-service/` as a standalone Express/TypeScript micro-service
- Include `package.json` with name `@arch-model/discovery-service`, Express, dotenv, uuid as dependencies, and tsx, typescript, jest, ts-jest, @types/* as devDependencies (mirror `mcp-server/package.json` dependency versions)
- Include `tsconfig.json` matching the mcp-server pattern (ES2020 target, commonjs module, strict mode, rootDir `./src`, outDir `./dist`)
- Include `jest.config.js` matching the mcp-server pattern (ts-jest preset, node environment, roots `<rootDir>/src`, testMatch `**/__tests__/**/*.test.ts`)
- Standard sub-directory structure: `src/`, `src/routes/`, `src/services/`, `src/types/`, `src/middleware/`, `src/__tests__/`

**Express application entry point (src/index.ts)**
- Follow the `mcp-server/src/index.ts` pattern: create Express app, apply JSON body parser, mount request logger middleware, mount routes, mount health check, apply error handler, start server
- Health check at `GET /health` returning `{ status: 'ok', timestamp: ISO-string }`
- Mount the discovery pipeline router at `/discovery`
- Read port from `PORT` env var with default `8091`
- Export `app` for test usage

**Service configuration (src/config.ts)**
- Export `PORT` from env with default `8091`
- Export a placeholder `ARCHITECTURE_MODEL_SERVICE_BASE_URL` constant (default `http://localhost:8080`) for future use -- not called at runtime in this increment

**Middleware (src/middleware/)**
- `errorHandler.ts`: simplified version of the mcp-server error handler -- catches errors, returns `{ error: { code, message } }` JSON responses
- `requestLogger.ts`: logs incoming requests to `/discovery/` routes with method, path, and response status/duration

**Phase 0 pipeline route stub (POST /discovery/phase0/frame)**
- Accepts `{ projectId: string }` in the request body
- Validates that `projectId` is a non-empty string; returns 400 if missing
- Returns a stub response: `{ phase: 'phase0', step: 'frame', status: 'stub', projectId }`
- This route represents discovery framing/setup; no real logic

**Phase 1 pipeline route stubs (POST /discovery/phase1/:step)**
- Accepts `{ projectId: string }` in the request body with a route param `:step` constrained to values `1a`, `1b`, `1c`, `1d`
- Validates `projectId` (non-empty string, 400 if missing) and `:step` (must be one of the four allowed values, 400 if invalid)
- Returns a stub response: `{ phase: 'phase1', step, status: 'stub', projectId }`
- These four sub-stages represent the code-repo analysis pipeline; no real logic

**Discovery routes barrel (src/routes/index.ts)**
- A single Express Router that mounts the Phase 0 and Phase 1 route handlers
- Export the router for mounting in `index.ts`

**Analyzer-pack interface and types (src/types/)**
- Define an `AnalyzerPack` interface with: `id: string`, `name: string`, `description: string`, `supportedPhases: string[]`, `analyze(input: AnalyzerInput): Promise<AnalyzerResult>`
- Define `AnalyzerInput` type with: `projectId: string`, `phase: string`, `step: string`, `context: Record<string, unknown>`
- Define `AnalyzerResult` type with: `analyzerId: string`, `phase: string`, `step: string`, `findings: AnalyzerFinding[]`, `metadata: Record<string, unknown>`
- Define `AnalyzerFinding` type with: `id: string`, `category: string`, `summary: string`, `detail: string`, `severity: 'info' | 'warning' | 'critical'`
- Export all types from a barrel `src/types/index.ts`

**Analyzer-pack registry (src/services/analyzerRegistry.ts)**
- Follow the `contextResolvers.ts` pattern: a `Map<string, AnalyzerPack>` registry, an `initializeAnalyzerRegistry()` function, and a `getAnalyzerRegistry()` getter
- `initializeAnalyzerRegistry()` registers the stub analyzer pack (see next requirement) and logs the count
- Export `registerAnalyzerPack(pack: AnalyzerPack)` for future use by real analyzers

**Stub analyzer pack (src/services/stubAnalyzerPack.ts)**
- Implements the `AnalyzerPack` interface with id `stub-noop`, name `Stub No-Op Analyzer`, supportedPhases `['phase0', 'phase1']`
- The `analyze()` method returns an `AnalyzerResult` with an empty `findings` array and metadata `{ stub: true }`
- This serves as the reference implementation for future real analyzer packs

**Project context contract types (src/types/projectContext.ts)**
- Define `DiscoveryProjectContext` interface with: `projectId: string`, `projectFolderPath?: string`, `repoUrl?: string`
- Define `DiscoveryRequest` interface with: `projectId: string`, `phase: string`, `step: string`, `options?: Record<string, unknown>`
- These are type-only definitions; no runtime integration with the architecture-model-service

**Minimal gateway awareness**
- Add `discoveryServiceBaseUrl` to the gateway `Config` interface and `loadConfig()` in `gateway/src/config.ts`, reading from `DISCOVERY_SERVICE_URL` env var with default `http://localhost:8091`
- Create a new route file `gateway/src/routes/discovery.ts` exporting a `discoveryRouter` with a single `GET /` endpoint returning `{ capability: 'discovery', status: 'registered', version: '0.1.0' }`
- Export `discoveryRouter` from `gateway/src/routes/index.ts`
- Mount in `gateway/src/server.ts` at `/api/v1/discovery`
- No proxy logic, no tool wiring, no `ALLOWED_TOOL_NAMES` or `TOOL_ENDPOINTS` changes

**Dockerfile.dev for the discovery service**
- Follow the `mcp-server/Dockerfile.dev` pattern: `node:20-alpine` base, WORKDIR `/app`, copy `package.json` and `package-lock.json`, `npm ci`, EXPOSE `8091`, CMD `npm run dev`

**Docker Compose integration**
- Add a `discovery-service` entry to `docker-compose.yml` following the `mcp-server` pattern
- Map port `8091:8091`, volume-mount `./discovery-service/src:/app/src:delegated`
- Set environment: `PORT: 8091`
- Place on the `arch-tool-network`
- No `depends_on` needed in this skeleton increment (no backend calls)

**Basic unit tests**
- Test the health check endpoint returns 200 with `{ status: 'ok' }` shape
- Test Phase 0 route returns stub response with correct shape and 400 on missing projectId
- Test Phase 1 route returns stub response for valid steps (1a-1d), 400 on invalid step or missing projectId
- Test `initializeAnalyzerRegistry()` populates the registry with the stub analyzer
- Test the stub analyzer pack `analyze()` returns empty findings
- All tests in `src/__tests__/` using Jest with ts-jest

## Existing Code to Leverage

**mcp-server/ project structure and entry point**
- The entire `mcp-server/` directory serves as the structural template for the new service's scaffolding (package.json, tsconfig.json, jest.config.js, Dockerfile.dev, src/ directory layout)
- `mcp-server/src/index.ts` provides the exact Express app bootstrap pattern to replicate: JSON body parser, middleware order, router mounting, health check, error handler, server start
- `mcp-server/src/config.ts` shows the simple env-var export pattern for service-local configuration

**gateway/src/services/contextResolvers.ts interface + registry pattern**
- The `ContextResolver` interface, `Map<string, ContextResolver>` registry, `initializeContextResolverRegistry()`, and `getContextResolverRegistry()` getter are the direct model for the analyzer-pack registry
- The `StubContextResolver` class that implements the interface with no-op behavior is the template for the stub analyzer pack
- The pattern of registering both live and stub implementations during initialization should be followed

**gateway/src/config.ts and gateway/src/server.ts for gateway integration**
- `config.ts` shows how to add a new downstream service URL (`mcpBaseUrl`, `jiraServiceBaseUrl`, etc.) -- add `discoveryServiceBaseUrl` following the same pattern
- `server.ts` shows how to import a router and mount it at a path with `app.use('/api/...', router)` -- follow for mounting the discovery route
- `gateway/src/routes/index.ts` shows the barrel export pattern for new route modules

**mcp-server/src/middleware/ for error handling and request logging**
- `errorHandler.ts` provides the error middleware pattern with `HttpError` interface and `createHttpError()` utility to adapt for the discovery service
- `requestLogger.ts` provides the request logging middleware pattern with timing and status code logging

**docker-compose.yml mcp-server entry for Docker integration**
- The `mcp-server` service block shows the exact pattern for a Node.js dev service: build context, Dockerfile.dev, port mapping, src volume mount, environment variables, network membership

## Out of Scope
- Any real scanning, code analysis, or discovery logic (all routes return stub responses only)
- Persistence or storage of discovery results (no database, no file-system writes for results)
- Frontend UX or UI components for discovery
- Runtime integration with the architecture-model-service (types defined, no HTTP calls)
- Integration with the existing `discoveryInsightsService.ts` in the gateway
- Persona/task JSON config files for the chatV2 conversation engine
- Full gateway tool wiring (`ALLOWED_TOOL_NAMES`, `TOOL_ENDPOINTS`, `toolExecutor` proxy logic)
- Authentication or authorization on any discovery endpoints
- WebSocket or streaming support
- Phases beyond Phase 0 and Phase 1 skeleton (Phase 2+ are future increments)
- Any real analyzer-pack implementations beyond the single stub/no-op
