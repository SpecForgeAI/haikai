# Spec Requirements: Inbound Surface Completeness for Discovery (Java-era classic stacks) — HAIKAI Phase-2 Spec #4 of 6

## Initial Description

Spec #4 of 6 in the HAIKAI Phase-2 "oracle perfection" program (a like-for-like
API/DB migration tool). North-star reference: memory
`project_migration_ultimate_goal`. The runtime API harness
(`api-migration-validation-service`) remains the equivalence VERIFIER — it fires
the same request at the legacy and migrated service and diffs the responses. But
the harness can only test endpoints that **discovery actually finds**: an inbound
surface that discovery never emits as an `endpoints` candidate is an endpoint the
harness silently never exercises, so the migration is "proven equivalent" with a
hole in it.

**Problem / goal:** Discovery's inbound-endpoint detection keys off a fixed
6-name Spring-MVC annotation set (`GetMapping`, `PostMapping`, `PutMapping`,
`DeleteMapping`, `PatchMapping`, `RequestMapping`) matched by **simple name**
(`springClassic/index.ts:51-68`). Whole classes of inbound surface common in the
Java-8-era migration source are therefore INVISIBLE. This spec makes discovery
detect ALL of them deterministically, flowing each through the EXISTING
`endpoints`/`interfaces` candidate emission + save-back path. No new meta-model
entity types are introduced (`endpoints`/`interfaces` already exist —
`gateway/src/config/prompts/shared/architecture-context-explainer.md` lines 14-15).

**Relationship to the program (build order is load-bearing):** this spec is built
STRICTLY SEQUENTIALLY after Specs #1–#3 and EXTENDS the already-merged **W1**
quick-win (multi-verb / multi-path endpoint fan-out on HEAD). It heavily shares
the `springClassic` framework adapter + `astUtils.ts` + the Spring-Classic
gap-fill prompt with Spec #1 (the endpoint→data-effect / response-contract
scanner) and `emissionSources.ts` with Specs #1/#3, so it builds AFTER them to
extend their committed code rather than collide with it (see the dedicated
"Phase-2 Build Ordering & File-Overlap" section).

**Pre-agreed decisions (user pre-approved; autonomous build, NOT open for
re-litigation):** The user has explicitly said to STOP defaulting to cuts —
so all listed inbound surfaces are IN for v1. Decisions are baked into the
Functional Requirements and Scope Boundaries below; this document is
decision-complete and no clarifying questions remain.

## Requirements Discussion

This spec was authored decision-complete from a pre-approved brief. The
"questions" below are recorded as resolved decision points (each with the FINAL,
user-approved answer) so the spec-writer has the full rationale, matching the
sibling-spec format.

### First Round Questions

**Q1 — Which inbound surfaces are in scope for v1?**
**Answer:** ALL of the audited-missed surfaces, detected deterministically as
`endpoints`/`interfaces` candidates flowing through the existing candidate +
save-back path (NO new meta-model entity types):
  1. **JAX-RS resources** — `@Path` at class and/or method level; method verbs
     `@GET`/`@POST`/`@PUT`/`@DELETE`/`@HEAD`/`@OPTIONS`; `@Produces`/`@Consumes`
     as discriminators (see Q4). Both `javax.ws.rs.*` and `jakarta.ws.rs.*`.
  2. **Raw servlets + `web.xml` servlet-mappings + `@WebServlet`** — extend the
     filename-only `web.xml` detection to PARSE `<servlet>` / `<servlet-mapping>`
     into (servlet-class → url-pattern) and emit an endpoint per url-pattern;
     detect `@WebServlet(urlPatterns=…/value=…)` annotated classes; detect
     `extends HttpServlet` classes with `doGet`/`doPost`/`doPut`/`doDelete`/
     `service` handlers (verb inferred from the `doXxx` method name).
  3. **WebFlux `RouterFunction` functional routes** — detect the functional
     routing DSL (`RouterFunctions.route()...GET(path, handler)` /
     `.POST(...)` / `RequestPredicates.*`) and emit an endpoint per
     (predicate-verb × route-path).
  4. **Meta-annotated / composed mapping annotations** — resolve a custom
     annotation's OWN annotations to detect a composite mapping
     (`@ApiV2Get` meta-annotated with `@GetMapping` ⇒ GET) (see Q2).
  5. **Inherited / abstract base-controller mappings** — walk `cls.extends` for a
     class-level `@RequestMapping` base path and inherited handler-method
     mappings, mirroring the existing `@MappedSuperclass` field walk (see Q3).
  6. **JAX-WS SEIs declared as a Java `interface`** — fix the SOAP scanner so a
     `@WebService` Service Endpoint Interface declared `interface X { … }` is
     detected, not only `class` declarations (see "Existing Code to Reference").

  All deterministic. Each surface is emitted as the SAME candidate shape the
  existing Spring-MVC path produces (Q-shape below), so save-back resolves them
  unchanged.

**Q2 — Meta-annotation resolution depth + fully-qualified annotation names**
**Answer:** When a handler/class annotation's simple name is NOT one of the known
mapping names, follow that annotation's OWN declared annotations one or more
levels to detect a known mapping meta-annotation underneath (`@ApiV2Get` →
`@GetMapping`), within the scanned set, and treat the outer annotation as that
mapping (carrying any path/verb args the outer annotation declares, else those of
the meta-annotation). ALSO accept fully-qualified annotation references
(`@org.springframework.web.bind.annotation.GetMapping`) by matching on the final
simple-name segment. This is a generalisation of the matcher: extend the
annotation extraction/matching in `astUtils.ts` (and the adapter's
name-comparison) so simple-name, fully-qualified, and meta-annotated forms all
resolve. Resolution is bounded (cap meta-annotation follow depth; guard against
annotation cycles) and deterministic.

**Q3 — Inherited / abstract base-controller mappings**
**Answer:** For a controller class, walk its `cls.extends` chain (bounded depth,
cycle-guarded) to (a) pick up a class-level `@RequestMapping` base path declared
on an abstract/base controller and (b) include handler-method mappings inherited
from base classes when the concrete controller does not override them. This
mirrors the EXISTING `@MappedSuperclass` JPA-field inheritance walk already in the
adapter — reuse that walk's shape; do not invent a new traversal idiom. The
composed full path uses the most-derived class-level base path when present, else
the inherited one.

**Q4 — Endpoint discriminators + request-shaping inputs**
**Answer:** Capture `consumes` / `produces` / `headers` / `params` discriminators
on the endpoint candidate and INCLUDE them in the endpoint IDENTITY, so two
mappings on the SAME path+verb that differ only by content-type / header / param
stay DISTINCT endpoints instead of collapsing. Concretely: extend the endpoint
candidate `data` with `consumes`/`produces`/`headers`/`params` fields and fold a
stable, normalised rendering of them into the candidate `name` (today
`"${verb} ${path}"`) so the (type, name, filePath) identity the LLM-gap-fill
dedup and save-back rely on keeps the variants separate. Also capture
`@RequestParam` / `@RequestHeader` inputs (name, type, required, default) on the
endpoint candidate so the harness can VARY them when generating probes. JAX-RS
`@Produces`/`@Consumes` and `@QueryParam`/`@HeaderParam`/`@PathParam` map onto the
same discriminator/input fields.

**Q5 — Closing the W1 mirror TODO**
**Answer:** Align the two single-value `extractHttpMethod` mirrors that W1
deliberately left untouched with W1's plural multi-method / multi-path handling,
closing `TODO(oracle-W1)` (`springClassic/index.ts:247`):
  - `springClassic/endpointDataEffectResolver.ts` `extractHttpMethod(m: FunctionIR)`
    (line 367) + its `extractMethodPath` — port to the plural fan-out so a
    multi-verb / multi-path mapping attaches its data-effect edges to EVERY
    (verb × path) variant (not just the first), keeping Spec #1's edges aligned
    with the now-fanned-out endpoint set.
  - `springBoot/index.ts` `extractHttpMethod(annotations)` (line 284) +
    `extractMethodPath` — port to the same plural shape so the Spring-Boot adapter
    fans out identically.
  Once both mirrors are on the plural path, the retained single-value helper in
  `springClassic/index.ts` (kept ONLY for these mirrors) can be removed.

**Q6 — Deterministic core; LLM stays the safety net (prompt update)**
**Answer:** The detection is fully DETERMINISTIC — no LLM in the core path. The
existing LLM gap-fill stage stays the residual safety net, BUT its Spring-Classic
"what the adapter MISSES" prompt list
(`discovery-service/src/services/prompts/frameworks/spring-classic.md`) must be
UPDATED to DROP the surfaces this spec now covers deterministically, so the LLM
does not re-emit duplicates of what the adapter now catches. (Today that prompt's
MISSES list does not even mention JAX-RS / servlets / WebFlux RouterFunction /
meta-annotations / inherited controllers / JAX-WS interfaces — so the practical
change is to ADD a short "now covered by the adapter — do NOT re-emit" note for
these, consistent with the existing "What the adapter already catches" section
and the HARD-RULE de-dup framing already in that file.)

**Q7 — Surfaces explicitly deferred (Finding, not full model)**
**Answer:** GraphQL, gRPC, WebSocket/STOMP, and Spring Batch AS ENTRY POINTS are
rare in the Spring-Classic→Boot target and are OUT of full modelling for v1. When
the scanners observe their presence (e.g. a `.proto`/gRPC stub, a GraphQL schema /
`@QueryMapping`, `@MessageMapping`/STOMP, a Spring Batch `Job`/`Step`), emit a
discovery FINDING noting the surface exists and was not modelled — never a silent
drop. Non-Java stacks and Actuator endpoints are fully out (no Finding).

**Q8 — Candidate shape the new detectors must produce (so save-back is unchanged)**
**Answer:** Every new detector emits the SAME shape the existing Spring-MVC path
already produces via `makeCandidate(...)` in `springClassic/index.ts`:
  - **Interface candidate:** `makeCandidate('interfaces', <className>, filePath,
    { basePath, controllerType, className, packageName }, runId)` — for JAX-RS the
    `controllerType` is the resource flavour, for servlets the servlet flavour,
    etc.; populated so the existing downstream `interfaces` filters
    (`springConfigKind`/`interfaceSubtype` drop-list) do NOT wrongly drop a real
    external endpoint container.
  - **Endpoint candidate:** `makeCandidate('endpoints', <name>, filePath, data,
    runId, interfaceCandidate.id)` where `data` carries
    `httpMethod`, `fullPath`, `methodName`, `controllerClassName`, `returnType`
    (+ the new `consumes`/`produces`/`headers`/`params` discriminators and
    `requestParams`/`requestHeaders` inputs from Q4, + `requestBodyType`/
    `responseType` where resolvable), parented to its interface candidate. The
    default `confidence: 0.9` + `status: 'proposed'` + `_addedBy:
    'spring-classic-adapter'` shape is reused unchanged.
  These are the shapes save-back already resolves; verified against the live
  emission at `springClassic/index.ts:419-440` (`makeCandidate`) and
  `:458-554` (`processController`). NO save-back / AMS change is required.

### Existing Code to Reference

**Confirmed reuse / extend targets (verified against HEAD):**

- **Spring-Classic framework adapter (PRIMARY extend site):**
  `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/index.ts`.
  - Mapping-annotation constants (`HTTP_METHOD_ANNOTATIONS`, `ENDPOINT_ANNOTATIONS`,
    `CONTROLLER_ANNOTATIONS`) at lines 51-68 — the fixed 6-name set to generalise.
  - `processController` (line 458) + `controllerToDtos` — the endpoint/interface
    emission to reuse for every new surface.
  - `makeCandidate` (line 419) — the exact candidate shape (`confidence: 0.9`,
    `_addedBy: 'spring-classic-adapter'`) all new detectors must produce.
  - W1's plural helpers `extractHttpMethods` (line 350) / `extractMethodPaths`
    and `splitBraceList` (line 315) — already on HEAD; new detectors and the
    mirror fixes reuse them. The retained single-value `extractHttpMethod`/
    `extractMethodPath` (lines 260-284) carry the `TODO(oracle-W1)` (line 247) to
    close.
- **Java annotation extraction (meta-annotation / FQN matcher site):**
  `discovery-service/src/services/extensionPacks/languageExtractors/java/astUtils.ts`
  — records each annotation as `{ name: nameNode.text, arguments, line }` using the
  raw simple name (≈ lines 296-310). Extend so the matcher resolves simple-name,
  fully-qualified, and meta-annotated mapping annotations.
- **JAX-WS SOAP scanner (interface-SEI fix):**
  `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/jaxWsScanner.ts`
  — `CLASS_DECL_REGEX` (line 73) is `/…\bclass\s+([A-Za-z_]\w*)\b/g` (matches
  `class` only). Widen to also match `interface` so a `@WebService`-annotated
  Service Endpoint Interface is detected. Reuse the surrounding `@WebService` /
  `@WebMethod` extraction (the file's existing regexes) — do NOT fork the scanner.
- **`web.xml` detection (extend to URL extraction):**
  `discovery-service/src/services/findings/packFindingScanners/springClassicFindingScanner.ts`
  — `scanWebXmlPresence` (≈ line 1005) currently detects `web.xml` by filename only,
  no servlet-mapping parse. Extend to parse `<servlet>` / `<servlet-mapping>` →
  (servlet-class → url-pattern) and feed endpoint emission. Keep the existing
  presence finding.
- **The two `extractHttpMethod` mirrors to align (Q5):**
  `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectResolver.ts`
  (`extractHttpMethod(m: FunctionIR)`, line 367) and
  `discovery-service/src/services/extensionPacks/frameworkAdapters/springBoot/index.ts`
  (`extractHttpMethod(annotations)`, line 284).
- **Gap-fill prompt to update (Q6):**
  `discovery-service/src/services/prompts/frameworks/spring-classic.md` — the
  "What the adapter already catches" / "What the adapter MISSES" lists.
- **Finding emission (Q7 deferred-surface findings):**
  `discovery-service/src/services/findings/FindingEmitter.ts` (`findingEmitter`
  singleton) + `emissionSources.ts` (shared with Specs #1/#3) — emit the
  "surface present, not modelled" findings for GraphQL/gRPC/STOMP/Spring-Batch.
- **Meta-model reference (read-only confirm):**
  `gateway/src/config/prompts/shared/architecture-context-explainer.md` —
  `endpoints` (line 15) and `interfaces` (line 14) already exist; NO new entity
  type, so NO reference-doc edit is required for this spec.

**Genuinely NEW work (no existing prior art):**
- A JAX-RS resource detector, a servlet / `web.xml` servlet-mapping / `@WebServlet`
  detector, and a WebFlux `RouterFunction` functional-route detector — none exist
  today. They are NEW detectors that REUSE the existing candidate-emission shape
  (`makeCandidate` / `processController` pattern) and the W1 plural verb/path
  helpers; they are NOT a new emission or save-back path.
- Meta-annotation / fully-qualified annotation resolution and the controller
  `extends`-chain walk are new logic layered onto `astUtils.ts` + the adapter
  (the `@MappedSuperclass` field walk is the closest prior art to mirror).

### Follow-up Questions

None. The brief was pre-approved and decision-complete; all eight decision points
above are resolved and user-approved. No open questions remain.

## Visual Assets

### Files Provided:

No visual assets provided. The `planning/visuals/` folder was created and is
empty. This is a discovery-service detection/extraction change with NO new
frontend surface — newly-detected endpoints/interfaces render through the
EXISTING Candidates stream and endpoint/interface rows. No mockups are required.

### Visual Insights:

Not applicable.

## Requirements Summary

### Functional Requirements

- **Detect ALL listed inbound surfaces** as `endpoints`/`interfaces` candidates,
  deterministically, flowing through the EXISTING candidate emission + save-back
  path (NO new meta-model entity types):
  - **JAX-RS** resources (`@Path` class/method, `@GET`/`@POST`/`@PUT`/`@DELETE`/
    `@HEAD`/`@OPTIONS`, `@Produces`/`@Consumes`, `@QueryParam`/`@HeaderParam`/
    `@PathParam`); both `javax.ws.rs.*` and `jakarta.ws.rs.*`.
  - **Raw servlets + `web.xml` servlet-mappings + `@WebServlet`**: parse
    `<servlet>`/`<servlet-mapping>` to (servlet-class → url-pattern) and emit an
    endpoint per url-pattern; detect `@WebServlet(urlPatterns/value)`; detect
    `extends HttpServlet` with `doGet`/`doPost`/`doPut`/`doDelete`/`service`
    (verb from the `doXxx` name).
  - **WebFlux `RouterFunction`** functional routes (`RouterFunctions.route()…`,
    `RequestPredicates.*`): emit an endpoint per (predicate-verb × route-path).
  - **Meta-annotated / composed mapping annotations** (`@ApiV2Get` → `@GetMapping`)
    via meta-annotation resolution; ALSO accept fully-qualified annotation names.
  - **Inherited / abstract base-controller mappings** via a bounded, cycle-guarded
    `cls.extends` walk for class-level `@RequestMapping` base paths + inherited
    handler mappings (mirroring the `@MappedSuperclass` field walk).
  - **JAX-WS SEIs declared as a Java `interface`** (widen the SOAP scanner's
    `class`-only declaration regex to include `interface`).
- **Endpoint discriminators + inputs (anti-collapse):** capture
  `consumes`/`produces`/`headers`/`params` and FOLD them into the endpoint
  identity (the candidate `name` + `data`) so same-path+verb variants stay
  DISTINCT; capture `@RequestParam`/`@RequestHeader` (and JAX-RS query/header/path
  param) inputs (name/type/required/default) on the endpoint candidate so the
  harness can vary them.
- **Meta-annotation resolution:** follow a custom annotation's own annotations
  (bounded depth, cycle-guarded) to a known mapping meta-annotation, and match
  fully-qualified annotation references by final simple-name segment — extend the
  `astUtils.ts` extraction + the adapter matcher.
- **Close `TODO(oracle-W1)`:** port `endpointDataEffectResolver.ts` and
  `springBoot/index.ts` `extractHttpMethod`/`extractMethodPath` to W1's plural
  multi-verb / multi-path fan-out so data-effect edges attach to EVERY variant and
  Spring-Boot fans out identically; then the retained single-value helper can be
  removed.
- **Candidate shape unchanged:** every detector emits the existing
  `makeCandidate('interfaces'|'endpoints', …)` shape (parented endpoint →
  interface; default `confidence: 0.9`; `_addedBy: 'spring-classic-adapter'`), so
  save-back resolves them with NO AMS or save-back change.
- **Deferred surfaces → Finding, not drop:** GraphQL / gRPC / WebSocket-STOMP /
  Spring Batch as entry points emit a "surface present, not modelled" Finding when
  observed; never a silent drop.
- **LLM gap-fill stays the safety net:** update the Spring-Classic gap-fill prompt
  ("MISSES" list) to mark the now-covered surfaces as adapter-covered so the LLM
  does not re-emit duplicates. No LLM in the deterministic core path.

### Reusability Opportunities

- Reuse `processController` + `controllerToDtos` + `makeCandidate` in
  `springClassic/index.ts` for every new surface's emission — do NOT fork a new
  emission or save-back path.
- Reuse W1's `extractHttpMethods` / `extractMethodPaths` / `splitBraceList`
  (already on HEAD) in the new detectors and the two mirror fixes.
- Mirror the existing `@MappedSuperclass` field-inheritance walk for the new
  controller `extends`-chain walk.
- Reuse the existing `@WebService` / `@WebMethod` extraction in
  `springClassicSoap/jaxWsScanner.ts`; only widen the declaration regex to include
  `interface`.
- Reuse the existing `web.xml` presence detection in
  `springClassicFindingScanner.ts`; only add servlet-mapping URL extraction.
- Reuse `FindingEmitter` (`findingEmitter`) + `emissionSources.ts` for the
  deferred-surface findings (shared with Specs #1/#3).
- Reuse the existing Candidates stream + endpoint/interface rendering on the
  frontend — no new UI.

### Scope Boundaries

**In Scope:**

- discovery-service detection/extraction for JAX-RS, raw servlets + `web.xml`
  servlet-mappings + `@WebServlet`, WebFlux `RouterFunction`, meta-annotated /
  fully-qualified mapping annotations, inherited / abstract base-controller
  mappings, and JAX-WS interface-declared SEIs.
- `consumes`/`produces`/`headers`/`params` discriminators folded into endpoint
  identity + `@RequestParam`/`@RequestHeader` (and JAX-RS equivalents) input
  capture.
- Closing `TODO(oracle-W1)`: align both `extractHttpMethod` mirrors
  (`endpointDataEffectResolver.ts`, `springBoot/index.ts`) with W1's plural
  fan-out.
- Updating the Spring-Classic gap-fill prompt to drop the now-covered surfaces.
- Deferred-surface presence Findings (GraphQL / gRPC / STOMP / Spring Batch).
- Java-era classic stacks (the migration source). Deterministic.

**Out of Scope:**

- NO new meta-model entity types — `endpoints`/`interfaces` already exist; no AMS
  schema change; no Liquibase changeset; save-back already resolves the
  endpoint/interface candidate shapes unchanged.
- NO meta-model reference-doc edit (no new entity types).
- GraphQL / gRPC / WebSocket-STOMP / Spring Batch as entry points — FULL modelling
  deferred (emit a presence Finding only).
- Non-Java stacks; Actuator endpoints (fully out, no Finding).
- NO LLM in the deterministic core path (the gap-fill LLM stage remains the
  existing residual safety net; only its prompt MISSES-list is updated).
- NO frontend work beyond the existing Candidates / endpoint / interface
  rendering.

### Technical Considerations

- **No AMS / save-back change:** the new detectors MUST produce the exact existing
  `endpoints`/`interfaces` candidate shapes (verified at `springClassic/index.ts`
  `makeCandidate` line 419 + `processController` lines 458-554); save-back resolves
  them unchanged. Endpoint identity now folds in the new discriminators so
  same-path+verb variants do not collapse.
- **AMS wire format:** no new DTO is introduced, so the snake_case-by-default
  convention (CLAUDE.md) is not exercised by this spec.
- **Deterministic, bounded resolution:** meta-annotation follow-depth and the
  controller `extends` walk are depth-capped and cycle-guarded; fully-qualified
  annotation matching is on the final simple-name segment.
- **`AnnotationIR` string args:** consistent with W1's scope note, `AnnotationIR`
  is NOT refactored to array-typed args — brace-lists (e.g. `consumes`/`produces`
  arrays) are parsed from the existing raw string via the W1 `splitBraceList`
  idiom.
- **In-flight runs:** do NOT edit `discovery-service/src/**` during an in-flight
  discovery run (`tsx watch` auto-reload kills runs) — memory
  `feedback_no_src_edits_during_run`.
- **Relationship to the runtime harness:** the harness
  (`api-migration-validation-service`) stays the equivalence verifier; this spec
  only makes MORE of the real inbound surface VISIBLE to it. Newly-captured
  `@RequestParam`/`@RequestHeader` inputs let the harness vary request shape.

## Phase-2 Build Ordering & File-Overlap

**Position:** Spec #4 of 6 in the HAIKAI Phase-2 "oracle perfection" program.
Built STRICTLY SEQUENTIALLY after Specs #1–#3 — NOT in parallel.

**Why sequential (file overlap is the reason, not a nicety):**
- **`springClassic/index.ts` (the primary edit site)** is shared with Spec #1
  (the response-contract / endpoint→data-effect scanner). This spec EXTENDS Spec
  #1's committed adapter code (new surface detectors hang off the same
  `processController` / `makeCandidate` emission). Building before #1 would fork or
  clobber that file.
- **`astUtils.ts`** (Java annotation extraction) is shared with Spec #1. The
  meta-annotation / fully-qualified-name matcher extension here builds on #1's
  committed extraction shape.
- **The Spring-Classic gap-fill prompt** (`spring-classic.md`) is shared with Spec
  #1 — both adjust its "already catches" / "MISSES" lists. Sequencing avoids two
  specs editing the same prompt out of order.
- **`emissionSources.ts`** (finding emission helpers) is shared with Specs #1/#3 —
  reused here for the deferred-surface presence findings.

**Relationship to W1 (already on HEAD):** this spec EXTENDS the merged W1 quick-win
(multi-verb / multi-path endpoint fan-out via `extractHttpMethods` /
`extractMethodPaths` / `splitBraceList`) and CLOSES its `TODO(oracle-W1)`
(`springClassic/index.ts:247`) by aligning the two single-value `extractHttpMethod`
mirrors (`endpointDataEffectResolver.ts:367`, `springBoot/index.ts:284`) with the
plural fan-out. Do NOT redo W1 — extend it.

**Net layering:** discovery-service ONLY. New/extended scanners under
`extensionPacks/frameworkAdapters/springClassic/` (+ the JAX-RS detector, the
servlet/`web.xml` detector, the WebFlux `RouterFunction` detector), meta-annotation
+ inherited-controller resolution in `astUtils.ts` / the adapter, the JAX-WS
interface-SEI fix in `springClassicSoap/jaxWsScanner.ts`, the servlet-mapping URL
extraction in `springClassicFindingScanner.ts`, the two `extractHttpMethod` mirror
alignments, the deferred-surface findings via `FindingEmitter`/`emissionSources.ts`,
and the gap-fill prompt update. NO AMS schema change, NO save-back change, NO
frontend change beyond existing rendering.
