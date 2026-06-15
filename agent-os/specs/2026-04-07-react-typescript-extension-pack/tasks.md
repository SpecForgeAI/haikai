# Task Breakdown: React/TypeScript Extension Pack

## Overview
Total Tasks: 62

This spec implements the third Extension Pack for the discovery pipeline. The pack is a deterministic, tree-sitter-based TypeScript/TSX AST parser that runs after LLM file-level analysis and sharpens candidates using React component declarations, route definitions, API call sites (fetch/axios), state management patterns (Redux/Context), and custom hooks, with cross-tier relationship evidence linking frontend consumers to backend endpoints.

The pack lives entirely within the `discovery-service` (TypeScript/Node.js). No changes are needed to the `architecture-model-service` (the `extension_pack_analysis` evidence atom type already exists from Increment 2).

All file paths are relative to the repository root: `C:\Workspaces\SSD\architecture-store-and-diagrams`.

## Task List

### Foundation Layer

#### Task Group 1: Pack Skeleton, Registration, and File Filtering
**Dependencies:** None (assumes Increment 1 types and Increment 2 Java pack exist)

- [x] 1.0 Complete pack skeleton, registration, and file filtering
  - [x] 1.1 Write 6 focused tests for pack registration and file filtering
    - Test that the pack object satisfies the `ExtensionPack` interface (`id: 'react-typescript'`, `name: 'React/TypeScript Extension Pack'`, `when: { language: 'TypeScript', technology: 'React' }`, `enrich` function)
    - Test that `registerPack()` registers the react-typescript pack and `getApplicablePacks()` returns it when techHints contain `{ language: 'TypeScript', technology: 'React' }`
    - Test that `matchesPredicate()` returns false when techHints contain only Java/Spring Boot entries
    - Test that `filterTsFiles()` returns only `.ts` and `.tsx` files when techHints contain a TypeScript entry, and returns an empty map when techHints have no TypeScript entry
    - Test that `isTestFile()` correctly identifies test files: paths containing `/__tests__/`, `__test__/`, and files matching `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`
    - Test that `filterTsFiles()` excludes `node_modules/` paths and declaration files (`*.d.ts`) while including route-related files like `routes.ts`, `router.ts`, `App.tsx`
  - [x] 1.2 Create pack module directory and skeleton at `discovery-service/src/services/extensionPacks/reactTypescript/index.ts`
    - Export a `reactTypescriptPack` object implementing `ExtensionPack`
    - `id: 'react-typescript'`, `name: 'React/TypeScript Extension Pack'`
    - `description`: concise string describing the pack's purpose
    - `when: { language: 'TypeScript', technology: 'React' }`
    - `enrich()`: initially a pass-through stub returning input candidates unchanged
  - [x] 1.3 Update registration file at `discovery-service/src/services/extensionPacks/register.ts`
    - Add import for `reactTypescriptPack` from `./reactTypescript/index`
    - Add `registerPack(reactTypescriptPack)` call alongside the existing `registerPack(javaSpringBootPack)`
  - [x] 1.4 Create file filtering utility at `discovery-service/src/services/extensionPacks/reactTypescript/fileFilter.ts`
    - `filterTsFiles(sourceFiles: Map<string, string>, techHints: Record<string, { language: string; technology: string }>): Map<string, string>` -- filters to `.ts` and `.tsx` files matching TypeScript techHints
    - `isTestFile(filePath: string): boolean` -- returns true if path contains `/__tests__/`, `__test__/`, or file matches `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`
    - `isDeclarationFile(filePath: string): boolean` -- returns true for `*.d.ts` files
    - `isNodeModules(filePath: string): boolean` -- returns true if path contains `node_modules/`
    - Exclude declaration files and node_modules paths from filtering
    - Include route-related files (`routes.ts`, `router.ts`, `App.tsx`) even if they do not match a typical component naming pattern
  - [x] 1.5 Ensure Task Group 1 tests pass
    - Run ONLY the 6 tests written in 1.1
    - Verify the pack registers correctly, types compile, file filtering works, and predicate matching works

**Acceptance Criteria:**
- Pack skeleton compiles and satisfies the `ExtensionPack` interface
- `registerPack()` succeeds and `getApplicablePacks()` returns the pack for TypeScript/React techHints
- File filtering correctly includes `.ts`/`.tsx` files, excludes test files, `node_modules/`, and `*.d.ts`
- Registration file registers both Java and React packs
- All 6 tests pass

---

### AST Parsing Infrastructure

#### Task Group 2: tree-sitter TypeScript/TSX Integration and AST Utilities
**Dependencies:** Task Group 1

- [x] 2.0 Complete tree-sitter TypeScript/TSX integration and AST utilities
  - [x] 2.1 Write 8 focused tests for tree-sitter parsing and AST traversal utilities
    - Test that tree-sitter parses a simple `.tsx` file with a functional component returning JSX and produces a syntax tree with `function_declaration`, `jsx_element` nodes
    - Test that tree-sitter parses a `.ts` file (non-JSX) with an exported async function and produces `export_statement`, `function_declaration`, `call_expression` nodes
    - Test that the TSX grammar handles both JSX (`<div>`) and TypeScript syntax (`interface Props { ... }`) in the same file
    - Test that component detection extracts function name, return type (JSX), and props interface from `function MyComponent(props: MyProps): JSX.Element`
    - Test that arrow function component detection works: `const MyComponent: React.FC<Props> = (props) => { return <div /> }`
    - Test that import statement extraction returns named imports (`import { useState } from 'react'`), default imports (`import React from 'react'`), and namespace imports
    - Test that call expression extraction identifies `fetch()`, `axios.get()`, `createContext()`, `createSlice()`, `useContext()`, `useSelector()` call sites with argument positions
    - Test that parse failure on malformed TSX returns null without throwing (graceful degradation)
  - [x] 2.2 Add `tree-sitter-typescript` as an npm dependency in `discovery-service/package.json`
    - Run `npm install tree-sitter-typescript` (the `tree-sitter` core is already present from the Java pack)
    - Verify the native dependency builds or prebuild binaries install correctly
    - `tree-sitter-typescript` exposes two grammars: `require('tree-sitter-typescript').typescript` and `require('tree-sitter-typescript').tsx`
  - [x] 2.3 Create TypeScript/TSX parser module at `discovery-service/src/services/extensionPacks/reactTypescript/tsxParser.ts`
    - Follow the singleton pattern from `javaParser.ts`
    - Initialize tree-sitter with TWO grammar variants: TypeScript grammar for `.ts` files and TSX grammar for `.tsx` files
    - Export `parseTsFile(sourceCode: string): Tree | null` -- parses `.ts` files using the TypeScript grammar
    - Export `parseTsxFile(sourceCode: string): Tree | null` -- parses `.tsx` files using the TSX grammar
    - Export `parseFile(sourceCode: string, filePath: string): Tree | null` -- convenience function that selects grammar based on file extension
    - Fall back gracefully on parse failure: log warning, return null
  - [x] 2.4 Create AST traversal utilities at `discovery-service/src/services/extensionPacks/reactTypescript/astUtils.ts`
    - `extractImports(tree: Tree): ImportInfo[]` -- extracts all import statements with source module, named/default/namespace imports
    - `extractExportedFunctions(tree: Tree): FunctionInfo[]` -- finds all exported function declarations and arrow function variable declarations
    - `extractCallExpressions(node: SyntaxNode): CallExpressionInfo[]` -- finds all call expressions with callee name, arguments, and position
    - `extractJsxElements(node: SyntaxNode): JsxElementInfo[]` -- finds all JSX elements with tag name, props, and children
    - `extractObjectLiterals(node: SyntaxNode): ObjectLiteralInfo[]` -- finds object literals (for route config objects)
    - `findNodesByType(node: SyntaxNode, type: string): SyntaxNode[]` -- generic recursive node finder
    - `getNodeText(node: SyntaxNode, sourceCode: string): string` -- safe text extraction from a node
    - Define TypeScript interfaces: `ImportInfo`, `FunctionInfo`, `CallExpressionInfo`, `JsxElementInfo`, `ObjectLiteralInfo` with all relevant properties
  - [x] 2.5 Ensure Task Group 2 tests pass
    - Run ONLY the 8 tests written in 2.1
    - Verify tree-sitter parses TypeScript and TSX source correctly
    - Verify AST traversal utilities extract expected metadata

**Acceptance Criteria:**
- `tree-sitter-typescript` dependency installed and functional
- Parser correctly handles `.ts` files with TypeScript grammar and `.tsx` files with TSX grammar
- Parser fails gracefully on malformed input (returns null, logs warning)
- AST utilities correctly extract imports, exported functions, call expressions, JSX elements, and object literals
- All 8 tests pass

---

### Component and Route Extractors

#### Task Group 3: Component Detection and Route Definition Extraction
**Dependencies:** Task Group 2

- [x] 3.0 Complete component detection and route definition extraction
  - [x] 3.1 Write 8 focused tests for component and route extraction
    - Test that a `<Route path="/dashboard" element={<DashboardView />} />` JSX element produces a route endpoint candidate with `data.routePath: '/dashboard'`, `data.componentReference: 'DashboardView'`, `data.endpoint_subtype: 'route'`
    - Test that a React Router v5 pattern `<Route path="/users" component={UsersPage} />` is also detected
    - Test that nested `<Route>` elements produce parent/child route structure
    - Test that object-style router config `{ path: '/settings', element: SettingsView, children: [...] }` extracts route path and component reference
    - Test that state-based view switching `{currentView === 'dashboard' && <DashboardView />}` produces an endpoint candidate with `data.endpoint_subtype: 'view_switch'` and the condition expression as route-path equivalent
    - Test that a component referenced in a `<Route>` element is marked as page-level (detection source `route_reference`) and becomes a Class candidate with component name, file path, export type
    - Test that a default export from a file named `DashboardView.tsx` is detected as page-level via naming pattern heuristic (detection source `naming_pattern`) even without a Route reference
    - Test that a presentational component (e.g., `Button.tsx`, not referenced in any Route and not matching naming patterns) is NOT produced as a Class candidate
  - [x] 3.2 Create component detector at `discovery-service/src/services/extensionPacks/reactTypescript/extractors/componentDetector.ts`
    - Detect React functional components: function declarations and arrow function expressions that return JSX
    - Apply page-level heuristics:
      - (a) Referenced in a `<Route>` element's `element` or `component` prop
      - (b) Referenced in a conditional view-switching block
      - (c) Default/named export from file matching `*View.tsx`, `*Page.tsx`, `*Screen.tsx` (case-insensitive)
      - (d) Registered in object-style router config `{ path: '...', element: ComponentName }`
    - Capture: component name, file path, export type (default/named), props interface/type name, route paths, detection source heuristic (`route_reference`, `view_switch_reference`, `naming_pattern`, `router_config_object`)
    - Skip presentational components that match none of the page-level heuristics
    - Return `ComponentDetectionResult[]` with all captured metadata
  - [x] 3.3 Create route definition extractor at `discovery-service/src/services/extensionPacks/reactTypescript/extractors/routeExtractor.ts`
    - **React Router JSX pattern**: Parse `<Route path="..." element={<ComponentName />} />` (v6) and `<Route path="..." component={ComponentName} />` (v5)
    - **React Router object pattern**: Parse `{ path: '/...', element: ComponentName, children: [...] }`
    - **State-based view switching**: Detect `{state === 'value' && <Component />}` or ternary conditional rendering
    - Extract: route path, component reference, nested route structure, route parameters (`:id`, etc.), `endpoint_subtype` ('route' or 'view_switch')
    - Return `RouteDefinitionResult[]` with all captured metadata
  - [x] 3.4 Ensure Task Group 3 tests pass
    - Run ONLY the 8 tests written in 3.1
    - Verify component detection and route extraction produce correct candidates

**Acceptance Criteria:**
- React Router v5 and v6 JSX patterns correctly detected
- Object-style router config correctly parsed
- State-based view switching detected with condition expression captured
- Page-level heuristics correctly filter to routed/significant components only
- Presentational components excluded
- Route parameters extracted from path strings
- All 8 tests pass

---

### API Call and Method Extractors

#### Task Group 4: External API Call Site and Method Detection
**Dependencies:** Task Group 2

- [x] 4.0 Complete external API call site and method detection
  - [x] 4.1 Write 8 focused tests for API call and method extraction
    - Test that `axios.get('/api/v1/users')` produces an endpoint candidate with `data.httpMethod: 'GET'`, `data.url: '/api/v1/users'`, `data.endpoint_subtype: 'api_call'`
    - Test that `axios.post('/api/runs', payload)` extracts `httpMethod: 'POST'`
    - Test that custom axios instances (`apiClient.get('/api/projects')`, `axiosInstance.delete('/api/items/1')`) are detected
    - Test that `fetch('/api/data')` with no options produces `httpMethod: 'GET'` (default) and `fetch(url, { method: 'PUT' })` produces `httpMethod: 'PUT'`
    - Test that a template literal URL `` `${BASE_URL}/api/projects/${projectId}/summary` `` preserves `${...}` placeholders verbatim in the extracted URL
    - Test that an exported async function containing exactly one `fetch()` call produces both a Method candidate (`data.methodType: 'api_wrapper'`) and an Endpoint candidate, cross-referenced via `data.wrapsEndpoint` and `data.wrapperFunction`
    - Test that each API call produces an `EvidenceRelationship` with `relationshipType: 'calls'`, `confidence: 1.0`, `callerSignature` (frontend function), and `calleeSignature` (e.g., `GET /api/v1/users`)
    - Test that TypeScript generic type arguments on API calls (e.g., `axios.get<UserDto[]>(url)`) capture the response type
  - [x] 4.2 Create API call site extractor at `discovery-service/src/services/extensionPacks/reactTypescript/extractors/apiCallExtractor.ts`
    - **Axios detection**: `axios.get(...)`, `.post(...)`, `.put(...)`, `.delete(...)`, `.patch(...)`, `.request(...)`; also custom instances via `axiosInstance.get(...)`, `apiClient.post(...)`
    - **Fetch detection**: `fetch(url)` and `fetch(url, options)`; extract URL from first argument, HTTP method from `options.method` (default GET)
    - **Template literal URL handling**: preserve `${...}` placeholder expressions verbatim
    - Extract TypeScript generic type arguments for request/response types where present
    - Mark with `endpoint_subtype: 'api_call'`
    - Return `ApiCallResult[]` with: HTTP method, URL, file path, calling function name, request body type, response type, line number
    - For EACH API call, produce a `CrossTierRelationship` object: `callerSignature` (frontend function/component), `calleeSignature` (`METHOD /url/pattern`)
  - [x] 4.3 Create API wrapper function detector at `discovery-service/src/services/extensionPacks/reactTypescript/extractors/apiWrapperDetector.ts`
    - Detect exported async functions whose body contains exactly one `fetch()` or `axios.*()` call
    - Each becomes a Method candidate with `data.methodType: 'api_wrapper'`
    - Cross-reference: Method candidate's `data.wrapsEndpoint` links to the API call Endpoint, and the Endpoint candidate references back via `data.callingFunction` and `data.wrapperFunction`
    - Return `ApiWrapperResult[]` with: function name, parameter types, return type, wrapped endpoint reference
  - [x] 4.4 Create custom hook detector at `discovery-service/src/services/extensionPacks/reactTypescript/extractors/hookDetector.ts`
    - Detect exported functions named `useXxx` (starts with `use` + uppercase letter)
    - Each becomes a Method candidate with `data.methodType: 'custom_hook'`
    - Capture: hook name, parameter types, return type
    - Significance filter: only module-level exported functions; skip non-exported, nested, event handlers, render helpers
    - Parent resolution: if hook is in the same file as a Context provider Class candidate, link via `parentCandidateId`; otherwise standalone
    - Return `HookDetectionResult[]` with all captured metadata
  - [x] 4.5 Ensure Task Group 4 tests pass
    - Run ONLY the 8 tests written in 4.1
    - Verify API call extraction, wrapper detection, and hook detection produce correct candidates and relationships

**Acceptance Criteria:**
- `fetch()` and `axios.*()` calls correctly detected with HTTP method and URL extraction
- Custom axios instances detected
- Template literal URLs preserve `${...}` placeholders
- API wrapper functions produce Method candidates cross-referenced with Endpoint candidates
- Custom hooks produce Method candidates with correct metadata
- Cross-tier `calls` relationships produced for every API call
- TypeScript generic types captured where present
- All 8 tests pass

---

### State Management Extractors

#### Task Group 5: Redux and React Context State Management Extraction
**Dependencies:** Task Group 2

- [x] 5.0 Complete Redux and React Context state management extraction
  - [x] 5.1 Write 6 focused tests for state management extraction
    - Test that `createSlice({ name: 'auth', initialState: { user: null }, reducers: { login: ..., logout: ... } })` produces a Class candidate with `data.classType: 'redux_slice'`, slice name `auth`, and reducer keys `['login', 'logout']`
    - Test that `const MyContext = createContext(defaultValue)` followed by a `MyContextProvider` function component rendering `<MyContext.Provider>` produces a Class candidate with `data.classType: 'context_provider'`, context name `MyContext`, provider name `MyContextProvider`
    - Test that `useSelector(state => state.auth.user)` in a component file records the consuming component as a consumer of the `auth` Redux slice
    - Test that `useContext(MyContext)` in a component file records the consuming component as a consumer of `MyContext`
    - Test that ALL Context providers become Class candidates (no significance filtering)
    - Test that `useDispatch()` usage is detected and the file is recorded as consuming Redux dispatch
  - [x] 5.2 Create Redux slice extractor at `discovery-service/src/services/extensionPacks/reactTypescript/extractors/reduxExtractor.ts`
    - Detect `createSlice({ name, initialState, reducers })` call expressions
    - Extract slice name from the `name` property
    - Extract reducer function names from the `reducers` object keys
    - Extract initial state shape (type or object literal)
    - Each slice becomes a Class candidate with `data.classType: 'redux_slice'`
    - Return `ReduxSliceResult[]` with all captured metadata
  - [x] 5.3 Create React Context extractor at `discovery-service/src/services/extensionPacks/reactTypescript/extractors/contextExtractor.ts`
    - Detect `createContext(...)` call expressions; extract the variable name assigned to the context
    - Detect corresponding Provider components (files exporting a `*Provider` function that renders `<SomethingContext.Provider>`)
    - ALL Context providers become Class candidates with `data.classType: 'context_provider'`
    - Capture: context name, default value type (if typed), provider component name
    - Return `ContextProviderResult[]` with all captured metadata
  - [x] 5.4 Create consumer tracker at `discovery-service/src/services/extensionPacks/reactTypescript/extractors/consumerTracker.ts`
    - Detect `useSelector(...)`, `useDispatch()` for Redux consumers
    - Detect `useContext(MyContext)` for Context consumers
    - Record which files/components consume each state container
    - Return `ConsumerTrackingResult` mapping state container name -> consuming file paths/component names
  - [x] 5.5 Ensure Task Group 5 tests pass
    - Run ONLY the 6 tests written in 5.1
    - Verify Redux slice extraction, Context provider detection, and consumer tracking all work correctly

**Acceptance Criteria:**
- `createSlice` calls produce `redux_slice` Class candidates with slice name, reducers, initial state
- `createContext` + Provider pattern produces `context_provider` Class candidates
- ALL Context providers captured (no filtering)
- `useSelector`, `useDispatch`, `useContext` usage tracked per file/component
- Consumer metadata attached to the corresponding state container Class candidate
- All 6 tests pass

---

### Candidate Sharpening Engine

#### Task Group 6: Candidate Matching, Sharpening, and Parent Resolution
**Dependencies:** Task Groups 3, 4, 5 (needs all extractors to produce findings)

- [x] 6.0 Complete candidate matching, sharpening, and parent resolution
  - [x] 6.1 Write 8 focused tests for candidate matching and sharpening
    - Test exact match: LLM candidate named "DashboardView" at file path `src/components/DashboardView/DashboardView.tsx` is matched by the pack's finding for the same file and name
    - Test normalized match: LLM candidate named "Dashboard" is matched to the pack's finding "DashboardView" after stripping the `View` suffix (case-insensitive)
    - Test normalized match with other React suffixes: stripping `Page`, `Screen`, `Panel`, `Modal`, `Provider`, `Context`, `Hook`, `Api`, `Service`
    - Test type-aware match: when only one `class` candidate exists for a file, it matches the pack's `class` finding for the same file
    - Test that sharpening in-place adds deterministic metadata (e.g., `data.routePaths`, `data.propsInterface`) without removing existing LLM-provided data keys, boosts confidence to `Math.max(original, 0.95)`, and adds `data._sharpenedBy: 'react-typescript'`, `data._sharpenedAt`, `data._annotationSource`
    - Test that a new candidate (LLM missed the component) is created with `status: 'proposed'`, `confidence: 0.95`, `data._addedBy: 'react-typescript'`, and correct `parentCandidateId`
    - Test parent resolution: a custom hook Method candidate in the same file as a Context provider Class candidate resolves `parentCandidateId` to the Context provider's ID
    - Test parent resolution: an API wrapper Method or standalone endpoint candidate has no automatic parent (returns undefined)
  - [x] 6.2 Create candidate matcher at `discovery-service/src/services/extensionPacks/reactTypescript/candidateMatcher.ts`
    - Duplicate from `javaSpringBoot/candidateMatcher.ts`
    - Change `STRIPPABLE_SUFFIXES` to React/TypeScript-specific list: `['View', 'Page', 'Screen', 'Panel', 'Modal', 'Provider', 'Context', 'Hook', 'Api', 'Service']`
    - Same multi-level matching logic: (1) exact file path + exact name, (2) same file path + normalized name, (3) same file path + same candidateType when only one exists
    - Export `normalizeName(name: string): string` and `findMatchingCandidate(candidates, filePath, findingName, findingType): DiscoveryCandidate | null`
  - [x] 6.3 Create candidate sharpener at `discovery-service/src/services/extensionPacks/reactTypescript/candidateSharpener.ts`
    - Duplicate from `javaSpringBoot/candidateSharpener.ts`
    - Change all `'java-spring-boot'` strings to `'react-typescript'`
    - `sharpenCandidate()`: merge metadata, boost confidence, add `_sharpenedBy: 'react-typescript'`, `_sharpenedAt`, `_annotationSource` (annotationType holds values like `'Route'`, `'fetch'`, `'createContext'`, `'useXxx'`, etc.)
    - `createNewCandidate()`: `status: 'proposed'`, `confidence: 0.95`, `data._addedBy: 'react-typescript'`
    - `addContradiction()`: adds `data._contradiction` without changing candidateType
  - [x] 6.4 Create parent resolver at `discovery-service/src/services/extensionPacks/reactTypescript/parentResolver.ts`
    - Duplicate from `javaSpringBoot/parentResolver.ts`
    - Change `PARENT_TYPE_MAP` to React/TypeScript hierarchy: `{ method: 'class' }`
    - `method` -> parent `class` (hook in Context provider file)
    - `endpoint` -> no automatic parent (standalone API call sites), so `endpoint` is NOT in the map
  - [x] 6.5 Ensure Task Group 6 tests pass
    - Run ONLY the 8 tests written in 6.1
    - Verify matching, sharpening, new candidate creation, parent resolution, and contradiction handling all work correctly

**Acceptance Criteria:**
- Multi-level matching correctly identifies the best match with React/TypeScript-specific suffix stripping
- In-place sharpening merges metadata, boosts confidence, and adds `react-typescript` traceability markers
- New candidates created with correct status, confidence, and `_addedBy: 'react-typescript'` marker
- Parent resolution links custom hooks to Context providers in the same file
- Endpoints and standalone API wrappers have no automatic parent
- All 8 tests pass

---

### Orchestration Layer

#### Task Group 7: Pack Orchestration (enrich method)
**Dependencies:** Task Groups 3, 4, 5, 6

- [x] 7.0 Complete pack orchestration
  - [x] 7.1 Write 6 focused tests for the end-to-end enrich method
    - Test that `enrich()` with an empty `sourceFiles` map returns candidates unchanged (no-op)
    - Test that `enrich()` with a single `.tsx` file containing a `<Route path="/dashboard" element={<DashboardView />} />` sharpens the matching LLM candidate and produces an `extension_pack_analysis` evidence atom with `packId: 'react-typescript'`
    - Test that `enrich()` with a file containing `fetch('/api/users')` produces a cross-tier `calls` relationship with correct `callerSignature` and `calleeSignature`
    - Test that `enrich()` adds new candidates when the LLM missed components, and the new candidates have `data._addedBy: 'react-typescript'`
    - Test that `enrich()` returns the correct `ExtensionPackResult` shape: candidates array (mutated originals + new), atoms array (one per `.ts`/`.tsx` file), relationships array (cross-tier API calls)
    - Test that if tree-sitter fails on one file, the pack logs a warning and continues processing remaining files (graceful degradation)
  - [x] 7.2 Define the per-file extraction result interface in `discovery-service/src/services/extensionPacks/reactTypescript/index.ts`
    - `PerFileResult` containing: `filePath`, `components: ComponentDetectionResult[]`, `routes: RouteDefinitionResult[]`, `apiCalls: ApiCallResult[]`, `apiWrappers: ApiWrapperResult[]`, `hooks: HookDetectionResult[]`, `reduxSlices: ReduxSliceResult[]`, `contextProviders: ContextProviderResult[]`, `consumerTracking: ConsumerTrackingResult`, `findings: ExtensionPackFinding[]`
  - [x] 7.3 Implement the `processTsFile()` helper in `discovery-service/src/services/extensionPacks/reactTypescript/index.ts`
    - Follow the `processJavaFile()` pattern from the Java pack
    - Parse file with tree-sitter (select grammar based on `.ts` vs `.tsx` extension)
    - Run all extractors: componentDetector, routeExtractor, apiCallExtractor, apiWrapperDetector, hookDetector, reduxExtractor, contextExtractor, consumerTracker
    - Collect all findings per file into `ExtensionPackFinding[]`
    - Finding types: `react_component`, `route_definition`, `view_switch`, `api_call_fetch`, `api_call_axios`, `redux_slice`, `context_provider`, `custom_hook`, `api_wrapper_function`
    - Return `PerFileResult | null` (null on parse failure)
  - [x] 7.4 Implement the `buildEvidenceAtom()` helper
    - Follow the Java pack's pattern with `packId: 'react-typescript'` and `id: 'epk-rts-${uuidv4()}'`
  - [x] 7.5 Implement the `applyCandidateSharpening()` function
    - Match pack findings to existing LLM candidates using `findPreExistingMatch()` pattern
    - For components: sharpen or create `class` candidates
    - For routes: sharpen or create `endpoint` candidates with `data.endpoint_subtype: 'route'` or `'view_switch'`
    - For API calls: sharpen or create `endpoint` candidates with `data.endpoint_subtype: 'api_call'`
    - For API wrappers: sharpen or create `method` candidates with `data.methodType: 'api_wrapper'`
    - For custom hooks: sharpen or create `method` candidates with `data.methodType: 'custom_hook'`
    - For Redux slices: sharpen or create `class` candidates with `data.classType: 'redux_slice'`
    - For Context providers: sharpen or create `class` candidates with `data.classType: 'context_provider'`
    - Attach consumer tracking metadata to state container Class candidates
    - Use `packCreatedIds` set to prevent matching against pack-created candidates
  - [x] 7.6 Implement the full `enrich()` method
    - Step 1: Filter source files to `.ts`/`.tsx` files matching techHints (via `fileFilter.ts`)
    - Step 2: For each TypeScript/TSX file (excluding test files, node_modules, `.d.ts`):
      - Parse with tree-sitter (`tsxParser.ts`)
      - Run all extractors via `processTsFile()`
      - Collect findings
    - Step 3: Apply candidate sharpening (match + sharpen or create new)
    - Step 4: Build `extension_pack_analysis` evidence atoms (one per file analyzed)
    - Step 5: Build cross-tier `EvidenceRelationship` objects for API calls
    - Step 6: Log pack-level summary (files processed, candidates sharpened, new candidates, relationships)
    - Step 7: Return `ExtensionPackResult` with candidates, atoms, relationships
  - [x] 7.7 Wire error handling for graceful degradation
    - Wrap each file's processing in a try-catch
    - Log warning on per-file failure and continue with remaining files
    - Log pack-level summary on completion
  - [x] 7.8 Ensure Task Group 7 tests pass
    - Run ONLY the 6 tests written in 7.1
    - Verify end-to-end pack behavior

**Acceptance Criteria:**
- `enrich()` correctly orchestrates all extractors and returns the full `ExtensionPackResult`
- Candidates are sharpened in-place where matches exist, new candidates added where LLM missed
- One `extension_pack_analysis` evidence atom produced per analyzed `.ts`/`.tsx` file
- Cross-tier API call relationships produce `EvidenceRelationship` objects with `relationshipType: 'calls'`
- Consumer tracking metadata attached to Redux slice and Context provider candidates
- Graceful degradation: per-file failures do not abort the entire pack
- All 6 tests pass

---

### Test Gap Analysis

#### Task Group 8: Test Review and Gap Fill
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 6 tests from Task Group 1 (registration and file filtering)
    - Review the 8 tests from Task Group 2 (tree-sitter and AST utilities)
    - Review the 8 tests from Task Group 3 (component and route extraction)
    - Review the 8 tests from Task Group 4 (API call and method extraction)
    - Review the 6 tests from Task Group 5 (state management extraction)
    - Review the 8 tests from Task Group 6 (candidate matching/sharpening)
    - Review the 6 tests from Task Group 7 (orchestration)
    - Total existing tests: approximately 50 tests
  - [x] 8.2 Analyze test coverage gaps for this feature only
    - Identify critical integration points that lack test coverage
    - Focus on end-to-end workflows: LLM candidates -> React pack sharpening -> output verification
    - Check for gaps in multi-extractor interaction (e.g., route extraction feeding component detection, API call extraction feeding wrapper detection)
    - Check for gaps in edge cases that could cause runtime failures (e.g., files with no JSX, files with only type exports, deeply nested route configs)
  - [x] 8.3 Write up to 10 additional strategic tests to fill gaps
    - Integration test: full `enrich()` call with a realistic multi-file React codebase (routed component + API client + Redux slice + Context provider) verifying the complete candidate set
    - Integration test: `enrich()` with both LLM candidates and pack findings, verifying that sharpening and new candidate creation interact correctly
    - Edge case: `.ts` file with no JSX and no exports produces no candidates and no errors
    - Edge case: file with only `import` and `export type` statements (no runtime code) is handled gracefully
    - Cross-tier test: API call in a component file produces a `calls` relationship linking to the correct backend endpoint signature
    - Cross-tier test: API wrapper function produces both a Method candidate and an Endpoint candidate, correctly cross-referenced
    - Test that when both Java and React packs apply (full-stack project), the React pack receives already-sharpened candidates from the Java pack and does not interfere with Java-pack-created candidates
    - Verify `extension_pack_analysis` atoms have correct `packId: 'react-typescript'`, `filePath`, and `findings` structure
    - Verify consumer tracking metadata is correctly attached to Redux slice and Context provider Class candidates
    - Verify the pack runs as no-op when techHints do not include TypeScript/React
  - [x] 8.4 Run all feature-specific tests
    - Run ALL tests related to this spec (Task Groups 1-7 tests plus gap-fill tests)
    - Expected total: approximately 60 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All approximately 60 feature-specific tests pass
- Critical integration workflows for this feature are covered
- No more than 10 additional tests added
- Testing focused exclusively on the React/TypeScript Extension Pack feature

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Pack Skeleton, Registration, and File Filtering** -- establishes the pack identity, registration, and file filtering. No dependencies.
2. **Task Group 2: tree-sitter TypeScript/TSX Integration and AST Utilities** -- creates the parsing infrastructure all extractors depend on.
3. **Task Groups 3, 4, 5 (parallel)** -- the three extractor groups are independent of each other and depend only on Task Group 2. They can be developed in parallel:
   - Task Group 3: Component Detection and Route Definition Extraction
   - Task Group 4: External API Call Site and Method Detection
   - Task Group 5: Redux and React Context State Management Extraction
4. **Task Group 6: Candidate Matching, Sharpening, and Parent Resolution** -- depends on Task Groups 3, 4, 5 (needs extractor output to sharpen against).
5. **Task Group 7: Pack Orchestration** -- depends on all extractor and sharpening groups (3-6). Wires everything together in the `enrich()` method.
6. **Task Group 8: Test Review and Gap Fill** -- depends on all previous groups. Reviews and fills critical test gaps.

```
Group 1 (Foundation / Registration / File Filtering)
    |
Group 2 (tree-sitter TypeScript/TSX + AST Utilities)
    |
    +--- Group 3 (Components + Routes) --------+
    |                                           |
    +--- Group 4 (API Calls + Methods/Hooks) --+--- Group 6 (Sharpening)
    |                                           |         |
    +--- Group 5 (Redux + Context) ------------+         |
                                                          |
                                                  Group 7 (Orchestration)
                                                          |
                                                  Group 8 (Test Gaps)
```

## File Structure Summary

All new files created by this spec:

```
discovery-service/src/services/extensionPacks/
  reactTypescript/
    index.ts                              (Task 1.2, 7.2-7.7)
    tsxParser.ts                          (Task 2.3)
    astUtils.ts                           (Task 2.4)
    fileFilter.ts                         (Task 1.4)
    candidateMatcher.ts                   (Task 6.2)
    candidateSharpener.ts                 (Task 6.3)
    parentResolver.ts                     (Task 6.4)
    extractors/
      componentDetector.ts                (Task 3.2)
      routeExtractor.ts                   (Task 3.3)
      apiCallExtractor.ts                 (Task 4.2)
      apiWrapperDetector.ts               (Task 4.3)
      hookDetector.ts                     (Task 4.4)
      reduxExtractor.ts                   (Task 5.2)
      contextExtractor.ts                 (Task 5.3)
      consumerTracker.ts                  (Task 5.4)
```

Modified files:

```
discovery-service/src/services/extensionPacks/register.ts   (Task 1.3)
discovery-service/package.json                              (Task 2.2)
```
