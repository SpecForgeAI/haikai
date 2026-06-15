# Task Breakdown: Inbound Surface Completeness for Discovery (Java-era classic stacks)

Phase-2 "oracle perfection" **Spec #4 of 6**. **discovery-service ONLY.** No AMS
schema change, no save-back change, no Liquibase, no meta-model reference-doc
edit, no frontend change beyond existing rendering. Deterministic core, NO LLM.
ADD / EXTEND only — build strictly on committed HEAD **`f33b44a`** (Specs #1–#3
done; W1 multi-verb/multi-path fan-out already merged).

## Overview
Total Task Groups: 7 (one per inbound surface / concern)
Total Tasks: 7 groups, ~52 sub-tasks
Test budget: 2–8 focused Jest tests per group (group `x.1`), verified by running
ONLY that group's new tests at the end (group `x.last`). No full-suite runs
during development.

---

## Verified facts this plan is built on (read before starting)

- **HEAD is exactly `f33b44a`** (`Implement oracle-integrity-determinism (Phase-2
  spec 3 of 6)`). W1's plural helpers `extractHttpMethods` (`springClassic/index.ts:354`),
  `extractMethodPaths` (`:392`), `splitBraceList` (`:319`) are LIVE. The
  `TODO(oracle-W1)` sits at `springClassic/index.ts:251-263`; the two single-value
  mirrors it names are `endpointDataEffectResolver.ts:367` (`extractHttpMethod(m)`)
  + `:383` (`extractMethodPath(m)`) and `springBoot/index.ts:284` +`:300`.
- **Canonical candidate shape save-back already resolves** (verified live):
  - interface: `makeCandidate('interfaces', cls.name, file.filePath, { basePath,
    controllerType, className, packageName }, runId)` (`springClassic/index.ts:469-480`).
  - endpoint: `makeCandidate('endpoints', '${httpMethod} ${fullPath}', file.filePath,
    data, runId, interfaceCandidate.id)` where `data` carries `httpMethod`,
    `fullPath`, `methodName`, `controllerClassName`, `returnType` (+ optional
    `responseType` / `requestBodyType` / `unwrappedReturnType`) (`:529-554`).
  - `makeCandidate` (`:423`) stamps `confidence: 0.9`, `status: 'proposed'`,
    `sourceClusterIds: [filePath]`, `data._addedBy: 'spring-classic-adapter'`.
  - **The SOAP pack scanner emits this SAME `candidateType:'interfaces'/'endpoints'`
    shape from OUTSIDE the adapter** (`springClassicSoap/soapEndpointEmitter.ts:1060`
    + `:1092`) — proof that a non-adapter detector can produce save-back-compatible
    endpoint/interface candidates. New detectors MUST match this shape, NOT fork it.
- **`processController` (`:462`) does NOT currently receive `classIndex`;
  `processJpaEntity` (`:619`) DOES** and uses it for `collectMappedSuperclassFields`
  (`:153-175`, the `cls.extends` + `visited` cycle-guard walk to mirror). Both are
  dispatched per-class inside `runSpringClassicAdapter` (`:1976`) at `:2004-2005`.
  Group 1 must thread `classIndex` into `processController` exactly as
  `processJpaEntity` already takes it.
- **Spring-Boot adapter already has the input extractors to mirror**:
  `extractRequestParams` (`springBoot/index.ts:332`), `extractPathVariables`
  (`:321`), `extractRequestBodyType` (`:314`) — prior art for Group 1's
  `@RequestParam`/`@RequestHeader` capture. (Spring-Classic adapter has
  `extractRequestBodyType` at `springClassic/index.ts:414` but NOT the param/header
  extractors yet.)
- **Annotation extraction** records `{ name: nameNode.text, arguments, line }` from
  the RAW simple name in `extractAnnotations` (`astUtils.ts:274-328`, marker at
  `:296-305`, args at `:306-323`). `name` is the simple name only — meta-annotation
  + FQN resolution layers on top of this.
- **`EvidenceGapType` union** is at `emissionSources.ts:447-468`; recent siblings
  `non_deterministic_endpoint` / `possible_entity_collision` (Spec #3) + W4's
  `scanner_failed`. Builder pattern to mirror: `buildNonDeterministicEndpointFinding`
  (`:723`) / `buildPossibleEntityCollisionFinding` (`:799`). The `findingEmitter`
  singleton is `FindingEmitter.ts:548`.
- **`scanWebXmlPresence` (`springClassicFindingScanner.ts:1009`)** is filename-only,
  signature `(ir, packCandidates, counts) -> FindingEmitInput[]`, and the finding
  scanner emits ONLY findings (no candidates). So Group 3's URL-mapping PARSE extends
  `scanWebXmlPresence`, but the endpoint/interface CANDIDATES are emitted through the
  ADAPTER's `makeCandidate` path (the single candidate-emission path) — see the
  Group-3 CAUTION.
- **Finding sentinel decision (Group 7):** none of the existing `EvidenceGapType`
  members fit "deferred inbound surface present, not modelled". A NEW sentinel IS
  required — add it to the union next to `possible_entity_collision` + a new
  `build*` helper modelled on `buildNonDeterministicEndpointFinding`.

---

## Task List

### Surface 1 — Meta-annotation + FQN resolution + inherited controllers + endpoint discriminators

#### Task Group 1: Generalised mapping matcher, `cls.extends` controller walk, discriminators + inputs
**Dependencies:** None (first group on HEAD `f33b44a`).
**Primary edit sites:** `languageExtractors/java/astUtils.ts`,
`frameworkAdapters/springClassic/index.ts`.

> CAUTION: Build on `f33b44a`; ADD/EXTEND only — do NOT revert anything. This group
> EXTENDS Spec #1's committed `astUtils.ts` extraction shape and the adapter's
> `processController` / `makeCandidate` emission — do NOT fork them. W1's plural
> fan-out is ALREADY committed; reuse `extractHttpMethods`/`extractMethodPaths`/
> `splitBraceList` and do NOT redo W1. Parse brace-list args (`consumes`/`produces`)
> via the W1 `splitBraceList` idiom — do NOT refactor `AnnotationIR` to array-typed
> args. No `discovery-service/src/**` edits during an in-flight discovery run
> (`tsx watch` auto-reload kills runs). This group is shared-file-heavy
> (`springClassic/index.ts` + `astUtils.ts`) — it MUST land before Groups 5/6.

- [x] 1.0 Complete meta-annotation/FQN matcher + inherited-controller walk + discriminators
  - [x] 1.1 Write 2–8 focused Jest tests FIRST
    - `@ApiV2Get` meta-annotated with `@GetMapping` resolves to a GET endpoint
      (carrying the outer annotation's path arg, else the meta-annotation's).
    - Fully-qualified `@org.springframework.web.bind.annotation.GetMapping` resolves
      on the final simple-name segment.
    - Inherited base-controller: abstract base with class-level `@RequestMapping("/api")`
      + a base handler method NOT overridden by the concrete controller composes the
      full path from the inherited base path.
    - Discriminator anti-collapse: two mappings on the SAME verb+path differing only
      by `consumes` (or `produces`/`headers`/`params`) produce TWO DISTINCT endpoint
      candidates (distinct `name`), and `@RequestParam`/`@RequestHeader` inputs land
      on `data`.
    - Bounded/cycle-guarded: a meta-annotation cycle and an `extends` cycle both
      terminate without throwing.
    - Place in a NEW `springClassicInboundMetaInherit.test.ts` (do not bloat the W1
      test).
  - [x] 1.2 Extend the annotation matcher (`astUtils.ts` + adapter name-comparison)
    - In `astUtils.ts` keep the existing `{ name, arguments, line }` record, and add
      FQN tolerance: match a known mapping annotation on the FINAL simple-name
      segment of `name` (split on `.`).
    - Add a BOUNDED (depth-capped), CYCLE-GUARDED meta-annotation resolver: when a
      class/method annotation's simple name is NOT in the known mapping set, follow
      the custom annotation's OWN declared annotations one+ levels to a known mapping
      meta-annotation; treat the outer annotation AS that mapping. Carry the outer
      annotation's path/verb args when present, else the meta-annotation's.
    - Generalise the fixed 6-name match site in the adapter (`HTTP_METHOD_ANNOTATIONS`
      / `ENDPOINT_ANNOTATIONS` / `CONTROLLER_ANNOTATIONS`, `springClassic/index.ts:55-72`)
      to consult the new resolver instead of bare simple-name `hasAnnotation`.
  - [x] 1.3 Thread `classIndex` into `processController` + add the inherited-controller walk
    - Change `processController` (`:462`) to receive `classIndex: ClassIndex` (mirror
      `processJpaEntity`'s signature `:619-625`); update the call site at `:2004`.
    - Add a `collectInheritedControllerMappings`-style walk MIRRORING
      `collectMappedSuperclassFields` (`:153-175`): walk `cls.extends` (bounded depth,
      `visited` cycle-guard, via `ClassIndex`) to (a) pick up a class-level
      `@RequestMapping` base path from an abstract/base controller, and (b) include
      base-class handler-method mappings the concrete controller does NOT override.
    - Composed full path uses the most-derived class-level base path when present,
      else the inherited one (reuse `composeFullPath` `:197`).
  - [x] 1.4 Capture discriminators + request-shaping inputs (anti-collapse)
    - Add `consumes` / `produces` / `headers` / `params` to the endpoint candidate
      `data` (parse brace-list args via `splitBraceList` `:319`).
    - FOLD a stable, normalised rendering of the discriminators into the endpoint
      candidate `name` (today `'${httpMethod} ${fullPath}'`, emitted at `:548`) so
      same verb+path variants stay DISTINCT under the `(type, name, filePath)`
      identity save-back + LLM-gap-fill dedup rely on.
    - Capture `@RequestParam` / `@RequestHeader` inputs (name, type, required,
      default) onto `data.requestParams` / `data.requestHeaders` — MIRROR
      `springBoot/index.ts` `extractRequestParams` (`:332`) / `extractPathVariables`
      (`:321`); add a `@RequestHeader` extractor in the same shape.
  - [x] 1.5 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY `springClassicInboundMetaInherit.test.ts` (the 1.1 tests).
    - Confirm offline Jest green. Do NOT run the entire suite.

**Acceptance Criteria:**
- The 2–8 tests from 1.1 pass (offline Jest green).
- Meta-annotated + fully-qualified mapping annotations resolve to endpoints.
- Inherited/abstract base-controller base paths + non-overridden handler mappings
  are emitted; resolution is bounded + cycle-guarded.
- Same verb+path variants differing by `consumes`/`produces`/`headers`/`params` stay
  DISTINCT; `@RequestParam`/`@RequestHeader` inputs land on the endpoint `data`.
- Candidate shape unchanged (`makeCandidate`, `confidence: 0.9`,
  `_addedBy: 'spring-classic-adapter'`); no save-back/AMS change.

---

### Surface 2 — JAX-RS resource detector

#### Task Group 2: JAX-RS (`@Path` / verbs / `@Produces` / `@Consumes` / param inputs)
**Dependencies:** Task Group 1 (reuses the discriminator + input fields and the
generalised matcher landed in TG1; both edit `springClassic/index.ts`).
**Primary edit site:** `frameworkAdapters/springClassic/index.ts` (new
`processJaxRsResource` dispatched from `runSpringClassicAdapter`).

> CAUTION: Build on `f33b44a`; ADD/EXTEND only. REUSE the existing
> `makeCandidate('interfaces'|'endpoints', …)` emission + `composeFullPath` — do NOT
> fork a new emission or save-back path. Reuse W1's plural verb/path helpers where a
> resource yields multiples. No `discovery-service/src/**` edits during an in-flight
> run. Emits the EXACT canonical shape verified above (so save-back resolves it
> unchanged) — `controllerType` = the JAX-RS resource flavour.

- [x] 2.0 Complete the JAX-RS resource detector
  - [x] 2.1 Write 2–8 focused Jest tests FIRST
    - Class-level `@Path("/users")` + method-level `@GET @Path("/{id}")` composes
      `/users/{id}` and emits a GET endpoint parented to the resource interface.
    - All verbs detected (`@GET`/`@POST`/`@PUT`/`@DELETE`/`@HEAD`/`@OPTIONS`).
    - `@Produces`/`@Consumes` land on the SAME discriminator fields as TG1 (anti-collapse);
      `@QueryParam`/`@HeaderParam`/`@PathParam` land on the SAME input fields.
    - Both `javax.ws.rs.*` and `jakarta.ws.rs.*` resolve.
    - Place in NEW `springClassicJaxRs.test.ts`.
  - [x] 2.2 Implement `processJaxRsResource(cls, file, runId, out)`
    - Detect `@Path` at class and/or method level; method verbs
      `@GET`/`@POST`/`@PUT`/`@DELETE`/`@HEAD`/`@OPTIONS` (resolve via the TG1
      generalised matcher so FQN `javax.ws.rs.GET` / `jakarta.ws.rs.GET` both match).
    - Compose full path = class `@Path` + method `@Path` via `composeFullPath`.
    - Map `@Produces`/`@Consumes` → the discriminator fields; `@QueryParam`/
      `@HeaderParam`/`@PathParam` → the input fields (TG1).
    - Emit interface candidate (`controllerType` = JAX-RS resource flavour) +
      one endpoint per (verb × path) via `makeCandidate`, parented to the interface.
  - [x] 2.3 Dispatch from `runSpringClassicAdapter`
    - Add `processJaxRsResource(cls, file, runId, out)` to the per-class loop
      (`:2004-2012`), guarded so a class that is BOTH a Spring `@Controller` and
      carries `@Path` is not double-emitted (prefer the Spring path or de-dup by
      `(type,name,filePath)`).
  - [x] 2.4 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY `springClassicJaxRs.test.ts` (the 2.1 tests).
    - Confirm offline Jest green. Do NOT run the entire suite.

**Acceptance Criteria:**
- The 2–8 tests from 2.1 pass (offline Jest green).
- JAX-RS resources emit interface + endpoint candidates in the canonical shape;
  both `javax`/`jakarta` namespaces resolve.
- Discriminators + param inputs share TG1's fields; no save-back/AMS change.

---

### Surface 3 — Servlets / `web.xml` / `@WebServlet`

#### Task Group 3: Raw servlet + `web.xml` servlet-mapping + `@WebServlet` endpoints
**Dependencies:** Task Group 1 (canonical emission shape) and shares
`springClassicFindingScanner.ts` with Spec #3 / W4 (the `web.xml` PARSE extension).
**Primary edit sites:** `findings/packFindingScanners/springClassicFindingScanner.ts`
(extend `scanWebXmlPresence` to PARSE mappings), `frameworkAdapters/springClassic/index.ts`
(new servlet endpoint emission via `makeCandidate`).

> CAUTION: Build on `f33b44a`; ADD/EXTEND only. KEEP the existing `web_xml_present`
> presence finding (`springClassicFindingScanner.ts:1023-1033`) — ADD parsing
> alongside it, do NOT replace it. The finding scanner emits ONLY findings; route the
> servlet ENDPOINT/INTERFACE candidates through the ADAPTER's `makeCandidate` path so
> there is ONE candidate-emission path (do NOT mint candidates inside the finding
> scanner). Reach `web.xml` content via the IR the adapter already iterates. No
> `discovery-service/src/**` edits during an in-flight run.

- [x] 3.0 Complete the servlet / web.xml / @WebServlet detector
  - [x] 3.1 Write 2–8 focused Jest tests FIRST
    - `<servlet>`+`<servlet-mapping>` in `web.xml` parses to (servlet-class →
      url-pattern) and emits one endpoint per url-pattern; the existing
      `web_xml_present` finding is STILL emitted.
    - `@WebServlet(urlPatterns={"/a","/b"})` (and `value=`) emits one endpoint per
      url-pattern.
    - `extends HttpServlet` with `doGet`/`doPost` infers GET/POST per `doXxx`;
      `service(...)` surfaces as all-verbs per the existing default-verb convention.
    - Place finding-scanner parse assertions in `springClassicFindingScanner.test.ts`
      additions; place candidate-emission assertions in NEW `springClassicServlet.test.ts`.
  - [x] 3.2 Extend `scanWebXmlPresence` to PARSE servlet-mappings
    - In `springClassicFindingScanner.ts:1009`, parse `<servlet>` (servlet-name →
      servlet-class) + `<servlet-mapping>` (servlet-name → url-pattern) into
      (servlet-class → url-pattern[]); KEEP the `web_xml_present` finding.
    - Expose the parsed (servlet-class → url-pattern) result so the adapter's servlet
      emission can consume it (return it alongside / on a structured field, or via a
      shared pure parser the adapter also calls — keep the parser pure).
  - [x] 3.3 Implement servlet endpoint/interface emission in the adapter
    - Add `processServlet*` emission: for `@WebServlet` classes and `extends HttpServlet`
      classes, emit an interface candidate (`controllerType` = servlet flavour) + an
      endpoint per (url-pattern × inferred verb) via `makeCandidate`.
    - Infer verb from `doGet`/`doPost`/`doPut`/`doDelete`; `service` = all verbs
      (consistent with the existing default-verb convention).
    - Feed `web.xml`-derived (servlet-class → url-pattern) mappings into the same
      emission so an XML-declared servlet also produces endpoints.
  - [x] 3.4 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY the 3.1 tests (`springClassicServlet.test.ts` + the
      `springClassicFindingScanner.test.ts` additions).
    - Confirm offline Jest green. Do NOT run the entire suite.

**Acceptance Criteria:**
- The 2–8 tests from 3.1 pass (offline Jest green).
- `web.xml` servlet-mappings, `@WebServlet`, and `extends HttpServlet` all emit
  endpoint + interface candidates in the canonical shape.
- The `web_xml_present` presence finding is preserved; no save-back/AMS change.

---

### Surface 4 — WebFlux `RouterFunction` functional routes

#### Task Group 4: WebFlux functional-route detector
**Dependencies:** Task Group 1 (canonical emission shape + W1 plural helpers).
**Primary edit site:** `frameworkAdapters/springClassic/index.ts` (new functional-route
detector; parse from raw source like the existing `RestTemplate`/`WebClient` regex path).

> CAUTION: Build on `f33b44a`; ADD/EXTEND only. REUSE `makeCandidate` + W1's plural
> verb/path helpers where a predicate yields multiple verbs/paths — do NOT fork
> emission. The functional DSL is a CALL chain (Java IR does not model call
> expressions for this), so parse from `file.rawContent` heuristically as the existing
> outbound `RestTemplate`/`WebClient` path already does. No `discovery-service/src/**`
> edits during an in-flight run.

- [x] 4.0 Complete the WebFlux RouterFunction detector
  - [x] 4.1 Write 2–8 focused Jest tests FIRST
    - `RouterFunctions.route().GET("/x", handler).POST("/y", handler)` emits a GET
      `/x` and a POST `/y` endpoint.
    - `RequestPredicates.*` predicate verbs map to the right HTTP verb.
    - A predicate yielding multiple verbs/paths fans out via the W1 helpers.
    - Place in NEW `springClassicWebFluxRouter.test.ts`.
  - [x] 4.2 Implement the functional-route detector
    - Detect the functional routing DSL (`RouterFunctions.route()…GET(path, handler)` /
      `.POST(...)` / `RequestPredicates.*`) from raw source.
    - Emit one endpoint per (predicate-verb × route-path) + an interface candidate
      (`controllerType` = WebFlux functional flavour) via `makeCandidate`, reusing the
      W1 plural helpers for multi-verb/multi-path predicates.
  - [x] 4.3 Dispatch from `runSpringClassicAdapter`
    - Add the detector to the per-class / per-file pass (alongside
      `processOutboundIntegrations`, `:2009`).
  - [x] 4.4 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY `springClassicWebFluxRouter.test.ts` (the 4.1 tests).
    - Confirm offline Jest green. Do NOT run the entire suite.

**Acceptance Criteria:**
- The 2–8 tests from 4.1 pass (offline Jest green).
- Functional routes emit endpoint + interface candidates in the canonical shape;
  multi-verb/multi-path predicates fan out via W1; no save-back/AMS change.

---

### Surface 5 — JAX-WS interface-declared SEIs

#### Task Group 5: Widen the JAX-WS SOAP scanner to match `interface` SEIs
**Dependencies:** Independent of TG1–TG4 (different file), BUT scheduled AFTER the
shared-file groups so the build stays strictly sequential (see Build Ordering).
**Primary edit site:**
`findings/packFindingScanners/springClassicSoap/jaxWsScanner.ts` (NOTE: the spec text
says `springClassicSoap/jaxWsScanner.ts` — the ACTUAL path on HEAD is under
`findings/packFindingScanners/`, confirmed).

> CAUTION: Build on `f33b44a`; ADD/EXTEND only. REUSE the surrounding `@WebService` /
> `@WebMethod` extraction (`WEB_SERVICE_ARGS_REGEX`, `WEB_METHOD_REGEX`, the wrapper /
> name regexes) — do NOT fork the scanner. ONLY widen the declaration regex. No
> `discovery-service/src/**` edits during an in-flight run.

- [x] 5.0 Complete the JAX-WS interface-SEI fix
  - [x] 5.1 Write 2–8 focused Jest tests FIRST
    - A `@WebService`-annotated `interface X { @WebMethod … }` SEI is detected (today
      only `class` declarations are).
    - A `@WebService` `class` SEI is STILL detected (no regression).
    - The existing `@WebMethod` / `@RequestWrapper` / `@ResponseWrapper` extraction
      still populates operations on the interface form.
    - Add to existing `springClassicSoapJaxWsScanner.test.ts`.
  - [x] 5.2 Widen `CLASS_DECL_REGEX`
    - In `jaxWsScanner.ts:73-74` change the `\bclass\s+…` declaration regex to ALSO
      match `interface` (e.g. `\b(?:class|interface)\s+…`); leave the
      `class`-keyword-anchored offset logic (`indexOf('class', cm.index)`, `:221`)
      working for both (anchor on the matched keyword, not the literal `'class'`).
    - Confirm `extractClassBody` / `collectClassAnnotationsBlock` / the `@WebMethod`
      loop all behave for an `interface` body.
  - [x] 5.3 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY `springClassicSoapJaxWsScanner.test.ts` (incl. the 5.1 additions).
    - Confirm offline Jest green. Do NOT run the entire suite.

**Acceptance Criteria:**
- The 2–8 tests from 5.1 pass (offline Jest green).
- `@WebService` interface-declared SEIs are detected; `class` SEIs unregressed;
  surrounding `@WebService`/`@WebMethod` extraction reused, not forked.

---

### Surface 6 — Close `TODO(oracle-W1)`: align the two `extractHttpMethod` mirrors

#### Task Group 6: Port both single-value mirrors to W1's plural fan-out, then delete the retained helper
**Dependencies:** Task Group 1 (the W1 plural helpers + endpoint identity must be
settled; TG1 also touches `springClassic/index.ts`, so TG6 sequences after it).
**Primary edit sites:**
`frameworkAdapters/springClassic/endpointDataEffectResolver.ts`,
`frameworkAdapters/springBoot/index.ts`, and the retained single-value helper +
`TODO(oracle-W1)` block in `frameworkAdapters/springClassic/index.ts`.

> CAUTION: Build on `f33b44a`; ADD/EXTEND only. **W1 (the multi-verb/multi-path
> fan-out) is ALREADY committed — this group EXTENDS it to the mirrors, it does NOT
> redo W1.** REUSE W1's `extractHttpMethods` / `extractMethodPaths` / `splitBraceList`
> — do NOT re-implement them. Removing the retained single-value
> `extractHttpMethod`/`extractMethodPath` (`springClassic/index.ts:264-288`) + its
> `TODO(oracle-W1)` comment (`:251-263`) is a DELETION of now-dead code ONLY ONCE
> both mirrors are on the plural path — verify no other caller remains first. No
> `discovery-service/src/**` edits during an in-flight run.

- [x] 6.0 Complete the W1 mirror alignment + dead-helper removal
  - [x] 6.1 Write 2–8 focused Jest tests FIRST
    - `endpointDataEffectResolver`: a `@RequestMapping(method={GET,POST})` and/or
      `@GetMapping({"/a","/b"})` mapping attaches its data-effect edges to EVERY
      (verb × path) variant's `endpointName` (not just the first) — so Spec #1's
      edges align with the fanned-out endpoint set.
    - `springBoot/index.ts`: the Spring-Boot adapter fans out an endpoint per
      (verb × path) identically to Spring-Classic.
    - Single-verb / single-path mapping still yields exactly one edge/endpoint
      (no behaviour change for the common case).
    - Add to existing `endpointDataEffectResolver.test.ts` (+ a
      `springBootAdapter`-targeted test, e.g. add to `springBootAdapterEnrichments.test.ts`).
  - [x] 6.2 Port `endpointDataEffectResolver.ts` to the plural fan-out
    - Replace the single-value `extractHttpMethod(m)` (`:367`) + `extractMethodPath(m)`
      (`:383`) usage in `endpointNameFor` (`:393`) with the plural shape so a
      multi-verb/multi-path mapping produces one `endpointName` per (verb × path) and
      the resolved/unresolved edges fan out across all of them (mirror W1's
      `extractHttpMethods`/`extractMethodPaths`; this file currently consumes a
      `FunctionIR`, so add `FunctionIR`-taking plural variants or adapt the W1 helpers).
  - [x] 6.3 Port `springBoot/index.ts` to the plural fan-out
    - Replace `extractHttpMethod(annotations)` (`:284`) + `extractMethodPath`
      (`:300`) with the plural shape and fan out the endpoint emission per
      (verb × path) exactly as `springClassic/index.ts` `processController` does
      (`:529-555`).
  - [x] 6.4 Remove the retained single-value helper + `TODO(oracle-W1)`
    - Once BOTH mirrors are on the plural path AND no other caller of the retained
      `springClassic/index.ts` `extractHttpMethod`/`extractMethodPath` (`:264-288`)
      remains, DELETE them and the `TODO(oracle-W1)` block (`:251-263`).
  - [x] 6.5 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY the 6.1 tests (`endpointDataEffectResolver.test.ts` +
      `springBootAdapterEnrichments.test.ts`). Optionally also re-run
      `springClassicMultiMethodPath.w1.test.ts` to confirm W1 itself is unregressed.
    - Confirm offline Jest green. Do NOT run the entire suite.

**Acceptance Criteria:**
- The 2–8 tests from 6.1 pass (offline Jest green).
- Both mirrors fan out data-effect edges / endpoints to EVERY (verb × path) variant;
  single-mapping common case unchanged.
- The retained single-value helper + `TODO(oracle-W1)` are removed; W1 unregressed.

---

### Surface 7 — Deferred-surface Findings + gap-fill prompt update

#### Task Group 7: GraphQL / gRPC / WebSocket-STOMP / Spring-Batch presence Findings + prompt MISSES update
**Dependencies:** Task Groups 1–6 (the now-covered surfaces must exist before the
prompt is told to stop re-emitting them). Shares `emissionSources.ts` with Specs #1/#3.
**Primary edit sites:** `findings/emissionSources.ts` (new sentinel + builder),
the scanner that observes the surfaces (emit via `findingEmitter`),
`prompts/frameworks/spring-classic.md` (gap-fill MISSES note).

> CAUTION: Build on `f33b44a`; ADD/EXTEND only. A NEW `EvidenceGapType` sentinel IS
> required (no existing member fits "deferred inbound surface present, not modelled")
> — add it to the union (`emissionSources.ts:447-468`) NEXT TO
> `possible_entity_collision`, and a `build*` helper modelled on
> `buildNonDeterministicEndpointFinding` (`:723`). REUSE the `findingEmitter`
> singleton (`FindingEmitter.ts:548`) — do NOT add a new emission path. Emit a
> PRESENCE finding only — do NOT model these surfaces. Non-Java stacks + Actuator
> endpoints are fully OUT (NO finding). The prompt edit ADDS a "now covered — do NOT
> re-emit" note for the TG1–TG6 surfaces (the current MISSES list does not even
> mention them) consistent with the existing "What the adapter already catches" +
> HARD-RULE de-dup framing. No `discovery-service/src/**` edits during an in-flight run.

- [x] 7.0 Complete deferred-surface findings + prompt update
  - [x] 7.1 Write 2–8 focused Jest tests FIRST
    - Observing `@QueryMapping` / a GraphQL schema emits ONE deferred-surface
      presence finding carrying the new sentinel — and NO endpoint/interface
      candidate (not modelled).
    - gRPC (`.proto` / gRPC stub), WebSocket-STOMP (`@MessageMapping` / STOMP), and a
      Spring-Batch `Job`/`Step` each emit the presence finding.
    - Actuator + a non-Java stack emit NO finding (negative case).
    - The new sentinel is a member of `EvidenceGapType` and the builder returns the
      expected `findingType`/`category`/`gapType` shape.
    - Add to existing `findingsEmissionSources.test.ts` (sentinel/builder shape) +
      a NEW `springClassicDeferredSurfaces.test.ts` (observation → emission).
  - [x] 7.2 Add the deferred-surface sentinel + builder
    - Add the new member to the `EvidenceGapType` union (`emissionSources.ts:447-468`)
      next to `possible_entity_collision`.
    - Add `buildDeferredSurfacePresentFinding(...)` modelled on
      `buildNonDeterministicEndpointFinding` (`:723`): `findingType: 'evidence_gap'`,
      a `migration_risk` category, `severity` advisory, `detailJson.gapType` = the new
      sentinel, carrying which surface (GraphQL/gRPC/STOMP/Spring-Batch) + file path.
  - [x] 7.3 Observe the surfaces + emit (presence only)
    - Where the scanners run, detect GraphQL (`@QueryMapping` / GraphQL schema), gRPC
      (`.proto` / gRPC stub), WebSocket-STOMP (`@MessageMapping` / STOMP), Spring-Batch
      (`Job`/`Step`) AS ENTRY POINTS and emit ONE presence finding each via
      `findingEmitter` — NEVER a candidate, NEVER a silent drop. Skip Actuator +
      non-Java stacks entirely.
  - [x] 7.4 Update the gap-fill prompt MISSES list
    - In `prompts/frameworks/spring-classic.md` ADD a "now covered by the adapter — do
      NOT re-emit" note listing JAX-RS / servlets / `web.xml` / WebFlux RouterFunction /
      meta-annotations / inherited controllers / JAX-WS interfaces, consistent with the
      "What the adapter already catches" section (`:8-38`) + the HARD-RULE de-dup
      framing (`:40-90`), so the LLM does not re-emit duplicates of what the adapter
      now catches.
  - [x] 7.5 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY the 7.1 tests (`findingsEmissionSources.test.ts` additions +
      `springClassicDeferredSurfaces.test.ts`).
    - Confirm offline Jest green. Do NOT run the entire suite.

**Acceptance Criteria:**
- The 2–8 tests from 7.1 pass (offline Jest green).
- GraphQL / gRPC / WebSocket-STOMP / Spring-Batch entry points each emit a presence
  finding (new sentinel) and are NOT modelled; Actuator + non-Java emit nothing.
- The gap-fill prompt tells the LLM the TG1–TG6 surfaces are now adapter-covered;
  no save-back/AMS change.

---

## Phase-2 Build Ordering & File-Overlap

**Position:** Spec **#4 of 6** in the Phase-2 "oracle perfection" program. Built
**STRICTLY SEQUENTIALLY after Specs #1–#3** (committed on HEAD `f33b44a`) — NOT in
parallel — and **EXTENDS the already-merged W1** multi-verb/multi-path fan-out
(`extractHttpMethods`/`extractMethodPaths`/`splitBraceList` on HEAD). Do NOT redo W1.

**Why this spec is sequential after #1–#3 (file overlap is the reason):**
- `springClassic/index.ts` (PRIMARY edit site) — shared with Spec #1
  (response-contract / endpoint→data-effect scanner). This spec EXTENDS #1's committed
  adapter (`processController` / `makeCandidate`). Building before #1 would fork/clobber it.
- `astUtils.ts` (Java annotation extraction) — shared with Spec #1; the
  meta-annotation/FQN matcher builds on #1's committed extraction shape.
- `prompts/frameworks/spring-classic.md` — shared with Spec #1; both adjust its
  "already catches" / "MISSES" lists.
- `emissionSources.ts` (finding sentinel registry) — shared with Specs #1/#3; the new
  deferred-surface sentinel sits next to #3's `non_deterministic_endpoint` /
  `possible_entity_collision` and W4's `scanner_failed`.

**Intra-spec group ordering (shared-file collisions inside THIS spec):**
1. **Group 1 FIRST** — it edits BOTH the heaviest shared files (`springClassic/index.ts`
   + `astUtils.ts`) and lands the generalised matcher, the `classIndex`-threaded
   `processController`, and the discriminator/input fields that Groups 2/4 reuse.
2. **Groups 2, 3, 4** — new detectors that hang off Group 1's emission shape.
   - Group 2 (JAX-RS) + Group 4 (WebFlux) edit `springClassic/index.ts` → order after Group 1.
   - Group 3 (servlets) edits `springClassic/index.ts` AND
     `springClassicFindingScanner.ts` (the latter shared with Spec #3 / W4 — extend
     `scanWebXmlPresence`, keep the `web_xml_present` finding).
3. **Group 5 (JAX-WS interface SEI)** — isolated file
   (`springClassicSoap/jaxWsScanner.ts`); can run any time after the shared-file groups,
   placed here to keep the build strictly sequential.
4. **Group 6 (close `TODO(oracle-W1)`)** — EXTENDS W1; edits
   `endpointDataEffectResolver.ts` + `springBoot/index.ts` and DELETES the retained
   single-value helper + `TODO` in `springClassic/index.ts`. Runs after Group 1 (which
   also touches `springClassic/index.ts` and settles endpoint identity). Does NOT redo W1.
5. **Group 7 LAST** — the prompt MISSES note must follow the TG1–TG6 coverage it
   describes; the new `emissionSources.ts` sentinel lands alongside Specs #1/#3's.

**Net layering:** discovery-service ONLY. New/extended detectors under
`extensionPacks/frameworkAdapters/springClassic/` (JAX-RS, servlet/`web.xml`, WebFlux
RouterFunction), meta-annotation + inherited-controller resolution in `astUtils.ts` /
the adapter, the JAX-WS interface-SEI fix in `springClassicSoap/jaxWsScanner.ts`, the
servlet-mapping URL extraction in `springClassicFindingScanner.ts`, the two
`extractHttpMethod` mirror alignments, the deferred-surface findings via
`FindingEmitter` / `emissionSources.ts`, and the gap-fill prompt update. NO AMS schema
change, NO save-back change, NO Liquibase, NO meta-model reference-doc edit, NO
frontend change beyond existing rendering.

**Standing constraints (every group):** deterministic, no LLM in the core path; ADD /
EXTEND on `f33b44a` only (do NOT revert); reuse — never fork — the existing
endpoint/interface `makeCandidate` emission + save-back, `astUtils.ts` extraction, the
SOAP scanners, and W1's plural helpers; parse brace-lists via `splitBraceList` (do NOT
refactor `AnnotationIR` to array args); do NOT edit `discovery-service/src/**` during
an in-flight discovery run (`tsx watch` auto-reload kills runs).

## Execution Order

1. Task Group 1 — Meta-annotation/FQN matcher + inherited controllers + discriminators
2. Task Group 2 — JAX-RS detector
3. Task Group 3 — Servlet / `web.xml` / `@WebServlet` detector
4. Task Group 4 — WebFlux `RouterFunction` detector
5. Task Group 5 — JAX-WS interface-SEI fix
6. Task Group 6 — Close `TODO(oracle-W1)` (align both mirrors, delete retained helper)
7. Task Group 7 — Deferred-surface Findings + gap-fill prompt update
