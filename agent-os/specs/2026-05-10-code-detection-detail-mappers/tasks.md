# Task Breakdown: Code Detection Detail Mappers

## Overview
Total Tasks: 3 task groups

This is a small frontend-only spec. Work is organised so that the pure mapper module ships first (with its own dedicated unit tests), then the panel is rewired to consume it, then Spec 1's component test file is rewritten with per-type shaped assertions.

## Task List

### Frontend Pure Module

#### Task Group 1: Mapper Module + Adapter Helper + Pure Unit Tests
**Dependencies:** None

- [x] 1.0 Build the `codeDetectionMappers.ts` module and its dedicated pure unit test file
  - [x] 1.1 Write 8-12 focused tests in `frontend/src/components/DashboardView/__tests__/codeDetectionMappers.test.ts`
    - Pure unit tests over the mapper module — NO React, NO rendering, NO mocks (the module has no React, CSS, or API imports, so no `vi.mock()` is required)
    - `buildEndpointCodeDetails` server-shape Spring Boot happy path: expected reason string + ordered field labels (`HTTP method`, `Path`, `Controller`, `Handler method`, `Response type`, ...)
    - `buildEndpointCodeDetails` client-shape React/axios happy path: switches reason text and emits `URL` / `Calling function` / `API library` / `Response type`
    - `buildEndpointCodeDetails` with absent optional fields (no `requestBodyType`, no `pathVariables`, no `security`) drops them silently
    - `buildInterfaceCodeDetails` with `data.interfaceSubtype === 'spring-bean-definition'` selects the bean reason and emits `Bean name` / `Bean return type` / `Configuration class`
    - `buildInterfaceCodeDetails` with a standard Spring controller shape selects the controller reason and emits `Class` / `Interface type` / `Base path` / `Package`
    - `buildLogicalDataEntityCodeDetails` on a spring-* candidate emits only `Type` + `Package` (no `isMostlyEmpty: true`, since two fields are populated)
    - `buildLogicalDataEntityCodeDetails` on a reactAxios candidate with `isInterface: true` and `extends: 'BaseDto'` emits the TS-flavoured reason plus `Kind` + `Extends`
    - `buildInterfaceLogicalEntityCodeDetails` emits `Interface` + `Logical data entity` and the always-fallback reason string
    - `formatAdapterDisplayName` parameterised test covering all 18 known adapter values map to their explicit display names
    - `formatAdapterDisplayName` unknown-value fallback (e.g. `some-new-adapter` -> `Some New Adapter`) and the kebab-to-Title-case derivation
    - `formatAdapterDisplayName` returns `"deterministic code analysis"` for `null`, `undefined`, and empty-string input
    - Source-file truncation: 7 paths plus a duplicate produce 5 unique paths followed by `…and 3 more`
  - [x] 1.2 Create `frontend/src/components/DashboardView/codeDetectionMappers.ts`
    - Pure module: NO React imports, NO CSS imports, NO API calls, NO logging side-effects
    - Export the display-model interfaces:
      - `CodeDetectionField { label: string; value: string | string[] }`
      - `CodeDetectionDisplay { detectedBy: string; reason: string; sourceFiles: string[]; fields: CodeDetectionField[]; isMostlyEmpty: boolean }`
    - Import `DiscoveryCandidateDto` from `frontend/src/api/discoveryApi.ts` (no DTO changes)
  - [x] 1.3 Implement `formatAdapterDisplayName(value: string | null | undefined): string`
    - Backed by an explicit map covering all 18 `_addedBy` values from shaping notes section 2.1
    - Map keys: `spring-boot-adapter`, `spring-classic-adapter`, `angular-adapter`, `angularjs-classic-adapter`, `react-axios-adapter`, `aspnetcore-adapter`, `aspnet-framework-adapter`, `django-adapter`, `flask-adapter`, `jquery-adapter`, `kratos-adapter`, `magento-adapter`, `nestjs-adapter`, `oatpp-adapter`, `rails-adapter`, `symfony-adapter`, `wordpress-adapter`, `wxwidgets-adapter`
    - Unknown-value fallback: strip trailing `-adapter`, split on `-`, title-case each segment, join with spaces, append `Adapter`
    - Null / undefined / empty-string input returns `"deterministic code analysis"` (preserves Spec 1 behaviour for adapter-less candidates)
  - [x] 1.4 Implement safe formatting helpers for arrays-of-objects
    - `formatPathVariables(items)` -> entries like `ownerId: int`
    - `formatRequestParams(items)` -> entries like `petId: int (required, default=1)`
    - `formatOpenApiResponses(items)` -> entries like `200: OK`
    - All helpers tolerate missing optional sub-fields and skip entries that have no usable identity
    - Source-files helper: dedup, cap at first 5, append `…and N more` as a 6th list element when the original exceeded 5
    - Field-pushing helper that drops `undefined`, `null`, empty-string, and empty-array values silently (never emits an empty label)
  - [x] 1.5 Implement `buildEndpointCodeDetails(candidate)`
    - Use camelCase field names from `candidate.data` (production shape — NOT the snake_case fixture shape Spec 1's old tests used)
    - Server-shape detection: presence of `controllerClassName`
    - Client-shape detection: presence of `url` or `canonicalUrl` and `apiLibrary`
    - Reason strings per spec section "Endpoint mapper":
      - server: `"Detected as a controller method exposed through framework route annotations."`
      - client: `"Detected as an HTTP call from frontend code making framework HTTP-client calls."`
      - fallback: `"Detected as an HTTP endpoint from framework route metadata in code."`
    - Server fields in order: `HTTP method`, `Path`, `Controller`, `Handler method`, `Request body type`, `Response type` (prefer `responseType`, then `unwrappedReturnType`, then `returnType`), `Path variables`, `Request parameters`, `Security` (`security.annotation`), `OpenAPI operation` (`openApiOperation.operationId` or `openApiOperation.summary`), `Transactional` (`transactional.propagation` or boolean from `transactional.declared`)
    - Client fields in order: `HTTP method`, `URL` (`canonicalUrl` if present, otherwise `url`), `Calling function`, `API library`, `Response type`
  - [x] 1.6 Implement `buildInterfaceCodeDetails(candidate)` with bean-definition discriminator
    - Discriminator: `candidate.data?.interfaceSubtype === 'spring-bean-definition'`
    - Bean shape reason: `"Detected as a Spring bean definition from a @Configuration class."`
    - Bean fields in order: `Bean name`, `Bean return type`, `Configuration class`, `Package`, `Scope`, `Primary` (only when `isPrimary === true`), `Lazy` (only when `isLazy === true`)
    - Controller shape reason: `"Detected as an interface/API surface from framework controller metadata."`
    - Controller fields in order: `Class`, `Interface type` (prefer `controllerType`, then `interfaceSubtype`), `Base path`, `Package`, `Resource` (Rails), `OpenAPI tag` (`openApiTag.name`), `Security` (`security.annotation`)
  - [x] 1.7 Implement `buildLogicalDataEntityCodeDetails(candidate)`
    - Reason: TS-flavoured `"Detected as a logical data shape from TypeScript or JavaScript model/type metadata."` when `data.isInterface` is set; otherwise `"Detected as a logical data shape referenced by interface or endpoint code."`
    - Fields in order: `Type` (`className`), `Package` (`packageName`), `Kind` (`'interface'` only when `isInterface === true`), `Extends` (only when `extends` non-null/non-empty)
    - Spring-* candidates intentionally produce only `Type` + `Package` + source file — that is the expected output today and is NOT a regression
  - [x] 1.8 Implement `buildInterfaceLogicalEntityCodeDetails(candidate)`
    - Reason: always `"Detected because interface code references this logical data entity."` (directional role wording is omitted because adapters do not emit role today)
    - Fields in order: `Interface` (`interfaceClassName`), `Logical data entity` (`logicalEntityName`)
  - [x] 1.9 Implement `buildCodeDetectionDetails(candidate)` dispatcher
    - Switch on `candidate.candidate_type`: `'endpoints'`, `'interfaces'`, `'logical_data_entities'`, `'interface_logical_entities'`
    - Default branch returns a defensive generic display: `reason: 'Detected from deterministic code analysis.'`, no fields, `isMostlyEmpty: true` (unsupported types are gated upstream by `supportsDetails()` so this is defensive only)
    - Compute `detectedBy` via `formatAdapterDisplayName(candidate.data?._addedBy)`
    - Compute `sourceFiles` from `candidate.source_cluster_ids` via the dedup/cap helper
    - Set `isMostlyEmpty: true` when the type is supported but `fields.length === 0`
  - [x] 1.10 Ensure mapper module tests pass
    - Run ONLY the 8-12 tests written in 1.1
    - Command: `cd frontend && npx vitest run src/components/DashboardView/__tests__/codeDetectionMappers.test.ts`
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 8-12 tests written in 1.1 pass
- `codeDetectionMappers.ts` is pure (no React, no CSS, no API, no side-effects)
- All 18 known adapter `_addedBy` values map to readable display names; unknown values use the kebab-to-Title-case fallback
- All four per-type builders use camelCase `candidate.data` field names exactly as adapters emit them today
- The bean-definition discriminator (`interfaceSubtype === 'spring-bean-definition'`) selects the dedicated bean layout
- Source files are deduped, capped at 5, and produce the `…and N more` suffix when overflowing
- Missing optional fields are dropped silently; no field is emitted with an empty label

### Frontend Component

#### Task Group 2: Wire CodeDetectionPanel to the New Mappers
**Dependencies:** Task Group 1

- [x] 2.0 Replace the body of `CodeDetectionPanel.tsx` with a thin renderer over the display model
  - [x] 2.1 Read `frontend/src/components/DashboardView/CodeDetectionPanel.tsx` (Spec 1 version) before editing to confirm the current internals being replaced
  - [x] 2.2 Remove the Spec 1 generic body
    - Drop helpers: `getAddedBy`, `truncate`, `isScalar`, `formatScalar`
    - Drop constants: `MAX_SCALAR_FIELDS`, `MAX_STRING_LEN`
    - Drop the inline scalar iteration loop
    - The `_addedBy` reading logic is now owned by `formatAdapterDisplayName` inside the mapper module
  - [x] 2.3 Wire the component to the mapper layer
    - Keep the component name and prop interface unchanged (still receives `candidate: DiscoveryCandidateDto`)
    - Call `buildCodeDetectionDetails(candidate)` and render the returned `CodeDetectionDisplay`
    - Keep the `data-testid="code-detection-panel"` wrapper and the `styles.detailsColumnBody` class for layout continuity
    - Keep using `DiscoveryRunDetailView.module.css` — NO new CSS classes
  - [x] 2.4 Render the display-model sections in this order
    - `Detected by:` line with `data-testid="code-detection-detected-by"`
    - `Source files:` block with `data-testid="code-detection-source-files"` (renamed from Spec 1's `code-detection-source`); render as a vertical list, one path per line; the `…and N more` line is just another list entry
    - `Reason:` line with `data-testid="code-detection-reason"`
    - Per-field rows: `data-testid="code-detection-field-{slug}"` where `{slug}` is the lowercase, kebab-cased label (e.g. `code-detection-field-http-method`, `code-detection-field-controller`, `code-detection-field-base-path`, `code-detection-field-bean-name`)
    - When `display.isMostlyEmpty` is true, render an additional line with `data-testid="code-detection-empty"` containing exactly `Type-specific details: not available.`
    - For `CodeDetectionField` values that are `string[]`, render one item per line under the field's label
  - [x] 2.5 Confirm no other component or CSS file is touched
    - `CandidateDetailsPanel.tsx` stays exactly as-is (orchestrator still owns the "Code Detection" column heading)
    - `candidateDetailsSupport.ts` stays exactly as-is (allowlist unchanged)
    - `DiscoveryRunDetailView.module.css` stays exactly as-is (no new classes)
    - `DiscoveryCandidateTable.tsx` stays exactly as-is

**Acceptance Criteria:**
- `CodeDetectionPanel.tsx` is a thin presentational component that calls `buildCodeDetectionDetails(candidate)` and walks the returned display model
- All preserved testids (`code-detection-panel`, `code-detection-detected-by`, `code-detection-reason`) still resolve
- Renamed testid `code-detection-source-files` is in place; old `code-detection-source` is removed
- Per-field testid pattern `code-detection-field-{slug}` works for all curated labels
- Empty-section state renders the `code-detection-empty` line with the exact "Type-specific details: not available." string
- No edits to `CandidateDetailsPanel.tsx`, `candidateDetailsSupport.ts`, `DiscoveryRunDetailView.module.css`, or `DiscoveryCandidateTable.tsx`

### Frontend Component Tests + Non-Regression

#### Task Group 3: Rewrite candidateDetailsPanel.test.tsx + Verify Spec 1 Integration Tests
**Dependencies:** Task Group 2

- [x] 3.0 Rewrite the Spec 1 component test file in place and verify the Spec 1 integration backstop still passes
  - [x] 3.1 Read `frontend/src/components/DashboardView/__tests__/candidateDetailsPanel.test.tsx` to inventory existing describe blocks and the Proxy CSS module pattern Spec 1 established
  - [x] 3.2 Preserve the `CandidateDetailsPanel` orchestrator describe block exactly as-is
    - Column heading assertions: `Code Detection`, `Log Scans`, `LLM Review`
    - Log Scans placeholder string: `Log scan evidence is not available for this run.`
    - LLM Review placeholder string: `No candidate-specific LLM review details are available yet.`
    - These do not change in Spec 2; the assertions stay
  - [x] 3.3 Replace the `CodeDetectionPanel` describe block with per-type shaped assertions (target 6-8 tests)
    - Reuse the Spec 1 Proxy CSS module pattern for `DiscoveryRunDetailView.module.css`
    - Mock `ArchitectureContext` only if the file imports from it (the panel itself does not — keep mocks minimal)
    - Tests to include:
      - endpoints (server-shape Spring Boot fixture): asserts `HTTP method`, `Path`, `Controller`, `Handler method` curated labels appear; asserts the controller reason string appears
      - endpoints (client-shape React/axios fixture): asserts `URL`, `Calling function`, `API library` curated labels appear; asserts the client reason string appears
      - interfaces (standard Spring controller fixture): asserts `Class`, `Interface type`, `Base path`, `Package` appear and the controller reason string is used
      - interfaces (Spring bean-definition fixture): asserts `Bean name`, `Bean return type`, `Configuration class` appear and the bean reason string is used; asserts `Base path` does NOT appear
      - logical_data_entities (spring-boot fixture, sparse output): asserts `Type` + `Package` are the only curated fields; asserts `isMostlyEmpty` line is NOT present (two fields populated)
      - interface_logical_entities (spring-boot fixture, sparse output): asserts `Interface` + `Logical data entity` appear and the fallback reason string is used
      - `isMostlyEmpty` branch: candidate with allowlisted type but empty `data` renders `Type-specific details: not available.` under `data-testid="code-detection-empty"`
      - `code-detection-source-files` rename: source paths render as a vertical list under the new testid
    - Each fixture uses camelCase field names from the production `candidate.data` shape (NOT the snake_case shape Spec 1's old fixture used)
    - Each test also asserts the brief's aspirational labels (e.g. `Kind: class` for spring-* logical entities, `Relationship role:` for interface_logical_entities) do NOT appear
  - [x] 3.4 Run the rewritten component test file and confirm it passes
    - Command: `cd frontend && npx vitest run src/components/DashboardView/__tests__/candidateDetailsPanel.test.tsx`
    - Do NOT run the entire test suite at this stage
  - [x] 3.5 Non-regression check: run Spec 1's table-integration tests unchanged
    - Command: `cd frontend && npx vitest run src/components/DashboardView/__tests__/candidateDetailsExpansion.test.tsx`
    - File must continue to pass with NO edits — this is the explicit backstop that the renderer's structural contract (testid wrapper, column slot, three-column grid) is preserved
    - If any failure occurs here, treat it as a defect in Task Group 2's wiring, not as a test to update
  - [x] 3.6 Non-regression check: run any other tests that import `DiscoveryCandidateTable` or `DiscoveryRunDetailView`
    - At minimum: `cd frontend && npx vitest run src/components/DashboardView/__tests__/candidateReviewWorkflow.test.tsx`
    - These must continue to pass unchanged
  - [x] 3.7 Final scoped run: the Spec 2 test surface only
    - Command: `cd frontend && npx vitest run src/components/DashboardView/__tests__/codeDetectionMappers.test.ts src/components/DashboardView/__tests__/candidateDetailsPanel.test.tsx src/components/DashboardView/__tests__/candidateDetailsExpansion.test.tsx`
    - Expected total: approximately 16-24 tests across the three files
    - Do NOT run the entire frontend test suite

**Acceptance Criteria:**
- `candidateDetailsPanel.test.tsx` is rewritten in place: orchestrator describe block preserved verbatim; CodeDetectionPanel describe block fully replaced with per-type shaped assertions
- All 6-8 new component-level tests pass
- `candidateDetailsExpansion.test.tsx` (Spec 1's table integration tests) passes with NO edits
- `candidateReviewWorkflow.test.tsx` and any other consumers of `DiscoveryCandidateTable` / `DiscoveryRunDetailView` pass with NO edits
- The Spec 2 scoped run (mappers + panel + expansion) is green end-to-end

## Execution Order

Recommended implementation sequence:
1. Mapper module + adapter helper + pure unit tests (Task Group 1) — independent, ships first
2. Wire `CodeDetectionPanel.tsx` to the new mappers (Task Group 2) — requires Task Group 1
3. Rewrite component test file + verify non-regression backstop (Task Group 3) — requires Task Group 2

## Cross-Cutting Constraints (apply to all task groups)

- Use camelCase field names from `candidate.data` exactly as adapters emit them today (e.g. `httpMethod`, `fullPath`, `controllerClassName`, `methodName`, `responseType`, `interfaceClassName`, `logicalEntityName`). Do NOT use the snake_case shape Spec 1's old fixture used.
- Bean-definition discriminator: `candidate.candidate_type === 'interfaces' && candidate.data?.interfaceSubtype === 'spring-bean-definition'`.
- All 18 adapter `_addedBy` values must map to readable display names per the table in shaping notes section 2.1; unknown values fall back via kebab-to-Title-case.
- Source-file list cap: first 5 deduped paths, with `…and N more` appended when the original list exceeded 5.
- Missing-field handling: omit individual fields silently (never emit an empty label); only show `Type-specific details: not available.` when the WHOLE type-specific section has nothing populated.
- No backend changes. No DTO changes. No API changes. No CSS class additions. No edits to `CandidateDetailsPanel.tsx`, `candidateDetailsSupport.ts`, `DiscoveryRunDetailView.module.css`, or `DiscoveryCandidateTable.tsx`.
