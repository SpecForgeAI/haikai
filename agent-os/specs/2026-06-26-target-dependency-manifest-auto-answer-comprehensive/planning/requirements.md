# Spec Requirements: Target Dependency-Manifest Auto-Answer (Comprehensive) + Tier-2 Free Facts

> Status: SHAPED (authoritative). All open questions resolved; decisions folded in below. Spec 2 of 3 — depends on Spec 1 (`2026-06-26-target-conversation-versioned-answer-bare-stem-ux`). Stop at the shaped spec (shape→build pause).

## Initial Description

Make the target dependency-manifest (`pom.xml` / `package.json`) upload auto-answer COMPREHENSIVE, and add Tier-2 "free facts".

Two problems:
- **Problem 1 (too basic):** today's auto-answer is a ~15-rule hardcoded coordinate dictionary (`gateway/src/services/targetManifest/manifestCodeMapping.ts`) covering only 4 codes (`service.framework`, `db.driver`, `ui.framework`, `build.tool`). It NEVER reads pom `<properties>` (so `<java.version>21</java.version>` is missed → `service.language` unanswered) and can't scale to the long tail (Spring AI / Spring Cloud / MCP ignored).
- **Problem 2 (Tier-2 "free facts"):** for manifest-declared things OUTSIDE the 51 questions (e.g. `io.modelcontextprotocol.sdk` → "MCP SDK", `spring-ai-openai` → "Spring AI / LLM client"), show an LLM-named, informational, editable/removable list — NOT new questions.

The build (deterministic-first + LLM-augment): carry pom metadata through; expand the witness registry to a union answer shape (bare-stem framework/version + plain single-choice residue); property + plugin extractors; inference (driver→engine, language→runtime); ONE LLM gap-fill call that BOTH proposes answers to the 51 for deps the registry missed AND names Tier-2 facts; surface Tier-2 + source-dependency provenance + the inferred/LLM badges.

## Established Facts (code-research, file:line confirmed)

### Fact 1 — The LLM seam to mirror
- `gateway/src/services/architectConversation/prefillFromTechStack.ts` is the single-shot template: composes a `SingleShotPrompt {system,user}`, calls `args.llmClient.callSingleShot(prompt, callOptions)` (:228), strips ` ```json ` fences (`stripJsonFences`, :290), `JSON.parse` defensively (:256), runs a hand-rolled validator, returns a typed `success | failure` union. FAIL-OPEN: a thrown `SingleShotLlmCallError` is caught (:230) and returned as a failure — it never throws through.
- `architectLlmClient.ts` defines `ArchitectLlmClient` with `callSingleShot(prompt, options): Promise<{content:string}>` (:159).
- The client is BUILT + INJECTED at the route: `routes/architectConversation.ts` `buildArchitectLlmClient()` (:240) wraps the gateway-wide `getLlmClient()`; `callSingleShot` (:287) sends a system+user pair via `llm.sendChatRequest(...)`.
- The manifest path has NO `llmClient` today: `manifestAutoAnswerer.ts` `ManifestAutoAnswererDeps = { postCapturedDecision }` ONLY (:74). The orchestrator/route never construct an `ArchitectLlmClient`. The ONE LLM call must be THREADED IN (new dep + route wiring through `buildArchitectLlmClient()`).

### Fact 2 — The structural root cause
- `manifestVersionResolution.ts` `resolveMavenVersions` (:137) calls `parsePomMetadataFromString(...)` (:143) and HAS `metadata.properties`/`plugins`/`parent`/`dependencyManagement` LOCALLY — it uses `properties` for `${...}` resolution but the returned rows DISCARD the raw metadata.
- `ResolvedManifest` (:82) = `{ ecosystem, tag, manifestPath, resolvedDependencies }` — NO `pomMetadata`/`properties`/`plugins` field; `resolveManifestVersions` (:403) builds that object and the metadata never escapes `resolveMavenVersions`.
- `mavenPomMetadata.ts` `PomMetadata` (:35) = `{ pomPath, properties: Record<string,string>, parent, plugins: PomPlugin[], dependencyManagement }`. `<java.version>` lands in `properties['java.version']`; flyway/liquibase plugins land in `plugins[]` with `groupId/artifactId`.
- `deriveManifestAnswerCandidates` (`manifestAutoAnswerer.ts` :144) iterates ONLY `manifest.resolvedDependencies` + the ecosystem build tool — it never sees `properties`/`plugins`. So `<java.version>` → `service.language` is missed exactly as described.

### Fact 3 — The captured-decision envelope (both shapes)
- VERSIONED codes write `value: {framework, version}`: `frameworkVersionShape.ts` `buildFrameworkVersionEnvelope` (:173) → `JSON.stringify({ value:{framework,version}, sourceQuote, sourceFile })`. The manifest already uses this (`buildManifestCapturedDecisionBody`, `manifestAutoAnswerer.ts` :214).
- NON-VERSIONED single-choice codes write `value: <plain string>`: `openTurnTechStackPrefill.ts` (:252) → `JSON.stringify({ value: answer.value, sourceQuote, sourceFile })` where `answer.value` is the verbatim `questionLibrary.choices` string.

### Fact 4 — The frontend surface
- `ManifestUploadPanel.tsx` renders `response.autoAnswer.resolvedTargetVersions` as the "Auto-answered decisions" list (:360), each row an `<AutoAnsweredDecision>` (:444) showing the decisionCode, the resolved chip (`resolvedTargetVersionChip`, :469), a provenance badge that today reads only `'from manifest'` vs `'manually entered'` (:556), and a provenance LINE showing `shortenManifestPath(decision.sourceFile)` (:571). Inline edit writes a MANUAL `{framework,version}` answer via `captureAnswer` (:497).
- `ResolvedTargetVersion` wire (`manifestPrecedence.ts` :203 / mirrored in `frontend/src/api/targetManifestApi.ts`) = `{ decisionCode, framework, version, versionUnknown, provenance:'manifest'|'manual', sourceFile }`. Provenance is a CLOSED 2-value union; there is NO `'inferred'`/`'llm'` member, and the only source field is `sourceFile` (the manifest PATH), not a source-DEPENDENCY label.
- `writtenCodes`/`skippedManualCodes`/`confirmedManifests` exist on the response slice (`TargetManifestAutoAnswerSlice`, `targetManifestUpload.ts` :182) but are NOT surfaced in the panel today.

### Fact 5 — Tier-2 persistence is net-new but rides an existing precedent
- A repo-wide search found NO existing free-fact/Tier-2/informational-fact store. Tier-2 are NOT answers to the 51, so they must not ride `target_state_captured_decisions`.
- The captured-manifest persistence precedent exists: `targetManifestUpload.ts` already persists confirmed manifest BYTES to the AMS store `target_manifest_artifacts` (fail-soft, :531) via `persistTargetManifestArtifacts` (`targetManifestArtifactsClient.ts`). Tier-2 facts ride THIS existing store (same `(projectId, targetArchitectureId, tag)` key, fail-soft) — extend it rather than create a brand-new store.

## Resolved Decisions

**D1 — Inferred / LLM answer UX = WRITE-IMMEDIATELY-WITH-BADGE.** Inferred answers (`db.driver`→`db.engine` [family only → version-unknown], `service.language`→`service.runtime`) and LLM-proposed answers to the 51 are WRITTEN IMMEDIATELY as pre-filled captured-decisions, each carrying an `inferred` or `LLM-suggested` badge + its SOURCE DEPENDENCY, exactly like a manifest-direct hit (the user edits if wrong). They are NOT held as un-committed proposals. This preserves the "confirm once" model: each of the 51 ends with EXACTLY ONE pre-filled answer the user confirms once; edits are manual-wins supersede.

**D2 — Tier-2 "free facts" PERSIST** (so they reach the prompt-ready output / seed-build-files), riding the EXISTING `target_manifest_artifacts` AMS store (same key, fail-soft — EXTEND that store, do not create a new one). Label format = `"<friendly name> — <coordinate>"`, e.g. `"MCP SDK — io.modelcontextprotocol.sdk"`, `"Spring AI / LLM client — spring-ai-openai"`. They are informational + editable/removable, NEVER new questions, and they feed the prompt-ready output.

**D3 — LLM call operationals = ONE batched JSON call doing both jobs** (propose answers to the 51 for deps the deterministic registry missed + name Tier-2 facts for deps outside the 51). Cached by manifest CONTENT HASH; FAIL-OPEN (if the LLM is unconfigured/down, skip silently — deterministic results still stand); re-runs when the manifest content changes (cache invalidates on content change). Only the UNMATCHED deps go into the prompt, capped at a sane max. Uses the already-configured architect model (mirror `prefillFromTechStack.ts` → `ArchitectLlmClient.callSingleShot`, fail-open, fence-strip + defensive `JSON.parse`).

**D4 — Precedence = `deterministic-direct > inferred > LLM`, all strictly BELOW manual.** Manual-wins + re-upload-supersede already exist. The LLM never overrides a deterministic OR an inferred hit.

**D5 — Spec-1 alignment.** Emit bare-stem `{framework, version}` for ANY code in Spec 1's 24-code versioned set (with the resolved version; version-less `none`/`manual`/`in-house` stems carry NO version), and plain single-choice `value:<exact questionLibrary choice>` ONLY for the genuinely-non-versioned residue. (Spec 1 flips the versioned set from 7→24 codes; the new-17 — `db.migrations`, `db.connectionPool`, `validation.framework`, `domain.mappingStrategy`, `logging.framework`, `metrics.framework`, `tracing.framework`, `ui.buildTool`, `ui.stateManagement`, `ui.designSystem`, `ui.testing`, `testing.unit`, `testing.integration`, `testing.e2e`, `testing.contractTesting`, `testing.mocking`, `interservice.asyncBus` — are exactly the witnessable single-coordinate codes, so post-Spec-1 most witnessable codes emit bare-stem framework/version, not plain single-choice.)

**D6 — Provenance wire-shape.** Additively extend `ResolvedTargetVersion` (`manifestPrecedence.ts` :203): add `'inferred'` and `'llm'` to the `provenance` union, and add an OPTIONAL source-dependency/evidence field (today it carries only the manifest `sourceFile` path). Kept lock-step by the existing frontend↔gateway contract test. NO AMS DTO change for the captured answers.

## Functional Requirements

### FR1 — Carry pom metadata through (the root-cause fix)
- Add `pomMetadata` (the projected `{ properties, plugins }`, or the full `PomMetadata`) onto `ResolvedManifest` (`manifestVersionResolution.ts` :82) — today discarded.
- Populate it in `resolveManifestVersions` (:403) for the MAVEN path, projecting the metadata already parsed in `resolveMavenVersions` (:137/:143) instead of dropping it.
- Read it in `deriveManifestAnswerCandidates` (`manifestAutoAnswerer.ts` :144) so derivation can see `<properties>`/`<plugins>`.

### FR2 — Expanded witness registry (closed-choice coverage, bare stems)
- Expand the coordinate registry (`manifestCodeMapping.ts`) to a UNION answer shape per witness: `{ kind:'framework-version', framework: BARE STEM }` (version resolved from the dep) for Spec-1 versioned codes (per D5), or `{ kind:'single-choice', value: EXACT questionLibrary choice }` for the genuinely-non-versioned residue.
- Cover the manifest-witnessable codes with STRONG single-coordinate witnesses only: logging/metrics/tracing/validation/migrations/connectionPool/testing.*/`ui.buildTool`/`ui.stateManagement`/`ui.designSystem`/`ui.testing`/asyncBus/discovery/mapping.
- Principle: cover the CLOSED choice set per code (not "top-N popular libraries"); leave ambiguous/combo codes to the LLM. Emit BARE STEMS aligned with Spec 1.
- NEVER auto-answer the not-manifest codes (`cutover.*`, `api.auth`, `secrets.management`, `service.processModel`, `logging.format`, `container.*`, `ci.pipeline`, `deployment.*`, etc.).

### FR3 — Property + plugin extractors
- Property extractor: `<java.version>` / `maven.compiler.release` / `kotlin.version` → `service.language`.
- Plugin extractor: flyway / liquibase `maven-plugin` → `db.migrations`.
- Both read the now-carried `pomMetadata` (FR1).

### FR4 — Inference (badged, write-immediately)
- `db.driver` → `db.engine` — FAMILY ONLY, so VERSION-UNKNOWN (a driver doesn't reveal the server version); badge `inferred`, source-dependency = the driver coordinate.
- `service.language` → `service.runtime` — reuse the Spec-1 cascade seed; badge `inferred`.
- Per D1, written immediately as pre-filled captured-decisions (not proposals); per D4 they sit above LLM and below deterministic-direct and manual.

### FR5 — The ONE LLM gap-fill call (answers-51 + Tier-2)
- ONE batched JSON call (per D3) that BOTH: (a) proposes answers to the 51 for deps the deterministic registry missed (badge `LLM-suggested`, source-dependency carried), and (b) names Tier-2 "free facts" for deps outside the 51.
- Mirror `prefillFromTechStack.ts`: inject an `ArchitectLlmClient`, `callSingleShot`, fence-strip, defensive `JSON.parse`, typed success/failure union.
- Cached by manifest CONTENT HASH; re-runs only when content changes. FAIL-OPEN: unconfigured/down → skip silently, deterministic + inferred results still stand.
- Only UNMATCHED deps enter the prompt, capped at a sane max.
- DETERMINISTIC + INFERRED ALWAYS WIN — the LLM never overrides either (D4).

### FR6 — Write-immediately-with-badge UX
- Each of the 51 ends with EXACTLY ONE pre-filled answer (deterministic-direct / inferred / LLM / manifest), written immediately through the EXISTING captured-decision envelope + POST `/capture` path.
- Every pre-filled answer shows PROVENANCE: the badge (`from manifest` / `inferred` / `LLM-suggested`) + the SOURCE DEPENDENCY (e.g. "from org.postgresql:postgresql", "inferred from driver").
- User confirms once; an edit is a manual-wins supersede.

### FR7 — Tier-2 persistence + surfacing
- Persist Tier-2 facts via the EXISTING `target_manifest_artifacts` AMS store (same `(projectId, targetArchitectureId, tag)` key, fail-soft) — extend that store (D2). They feed the prompt-ready output / seed-build-files.
- Label format `"<friendly name> — <coordinate>"` (D2).
- Surface them in a NEW informational `<section>`/`<ul>` slotted AFTER the "Auto-answered decisions" list in `ManifestUploadPanel.tsx`, reading a NEW `autoAnswer.freeFacts` response field. Informational, editable/removable, never forced questions.

### FR8 — Provenance wire-shape extension (frontend)
- Additively extend `ResolvedTargetVersion` (`manifestPrecedence.ts` :203 + mirror in `frontend/src/api/targetManifestApi.ts`): add `'inferred'` + `'llm'` to the `provenance` union; add an OPTIONAL source-dependency/evidence field.
- Extend the panel's provenance badge (today the closed `'from manifest'|'manually entered'` union, `ManifestUploadPanel.tsx` :556) to render the inferred/LLM badges + the per-answer source-dependency label.
- Kept lock-step by the existing frontend↔gateway contract test. NO AMS DTO change for the captured answers.

## Precedence

`deterministic-direct > inferred > LLM`, all strictly BELOW manual. Manual-wins + re-upload-supersede already exist and are unchanged. The LLM never overrides a deterministic OR an inferred hit. (D4)

## Constraints

- Gateway tests use Jest; frontend uses Vitest; the frontend whole-repo baseline is pre-existingly RED → verify in ISOLATION.
- Keep the EXISTING captured-decision envelope + POST `/capture` path; NO new AMS DTO for the captured answers. Tier-2 persistence EXTENDS the existing `target_manifest_artifacts` store.
- The EXISTING manifest tests (Jest) encode the OLD too-basic behaviour (e.g. a Spring+Postgres pom yields exactly `build.tool`/`db.driver`/`service.framework`) and WILL be deliberately UPDATED to the richer output.

## Guard-rail

Every single-choice `value` the registry emits MUST be a real member of that code's `questionLibrary.choices` (a Spec-1-style contract test).

## Existing Code to Reference (for the spec-writer)

- LLM single-shot seam to mirror: `gateway/src/services/architectConversation/prefillFromTechStack.ts` (`callSingleShot` :228, fence-strip :290, defensive parse :256, fail-open catch :230) + `architectLlmClient.ts` (`callSingleShot` :159) + `routes/architectConversation.ts` `buildArchitectLlmClient()` :240/:287.
- Versioned envelope: `gateway/src/config/architect-conversation/frameworkVersionShape.ts` `buildFrameworkVersionEnvelope` (:173).
- Non-versioned plain-string row write precedent: `openTurnTechStackPrefill.ts` (:247-262, write :252).
- Manifest pipeline: `parsedManifestModel.ts` → `manifestVersionResolution.ts` (`ResolvedManifest` :82, `resolveMavenVersions` :137, `resolveManifestVersions` :403) → `manifestAutoAnswerer.ts` (`deriveManifestAnswerCandidates` :144, `ManifestAutoAnswererDeps` :74, `buildManifestCapturedDecisionBody` :214) → `manifestPrecedence.ts` (`ResolvedTargetVersion` :203, `filterCandidatesByPrecedence`, `recomputeResolvedTargetVersions`) → `manifestUploadOrchestrator.ts` (deps :45) → `routes/targetManifestUpload.ts` (`buildTargetManifestUploadResponseWithAutoAnswer` :478, slice :182, fail-soft persist :531).
- Pom metadata parser: `mavenPomMetadata.ts` `PomMetadata` (:35), `parsePomMetadataFromString` (:76), `resolvePropertyRef` (:117).
- Coordinate registry to expand: `manifestCodeMapping.ts` (`MAVEN_RULES`, `NPM_RULES`, `matchManifestCoordinate`, `buildToolFrameworkForEcosystem`).
- Net-new-persistence precedent (fail-soft AMS store, the Tier-2 host): `targetManifestUpload.ts` `defaultPersistConfirmedManifests` (:291) + `targetManifestArtifactsClient.ts` (`persistTargetManifestArtifacts`).
- Frontend panel: `frontend/src/components/targetState/architectConversation/ManifestUploadPanel.tsx` (list :360, `<AutoAnsweredDecision>` :444, chip :469, provenance badge :556, provenance line :571, inline-edit `captureAnswer` :497); wire mirror `frontend/src/api/targetManifestApi.ts` (`ResolvedTargetVersion`, `resolvedTargetVersionChip`).
- Question library (choice strings, the guard-rail source of truth): `gateway/src/config/architect-conversation/questionLibrary.ts`.

## Visual Assets

No visual assets provided. Mandatory check of `planning/visuals/` returned no image/PDF files.

## Out of Scope

- The version-decoupling UX + cascade engine fix + resolved-label rendering (Spec 1, `2026-06-26-target-conversation-versioned-answer-bare-stem-ux`) — this spec DEPENDS ON it.
- The decisions-file import AND its mutual-exclusivity with this manifest upload box (Spec 3 implements the reciprocal disable — upload one → the other disables w/ hover tooltip).
- No new AMS DTO for the captured answers (existing envelope + POST path); Tier-2 persistence is the only net-new persistence and it extends the existing `target_manifest_artifacts` store.
