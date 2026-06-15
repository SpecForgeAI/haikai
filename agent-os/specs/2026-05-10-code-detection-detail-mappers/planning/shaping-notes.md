# Shaping Notes — Spec 2: Code Detection Detail Mappers

Date: 2026-05-10
Brief: `planning/raw-idea.md`

## 1. What Spec 1 leaves behind

Replaced wholesale by this spec — `frontend/src/components/DashboardView/CodeDetectionPanel.tsx` (Spec 1 version) currently:

- Reads `_addedBy` from `candidate.data` via a local `getAddedBy` helper (intentionally duplicated from `DiscoveryCandidateTable.tsx` — Spec 1 noted it would stay duplicated).
- Renders `Detected by: {addedBy ?? 'deterministic code analysis'}`.
- Renders `Source: {source_cluster_ids.join(', ') || '—'}`.
- Iterates `candidate.data` and prints up to 5 scalar entries with keys starting non-`_`, truncating long strings to 120 chars (testid `code-detection-field-{key}`).
- Renders one of two reason strings depending on whether `_addedBy` is present.
- Wraps everything in `data-testid="code-detection-panel"` with class `styles.detailsColumnBody`.

Unchanged by this spec:
- `CandidateDetailsPanel.tsx` (the orchestrator) — still passes `candidate` to `<CodeDetectionPanel>`.
- `candidateDetailsSupport.ts` — allowlist of supported types is identical to what this spec covers.
- The two placeholder columns (Log Scans, LLM Review) — exact strings preserved.

Spec 1's test file `__tests__/candidateDetailsPanel.test.tsx` makes assertions against the OLD generic body:
- "Detected by: spring-adapter"
- "Source: c-1, c-2, c-3"
- The deterministic / adapter reason strings.
- Scalar field iteration (uses snake_case keys `http_method`, `path` in the fixture — not how real adapters emit; see §2).

These tests will need updating to match the new per-type rendering. The CandidateDetailsPanel describe block (column headings, placeholder text) stays valid as-is.

## 2. Real `candidate.data` field shapes (from adapter source code)

This is the most important section. The brief lists 12+ aspirational endpoint fields, etc. Below is what each adapter ACTUALLY puts in `data` today.

### 2.1 Adapter inventory (full list of `_addedBy` values)

Confirmed by grep over `discovery-service/src/services/extensionPacks/frameworkAdapters/*/index.ts`:

| `_addedBy` value           | Adapter folder        | Display label (proposed)        |
|----------------------------|-----------------------|---------------------------------|
| `spring-boot-adapter`      | springBoot            | Spring Boot Adapter             |
| `spring-classic-adapter`   | springClassic         | Spring Classic Adapter          |
| `angular-adapter`          | angular               | Angular Adapter                 |
| `angularjs-classic-adapter`| angularJsClassic      | AngularJS Classic Adapter       |
| `react-axios-adapter`      | reactAxios            | React (axios/fetch) Adapter     |
| `aspnetcore-adapter`       | aspNetCore            | ASP.NET Core Adapter            |
| `aspnet-framework-adapter` | aspNetFramework       | ASP.NET Framework Adapter       |
| `django-adapter`           | django                | Django Adapter                  |
| `flask-adapter`            | flask                 | Flask Adapter                   |
| `jquery-adapter`           | jquery                | jQuery Adapter                  |
| `kratos-adapter`           | kratos                | Kratos Adapter                  |
| `magento-adapter`          | magento               | Magento Adapter                 |
| `nestjs-adapter`           | nestjs                | NestJS Adapter                  |
| `oatpp-adapter`            | oatpp                 | Oat++ Adapter                   |
| `rails-adapter`            | rails                 | Rails Adapter                   |
| `symfony-adapter`          | symfony               | Symfony Adapter                 |
| `wordpress-adapter`        | wordpress             | WordPress Adapter               |
| `wxwidgets-adapter`        | wxwidgets             | wxWidgets Adapter               |

The brief's table only listed 6 of the 18. Decision: cover the 6 the brief explicitly named with the labels in the brief; for the other 12, use a deterministic fallback (`title-case the segments before "-adapter"` and join with spaces, e.g. `nestjs-adapter` → `NestJS Adapter` via a small explicit override map for the irregular cases). Unknown values pass through unchanged. See §4.3.

### 2.2 `endpoints` candidates — actual fields per adapter

**springBoot** (`processController` lines 583–697):
- Always: `httpMethod`, `fullPath`, `methodName`, `controllerClassName`, `returnType`, `_addedBy`
- Sometimes: `unwrappedReturnType` (when wrapper unwrapped), `responseType` (set when there is a real return type), `requestBodyType`, `pathVariables` (array of `{name,type}`), `requestParams` (array of `{name,type,required,defaultValue?}`), `security` (`{annotation, expression?, roles?, inheritedFromClass}`), `openApiOperation` (`{summary?, description?, operationId?, tags?}`), `openApiResponses` (array of `{responseCode,description,content}`), `transactional` (`{declared|inheritedFromClass|propagation|...}`)

**springClassic** (`processController` lines 324–393):
- Same shape as springBoot core fields: `httpMethod`, `fullPath`, `methodName`, `controllerClassName`, `returnType`, `responseType?`, `requestBodyType?`, `unwrappedReturnType?`
- Does NOT emit `pathVariables`, `requestParams`, `security`, `openApi*`, `transactional` (it's the legacy pack — those Tier-1/2 enrichments are spring-boot-only).

**aspNetCore** (lines 95–135):
- `httpMethod`, `fullPath`, `methodName`, `controllerClassName`, `returnType`, optionally `requestBodyType`, optionally `responseType`.

**flask** (lines 82–93):
- `httpMethod`, `fullPath`, `methodName`, `parameterCount`, `endpoint_subtype: 'flask_route'`. NO controller class (Flask uses functions, not classes), NO request/response body types.

**rails** (lines 74–100):
- `httpMethod`, `fullPath`, `methodName`, `controllerClassName`, `inferredFromConvention: true`. NO request/response body types.

**angular** (`processHttpCalls` lines 145–170):
- `httpMethod`, `url`, `urlVariable`, `apiLibrary: 'HttpClient'`, `callingFunction` (`Class.method`), `endpoint_subtype: 'api_call'`, `responseType` (from typeArgs), `line`. NO `fullPath`, NO `controllerClassName`.

**reactAxios** (lines 425–438):
- `httpMethod`, `url`, `canonicalUrl`, `urlVariable`, `apiLibrary`, `callingFunction`, `endpoint_subtype: 'api_call'`, `responseType`, `line`.

(Other adapters inspected briefly: nestjs/django/symfony/etc. follow the controller-class shape similar to springClassic with `httpMethod` + `fullPath` + `controllerClassName` + `methodName` as the common core. Variation is in the optional enrichments.)

**Aggregate "always present somewhere" endpoint-side keys:**
`httpMethod`, `fullPath` (or `url`/`canonicalUrl` for client-side adapters), `methodName`, `controllerClassName` (server-side only), `callingFunction` (client-side only), `responseType`, `requestBodyType`, `pathVariables`, `requestParams`, `security`, `openApiOperation`, `openApiResponses`, `transactional`, `apiLibrary`, `endpoint_subtype`, `line`.

### 2.3 `interfaces` candidates — actual fields

**springBoot** (`processController` lines 596–611):
- `basePath`, `controllerType` (`'RestController'` | `'Controller'`), `className`, `packageName`, optionally `openApiTag` (`{name,description}`), optionally `security` (class-level).

**springBoot config beans** (`processConfigurationClass` lines 947–974) — also emits `interfaces` with very different shape:
- `interfaceSubtype: 'spring-bean-definition'`, `beanName`, `beanReturnType`, `configurationClassName`, `packageName`, `isPrimary`, `isLazy`, optionally `scope`.

**springClassic** (lines 331–342): `basePath`, `controllerType`, `className`, `packageName`. No tag/security.

(springClassic also emits a much wider variety of `interfaces` candidates — async listeners, Spring beans, Feign clients, message-driven beans — each with its own shape. Lines 597–1093. All carry `className` + a varying `interfaceSubtype` discriminator.)

**aspNetCore** (line 98): `basePath`, `controllerType: 'AspNetCoreController'`, `className`.

**rails** (line 78): `className`, `controllerType: 'RailsController'`, `resource`.

**angular / reactAxios / flask**: do NOT emit `interfaces` for endpoint groupings (frontend frameworks group by file/service implicitly).

**Aggregate "always present somewhere" interface keys:**
`className`, `basePath`, `controllerType`, `packageName`, `interfaceSubtype`, `beanName`, `openApiTag`, `security`, `resource`.

### 2.4 `logical_data_entities` candidates — actual fields

**springBoot** (`emitLogicalEntities` lines 999–1009): `className`, `packageName`. That's it — no `kind`, no `extends`, no `implements`.

**springClassic** (similar block around line 1306 onwards): `className`, `packageName`.

**aspNetCore** (line 179): `className`, `packageName`.

**flask** (line 136): `className`, `marshmallow: boolean`, `wtforms: boolean`.

**rails** (line 134): `className`, `serializer: true`.

**angular** (line 193): `className`, `isInterface: true`.

**reactAxios** (line 298): `className`, `isInterface: boolean`, `extends: string|null`.

**Aggregate "always present somewhere" logical-entity keys:**
`className`, `packageName`, `isInterface`, `extends`, plus framework-specific marker booleans (`marshmallow`, `wtforms`, `serializer`).

The brief's "Kind: class" shape (spring-boot-adapter example) is **NOT actually emitted** by the spring-boot adapter today. The spec must either accept an empty "Kind" field or make do with what's there.

### 2.5 `interface_logical_entities` candidates — actual fields

**springBoot** (`emitInterfaceLogicalEntities` lines 1075–1093):
- `interfaceClassName`, `logicalEntityName`. That's literally it. No role, no supporting method, no request/response body types — the adapter explicitly emits "undirected, one entry per (controller, DTO) pair regardless of role" (per its docblock).

**springClassic** (similar block, line 1786): same minimal shape.

The brief's example output for `interface_logical_entities` (`Relationship role: response`, `Supporting method: getOwner`) is **NOT achievable from current candidate.data**. Implementation must omit those fields gracefully.

### 2.6 Source paths

`candidate.source_cluster_ids` is set to `[file.filePath]` by every adapter (single-element array). It is NOT a cluster id — it's a file path string like `src/main/java/.../OwnerController.java`. The spec phrasing "Source file(s)" is correct; the array can almost always be treated as a single value but the mapper should still cap and dedup defensively.

## 3. Reality vs. brief — gap summary

Brief's "curated fields to show when available" lists vs. what's actually emitted:

| Candidate type | Brief field                   | Emitted today?                                                      |
|----------------|-------------------------------|---------------------------------------------------------------------|
| endpoints      | HTTP method                   | YES (`httpMethod`)                                                   |
| endpoints      | Full path / route path        | YES (`fullPath` server, `url`/`canonicalUrl` client)                 |
| endpoints      | Controller / interface class  | YES server (`controllerClassName`); client uses `callingFunction`    |
| endpoints      | Handler method name           | YES (`methodName` server, derived from `callingFunction` client)     |
| endpoints      | Request body type             | YES sometimes (`requestBodyType`)                                    |
| endpoints      | Response type / return type   | YES (`responseType` and/or `returnType`)                             |
| endpoints      | Path variables                | YES springBoot only (`pathVariables`)                                |
| endpoints      | Request parameters            | YES springBoot only (`requestParams`)                                |
| endpoints      | Security/auth metadata        | YES springBoot only (`security`)                                     |
| endpoints      | Transactional metadata        | YES springBoot only (`transactional`)                                |
| endpoints      | OpenAPI operation id/summary  | YES springBoot only (`openApiOperation`)                             |
| endpoints      | Source file(s)                | YES (`source_cluster_ids`)                                           |
| interfaces     | Class name                    | YES (`className`)                                                    |
| interfaces     | Interface type/subtype        | YES (`controllerType` and/or `interfaceSubtype`)                     |
| interfaces     | Base path                     | YES server (`basePath`)                                              |
| interfaces     | Package/module                | YES springBoot/springClassic/aspNetCore (`packageName`)              |
| interfaces     | Security/auth metadata        | YES springBoot only (class-level `security`)                         |
| interfaces     | OpenAPI tag                   | YES springBoot only (`openApiTag`)                                   |
| interfaces     | Source file(s)                | YES                                                                 |
| logical_de     | Class/interface/type name     | YES (`className`)                                                    |
| logical_de     | Package/module                | YES springBoot/springClassic/aspNetCore (`packageName`)              |
| logical_de     | Entity shape/type             | NOT EMITTED — no adapter sets a `kind`/`shape` field                |
| logical_de     | Interface vs class flag       | YES angular/reactAxios only (`isInterface`); spring-* don't emit it  |
| logical_de     | Extends / implements          | YES reactAxios only (`extends`)                                      |
| logical_de     | Related endpoint/iface ref    | NOT EMITTED — only present indirectly via `interface_logical_entities` candidates |
| logical_de     | Source file(s)                | YES                                                                 |
| iface_le       | Interface name                | YES (`interfaceClassName`)                                           |
| iface_le       | Logical entity name           | YES (`logicalEntityName`)                                            |
| iface_le       | Relationship role             | NOT EMITTED — adapters intentionally undirected                      |
| iface_le       | Supporting endpoint/method    | NOT EMITTED                                                         |
| iface_le       | Request body type             | NOT EMITTED on this candidate (lives on the endpoint candidate)      |
| iface_le       | Response type                 | NOT EMITTED on this candidate (lives on the endpoint candidate)      |
| iface_le       | Source file(s)                | YES                                                                 |

**Headline gap:** for `interface_logical_entities` and `logical_data_entities`, several brief-listed fields are simply not in the data today. The spec is frontend-only ("Use only fields already available in the existing candidate payload" — line 31 of the brief), so these mappers will be sparser than the brief's example output. This is the main thing worth surfacing to the user (see §6 question 1).

## 4. Implementation decisions (mine to make)

### 4.1 File layout

New files, both next to `CodeDetectionPanel.tsx`:
- `frontend/src/components/DashboardView/codeDetectionMappers.ts` — pure, no React, exports per-type builders + the `CodeDetectionDisplay` interface.
- `frontend/src/components/DashboardView/__tests__/codeDetectionMappers.test.ts` — pure unit tests over the mappers (no rendering).

`CodeDetectionPanel.tsx` is rewritten in place (Spec 1 wrote it explicitly to be replaced by Spec 2; its docblock will be updated). It becomes a thin renderer that calls `buildCodeDetectionDetails(candidate)` and walks the returned `fields` array.

### 4.2 Display-model shape

```ts
export interface CodeDetectionField {
  label: string;            // e.g. "HTTP method"
  value: string | string[]; // arrays render as a comma-separated list (or bullet list — see 4.4)
}

export interface CodeDetectionDisplay {
  /** Display-name of the adapter, e.g. "Spring Boot Adapter". Always non-empty. */
  detectedBy: string;
  /** Single human-readable reason string. Always non-empty. */
  reason: string;
  /** Source files (capped, deduped). May be empty. */
  sourceFiles: string[];
  /** Curated type-specific fields, in the order they should be rendered. */
  fields: CodeDetectionField[];
  /**
   * True when the candidate type is in the supported allowlist but no curated
   * fields could be produced (e.g. all optional fields missing). Used by the
   * renderer to drop a "Not available" line under the type-specific section.
   */
  isMostlyEmpty: boolean;
}
```

Top-level entry point `buildCodeDetectionDetails(candidate: DiscoveryCandidateDto): CodeDetectionDisplay` dispatches on `candidate.candidate_type` to one of:
- `buildEndpointCodeDetails`
- `buildInterfaceCodeDetails`
- `buildLogicalDataEntityCodeDetails`
- `buildInterfaceLogicalEntityCodeDetails`

For an unsupported type, returns a generic display with `reason: 'Detected from deterministic code analysis.'`, no fields, and `isMostlyEmpty: true`. (Unsupported types shouldn't reach the panel anyway — `supportsDetails` already gates it — but the mapper stays defensive.)

### 4.3 Adapter display-name normalisation

A small explicit map keyed on `_addedBy`:

```ts
const ADAPTER_DISPLAY_NAMES: Record<string, string> = {
  'spring-boot-adapter': 'Spring Boot Adapter',
  'spring-classic-adapter': 'Spring Classic Adapter',
  'angular-adapter': 'Angular Adapter',
  'angularjs-classic-adapter': 'AngularJS Classic Adapter',
  'react-axios-adapter': 'React (axios/fetch) Adapter',
  // (and so on for all 18 — small enough to enumerate)
  ...
};
```

The brief explicitly lists 6 of these and gives display strings; I'll honour those exactly. For the other 12 I'll add reasonable PascalCased labels following the same convention. Unknown values fall back to `value` unchanged. If `_addedBy` is missing entirely → `'deterministic code analysis'` (preserves Spec 1 behaviour).

### 4.4 Multi-source-file handling

Per the brief: "If there are many source files, show a concise list and avoid overwhelming the panel." Decision:
- Dedup before display.
- Cap at 5 displayed paths; if more, append `…and N more` as a 6th line.
- Do NOT truncate path strings — the panel column is wide enough and the path is the most useful evidence in the section. (Spec 1's 120-char truncation only applied to opaque scalar strings; full paths are short-ish and worth showing in full.)
- Render as a vertical list (one path per line), not a comma-joined string. This matches the column's vertical rhythm and reads better for paths.

In practice, `source_cluster_ids` is a one-element array for every adapter today — but defensive capping/dedup is cheap.

### 4.5 Array fields rendering (`pathVariables`, `requestParams`, `openApiResponses`, etc.)

Each adapter emits these as arrays of objects, e.g.
- `pathVariables: [{name, type}, ...]`
- `requestParams: [{name, type, required, defaultValue?}, ...]`
- `openApiResponses: [{responseCode, description, content?}, ...]`

Mapper formats each entry into a string like `ownerId: int`, `petId: int (required, default=1)`, `200: OK` and emits the array as `string[]`. The renderer joins `string[]` with line breaks (one item per line in the column body).

### 4.6 "Reason" string selection

Per the brief, each candidate type has a primary reason and a secondary fallback wording. Decision:
- For `endpoints`: primary = `"Detected as a controller method exposed through framework route annotations."` for spring-* / nestjs / aspnet / rails; fallback `"Detected as an HTTP endpoint from framework route metadata in code."` for flask + client-side adapters (angular, reactAxios) where it's an outbound HTTP call (so we'll actually word that one as `"Detected as an HTTP call from frontend code making framework HTTP-client calls."`).
- For `interfaces`: primary `"Detected as an interface/API surface from framework controller metadata."`; for `interfaceSubtype === 'spring-bean-definition'` use `"Detected as a Spring bean definition from a @Configuration class."`.
- For `logical_data_entities`: primary `"Detected as a logical data shape referenced by interface or endpoint code."`; for adapters whose IsInterface flag is true use the TS wording from the brief.
- For `interface_logical_entities`: always use the fallback wording `"Detected because interface code references this logical data entity."` (since role/method are never present today).

Each mapper picks its reason from this small per-type set without asking the user.

### 4.7 Missing-data behaviour

Two distinct UX states:
1. **Section with some fields populated:** render only the populated fields. No "n/a" rows.
2. **Section with NO populated fields beyond `Detected by` / `Source` / `Reason`:** render a single subdued line `Type-specific details: not available.` (sets `isMostlyEmpty: true` so the renderer can pick this up).

Whole-section fallback rather than per-row "n/a" placeholders matches the brief's phrasing ("Prefer 'Not available' only for whole sections where no useful data exists").

### 4.8 Backward compatibility with Spec 1's testids

Spec 1's panel exposed `data-testid="code-detection-detected-by"`, `code-detection-source`, `code-detection-reason`, and `code-detection-field-{key}`. To minimise disruption to integration tests and to allow the shaped panel to stay locatable:
- Keep `code-detection-panel`, `code-detection-detected-by`, `code-detection-reason` testids.
- Replace `code-detection-source` with `code-detection-source-files` (the source UX is now a list, not a one-line value — name change is justified).
- New per-field rows use `data-testid="code-detection-field-{slugifiedLabel}"` (e.g. `code-detection-field-http-method`).
- Spec 1's narrow `candidateDetailsPanel.test.tsx` tests for the OLD generic body will need to be retargeted to the new shape (the spec deliverable is to update the test file — see §1).

## 5. Out-of-scope reaffirmed (no need to ask)

The brief explicitly excludes these and they stay out:
- Backend evidence/explainability contract (Spec 3's territory).
- Log upload / parsing / runtime evidence / log-derived content in any column (Specs 4–6).
- Confidence / tier / runtime badge changes (Spec 7).
- LLM-generated reasoning.
- Source code snippets / line-number rendering beyond what's already in `data` (e.g. `data.line` from angular/react-axios endpoints).
- Adding support for candidate types outside the four named in §1.
- ANY change to discovery-service adapters (this spec is frontend-only by the brief's own line 31).

## 6. Genuine product/UX questions to relay

Three real decisions I cannot reasonably make alone:

1. **Sparse mappers vs adapter changes.** The brief's curated field lists assume fields the adapters DON'T currently emit. Most notably: `logical_data_entities` has no `kind`/`extends` for spring-* candidates (only `className` + `packageName`), and `interface_logical_entities` has only `interfaceClassName` + `logicalEntityName` (no role, no supporting method, no request/response types). The brief example outputs for these two types therefore can't be produced verbatim today. Are you OK with the mappers showing only the curated subset that's actually populated (so e.g. logical-entity Code Detection shows just Class/Package/Source File, and interface-logical-entity shows just Interface/Logical entity/Source File), trusting later specs to enrich the adapter payload? Or do you want this spec to also extend the relevant adapters to emit the missing fields (which contradicts the "frontend-only, no backend changes" line in the brief but would let the example outputs be hit literally)?

2. **Spring `@Configuration` beans show up as `interfaces` candidates with a `interfaceSubtype: 'spring-bean-definition'` shape — completely different from a controller (no `basePath`, has `beanName`/`beanReturnType`/`configurationClassName`).** Should the Interface mapper detect this and render a distinct "Spring bean definition" section (Bean name / Bean type / Configuration class / Scope), or is that out of scope for this spec and the bean-shaped interface candidates should fall back to the "Type-specific details: not available." subdued line?

3. **Test file updates in this spec.** `frontend/src/components/DashboardView/__tests__/candidateDetailsPanel.test.tsx` was written by Spec 1 against the old generic body. This spec replaces that body, so several assertions in that file will fail. I'm planning to update it in-place (keep the `CandidateDetailsPanel` describe block for the column-headings/placeholders coverage; replace the `CodeDetectionPanel` describe block with shaped assertions per type) plus add a new pure mappers test file. Confirm you want the existing test file rewritten rather than left as a deprecated artifact.

## Resolved decisions (autonomous defaults — set 2026-05-10)

The three clarifying questions raised during shaping have been resolved with the following defaults. The user has been informed and may override any of these before spec-writer runs.

1. **Adapter coverage gap → ship what's available today.**
   The brief explicitly mandates "Use only fields already available in the existing candidate payload" and "frontend-only, no backend changes." Mappers will render the populated subset and silently skip absent fields.
   - `logical_data_entities` (spring-*): show only Class, Package, Source File. Omit Kind, Extends, Implements (not emitted by adapters today).
   - `interface_logical_entities`: show only Interface, Logical entity, Source File. Omit Relationship role, Supporting method, Request/response types (not emitted today).
   - Brief's per-type example outputs are aspirational — actual rendered output will be the available subset.
   - Future specs may extend adapter payloads; mappers should be written so adding a field requires only one new mapper line.

2. **Spring `@Configuration` bean-shaped `interfaces` → render a distinct "Spring bean definition" section.**
   When `candidate.candidate_type === 'interfaces'` AND `candidate.data.interfaceSubtype === 'spring-bean-definition'`, the Interface mapper produces a dedicated layout with: Bean name (`beanName`), Bean return type (`beanReturnType`), Configuration class (`configurationClassName`), and source file. The standard interface mapper (controller-shaped: Class / Interface type / Base path / Package / Source) handles the non-bean shape. Discrimination is on the `interfaceSubtype` field that already exists in the payload.

3. **Spec 1's `__tests__/candidateDetailsPanel.test.tsx` → rewrite in place.**
   - Preserve the `CandidateDetailsPanel` describe block (column headings + placeholder strings — these don't change).
   - Replace the `CodeDetectionPanel` describe block with per-type shaped assertions (one short test per supported type with a representative `candidate.data` shape).
   - Add a new pure-unit-test file `codeDetectionMappers.test.ts` for the mapper logic in isolation (display model output, adapter name normalisation, missing-field handling).
   - No value in keeping the old generic-display tests as a deprecated artifact.
