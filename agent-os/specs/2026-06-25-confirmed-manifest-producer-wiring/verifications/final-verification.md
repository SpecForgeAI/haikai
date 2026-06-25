# Verification Report: Confirmed Manifest Producer Wiring (Spec 5 Phase 2)

**Spec:** `2026-06-25-confirmed-manifest-producer-wiring`
**Date:** 2026-06-25
**Verifier:** implementation-verifier
**Status:** ⚠️ Passed with Issues (offline-green; two documented cross-layer gaps + one live-env gate remain outstanding by design)

---

## Executive Summary

Every deliverable file for all six task groups exists on disk and is implemented faithfully to the spec: the AMS `target_manifest_artifacts` store (changeset 199 + entity/repository/service/controller/DTOs mirroring the vulnerability store), the gateway -> AMS client, the fail-soft persist-on-upload, the seed-story minting, and the real producer with the one-line `productionDeps` flip. All offline-runnable evidence is GREEN: 37/37 gateway feature tests pass, gateway `tsc --noEmit` is clean (exit 0, 0 errors), and 10/10 AMS targetmanifest tests pass against H2. The one-line flip is independently confirmed. Both documented cross-layer gaps were integrity-checked against the actual code and are REAL and accurately described — the feature does NOT yet fire end-to-end in production until (a) AMS admits `kind='seed_build_files'` and (b) minting is re-driven from the book-of-work generation path. The single end-to-end acceptance smoke remains LIVE-ENV-gated and was correctly not faked offline.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

All 6 task groups and every sub-task in `tasks.md` are marked `- [x]`. No `- [ ]` or `⚠️` markers remain. Each group's deliverable files were confirmed present on disk and spot-checked against the spec (not merely trusted from the checkbox).

### Completed Tasks
- [x] Task Group 1: AMS `target_manifest_artifacts` store (D1)
  - [x] 1.2 Changeset `db/changelog/sql/199-target-manifest-artifacts.sql` — 12 snake_case columns + 4 indexes, verbatim TEXT `content`/`package_lock_content`, JSONB `resolved_dependencies`. Verified.
  - [x] 1.3 Registered in `db.changelog-master.yaml` at line 4609, AFTER 198, with the `not-tableExists` precondition idiom (`onFail: MARK_RAN`, `onError: HALT`, `splitStatements: true`, `stripComments: true`). Verified.
  - [x] 1.4 `model/entity/targetmanifest/TargetManifestArtifactEntity.java` — mirrors `VulnerabilityReportEntity`: Lombok stack, `@PrePersist created_at` default, `@Builder.Default isLatest=TRUE`, `@Type(JsonType.class)` + `columnDefinition="jsonb"`, all 4 indexes, no `@CamelCaseWire`. Verified.
  - [x] 1.5 `repository/targetmanifest/TargetManifestArtifactRepository.java` — both derived finders present (`findFirstBy...AndTagAndIsLatestTrue` demote target; `findBy...AndIsLatestTrueOrderByTagAsc` latest read). Verified.
  - [x] 1.6 `service/targetmanifest/TargetManifestArtifactService.java` — `@Transactional`, `@ConditionalOnProperty`, per-tag demote-then-insert replace-latest, keep-history (no deletes), blank-tag skip-with-log. Verified.
  - [x] 1.7 `controller/TargetManifestArtifactController.java` — `@RestController`, `@ConditionalOnProperty`, snake_case, base path `/api/model/projects/{projectId}/target-architectures/{targetArchitectureId}/manifest-artifacts` (matches the gateway client URL exactly), POST + GET. Verified.
  - [x] 1.1 / 1.8 / 1.9 Tests present and PASS offline against H2 (see §4).
- [x] Task Group 2: Gateway -> AMS client `targetManifestArtifactsClient.ts`
  - Thin wrapper, `getConfig().architectureModelServiceBaseUrl`, `encodeURIComponent` path params, snake_case wire interfaces, errors surface to callers (no internal swallow). Verified.
- [x] Task Group 3: Gateway persist-on-upload (`targetManifestUpload.ts`)
  - Fail-soft persist call (lines 570-595) after `confirmedManifests` is built, keyed by `(projectId, targetArchitectureId, tag)`; try/catch + `[diag-gateway]` log; `autoAnswer` returned unchanged (line 635). Verified.
- [x] Task Group 4: Gateway seed-story minting (`migrationSeedStoryMinting.ts`)
  - FIRST-sequenced (`sequence_order: 0`), `kind=SEED_BUILD_FILES_STORY_KIND`, replace-in-place via `findExistingSeedBuildFilesItem`, trigger structurally suppressed (this path never calls `runShapeSpecGenerationBatch`), wired fail-soft at the upload route (lines 611-623). Verified.
- [x] Task Group 5: Gateway real producer + flip (`migrationSeedBuildFilesProducer.ts`)
  - Real `SeedBuildFilesSource` reads latest artifacts, builds `tag -> <tag>/` monorepo mapping, returns `confirmedArtifactsToSeedBundle(...)` or `null`; no-op on absent `targetArchitectureId`/empty read; fail-soft read hiccup -> `null`. Flipped into `productionDeps.seedBuildFilesSource` at `migrationShapeSpecGeneration.ts:102`. Verified.
- [x] Task Group 6: Test review & gap analysis + live-env gate
  - Cross-seam test added (`migrationSeedManifestCrossSeam.test.ts`); live-env smoke documented in `tasks.md` and flagged outstanding. Verified.

### Incomplete or Issues
None incomplete. (Documentation gap — empty `implementation/` folder — noted in §2; cross-layer gaps and the live-env gate noted in §5/§6. These are by design, not incomplete tasks.)

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found (minor — per-task implementation reports absent)

### Implementation Documentation
- ⚠️ `agent-os/specs/2026-06-25-confirmed-manifest-producer-wiring/implementation/` exists but is **EMPTY** — no per-task-group implementation report files were written.
- The two cross-layer gaps and the live-env smoke ARE thoroughly documented in `tasks.md` under the appended `## Known cross-layer gaps (follow-up)` and `## Live-env acceptance smoke` sections, and the gap rationale is additionally captured in the `migrationSeedStoryMinting.ts` file header. So the substantive engineering documentation exists; only the conventional per-task `implementation/*.md` artefacts are missing.

### Verification Documentation
- This report: `agent-os/specs/2026-06-25-confirmed-manifest-producer-wiring/verifications/final-verification.md` (created).

### Missing Documentation
- Per-task-group implementation reports in `implementation/` (folder empty). Non-blocking — does not affect the correctness of the delivered code, which was verified directly.

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` describes a diagram-editor product (Phase 1 Meta-model CRUD, Phase 2 Diagram Rendering, Phase 3 Interactive Editing, Phase 4 UX Polish, Phase 5 Backend/Multi-User). None of these phases corresponds to this migration confirmed-manifest-producer wiring feature — the only `grep` hit ("Phase 2: Diagram Rendering") is unrelated. This spec belongs to the separate vuln/target-state migration initiative, which the roadmap does not track. No roadmap checkbox matches this spec, so no update was made.

---

## 4. Test Suite Results

**Status:** ✅ All Passing (offline-runnable scope; whole suites intentionally NOT run per spec)

Per the spec's hard constraints (BACKEND wiring, no UI; whole-repo baseline is RED; AMS integration + e2e are live-gated), tests were run IN ISOLATION only — the relevant feature suites, not the whole repo.

### Test Summary
- **Gateway feature suites (Jest):** 7 suites, **37 tests, 37 passing, 0 failing**.
- **Gateway `tsc --noEmit`:** exit 0, **0 TypeScript errors** across the entire gateway package (GREEN — stronger than the "verify in isolation" floor; the gateway package itself compiles clean).
- **AMS targetmanifest (Maven `-o`, H2 offline):** 3 classes, **10 tests, 0 failures, 0 errors** — BUILD SUCCESS.
- **Combined offline-runnable:** **47 tests passing, 0 failing, 0 errors.**

Gateway suites run (all PASS):
- `src/services/__tests__/targetManifestArtifactsClient.test.ts` — 6 tests (write POST body, read mapping, encodeURIComponent, non-2xx surfaces to caller).
- `src/services/__tests__/migrationSeedStoryMinting.test.ts` — minting (FIRST seq, replace-in-place, no-book skip-with-log, fail-soft add).
- `src/services/__tests__/migrationSeedBuildFilesProducer.test.ts` — producer (per-tag `<tag>/` placement, verbatim, no-op on null/empty, read-hiccup -> null).
- `src/services/__tests__/migrationSeedManifestCrossSeam.test.ts` — 4 tests (verbatim bytes survive full chain; distinct tags independent; payload emits EXACT AMS snake_case key set / no camelCase leak; dual fail-soft persist+read).
- `src/services/targetManifest/__tests__/manifestUploadPersist.test.ts` — 4 tests (persist attempted with verbatim content; field mapper; Maven -> null lock; fail-soft swallow + unchanged response).
- `src/services/targetManifest/__tests__/targetManifestUpload.test.ts` — 6 tests (parsing/tagging baseline).
- `src/__tests__/migrationShapeSpecGenerationAddItemSuppression.test.ts` — ordinary `api` add STILL fires the batch (suppression not over-broad).

AMS classes run (all PASS, H2 offline):
- `controller.TargetManifestArtifactControllerTest` — 4 tests (POST->GET round-trip, latest-per-tag, verbatim, re-POST replace+keep-history).
- `migration.TargetManifestArtifactsChangesetTest` — 3 tests (199 applies cleanly: all 12 columns + 4 indexes; clean no-op-on-re-run precondition signal; registered AFTER 198 with 198 untouched).
- `repository.targetmanifest.TargetManifestArtifactPersistenceTest` — 3 tests (replace-latest/keep-history, latest read filters `is_latest`, per-tag flip independence, verbatim TEXT + JSONB round-trip).

### Failed Tests
None - all offline-runnable tests passing.

### Notes
- **Whole application suites were intentionally NOT run** (per the spec's "verify in isolation; whole-repo baseline is RED; do NOT run e2e or whole-repo build" constraint, and the verification instruction for this backend feature). No Playwright/browser tools used; no services started.
- **AMS targetmanifest tests run fully offline on H2** (the `@DataJpaTest`/plain-JDBC profile aliases `JSONB AS JSON` and `TIMESTAMPTZ`), so they are real green here, not live-gated. The broader AMS suite and any Postgres-only integration were not run.
- **The end-to-end acceptance smoke is LIVE-ENV-gated** and was correctly NOT faked offline (see §6).

---

## 5. Independent Verification of the One-Line Flip and the Two Cross-Layer Gaps

### 5a. The one-line `productionDeps` flip — CONFIRMED REAL
At `gateway/src/routes/migrationShapeSpecGeneration.ts`:
- Line 78 imports `productionSeedBuildFilesSource` from `../services/migrationSeedBuildFilesProducer`.
- Line 102 sets `seedBuildFilesSource: productionSeedBuildFilesSource` inside `productionDeps`.
- The production dep no longer points at `defaultProductionSeedBuildFilesSource`. That no-op still EXISTS at `migrationSeedBuildFilesEnrichment.ts:156` (the untouched carriage default) and is now referenced only in comments and one pre-existing carriage test (`migrationSeedBuildFilesTrigger.test.ts`) — it is NOT wired into any production dep. The flip is genuine, and it is the only change to the consumer-side carriage.

### 5b. Gap #1 (minting timing — book must already exist) — REAL and ACCURATELY described
`migrationSeedStoryMinting.ts`:
- Resolves the book via a genuine list endpoint: `defaultListBooksOfWork` GETs `/api/projects/{projectId}/migration-books-of-work` and `pickBookForTargetArchitecture` matches on `target_architecture_id` (non-archived).
- When no book matches, `mintSeedBuildFilesStory` returns `{ status: 'skipped', reason: 'no_book_of_work_yet' }` and logs `reason=no_book_of_work_yet follow_up=mint_from_book_generation_path` (lines 304-316). It never invents a bookId.
- Because books of work are generated later than manifest upload, at confirm time there is usually no book, so the seed story is typically NOT minted at upload. The `tasks.md` description and the file-header documentation match the code exactly. **Accurate.**

### 5c. Gap #2 (AMS `kind` allow-list 400-rejects `seed_build_files`) — REAL and ACCURATELY described
`architecture-model-service/.../service/GeneratedMigrationBookOfWorkService.java`:
- Lines 187-190: `private static final Set<String> ALLOWED_KINDS = Set.of(AddWorkItemRequest.KIND_API, AddWorkItemRequest.KIND_OPERATIONAL);`
- `AddWorkItemRequest.java`: `KIND_API = "api"` (line 115), `KIND_OPERATIONAL = "operational"` (line 118) — so the allow-list is EXACTLY `{api, operational}`.
- Lines 1194-1197: any other kind throws `IllegalArgumentException("Invalid kind '...'; allowed: ...")`, which maps to a 400. So a `kind='seed_build_files'` add is rejected by today's AMS.
- The gateway catches that 400 fail-soft and logs `seed_story_mint_failed ... reason=add_item_failed` (lines 351-363), with no upload impact. The `tasks.md` description and the file-header documentation match the code exactly. **Accurate.**

Both gaps are the genuine "caught only by the live smoke" class the spec anticipated; both are fail-soft and never break the upload. This is honest documentation, not rubber-stamping.

---

## 6. Mojibake / Encoding Scan and Live-Env Status

### 6a. Mojibake / U+FFFD / NUL scan — CLEAN
A byte-level Python scan (not the unreliable `grep` NUL count) of all 14 created/modified source files (7 AMS Java/SQL + 7 gateway TS, including the large `targetManifestUpload.ts` and `migrationShapeSpecGeneration.ts`) reported, for EVERY file: real NUL bytes = 0, U+FFFD (`EF BF BD`) = 0, no UTF-8/UTF-16 BOM, and `utf-8 decode = ok`. No clobber corruption from the Write-not-Edit workflow. **Clean.**

(Note: a first-pass `grep -c $'\x00'` produced non-zero counts equal to each file's line count — that was a grep/locale artifact matching line terminators, NOT real NUL bytes, as the authoritative byte-level read confirmed.)

### 6b. Verified-green offline vs LIVE-ENV-gated vs BLOCKED on follow-ups

**Verified GREEN offline (proven now):**
- AMS store schema + replace-latest/keep-history lifecycle + per-tag `is_latest` independence + verbatim TEXT/JSONB round-trip (H2, 10 tests).
- Changeset 199 applies cleanly and is a clean no-op on re-run (precondition idiom), registered after an untouched 198.
- Gateway client write/read seams, persist-on-upload fail-soft (response unchanged), seed-story minting (FIRST seq, replace-in-place, suppressed trigger, skip-with-log), real producer (per-tag placement, verbatim, no-op + fail-soft), and the cross-seam payload-shape contract / dual fail-soft (37 tests).
- Gateway `tsc --noEmit` clean (0 errors).
- The one-line `productionDeps` flip points at the real producer.

**LIVE-ENV-gated (NOT satisfiable offline; correctly not faked):**
- The single end-to-end acceptance smoke: upload a manifest -> run a spec-gen batch -> assert the `seed_build_files` story's generated spec text carries the VERBATIM file at `<tag>/pom.xml` / `<tag>/package.json` inside the seed write block's BEGIN/END sentinels. This needs a live AMS write+read HTTP round-trip AND a real spec-gen batch. Documented in `tasks.md` (`## Live-env acceptance smoke`) and flagged OUTSTANDING.

**BLOCKED on the two follow-up gaps (the feature does NOT yet fire end-to-end in production):**
- Persist-on-upload (TG3) and the real producer + flip (TG5) ARE fully wired end-to-end: once a `seed_build_files` story exists on the book, the producer reads the persisted latest artifacts and emits the verbatim build file. BUT the AUTOMATIC creation/persistence of the seed STORY itself is gated by BOTH:
  1. **Gap #2 (AMS-side):** `seed_build_files` must be added to `GeneratedMigrationBookOfWorkService.ALLOWED_KINDS`, else the add is 400-rejected (currently a logged SKIP).
  2. **Gap #1 (gateway-side follow-up):** minting must be re-driven from the book-of-work generation path (which has the bookId in hand), because at upload time there is usually no book yet.
- Net: until BOTH follow-ups land, the seed story is effectively a fail-soft SKIP-WITH-LOG in production, so the verbatim build file is not yet emitted end-to-end. The persist and producer machinery is in place and tested in isolation, waiting on those two changes plus the live smoke.

---

## Verdict

The gateway-only feature is built correctly and completely per spec, with all offline-runnable evidence GREEN (47 tests; clean tsc; clean encoding) and the one-line flip confirmed. The two documented cross-layer gaps were integrity-checked against the real AMS/gateway code and are REAL and accurately described — not glossed. The honest residual is that the feature does NOT yet fire end-to-end in production until AMS admits `kind='seed_build_files'` AND minting is re-driven from the book-generation path, and the single end-to-end acceptance smoke remains LIVE-ENV-gated by design. Status: **Passed with Issues** (the "issues" being the by-design outstanding follow-ups + live gate, plus the minor empty `implementation/` docs folder).
