# Raw Idea — Spec 6: Migration Book-of-Work — Scaffold-Story Fix + Reference Name Resolution

> First of the book-of-work fixes. **Depends on Spec 4** (manifest→Service FK) for service
> identification; single-service homing also resolves via cardinality. Most scope agreed in
> prior discussion (**LOCKED**); shaping confirms + focuses on the **RESIDUAL QUESTIONS**.

## Problem (two issues, one spec)

### Issue 1 — the parentId expansion bug (the broken plan)
`buildSeedBuildFilesStoryItem` (`migrationBookOfWorkHandler.ts:747-773`) mints a **top-level
story with `parentId:null`** and **prepends it AFTER validation** (`:1239-1242`), bypassing
`validateBookOfWorkHierarchy` (which requires a story to parent a feature). When any epic is
expanded, Phase-2 re-validates the WHOLE merged tree
(`migrationBookOfWorkExpansionHandler.ts:1287`), the orphan seed story trips "story must have
non-null parentId" (`generatedMigrationBookOfWorkSchema.ts:275`), and **every epic expansion
fails** as collateral damage. (Only triggers for projects with a confirmed target manifest.)

### Issue 3 — references show raw UUIDs
The plan inspector renders reference lists (`evidenceReferences`, `architectureReferences`,
`discoveryFindingReferences`, `mappingReferences`, `sourceContextRefs`) verbatim through one
`RefChipList` (`MigrationBookOfWorkItemDrawer.tsx:45-67`) — meaningless UUIDs. The plan header
also shows raw arch ids (`MigrationBookOfWorkReviewWorkspace.tsx:860-861`).

## Goal

Fix the parentId bug by **parenting the scaffold work properly into the hierarchy** (no orphan,
no validator bypass), and **resolve reference IDs to names** in the inspector + header.

## LOCKED design

### Scaffold-story fix
- **Delete the orphan + bypass**: stop prepending the top-level `parentId:null` seed story in
  `migrationBookOfWorkHandler.ts` (remove the post-validation prepend `:1239-1242`).
- **Inject at Phase-2 expansion** of the manifest's host implementation epic: a **dedicated
  code-owned scaffold feature** ("Scaffold & build foundation") as the epic's first feature,
  with **one scaffold story** under it ("Scaffold the app and reproduce `<manifest>` exactly as
  confirmed — dependency-for-dependency"). `kind:'operational'`, `tags:['seed_build_files']`,
  confidence high, readiness ready_for_spec.
- Route the scaffold feature+story through the **normal stamp → judge → merged-hierarchy
  validate** path so it is **hierarchy-legal by construction** — the parentId error is gone and
  the bypass is deleted.
- **Host epic selection**: map the manifest's **ecosystem → workstream** (maven →
  `target_service_api_implementation`, npm → `target_frontend_implementation`) and pick the
  **lowest-`sequenceOrder` epic** in that workstream; inject the scaffold feature+story when
  **that** epic is expanded (regardless of click order). Single-service resolves by cardinality;
  the Spec 4 manifest→Service FK is carried on the story for traceability + future multi-service.
- **Coverage check**: the existing "exactly one story per inventory item" check
  (`migrationBookOfWorkExpansionHandler.ts:1167-1176`) must **exclude** the non-inventory
  scaffold story from the inventory count.
- Gated on a confirmed manifest existing **at expansion time** (this also fixes today's "no seed
  story until you regenerate" timing gap).

### Reference name resolution (Issue 3)
- Resolve **architectureReferences** → `name (id)` via `listArchitectures(projectId)`
  (`{id,name}`) — also fixes the **header** raw arch ids
  (`MigrationBookOfWorkReviewWorkspace.tsx:860-861`).
- Resolve **discoveryFindingReferences** → `title (id)` from the already-loaded
  `draft.generationSummary.findingsCoverage.findings` (`{id,title}`) — **zero new fetch**.
- **Leave verbatim**: `mappingReferences` + `sourceContextRefs` (descriptive strings, not ids);
  `evidenceReferences` (evidence highlights carry no name — and some are already-readable
  `[decision:<code>]` codes).
- Frontend render-time lookup: pass an optional `resolveRef(type, id)` into the presentational
  drawer; `"name (id)"` on hit, raw id on miss (never blank). `apiBaselineReferences` deferred
  (best-effort later via a baselines fetch).

## RESIDUAL QUESTIONS (the focus of shaping)

1. **Scaffold feature timing** — create BOTH the scaffold feature AND its story during the host
   epic's expansion (all-at-expansion, fully code-owned; recommended), vs a Phase-1 code-stamped
   feature + Phase-2 story?
2. **Host-epic-never-expanded edge** — if only non-host epics are expanded, no scaffold appears
   until the host epic (or "Expand all") is expanded. Acceptable (recommended), or add a
   guard/warning?
3. **Scaffold story title/AC wording** — confirm the gist ("Scaffold the `<service>` app and
   reproduce `<manifest filename>` exactly as confirmed, dependency-for-dependency").
4. **Names scope** — resolve architectureReferences + discoveryFindingReferences now; leave
   evidence/mapping/source-context verbatim; **defer** apiBaselineReferences (best-effort later)?
   Or include baselines now?
5. **Header fix** — also resolve the plan header's raw arch ids as part of this (recommended,
   same `listArchitectures` fetch)?

## Existing code to reference

- `gateway/src/services/migrationBookOfWorkHandler.ts` (`buildSeedBuildFilesStoryItem:747-773`;
  prepend/bypass `:1239-1242`; manifest gate `:1231-1237`).
- `gateway/src/services/migrationBookOfWorkExpansionHandler.ts` (expansion pipeline;
  `stampStoryFromTemplate`; merged validate `:1287`; coverage check `:1167-1176`).
- `gateway/src/services/generatedMigrationBookOfWorkSchema.ts` (`validateBookOfWorkHierarchy:246-336`;
  parentId rule `:274-277`; `ALLOWED_PARENT_TYPE:214-223`).
- `gateway/src/services/migrationSeedBuildFilesEnrichment.ts` / `migrationSeedBuildFilesProducer.ts`
  (`SEED_BUILD_FILES_STORY_KIND`; `tag→moduleDir`).
- Manifest→Service FK (Spec 4): `target_service_element_id` on `target_manifest_artifacts`;
  `ecosystem` field for the ecosystem→workstream mapping.
- `frontend/src/components/ProductManager/MigrationDeliveryPlan/MigrationBookOfWorkItemDrawer.tsx:45-67`
  (`RefChipList`; 6 call sites `:207-236`);
  `MigrationBookOfWorkReviewWorkspace.tsx:860-861` (header arch ids; `findingsCoverage.findings`
  already loaded); `frontend/src/api/architecturesApi.ts:151` (`listArchitectures` id+name).

## Out of scope

- Multi-codebase / multi-manifest scaffold homing (deferred; FK foundation from Spec 4).
- `apiBaselineReferences` / `evidenceReferences` name resolution (best-effort later).
- Any change to `mappingReferences` / `sourceContextRefs` rendering.
- The manifest→Service FK itself (Spec 4).
- Changing how the seed build FILES are produced/placed (`tag→moduleDir` enrichment stays).
