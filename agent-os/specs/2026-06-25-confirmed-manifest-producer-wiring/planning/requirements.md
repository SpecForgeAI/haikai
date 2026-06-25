# Spec Requirements: Confirmed Manifest Producer Wiring (Spec 5 Phase 2)

## Initial Description

> Source: `planning/raw-idea.md` (no `initialization.md` for this spec; raw-idea.md is the seed).

Wire the Spec 5 confirmed-manifest producer so a confirmed target dependency
manifest (`pom.xml` / `package.json`) actually flows **verbatim** into the
generated target codebase — replacing the v1 no-op stub. This is **"Spec 5
Phase 2"**, a follow-up to `2026-06-24-confirmed-manifest-to-target-codebase`.

The **consumer side is already 100% complete and tested** (the carriage seam:
contract, adapter, write-block builder, destination resolver, handler call site
and injection). The single thing missing is that the **verbatim confirmed
manifest is never persisted**: Spec 3 builds `confirmedManifests[]`, returns it
only in the upload HTTP response, and then discards it. The auto-answer
*decision rows* persist (captured-decisions store) but the manifest *bytes* do
not — so at spec-gen time (a separate, later request) there is nothing durable
to read back, and the production `SeedBuildFilesSource` is forced to be a
`null`-returning no-op.

This spec closes that gap with four work pieces across two layers (AMS +
gateway): **persist → confirm-trigger → mint seed story → real producer + flip**.

---

## Overview / Problem (the no-op gap)

At spec-generation time, the production seed-build-files source
(`defaultProductionSeedBuildFilesSource`,
`gateway/src/services/migrationSeedBuildFilesEnrichment.ts:156`) honestly
returns `null`, because there is **no durable store** holding the verbatim
confirmed manifest bytes. Spec 3 produces `ConfirmedManifestArtifact[]` at
upload via `buildConfirmedManifestArtifacts(...)`
(`gateway/src/services/targetManifest/manifestHandoffs.ts`) and surfaces them on
`autoAnswer.confirmedManifests` from
`gateway/src/routes/targetManifestUpload.ts` (~line 403, where
`confirmedManifests` is built), but those bytes live only in the HTTP response
and are then dropped.

Helpful alignment that makes the wiring tractable: manifests are uploaded keyed
by `targetArchitectureId`, and the spec-gen batch reads `bow.targetArchitectureId`
— the **same key**. So a persisted store keyed by
`(projectId, targetArchitectureId, tag)` can be written at upload and read back
at spec-gen time with no new threading required on the consumer side.

---

## Goal & v1 Boundary

**Goal:** Make a confirmed target dependency manifest survive durably from upload
through to spec-gen, so the already-built carriage emits the verbatim build file
into the generated target codebase at the resolved per-module path — by
replacing the no-op production source with a real one.

**v1 boundary (what makes this Phase 2, not the whole vision):**

- **Confirm = latest upload** (persist-at-upload). The richer
  conversation-CLOSE promotion is deferred (see Out of Scope).
- **Mapping = convention** (`tag → <tag>/`, `layout='monorepo'`). Model-driven
  mapping deferred.
- **Zero IVS change.** No new IVS endpoint, no "seed files" upload input (D8
  deferred).
- **Fail-soft everywhere.** A persist hiccup at upload, or a read hiccup at
  spec-gen, degrades to a safe no-op and never breaks the upload response or the
  batch.
- **Verbatim bytes survive byte-for-byte** through store → read → enrichment.

---

## Requirements Discussion

This spec was shaped to locked decisions before requirements capture; the user
supplied resolved answers (D1–D6) rather than open questions. The shaping
questions and their locked resolutions are recorded below.

### Q1 — Persistence home, shape, and lifecycle
**Resolution (D1):** A **new AMS store**, a **single table
`target_manifest_artifacts`** (not a two-table split, not the captured-decisions
store), introduced by **Liquibase changeset 199** (197/198 are the current
highest — verified in
`architecture-model-service/src/main/resources/db/changelog/sql/` and registered
in `db.changelog-master.yaml`). Newest-per-`(project_id,
target_architecture_id, tag)` wins via an **`is_latest` flip**
(replace-latest, keep-history, append-only, **no deletes**) — modelled on the
Spec 1 vulnerability store lifecycle
(`VulnerabilityReportEntity`, "replace latest, keep history"). Needs
entity + repository + service + controller (read + write endpoints) mirroring
`architecture-model-service/.../{model/entity,repository,controller,service}/vulnerability/`,
plus a gateway→AMS client.

**Columns (snake_case):** `id`, `project_id`, `target_architecture_id`, `tag`,
`kind`, `ecosystem`, `manifest_path`, `content` (TEXT, verbatim bytes),
`package_lock_content` (TEXT, nullable), `resolved_dependencies` (JSONB),
`is_latest` (bool), `created_at`.

### Q2 — Confirm-trigger timing and caller
**Resolution (D2):** **Persist at upload** (latest upload = confirmed) for v1.
Add the fail-soft persist call at the upload route
`gateway/src/routes/targetManifestUpload.ts` (~line 403, where
`confirmedManifests[]` is built). The conversation-CLOSE promotion (locked D7;
concrete seam is `writeTargetTechStackMarkdown` at
`gateway/src/routes/architectConversation.ts:871`, already fail-soft) is
**deferred to a later phase** — out of scope now, seam noted.

### Q3 — Seed-story minting path, sequencing, and idempotency
**Resolution (D3):** **Reuse the existing add-item route**
(`gateway/src/routes/migrationShapeSpecGeneration.ts:637-766`; AMS add-item
behind it) with **`kind='seed_build_files'`**, but **suppress its
description-grounded spec-gen trigger for this kind** (the seed story carries
verbatim bytes via the existing enrichment, not a generated description — the
add-item route currently fires `runShapeSpecGenerationBatch(...)` at lines
727-738 after a successful add). Sequence the story **FIRST**
(`sequence_order = 0` or below current min). **Idempotency =
replace-in-place**: on re-upload/re-confirm, update the existing
`seed_build_files` story for the book of work rather than appending a duplicate.

### Q4 — Service→module mapping source and layout for v1
**Resolution (D4):** v1 = **convention** `tag → <tag>/`, `layout='monorepo'`
(matches `DEFAULT_TARGET_ARCHITECTURE_LAYOUT`). Unresolved tags still carry the
file verbatim with the existing "destination unresolved" notice
(`seedBuildFileDestination.ts` degrades gracefully). Model-driven mapping
deferred.

### Q5 — Multiple manifests / re-upload supersede semantics
**Resolution (D5):** **Newest-per-tag-wins end-to-end** — the store keeps
history but the producer reads only the **latest upload's artifacts** (one per
tag); a re-upload supersedes prior bytes for that tag; distinct tags resolve
independently.

### Q6 — End-to-end verification
**Resolution:** True end-to-end needs a **live environment** (AMS write+read
round-trip + a real spec-gen batch carrying the seed story) — none runs offline.
Per-layer offline-isolation evidence is required instead, with one live-env
smoke as the acceptance gate. See **Verification Plan** below.

### Existing Code to Reference
The user named every real code anchor in `raw-idea.md` and the locked decisions;
the consumer-side seam, the persist seam, the minting route, and the AMS store
to mirror are all enumerated under **Existing Seams Reused** below. No
additional similar features needed identification.

### Follow-up Questions
None. All decisions were locked before requirements capture; no clarification
was required.

---

## Visual Assets

**No visual assets provided.** The mandatory `planning/visuals/` check was run
and returned no files (this is backend wiring across AMS + gateway with no UI
surface).

- `planning/visuals/` exists but contains no `.png/.jpg/.jpeg/.gif/.svg/.pdf`
  files.

---

## In Scope — the 4 work pieces (D1–D4 / D6), by layer

### Piece 1 — AMS: new `target_manifest_artifacts` store (D1)
- **Liquibase changeset 199** creating `target_manifest_artifacts`
  (`db/changelog/sql/199-*.sql` + registration in `db.changelog-master.yaml`
  AFTER 198, using the append-only `not-columnExists`/`not-tableExists`
  precondition idiom — clean no-op on re-run, never edit applied changesets).
- **Entity** in `model/entity/...` mirroring
  `model/entity/vulnerability/VulnerabilityReportEntity.java` (snake_case columns,
  `is_latest` flag, `@PrePersist` default for `created_at`, indexes on
  `project_id`, `target_architecture_id`, `tag`, `is_latest`).
- **Repository** mirroring `repository/vulnerability/` (latest read filters
  `is_latest=true`; supports the latest-flip + insert lifecycle).
- **Service** mirroring `service/vulnerability/` implementing the
  **replace-latest / keep-history** write (flip prior latest per
  `(project_id, target_architecture_id, tag)` to `false`, insert new
  `is_latest=true`; no deletes) and the **latest read** for
  `(project_id, target_architecture_id)`.
- **Controller** with a **write endpoint** (persist confirmed artifacts) and a
  **read endpoint** (return latest artifacts for a target architecture),
  snake_case wire (AMS default).
- **Gateway→AMS client** for both endpoints.

### Piece 2 — Gateway: persist-on-upload (D2)
- Add a **fail-soft persist call** at `targetManifestUpload.ts` (~line 403,
  right where `confirmedManifests` is built from
  `buildConfirmedManifestArtifacts(...)`), writing the `ConfirmedManifestArtifact[]`
  to the new AMS store via the gateway client, keyed by
  `(projectId, targetArchitectureId, tag)`.
- **Persist payload** maps the `ConfirmedManifestArtifact` shape (verified at
  `manifestHandoffs.ts:104` — `tag`, `ecosystem`, `kind`, `manifestPath`,
  `content`, `packageLockContent`, `resolvedDependencies`) onto the snake_case
  store columns; `content` + `package_lock_content` carried verbatim,
  `resolved_dependencies` as JSONB.
- **Fail-soft:** a write hiccup is caught + logged and **never breaks the upload
  response** (mirror the existing `processManifestUpload` dep-stub posture and
  the close-turn writer's degrade posture).

### Piece 3 — Gateway: mint the dedicated seed-build-files story (D3)
- On confirm (= upload), **reuse the add-item route mechanism**
  (`migrationShapeSpecGeneration.ts:637-766`) to mint a work item with
  **`kind='seed_build_files'`**.
- **Suppress the description-grounded spec-gen trigger** for this kind (do not
  fire `runShapeSpecGenerationBatch(...)`, lines 727-738, for a
  `seed_build_files` add — the seed story is filled by the existing enrichment
  carriage, not a generated description).
- **Sequence FIRST** (`sequence_order = 0` or below current min).
- **Idempotency = replace-in-place:** update the existing `seed_build_files`
  story for the book of work on re-upload/re-confirm rather than appending a
  duplicate.

### Piece 4 — Gateway: real producer + one-line flip (D6)
- Implement a real **`SeedBuildFilesSource`** (`SeedBuildFilesSource = (input:
  {projectId, bookOfWorkId, targetArchitectureId?}) => Promise<ConfirmedManifestBundle
  | null>`) that:
  - reads the **persisted latest** artifacts for
    `(projectId, targetArchitectureId)` via the gateway→AMS client;
  - builds the `ServiceModuleMapping` (convention `tag → <tag>/`, per D4) +
    `layout='monorepo'`;
  - returns `confirmedArtifactsToSeedBundle(...)` **or `null`** (the
    no-op-on-empty/null path);
  - is **fail-soft** — a read hiccup degrades to `null` (safe no-op), never
    throws into the batch.
- **Flip:** swap the real source into
  `productionDeps.seedBuildFilesSource` at
  `gateway/src/routes/migrationShapeSpecGeneration.ts:93` (currently
  `defaultProductionSeedBuildFilesSource`).

---

## Out of Scope

- **Conversation-CLOSE promotion (locked D7).** The "confirmed = target-state
  conversation close" promotion is **deferred to a later phase**. The concrete
  seam is `writeTargetTechStackMarkdown` at
  `gateway/src/routes/architectConversation.ts:871` (already fail-soft) — noted
  for the future phase, not wired now. v1 treats **latest upload = confirmed**.
- **Model-driven service→module mapping.** v1 uses the convention `tag → <tag>/`
  with `layout='monorepo'`. Reading the richer mapping/layout from the
  target-architecture model is deferred.
- **First-class IVS "seed files" input (D8).** Zero IVS change: no new IVS
  endpoint and no seed-files upload input. Deferred.
- **Rebuilding the consumer-side carriage.** It is already 100% complete + tested
  (see Existing Seams Reused). This spec consumes it; it does not modify it
  beyond the single-line `productionDeps` flip.

---

## Locked Decisions (D1–D6)

| ID | Decision |
|----|----------|
| **D1 — Persistence** | New AMS store, single table `target_manifest_artifacts`, Liquibase changeset **199**. Newest-per-`(project_id, target_architecture_id, tag)` wins via `is_latest` flip (replace-latest, keep-history, append-only, no deletes), modelled on the Spec 1 vulnerability store. Columns (snake_case): `id`, `project_id`, `target_architecture_id`, `tag`, `kind`, `ecosystem`, `manifest_path`, `content` (TEXT), `package_lock_content` (TEXT, nullable), `resolved_dependencies` (JSONB), `is_latest` (bool), `created_at`. Entity + repository + service + controller (read + write) mirroring the `vulnerability/` packages + a gateway→AMS client. |
| **D2 — Confirm trigger** | Persist at **upload** (latest upload = confirmed) for v1. Fail-soft persist call at `targetManifestUpload.ts` ~line 403. Conversation-CLOSE promotion deferred (seam: `architectConversation.ts:871`). |
| **D3 — Seed-story minting** | Reuse the add-item route (`migrationShapeSpecGeneration.ts:637-766`) with `kind='seed_build_files'`; **suppress** its description-grounded spec-gen trigger for this kind. Sequence **FIRST**. Idempotency = **replace-in-place** on re-upload/re-confirm. |
| **D4 — Mapping/layout** | v1 = convention `tag → <tag>/`, `layout='monorepo'` (matches `DEFAULT_TARGET_ARCHITECTURE_LAYOUT`). Unresolved tags still carry the file verbatim with the existing "destination unresolved" notice. Model-driven mapping deferred. |
| **D5 — Supersede** | Newest-per-tag-wins end-to-end. Store keeps history; producer reads only the latest upload's artifacts (one per tag). Re-upload supersedes prior bytes for that tag; distinct tags resolve independently. |
| **D6 — Producer + flip** | Real `SeedBuildFilesSource` reads persisted latest artifacts for `(projectId, targetArchitectureId)`, builds `ServiceModuleMapping` (convention) + layout, returns `confirmedArtifactsToSeedBundle(...)` or `null`; swap into `productionDeps.seedBuildFilesSource` at `migrationShapeSpecGeneration.ts:93` (currently the `defaultProductionSeedBuildFilesSource` no-op at `migrationSeedBuildFilesEnrichment.ts:156`). |

---

## Existing Seams Reused (file:line anchors — verified)

**Consumer side — 100% complete + tested (do NOT rebuild; this spec consumes it):**
- `SeedBuildFilesSource` contract + `ConfirmedManifestBundle` +
  `confirmedArtifactsToSeedBundle(...)` adapter + `defaultProductionSeedBuildFilesSource`
  no-op — `gateway/src/services/migrationSeedBuildFilesEnrichment.ts`
  (no-op at **:156**; contract at **:139**).
- Verbatim write-block builder — `gateway/src/services/.../seedBuildFileWriteBlock.ts`.
- Per-module destination resolver (`ServiceModuleMapping`, monorepo default,
  unresolved-tag graceful degrade) — `gateway/src/services/.../seedBuildFileDestination.ts`.
- Handler call site + injection — `migrationShapeSpecGenerationHandler.ts:2066-2071`
  (and ~**:2423**), with `targetArchitectureId` threaded from the book-of-work
  DTO (~**:859**).

**Persist seam (Piece 2 target):**
- `ConfirmedManifestArtifact[]` built via `buildConfirmedManifestArtifacts(...)`
  and returned on `autoAnswer.confirmedManifests` — built at
  `gateway/src/routes/targetManifestUpload.ts:403`; type defined at
  `gateway/src/services/targetManifest/manifestHandoffs.ts:104`
  (`buildConfirmedManifestArtifacts` at **:134**). Fields: `tag`, `ecosystem`,
  `kind`, `manifestPath`, `content`, `packageLockContent`, `resolvedDependencies`.

**Minting seam (Piece 3 target):**
- Add-item route accepting a `kind` field — `migrationShapeSpecGeneration.ts:637-766`;
  the description-grounded spec-gen trigger to suppress is the
  `runShapeSpecGenerationBatch(...)` call at **:727-738**.

**Producer flip (Piece 4 target):**
- `productionDeps.seedBuildFilesSource = defaultProductionSeedBuildFilesSource`
  at `gateway/src/routes/migrationShapeSpecGeneration.ts:93`.

**AMS store to mirror (Piece 1 model):**
- `architecture-model-service/.../model/entity/vulnerability/VulnerabilityReportEntity.java`
  — the canonical "replace latest, keep history" `is_latest` lifecycle reference
  (per `(project_id, architecture_id, source)`; this store keys per
  `(project_id, target_architecture_id, tag)`).
- Mirror packages:
  `.../repository/vulnerability/`, `.../service/vulnerability/`,
  `.../controller/VulnerabilityController.java`.
- Liquibase ceiling verified: `db/changelog/sql/197-vulnerabilities.sql` +
  `198-architecture-proceed-critical-override.sql` are the highest applied;
  register `199-*` AFTER 198 in `db/changelog/db.changelog-master.yaml`.

**Deferred-phase seam (recorded, not wired):**
- `writeTargetTechStackMarkdown` at `gateway/src/routes/architectConversation.ts:871`
  (already fail-soft) — the future conversation-CLOSE promotion point (D7).

---

## Hard Constraints (non-negotiable — bake in)

- **AMS snake_case wire default.** New DTOs/entity use snake_case (the global
  `SNAKE_CASE` default). Apply `@CamelCaseWire` **only if** a camelCase consumer
  appears — **none expected** here.
- **ZERO IVS change.** No new IVS endpoint, no seed-files upload input (D8
  deferred).
- **Verbatim bytes survive byte-for-byte** through store → read → enrichment
  (`content` and `package_lock_content` carried unchanged as TEXT).
- **Non-blocking / fail-soft everywhere.** A persist hiccup at upload, or a read
  hiccup at spec-gen time, degrades to a safe no-op and **NEVER** breaks the
  upload response or the batch (matches existing
  `resolveSeedBuildFilesEnrichment` try/catch + the close-turn writer's degrade
  posture).
- **Frontend whole-repo tsc/lint baseline is pre-existingly RED** → verify any
  affected gateway/frontend work in **ISOLATION**, not via a whole-repo build.
- **Implementer subagents have Write-not-Edit (clobber risk)** → mandate
  **anchored read-whole-file-then-write** edits + a **post-write mojibake/NUL
  scan** (note this for the eventual `tasks.md`).

---

## Verification Plan

> True end-to-end requires a **live environment** (AMS write+read round-trip + a
> real spec-gen batch carrying the seed story); **none of this runs offline**.
> Therefore each layer ships **offline-isolation evidence**, with **one live-env
> smoke as the acceptance gate**.

**(a) AMS store — integration tests** in the Spec 1 store's test style:
- repository + controller integration tests on `target_manifest_artifacts`
  asserting the **`is_latest` replace / keep-history** lifecycle (re-write for
  the same `(project_id, target_architecture_id, tag)` flips prior latest to
  `false`, inserts new `is_latest=true`, retains history; latest read filters
  `is_latest=true`).

**(b) Gateway producer — unit test:**
- inject a stubbed AMS read returning persisted artifacts; assert the
  `confirmedArtifactsToSeedBundle` output (correct per-tag placement, verbatim
  content);
- assert the **no-op-on-empty/null path** (read returns nothing → source returns
  `null` → safe no-op).

**(c) Gateway persist-on-upload — route test:**
- stub the AMS write seam (mirror existing `processManifestUpload` dep-stub
  tests); assert the persist is attempted with the correctly-mapped payload;
- assert **fail-soft**: a write hiccup is swallowed + logged and **never breaks
  the upload response**.

**(d) Minting — unit test:**
- assert the `kind='seed_build_files'` add with **FIRST sequencing**;
- assert **replace-in-place on re-upload** (no duplicate seed story);
- assert the **description-grounded spec-gen trigger is suppressed** for this
  kind.

**Acceptance gate (live-env smoke):**
Upload a manifest → run a spec-gen batch → confirm the seed story's spec text
carries the **verbatim file at the resolved per-module path**.

---

## Open Risks

- **No offline end-to-end.** The full round-trip (AMS persist + read + a real
  spec-gen batch carrying the seed story) only proves out in a live environment;
  per-layer isolation tests + the one live smoke are the mitigation, but a wiring
  mismatch between layers can only be caught live.
- **Verbatim fidelity through JSONB/TEXT round-trip.** `content` /
  `package_lock_content` must come back byte-for-byte; encoding or
  trailing-newline drift in the TEXT round-trip would corrupt the emitted build
  file. Explicit verbatim assertions required at the persist and read seams.
- **Seed-story idempotency races.** Replace-in-place on re-upload/re-confirm must
  reliably find and update the existing `seed_build_files` story; a missed match
  would append a duplicate FIRST-sequenced story. The matching key/scope (book of
  work + `kind`) must be unambiguous.
- **Suppressed-trigger correctness.** Suppressing the description-grounded
  spec-gen for `kind='seed_build_files'` must be scoped to exactly that kind;
  over-broad suppression would silence ordinary manual-add generation.
- **`is_latest` flip atomicity per tag.** Distinct tags must flip independently;
  a too-broad flip scope (e.g. per `(project, architecture)` instead of per
  `(project, architecture, tag)`) would wrongly demote a sibling tag's latest.
- **Write-not-Edit clobber risk** in implementer subagents — anchored
  read-whole-file-then-write + post-write mojibake/NUL scan is mandatory to avoid
  silently corrupting the multi-thousand-line gateway route/handler files.
