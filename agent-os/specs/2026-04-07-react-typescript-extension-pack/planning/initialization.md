# Initialization

## Spec Name
react-typescript-extension-pack

## Summary
Second concrete Extension Pack implementation for React/TypeScript codebases. Runs after the universal LLM file-level analysis (from Increment 1) and adds deterministic precision by parsing React component declarations, route definitions, API call sites, state management patterns (Redux/Context), and TypeScript module exports. Captures cross-tier dependency chains (frontend component -> API call -> backend endpoint) as relationship evidence critical for migration planning and data movement analysis.

## Context

### Product context
This tool is a full Product Delivery Lifecycle (PDLC) tool. Discovery feeds current state architecture, target state design, and implementation planning for legacy migration projects. The React/TypeScript Extension Pack must capture frontend-specific evidence including: which components exist and are routed, which backend endpoints they depend on (cross-tier dependencies), and how state flows through the application. This evidence is critical for migration sequencing -- you cannot migrate a backend endpoint without understanding which frontend components depend on it.

### Dependency
This spec depends on:
- Increment 1 (Extension Pack Framework & LLM File Analysis Pipeline) -- for the pack registry, framework, and LLM analysis that runs first
- Increment 2 (Java/Spring Boot Extension Pack) -- not a hard dependency, but the cross-tier relationship evidence (frontend API calls -> backend endpoints) is most valuable when the backend pack has already identified the target endpoints

### What the LLM provides (that the pack sharpens)
The universal LLM file-level analysis will identify entities like "this is a React component" or "this file has API calls." But the LLM output may:
- Miss the distinction between page-level routed components and small presentational components
- Miss exact API call URLs and HTTP methods from axios/fetch calls
- Miss the mapping between route paths and component references
- Approximate Redux store structure instead of extracting exact slice definitions
- Miss Context provider/consumer patterns
- Not capture the cross-tier dependency chain (component X calls endpoint Y)

The pack provides deterministic extraction from code patterns specific to React/TypeScript.

### Architecture meta-model entity types this pack targets
From the existing meta-model schema:
- **Class** (`classes`): Page-level React components, significant modules. Fields: name, description, class_type, tags
- **Endpoint** (`endpoints`): Route definitions (internal navigation), external API call sites (calls TO backend endpoints). Fields: name, description, http_method, path, tags
- **Method** (`methods`): Significant exported functions, custom hooks. Fields: name, description, method_type, return_type, tags

Additionally, state management entities may map to:
- **Class** for Redux stores/slices and Context providers (architectural state containers)

### Important: scope of "Endpoint" in React context
Two distinct kinds of endpoints are relevant:
1. **Route definitions** (internal): `<Route path="/dashboard" element={<DashboardView />} />` -- these are internal navigation endpoints showing the frontend's URL structure
2. **External API call sites**: `axios.get('/api/projects')`, `fetch('/api/model')` -- these represent the frontend's dependencies on backend service endpoints. They are the endpoints of the EXTERNAL service being called, and are critical for:
   - Cross-tier dependency mapping (which frontend components depend on which backend endpoints)
   - Data movement analysis (what data flows from backend to frontend)
   - Migration sequencing (changing a backend endpoint requires knowing all frontend consumers)

Both types should be captured but distinguished in the candidate data payload.

## Existing State
- `discovery-service/src/types/analyzerPack.ts` -- AnalyzerPack interface
- `discovery-service/src/services/analyzerRegistry.ts` -- pack registry
- Discovery config `techHints` already captures: `{ path: "frontend", language: "TypeScript", technology: "React" }`
- The scanned codebase (Scenarios) uses: React functional components, React Router, axios for API calls, TypeScript
- CandidateType union includes: class, method, endpoint (added in Increment 1)

## What This Spec Must Deliver

### 1. React/TypeScript Extension Pack implementation
- Implements the Extension Pack interface from Increment 1
- Registered in the pack registry with applicability predicate: `when: { language: "TypeScript", technology: "React" }`
- Auto-selected when techHints match
- Runs after LLM file-level analysis on TypeScript/JSX/TSX files within applicable paths

### 2. Component detection -> Class candidates (filtered)
- **Page-level / routed components ONLY** become Class candidates
  - Components referenced in route definitions (`<Route element={<ComponentName />} />`)
  - Components that are default exports from files matching page/view/screen naming patterns
  - Components registered as route targets in router configuration
- **Skip presentational components**: Small reusable components (buttons, icons, wrappers, layout primitives) are NOT candidates unless they are routed
- **Capture for each component candidate**:
  - Component name
  - File path and export type (default vs named)
  - Props interface/type (the component's API contract)
  - Which route path(s) render this component (if routed)

### 3. Route definition detection -> Endpoint candidates (internal)
- Parse React Router configuration: `<Route path="..." element={...} />`
- Parse route arrays/objects if used: `{ path: '/dashboard', element: DashboardView }`
- Capture for each route endpoint:
  - Route path (exact string)
  - Component reference (link to component Class candidate)
  - Nested route structure (parent/child routes)
  - Route parameters (`:id`, `:projectId`, etc.)
- Mark as `endpoint_subtype: 'route'` in candidate data to distinguish from API calls

### 4. External API call site detection -> Endpoint candidates (external)
- **Axios calls**: `axios.get(...)`, `axios.post(...)`, `axiosInstance.get(...)`, etc.
  - Extract HTTP method and URL/path
  - Extract request body type (if TypeScript typed)
  - Extract response type (if TypeScript typed)
- **Fetch calls**: `fetch('/api/...')`, `fetch(url, { method: 'POST' })`, etc.
  - Extract URL and HTTP method
  - Extract body/response types where inferable
- **API client wrapper functions**: Functions that wrap axios/fetch (e.g., `discoveryApi.getCandidates()`)
  - Detect the underlying HTTP call within the wrapper
  - Capture the wrapper function name as an alias
- **Capture for each API call site**:
  - HTTP method (GET, POST, PUT, DELETE, PATCH)
  - URL/path (the backend endpoint being called)
  - Calling component/function (which frontend code makes this call)
  - Request/response types (DTO contracts)
  - Mark as `endpoint_subtype: 'api_call'` to distinguish from route definitions
- **Cross-tier relationship evidence**: For each API call, create a relationship linking the frontend component/function to the backend endpoint URL. This is the critical cross-tier dependency chain for migration planning.

### 5. State management extraction -> Class candidates
- **Redux stores/slices** (if present):
  - `createSlice({ name: '...', initialState, reducers })` -> Class candidate
  - Extract slice name, initial state shape, reducer names
  - Capture which components use this slice (via `useSelector`, `useDispatch`)
- **React Context providers** (if present):
  - `createContext(...)` / Context.Provider -> Class candidate
  - Extract context name and provided value shape
  - Capture which components consume this context (via `useContext`)
- **Custom hooks that manage shared state**:
  - Hooks that encapsulate significant state logic (e.g., `useChatThread`, `useDiscoveryOrigins`)
  - These become Method candidates linked to the state management Class

### 6. Method detection -> Method candidates (filtered)
- **Custom hooks**: `useXxx` functions that are exported -> Method candidates
  - Architecturally significant as they encapsulate reusable logic
  - Capture hook name, parameters, return type
- **API wrapper functions**: Exported functions that make HTTP calls -> Method candidates
  - e.g., `export async function fetchProjects(): Promise<Project[]>`
  - Cross-reference with API call site detection
- **Significance filter**: Skip internal helper functions, event handlers, render helpers
  - Only exported functions/hooks at module level
  - Functions that are only used within a single component are not candidates

### 7. Sharpening LLM candidates
- Same pattern as Java pack:
  - Match LLM-identified candidates to deterministic findings
  - Update with exact metadata (route paths, API URLs, component props)
  - Increase confidence for deterministically confirmed entities
  - Create new candidates for entities the LLM missed
  - Flag contradictions for review

## Key Design Decisions
- Only page-level/routed components become Class candidates (skip presentational components)
- Both route definitions AND external API call sites become Endpoint candidates, distinguished by `endpoint_subtype`
- External API calls are the most migration-critical output: they map the frontend's dependency on backend services
- Redux slices and Context providers are Class candidates (architectural state containers)
- Custom hooks are Method candidates (reusable logic units)
- Cross-tier dependency relationships (component -> API call -> backend endpoint URL) persisted as relationship evidence
- All output uses the same candidate/evidence schema as the universal pipeline
- Pack is ADDITIVE -- sharpens LLM output, does not replace it
