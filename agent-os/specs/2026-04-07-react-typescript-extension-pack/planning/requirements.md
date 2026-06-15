# Spec Requirements: React/TypeScript Extension Pack

## Initial Description
Second concrete Extension Pack implementation for React/TypeScript codebases. Runs after the universal LLM file-level analysis (from Increment 1) and adds deterministic precision by parsing React component declarations, route definitions, API call sites, state management patterns (Redux/Context), and TypeScript module exports. Captures cross-tier dependency chains (frontend component -> API call -> backend endpoint) as relationship evidence critical for migration planning and data movement analysis.

## Requirements Discussion

### First Round Questions

**Q1:** The Java pack uses `tree-sitter` with `tree-sitter-java` for AST parsing. Should we follow the same pattern and use `tree-sitter` with `tree-sitter-typescript` (which includes TSX grammar support) for parsing `.ts` and `.tsx` files? This gives us structured AST access to component declarations, hook calls, import statements, and JSX elements. Or would you prefer a lighter regex-based approach for this first version?
**Answer:** tree-sitter with tree-sitter-typescript.

**Q2:** The initialization.md describes detecting `<Route path="..." element={...} />` from React Router. However, some React codebases use state-based view switching instead (e.g., `currentView === 'dashboard' && <DashboardView />`). Should the pack support BOTH React Router route definitions AND state-dispatched view switching patterns? Or should we focus only on React Router since it is the more common/universal pattern?
**Answer:** Both React Router AND state-based view switching patterns.

**Q3:** For API call detection, should the pack support both `fetch()` and `axios`? For template literal URLs (e.g., `` `${GATEWAY_BASE}/api/v1/discovery/projects/${projectId}/summary` ``), should we attempt to resolve the base URL variable or preserve `${...}` placeholders as-is?
**Answer:** Support both fetch() and axios. Preserve `${...}` placeholders as-is in template literal URLs.

**Q4:** The frontend organizes API calls into dedicated files where each exported function wraps a `fetch()` call. Should the pack: (a) detect these wrapper functions as Method candidates AND also extract the underlying API endpoint from within them, or (b) just detect the raw `fetch()`/`axios` calls wherever they appear?
**Answer:** Both -- detect wrapper functions as Method candidates AND extract the underlying API endpoint from within them.

**Q5:** Should ALL React Context providers become Class candidates, or should we apply a significance filter (e.g., only contexts using `useReducer`)?
**Answer:** All Context providers become Class candidates for now. User will review to see if filtering is needed later.

**Q6:** Are the proposed heuristics for distinguishing page-level components from presentational ones sufficient? (Route references + naming patterns `*View.tsx`, `*Page.tsx`, `*Screen.tsx` + conditional view switching detection)
**Answer:** Sufficient as proposed.

**Q7:** For cross-tier relationship evidence, should we use the existing `relationshipType: 'calls'` with `CallsRelationshipData`, or create a new relationship type?
**Answer:** Use existing `relationshipType: 'calls'` with `CallsRelationshipData` shape since it already exists and the Java pack uses it for inter-service calls.

**Q8:** For candidate sharpening name normalization, are the following React/TypeScript suffixes complete? View, Page, Screen, Panel, Modal, Provider, Context, Hook, Api, Service.
**Answer:** Looks complete.

**Q9:** Are the following confirmed out of scope? CSS/SCSS analysis, third-party UI library detection, TypeScript type/interface extraction as standalone candidates, test file analysis, Next.js/Remix routing, GraphQL detection.
**Answer:** All confirmed out of scope.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Java/Spring Boot Extension Pack - Path: `discovery-service/src/services/extensionPacks/javaSpringBoot/`
  - Full reference implementation for the pack pattern: `index.ts` (orchestration), `fileFilter.ts`, `javaParser.ts`, `astUtils.ts`, `candidateMatcher.ts`, `candidateSharpener.ts`, `parentResolver.ts`, `extractors/` subdirectory
- Feature: Extension Pack Registry - Path: `discovery-service/src/services/extensionPackRegistry.ts`
  - Registration via `registerPack()`, predicate matching, sequential `runPacks()` execution
- Feature: Pack Startup Registration - Path: `discovery-service/src/services/extensionPacks/register.ts`
  - Import and register pattern; this file must be extended to register the new React/TypeScript pack
- Feature: ExtensionPack Interface - Path: `discovery-service/src/types/extensionPack.ts`
  - `ExtensionPack`, `ExtensionPackPredicate`, `ExtensionPackContext`, `ExtensionPackResult` interfaces
- Feature: Candidate Types - Path: `discovery-service/src/types/candidate.ts`
  - `CandidateType` union (already includes `class`, `method`, `endpoint`)
- Feature: Evidence Types - Path: `discovery-service/src/types/evidenceAtom.ts`
  - `extension_pack_analysis` atom type, `ExtensionPackAnalysisData`, `ExtensionPackFinding` interfaces

**Code Reuse Decision (candidateMatcher / candidateSharpener):**
The `candidateMatcher.ts` and `candidateSharpener.ts` from the Java pack are largely pack-agnostic in their logic. The only pack-specific elements are: (a) the pack ID string `'java-spring-boot'` hardcoded in `sharpenCandidate()` and `createNewCandidate()`, and (b) the `STRIPPABLE_SUFFIXES` list in `candidateMatcher.ts` which is Java-specific. For this increment, the simplest approach is to duplicate these files into the `reactTypescript/` directory with `'react-typescript'` branding and React/TypeScript-specific suffix lists, then consider refactoring into shared utilities in a future cleanup pass. This avoids modifying the Java pack's tested code while delivering the React pack.

### Follow-up Questions
No follow-up questions were asked.

## Visual Assets

### Files Provided:
No visual assets provided. The `planning/visuals/` directory does not exist.

### Visual Insights:
Not applicable.

## Requirements Summary

### Functional Requirements

**FR1: Pack Identity, Registration, and Activation**
- Implement the `ExtensionPack` interface with `id: 'react-typescript'`, `name: 'React/TypeScript Extension Pack'`, and `when: { language: 'TypeScript', technology: 'React' }`
- Auto-activates via `matchesPredicate()` when `techHints` contain a TypeScript/React entry; no need to be listed in `extensionPacks: string[]`
- Register via `registerPack()` in `discovery-service/src/services/extensionPacks/register.ts` (extend the existing registration file)
- The pack module lives at `discovery-service/src/services/extensionPacks/reactTypescript/index.ts`

**FR2: tree-sitter-based TypeScript/TSX AST Parsing**
- Add `tree-sitter-typescript` as an npm dependency in `discovery-service/package.json` (the `tree-sitter` core is already a dependency from Increment 2)
- `tree-sitter-typescript` provides both TypeScript and TSX grammars; use the TSX grammar for `.tsx` files and the TypeScript grammar for `.ts` files
- Create a `tsxParser.ts` module following the same singleton pattern as `javaParser.ts`
- Parse each TypeScript/TSX file's source code into a syntax tree
- Traverse AST nodes to extract: function/arrow function component declarations, JSX elements, import statements, export declarations, call expressions (for hooks, API calls, `createContext`, `createSlice`), and template literal strings
- Fall back gracefully if parsing fails for a specific file (log warning, skip file, continue)
- Filter `ExtensionPackContext.sourceFiles` to only `.ts` and `.tsx` files whose paths match `techHints` entries for TypeScript/React
- Exclude test files (paths containing `__tests__/`, or files matching `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`)

**FR3: Component Detection -> Class Candidates (Filtered)**
- Detect React functional component declarations (function declarations and arrow function expressions that return JSX)
- Only page-level / routed components become Class candidates. A component is "page-level" if ANY of the following heuristics match:
  - (a) Referenced in a `<Route>` JSX element's `element` prop (React Router pattern)
  - (b) Referenced in a conditional view-switching block (e.g., `condition && <ComponentName />` or ternary expressions where the component is rendered based on state)
  - (c) Default export or named export from a file whose name matches `*View.tsx`, `*View.ts`, `*Page.tsx`, `*Page.ts`, `*Screen.tsx`, `*Screen.ts` (case-insensitive stem matching)
  - (d) A component registered as a route target in object-style router configuration (`{ path: '...', element: ComponentName }`)
- Skip presentational components: components that do not match any page-level heuristic are NOT candidates
- Capture for each component Class candidate:
  - Component name
  - File path and export type (default vs named)
  - Props interface/type name (the component's API contract, extracted from the function signature or generic type parameter)
  - Which route path(s) render this component (if routed, from FR4)
  - Component detection source (which heuristic matched: `route_reference`, `view_switch_reference`, `naming_pattern`, `router_config_object`)

**FR4: Route Definition Detection -> Endpoint Candidates (Internal)**
- **React Router JSX pattern**: Parse `<Route path="..." element={<ComponentName />} />` JSX elements
  - Extract `path` prop value (string literal)
  - Extract component reference from `element` prop
  - Detect nested `<Route>` elements for parent/child route structure
- **React Router object pattern**: Parse route configuration arrays/objects `{ path: '/...', element: ComponentName, children: [...] }`
  - Extract path and component reference from object literal properties
- **State-based view switching pattern**: Detect conditional rendering blocks that serve as de-facto routing
  - `{state.someField === 'value' && <ComponentName />}` or `{someVar === 'value' ? <ComponentA /> : <ComponentB />}`
  - Capture the condition expression as the "route path equivalent" and the rendered component reference
  - Mark with `endpoint_subtype: 'view_switch'` to distinguish from React Router routes
- Capture for each route endpoint candidate:
  - Route path (exact string for React Router; condition expression for state-based switching)
  - Component reference (link to component Class candidate by name)
  - Nested route structure (parent/child routes if applicable)
  - Route parameters (`:id`, `:projectId`, etc. from React Router paths)
  - `endpoint_subtype: 'route'` for React Router definitions, `endpoint_subtype: 'view_switch'` for state-based switching

**FR5: External API Call Site Detection -> Endpoint Candidates (External)**
- **Axios call detection**: Detect `axios.get(...)`, `axios.post(...)`, `axios.put(...)`, `axios.delete(...)`, `axios.patch(...)`, `axios.request(...)`, and custom instance calls (e.g., `axiosInstance.get(...)`, `apiClient.post(...)`)
  - Extract HTTP method from the method name (`.get` -> GET, `.post` -> POST, etc.)
  - Extract URL/path from the first argument (string literal or template literal)
  - Extract TypeScript generic type arguments if present (e.g., `axios.get<ResponseType>(url)`)
- **Fetch call detection**: Detect `fetch(url)` and `fetch(url, options)` calls
  - Extract URL from the first argument (string literal or template literal)
  - Extract HTTP method from the `options.method` property if present; default to GET if absent
  - Extract TypeScript type assertions on the response if present
- **Template literal URL handling**: When the URL argument is a template literal (`` `${BASE}/api/...` ``), preserve `${...}` placeholder expressions as-is in the captured URL string. Do NOT attempt to resolve variable references.
- **API client wrapper function detection**: Detect exported async functions that contain exactly one `fetch()` or `axios.*()` call in their body
  - These become Method candidates (FR7) in addition to the API call endpoint extraction
  - Capture the wrapper function name as `data.wrapperFunction` on the endpoint candidate
  - Cross-reference: the endpoint candidate's `data.callingFunction` points to the wrapper Method candidate name
- Capture for each API call endpoint candidate:
  - HTTP method (GET, POST, PUT, DELETE, PATCH, or 'UNKNOWN' if unresolvable)
  - URL/path (the backend endpoint being called, with `${...}` placeholders preserved)
  - File path where the call was detected
  - Calling function name (the function or component that contains the call)
  - Request body type name (if TypeScript-typed, from generic or parameter type)
  - Response type name (if TypeScript-typed, from generic or return type)
  - `endpoint_subtype: 'api_call'` to distinguish from route definitions
- **Cross-tier relationship evidence**: For EACH API call site, produce an `EvidenceRelationship` with:
  - `relationshipType: 'calls'`
  - `confidence: 1.0` (deterministic extraction)
  - `data` conforming to `CallsRelationshipData` shape: `{ callerSignature, calleeSignature, line }`
  - `callerSignature`: the frontend function/component making the call (e.g., `discoveryApi.getDiscoveryRunSummary`)
  - `calleeSignature`: the backend endpoint URL pattern (e.g., `GET /api/v1/discovery/projects/{projectId}/summary`)

**FR6: State Management Extraction -> Class Candidates**
- **Redux toolkit detection** (if present in target codebase):
  - Detect `createSlice({ name: '...', initialState: ..., reducers: { ... } })` call expressions
  - Extract slice name from the `name` property
  - Extract reducer function names from the `reducers` object keys
  - Extract initial state shape (type or object literal)
  - Each slice becomes a Class candidate with `data.classType: 'redux_slice'`
- **React Context provider detection**:
  - Detect `createContext(...)` call expressions
  - Extract the variable name assigned to the context (e.g., `const MyContext = createContext(...)`)
  - Detect corresponding Provider components (files exporting a `*Provider` function that renders `<SomethingContext.Provider>`)
  - ALL Context providers become Class candidates (no significance filtering for this increment)
  - Class candidate `data.classType: 'context_provider'`
  - Capture: context name, default value type (if typed), provider component name
- **Consumer tracking**: For both Redux and Context, detect usage sites:
  - `useSelector(...)`, `useDispatch()` for Redux
  - `useContext(MyContext)` for Context
  - Record which files/components consume each state container as metadata on the Class candidate

**FR7: Method Detection -> Method Candidates (Filtered)**
- **Custom hooks**: Detect exported functions whose names start with `use` followed by an uppercase letter (`useXxx` pattern)
  - Each exported custom hook becomes a Method candidate
  - Capture: hook name, parameter types, return type
  - `data.methodType: 'custom_hook'`
- **API wrapper functions**: Detect exported `async` functions that contain `fetch()` or `axios.*()` calls
  - Each becomes a Method candidate with `data.methodType: 'api_wrapper'`
  - Cross-referenced with FR5 endpoint extraction (the Method candidate and Endpoint candidate share a linking reference)
  - Capture: function name, parameter types, return type, which API endpoint it wraps
- **Significance filter**:
  - Only `export`-ed functions/hooks at module level (skip non-exported, skip functions nested inside other functions)
  - Skip internal helper functions: non-exported functions, event handler callbacks, render helpers
  - Skip functions that are only used within a single component file (non-exported)
- **Parent resolution**: Method candidates that are custom hooks or API wrappers do not have a natural parent class in the same way Java methods do. Parent resolution for methods:
  - If the hook is defined in the same file as a Context provider, link to the Context Class candidate via `parentCandidateId`
  - If the API wrapper is defined in a dedicated API client file, no parent (standalone Method)

**FR8: Candidate Sharpening Mechanics**
- Same multi-level matching pattern as the Java pack:
  - (1) Exact file path + exact name match
  - (2) Same file path + normalized name (strip React/TypeScript suffixes, case-insensitive)
  - (3) Same file path + same candidateType when only one of that type exists
- **React/TypeScript strippable suffixes for normalization**: `View`, `Page`, `Screen`, `Panel`, `Modal`, `Provider`, `Context`, `Hook`, `Api`, `Service`
- Sharpen existing candidates in-place: merge deterministic metadata into `data`, boost `confidence` to `Math.max(candidate.confidence, 0.95)`, add `data._sharpenedBy: 'react-typescript'`, `data._sharpenedAt`, `data._annotationSource` (repurposed: `annotationType` will hold values like `'Route'`, `'fetch'`, `'createContext'`, `'useXxx'` etc.)
- New candidates (LLM missed): `status: 'proposed'`, `confidence: 0.95`, `data._addedBy: 'react-typescript'`, resolve `parentCandidateId` against existing candidates
- Contradiction handling: add `data._contradiction: { reason, packFindings }` but do NOT change candidateType or reject the candidate

**FR9: Extension Pack Analysis Evidence Atoms**
- Produce one `extension_pack_analysis` evidence atom per TypeScript/TSX file analyzed
- Use the existing `ExtensionPackAnalysisData` interface with `packId: 'react-typescript'`
- Each atom contains an array of `ExtensionPackFinding` objects for all findings in that file
- Finding types include: `react_component`, `route_definition`, `view_switch`, `api_call_fetch`, `api_call_axios`, `redux_slice`, `context_provider`, `custom_hook`, `api_wrapper_function`

**FR10: File Filtering**
- Filter source files to `.ts` and `.tsx` files matching techHints for TypeScript/React
- Exclude test files: paths containing `/__tests__/`, `__test__/`, or files matching `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`
- Exclude `node_modules/` paths
- Exclude declaration files (`*.d.ts`)
- Include config files that may contain route definitions (e.g., `routes.ts`, `router.ts`, `App.tsx`)

**FR11: Pack Output Structure**
- The `enrich()` method returns `ExtensionPackResult` with:
  - `candidates`: the full candidate array (mutated originals + new candidates)
  - `atoms`: `extension_pack_analysis` evidence atoms (one per file analyzed)
  - `relationships`: `EvidenceRelationship` objects for cross-tier API call dependencies (using `relationshipType: 'calls'` with `CallsRelationshipData`)
- The registry merges results: candidates replace the previous set, atoms and relationships are accumulated (same merge behavior as the Java pack)

### Reusability Opportunities

**Duplicated with pack-specific branding (simplest for this increment):**
- `candidateMatcher.ts` -> copy into `reactTypescript/` directory with React/TypeScript-specific `STRIPPABLE_SUFFIXES` list
- `candidateSharpener.ts` -> copy into `reactTypescript/` directory with `'react-typescript'` pack ID
- `parentResolver.ts` -> copy into `reactTypescript/` directory with React/TypeScript-specific `PARENT_TYPE_MAP`

**Structural patterns to mirror from Java pack:**
- `index.ts` orchestration (enrich method with step-by-step processing)
- `fileFilter.ts` (adapted for `.ts`/`.tsx` files and test file exclusion patterns)
- `tsxParser.ts` (new, following `javaParser.ts` singleton pattern but for tree-sitter-typescript)
- `astUtils.ts` (new, TypeScript/TSX-specific AST traversal utilities)
- `extractors/` subdirectory for domain-specific extractors

**Future refactoring opportunity (out of scope for this increment):**
- Extract `candidateMatcher.ts`, `candidateSharpener.ts`, and `parentResolver.ts` into a shared `discovery-service/src/services/extensionPacks/shared/` directory, parameterized by pack ID and suffix lists

### Scope Boundaries

**In Scope:**
- React/TypeScript Extension Pack implementing the `ExtensionPack` interface
- tree-sitter-typescript AST parsing for `.ts` and `.tsx` files
- Page-level component detection via multiple heuristics (Route references, naming patterns, view-switch references)
- React Router route definition detection (JSX `<Route>` and object config patterns)
- State-based view switching detection as a routing alternative
- External API call site detection for both `fetch()` and `axios` patterns
- Template literal URL extraction preserving `${...}` placeholders as-is
- API wrapper function detection as Method candidates with underlying endpoint extraction
- Redux `createSlice` detection as Class candidates
- React Context `createContext`/Provider detection as Class candidates (all contexts, no filtering)
- Custom hook (`useXxx`) detection as Method candidates
- Consumer tracking for Redux selectors/dispatch and Context consumers
- Candidate sharpening with React/TypeScript-specific name normalization
- Cross-tier relationship evidence using `relationshipType: 'calls'` with `CallsRelationshipData`
- `extension_pack_analysis` evidence atoms per file
- Registration in the extension pack registry alongside the Java pack

**Out of Scope:**
- CSS/SCSS module analysis or style extraction
- Third-party UI library component detection (Material UI, Ant Design, Chakra, etc.)
- TypeScript type/interface definitions as standalone candidates
- Test file analysis (`.test.ts`, `.test.tsx`, `.spec.ts`, `.spec.tsx`, `__tests__/` directories)
- Next.js, Remix, Gatsby, or other meta-framework-specific routing patterns
- GraphQL query/mutation/subscription detection
- Server-side rendering (SSR) or static site generation (SSG) patterns
- Webpack/Vite/esbuild configuration analysis
- `package.json` dependency analysis
- Refactoring `candidateMatcher`/`candidateSharpener` into shared utilities (future increment)
- Changes to the frontend candidate review UI or dashboard
- Changes to steps 1a, 1b, or the LLM file analysis step
- Redux Toolkit Query (RTK Query) endpoint definitions
- MobX, Zustand, Jotai, Recoil, or other non-Redux/non-Context state management libraries

### Technical Considerations

**Dependencies on prior increments:**
- Increment 1 (Extension Pack Framework & LLM File Analysis Pipeline): provides the `ExtensionPack` interface, `ExtensionPackContext`, `ExtensionPackResult`, `extensionPackRegistry`, pipeline hook after LLM file analysis, `extension_pack_analysis` evidence atom type, and `CandidateType` union with `class`, `method`, `endpoint`
- Increment 2 (Java/Spring Boot Extension Pack): provides the reference implementation pattern, establishes the `candidateMatcher`/`candidateSharpener`/`parentResolver` pattern, and the `register.ts` startup file that must be extended

**NPM dependency:**
- `tree-sitter-typescript` must be added to `discovery-service/package.json` (the `tree-sitter` core package is already present from Increment 2)
- `tree-sitter-typescript` exposes two grammars: `require('tree-sitter-typescript').typescript` for `.ts` files and `require('tree-sitter-typescript').tsx` for `.tsx` files

**Existing type system compatibility:**
- `CandidateType` union already includes `class`, `method`, `endpoint` -- no new types needed
- `EvidenceAtomType` already includes `extension_pack_analysis` -- no new types needed
- `RelationshipType` already includes `calls` -- no new types needed
- `CallsRelationshipData` shape already exists -- reuse directly

**Pack execution order:**
- When both Java and React packs are applicable (e.g., a full-stack project with `techHints` for both), the Java pack runs first, then the React pack runs second
- The React pack receives candidates already sharpened by the Java pack
- Cross-tier relationships produced by the React pack (frontend `calls` backend endpoint) complement the Java pack's backend endpoint candidates -- this is the critical cross-tier mapping for migration planning

**Target codebase generality:**
- The pack must handle arbitrary React/TypeScript codebases, not just specific known patterns
- React Router v5 (`<Route component={...}>`) and v6 (`<Route element={<.../>}>`) patterns should both be detectable
- Axios instances created via `axios.create()` should be tracked for method call detection
- The `fetch()` API with no explicit method defaults to GET
- Template literal URLs may use any variable names for base URLs; all `${...}` expressions are preserved verbatim
