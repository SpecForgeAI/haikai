# Specification: Inbound Surface Completeness for Discovery (Java-era classic stacks)

## Goal
Make discovery detect EVERY inbound entry point the runtime harness currently cannot see — JAX-RS, raw servlets / `web.xml` / `@WebServlet`, WebFlux `RouterFunction` routes, meta-annotated and fully-qualified mapping annotations, inherited base-controller mappings, and JAX-WS interface-declared SEIs — deterministically, flowing each through the EXISTING `endpoints`/`interfaces` candidate emission + save-back path so no endpoint is silently never tested. Spec #4 of 6 in the Phase-2 "oracle perfection" program; built strictly after Specs #1–#3 (committed on HEAD `f33b44a`) and extending the already-merged W1 multi-verb/multi-path fan-out.

## User Stories
- As a migration analyst, I want JAX-RS, servlet, WebFlux-functional, meta-annotated, inherited-controller, and JAX-WS-interface entry points to appear as endpoint/interface candidates, so that the runtime equivalence harness exercises them instead of "proving equivalence" with an untested hole.
- As the runtime harness, I want same-path+verb endpoint variants that differ only by content-type / header / param kept DISTINCT, plus captured `@RequestParam`/`@RequestHeader` inputs, so that I test each variant correctly and can vary request shape when generating probes.
- As a reviewer, I want a deferred entry-point surface (GraphQL / gRPC / WebSocket-STOMP / Spring Batch) recorded as a Finding when observed, so that its presence is never a silent drop.

## Specific Requirements

**Detect JAX-RS resources (NEW detector)**
- Detect `@Path` at class and/or method level; method verbs `@GET`/`@POST`/`@PUT`/`@DELETE`/`@HEAD`/`@OPTIONS`; both `javax.ws.rs.*` and `jakarta.ws.rs.*` (matched per the FQN/simple-name resolution below).
- Compose the full path from class-level `@Path` + method-level `@Path`, mirroring the existing `composeFullPath(basePath, methodPath)` shape.
- Map `@Produces`/`@Consumes` onto the same discriminator fields and `@QueryParam`/`@HeaderParam`/`@PathParam` onto the same input fields as the Spring-MVC path (see discriminators requirement).
- Emit via the existing `makeCandidate('interfaces'|'endpoints', …)` shape (`controllerType` = the JAX-RS resource flavour); do NOT fork a new emission path.

**Detect raw servlets + `web.xml` servlet-mappings + `@WebServlet` (NEW detector + `web.xml` extension)**
- Extend `scanWebXmlPresence` in `springClassicFindingScanner.ts` (filename-only today, ~L1009) to PARSE `<servlet>` / `<servlet-mapping>` into (servlet-class → url-pattern) and feed endpoint emission; KEEP the existing `web_xml_present` presence finding.
- Detect `@WebServlet(urlPatterns=…/value=…)`-annotated classes and emit an endpoint per url-pattern.
- Detect `extends HttpServlet` classes with `doGet`/`doPost`/`doPut`/`doDelete`/`service` handlers; infer the verb from the `doXxx` method name (`service` = all verbs, surfaced consistently with the existing default-verb convention).
- Emit endpoint + interface candidates via the existing `makeCandidate` shape (`controllerType` = the servlet flavour).

**Detect WebFlux `RouterFunction` functional routes (NEW detector)**
- Detect the functional routing DSL (`RouterFunctions.route()…GET(path, handler)` / `.POST(…)` / `RequestPredicates.*`) and emit an endpoint per (predicate-verb × route-path).
- Emit endpoint + interface candidates via the existing `makeCandidate` shape; reuse the W1 plural verb/path helpers where a predicate yields multiple verbs/paths.

**Generalise the mapping-annotation matcher (meta-annotation + fully-qualified)**
- Replace the simple-name-only match against the fixed 6-name set (`springClassic/index.ts:55-72`) with a generalised matcher: simple-name, fully-qualified (`@org.springframework.web.bind.annotation.GetMapping`, matched on the final simple-name segment), AND meta-annotated forms all resolve.
- For a meta-annotated annotation (`@ApiV2Get` meta-annotated with `@GetMapping` ⇒ GET), follow the custom annotation's OWN declared annotations one or more levels to a known mapping meta-annotation; treat the outer annotation as that mapping, carrying any path/verb args the outer annotation declares, else those of the meta-annotation.
- Resolution is BOUNDED (cap meta-annotation follow depth) and CYCLE-GUARDED, deterministic. Extend the annotation extraction/matching in `astUtils.ts` (which records `{ name, arguments, line }` from the raw simple name, ~L296-323) and the adapter's name-comparison.

**Walk inherited / abstract base-controller mappings**
- For a controller class, walk its `cls.extends` chain (bounded depth, cycle-guarded) to (a) pick up a class-level `@RequestMapping` base path declared on an abstract/base controller and (b) include handler-method mappings inherited from base classes when the concrete controller does not override them.
- MIRROR the existing `@MappedSuperclass` field-inheritance walk (`collectMappedSuperclassFields`, `springClassic/index.ts:153-175`, using the `ClassIndex` + `visited` cycle-guard); reuse that walk's shape, do NOT invent a new traversal. Thread the existing `classIndex` into `processController` (as `processJpaEntity` already receives it).
- The composed full path uses the most-derived class-level base path when present, else the inherited one.

**Fix JAX-WS SEIs declared as a Java `interface`**
- Widen `CLASS_DECL_REGEX` in `springClassicSoap/jaxWsScanner.ts:73` (`…\bclass\s+…`, `class`-only today) to ALSO match `interface`, so a `@WebService`-annotated Service Endpoint Interface declared `interface X { … }` is detected, not only `class` declarations.
- REUSE the surrounding `@WebService` / `@WebMethod` extraction (the file's existing regexes); do NOT fork the scanner.

**Endpoint discriminators + request-shaping inputs (anti-collapse)**
- Capture `consumes`/`produces`/`headers`/`params` discriminators on the endpoint candidate `data` and FOLD a stable, normalised rendering of them into the candidate `name` (today `"${verb} ${path}"`), so two mappings on the SAME path+verb that differ only by content-type / header / param stay DISTINCT endpoints under the `(type, name, filePath)` identity the LLM-gap-fill dedup and save-back rely on.
- Capture `@RequestParam`/`@RequestHeader` inputs (name, type, required, default) on the endpoint candidate so the harness can VARY them when generating probes; JAX-RS `@QueryParam`/`@HeaderParam`/`@PathParam` map onto the same input fields.
- Parse brace-list args (`consumes`/`produces` arrays) from the existing raw string via the W1 `splitBraceList` idiom; do NOT refactor `AnnotationIR` to array-typed args (consistent with W1's scope note).

**Close `TODO(oracle-W1)` — align the two `extractHttpMethod` mirrors**
- Port `springClassic/endpointDataEffectResolver.ts` `extractHttpMethod(m: FunctionIR)` (L367) + its `extractMethodPath` to W1's plural multi-verb/multi-path fan-out, so a multi-verb/multi-path mapping attaches its data-effect edges to EVERY (verb × path) variant (not just the first), keeping Spec #1's edges aligned with the fanned-out endpoint set.
- Port `springBoot/index.ts` `extractHttpMethod(annotations)` (L284) + `extractMethodPath` to the same plural shape so the Spring-Boot adapter fans out identically.
- Once both mirrors are on the plural path, REMOVE the retained single-value `extractHttpMethod`/`extractMethodPath` in `springClassic/index.ts` (kept ONLY for these mirrors, per the `TODO(oracle-W1)` at L251-263). Reuse W1's `extractHttpMethods`/`extractMethodPaths`/`splitBraceList` — do NOT redo W1.

**Candidate shape unchanged (no save-back / AMS change)**
- Every new detector emits the EXACT existing shape: interface candidate `makeCandidate('interfaces', <className>, filePath, { basePath, controllerType, className, packageName }, runId)` and endpoint candidate `makeCandidate('endpoints', <name>, filePath, data, runId, interfaceCandidate.id)` with `data` carrying `httpMethod`, `fullPath`, `methodName`, `controllerClassName`, `returnType` (+ the new discriminators/inputs + `requestBodyType`/`responseType` where resolvable).
- Default `confidence: 0.9` + `status: 'proposed'` + `_addedBy: 'spring-classic-adapter'` reused unchanged (verified at `springClassic/index.ts:419-444` + `:462-558`); save-back resolves these with NO AMS or save-back change.
- Populate `controllerType` so the existing downstream `interfaces` drop-list filter (`springConfigKind`/`interfaceSubtype`) does NOT wrongly drop a real external endpoint container.

**Deferred surfaces → Finding, not drop (NEW deferred-surface sentinel)**
- When the scanners observe GraphQL (`@QueryMapping` / a GraphQL schema), gRPC (a `.proto` / gRPC stub), WebSocket-STOMP (`@MessageMapping` / STOMP), or a Spring Batch `Job`/`Step` AS AN ENTRY POINT, emit a "surface present, not modelled" Finding — NEVER a silent drop; do NOT model them.
- Add a deferred-surface gap sentinel to the `EvidenceGapType` union in `emissionSources.ts` (next to `scanner_failed`/`non_deterministic_endpoint`/`possible_entity_collision`, L466-468) and reuse the existing evidence-gap builder pattern via `FindingEmitter` (`findingEmitter` singleton). Non-Java stacks and Actuator endpoints are fully OUT (no Finding).

**LLM gap-fill stays the safety net (prompt update)**
- The deterministic core has NO LLM. UPDATE the Spring-Classic gap-fill prompt (`prompts/frameworks/spring-classic.md`) to ADD a short "now covered by the adapter — do NOT re-emit" note for JAX-RS / servlets / `web.xml` / WebFlux RouterFunction / meta-annotations / inherited controllers / JAX-WS interfaces, consistent with the existing "What the adapter already catches" section and the HARD-RULE de-dup framing, so the LLM does not re-emit duplicates of what the adapter now catches.

## Visual Design
No visual assets provided (`planning/visuals/` is empty). This is a discovery-service detection/extraction change with NO new frontend surface — newly-detected endpoints/interfaces render through the EXISTING Candidates stream and endpoint/interface rows. No mockups are required.

## Existing Code to Leverage

**Spring-Classic framework adapter (PRIMARY extend site) — `springClassic/index.ts`**
- Mapping-annotation constants (`CONTROLLER_ANNOTATIONS`, `HTTP_METHOD_ANNOTATIONS`, `ENDPOINT_ANNOTATIONS`, L55-72) — the fixed 6-name set to generalise.
- `processController` (L462) + `controllerToDtos` + `makeCandidate` (L423, `confidence: 0.9`, `_addedBy: 'spring-classic-adapter'`) — the endpoint/interface emission every new surface must reuse, NOT fork.
- `collectMappedSuperclassFields` (L153-175) + `buildClassIndex`/`ClassIndex` (L145-151) — the `cls.extends` walk shape (with `visited` cycle-guard) to mirror for the inherited-controller walk; `processController` is called at L2004 and must receive the `classIndex` as `processJpaEntity` (L2005) already does.
- W1's plural `extractHttpMethods` (L354) / `extractMethodPaths` (L392) / `splitBraceList` (L319) — already on HEAD; new detectors and both mirror fixes reuse them. The retained single-value `extractHttpMethod`/`extractMethodPath` (L264-288) carry the `TODO(oracle-W1)` (L251) to close, then delete.

**Java annotation extraction (meta-annotation / FQN matcher site) — `languageExtractors/java/astUtils.ts`**
- Records each annotation as `{ name: nameNode.text, arguments, line }` from the raw simple name (~L296-323). Extend so the matcher resolves simple-name, fully-qualified (final-segment match), and meta-annotated mapping annotations (bounded depth, cycle-guarded).

**JAX-WS SOAP scanner (interface-SEI fix) — `springClassicSoap/jaxWsScanner.ts`**
- `CLASS_DECL_REGEX` (L73) matches `class` only. Widen to also match `interface`; reuse the surrounding `@WebService`/`@WebMethod` extraction (`WEB_SERVICE_ARGS_REGEX`, `WEB_METHOD_REGEX`, the wrapper/name regexes) — do NOT fork.

**`web.xml` detection (extend to URL extraction) — `springClassicFindingScanner.ts`**
- `scanWebXmlPresence` (~L1009) detects `web.xml` by filename only. Extend to parse `<servlet>`/`<servlet-mapping>` → (servlet-class → url-pattern) and feed endpoint emission; keep the existing `web_xml_present` presence finding (L1027).

**The two `extractHttpMethod` mirrors (Q5) + the gap-fill prompt (Q6)**
- `springClassic/endpointDataEffectResolver.ts` `extractHttpMethod(m: FunctionIR)` (L367) + `extractMethodPath` (L383), and `springBoot/index.ts` `extractHttpMethod(annotations)` (L284) + `extractMethodPath` (L300) — align both with the plural fan-out.
- `prompts/frameworks/spring-classic.md` — the "What the adapter already catches" / "What the adapter MISSES" lists to update.

**Finding emission (Q7 deferred-surface findings) — `findings/FindingEmitter.ts` + `emissionSources.ts`**
- `findingEmitter` singleton (`FindingEmitter.ts:548`) + the `EvidenceGapType` union (`emissionSources.ts:447-468`, shared with Specs #1/#3) — add the new deferred-surface sentinel + builder next to the existing ones and emit the "surface present, not modelled" Findings for GraphQL/gRPC/STOMP/Spring-Batch.

## Out of Scope
- NO new meta-model entity types — `endpoints`/`interfaces` already exist (architecture-context-explainer L14-15); NO AMS schema change; NO Liquibase changeset; NO meta-model reference-doc edit; save-back resolves the endpoint/interface candidate shapes unchanged.
- GraphQL / gRPC / WebSocket-STOMP / Spring Batch as entry points — FULL modelling deferred (emit a presence Finding only).
- Non-Java stacks; Actuator endpoints — fully out, NO Finding.
- NO LLM in the deterministic core path (the gap-fill LLM stage remains the existing residual safety net; only its prompt MISSES-list is updated).
- NO refactor of `AnnotationIR` to array-typed args (parse the existing raw string via W1's `splitBraceList`).
- NO frontend work beyond the existing Candidates / endpoint / interface rendering.
- Do NOT redo W1 — extend it and close its `TODO(oracle-W1)`.

## Phase-2 Build Ordering & File-Overlap

**Position:** Spec **#4 of 6** in the Phase-2 "oracle perfection" program. **Built STRICTLY SEQUENTIALLY after Specs #1–#3** (committed on HEAD `f33b44a`) — NOT in parallel — and EXTENDS the already-merged **W1** quick-win (multi-verb/multi-path endpoint fan-out on HEAD).

**Why sequential (file overlap is the reason, not a nicety):**
- **`springClassic/index.ts` (the primary edit site)** is shared with Spec **#1** (the response-contract / endpoint→data-effect scanner). This spec EXTENDS Spec #1's committed adapter code — new surface detectors hang off the same `processController` / `makeCandidate` emission. Building before #1 would fork or clobber that file.
- **`astUtils.ts`** (Java annotation extraction) is shared with Spec **#1**. The meta-annotation / fully-qualified-name matcher extension here builds on #1's committed extraction shape.
- **The Spring-Classic gap-fill prompt (`spring-classic.md`)** is shared with Spec **#1** — both adjust its "already catches" / "MISSES" lists. Sequencing avoids two specs editing the same prompt out of order.
- **`emissionSources.ts`** (finding sentinel registry / emission helpers) is shared with Specs **#1/#3** — reused here for the deferred-surface presence findings (the new sentinel sits next to #3's `non_deterministic_endpoint` / `possible_entity_collision` and W4's `scanner_failed`).

**Relationship to W1 (already on HEAD):** EXTEND the merged W1 fan-out (`extractHttpMethods` / `extractMethodPaths` / `splitBraceList`) and CLOSE its `TODO(oracle-W1)` (`springClassic/index.ts:251`) by aligning the two single-value `extractHttpMethod` mirrors (`endpointDataEffectResolver.ts:367`, `springBoot/index.ts:284`) with the plural fan-out, then delete the retained single-value helper. Do NOT redo W1.

**Net layering:** discovery-service ONLY. New/extended scanners under `extensionPacks/frameworkAdapters/springClassic/` (+ the JAX-RS detector, the servlet/`web.xml` detector, the WebFlux `RouterFunction` detector), meta-annotation + inherited-controller resolution in `astUtils.ts` / the adapter, the JAX-WS interface-SEI fix in `springClassicSoap/jaxWsScanner.ts`, the servlet-mapping URL extraction in `springClassicFindingScanner.ts`, the two `extractHttpMethod` mirror alignments, the deferred-surface findings via `FindingEmitter` / `emissionSources.ts`, and the gap-fill prompt update. NO AMS schema change, NO save-back change, NO frontend change beyond existing rendering. Constraints: deterministic; do NOT edit `discovery-service/src/**` during an in-flight run (`tsx watch` auto-reload kills runs); reuse (don't fork) the existing endpoint/interface candidate emission + save-back, `astUtils.ts` extraction, and the SOAP scanners. Build on `f33b44a`; ADD/EXTEND only.
