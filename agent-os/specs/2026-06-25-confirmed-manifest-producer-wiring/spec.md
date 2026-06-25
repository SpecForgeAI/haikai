# Specification: Confirmed Manifest Producer Wiring (Spec 5 Phase 2)

## Goal
Make a confirmed target dependency manifest (`pom.xml` / `package.json`) survive durably from upload to spec-gen so the already-built carriage emits the verbatim build file into the generated target codebase at the resolved per-module path — by persisting the bytes in a new AMS store and replacing the no-op production `SeedBuildFilesSource` with a real reader.

## User Stories
- As a migration architect, I want my confirmed target manifest to flow verbatim into the generated codebase so the curated CVE-reducing dependency versions land exactly as uploaded, written first and built on top of.
- As a platform engineer, I want manifest persistence and the spec-gen read to be fail-soft so a store hiccup never breaks the upload response or the spec-gen batch.

## Specific Requirements

**Problem / the no-op gap (context — not a build item)**
- The consumer-side carriage is 100% complete + tested; this spec consumes it and changes it only via the single-line `productionDeps` flip (D6).
- Spec 3 builds `ConfirmedManifestArtifact[]` at upload (`buildConfirmedManifestArtifacts`, returned on `autoAnswer.confirmedManifests` at `gateway/src/routes/targetManifestUpload.ts:403`) but the verbatim bytes live only in the HTTP response and are then dropped — no durable store.
- At spec-gen (a separate, later request) `defaultProductionSeedBuildFilesSource` (`gateway/src/services/migrationSeedBuildFilesEnrichment.ts:156`) honestly returns `null` because nothing durable holds the bytes.
- Alignment that makes wiring tractable: manifests are uploaded keyed by `targetArchitectureId`; the spec-gen batch reads `bow.targetArchitectureId` — the SAME key. A store keyed by `(project_id, target_architecture_id, tag)` is writable at upload and readable at spec-gen with no new consumer-side threading.

**Piece 1 — AMS: new `target_manifest_artifacts` store (D1)**
- Single new table (NOT a two-table split, NOT the captured-decisions store) via **Liquibase changeset 199** (`db/changelog/sql/199-target-manifest-artifacts.sql`); 197/198 are the verified ceiling. Register AFTER 198 in `db/changelog/db.changelog-master.yaml` using the `not-tableExists` precondition idiom (`onFail: MARK_RAN`, `onError: HALT`, `splitStatements: true`, `stripComments: true`) — clean no-op on re-run; never edit applied changesets.
- Newest-per-`(project_id, target_architecture_id, tag)` wins via an `is_latest` flip (replace-latest, keep-history, append-only, NO deletes) — mirror `VulnerabilityReportEntity` / `VulnerabilityIngestionService` lifecycle exactly: on (re-)upload, find the prior `is_latest=true` row for the triple, set it `false`, save, then insert the new `is_latest=true` row; prior rows retained.
- Entity in `model/entity/targetmanifest/TargetManifestArtifactEntity.java` mirroring `model/entity/vulnerability/VulnerabilityReportEntity.java` (Lombok `@Getter/@Setter/@NoArgsConstructor/@AllArgsConstructor/@Builder`; `@PrePersist` default for `created_at`; `@Builder.Default` `is_latest = TRUE`; `@Type(JsonType.class)` + `columnDefinition = "jsonb"` for `resolved_dependencies` per the `VulnerabilityEntity.fixedInVersions` idiom). snake_case columns (AMS default, NO `@CamelCaseWire`): `id` UUID PK, `project_id` UUID NOT NULL, `target_architecture_id` UUID NOT NULL, `tag` TEXT NOT NULL, `kind` TEXT, `ecosystem` TEXT, `manifest_path` TEXT, `content` TEXT (verbatim), `package_lock_content` TEXT NULLABLE, `resolved_dependencies` JSONB, `is_latest` BOOLEAN NOT NULL DEFAULT TRUE, `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW().
- Indexes (one per read key, mirroring `vulnerability_reports`): `project_id`, `target_architecture_id`, `tag`, `is_latest`.
- Repository in `repository/targetmanifest/TargetManifestArtifactRepository.java` (mirror `VulnerabilityReportRepository`): derived finder for the prior-latest-per-triple demote `findFirstByProjectIdAndTargetArchitectureIdAndTagAndIsLatestTrue(...)`, and the latest read for the producer `findByProjectIdAndTargetArchitectureIdAndIsLatestTrue(...)` (returns one latest row per tag).
- Service in `service/targetmanifest/TargetManifestArtifactService.java` (mirror `VulnerabilityIngestionService` write posture, `@Transactional`, `@ConditionalOnProperty("app.features.include-database")`): a replace-latest write that, per artifact, demotes the prior latest for its `(project_id, target_architecture_id, tag)` then inserts the new latest; and a latest read for `(project_id, target_architecture_id)`.
- Controller in `controller/TargetManifestArtifactController.java` (mirror `VulnerabilityController`: `@RestController`, `@ConditionalOnProperty`, snake_case wire). WRITE `POST /api/model/projects/{projectId}/target-architectures/{targetArchitectureId}/manifest-artifacts` accepting a snake_case list payload (see persist payload below); READ `GET .../manifest-artifacts` returning the latest artifacts (one per tag) as a snake_case list.
- Gateway→AMS client `gateway/src/services/targetManifestArtifactsClient.ts` for both endpoints — model the read idiom + thin-wrapper posture on `gateway/src/services/targetStateCapturedDecisionsClient.ts` (typed wire interfaces mirroring the AMS DTO, `getConfig().architectureModelServiceBaseUrl`, `encodeURIComponent` path params), plus the writer POST seam.

**Piece 2 — Gateway: persist-on-upload (D2)**
- Add a fail-soft AMS-write call in `gateway/src/routes/targetManifestUpload.ts` immediately after `confirmedManifests` is built (~line 403 / 403-419), keyed by `(projectId, targetArchitectureId, tag)` from `args.projectId` + `args.targetArchitectureId`.
- Persist payload maps the verified `ConfirmedManifestArtifact` fields (`manifestHandoffs.ts:104` — `tag`, `ecosystem`, `kind`, `manifestPath`, `content`, `packageLockContent`, `resolvedDependencies`) onto the snake_case store columns: `content` → `content`, `packageLockContent` → `package_lock_content` (both carried VERBATIM as TEXT, byte-for-byte), `manifestPath` → `manifest_path`, `resolvedDependencies` → `resolved_dependencies` (JSONB; element shape `ResolvedDependency` from `targetManifest/manifestVersionResolution.ts:56`).
- Fail-soft: the write is wrapped in try/catch, logged via the `[diag-gateway]` posture, and NEVER alters or blocks the upload response (mirror the existing `processManifestUpload` dep-stub / partial-failure posture — the response always carries `autoAnswer` exactly as today).
- Confirm trigger = latest upload (v1). The richer conversation-CLOSE promotion (`writeTargetTechStackMarkdown` at `gateway/src/routes/architectConversation.ts:871`, already fail-soft) is OUT OF SCOPE — noted as the deferred seam, not wired.

**Piece 3 — Gateway: mint the dedicated seed-build-files story (D3)**
- On confirm (= upload), reuse the add-item mechanism (`gateway/src/routes/migrationShapeSpecGeneration.ts:637-766`; AMS `AddWorkItemRequest` / `POST .../items/add-item` behind it) to mint a work item with `kind='seed_build_files'` (the marker `SEED_BUILD_FILES_STORY_KIND` the handler recognises).
- SUPPRESS the description-grounded spec-gen trigger for this kind: do NOT fire `runShapeSpecGenerationBatch(...)` (the call at `migrationShapeSpecGeneration.ts:727-738`) for a `seed_build_files` add. The seed story is filled by the existing enrichment carriage, not a generated description. Scope the suppression to EXACTLY `kind='seed_build_files'` so ordinary `api`/`operational` manual-add generation is untouched.
- Sequence FIRST: `sequence_order = 0` (or below the current min) so the seed story is the first eligible story (the carriage requires write-first ordering).
- Idempotency = replace-in-place: on re-upload/re-confirm, update the existing `seed_build_files` story for the book of work rather than appending a duplicate. The match scope (book of work + `kind='seed_build_files'`) must be unambiguous to avoid a duplicate FIRST-sequenced story.

**Piece 4 — Gateway: real producer + one-line flip (D6)**
- Implement a real `SeedBuildFilesSource` (signature: `(input: { projectId; bookOfWorkId; targetArchitectureId? }) => Promise<ConfirmedManifestBundle | null>`, contract at `migrationSeedBuildFilesEnrichment.ts:139`) that: reads the persisted LATEST artifacts for `(projectId, targetArchitectureId)` via the Piece-1 gateway client; builds the `ServiceModuleMapping` by the v1 convention `tag → <tag>/` with `layout='monorepo'` (`DEFAULT_TARGET_ARCHITECTURE_LAYOUT`, `seedBuildFileDestination.ts:46`); and returns `confirmedArtifactsToSeedBundle(artifacts, mapping, layout)` (`migrationSeedBuildFilesEnrichment.ts:252`) — or `null`.
- Returns `null` (the safe no-op) when `targetArchitectureId` is absent or the read returns nothing; is fail-soft — a read hiccup is caught + logged and degrades to `null`, never throwing into the batch (consistent with `resolveSeedBuildFilesEnrichment`'s own try/catch at `migrationSeedBuildFilesEnrichment.ts:409`).
- Convention mapping per D4/D5: each artifact's `tag` maps to placement `{ moduleDir: '<tag>/' }` (or layout-agnostic `dir`); distinct tags resolve independently; an unresolved tag still carries the file verbatim with the existing "destination unresolved" notice (`seedBuildFileDestination.ts` degrades gracefully — no path guessing, no silent drop).
- Flip: swap the real source into `productionDeps.seedBuildFilesSource` at `gateway/src/routes/migrationShapeSpecGeneration.ts:93` (currently `defaultProductionSeedBuildFilesSource`). This is the ONLY change to the consumer-side carriage.

**Hard constraints (non-negotiable — bake in)**
- AMS snake_case wire default on all new DTOs/entity/controller; apply `@CamelCaseWire` ONLY if a camelCase consumer appears — none here.
- ZERO IVS change: no new IVS endpoint, no "seed files" upload input (D8 deferred).
- Verbatim bytes survive byte-for-byte through store → read → enrichment (`content` and `package_lock_content` carried unchanged as TEXT; explicit verbatim assertions at the persist + read seams).
- Non-blocking / fail-soft everywhere: a persist hiccup at upload OR a read hiccup at spec-gen degrades to a safe no-op and NEVER breaks the upload response or the batch.
- Frontend/gateway whole-repo tsc/lint baseline is pre-existingly RED → verify all affected work in ISOLATION (per-file/per-module), not via a whole-repo build.
- Implementer subagents have Write-not-Edit (clobber risk) on the multi-thousand-line gateway route/handler files → anchored read-whole-file-then-write edits + a post-write mojibake/NUL scan are mandatory (note for `tasks.md`).

## Visual Design
No visual assets provided. The mandatory `planning/visuals/` check returned no files — this is backend wiring across AMS + gateway with no UI surface.

## Existing Code to Leverage

**AMS vulnerability store — the lifecycle to mirror (Piece 1 model)**
- `architecture-model-service/.../model/entity/vulnerability/VulnerabilityReportEntity.java` — canonical "replace latest, keep history" `is_latest` entity (per `(project_id, architecture_id, source)`; this store keys per `(project_id, target_architecture_id, tag)`); `@PrePersist` default, `@Builder.Default` `is_latest`.
- `.../repository/vulnerability/VulnerabilityReportRepository.java` — derived finders `findFirstBy...AndIsLatestTrue` (demote target) + `findBy...AndIsLatestTrue...` (latest read).
- `.../service/vulnerability/VulnerabilityIngestionService.java` — the demote-prior-latest-then-insert `@Transactional` write idiom to replicate.
- `.../controller/VulnerabilityController.java` — `@ConditionalOnProperty` + snake_case + project/architecture-scoped `@RequestMapping` shape for the write+read endpoints.
- `.../model/entity/vulnerability/VulnerabilityEntity.java:191-211` — the `@Type(JsonType.class)` + `columnDefinition = "jsonb"` idiom for `resolved_dependencies`.
- `db/changelog/sql/197-vulnerabilities.sql` + `db.changelog-master.yaml:4549-4592` — the changeset SQL + `not-tableExists` registration idiom to copy for 199.

**Gateway consumer-side carriage — 100% complete + tested (consume; do NOT rebuild)**
- `gateway/src/services/migrationSeedBuildFilesEnrichment.ts` — `SeedBuildFilesSource` contract (:139), no-op default (:156, the flip target's current value), `confirmedArtifactsToSeedBundle` (:252), `resolveSeedBuildFilesEnrichment` fail-soft seam (:409). Piece 4 implements the real source against this contract and flips :156→real at the route.
- `gateway/src/services/seedBuildFileDestination.ts` — `ServiceModuleMapping`/`ServiceModulePlacement`, `DEFAULT_TARGET_ARCHITECTURE_LAYOUT='monorepo'` (:46), graceful unresolved-tag degrade — the convention mapping Piece 4 builds against.
- `gateway/src/services/seedBuildFileWriteBlock.ts` — verbatim write-block builder (consumed downstream of the bundle; unchanged).
- Handler call site + injection `migrationShapeSpecGenerationHandler.ts:2066-2071` (~:2423), `targetArchitectureId` threaded from the BoW DTO (~:859) — already wired; Piece 4 only supplies a non-null source.

**Gateway persist + minting seams (Pieces 2 + 3 targets)**
- `gateway/src/routes/targetManifestUpload.ts:403` — where `confirmedManifests` is built (the persist insertion point); `ConfirmedManifestArtifact` shape at `gateway/src/services/targetManifest/manifestHandoffs.ts:104` (`buildConfirmedManifestArtifacts` at :134); `ResolvedDependency` at `.../manifestVersionResolution.ts:56`, `ManifestEcosystem='MAVEN'|'NPM'` at `.../manifestDependencyResolvers.ts:73`.
- `gateway/src/routes/migrationShapeSpecGeneration.ts:637-766` — add-item route (mint seam); suppress trigger at :727-738; `productionDeps` flip at :93. AMS `AddWorkItemRequest` (`.../model/dto/AddWorkItemRequest.java`) accepts `kind`, `title`, `sequence_order`, `description` — the minting payload fields.

**Gateway→AMS client idiom (Piece 1 client model)**
- `gateway/src/services/targetStateCapturedDecisionsClient.ts` — thin typed wrapper, `getConfig().architectureModelServiceBaseUrl`, snake_case-mirroring wire interfaces, fail-soft caller posture — the model for `targetManifestArtifactsClient.ts` (read idiom + writer POST seam).

## Out of Scope
- Conversation-CLOSE promotion (locked D7). The "confirmed = target-state conversation close" promotion is deferred; concrete seam `writeTargetTechStackMarkdown` at `gateway/src/routes/architectConversation.ts:871` (already fail-soft) is noted, not wired. v1 treats latest upload = confirmed.
- Model-driven service→module mapping. v1 uses the convention `tag → <tag>/` with `layout='monorepo'`; reading the richer mapping/layout from the target-architecture model is deferred.
- First-class IVS "seed files" input (D8). Zero IVS change: no new IVS endpoint, no seed-files upload input.
- Rebuilding the consumer-side carriage. It is already complete + tested; this spec consumes it and modifies it only via the single-line `productionDeps` flip at `migrationShapeSpecGeneration.ts:93`.
- Cross-source / multi-architecture dedup or merging of artifacts beyond newest-per-`(project, architecture, tag)`; no deletes / no history pruning.

## Verification Plan
True end-to-end requires a live environment (AMS write+read round-trip + a real spec-gen batch carrying the seed story); none runs offline. Each layer ships offline-isolation evidence; one live-env smoke is the acceptance gate. Verify gateway/frontend work in ISOLATION (whole-repo baseline is RED).

- (a) AMS store — integration tests in the Spec 1 store style: repository + controller assert the `is_latest` replace / keep-history lifecycle (re-write for the same `(project_id, target_architecture_id, tag)` flips prior latest to `false`, inserts new `is_latest=true`, retains history; latest read filters `is_latest=true`, one row per tag) and verbatim `content`/`package_lock_content` round-trip + `resolved_dependencies` JSONB round-trip.
- (b) Gateway producer — unit test: inject a stubbed AMS read returning persisted artifacts; assert the `confirmedArtifactsToSeedBundle` output (correct per-tag `<tag>/` placement, verbatim content); assert the no-op-on-empty/null path (read returns nothing or `targetArchitectureId` absent → source returns `null`); assert a read hiccup degrades to `null` (no throw).
- (c) Gateway persist-on-upload — route test: stub the AMS write seam (mirror existing `processManifestUpload` dep-stub tests); assert the persist is attempted with the correctly-mapped snake_case payload; assert fail-soft — a write hiccup is swallowed + logged and the upload response is unchanged.
- (d) Minting — unit test: assert the `kind='seed_build_files'` add with FIRST sequencing (`sequence_order=0`/below min); assert replace-in-place on re-upload (no duplicate seed story); assert the description-grounded spec-gen trigger is suppressed for this kind ONLY.
- Acceptance gate (live-env smoke): upload a manifest → run a spec-gen batch → confirm the seed story's spec text carries the verbatim file at the resolved per-module path (`<tag>/pom.xml` or `<tag>/package.json`).

## Open Risks
- No offline end-to-end: the full round-trip only proves out live; a wiring mismatch between layers is caught only by the live smoke.
- Verbatim fidelity through TEXT/JSONB round-trip: `content`/`package_lock_content` must come back byte-for-byte; encoding or trailing-newline drift would corrupt the emitted build file — explicit verbatim assertions required at persist + read.
- Seed-story idempotency races: replace-in-place must reliably find + update the existing `seed_build_files` story; an ambiguous match key (book of work + `kind`) would append a duplicate FIRST-sequenced story.
- Suppressed-trigger correctness: suppression must be scoped to exactly `kind='seed_build_files'`; over-broad suppression would silence ordinary manual-add generation.
- `is_latest` flip atomicity per tag: distinct tags must flip independently; a too-broad flip scope (per `(project, architecture)` instead of per `(project, architecture, tag)`) would wrongly demote a sibling tag's latest.
- Write-not-Edit clobber risk in implementer subagents on the large gateway route/handler files — anchored read-whole-file-then-write + post-write mojibake/NUL scan is mandatory.
