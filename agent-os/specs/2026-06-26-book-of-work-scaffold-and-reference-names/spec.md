# Specification: Migration Book-of-Work — Scaffold-Story Fix + Reference Name Resolution

## Goal
Fix the parentId expansion bug by parenting scaffold work properly into the hierarchy (no orphan story, no validator bypass), and resolve raw reference UUIDs to `name (id)` in the plan inspector and header.

## User Stories
- As a delivery lead, I want to expand any epic on a plan that has a confirmed target manifest so that the plan no longer fails with a "story must have non-null parentId" error.
- As a delivery lead, I want the host implementation epic to carry a scaffold feature + story for reproducing the confirmed manifest so that the build foundation is sequenced and traceable inside the hierarchy.
- As a reviewer, I want architecture and discovery-finding references shown as human-readable `name (id)` so that the inspector and header are not walls of raw UUIDs.

## Specific Requirements

**FR1 — Delete the orphan seed story + post-validation bypass (gateway)**
- Remove `buildSeedBuildFilesStoryItem` (`migrationBookOfWorkHandler.ts:747-773`) and stop minting the top-level `parentId:null` story.
- Remove the post-validation prepend block (`:1231-1268`) that injects that story onto `validated.items` after `validateBookOfWorkHierarchy`, including the `seed_build_files_prepended/skipped` diagnostics.
- Drop the now-unused create-time manifest read (`fetchTargetManifestArtifacts` dep + `defaultFetchLatestTargetManifestArtifacts`) from the create handler if it has no other consumer; keep the AMS client itself for the expansion handler to reuse.
- After this change no item created at book-creation time evades `validateBookOfWorkHierarchy`.

**FR2 — Ecosystem→workstream + host-epic selection (gateway, expansion handler)**
- Add a code-owned `ecosystem → workstream` map: `maven → target_service_api_implementation`, `npm → target_frontend_implementation` (case-insensitive on the manifest `ecosystem` field).
- The host epic is the lowest-`sequenceOrder` epic whose `workstream` matches the mapped workstream; resolve at the start of `expandMigrationBookOfWorkEpic` against the fetched book.
- Inject the scaffold only when the epic currently being expanded IS that host epic — regardless of click order (works under single-epic expand and "Expand all").
- Gate on a confirmed manifest existing AT EXPANSION TIME: read `target_manifest_artifacts` (latest per tag, via the existing AMS client) for the book's `targetArchitectureId`; if none, inject nothing and expand normally. This closes today's "no seed story until regenerate" timing gap.
- When the manifest carries multiple ecosystems, select the manifest whose ecosystem maps to the host epic being expanded; multi-codebase homing stays out of scope.

**FR3 — Scaffold feature + story injection at expansion (gateway, hierarchy-legal)**
- All-at-expansion: during the host epic's pipeline, create ONE code-owned FEATURE "Scaffold & build foundation" parented to the host epic, sequenced as the epic's FIRST feature, plus ONE STORY parented to that feature.
- Story fields: `type:'story'`, `kind:'operational'`, `tags:['seed_build_files']` (carry `stream:<stream>` + a stamped-provenance tag consistent with existing stamped stories), `confidence:'high'`, `readiness:'ready_for_spec'`, empty `readinessReasons`/`missingInputs`.
- Story title/AC seed: "Scaffold the `<service>` app and reproduce `<manifest filename>` exactly as confirmed, dependency-for-dependency." (`<manifest filename>` from the manifest `manifest_path`/tag).
- Route the new feature + story through the SAME validate path used for stories: `validateMigrationBookOfWorkItem` per item, then `validateBookOfWorkHierarchy([...book.items, feature, story, ...stories])` (`:1287`) BEFORE the atomic append, and append them together with the epic's stories in the single `appendItems(... expansion_state:'expanded')` call. No new validation path, no bypass.
- The pipeline already throws (→ `failed`, retryable) on any validation miss; the scaffold feature/story must satisfy the hierarchy by construction so a manifest-present expansion SUCCEEDS.

**FR4 — Coverage-check exclusion (gateway)**
- The "exactly one story per inventory item" check (`migrationBookOfWorkExpansionHandler.ts:1167-1176`) computes `missing` (inventory items with no story) and `extras` (stories whose id is not an inventory fact id).
- Exclude the non-inventory scaffold story (identified by `tags:['seed_build_files']` / its synthetic id, not in `factsById`) from the `extras` calculation so it does not trip the check; the scaffold feature is a feature (already not counted as a story).

**FR5 — Service-name resolution with graceful fallback (gateway)**
- Resolve `<service>` for the story title/AC in priority order: (1) Spec-4 `target_service_element_id` → the bound target-state `services` element name when present; (2) else, if exactly one service exists (cardinality), use that service's name; (3) else the workstream/ecosystem label (e.g. "service API" / "frontend"). Never block expansion on an unresolved name.
- Carry the resolved service id (the `target_service_element_id`, when present) on the scaffold story for traceability and future multi-service homing; null when unresolved.

**FR6 — Reference name resolution in the drawer (frontend)**
- Add an optional `resolveRef?(type: 'architecture' | 'discoveryFinding', id: string): string` prop to the presentational `MigrationBookOfWorkItemDrawer`; `RefChipList` (`:45-67`) renders `resolveRef(type, value) ?? value` per chip (never blank, raw id on miss).
- Apply `resolveRef` only at the architecture-references and discovery-finding-references call sites (`:212-216`, `:222-226`); leave the evidence, API-baseline, mapping, and source-context call sites verbatim.
- The parent (`MigrationBookOfWorkReviewWorkspace`) supplies `resolveRef`: architecture ids resolve to `"name (id)"` from a `listArchitectures(projectId)` fetch; discovery-finding ids resolve to `"title (id)"` from the already-loaded `findingsCoverage.findings` (`{id,title}`) — zero new fetch for findings.
- Drawer stays presentational: lookup injected, not fetched inside the component.

**FR7 — Header arch-id fix (frontend)**
- In `MigrationBookOfWorkReviewWorkspace.tsx:860-861`, render the current/target arch ids as `"name (id)"` (raw id fallback) using the same `listArchitectures(projectId)` result fetched for FR6 (one fetch serves both).
- Fetch once on mount (or on `projectId`/draft load); tolerate fetch failure by falling back to raw ids everywhere.

## Existing Code to Leverage

**`migrationBookOfWorkExpansionHandler.ts` — expansion pipeline (`runEpicPipeline`, `stampStoryFromTemplate:407`, merged validate `:1287`, atomic append `:1299-1303`)**
- Reuse the existing stamp → schema-validate → merged-hierarchy-validate → single atomic append path so the scaffold feature+story are hierarchy-legal by construction with no new validation code.
- Mirror `stampStoryFromTemplate`'s field set/tag conventions (`stream:`/`provenance:` tags, confidence/readiness) for the scaffold story.

**`generatedMigrationBookOfWorkSchema.ts` — `validateBookOfWorkHierarchy:246` / `ALLOWED_PARENT_TYPE:216`**
- Defines feature-under-epic and story-under-feature legality; the scaffold feature (parent = host epic) and story (parent = scaffold feature) must satisfy these — this is the correctness property the spec restores.

**`targetManifestArtifactsClient.ts` — manifest reader (`ecosystem:66/102`, `target_service_element_id:80/108`)**
- Reuse the existing AMS client at expansion time for the manifest gate, the ecosystem→workstream mapping, the manifest filename, and the Spec-4 service FK.

**`migrationSeedBuildFilesEnrichment.ts` / `migrationSeedBuildFilesProducer.ts` (`SEED_BUILD_FILES_STORY_KIND`, `tag→moduleDir`)**
- The downstream enrichment/producer recognises the `seed_build_files`-tagged story and writes the verbatim manifest at its resolved module path — keep this mechanism; only the story's hierarchy placement changes.

**`MigrationBookOfWorkItemDrawer.tsx` `RefChipList:45-67` + `architecturesApi.ts:151` `listArchitectures` + `findingsCoverage.findings`**
- One `listArchitectures(projectId)` (`{id,name}`) fetch serves the drawer architecture refs and the header; `findingsCoverage.findings` (`{id,title}`) is already on the loaded draft for finding-title resolution.

## Out of Scope
- Multi-codebase / multi-manifest scaffold homing (FK foundation from Spec 4 only).
- `apiBaselineReferences` and `evidenceReferences` name resolution (best-effort later).
- Any change to `mappingReferences` / `sourceContextRefs` rendering (stay verbatim).
- The manifest→Service FK itself (owned by Spec 4).
- Changing how seed build FILES are produced/placed (`tag→moduleDir` enrichment stays).
- Any guard/warning for the host-epic-never-expanded edge (no scaffold appears until the host epic or "Expand all" is run — accepted as-is).
- Re-expansion of an already-`expanded` epic.

## Verification
- Gateway Jest (key regression): an epic expansion SUCCEEDS for a book with a confirmed target manifest present — the exact scenario that fails today on the orphan; plus tests for host-epic selection (ecosystem→workstream, lowest sequenceOrder), scaffold feature+story injected and hierarchy-legal, coverage-check excludes the scaffold story, service-name fallback chain, and the orphan/bypass now absent at create time.
- Frontend Vitest in isolation (whole-repo baseline is red): drawer renders `name (id)` for architecture + discovery-finding refs with raw-id fallback on miss, leaves the other ref lists verbatim, and the header shows `name (id)` for current/target arch ids with raw-id fallback on fetch failure.
