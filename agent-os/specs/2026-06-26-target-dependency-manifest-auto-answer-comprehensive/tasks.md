# Task Breakdown: Target Dependency-Manifest Auto-Answer (Comprehensive) + Tier-2 Free Facts

## Overview
Total: 11 task groups, 71 sub-tasks.

Spec 2 of 3. Builds on Spec 1 (bare-stem `{framework, version}` answer format + 24-code versioned set are live and must NOT be re-touched). Almost all work is in the **gateway** (Jest); the frontend mirror/contract (Task Group 8) and panel (Task Group 9) are **frontend** (Vitest).

## Cross-Cutting Implementation Constraints (READ BEFORE STARTING ANY GROUP)

- **Surgical edits to EXISTING files — clobber risk.** Implementer subagents Write whole files. For every EXISTING file below, make ANCHORED/surgical edits only: preserve ALL unrelated code, comments, imports and ordering. After each edit, run a mojibake/NUL scan (no `Ã`/`Â`/`â€` introduced) and PRESERVE the file's existing EOL style. NEW files (`manifestCodeMapping.test.ts`, the new LLM gap-fill module + its test, the guard-rail test) may be written whole.
- **No new AMS DTO for the captured answers.** Reuse the EXISTING captured-decision envelope (`{ value, sourceQuote, sourceFile }`) + the POST `/capture` path unchanged. Versioned codes keep `value:{framework,version}` (`buildFrameworkVersionEnvelope`); single-choice codes write `value:<plain string>`.
- **Tier-2 rides the EXISTING store.** Persist Tier-2 facts on `target_manifest_artifacts` (same `(projectId, targetArchitectureId, tag)` key, fail-soft). Do NOT create a new store; Tier-2 never rides `target_state_captured_decisions`.
- **Never auto-answer the not-manifest codes** (`cutover.*`, `api.auth`, `secrets.management`, `service.processModel`, `logging.format`, `container.*`, `ci.pipeline`, `deployment.*`, ...).
- **Isolation-only verification.** Each group runs ONLY its own targeted suite. NEVER run a whole-repo build/test — the frontend whole-repo baseline is pre-existingly RED.
  - Gateway (Jest), from `gateway/`: `npx jest src/services/targetManifest/__tests__/<file>.test.ts`
  - Frontend (Vitest), from `frontend/`: `npx vitest run src/<path>/<file>.test.tsx` (use `run`, not watch).
- **Precedence (the spine of the whole spec):** `deterministic-direct > inferred > LLM`, all strictly BELOW manual. The existing manual-wins + re-upload-supersede behaviour is UNCHANGED. The LLM never overrides a deterministic OR an inferred hit.

---

## Task List

### Gateway — Backend Layer

#### Task Group 1: Carry Pom Metadata Through `ResolvedManifest` (R1/FR1 — the root-cause fix)
**Dependencies:** None
**Files (EXISTING — surgical edits):** `gateway/src/services/targetManifest/manifestVersionResolution.ts`; test `gateway/src/services/targetManifest/__tests__/manifestVersionResolution.test.ts`. Do NOT modify the parser `mavenPomMetadata.ts`.

- [x] 1.0 Thread the already-parsed pom metadata onto `ResolvedManifest`
  - [x] 1.1 Write 2-4 focused tests in `manifestVersionResolution.test.ts`
    - MAVEN path: a pom with `<properties><java.version>21</java.version></properties>` and a flyway/liquibase plugin yields `resolvedManifest.pomMetadata` carrying those `properties`/`plugins`
    - NPM path: `pomMetadata` is empty/absent
    - Additive-only: existing `resolvedDependencies` rows are unchanged by the new field
    - Limit to 2-4 highly focused tests; skip exhaustive metadata-shape coverage
  - [x] 1.2 Add a `pomMetadata` field to the `ResolvedManifest` interface (the projected `{ properties, plugins }`, or the full `PomMetadata`) — purely additive
  - [x] 1.3 Return the parsed metadata out of `resolveMavenVersions` instead of discarding it (today `parsePomMetadataFromString` is computed locally then dropped)
  - [x] 1.4 Populate `pomMetadata` in `resolveManifestVersions` for the MAVEN path by projecting that parsed metadata; NPM path carries empty/absent metadata
  - [x] 1.5 Confirm the read site `deriveManifestAnswerCandidates` (`manifestAutoAnswerer.ts`) can now reach `manifest.pomMetadata` (no behaviour change yet — wiring only)
  - [x] 1.6 Run ONLY `manifestVersionResolution.test.ts`; verify the 1.1 tests pass. Do NOT run the whole suite.

**Acceptance Criteria:**
- The 1.1 tests pass.
- `ResolvedManifest.pomMetadata` is populated on the MAVEN path and empty/absent on NPM.
- No change to resolver rows, the resolved-version behaviour, or `mavenPomMetadata.ts`.

#### Task Group 2: Expand Witness Registry to the Union Answer Shape (R2/FR2)
**Dependencies:** None (parallelizable with Task Group 1)
**Files (EXISTING — surgical edits):** `gateway/src/services/targetManifest/manifestCodeMapping.ts`; NEW test `gateway/src/services/targetManifest/__tests__/manifestCodeMapping.test.ts`.

- [x] 2.0 Generalize the coordinate registry to a union answer shape with closed-choice coverage
  - [x] 2.1 Write 4-8 focused tests in the NEW `manifestCodeMapping.test.ts`
    - A versioned-code witness (e.g. Flyway coordinate) returns `{ kind:'framework-version', framework:'Flyway' }` (BARE STEM)
    - A genuinely-non-versioned residue witness returns `{ kind:'single-choice', value:<exact questionLibrary choice> }`
    - First-matching-rule-wins is preserved; a not-manifest code is never emitted; an unmatched coordinate returns `null`
    - Limit to 4-8 tests covering the union shapes + the boundary; skip per-library exhaustive coverage
  - [x] 2.2 Generalize `ManifestCodeMatch` (and the internal `CoordinateRule`) to a UNION: `{ kind:'framework-version', framework: BARE STEM }` (version resolved from the dep) OR `{ kind:'single-choice', value: EXACT questionLibrary choice }`
  - [x] 2.3 Add STRONG single-coordinate witness rules (closed-choice coverage per code, NOT "top-N popular libraries") for the manifest-witnessable codes: logging / metrics / tracing / validation / `db.migrations` / `db.connectionPool` / `testing.*` / `ui.buildTool` / `ui.stateManagement` / `ui.designSystem` / `ui.testing` / `interservice.asyncBus` / `domain.mappingStrategy`. Leave ambiguous/combo codes to the LLM (Task Group 5).
  - [x] 2.4 Emit BARE STEMS aligned with Spec 1's 24-code versioned set (e.g. `Spring Boot`, `Flyway`, `Maven`) for versioned codes; version-less `none`/`manual`/`in-house` stems carry NO version. Use exact `single-choice` values only for the genuinely-non-versioned residue.
  - [x] 2.5 Update `matchManifestCoordinate` to return the union shape, and extend `COORDINATE_ANSWERABLE_CODES` / `DEPENDENCY_ANSWERABLE_CODES` to the new code set. Keep pure + deterministic; never include a not-manifest code.
  - [x] 2.6 Run ONLY `manifestCodeMapping.test.ts`; verify the 2.1 tests pass. Do NOT run the whole suite.

**Acceptance Criteria:**
- The 2.1 tests pass.
- `matchManifestCoordinate` returns the union shape; closed-choice coverage is present for the witnessable codes only.
- Bare stems align with Spec 1; single-choice values are verbatim `questionLibrary` choices (formally enforced later in Task Group 10).

#### Task Group 3: Property + Plugin Extractors (R3/FR3)
**Dependencies:** Task Group 1, Task Group 2
**Files (EXISTING — surgical edits):** `gateway/src/services/targetManifest/manifestAutoAnswerer.ts` (`deriveManifestAnswerCandidates`); test `gateway/src/services/targetManifest/__tests__/manifestAutoAnswerer.test.ts`.

- [x] 3.0 Derive candidates from `pomMetadata` properties + plugins
  - [x] 3.1 Write 2-6 focused tests in `manifestAutoAnswerer.test.ts`
    - Property extractor: `<java.version>21</java.version>` (and `maven.compiler.release` / `kotlin.version`) yields a `service.language` candidate
    - Plugin extractor: a flyway (or liquibase) `maven-plugin` yields a `db.migrations` candidate
    - Both emit the Task Group 2 union shape and are tagged DETERMINISTIC-DIRECT (not inferred, not LLM)
    - Limit to 2-6 tests; skip exhaustive property/plugin permutations
  - [x] 3.2 Implement the property extractor reading `pomMetadata.properties`: `<java.version>` / `maven.compiler.release` / `kotlin.version` → `service.language`
  - [x] 3.3 Implement the plugin extractor reading `pomMetadata.plugins` (`groupId`/`artifactId`): flyway / liquibase `maven-plugin` → `db.migrations`
  - [x] 3.4 Emit both in the same union shape as Task Group 2 (bare stem for versioned codes, exact single-choice where applicable); stamp DETERMINISTIC-DIRECT provenance
  - [x] 3.5 Run ONLY `manifestAutoAnswerer.test.ts`; verify the 3.1 tests pass. Do NOT run the whole suite.

**Acceptance Criteria:**
- The 3.1 tests pass.
- `<java.version>` now resolves `service.language`; flyway/liquibase plugins resolve `db.migrations`.
- Extractor results are deterministic-direct candidates in the union shape.

#### Task Group 4: Inference Layer (badged, write-immediately) (R4/FR4)
**Dependencies:** Task Group 3
**Files (EXISTING — surgical edits):** `gateway/src/services/targetManifest/manifestAutoAnswerer.ts`; test `gateway/src/services/targetManifest/__tests__/manifestAutoAnswerer.test.ts`.

- [x] 4.0 Produce inferred candidates carrying an `inferred` flag + source dependency
  - [x] 4.1 Write 2-4 focused tests in `manifestAutoAnswerer.test.ts`
    - `db.driver` → `db.engine`: family only, so VERSION-UNKNOWN; candidate carries `inferred` provenance + source-dependency = the driver coordinate
    - `service.language` → `service.runtime`: candidate carries `inferred` provenance
    - Inferred candidates are produced as write-immediately candidates (not held as proposals)
    - Limit to 2-4 tests
  - [x] 4.2 Implement `db.driver` → `db.engine` inference: emit FAMILY ONLY (version-unknown); badge `inferred`; source-dependency = the driver coordinate
  - [x] 4.3 Implement `service.language` → `service.runtime` inference (reuse Spec 1's cascade seed); badge `inferred`
  - [x] 4.4 Carry an `inferred` flag + source-dependency on the candidate shape so downstream precedence (Task Group 6) can rank it above LLM and below deterministic-direct + manual
  - [x] 4.5 Run ONLY `manifestAutoAnswerer.test.ts`; verify the 4.1 tests pass. Do NOT run the whole suite.

**Acceptance Criteria:**
- The 4.1 tests pass.
- `db.engine` inference is version-unknown; both inferences carry `inferred` provenance + source dependency.
- Inferred candidates are write-immediately (not proposals) and rank between deterministic-direct and LLM.

#### Task Group 5: The ONE LLM Gap-Fill Call (answers-51 + Tier-2) (R5/FR5)
**Dependencies:** Task Group 2, Task Group 3, Task Group 4
**Files:** NEW module `gateway/src/services/targetManifest/manifestLlmGapFill.ts` (mirror `architectConversation/prefillFromTechStack.ts`) + NEW test `gateway/src/services/targetManifest/__tests__/manifestLlmGapFill.test.ts`. EXISTING (surgical): `manifestAutoAnswerer.ts` (`ManifestAutoAnswererDeps`), `manifestUploadOrchestrator.ts`, `gateway/src/routes/targetManifestUpload.ts` (wire `buildArchitectLlmClient()`).

- [x] 5.0 Add the single batched, fail-open LLM gap-fill and thread the client into the manifest path
  - [x] 5.1 Write 3-6 focused tests in the NEW `manifestLlmGapFill.test.ts` (inject a fake `ArchitectLlmClient`)
    - Happy path: one batched call returns BOTH (a) LLM-suggested answers to the 51 for registry-missed deps (badge `LLM-suggested`, source-dependency carried) AND (b) named Tier-2 free facts for deps outside the 51
    - FAIL-OPEN: a thrown `SingleShotLlmCallError` / unparseable body / unconfigured client → typed failure, never throws through; deterministic + inferred results still stand
    - Caching: identical manifest CONTENT HASH does not re-call; changed content re-calls; only UNMATCHED deps enter the prompt, capped at a sane max
    - Limit to 3-6 tests
  - [x] 5.2 Build the new module mirroring `prefillFromTechStack.ts`: compose a `SingleShotPrompt {system,user}`, call `args.llmClient.callSingleShot`, `stripJsonFences`, defensive `JSON.parse`, hand-rolled validator, return a typed `success | failure` union; catch `SingleShotLlmCallError` and return failure (fail-open)
  - [x] 5.3 Prompt only the UNMATCHED deps (capped); request BOTH jobs in one JSON response — `answers` (to the 51) and `freeFacts` (Tier-2)
  - [x] 5.4 Cache by manifest CONTENT HASH; re-run only when content changes
  - [x] 5.5 Add `llmClient: ArchitectLlmClient` to `ManifestAutoAnswererDeps` (today `{ postCapturedDecision }` only); thread it through `manifestUploadOrchestrator.ts` and construct it in the route via `buildArchitectLlmClient()` (the manifest path has no `llmClient` today)
  - [x] 5.6 Mark LLM-proposed answers `LLM-suggested` with source-dependency; ensure DETERMINISTIC + INFERRED ALWAYS WIN (the LLM never overrides either) — LLM rows feed Task Group 6 precedence at the lowest non-manual rank
  - [x] 5.7 Run ONLY `manifestLlmGapFill.test.ts`; verify the 5.1 tests pass. Do NOT run the whole suite.

**Acceptance Criteria:**
- The 5.1 tests pass.
- One batched call yields both answers-51 and Tier-2 facts; fail-open on any error; cached by content hash.
- `llmClient` is threaded `route → orchestrator → auto-answerer` via `buildArchitectLlmClient()`; LLM never overrides deterministic/inferred.

#### Task Group 6: Precedence + Write-Immediately-With-Badge (R6/FR6)
**Dependencies:** Task Group 3, Task Group 4, Task Group 5
**Files (EXISTING — surgical edits):** `gateway/src/services/targetManifest/manifestPrecedence.ts` (`recomputeResolvedTargetVersions` / `filterCandidatesByPrecedence`) + candidate provenance plumbing in `manifestAutoAnswerer.ts`; test `gateway/src/services/targetManifest/__tests__/manifestPrecedence.test.ts`.

- [x] 6.0 Rank and de-dup candidates by provenance, writing exactly one pre-filled answer per code
  - [x] 6.1 Write 3-6 focused tests in `manifestPrecedence.test.ts`
    - `deterministic-direct > inferred > LLM`, all strictly below manual (a manual answer always wins; an LLM hit never overrides a deterministic OR inferred hit)
    - De-dup keeps the highest-precedence hit per code; each of the 51 ends with EXACTLY ONE pre-filled answer
    - The existing abort-on-first-POST-failure / partial-success outcome shape is preserved
    - Limit to 3-6 tests
  - [x] 6.2 Plumb provenance (`deterministic` / `inferred` / `llm`) + source-dependency onto candidates through to `recomputeResolvedTargetVersions` / `filterCandidatesByPrecedence`
  - [x] 6.3 Implement the precedence ranking; keep the existing manual-wins + re-upload-supersede behaviour UNCHANGED (do not retouch the manual path)
  - [x] 6.4 Ensure each pre-filled answer is written immediately through the EXISTING captured-decision envelope + POST `/capture` path (versioned → `value:{framework,version}`; single-choice → `value:<plain string>`); carry the badge + source dependency
  - [x] 6.5 Preserve candidate de-dup (highest-precedence per code) and the existing partial-success/abort outcome shape
  - [x] 6.6 Run ONLY `manifestPrecedence.test.ts`; verify the 6.1 tests pass. Do NOT run the whole suite.

**Acceptance Criteria:**
- The 6.1 tests pass.
- Precedence is `deterministic-direct > inferred > LLM`, all below manual; manual-wins/re-upload-supersede unchanged.
- Exactly one badged, write-immediately pre-filled answer per code through the existing envelope/`/capture` path; outcome shape preserved.

#### Task Group 7: Tier-2 Persistence + Response Surfacing (R7/FR7)
**Dependencies:** Task Group 5
**Files (EXISTING — surgical edits):** `gateway/src/services/targetManifestArtifactsClient.ts` (extend the store), `gateway/src/routes/targetManifestUpload.ts` (`autoAnswer` slice + fail-soft persist wrapper), `frontend/src/api/targetManifestApi.ts` (mirror the new `freeFacts` field); tests `gateway/src/services/__tests__/targetManifestArtifactsClient.test.ts` and `gateway/src/services/targetManifest/__tests__/manifestUploadPersist.test.ts` / `targetManifestUpload.test.ts`.

- [x] 7.0 Persist Tier-2 free facts on the existing store and surface them on the response
  - [x] 7.1 Write 2-6 focused tests across the persist/route suites
    - Tier-2 facts persist to the EXISTING `target_manifest_artifacts` store (same `(projectId, targetArchitectureId, tag)` key), fail-soft (a persist error degrades to no-op, never aborts the upload)
    - Label format is `"<friendly name> — <coordinate>"` (e.g. `"MCP SDK — io.modelcontextprotocol.sdk"`)
    - The response exposes a NEW `autoAnswer.freeFacts` field
    - Limit to 2-6 tests
  - [x] 7.2 Extend `targetManifestArtifactsClient.ts` to persist Tier-2 facts on the existing store (do NOT create a new store; snake_case wire, fail-soft, same key)
  - [x] 7.3 Format labels as `"<friendly name> — <coordinate>"`
  - [x] 7.4 Add the NEW `autoAnswer.freeFacts` field to the gateway response slice in `targetManifestUpload.ts`; reuse the existing `[diag-gateway]` fail-soft persist wrapper posture
  - [x] 7.5 Mirror the `freeFacts` field in `frontend/src/api/targetManifestApi.ts` so it reaches the prompt-ready output / seed-build-files (informational/editable/removable, NEVER new questions)
  - [x] 7.6 Run ONLY the persist/route suites touched above; verify the 7.1 tests pass. Do NOT run the whole suite.

**Acceptance Criteria:**
- The 7.1 tests pass.
- Tier-2 facts persist fail-soft on the existing `target_manifest_artifacts` store with the `"<friendly> — <coordinate>"` label.
- `autoAnswer.freeFacts` is present on the gateway response and mirrored in `targetManifestApi.ts`; no new AMS DTO for the captured answers.

#### Task Group 8: Provenance Wire-Shape Extension (gateway + frontend mirror) (R8/FR8)
**Dependencies:** Task Group 6
**Files (EXISTING — surgical edits):** `gateway/src/services/targetManifest/manifestPrecedence.ts` (`ResolvedTargetVersion`), `frontend/src/api/targetManifestApi.ts` (mirror); contract test `frontend/src/api/targetManifestApi.test.ts` (Vitest).

- [x] 8.0 Additively extend the `ResolvedTargetVersion` wire shape and keep the contract lock-step
  - [x] 8.1 Write/extend 2-4 focused tests in the Vitest contract test `targetManifestApi.test.ts`
    - The `provenance` union now includes `'inferred'` and `'llm'` (in addition to `'manifest'` | `'manual'`)
    - The optional source-dependency/evidence field round-trips and is absent-tolerant for legacy rows
    - The frontend mirror matches the gateway shape (contract stays green)
    - Limit to 2-4 tests
  - [x] 8.2 Gateway: add `'inferred'` + `'llm'` to the `ResolvedTargetVersion.provenance` union and add an OPTIONAL source-dependency/evidence field (today it carries only the manifest `sourceFile` path) — purely additive
  - [x] 8.3 Ensure `recomputeResolvedTargetVersions` stamps the correct `provenance` + source-dependency for deterministic / inferred / LLM rows
  - [x] 8.4 Mirror the identical additions in `frontend/src/api/targetManifestApi.ts`
  - [x] 8.5 Run ONLY `targetManifestApi.test.ts` (Vitest, from `frontend/`) AND `manifestPrecedence.test.ts` (Jest, from `gateway/`); verify they pass. Do NOT run the whole suite.

**Acceptance Criteria:**
- The 8.1 tests pass and the frontend↔gateway contract test stays green.
- `provenance` additively includes `'inferred'`/`'llm'`; an optional source-dependency field exists on both sides.
- No AMS DTO change; recompute stamps the right provenance + source dependency.

### Frontend Layer

#### Task Group 9: Frontend Panel Surfacing (R9/FR9)
**Dependencies:** Task Group 7, Task Group 8
**Files (EXISTING — surgical edits):** `frontend/src/components/targetState/architectConversation/ManifestUploadPanel.tsx`; test `frontend/src/components/targetState/architectConversation/__tests__/ManifestUploadPanel.test.tsx` (Vitest).

- [x] 9.0 Render the inferred/LLM/source-dependency badges + the Tier-2 free-facts list
  - [x] 9.1 Write 3-6 focused tests in `ManifestUploadPanel.test.tsx` (Vitest)
    - The provenance badge renders `inferred` and `LLM-suggested` (extending today's closed `'from manifest'|'manually entered'` union) plus the per-answer source-dependency label alongside the existing manifest source-file line
    - A NEW informational section renders `autoAnswer.freeFacts` AFTER the "Auto-answered decisions" list, with edit/remove affordances (never a forced question)
    - The existing inline-edit manual-supersede (`captureAnswer`) path is unchanged
    - Limit to 3-6 tests; reuse existing `data-testid` conventions
  - [x] 9.2 Extend the provenance badge to render the `inferred` / `LLM-suggested` badges + the per-answer source-dependency label
  - [x] 9.3 Add a NEW informational `<section>`/`<ul>` slotted AFTER the "Auto-answered decisions" list reading `autoAnswer.freeFacts`, with edit/remove affordances (informational only — never new questions)
  - [x] 9.4 Reuse the existing chip rendering (`resolvedTargetVersionChip`) and leave the inline-edit `captureAnswer` manual path unchanged; follow the established panel styling
  - [x] 9.5 Run ONLY `ManifestUploadPanel.test.tsx` (Vitest, from `frontend/`); verify the 9.1 tests pass. Do NOT run the whole repo (frontend baseline is RED).

**Acceptance Criteria:**
- The 9.1 tests pass in isolation.
- Badges render `inferred`/`LLM-suggested` + source dependency; the Tier-2 list renders after the auto-answered list with edit/remove.
- Chip rendering and the manual inline-edit path are unchanged.

### Testing / Guard-Rail

#### Task Group 10: Guard-Rail Contract Test + Deliberate Existing-Test Updates (R10)
**Dependencies:** Task Groups 2-9
**Files:** NEW guard-rail test (gateway Jest, e.g. `gateway/src/services/targetManifest/__tests__/manifestCodeMapping.guardrail.test.ts`); EXISTING manifest Jest tests to UPDATE (`manifestAutoAnswerer.test.ts`, `manifestPrecedence.test.ts`, `targetManifestUpload.test.ts`).

- [x] 10.0 Lock the registry to the question library and re-baseline the old too-basic tests
  - [x] 10.1 Write the guard-rail contract test (Spec-1-style)
    - Every single-choice `value` the registry emits is a VERBATIM member of that code's `questionLibrary.choices`
    - Every bare-stem framework the registry emits aligns with Spec 1's 24-code versioned-set stems
  - [x] 10.2 DELIBERATELY update the EXISTING manifest Jest tests that encode the OLD too-basic behaviour (e.g. a Spring+Postgres pom yielding exactly `build.tool`/`db.driver`/`service.framework`) to the new RICHER output (now also `service.language`, `db.engine` inferred, migrations, etc.). Update only the assertions that encode old behaviour; preserve unrelated test structure.
  - [x] 10.3 Run ONLY the guard-rail test + the updated manifest Jest tests (from `gateway/`); verify they pass. Do NOT run the whole suite.

**Acceptance Criteria:**
- The guard-rail test passes: no registry single-choice value escapes `questionLibrary.choices`; all bare stems align with Spec 1.
- The updated existing manifest tests assert the new richer output and pass.

#### Task Group 11: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-10
**Files:** the feature's gateway Jest + frontend Vitest suites only.

- [x] 11.0 Review existing tests and fill ONLY critical gaps for THIS feature
  - [x] 11.1 Review the tests written in Task Groups 1-10 (the per-group 2-8 suites + the guard-rail/updated tests)
  - [x] 11.2 Analyze coverage gaps for THIS spec only — prioritize end-to-end manifest-upload workflows (e.g. a comprehensive pom → deterministic + inferred + LLM + Tier-2 all surfacing with correct precedence and badges). Do NOT assess whole-app coverage.
  - [x] 11.3 Write up to 10 additional strategic tests MAXIMUM to fill critical gaps (integration/end-to-end across resolution → derivation → inference → LLM → precedence → response/panel). Skip edge cases, performance, and accessibility unless business-critical.
  - [x] 11.4 Run ONLY this feature's targeted suites (gateway Jest manifest suites + frontend Vitest `targetManifestApi`/`ManifestUploadPanel`). Do NOT run the whole application suite.

**Acceptance Criteria:**
- All feature-specific tests pass (the per-group suites + at most 10 additional).
- Critical manifest-upload workflows for this feature are covered end-to-end.
- No more than 10 additional tests added; testing stays exclusive to this spec.

---

## Execution Order

Recommended implementation sequence (gateway/Jest unless noted):
1. Task Group 1 — Carry pom metadata through `ResolvedManifest` (root-cause fix)
2. Task Group 2 — Expand witness registry to the union answer shape (parallelizable with 1)
3. Task Group 3 — Property + plugin extractors
4. Task Group 4 — Inference layer (badged, write-immediately)
5. Task Group 5 — The ONE LLM gap-fill call (answers-51 + Tier-2)
6. Task Group 6 — Precedence + write-immediately-with-badge
7. Task Group 7 — Tier-2 persistence + response surfacing
8. Task Group 8 — Provenance wire-shape extension (gateway + frontend Vitest mirror/contract)
9. Task Group 9 — Frontend panel surfacing (frontend Vitest)
10. Task Group 10 — Guard-rail contract test + deliberate existing-test updates
11. Task Group 11 — Test review & gap analysis
