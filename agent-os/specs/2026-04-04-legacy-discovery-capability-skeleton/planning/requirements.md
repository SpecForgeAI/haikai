# Spec Requirements: Legacy Discovery Capability Skeleton

## Initial Description
Increment 1 of 16 -- Legacy / Current-State Discovery capability skeleton + extension-point architecture. Creates a new discovery micro-service with Phase 0/Phase 1 pipeline skeleton, analyzer-pack extension-point model, and minimal gateway awareness. Foundational skeleton only -- no scanning, no frontend UX, no persistence yet.

## Requirements Discussion

### First Round Questions

**Q1:** I assume the new "discovery micro-service" will be a standalone Express/TypeScript service similar to the existing `mcp-server` (Express, mounted at a dedicated path, with its own `src/`, `routes/`, `services/`, `types/` structure, its own `Dockerfile.dev`, and its own `package.json`). Is that correct, or should it be a new module within the existing `mcp-server` or `gateway` instead?
**Answer:** Yes -- a standalone micro-service is the correct approach.

**Q2:** The raw idea references "Phase 0 / Phase 1 pipeline skeleton." I'm assuming Phase 0 is an initial intake/ingestion step (e.g., accepting a target -- repo URL, folder path, or artifact references) and Phase 1 is where analyzer packs would be invoked to produce findings. Could you describe what Phase 0 and Phase 1 each represent, and whether there are further phases (Phase 2, 3, etc.) planned for later increments?
**Answer:** Phase 0 = discovery framing/setup; Phase 1 = code-repo analysis (1a-1d pipeline). More phases come later.

**Q3:** For the "analyzer-pack extension-point model," I'm assuming this means a plugin-like interface where each analyzer pack conforms to a standard contract (e.g., an interface with `analyze(input): Promise<AnalyzerResult>` and metadata like `id`, `name`, `supportedArtifactTypes`), and analyzer packs are registered/discovered at startup. Is that the pattern you have in mind, or is there a different mechanism (e.g., file-system convention, explicit configuration file, dynamic loading)?
**Answer:** Yes -- a simple plugin-style interface with a registry/config is the right pattern.

**Q4:** For "minimal gateway awareness" -- I assume this means adding a new route in the gateway (e.g., `POST /api/v1/discovery/...`) that proxies to the discovery micro-service, similar to how the gateway proxies tool calls to the `mcp-server` via `toolExecutor.ts`. Should this also include registering a new tool name in the gateway's `ALLOWED_TOOL_NAMES` and `TOOL_ENDPOINTS` lists, or is it purely a pass-through route at this stage?
**Answer:** Keep it minimal -- just enough to recognise the capability, not full tool wiring yet.

**Q5:** Since this is described as "foundational skeleton only -- no scanning, no frontend UX, no persistence yet," I'm assuming the deliverables are: (a) the new service with health endpoint and placeholder pipeline routes, (b) the analyzer-pack interface/types with at least one stub/no-op analyzer, (c) gateway route awareness, and (d) Docker Compose integration. Is there anything else that should be in scope for this skeleton increment, or anything I've listed that should NOT be in scope?
**Answer:** Yes to service skeleton, analyzer interface, basic routes, and wiring; no real discovery logic.

**Q6:** I assume the discovery service will need to know which project it's operating on (accepting a `projectId` parameter), and will eventually need access to the architecture-model-service to read existing model data. For this skeleton increment, should we just define the interface/contract for project context, or should we actually wire up connectivity to the architecture-model-service?
**Answer:** Define the contract shape (e.g. projectId), but don't integrate with backend services yet.

**Q7:** Since the existing system has a well-defined persona/task/conversation engine (chatV2), I assume this discovery capability will eventually surface as a new task (perhaps under the Architect persona) within the conversation engine. For this skeleton increment, should we create the task/persona JSON config files as stubs, or is that for a later increment?
**Answer:** Leave this for later -- not needed in this increment.

**Q8:** Is there anything that should be explicitly excluded from this increment that might otherwise seem like a natural part of the skeleton? For example: authentication/authorization, persistent storage of discovery results, any frontend components, integration with the existing `discoveryInsightsService.ts`, or WebSocket/streaming support?
**Answer:** Exclude everything beyond skeleton setup (no persistence, no scanning, no frontend, no integrations).

### Existing Code to Reference

No similar features were explicitly identified by the user for direct reuse. However, based on codebase analysis, the following existing patterns are strong structural templates for the spec-writer:

**Similar Features Identified:**
- Feature: MCP Server - Path: `mcp-server/` -- standalone Express/TypeScript micro-service with `src/routes/`, `src/services/`, `src/types/`, `src/middleware/`, `Dockerfile.dev`, `package.json`, `tsconfig.json`, `jest.config.js`. This is the closest structural analogue for the new discovery service.
- Feature: MCP Server entry point - Path: `mcp-server/src/index.ts` -- Express app setup with JSON body parser, middleware, health check, and router mounting pattern.
- Feature: MCP Server tools router - Path: `mcp-server/src/routes/tools.ts` -- pattern for a central router that mounts sub-route modules.
- Feature: Context Resolver extension-point model - Path: `gateway/src/services/contextResolvers.ts` -- interface + registry pattern (`ContextResolver` interface, `initializeContextResolverRegistry()`, `Map<string, ContextResolver>`) that maps directly to the analyzer-pack registry concept.
- Feature: Registry Loader - Path: `gateway/src/services/registryLoader.ts` -- startup-time loading of JSON config files into in-memory registries with validation; applicable pattern for loading analyzer-pack registrations.
- Feature: Gateway server route mounting - Path: `gateway/src/server.ts` -- pattern for how new routes are mounted and exported (import in server.ts, `app.use('/api/...', router)`).
- Feature: Gateway route index - Path: `gateway/src/routes/index.ts` -- central export barrel for all route modules.
- Feature: Gateway config - Path: `gateway/src/config.ts` -- configuration pattern including base URLs for downstream services (e.g., `mcpBaseUrl`); the discovery service URL will need a similar config entry.
- Feature: Docker Compose - Path: `docker-compose.yml` -- existing multi-service orchestration where the new discovery service will need an entry.

### Follow-up Questions
No follow-up questions were needed. All answers were clear and specific.

## Visual Assets

### Files Provided:
No visual assets provided (confirmed via file system check).

### Visual Insights:
N/A -- no visual assets to analyze.

## Requirements Summary

### Functional Requirements

**Discovery Micro-Service (new standalone service):**
- A new Express/TypeScript micro-service in its own top-level directory (e.g., `discovery-service/`)
- Standard project structure: `src/`, `src/routes/`, `src/services/`, `src/types/`, `src/middleware/`
- Health check endpoint (`GET /health`)
- Pipeline skeleton routes for Phase 0 (discovery framing/setup) and Phase 1 (code-repo analysis pipeline with sub-stages 1a-1d)
- Pipeline routes accept `projectId` in request bodies but do not yet integrate with any backend services
- Pipeline routes return stub/placeholder responses indicating the pipeline stage and status

**Analyzer-Pack Extension-Point Model:**
- A TypeScript interface defining the analyzer-pack contract (e.g., `AnalyzerPack` with `id`, `name`, `analyze()` method, metadata)
- A registry mechanism for registering and discovering analyzer packs at startup (Map-based, similar to `contextResolverRegistry`)
- At least one stub/no-op analyzer pack implementation that conforms to the interface
- Type definitions for analyzer input and output shapes

**Minimal Gateway Awareness:**
- A new route in the gateway that recognises the discovery capability exists (minimal -- e.g., a discovery route stub or config entry)
- Gateway config updated with the discovery service base URL
- No full tool wiring (no `ALLOWED_TOOL_NAMES` or `TOOL_ENDPOINTS` entries)
- No proxy-to-service call logic yet -- just enough structure so the gateway knows the capability is registered

**Project Context Contract:**
- Type/interface definitions for project context that the discovery service will eventually need (e.g., `projectId`, project folder path)
- Contract is defined as TypeScript types only -- no runtime integration with architecture-model-service

**Infrastructure:**
- `Dockerfile.dev` for the new service
- Entry in `docker-compose.yml` for the new service
- `package.json`, `tsconfig.json`, and Jest test configuration

### Reusability Opportunities
- `mcp-server/` directory structure as the primary template for the new service's project scaffolding
- `mcp-server/src/index.ts` as the template for Express app bootstrap (health check, middleware, router mounting)
- `gateway/src/services/contextResolvers.ts` interface + registry pattern as the model for the analyzer-pack registry
- `gateway/src/services/registryLoader.ts` startup-loading pattern for initializing analyzer pack registrations
- `gateway/src/config.ts` for adding the discovery service base URL configuration
- `gateway/src/server.ts` and `gateway/src/routes/index.ts` for the gateway integration pattern
- `mcp-server/src/middleware/errorHandler.ts` and `mcp-server/src/middleware/requestLogger.ts` as middleware templates

### Scope Boundaries

**In Scope:**
- New standalone Express/TypeScript micro-service with project scaffolding
- Health check endpoint
- Phase 0 and Phase 1 pipeline skeleton routes (stub responses only)
- Analyzer-pack TypeScript interface and registry
- At least one stub/no-op analyzer pack
- Type definitions for pipeline input/output, analyzer-pack contract, and project context
- Minimal gateway route awareness (route stub or config entry for discovery service URL)
- Docker Compose integration (new service entry)
- Dockerfile.dev for the new service
- Jest test configuration and basic unit tests for the skeleton

**Out of Scope:**
- Any real scanning or discovery logic
- Persistence / storage of discovery results
- Frontend UX or UI components
- Integration with architecture-model-service (runtime calls)
- Integration with existing `discoveryInsightsService.ts` in the gateway
- Persona/task JSON config files for the chatV2 conversation engine
- Full gateway tool wiring (`ALLOWED_TOOL_NAMES`, `TOOL_ENDPOINTS`, `toolExecutor` entries)
- Authentication / authorization
- WebSocket or streaming support
- Phases beyond Phase 0 and Phase 1 skeleton
- Any actual analyzer-pack implementations (beyond the no-op stub)

### Technical Considerations
- The service follows the same tech stack as the existing `mcp-server`: Express, TypeScript, Jest
- The analyzer-pack interface should be designed for extensibility -- future increments will add real analyzers for code-repo analysis (Phase 1a-1d)
- Phase 0 (framing/setup) and Phase 1 (code-repo analysis) are the two pipeline stages in this skeleton; additional phases will be added in later increments
- The project context contract should anticipate the `projectId`-based lookup pattern used throughout the system (e.g., `fetchProjectFolder(projectId)`)
- Gateway awareness should be structured so that full tool wiring can be added incrementally without refactoring the skeleton
- This is increment 1 of 16 -- the skeleton must be designed for incremental extension without breaking changes
