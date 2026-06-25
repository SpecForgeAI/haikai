# Task Breakdown: Confirmed Manifest Producer Wiring (Spec 5 Phase 2)

## Overview
Total Tasks: 6 task groups

Make a confirmed target dependency manifest (`pom.xml` / `package.json`) survive
durably from upload to spec-gen so the already-built carriage emits the verbatim
build file into the generated target codebase at the resolved per-module path.
Persist the bytes in a new AMS store (`target_manifest_artifacts`) and replace
the no-op production `SeedBuildFilesSource` with a real reader.

The task groups follow a STRICT DEPENDENCY ORDER: each builds on the prior, so
an implementer doing them in sequence always has its prerequisite on the tree
(AMS store -> gateway client -> persist-on-upload -> seed-story minting ->
producer + flip -> test gap review).

---

## Build & Verification Standards (READ BEFORE EVERY GROUP)

These apply to every task group below. Re-read this block before starting each one.

### Editing discipline (Write-not-Edit, clobber risk)
- Implementer subagents have **Write, not Edit**. To change ANY existing file:
  1. **Read the WHOLE file first.**
  2. Make **minimal, anchored** changes only at the intended insertion point.
  3. **Write back the COMPLETE file**, preserving everything else byte-for-byte
     (all imports, helpers, comments, ordering — nothing dropped or reflowed).
  4. After writing, **RE-READ the file and scan** for mojibake / `U+FFFD` (the
     replacement char) / NUL bytes / stray symbol corruption, and fix any found.
- This matters most on the multi-thousand-line gateway route/handler files
  (`targetManifestUpload.ts`, `migrationShapeSpecGeneration.ts`,
  `migrationSeedBuildFilesEnrichment.ts`). A careless full-file Write can
  silently truncate or corrupt them.

### Verify in ISOLATION (never gate on whole-repo green)
- Build/lint/test **only the touched module**:
  - AMS work -> its own Gradle/Maven module (`architecture-model-service`).
  - Gateway work -> the gateway package only (`gateway`).
- The **frontend/gateway whole-repo `tsc`/lint baseline is pre-existingly RED.**
  NEVER gate completion on whole-repo green. NEVER fix unrelated baseline errors —
  touch only what this spec requires.
- Run ONLY the newly-written tests for the group (plus that file's existing
  tests where cheap), NOT the entire suite.
- If a check needs a live DB / Docker / running services and **cannot run
  offline**, SAY SO in the result — do NOT claim green for something
  that did not actually run. (AMS integration tests and the true end-to-end smoke
  fall in this bucket.)

### Hard constraints (non-negotiable)
- **AMS snake_case wire default** on every new DTO / entity / controller. Apply
  `@CamelCaseWire` ONLY for a camelCase consumer — there are **none** here, so do
  NOT add it.
- **ZERO IVS change.** No new IVS endpoint, no "seed files" upload input (D8
  deferred). Do not touch the implement-verify-service module.
- **Verbatim bytes survive byte-for-byte** through store -> read -> enrichment.
  `content` and `package_lock_content` are carried unchanged as TEXT. Add
  explicit verbatim assertions at the persist seam and the read seam (no
  trimming, no trailing-newline drift, no re-encoding).
- **Non-blocking / fail-soft everywhere.** A persist hiccup at upload OR a read
  hiccup at spec-gen MUST degrade to a safe no-op and MUST NEVER break the upload
  response or the spec-gen batch.
- **No silent drops.** Anything deferred or swallowed (a caught write/read error,
  an unresolved tag, a skipped artifact) MUST be logged via the `[diag-gateway]`
  posture, AND noted in the result summary so nothing disappears silently.

### End-to-end is a LIVE-ENV gate (not an offline task)
- True end-to-end requires a live environment: an AMS write+read round-trip AND a
  real spec-gen batch carrying the seed story. None of that runs offline.
- The single acceptance smoke (LIVE-ENV gate, see Task Group 6): upload a
  manifest -> run a spec-gen batch -> confirm the seed story's spec text carries
  the **verbatim file at the resolved per-module path** (`<tag>/pom.xml` or
  `<tag>/package.json`). Mark this as the live-env gate; do NOT attempt to fake
  it offline.

---

## Task List

### AMS Persistence Layer

#### Task Group 1: AMS `target_manifest_artifacts` store (D1)
**Dependencies:** None
**Mirror exactly:** `architecture-model-service/.../{model/entity,repository,service,controller}/vulnerability/`

- [x] 1.0 Complete the AMS persistence layer (changeset + entity + repository + service + controller)
  - [x] 1.1 Write 2-8 focused AMS integration tests (Spec 1 store style)
    - Limit to 2-8 highly focused tests maximum.
    - Cover ONLY the critical lifecycle: (a) repository/service replace-latest —
      a re-write for the SAME `(project_id, target_architecture_id, tag)` flips
      the prior `is_latest=true` row to `false`, inserts a new `is_latest=true`
      row, and RETAINS the prior row (keep-history, no deletes); (b) the latest
      read filters `is_latest=true` and returns ONE row per tag; (c) verbatim
      `content` / `package_lock_content` TEXT round-trip (byte-for-byte) and
      `resolved_dependencies` JSONB round-trip; (d) `is_latest` flip is scoped
      per-tag — a sibling tag's latest is NOT demoted.
    - These need a live DB/Testcontainers; if that cannot run offline in this
      environment, write them and SAY SO (mark as live-DB-gated).
    - Skip exhaustive coverage of every finder and column.
  - [x] 1.2 Create Liquibase changeset 199 `db/changelog/sql/199-target-manifest-artifacts.sql`
    - Create table `target_manifest_artifacts`. snake_case columns: `id` UUID PK,
      `project_id` UUID NOT NULL, `target_architecture_id` UUID NOT NULL, `tag`
      TEXT NOT NULL, `kind` TEXT, `ecosystem` TEXT, `manifest_path` TEXT,
      `content` TEXT, `package_lock_content` TEXT NULLABLE, `resolved_dependencies`
      JSONB, `is_latest` BOOLEAN NOT NULL DEFAULT TRUE, `created_at` TIMESTAMPTZ
      NOT NULL DEFAULT NOW().
    - Indexes (one per read key, mirroring `vulnerability_reports`): `project_id`,
      `target_architecture_id`, `tag`, `is_latest`.
    - Copy the SQL shape from `db/changelog/sql/197-vulnerabilities.sql`.
  - [x] 1.3 Register changeset 199 in `db/changelog/db.changelog-master.yaml`
    - Register AFTER 198 (197/198 are the verified ceiling). NEVER edit an applied
      changeset.
    - Use the `not-tableExists` precondition idiom from the 197 registration
      (`db.changelog-master.yaml` ~4549-4592): `onFail: MARK_RAN`, `onError: HALT`,
      `splitStatements: true`, `stripComments: true` — clean no-op on re-run.
  - [x] 1.4 Create entity `model/entity/targetmanifest/TargetManifestArtifactEntity.java`
    - Mirror `model/entity/vulnerability/VulnerabilityReportEntity.java`: Lombok
      `@Getter/@Setter/@NoArgsConstructor/@AllArgsConstructor/@Builder`;
      `@PrePersist` default for `created_at`; `@Builder.Default private Boolean
      isLatest = TRUE`.
    - Map `resolved_dependencies` with `@Type(JsonType.class)` +
      `columnDefinition = "jsonb"` per the `VulnerabilityEntity.fixedInVersions`
      idiom (`VulnerabilityEntity.java:191-211`).
    - snake_case columns (AMS default — NO `@CamelCaseWire`); explicit
      `@Column(name = "...")` mapping each snake_case column from 1.2.
  - [x] 1.5 Create repository `repository/targetmanifest/TargetManifestArtifactRepository.java`
    - Mirror `VulnerabilityReportRepository`. Two derived finders:
      `findFirstByProjectIdAndTargetArchitectureIdAndTagAndIsLatestTrue(...)`
      (the demote target — prior latest for the triple) and
      `findByProjectIdAndTargetArchitectureIdAndIsLatestTrue(...)` (the producer
      read — one latest row per tag).
  - [x] 1.6 Create service `service/targetmanifest/TargetManifestArtifactService.java`
    - Mirror `VulnerabilityIngestionService` write posture: `@Transactional`,
      `@ConditionalOnProperty("app.features.include-database")`.
    - Replace-latest write: per artifact, find the prior latest for its
      `(project_id, target_architecture_id, tag)`, set it `is_latest=false`,
      save, then insert the new `is_latest=true` row. NO deletes; prior rows
      retained. The flip MUST be scoped per-tag (never per `(project,
      architecture)`) so sibling tags are not demoted.
    - Latest read for `(project_id, target_architecture_id)` returning the latest
      artifacts (one per tag).
  - [x] 1.7 Create controller `controller/TargetManifestArtifactController.java`
    - Mirror `VulnerabilityController`: `@RestController`,
      `@ConditionalOnProperty`, snake_case wire, project/architecture-scoped
      `@RequestMapping`.
    - WRITE: `POST /api/model/projects/{projectId}/target-architectures/{targetArchitectureId}/manifest-artifacts`
      accepting a snake_case list payload (fields: `tag`, `kind`, `ecosystem`,
      `manifest_path`, `content`, `package_lock_content`, `resolved_dependencies`).
    - READ: `GET .../manifest-artifacts` returning the latest artifacts (one per
      tag) as a snake_case list.
    - DTOs: snake_case default; do NOT add `@CamelCaseWire`.
  - [x] 1.8 Add an AMS controller integration test for the write+read endpoints
    - Within the 2-8 budget (combined with 1.1). Assert the round-trip through the
      controller: POST a list -> GET returns the latest per tag with verbatim
      `content`/`package_lock_content` and intact `resolved_dependencies`; a
      re-POST for the same triple replaces latest and keeps history.
  - [x] 1.9 Verify the AMS module IN ISOLATION
    - Compile + run ONLY the new tests (1.1, 1.8) in the `architecture-model-service`
      module. Do NOT run the whole AMS suite.
    - Verify changeset 199 is a clean no-op on re-run (precondition idiom).
    - If the integration tests require a live DB/Testcontainers that cannot run
      offline here, SAY SO in the result rather than claiming green.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1/1.8 pass (or are explicitly marked live-DB-gated
  if they cannot run offline).
- Changeset 199 registers after 198 with the `not-tableExists` no-op idiom; no
  applied changeset edited.
- Entity/repository/service/controller mirror the `vulnerability/` packages;
  snake_case wire; no `@CamelCaseWire`.
- Replace-latest / keep-history lifecycle works and the `is_latest` flip is
  scoped per `(project_id, target_architecture_id, tag)`.
- Verbatim `content`/`package_lock_content` and `resolved_dependencies` JSONB
  round-trip intact.

---

### Gateway -> AMS Client Layer

#### Task Group 2: Gateway -> AMS client `targetManifestArtifactsClient.ts` (D1 client)
**Dependencies:** Task Group 1
**Model on:** `gateway/src/services/targetStateCapturedDecisionsClient.ts`

- [x] 2.0 Complete the typed read + write gateway -> AMS client
  - [x] 2.1 Write 2-8 focused tests for the client
    - Limit to 2-8 highly focused tests maximum.
    - Cover ONLY: (a) the write seam POSTs the correct snake_case body to the
      write URL; (b) the read seam GETs the read URL and maps the snake_case wire
      response to the typed interface (verbatim `content`/`package_lock_content`
      preserved); (c) path params are `encodeURIComponent`-escaped.
    - Stub `fetch` / the HTTP layer; no live AMS required.
    - Skip exhaustive error-matrix coverage.
  - [x] 2.2 Create `gateway/src/services/targetManifestArtifactsClient.ts`
    - Mirror the thin-wrapper posture of `targetStateCapturedDecisionsClient.ts`:
      use `getConfig().architectureModelServiceBaseUrl`, `encodeURIComponent` for
      `projectId` / `targetArchitectureId` path params.
    - Define typed wire interfaces mirroring the AMS DTOs from 1.7 (snake_case
      field names on the wire interface).
    - WRITE seam: POST the artifacts list to
      `.../projects/{projectId}/target-architectures/{targetArchitectureId}/manifest-artifacts`.
    - READ seam: GET the latest artifacts list from the same path; return the
      typed list (one per tag).
    - Keep the client itself thin; fail-soft posture lives at the CALLERS
      (Pieces 2 and 4), matching the captured-decisions client's caller-degrades
      pattern. Do NOT swallow errors inside the client in a way that hides them
      from callers — let callers catch/log.
  - [x] 2.3 Verify the client IN ISOLATION
    - Run ONLY the 2.1 tests in the gateway package. Do NOT run the whole gateway
      suite; do NOT gate on the RED whole-repo `tsc`/lint baseline.
    - After any file Write, re-read and scan for mojibake/NUL.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- Write seam POSTs the correct snake_case payload; read seam returns the typed
  latest-per-tag list with verbatim content preserved.
- Thin-wrapper posture matches `targetStateCapturedDecisionsClient.ts`;
  errors surface to callers (no client-internal silent swallow).

---

### Gateway Persist-on-Upload Layer

#### Task Group 3: Gateway persist-on-upload (D2)
**Dependencies:** Task Group 2
**Touch:** `gateway/src/routes/targetManifestUpload.ts` (~line 403)

- [x] 3.0 Add the fail-soft AMS-write call at upload (must NEVER break the upload response)
  - [x] 3.1 Write 2-8 focused route tests (STUBBED AMS write seam)
    - Limit to 2-8 highly focused tests maximum.
    - Mirror the existing `processManifestUpload` dep-stub / partial-failure tests
      (inject the AMS write seam as a stubbed dependency, same posture as the
      existing dep stubs).
    - Cover ONLY: (a) on a successful upload the persist is ATTEMPTED with the
      correctly-mapped snake_case payload (field mapping asserted: `content` ->
      `content`, `packageLockContent` -> `package_lock_content`, `manifestPath`
      -> `manifest_path`, `resolvedDependencies` -> `resolved_dependencies`,
      plus `tag`/`ecosystem`/`kind`); keyed by `(projectId,
      targetArchitectureId, tag)`; (b) FAIL-SOFT — a write hiccup (stub throws)
      is swallowed + logged and the upload response is UNCHANGED (`autoAnswer`
      exactly as today).
    - Skip exhaustive payload permutations.
  - [x] 3.2 Read the WHOLE `targetManifestUpload.ts` before editing
    - It is a large route file; Write-not-Edit means you must preserve every byte
      outside the insertion point.
  - [x] 3.3 Add the fail-soft persist call immediately after `confirmedManifests` is built (~line 403/403-419)
    - Key by `(projectId, targetArchitectureId, tag)` from `args.projectId` +
      `args.targetArchitectureId`.
    - Map the verified `ConfirmedManifestArtifact` fields
      (`manifestHandoffs.ts:104` — `tag`, `ecosystem`, `kind`, `manifestPath`,
      `content`, `packageLockContent`, `resolvedDependencies`) onto the
      snake_case payload from Task Group 2. Carry `content` and
      `packageLockContent` VERBATIM (byte-for-byte, no trim/re-encode);
      `resolvedDependencies` element shape is `ResolvedDependency`
      (`targetManifest/manifestVersionResolution.ts:56`).
    - Wrap in try/catch; log via the `[diag-gateway]` posture on failure. The
      write MUST NOT alter or block the upload response — the response always
      carries `autoAnswer` exactly as today.
    - Do NOT wire the conversation-CLOSE promotion (`writeTargetTechStackMarkdown`,
      `architectConversation.ts:871`) — OUT OF SCOPE (D7); leave it as the noted
      deferred seam only.
    - NOTE in the result that this also mints the seed story (Task Group 4) at the
      same confirm point — keep the two calls independently fail-soft so one
      failing never affects the other or the response.
  - [x] 3.4 Re-read after writing; scan for mojibake / U+FFFD / NUL and fix
  - [x] 3.5 Verify IN ISOLATION
    - Run ONLY the 3.1 tests in the gateway package. Do NOT run the whole suite;
      do NOT gate on the RED whole-repo baseline.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass.
- The persist is attempted with the correctly-mapped snake_case payload, keyed by
  `(projectId, targetArchitectureId, tag)`, with verbatim content.
- A write hiccup is swallowed + logged and the upload response is byte-identical
  to today (`autoAnswer` unchanged) — fail-soft proven.
- `targetManifestUpload.ts` is otherwise byte-preserved (no clobber); no mojibake/NUL.

---

### Gateway Seed-Story Minting Layer

#### Task Group 4: Gateway seed-story minting (D3)
**Dependencies:** Task Group 3
**Touch:** `gateway/src/routes/migrationShapeSpecGeneration.ts` (add-item path ~637-766; suppress trigger ~727-738)

- [x] 4.0 Mint the dedicated `seed_build_files` story (FIRST-sequenced, replace-in-place, suppressed trigger)
  - [x] 4.1 Write 2-8 focused unit tests for minting
    - Limit to 2-8 highly focused tests maximum.
    - Cover ONLY: (a) the add mints a work item with `kind='seed_build_files'`
      (the `SEED_BUILD_FILES_STORY_KIND` marker the handler recognises); (b)
      FIRST sequencing — `sequence_order = 0` (or below the current min); (c)
      replace-in-place on re-upload/re-confirm — the existing `seed_build_files`
      story for the book of work is UPDATED, not duplicated (assert no second
      FIRST-sequenced story appears); (d) the description-grounded spec-gen
      trigger (`runShapeSpecGenerationBatch`) is SUPPRESSED for EXACTLY this kind,
      and is STILL FIRED for an ordinary `api`/`operational` manual add (assert
      both halves so suppression is not over-broad).
    - Stub the AMS add-item seam and the batch trigger; no live AMS required.
    - Skip exhaustive sequencing permutations.
  - [x] 4.2 Read the WHOLE `migrationShapeSpecGeneration.ts` before editing
    - Large route file; preserve every byte outside the insertion points.
  - [x] 4.3 Reuse the add-item path to mint the seed story
    - Reuse the existing add-item mechanism (`migrationShapeSpecGeneration.ts:637-766`;
      AMS `AddWorkItemRequest` / `POST .../items/add-item` behind it) with
      `kind='seed_build_files'`. Payload fields available: `kind`, `title`,
      `sequence_order`, `description`.
    - Sequence FIRST: `sequence_order = 0` (or below current min) so the seed
      story is the first eligible story (the carriage requires write-first
      ordering).
  - [x] 4.4 Suppress the spec-gen trigger for `seed_build_files` ONLY
    - Do NOT fire `runShapeSpecGenerationBatch(...)` (the call at
      `migrationShapeSpecGeneration.ts:727-738`) for a `seed_build_files` add —
      the seed story is filled by the existing enrichment carriage, not a
      generated description.
    - Scope the suppression to EXACTLY `kind='seed_build_files'` so ordinary
      `api`/`operational` manual-add generation is untouched.
  - [x] 4.5 Implement replace-in-place idempotency
    - On re-upload/re-confirm, UPDATE the existing `seed_build_files` story for
      the book of work rather than appending a duplicate. The match scope (book of
      work + `kind='seed_build_files'`) MUST be unambiguous to avoid a duplicate
      FIRST-sequenced story.
  - [x] 4.6 Re-read after writing; scan for mojibake / U+FFFD / NUL and fix
  - [x] 4.7 Verify IN ISOLATION
    - Run ONLY the 4.1 tests in the gateway package. Do NOT run the whole suite;
      do NOT gate on the RED whole-repo baseline.

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass.
- The `kind='seed_build_files'` add is FIRST-sequenced (`sequence_order=0`/below min).
- Re-upload replaces the existing seed story in place (no duplicate FIRST-sequenced story).
- The spec-gen trigger is suppressed for `seed_build_files` ONLY; ordinary
  `api`/`operational` manual-add generation still fires.
- `migrationShapeSpecGeneration.ts` is otherwise byte-preserved; no mojibake/NUL.

---

### Gateway Producer + Flip Layer

#### Task Group 5: Gateway real producer + one-line flip (D6)
**Dependencies:** Task Groups 1, 2, 4
**Touch:** new real `SeedBuildFilesSource`; flip `productionDeps.seedBuildFilesSource` at `migrationShapeSpecGeneration.ts:93`

- [x] 5.0 Implement the real `SeedBuildFilesSource` and swap it into productionDeps
  - [x] 5.1 Write 2-8 focused unit tests for the producer (STUBBED AMS read)
    - Limit to 2-8 highly focused tests maximum.
    - Inject a stubbed AMS read returning persisted artifacts. Cover ONLY:
      (a) the bundle output — `confirmedArtifactsToSeedBundle` produces correct
      per-tag `<tag>/` placement with VERBATIM content; (b) distinct tags resolve
      independently; (c) the NO-OP path — `targetArchitectureId` absent OR the
      read returns nothing -> source returns `null`; (d) FAIL-SOFT — a read
      hiccup (stub throws) is caught + logged and degrades to `null` (no throw
      into the batch).
    - Skip exhaustive placement/layout permutations.
  - [x] 5.2 Implement the real `SeedBuildFilesSource`
    - Signature: `(input: { projectId; bookOfWorkId; targetArchitectureId? }) =>
      Promise<ConfirmedManifestBundle | null>` (contract at
      `migrationSeedBuildFilesEnrichment.ts:139`).
    - Read the persisted LATEST artifacts for `(projectId, targetArchitectureId)`
      via the Task Group 2 client.
    - Build the `ServiceModuleMapping` by the v1 convention `tag -> <tag>/` with
      `layout='monorepo'` (`DEFAULT_TARGET_ARCHITECTURE_LAYOUT`,
      `seedBuildFileDestination.ts:46`). Each artifact's `tag` maps to placement
      `{ moduleDir: '<tag>/' }` (or layout-agnostic `dir`); distinct tags resolve
      independently. An unresolved tag still carries the file verbatim with the
      existing "destination unresolved" notice — NO path guessing, NO silent drop
      (`seedBuildFileDestination.ts` degrades gracefully; log any unresolved tag).
    - Return `confirmedArtifactsToSeedBundle(artifacts, mapping, layout)`
      (`migrationSeedBuildFilesEnrichment.ts:252`) — or `null`.
  - [x] 5.3 Implement the safe no-op + fail-soft paths
    - Return `null` when `targetArchitectureId` is absent or the read returns
      nothing. Catch read hiccups, log them, degrade to `null` — never throw into
      the batch (consistent with `resolveSeedBuildFilesEnrichment`'s try/catch at
      `migrationSeedBuildFilesEnrichment.ts:409`).
  - [x] 5.4 Read the WHOLE `migrationShapeSpecGeneration.ts`, then flip the production dep
    - Swap the real source into `productionDeps.seedBuildFilesSource` at
      `migrationShapeSpecGeneration.ts:93` (currently
      `defaultProductionSeedBuildFilesSource`). This is the ONLY change to the
      consumer-side carriage — do NOT rebuild or alter the rest of the carriage.
  - [x] 5.5 Re-read after writing; scan for mojibake / U+FFFD / NUL and fix
  - [x] 5.6 Verify IN ISOLATION
    - Run ONLY the 5.1 tests in the gateway package. Do NOT run the whole suite;
      do NOT gate on the RED whole-repo baseline.

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass.
- Stubbed AMS read -> bundle with correct per-tag `<tag>/` placement and verbatim
  content; distinct tags resolve independently.
- No-op path returns `null` when `targetArchitectureId` is absent or read is empty.
- A read hiccup degrades to `null` (no throw into the batch).
- `productionDeps.seedBuildFilesSource` now points at the real source; no other
  carriage change; file otherwise byte-preserved; no mojibake/NUL.

---

### Testing

#### Task Group 6: Test review & gap analysis (feature-scoped) + live-env acceptance gate
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests, fill ONLY critical feature gaps, and document the live-env smoke
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the AMS tests (1.1, 1.8), the client tests (2.1), the persist route
      tests (3.1), the minting tests (4.1), and the producer tests (5.1).
    - Total existing feature tests: approximately 10-40.
  - [x] 6.2 Analyze coverage gaps for THIS feature ONLY
    - Identify critical cross-seam workflows that lack coverage, focused
      EXCLUSIVELY on this spec: verbatim-bytes fidelity across the persist seam ->
      read seam (no trailing-newline/encoding drift); the seam-to-seam payload
      mapping contract (gateway snake_case payload matches the AMS controller
      DTO); the per-tag `is_latest` independence; fail-soft at BOTH the upload
      persist and the spec-gen read.
    - Do NOT assess whole-application coverage; do NOT chase the RED whole-repo
      baseline.
  - [x] 6.3 Write up to 10 additional strategic tests MAXIMUM (only if needed)
    - Add at most 10 new tests to fill identified critical gaps — prioritize
      integration/contract points (verbatim fidelity, payload-shape contract,
      per-tag flip independence, dual fail-soft) over unit edge cases.
    - Skip edge cases, performance, and accessibility unless business-critical.
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY this spec's tests (from 1.1, 1.8, 2.1, 3.1, 4.1, 5.1, and 6.3) in
      their respective modules (AMS in its module, gateway in its package).
    - Do NOT run the entire application test suite; do NOT gate on whole-repo green.
    - AMS integration tests that need a live DB/Testcontainers: if they cannot run
      offline here, SAY SO rather than claim green.
  - [x] 6.5 Document the LIVE-ENV acceptance smoke (do NOT fake it offline)
    - Record the one acceptance gate as a live-env step: upload a manifest -> run
      a spec-gen batch -> confirm the seed story's spec text carries the VERBATIM
      file at the resolved per-module path (`<tag>/pom.xml` or
      `<tag>/package.json`).
    - Note in the result that this gate requires a live AMS round-trip + a real
      spec-gen batch and therefore cannot be satisfied by the offline isolation
      tests. Log/flag it explicitly as outstanding until run in a live env.

**Acceptance Criteria:**
- All feature-specific tests pass in isolation (approximately 10-50 total), OR
  any that require a live DB are explicitly marked live-gated (not claimed green).
- No more than 10 additional tests added in 6.3.
- Critical feature workflows covered: verbatim fidelity (persist + read),
  payload-shape contract, per-tag `is_latest` independence, dual fail-soft.
- The live-env acceptance smoke is documented and flagged as the outstanding
  acceptance gate (not run offline).
- Testing focused EXCLUSIVELY on this spec; the RED whole-repo baseline is not chased.

---

## Execution Order

Recommended implementation sequence (STRICT — each builds on the prior so the
prerequisite is always on the tree):

1. **AMS `target_manifest_artifacts` store** (Task Group 1) — changeset 199 +
   entity + repository + service + controller; the durable home for the bytes.
2. **Gateway -> AMS client** (Task Group 2) — typed read + write wrapper; needs
   the AMS endpoints from Group 1.
3. **Gateway persist-on-upload** (Task Group 3) — fail-soft write at upload; needs
   the client from Group 2.
4. **Gateway seed-story minting** (Task Group 4) — FIRST-sequenced
   `seed_build_files` story with suppressed trigger + replace-in-place; minted at
   the same confirm point as Group 3.
5. **Gateway real producer + flip** (Task Group 5) — real `SeedBuildFilesSource`
   reading the persisted latest artifacts, then the one-line `productionDeps`
   flip; needs the client (Group 2) and the minted seed story (Group 4).
6. **Test review & gap analysis + live-env gate** (Task Group 6) — fill only
   critical feature gaps; document the live-env acceptance smoke as the
   outstanding gate.

**Live-env gate (not an offline task):** the single acceptance smoke — upload a
manifest -> run a spec-gen batch -> seed story spec text carries the verbatim
file at the resolved per-module path — requires a live AMS round-trip and a real
spec-gen batch. It is the acceptance gate, not an offline deliverable.

---

## Known cross-layer gaps (follow-up)

These are real, discovered cross-layer integration gaps of the class the spec
flags as "caught only by the live smoke". The gateway side is built correctly per
spec; each gap requires a change OUTSIDE this gateway-only feature to fully close.
Both are already documented in the `migrationSeedStoryMinting.ts` file header and
exercised fail-soft by the Task Group 4 tests (an AMS `kind` 400 and a
no-book-yet skip both degrade to a logged SKIP). Recorded here so they live in the
spec's own docs, not just chat.

1. **MINTING TIMING — book of work must already exist at confirm time.**
   The AMS add-item mechanism mints into a SPECIFIC book of work
   (`POST .../migration-books-of-work/:bookId/items/add-item`). The minting path
   resolves the book for `(projectId, targetArchitectureId)` from the AMS
   book-of-work list; if NO book exists yet it SKIPS-WITH-LOG
   (`reason=no_book_of_work_yet follow_up=mint_from_book_generation_path`) and
   never invents a bookId. Because books of work are typically generated LATER in
   the workflow than manifest upload, at confirm time there is usually no book, so
   the seed story is NOT minted at upload. **Follow-up:** re-drive the seed-story
   minting from the book-of-work generation path (which already has the bookId in
   hand), so the seed story is created when the book first appears as well as on a
   later re-confirm. Until then, the seed story is minted only when a book already
   exists for that target architecture at upload time.

2. **AMS KIND ALLOW-LIST — `kind='seed_build_files'` is 400-rejected today.**
   The AMS add-item service validates `kind` against
   `GeneratedMigrationBookOfWorkService.ALLOWED_KINDS`, which currently admits
   EXACTLY `{api, operational}` and 400-rejects any other kind. So a
   `kind='seed_build_files'` add is rejected by today's AMS. The gateway catches
   that 400 fail-soft and logs it
   (`seed_story_mint_failed ... reason=add_item_failed`) with no upload impact —
   i.e. the seed story is effectively a SKIP-WITH-LOG until AMS admits the kind.
   **Follow-up (AMS-side):** add `seed_build_files` to `ALLOWED_KINDS` (an AMS
   change, outside this gateway-only task group) so the minted seed story is
   actually persisted onto the book of work.

> Net effect for v1: the persist-on-upload (Task Group 3) and the real producer +
> flip (Task Group 5) are fully wired end-to-end — once a seed story exists on the
> book, the producer reads the persisted latest artifacts and emits the verbatim
> build file at `<tag>/pom.xml` / `<tag>/package.json`. The two gaps above gate
> only the AUTOMATIC creation/persistence of the seed STORY itself; both are
> fail-soft (never break the upload) and are the kind of cross-layer wiring the
> live-env acceptance smoke is designed to surface.

### Follow-up resolution (2026-06-25 — GATEWAY): mint at book creation + read proxy

Both gaps above are CLOSED on the gateway side by relocating the seed-story
minting from manifest-UPLOAD time to BOOK-OF-WORK CREATION time, and adding a
gateway READ proxy so the browser can list a target architecture's persisted
manifests. No AMS change was required.

- [x] A. **Mint the seed story at book creation (relocation).** In
  `gateway/src/services/migrationBookOfWorkHandler.ts`,
  `generateMigrationBookOfWork` now PREPENDS a single FIRST-sequenced
  (`sequenceOrder: 0`) `seed_build_files` story onto `validated.items` —
  immediately before the AMS create body build, AFTER the assembly's 1..N
  renumber — IFF a confirmed manifest exists for `targetArchitectureId`. The
  gate is the injectable `fetchTargetManifestArtifacts` dep (production default
  = `fetchLatestTargetManifestArtifacts`); >= 1 artifact -> prepend. The seed
  rides the initial `book_of_work_json` blob that AMS `createDraft` persists
  WITHOUT per-item kind validation, so it SIDESTEPS the AMS `ALLOWED_KINDS` 400
  (gap #2) entirely, and it is minted exactly where the bookId/items are minted
  (gap #1). FAIL-SOFT: a read throw OR an absent `targetArchitectureId` logs via
  `[diag-gateway]` and skips the seed — book creation is never broken.
  Idempotency is intrinsic (fresh book per generation). The seed carries the
  `SEED_BUILD_FILES_STORY_KIND` marker `isSeedBuildFilesStory` recognises.
- [x] B. **Remove the dormant upload-time mint.** In
  `gateway/src/routes/targetManifestUpload.ts` the `MintSeedStorySeam` /
  `defaultMintSeedStory` wiring + the fail-soft mint invocation were removed
  (relocation noted in a comment). The Task Group 3 PERSIST call is UNCHANGED
  (manifest bytes are still saved at upload so the creation-time gate has data
  to read). `gateway/src/services/migrationSeedStoryMinting.ts` is left in place
  (now superseded/unused by production) with a one-line header note; not deleted
  (avoids churn).
- [x] C. **Gateway READ proxy for manifest-artifacts.** Added a thin
  pass-through GET (modeled on the `migrationBookOfWork.ts` GET proxy) in
  `registerTargetManifestUploadRoute` (mounted on `architectConversationRouter`
  at `/api`):
  `GET /api/projects/:projectId/target-architectures/:targetArchitectureId/manifest-artifacts`
  -> proxies the AMS latest-per-tag list via the injectable read seam
  (`fetchLatestTargetManifestArtifacts`). Round-trips the snake_case list
  (`manifest_path`, `tag`, `kind`, ...). Fail-soft: AMS-unreachable / non-2xx
  -> 503 (logged; no silent drop).
- [x] Tests (gateway, in isolation):
  `src/__tests__/migrationBookOfWorkSeedAtCreation.test.ts` (seed prepended
  FIRST when the stubbed read returns artifacts; NOT prepended when empty;
  fail-soft when the read throws — book creation still succeeds, no seed) and
  `src/__tests__/targetManifestArtifactsGetProxy.test.ts` (GET returns the
  stubbed AMS list / empty list; fail-soft 503 on read error). Gateway
  `tsc --noEmit` stayed GREEN; the new + affected suites pass in isolation.

> RESIDUAL (still LIVE-ENV): the end-to-end acceptance smoke below is unchanged
> — it still needs a live AMS round-trip + a real spec-gen batch. The relocation
> makes the seed story appear automatically when the book is generated (given a
> confirmed manifest persisted at upload), which is what the live smoke exercises.

---

## Live-env acceptance smoke (OUTSTANDING — not satisfiable offline)

The single acceptance gate for this spec is a LIVE-ENV smoke and was NOT run
offline (it cannot be — it needs a live AMS write+read round-trip AND a real
spec-gen batch). Flagged here as the outstanding acceptance gate:

**Steps:**
1. With AMS + gateway running against a real database, upload a target dependency
   manifest (`pom.xml` and/or `package.json`) for a project keyed by a
   `targetArchitectureId` (the upload route persists the verbatim bytes to
   `target_manifest_artifacts` — Task Group 3 — and attempts to mint the seed
   story — Task Group 4, subject to the two gaps above).
2. Ensure a book of work exists for that `(projectId, targetArchitectureId)` and
   that it carries a FIRST-sequenced `seed_build_files` story (mint it via the
   book-of-work path if the upload-time mint was skipped per gap #1, and ensure
   AMS admits the kind per gap #2).
3. Run a spec-gen batch for that book of work.
4. **Assert:** the `seed_build_files` story's generated spec text carries the
   VERBATIM uploaded file, byte-for-byte, at the resolved per-module path
   (`<tag>/pom.xml` or `<tag>/package.json`), inside the seed write block's
   BEGIN/END sentinels.

Until this is run in a live environment, the end-to-end wiring is proven only by
the per-layer offline isolation tests + the cross-seam tests (which together
prove every gateway adapter and the AMS store round-trip, but cannot prove the
live AMS<->gateway HTTP round-trip or the real spec-gen batch). This is the
documented residual acceptance risk.
