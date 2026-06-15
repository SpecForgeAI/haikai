# Specification: React/TypeScript Extension Pack

## Goal
Implement the third Extension Pack for arbitrary React/TypeScript codebases that runs after LLM file-level analysis and deterministically sharpens candidates using tree-sitter AST parsing of component declarations, route definitions, API call sites (fetch/axios), state management patterns (Redux/Context), and custom hooks, with cross-tier relationship evidence linking frontend consumers to backend endpoints.

## User Stories
- As an architect running discovery on a React/TypeScript codebase, I want deterministic extraction of routed components, API call sites with exact URLs/HTTP methods, and state management patterns so that the architecture model captures the frontend's structural contracts and backend dependencies with precision the LLM alone cannot provide.
- As a migration planner, I want cross-tier dependency relationships (frontend component calls backend endpoint) automatically detected so that I can sequence backend endpoint migrations without breaking unknown frontend consumers.

## Specific Requirements

**Pack identity, registration, and activation**
- Implement the `ExtensionPack` interface with `id: 'react-typescript'`, `name: 'React/TypeScript Extension Pack'`, `when: { language: 'TypeScript', technology: 'React' }`
- Auto-activates via `matchesPredicate()` when `techHints` contain a TypeScript/React entry
- Register via `registerPack()` in `discovery-service/src/services/extensionPacks/register.ts` by importing and registering `reactTypescriptPack` alongside the existing `javaSpringBootPack`
- Pack module lives at `discovery-service/src/services/extensionPacks/reactTypescript/index.ts`

**tree-sitter TypeScript/TSX AST parsing**
- Add `tree-sitter-typescript` as an npm dependency in `discovery-service/package.json` (the `tree-sitter` core is already present from the Java pack)
- Create `tsxParser.ts` following the singleton pattern from `javaParser.ts`; use `require('tree-sitter-typescript').tsx` grammar for `.tsx` files and `require('tree-sitter-typescript').typescript` grammar for `.ts` files
- Parse each file into a syntax tree; traverse nodes to extract function/arrow component declarations, JSX elements, import/export statements, call expressions (hooks, API calls, `createContext`, `createSlice`), and template literal strings
- Fall back gracefully on parse failure (log warning, skip file, continue)

**File filtering**
- Create `fileFilter.ts` that filters `ExtensionPackContext.sourceFiles` to `.ts` and `.tsx` files matching TypeScript/React `techHints`
- Exclude test files: paths containing `/__tests__/`, `__test__/`, or matching `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`
- Exclude `node_modules/` paths and declaration files (`*.d.ts`)
- Include files that may contain route definitions (e.g., `routes.ts`, `router.ts`, `App.tsx`) even if they do not match a typical component naming pattern

**Component detection as Class candidates (filtered to page-level only)**
- Detect React functional components: function declarations and arrow function expressions that return JSX
- Only page-level / routed components become Class candidates, identified by any of: (a) referenced in a `<Route>` element's `element` prop, (b) referenced in a conditional view-switching block (`condition && <Component />` or ternary), (c) default/named export from a file matching `*View.tsx`, `*Page.tsx`, `*Screen.tsx` (case-insensitive), (d) registered in object-style router config `{ path: '...', element: ComponentName }`
- Capture: component name, file path, export type (default/named), props interface/type name, which route paths render this component, detection source heuristic (`route_reference`, `view_switch_reference`, `naming_pattern`, `router_config_object`)
- Skip presentational components that match none of the page-level heuristics

**Route definition detection as Endpoint candidates (internal)**
- React Router JSX pattern: parse `<Route path="..." element={<ComponentName />} />` (v6) and `<Route path="..." component={ComponentName} />` (v5); extract path, component reference, nested routes for parent/child structure
- React Router object pattern: parse `{ path: '/...', element: ComponentName, children: [...] }`; extract path and component reference
- State-based view switching: detect `{state === 'value' && <Component />}` or ternary conditional rendering; capture condition expression as route-path equivalent; mark with `endpoint_subtype: 'view_switch'`
- Route endpoint data: route path, component reference, nested structure, route parameters (`:id`, etc.), `endpoint_subtype: 'route'` for React Router or `'view_switch'` for state-based

**External API call site detection as Endpoint candidates (external)**
- Axios detection: `axios.get(...)`, `.post(...)`, `.put(...)`, `.delete(...)`, `.patch(...)`, `.request(...)`; also custom instances (`axiosInstance.get(...)`, `apiClient.post(...)`); extract HTTP method from method name and URL from first argument
- Fetch detection: `fetch(url)` and `fetch(url, options)`; extract URL from first argument and HTTP method from `options.method` (default GET)
- Template literal URL handling: preserve `${...}` placeholder expressions verbatim, do NOT resolve variable references
- Extract TypeScript generic type arguments for request/response types where present
- Mark with `endpoint_subtype: 'api_call'`
- For EACH API call, produce an `EvidenceRelationship` with `relationshipType: 'calls'`, `confidence: 1.0`, data conforming to `CallsRelationshipData`: `callerSignature` is the frontend function/component, `calleeSignature` is the `METHOD /url/pattern`

**API wrapper function detection as Method candidates**
- Detect exported async functions whose body contains exactly one `fetch()` or `axios.*()` call
- Each becomes a Method candidate with `data.methodType: 'api_wrapper'`
- Cross-reference: the Method candidate links to the API call Endpoint candidate via `data.wrapsEndpoint`, and the Endpoint candidate references back via `data.callingFunction` and `data.wrapperFunction`

**State management extraction as Class candidates**
- Redux Toolkit: detect `createSlice({ name, initialState, reducers })` calls; extract slice name, reducer keys, initial state shape; each slice becomes a Class candidate with `data.classType: 'redux_slice'`
- React Context: detect `createContext(...)` calls and corresponding `*Provider` component functions that render `<SomethingContext.Provider>`; ALL Context providers become Class candidates with `data.classType: 'context_provider'` (no significance filtering)
- Consumer tracking: detect `useSelector`, `useDispatch` for Redux and `useContext(MyContext)` for Context; record consuming files/components as metadata on the Class candidate

**Custom hook detection as Method candidates**
- Detect exported functions named `useXxx` (starts with `use` + uppercase letter)
- Each becomes a Method candidate with `data.methodType: 'custom_hook'`; capture hook name, parameter types, return type
- Significance filter: only module-level exported functions; skip non-exported, nested, event handlers, render helpers
- Parent resolution: if hook is in the same file as a Context provider Class candidate, link via `parentCandidateId`; otherwise standalone

**Candidate sharpening mechanics**
- Duplicate `candidateMatcher.ts`, `candidateSharpener.ts`, and `parentResolver.ts` from the Java pack into `reactTypescript/` directory with React/TypeScript-specific branding
- Multi-level matching: (1) exact file path + exact name, (2) same file path + normalized name with React/TypeScript strippable suffixes (`View`, `Page`, `Screen`, `Panel`, `Modal`, `Provider`, `Context`, `Hook`, `Api`, `Service`), (3) same file path + same candidateType when only one exists
- Sharpen existing candidates: merge metadata, boost confidence to `Math.max(candidate.confidence, 0.95)`, add `data._sharpenedBy: 'react-typescript'`, `_sharpenedAt`, `_annotationSource` (annotationType holds `'Route'`, `'fetch'`, `'createContext'`, `'useXxx'`, etc.)
- New candidates: `status: 'proposed'`, `confidence: 0.95`, `data._addedBy: 'react-typescript'`, resolve `parentCandidateId`
- Parent type map for this pack: `method` -> parent `class` (hook in Context provider file), `endpoint` -> no automatic parent (standalone API call sites)

**Extension pack analysis evidence atoms**
- Produce one `extension_pack_analysis` evidence atom per TypeScript/TSX file analyzed, using `packId: 'react-typescript'`
- Finding types: `react_component`, `route_definition`, `view_switch`, `api_call_fetch`, `api_call_axios`, `redux_slice`, `context_provider`, `custom_hook`, `api_wrapper_function`

**Pack output and orchestration**
- `enrich()` returns `ExtensionPackResult` with: mutated candidates array, `extension_pack_analysis` atoms (one per file), `EvidenceRelationship` objects for cross-tier API calls using `relationshipType: 'calls'`
- Orchestration follows the Java pack's `index.ts` pattern: filter files, parse each with tree-sitter, run all extractors, apply candidate sharpening, build evidence atoms and relationships, return result
- When both packs apply (full-stack project), Java pack runs first; React pack runs second and receives already-sharpened candidates

## Visual Design
No visual mockups provided.

## Existing Code to Leverage

**`discovery-service/src/services/extensionPacks/javaSpringBoot/index.ts` -- orchestration pattern**
- Full reference for the `enrich()` method structure: filter files, per-file processing loop with parse/extract/collect-findings, candidate sharpening pass, evidence atom construction, relationship building, and `ExtensionPackResult` return
- The `processJavaFile()` helper pattern (parse + run all extractors + collect findings into `PerFileResult`) should be mirrored as `processTsFile()` with React/TypeScript-specific extractors
- `buildEvidenceAtom()` and `findPreExistingMatch()` helpers are directly replicable with `'react-typescript'` branding

**`discovery-service/src/services/extensionPacks/javaSpringBoot/javaParser.ts` -- parser singleton pattern**
- Singleton `getParser()` with `require('tree-sitter')` / `require('tree-sitter-java')` pattern to replicate for `tree-sitter-typescript`
- The React pack needs TWO grammar variants (TypeScript for `.ts`, TSX for `.tsx`) managed in the same singleton module
- `parseJavaFile()` signature and null-return-on-failure pattern to replicate as `parseTsFile()` / `parseTsxFile()`

**`discovery-service/src/services/extensionPacks/javaSpringBoot/candidateMatcher.ts` + `candidateSharpener.ts` + `parentResolver.ts` -- sharpening trio**
- Copy these three files into `reactTypescript/` with modifications: `STRIPPABLE_SUFFIXES` changed to React/TypeScript list, `'java-spring-boot'` strings changed to `'react-typescript'`, `PARENT_TYPE_MAP` changed to React/TypeScript parent hierarchy
- No shared utility extraction in this increment (future refactoring opportunity)

**`discovery-service/src/services/extensionPacks/javaSpringBoot/fileFilter.ts` -- file filtering pattern**
- Same structure to replicate: `filterTsFiles()` checking for TypeScript techHint and `.ts`/`.tsx` extensions, `isTestFile()` adapted for React test patterns (`__tests__/`, `*.test.tsx`, `*.spec.ts`, etc.), no config file filtering needed for React

**`discovery-service/src/services/extensionPacks/register.ts` -- registration file**
- Currently imports and registers only `javaSpringBootPack`; must be extended with a second import for `reactTypescriptPack` and a second `registerPack()` call

## Out of Scope
- CSS/SCSS module analysis or style extraction
- Third-party UI library component detection (Material UI, Ant Design, Chakra, etc.)
- TypeScript type/interface definitions as standalone candidates
- Test file analysis (`.test.ts`, `.test.tsx`, `.spec.ts`, `.spec.tsx`, `__tests__/` directories)
- Next.js, Remix, Gatsby, or other meta-framework-specific routing patterns
- GraphQL query/mutation/subscription detection
- Server-side rendering (SSR) or static site generation (SSG) patterns
- Webpack/Vite/esbuild configuration analysis or `package.json` dependency analysis
- Redux Toolkit Query (RTK Query) endpoint definitions
- MobX, Zustand, Jotai, Recoil, or other non-Redux/non-Context state management libraries
- Refactoring `candidateMatcher`/`candidateSharpener`/`parentResolver` into shared utilities (future increment)
