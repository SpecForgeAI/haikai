# Specification: Code Detection Detail Mappers

## Goal
Replace the generic Code Detection body added by Spec 1 with a curated, candidate-type-specific mapper layer that renders only fields actually emitted by today's framework adapters, so reviewers see readable, evidence-grounded explanations of why each candidate was detected from code. This is Spec 2 of a 7-spec roadmap for discovery candidate evidence explainability.

## User Stories
- As a discovery reviewer, I want the Code Detection column to show fields tailored to each candidate type so that I can quickly see the relevant evidence (HTTP method/path for endpoints, class/base path for interfaces, etc.) without wading through raw JSON.
- As a discovery reviewer, I want Spring `@Configuration` bean candidates to render their bean-specific fields (Bean name, Bean return type, Configuration class) so that I can distinguish them from controller-shaped interface candidates.
- As a discovery reviewer, I want adapter source labels rendered in human-readable form (e.g., "Spring Boot Adapter" instead of `spring-boot-adapter`) so that the panel feels polished and the source of detection is immediately obvious.

## Specific Requirements

**Frontend-only, no backend changes**
- Mappers consume `candidate.data` exactly as adapters emit it today; no adapter, DTO, persistence, or API changes.
- Use the camelCase field names actually emitted by the discovery-service adapters (e.g., `httpMethod`, `fullPath`, `controllerClassName`, `methodName`, `responseType`, `interfaceClassName`, `logicalEntityName`).
- Mappers render the populated subset of curated fields and silently skip absent fields. Do not invent or interpolate values that are not present.
- Confirms shaping decision #1: the brief's aspirational example outputs (e.g., `Kind: class` for logical_data_entities, `Relationship role: response` for interface_logical_entities) are not achievable today and the rendered output will be the available subset only.

**What changes from Spec 1**
- `CodeDetectionPanel.tsx` internals are replaced wholesale: remove the generic scalar-iteration loop, remove the `getAddedBy`/`truncate`/`isScalar`/`formatScalar` helpers, and replace the inline body with a call to the new mapper layer plus a thin renderer over the returned display model.
- A new mapper module `frontend/src/components/DashboardView/codeDetectionMappers.ts` is added.
- A new pure-unit test file `frontend/src/components/DashboardView/__tests__/codeDetectionMappers.test.ts` is added.
- Spec 1's `__tests__/candidateDetailsPanel.test.tsx` is rewritten in place (per resolved decision #3): the `CandidateDetailsPanel` describe block is preserved (column headings + placeholder strings unchanged); the `CodeDetectionPanel` describe block is replaced with per-type shaped assertions.

**What does NOT change**
- `CandidateDetailsPanel.tsx` (the orchestrator) — still renders the three-column grid, still passes `candidate` to `<CodeDetectionPanel>`.
- `candidateDetailsSupport.ts` — the allowlist of supported candidate types (`endpoints`, `interfaces`, `logical_data_entities`, `interface_logical_entities`) is unchanged.
- `DiscoveryRunDetailView.module.css` — no new CSS classes; the renderer reuses `detailsColumnBody` plus standard div/list elements inside it.
- The three-column layout, column headings, Log Scans placeholder ("Log scan evidence is not available for this run."), and LLM Review placeholder ("No candidate-specific LLM review details are available yet.").
- Approve/Reject/Defer behaviour, table filtering, sorting, paging, single-row expansion guarantee, disabled-button semantics for unsupported types.
- `discoveryApi.ts`, `DiscoveryCandidateDto`, and any backend service.

**Mapper module shape (`codeDetectionMappers.ts`)**
- Exports the display-model interfaces:
  - `CodeDetectionField { label: string; value: string | string[] }`
  - `CodeDetectionDisplay { detectedBy: string; reason: string; sourceFiles: string[]; fields: CodeDetectionField[]; isMostlyEmpty: boolean }`
- Exports the dispatcher `buildCodeDetectionDetails(candidate: DiscoveryCandidateDto): CodeDetectionDisplay` which switches on `candidate.candidate_type` to one of the per-type builders, falling back to a generic display for unsupported types.
- Exports the per-type builders: `buildEndpointCodeDetails`, `buildInterfaceCodeDetails`, `buildLogicalDataEntityCodeDetails`, `buildInterfaceLogicalEntityCodeDetails`.
- Exports `formatAdapterDisplayName(value: string | null | undefined): string` for the `_addedBy` normalisation.
- Exports small safe formatting helpers for arrays-of-objects (`pathVariables`, `requestParams`, `openApiResponses`) that turn each entry into a readable string (e.g., `ownerId: int`, `petId: int (required, default=1)`, `200: OK`).
- The display model intentionally has no `title` field — the column heading "Code Detection" is rendered by the parent `CandidateDetailsPanel` (per Spec 1) and is not the mapper's concern.
- Pure module: no React imports, no CSS imports, no API calls, no logging side-effects.

**Endpoint mapper (`buildEndpointCodeDetails`)**
- Reason string: `"Detected as a controller method exposed through framework route annotations."` for server-shape (presence of `controllerClassName`); `"Detected as an HTTP call from frontend code making framework HTTP-client calls."` for client-shape (presence of `url` or `canonicalUrl` and `apiLibrary`); `"Detected as an HTTP endpoint from framework route metadata in code."` as a final fallback.
- Server-shape fields (in order, omit when absent): `HTTP method` (`httpMethod`), `Path` (`fullPath`), `Controller` (`controllerClassName`), `Handler method` (`methodName`), `Request body type` (`requestBodyType`), `Response type` (`responseType` or `unwrappedReturnType` or `returnType`), `Path variables` (formatted `pathVariables`), `Request parameters` (formatted `requestParams`), `Security` (`security.annotation`), `OpenAPI operation` (`openApiOperation.operationId` or `openApiOperation.summary`), `Transactional` (`transactional.propagation` or boolean from `transactional.declared`).
- Client-shape fields (in order, omit when absent): `HTTP method` (`httpMethod`), `URL` (`canonicalUrl` if present, otherwise `url`), `Calling function` (`callingFunction`), `API library` (`apiLibrary`), `Response type` (`responseType`).
- Source file: from `candidate.source_cluster_ids` (treated as file paths, not cluster ids — see shaping notes §2.6).

**Interface mapper (`buildInterfaceCodeDetails`)**
- Discriminates on `data.interfaceSubtype === 'spring-bean-definition'` (per resolved decision #2):
  - **Spring bean-definition shape** — reason: `"Detected as a Spring bean definition from a @Configuration class."`. Fields (in order, omit when absent): `Bean name` (`beanName`), `Bean return type` (`beanReturnType`), `Configuration class` (`configurationClassName`), `Package` (`packageName`), `Scope` (`scope`), `Primary` (`isPrimary` if true), `Lazy` (`isLazy` if true).
  - **Standard controller shape** — reason: `"Detected as an interface/API surface from framework controller metadata."`. Fields (in order, omit when absent): `Class` (`className`), `Interface type` (`controllerType` or `interfaceSubtype`), `Base path` (`basePath`), `Package` (`packageName`), `Resource` (`resource` for Rails), `OpenAPI tag` (`openApiTag.name`), `Security` (`security.annotation`).
- Source file: from `candidate.source_cluster_ids`.

**Logical-data-entity mapper (`buildLogicalDataEntityCodeDetails`)**
- Reason string: `"Detected as a logical data shape from TypeScript or JavaScript model/type metadata."` when `data.isInterface` is set (angular/reactAxios); otherwise `"Detected as a logical data shape referenced by interface or endpoint code."`.
- Fields (in order, omit when absent): `Type` (`className`), `Package` (`packageName`), `Kind` (`'interface'` if `isInterface === true`, otherwise omit), `Extends` (`extends` if non-null/non-empty, reactAxios only).
- Spring-* candidates produce only `Type` + `Package` + source file today (per shaping notes §2.4 and resolved decision #1) — that is the expected output for those adapters and is not a regression.
- Source file: from `candidate.source_cluster_ids`.

**Interface-logical-entity mapper (`buildInterfaceLogicalEntityCodeDetails`)**
- Reason string: always `"Detected because interface code references this logical data entity."` (the directional-role wording from the brief is omitted because adapters do not emit role today — per shaping notes §2.5 and resolved decision #1).
- Fields (in order, omit when absent): `Interface` (`interfaceClassName`), `Logical data entity` (`logicalEntityName`).
- Source file: from `candidate.source_cluster_ids`.

**Adapter display-name helper (`formatAdapterDisplayName`)**
- Backed by an explicit map covering all 18 known adapter values:
  - `spring-boot-adapter` → `Spring Boot Adapter`
  - `spring-classic-adapter` → `Spring Classic Adapter`
  - `angular-adapter` → `Angular Adapter`
  - `angularjs-classic-adapter` → `AngularJS Classic Adapter`
  - `react-axios-adapter` → `React (axios/fetch) Adapter`
  - `aspnetcore-adapter` → `ASP.NET Core Adapter`
  - `aspnet-framework-adapter` → `ASP.NET Framework Adapter`
  - `django-adapter` → `Django Adapter`
  - `flask-adapter` → `Flask Adapter`
  - `jquery-adapter` → `jQuery Adapter`
  - `kratos-adapter` → `Kratos Adapter`
  - `magento-adapter` → `Magento Adapter`
  - `nestjs-adapter` → `NestJS Adapter`
  - `oatpp-adapter` → `Oat++ Adapter`
  - `rails-adapter` → `Rails Adapter`
  - `symfony-adapter` → `Symfony Adapter`
  - `wordpress-adapter` → `WordPress Adapter`
  - `wxwidgets-adapter` → `wxWidgets Adapter`
- For unknown values, derive a label by stripping a trailing `-adapter` segment, splitting on `-`, title-casing each segment, joining with spaces, and appending `Adapter` (e.g., `some-new-adapter` → `Some New Adapter`).
- For null/undefined/empty input, return `"deterministic code analysis"` (preserves Spec 1 behaviour for adapter-less candidates).

**Display rules and missing-data handling**
- Never render raw JSON, raw uncurated `candidate.data` dumps, or the row-level summary fields (name, type, tier, confidence, review status, synthesized timestamp).
- Never render an empty label or a label with `undefined`/`null`/empty-string value — drop the field entirely instead.
- When a section has no curated type-specific fields populated (only Detected by + Source + Reason), the renderer drops a single subdued line `Type-specific details: not available.` (the mapper sets `isMostlyEmpty: true`).
- Source files: dedup, cap at the first 5 paths, and append `…and N more` as a trailing line when the original list exceeded 5. Render as a vertical list (one path per line) inside the source-files block.
- Array fields (`pathVariables`, `requestParams`, `openApiResponses`) are flattened to `string[]` by the mapper; the renderer renders one item per line under the field's label.

**Renderer changes (`CodeDetectionPanel.tsx`)**
- Becomes a thin presentational component: read `candidate`, call `buildCodeDetectionDetails(candidate)`, render the returned display model.
- Container keeps `data-testid="code-detection-panel"` and the `styles.detailsColumnBody` class for layout continuity.
- Preserved testids: `code-detection-detected-by`, `code-detection-reason`.
- Renamed testid: `code-detection-source` becomes `code-detection-source-files` (the source UX is now a list, not a one-line value — name change is justified).
- New per-field testid pattern: `code-detection-field-{slugifiedLabel}` where the slug is the lowercase, kebab-cased label (e.g., `code-detection-field-http-method`, `code-detection-field-controller`, `code-detection-field-base-path`).
- When `display.isMostlyEmpty` is true, render an additional `data-testid="code-detection-empty"` line containing `Type-specific details: not available.`.

## Visual Design

The `planning/visuals/` folder is empty for this spec. The visual reference is Spec 1's three-column layout (unchanged) with the Code Detection column body restructured per the rules above. The brief's example outputs (raw-idea.md lines 79-89, 110-117, 143-149, 172-179) are aspirational — the actual rendered output for each type matches the curated subset described under "Specific Requirements" above.

## Existing Code to Leverage

**`frontend/src/components/DashboardView/CodeDetectionPanel.tsx`**
- Reuse the file path and the `data-testid="code-detection-panel"` wrapper plus the `styles.detailsColumnBody` class.
- Replace the body: drop `getAddedBy`/`truncate`/`isScalar`/`formatScalar`/`MAX_SCALAR_FIELDS`/`MAX_STRING_LEN` and the inline scalar loop. Keep the component name, prop interface, and the test-locatable wrapper.
- The `_addedBy` reading logic moves into `formatAdapterDisplayName` inside the new mapper module.

**`frontend/src/components/DashboardView/CandidateDetailsPanel.tsx`**
- No changes. Still renders the three-column grid and forwards `candidate` to `<CodeDetectionPanel>`. Confirms the renderer does NOT need to render a column title — that responsibility stays with this orchestrator.

**`frontend/src/components/DashboardView/candidateDetailsSupport.ts`**
- No changes. The mapper dispatcher's switch covers exactly the four types in `SUPPORTED_DETAIL_TYPES`; an unsupported-type defensive branch returns a generic display but never reaches the renderer in practice because `supportsDetails()` already gates expansion.

**`frontend/src/api/discoveryApi.ts`**
- No changes. `DiscoveryCandidateDto` already exposes `id`, `candidate_type`, `source_cluster_ids`, and `data` — that is everything the mappers consume.

**`frontend/src/components/DashboardView/__tests__/candidateDetailsExpansion.test.tsx`** (Spec 1's table-integration tests)
- No changes. These integration tests must continue to pass unchanged — they are the non-regression backstop for Spec 1's expand/collapse, allowlist, and three-column structural assertions.

## Out of Scope
- Backend evidence/explainability contract (Spec 3).
- Log upload, log parsing, runtime evidence display, runtime endpoint matches (Specs 4–6).
- Confidence score changes, tier label changes, runtime badges (Spec 7).
- LLM-generated reasoning or any LLM enrichment of the Code Detection column.
- Displaying raw source code snippets.
- Displaying exact line numbers (even where `data.line` exists in angular/react-axios payloads — kept out per resolved decision #1's "ship what's available, no new UX surfaces").
- Adding support for candidate types outside `endpoints`, `interfaces`, `logical_data_entities`, `interface_logical_entities`.
- ANY change to discovery-service framework adapters, including emitting new fields the brief mentions but adapters do not currently produce (`kind`, `extends` for spring-*, `relationshipRole`/`supportingMethod` for interface_logical_entities).
- Changes to `CandidateDetailsPanel.tsx`, `candidateDetailsSupport.ts`, `DiscoveryRunDetailView.module.css`, or `DiscoveryCandidateTable.tsx`.

## Test Plan

**New file: `frontend/src/components/DashboardView/__tests__/codeDetectionMappers.test.ts`** (pure unit tests; no React, no rendering)
- `buildEndpointCodeDetails` happy path on a server-shape Spring Boot candidate produces the expected reason string and field labels in the documented order.
- `buildEndpointCodeDetails` happy path on a client-shape React/axios candidate switches reason text and uses URL/Calling function/API library labels.
- `buildEndpointCodeDetails` with absent optional fields (no `requestBodyType`, no `pathVariables`, no `security`) drops them silently and does not produce empty labels.
- `buildInterfaceCodeDetails` with `interfaceSubtype: 'spring-bean-definition'` selects the bean-definition reason and emits Bean name / Bean return type / Configuration class fields.
- `buildInterfaceCodeDetails` with a standard Spring controller shape selects the controller reason and emits Class / Interface type / Base path / Package fields.
- `buildLogicalDataEntityCodeDetails` on a spring-* candidate emits only Type + Package (matching today's adapter output) and is not flagged as `isMostlyEmpty`.
- `buildLogicalDataEntityCodeDetails` on a reactAxios candidate with `isInterface: true` and `extends: 'BaseDto'` emits the TS-flavoured reason plus Kind + Extends fields.
- `buildInterfaceLogicalEntityCodeDetails` emits Interface + Logical data entity fields and the always-fallback reason string.
- `formatAdapterDisplayName` returns the explicit map value for each of the 18 known adapter ids (parameterised test).
- `formatAdapterDisplayName` falls back to title-cased segments + "Adapter" for an unknown value (e.g., `some-new-adapter` → `Some New Adapter`).
- `formatAdapterDisplayName` returns `"deterministic code analysis"` for null, undefined, and empty-string input.
- Source-file truncation: with 7 source paths plus a duplicate, the mapper output contains 5 unique paths followed by `…and 3 more`.

**Rewritten file: `frontend/src/components/DashboardView/__tests__/candidateDetailsPanel.test.tsx`** (per resolved decision #3)
- Preserve the existing `CandidateDetailsPanel` describe block: column headings ("Code Detection", "Log Scans", "LLM Review"), Log Scans placeholder string, LLM Review placeholder string — all unchanged.
- Replace the `CodeDetectionPanel` describe block with one short integration test per supported candidate type, each driven by a representative `candidate.data` fixture and asserting that the expected curated labels appear and the unsupported brief-aspirational labels do NOT appear:
  - endpoints (server-shape Spring Boot fixture).
  - endpoints (client-shape React/axios fixture).
  - interfaces (standard Spring controller fixture).
  - interfaces (Spring bean-definition fixture).
  - logical_data_entities (spring-boot fixture — sparse output).
  - interface_logical_entities (spring-boot fixture — sparse output).
- Add a single test that covers the `isMostlyEmpty` branch: candidate with allowlisted type but empty `data` renders `Type-specific details: not available.` under `data-testid="code-detection-empty"`.
- Add a single test that covers the `code-detection-source-files` rename: source paths render as a vertical list under the new testid.

**Non-regression requirement**
- `frontend/src/components/DashboardView/__tests__/candidateDetailsExpansion.test.tsx` (Spec 1's table-integration tests) MUST continue to pass unchanged. Listed here as the explicit backstop that the renderer's structural contract (testid wrapper, column slot, three-column grid) is preserved.
- `frontend/src/components/DashboardView/__tests__/candidateReviewWorkflow.test.tsx` and any other tests importing `DiscoveryCandidateTable` or `DiscoveryRunDetailView` MUST continue to pass unchanged.

## Roadmap Context
Spec 2 of 7 in the discovery candidate evidence explainability roadmap: (1) Candidate Details Expansion UI, (2) Code Detection Detail Mappers [this spec], (3) Candidate Evidence Data Contract, (4) Runtime Log Input at Discovery Run Start, (5) Web Access Log Runtime Endpoint Evidence, (6) Log Evidence in Candidate Details UI, (7) Confidence, Tier, and Runtime Badges.
