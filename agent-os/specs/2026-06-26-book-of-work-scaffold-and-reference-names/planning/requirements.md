# Spec Requirements: Migration Book-of-Work — Scaffold-Story Fix + Reference Name Resolution

## Initial Description

One spec covering two issues on the Migration Delivery Plan review surface:

- **Issue 1 (the parentId expansion bug):** a top-level `parentId:null` "seed build files" story is minted and prepended *after* validation (`migrationBookOfWorkHandler.ts:1239-1242`), bypassing `validateBookOfWorkHierarchy`; Phase-2 epic expansion re-validates the whole merged tree (`migrationBookOfWorkExpansionHandler.ts:1287`) and the orphan story fails "story must have non-null parentId", so **every epic expansion fails** for any project with a confirmed target manifest. Fix: delete the orphan + bypass, and inject a **code-owned scaffold feature + story** at expansion so the work is parented properly and hierarchy-legal by construction.
- **Issue 3 (raw UUID references):** the inspector + header render reference IDs verbatim. Fix: resolve `architectureReferences` and `discoveryFindingReferences` to `name (id)`.

**Depends on Spec 4** (`2026-06-26-target-manifest-service-association`) for service identification; single-service homing also resolves via cardinality (ecosystem→workstream + first epic). Full agreed context in `planning/raw-idea.md`.

## Requirements Discussion

### First Round Questions

**Q1 (confirm — scaffold fix core):** Delete the top-level `parentId:null` orphan seed story + its post-validation prepend bypass (`:1239-1242`) entirely, and inject a code-owned scaffold **feature** ("Scaffold & build foundation") + one scaffold **story** at Phase-2 expansion, routed through the normal stamp → judge → merged-validate path so it's hierarchy-legal by construction?
**Answer:** Correct.

**Q2 (confirm — host-epic selection + guards):** Host epic = ecosystem→workstream (maven → `target_service_api_implementation`, npm → `target_frontend_implementation`), lowest-`sequenceOrder` epic in that workstream, injected when that epic is expanded regardless of click order; the "one story per inventory item" coverage check (`:1167-1176`) **excludes** the non-inventory scaffold story; gated on a confirmed manifest existing **at expansion time**?
**Answer:** Correct.

**Q3 (confirm — reference names):** Resolve `architectureReferences` → `"name (id)"` via `listArchitectures(projectId)` and `discoveryFindingReferences` → `"title (id)"` from the already-loaded `findingsCoverage.findings` (zero new fetch), leave `mappingReferences`/`sourceContextRefs`/`evidenceReferences` verbatim, render-time `resolveRef(type,id)` with raw-id fallback (never blank)?
**Answer:** Correct.

**Q4 (residual — feature timing):** Create both the scaffold feature and its story during the host epic's Phase-2 expansion (all-at-expansion, fully code-owned), not a Phase-1 feature + Phase-2 story?
**Answer:** Correct — all-at-expansion.

**Q5 (residual — host-epic-never-expanded edge):** Accept that no scaffold appears until the host epic (or "Expand all") is expanded, with no guard/warning?
**Answer:** Correct — accept as-is.

**Q6 (residual — wording + fallback):** Feature title "Scaffold & build foundation"; story title/AC seed "Scaffold the `<service>` app and reproduce `<manifest filename>` exactly as confirmed, dependency-for-dependency." And when no explicit service name is resolvable, fall back to the workstream/ecosystem label for `<service>` rather than block?
**Answer:** Correct — wording good; **graceful fallback** for `<service>` (FK service name when present, else cardinality single service, else workstream/ecosystem label) — never block.

**Q7 (residual — names scope):** Resolve `architectureReferences` + `discoveryFindingReferences` now; **defer** `apiBaselineReferences` (best-effort later); evidence/mapping/source-context stay verbatim?
**Answer:** Correct.

**Q8 (residual — header fix):** Also resolve the plan header's raw arch ids (`MigrationBookOfWorkReviewWorkspace.tsx:860-861`) using the same `listArchitectures` fetch, in this spec?
**Answer:** Correct — include it.

**Q9 (exclusions):** Anything else to exclude beyond the listed items?
**Answer:** No — the listed out-of-scope items are complete.

### Existing Code to Reference

User confirmed the reference set in `planning/raw-idea.md`.

- **Gateway:** `migrationBookOfWorkHandler.ts` (`buildSeedBuildFilesStoryItem:747-773`, prepend/bypass `:1239-1242`, manifest gate `:1231-1237`); `migrationBookOfWorkExpansionHandler.ts` (`stampStoryFromTemplate`, merged validate `:1287`, coverage `:1167-1176`); `generatedMigrationBookOfWorkSchema.ts` (`validateBookOfWorkHierarchy:246-336`, parentId rule `:274-277`, `ALLOWED_PARENT_TYPE:214-223`); `migrationSeedBuildFilesEnrichment.ts` / `migrationSeedBuildFilesProducer.ts` (`SEED_BUILD_FILES_STORY_KIND`, `tag→moduleDir`).
- **Spec 4 FK:** `target_service_element_id` + `ecosystem` on `target_manifest_artifacts` (for the ecosystem→workstream mapping + service-name resolution).
- **Frontend:** `MigrationBookOfWorkItemDrawer.tsx` (`RefChipList:45-67`, call sites `:207-236`); `MigrationBookOfWorkReviewWorkspace.tsx:860-861` (header arch ids; `findingsCoverage.findings` already loaded); `architecturesApi.ts:151` (`listArchitectures` id+name).

### Follow-up Questions

None — all questions answered/confirmed.

## Visual Assets

### Files Provided:
No visual assets provided (mandatory `planning/visuals/` check returned no files). The ideal visual — the original migration-plan screenshot showing the parentId error banner + the inspector's raw-UUID reference lists — is described by file:line in the references; it can be added to `planning/visuals/` later without changing scope.

## Requirements Summary

### Functional Requirements

- **FR1 — Delete orphan + bypass (gateway).** Remove the post-validation prepend of the top-level `parentId:null` seed story in `migrationBookOfWorkHandler.ts` (`:1239-1242`); stop minting it at create time.
- **FR2 — Scaffold feature + story at expansion (gateway).** During the host epic's Phase-2 expansion, inject (all-at-expansion) a code-owned scaffold **feature** "Scaffold & build foundation" as the epic's first feature, with one scaffold **story** under it (`kind:'operational'`, `tags:['seed_build_files']`, confidence high, readiness ready_for_spec). Route through the normal stamp → judge → merged-hierarchy-validate path so it's hierarchy-legal by construction.
- **FR3 — Host-epic selection + gate (gateway).** Add an `ecosystem → workstream` rule (maven → `target_service_api_implementation`, npm → `target_frontend_implementation`); pick the lowest-`sequenceOrder` epic in that workstream as the host; inject when that epic is expanded (any click order); gate on a confirmed manifest existing at expansion time (also fixes the "no seed story until regenerate" timing gap).
- **FR4 — Coverage-check exclusion (gateway).** The "exactly one story per inventory item" coverage check (`:1167-1176`) must exclude the non-inventory scaffold story from the inventory count.
- **FR5 — Service-name resolution with graceful fallback (gateway).** For the story's `<service>` label, use the Spec 4 manifest→Service FK name when present, else the single service by cardinality, else the workstream/ecosystem label — never block. Carry the service id on the story for traceability + future multi-service.
- **FR6 — Reference name resolution (frontend).** Pass an optional `resolveRef(type, id)` into the presentational `MigrationBookOfWorkItemDrawer`; resolve `architectureReferences` via `listArchitectures(projectId)` and `discoveryFindingReferences` via the already-loaded `findingsCoverage.findings`; render `"name (id)"` on hit, raw id on miss (never blank). Leave `mappingReferences`/`sourceContextRefs`/`evidenceReferences` verbatim.
- **FR7 — Header arch-id fix (frontend).** Resolve the plan header's raw current/target arch ids (`MigrationBookOfWorkReviewWorkspace.tsx:860-861`) using the same `listArchitectures` fetch.

### Reusability Opportunities

- The expansion pipeline's existing `stampStoryFromTemplate` + judge + merged-validate path is reused to make the scaffold story hierarchy-legal (no new validation path).
- `migrationSeedBuildFilesEnrichment` / `Producer` (`SEED_BUILD_FILES_STORY_KIND`, `tag→moduleDir`) stay as the file-production mechanism — only the book-of-work hierarchy placement changes.
- One `listArchitectures(projectId)` fetch serves both the inspector references and the header fix.
- `findingsCoverage.findings` is already on the loaded draft — reuse for finding-title resolution (no new request).

### Scope Boundaries

**In Scope:**
- Delete the orphan seed story + post-validation bypass.
- Inject a code-owned scaffold feature + story at host-epic expansion (ecosystem→workstream homing, cardinality fallback), hierarchy-legal by construction, coverage-check excluded.
- Service-name resolution with graceful fallback; manifest-at-expansion gating.
- Resolve `architectureReferences` + `discoveryFindingReferences` to `name (id)` in the drawer; fix the header arch ids.

**Out of Scope:**
- Multi-codebase / multi-manifest scaffold homing (deferred; FK foundation from Spec 4).
- `apiBaselineReferences` / `evidenceReferences` name resolution (best-effort later).
- Any change to `mappingReferences` / `sourceContextRefs` rendering.
- The manifest→Service FK itself (Spec 4).
- Changing how seed build files are produced/placed (`tag→moduleDir` enrichment stays).

### Technical Considerations

- **Hierarchy-legal by construction:** routing the scaffold feature+story through the existing merged-hierarchy validation (rather than bypassing it) is the core correctness property — after this spec, no item evades `validateBookOfWorkHierarchy`.
- **Soft dependency on Spec 4:** the FK gives precise service identification, but single-service homing works via ecosystem→workstream + first-epic cardinality, and service-name resolution falls back gracefully — so Spec 6 is not hard-blocked if the FK is absent for a given manifest.
- **LLM-emitted references:** reference ids may be stale/hallucinated, so name resolution must always fall back to the raw id (never blank); the drawer stays presentational (lookup injected, not fetched inside it).
- **Verification:** whole-repo frontend baseline is red — verify in isolation. Gateway = Jest (cover the expansion injection + coverage-check exclusion + the now-absent orphan), frontend = Vitest (reference/header resolution + raw-id fallback). A regression test should prove an epic expansion succeeds with a confirmed manifest present (the exact scenario that fails today).
