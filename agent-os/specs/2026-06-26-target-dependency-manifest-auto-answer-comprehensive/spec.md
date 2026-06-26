# Specification: Target Dependency-Manifest Auto-Answer (Comprehensive) + Tier-2 Free Facts

## Goal
Make the target dependency-manifest (`pom.xml` / `package.json`) upload auto-answer COMPREHENSIVE — reading pom `<properties>`/`<plugins>`, expanding the witness registry, inferring + LLM-gap-filling, and writing every result immediately as a badged, confirm-once pre-filled answer — and add a persisted, editable Tier-2 "free facts" list for manifest-declared tech outside the 51 questions. This is Spec 2 of 3 and builds on Spec 1 (the bare-stem `{framework, version}` answer format + 24-code versioned set are live).

## User Stories
- As an architect uploading a target `pom.xml`, I want the long tail (`<java.version>`, migrations, logging, connection-pool, testing, ...) auto-answered — not just framework/driver/build-tool — so I confirm once instead of hand-filling each code.
- As an architect, I want each pre-filled answer to show whether it came from the manifest, an inference, or the LLM, AND from which dependency, so I can trust or correct it.
- As an architect, I want manifest-declared tech OUTSIDE the 51 questions (e.g. MCP SDK, Spring AI) surfaced as an editable/removable informational list so nothing is silently lost.

## Specific Requirements

**R1 — Carry pom metadata through `ResolvedManifest` (the root-cause fix)**
- Add a `pomMetadata` field (the projected `{ properties, plugins }`, or the full `PomMetadata`) onto `ResolvedManifest` (`manifestVersionResolution.ts`) — today the parsed metadata is computed inside `resolveMavenVersions` then DISCARDED.
- Populate it in `resolveManifestVersions` for the MAVEN path by projecting the metadata already parsed via `parsePomMetadataFromString`, instead of dropping it. NPM path carries an empty/absent metadata.
- Read it in `deriveManifestAnswerCandidates` so derivation can see `<properties>` (e.g. `properties['java.version']`) and `<plugins>` (flyway/liquibase `groupId/artifactId`).
- Purely additive to the shape; no change to resolver rows or the locked metadata parser.

**R2 — Expanded witness registry (closed-choice coverage, bare stems)**
- Expand the coordinate registry (`manifestCodeMapping.ts`) from a `{ decisionCode, framework }` match to a UNION answer shape per witness: `{ kind:'framework-version', framework: BARE STEM }` (version resolved from the dep) for any code in Spec 1's 24-code versioned set, OR `{ kind:'single-choice', value: EXACT questionLibrary choice }` for the genuinely-non-versioned residue.
- Cover the manifest-witnessable codes with STRONG single-coordinate witnesses only: logging/metrics/tracing/validation/`db.migrations`/`db.connectionPool`/`testing.*`/`ui.buildTool`/`ui.stateManagement`/`ui.designSystem`/`ui.testing`/`interservice.asyncBus`/`domain.mappingStrategy`.
- Principle: cover the CLOSED choice set per code, NOT "top-N popular libraries"; leave ambiguous/combo codes to the LLM.
- Emit BARE STEMS aligned with Spec 1 (e.g. `Spring Boot`, `Flyway`, `Maven`); version-less `none`/`manual`/`in-house` stems carry NO version.
- NEVER auto-answer the not-manifest codes (`cutover.*`, `api.auth`, `secrets.management`, `service.processModel`, `logging.format`, `container.*`, `ci.pipeline`, `deployment.*`, ...).
- Update `matchManifestCoordinate` (and the answerable-code sets) to return the union shape; keep first-matching-rule-wins, pure + deterministic.

**R3 — Property + plugin extractors**
- Property extractor: `<java.version>` / `maven.compiler.release` / `kotlin.version` → `service.language`, reading the now-carried `pomMetadata.properties`.
- Plugin extractor: flyway / liquibase `maven-plugin` → `db.migrations`, reading `pomMetadata.plugins` (`groupId`/`artifactId`).
- Both emit candidates in the same union shape as R2 (bare stem aligned with Spec 1's versioned set, or exact single-choice where applicable).
- Deterministic-direct precedence: a property/plugin extractor result is a deterministic hit (not inferred, not LLM).

**R4 — Inference (badged, write-immediately)**
- `db.driver` → `db.engine`: FAMILY ONLY, so VERSION-UNKNOWN (a driver does not reveal the server version); badge `inferred`, source-dependency = the driver coordinate.
- `service.language` → `service.runtime`: reuse Spec 1's cascade seed; badge `inferred`.
- Inference produces candidates that are written IMMEDIATELY as pre-filled captured-decisions (not held as proposals), carrying the `inferred` provenance + source dependency.
- Inference sits ABOVE the LLM and BELOW deterministic-direct and manual (R6 precedence).

**R5 — The ONE LLM gap-fill call (answers-51 + Tier-2)**
- ONE batched JSON call that BOTH: (a) proposes answers to the 51 for deps the deterministic registry missed (badge `LLM-suggested`, source-dependency carried), AND (b) names Tier-2 "free facts" for deps outside the 51.
- Mirror `prefillFromTechStack.ts`: inject an `ArchitectLlmClient`, call `callSingleShot`, strip ```` ```json ```` fences, defensively `JSON.parse`, return a typed success/failure union; thread the client into the manifest path (new dep on `ManifestAutoAnswererDeps`/orchestrator + route wiring via `buildArchitectLlmClient()`).
- Cached by manifest CONTENT HASH; re-runs only when content changes. FAIL-OPEN: unconfigured/down/parse-fail → skip silently, deterministic + inferred results still stand.
- Only UNMATCHED deps enter the prompt, capped at a sane max.
- DETERMINISTIC + INFERRED ALWAYS WIN — the LLM never overrides either; an LLM single-choice value is still subject to the R10 guard-rail.

**R6 — Precedence + write-immediately-with-badge**
- Precedence: `deterministic-direct > inferred > LLM`, all strictly BELOW manual. The existing manual-wins + re-upload-supersede behaviour (`manifestPrecedence.ts`) is unchanged; the LLM never overrides a deterministic OR inferred hit.
- Each of the 51 ends with EXACTLY ONE pre-filled answer (deterministic-direct / inferred / LLM / manifest-direct), written immediately through the EXISTING captured-decision envelope + POST `/capture` path (no new AMS DTO).
- Every pre-filled answer carries PROVENANCE: the badge (`from manifest` / `inferred` / `LLM-suggested`) + the SOURCE DEPENDENCY (e.g. "from org.postgresql:postgresql", "inferred from driver").
- User confirms once; an inline edit is a manual-wins supersede (the existing `captureAnswer` manual path).
- Candidate de-dup keeps the highest-precedence hit per code; preserve the existing abort-on-first-POST-failure / partial-success outcome shape.

**R7 — Tier-2 persistence + response surfacing**
- Persist Tier-2 facts via the EXISTING `target_manifest_artifacts` AMS store (same `(projectId, targetArchitectureId, tag)` key, fail-soft) — EXTEND that store, do not create a new one; no new AMS DTO for the captured answers.
- Label format `"<friendly name> — <coordinate>"`, e.g. `"MCP SDK — io.modelcontextprotocol.sdk"`, `"Spring AI / LLM client — spring-ai-openai"`.
- Surface Tier-2 facts on a NEW `autoAnswer.freeFacts` response field (gateway slice + the `targetManifestApi.ts` mirror) so they reach the prompt-ready output / seed-build-files.
- Informational + editable/removable — NEVER new questions.

**R8 — Provenance wire-shape extension (gateway + frontend mirror)**
- Additively extend `ResolvedTargetVersion` (`manifestPrecedence.ts`): add `'inferred'` and `'llm'` to the `provenance` union; add an OPTIONAL source-dependency/evidence field (today it carries only the manifest `sourceFile` path).
- Mirror the same additions in `frontend/src/api/targetManifestApi.ts`; kept lock-step by the existing frontend↔gateway contract test.
- Recompute/precedence logic must stamp the correct `provenance` + source-dependency for deterministic / inferred / LLM rows.

**R9 — Frontend panel surfacing**
- Extend the panel's provenance badge (today the closed `'from manifest'|'manually entered'` union, `ManifestUploadPanel.tsx`) to render the `inferred` / `LLM-suggested` badges + the per-answer source-dependency label alongside the existing manifest source-file line.
- Add a NEW informational `<section>`/`<ul>` slotted AFTER the "Auto-answered decisions" list, reading `autoAnswer.freeFacts`, with edit/remove affordances — never forced questions.
- Reuse the existing chip rendering (`resolvedTargetVersionChip`) and inline-edit `captureAnswer` manual path unchanged.

**R10 — Guard-rail + deliberate test updates**
- Guard-rail (Spec-1-style contract test): every single-choice `value` the registry emits MUST be a verbatim member of that code's `questionLibrary.choices`; every bare-stem framework MUST align with Spec 1's 24-code versioned-set stems.
- The EXISTING manifest Jest tests encode the OLD too-basic behaviour (e.g. a Spring+Postgres pom yielding exactly `build.tool`/`db.driver`/`service.framework`) and WILL be deliberately UPDATED to the richer output.
- Gateway tests use Jest; frontend uses Vitest. The frontend whole-repo baseline is pre-existingly RED → verify the frontend changes in ISOLATION.

## Visual Design
No visual assets were provided. The mandatory check of `planning/visuals/` returned no image/PDF files. UI work (R9) extends the existing `ManifestUploadPanel.tsx` provenance badge + adds a Tier-2 informational list; follow the established panel styling and `data-testid` conventions already in that component.

## Existing Code to Leverage

**LLM single-shot seam — `gateway/src/services/architectConversation/prefillFromTechStack.ts` (+ `architectLlmClient.ts`, `routes/architectConversation.ts`)**
- The exact template to MIRROR for R5: composes a `SingleShotPrompt {system,user}`, calls `args.llmClient.callSingleShot`, `stripJsonFences`, defensive `JSON.parse`, hand-rolled validator, typed `success | failure` union; a thrown `SingleShotLlmCallError` is caught and returned as failure (never throws through) — the fail-open posture R5 needs.
- `architectLlmClient.ts` defines `ArchitectLlmClient.callSingleShot(prompt, options)` + `SingleShotPrompt` / `CallSingleShotOptions` / `SingleShotLlmCallError` shapes.
- `routes/architectConversation.ts` `buildArchitectLlmClient()` wraps the gateway-wide `getLlmClient()` — the wiring to thread into the manifest route (the manifest path has NO `llmClient` today).
- `openTurnTechStackPrefill.ts` is the precedent for writing a NON-versioned plain-string `value:<exact choice>` captured-decision row.

**Manifest pipeline — `gateway/src/services/targetManifest/` + `routes/targetManifestUpload.ts`**
- `manifestVersionResolution.ts`: `ResolvedManifest` (the shape R1 extends), `resolveMavenVersions` (parses metadata then discards it — the root cause), `resolveManifestVersions` (the assembly point to populate `pomMetadata`).
- `manifestAutoAnswerer.ts`: `deriveManifestAnswerCandidates` (R3/R4 extend it to read `pomMetadata` + emit inferred candidates), `ManifestAutoAnswererDeps` (inject the `llmClient`), `buildManifestCapturedDecisionBody` (reuses `frameworkVersionShape.ts` `buildFrameworkVersionEnvelope`).
- `manifestPrecedence.ts`: `ResolvedTargetVersion` (R8 extends provenance), `recomputeResolvedTargetVersions` / `filterCandidatesByPrecedence` (manual-wins; R6 layers inferred/LLM below deterministic).
- `manifestUploadOrchestrator.ts` `processManifestUpload` + route `buildTargetManifestUploadResponseWithAutoAnswer` (the `autoAnswer` slice R7 extends with `freeFacts`).

**Pom metadata parser — `gateway/src/services/targetManifest/mavenPomMetadata.ts`**
- `PomMetadata` = `{ properties, parent, plugins, dependencyManagement }`; `<java.version>` lands in `properties['java.version']`, flyway/liquibase plugins in `plugins[]` — exactly the inputs R3 needs.
- `parsePomMetadataFromString` + `resolvePropertyRef` already called inside `resolveMavenVersions`; R1 only needs to carry the result forward (do NOT modify this faithful port of the locked discovery-service parser).

**Coordinate registry — `gateway/src/services/targetManifest/manifestCodeMapping.ts`**
- Today's `MAVEN_RULES` / `NPM_RULES` / `matchManifestCoordinate` / `buildToolFrameworkForEcosystem` cover only 4 codes — R2 expands these to the union answer shape with closed-choice coverage and bare stems.
- `COORDINATE_ANSWERABLE_CODES` / `DEPENDENCY_ANSWERABLE_CODES` sets define the selection boundary to extend; `questionLibrary.ts` (`choices`) is the guard-rail source of truth (R10).

**Tier-2 persistence host — `gateway/src/services/targetManifestArtifactsClient.ts` (+ route `defaultPersistConfirmedManifests`)**
- `persistTargetManifestArtifacts` / `fetchLatestTargetManifestArtifacts` already own the `target_manifest_artifacts` store (snake_case wire, fail-soft, same `(projectId, targetArchitectureId, tag)` key) — R7 extends this store rather than creating a new one.
- The route's fail-soft persist wrapper (`[diag-gateway]` log + degrade-to-no-op) is the posture to reuse for the Tier-2 write.

## Out of Scope
- Spec 1 (`2026-06-26-target-conversation-versioned-answer-bare-stem-ux`): the version-decoupling UX, the cascade-engine fix, and resolved-label rendering — this spec DEPENDS ON it (now done/verified) and must not re-touch it.
- Spec 3: the decisions-file import AND its mutual-exclusivity disable (upload one box → the other disables with a hover tooltip).
- Any new AMS DTO for the captured answers — reuse the existing `{ value, sourceQuote, sourceFile }` envelope + POST `/capture` path.
- Any brand-new persistence store for Tier-2 — extend the existing `target_manifest_artifacts` store only.
- Auto-answering the not-manifest codes (`cutover.*`, `api.auth`, `secrets.management`, `service.processModel`, `logging.format`, `container.*`, `ci.pipeline`, `deployment.*`).
- The LLM overriding any deterministic or inferred hit (LLM is strictly the lowest non-manual precedence).
- "Top-N popular libraries" registry padding — closed-choice coverage per code only; ambiguous/combo codes are left to the LLM.
- Gradle or any ecosystem beyond `pom.xml` / `package.json`.
- PATCH/DELETE of captured decisions for re-upload supersede — the AMS append-only convention stays.
- CVE delta, steering UI, and any codebase-artifact writing (later specs).
