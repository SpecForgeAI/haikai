# Task Breakdown: Migration Book-of-Work — Scaffold-Story Fix + Reference Name Resolution

## Overview
Total Tasks: 5 task groups

This spec fixes the `parentId:null` expansion bug by deleting the orphan seed story + post-validation bypass and re-homing the scaffold work as a hierarchy-legal feature+story injected at Phase-2 expansion, plus resolves raw reference UUIDs to `name (id)` in the plan inspector drawer and header.

Verification reminder: gateway = Jest; frontend = Vitest run IN ISOLATION (whole-repo frontend baseline is red). For each group, write only the 2-8 focused tests in `x.1` and run ONLY those — never the full suite.

## Task List

### Gateway Layer

#### Task Group 1: Delete the orphan seed story + post-validation bypass
**Dependencies:** None

- [x] 1.0 Remove create-time orphan minting and validator bypass
  - [x] 1.1 Write 2-8 focused Jest tests for create-time behavior
    - Limit to 2-8 highly focused tests maximum
    - Assert a book created with a confirmed manifest present has NO top-level `parentId:null` story on `validated.items`
    - Assert no `seed_build_files_prepended` / `seed_build_files_skipped` diagnostic is emitted at create time
    - Skip exhaustive coverage of the full create pipeline
  - [x] 1.2 Remove the post-validation prepend block in `migrationBookOfWorkHandler.ts:1231-1268`
    - Delete the block that injects the `parentId:null` story onto `validated.items` after `validateBookOfWorkHierarchy`
    - Remove the `seed_build_files_prepended` / `seed_build_files_skipped` diagnostics
  - [x] 1.3 Remove `buildSeedBuildFilesStoryItem` (`migrationBookOfWorkHandler.ts:747-773`)
    - Delete the helper that mints the top-level seed story
  - [x] 1.4 Retire the create-time manifest read
    - Drop the `fetchTargetManifestArtifacts` dependency + `defaultFetchLatestTargetManifestArtifacts` wiring from the create handler IF no other create-time consumer remains
    - KEEP the `targetManifestArtifactsClient.ts` AMS client itself intact for Group 2/3 expansion-time reuse
  - [x] 1.5 Run ONLY the 2-8 tests written in 1.1
    - Verify no create-time item evades `validateBookOfWorkHierarchy`
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- A book is created with NO top-level `parentId:null` story
- The prepend block, `buildSeedBuildFilesStoryItem`, and the bypass diagnostics are gone
- The AMS manifest client is preserved for reuse
- No item created at book-creation time evades `validateBookOfWorkHierarchy`

#### Task Group 2: Ecosystem→workstream homing, host-epic selection, service-name resolution
**Dependencies:** Task Group 1

- [x] 2.0 Build host-epic selection and service-name resolution helpers
  - [x] 2.1 Write 2-8 focused Jest tests for the resolution helpers
    - Limit to 2-8 highly focused tests maximum
    - Test ecosystem→workstream mapping (maven → `target_service_api_implementation`, npm → `target_frontend_implementation`, case-insensitive)
    - Test host-epic selection: lowest-`sequenceOrder` epic whose `workstream` matches the mapped workstream
    - Test service-name fallback chain: Spec-4 `target_service_element_id` name → single-service cardinality → workstream/ecosystem label
    - Skip exhaustive permutations and unrelated mapping edge cases
  - [x] 2.2 Add the code-owned `ecosystem → workstream` map
    - `maven → target_service_api_implementation`, `npm → target_frontend_implementation`
    - Case-insensitive on the manifest `ecosystem` field (`targetManifestArtifactsClient.ts` `ecosystem:66/102`)
    - When the manifest carries multiple ecosystems, select the manifest whose ecosystem maps to the host epic being expanded (multi-codebase homing stays out of scope)
  - [x] 2.3 Implement host-epic selection (pure-ish helper)
    - Resolve at the start of `expandMigrationBookOfWorkEpic` against the fetched book
    - Host = lowest-`sequenceOrder` epic whose `workstream` matches the mapped workstream
    - Return a clear signal for "the epic currently being expanded IS the host" usable under single-epic expand and "Expand all"
  - [x] 2.4 Implement service-name resolution with graceful fallback (pure-ish helper)
    - Priority: (1) Spec-4 `target_service_element_id` → bound target-state `services` element name; (2) single service by cardinality; (3) workstream/ecosystem label (e.g. "service API" / "frontend")
    - Never block expansion on an unresolved name
    - Return the resolved service id (the `target_service_element_id`, when present; null when unresolved) for traceability
  - [x] 2.5 Run ONLY the 2-8 tests written in 2.1
    - Verify mapping, host-epic selection, and fallback chain behave as specified
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- ecosystem→workstream mapping is case-insensitive and code-owned
- Host epic resolves to the lowest-`sequenceOrder` epic in the mapped workstream
- Service-name resolution follows the priority chain and never blocks; service id carried when present, null when not

#### Task Group 3: Scaffold feature+story injection at expansion + coverage-check exclusion
**Dependencies:** Task Groups 1-2

- [x] 3.0 Inject the hierarchy-legal scaffold feature+story and exclude it from the coverage check
  - [x] 3.1 Write 2-8 focused Jest tests for expansion-time injection
    - Limit to 2-8 highly focused tests maximum
    - THE KEY REGRESSION: an epic expansion SUCCEEDS with a confirmed manifest present (the exact scenario that fails today on the orphan)
    - Assert exactly one "Scaffold & build foundation" feature (parent = host epic, sequenced first) + one scaffold story (parent = that feature) is produced
    - Assert the scaffold story is excluded from the coverage-check `extras` arm so the check does not trip
    - Assert no injection occurs when no confirmed manifest exists at expansion time
    - Skip exhaustive field-by-field assertions beyond the load-bearing ones
  - [x] 3.2 Gate injection on a confirmed manifest at expansion time
    - Read `target_manifest_artifacts` (latest per tag, via the existing AMS client) for the book's `targetArchitectureId`
    - If none, inject nothing and expand normally (closes the "no seed story until regenerate" timing gap)
    - Inject only when the epic currently being expanded IS the host epic (from Group 2), regardless of click order
  - [x] 3.3 Create the scaffold FEATURE
    - Title "Scaffold & build foundation", parented to the host epic, sequenced as the epic's FIRST feature
    - Mirror existing stamped conventions where applicable
  - [x] 3.4 Create the scaffold STORY under the feature
    - `type:'story'`, `kind:'operational'`, `tags:['seed_build_files']` plus `stream:<stream>` and a stamped-provenance tag consistent with existing stamped stories
    - `confidence:'high'`, `readiness:'ready_for_spec'`, empty `readinessReasons`/`missingInputs`
    - Title/AC seed: "Scaffold the `<service>` app and reproduce `<manifest filename>` exactly as confirmed, dependency-for-dependency." (`<service>` from Group 2; `<manifest filename>` from `manifest_path`/tag)
    - Carry the resolved service id on the story (null when unresolved)
  - [x] 3.5 Route the feature+story through the SAME validate path — no bypass
    - `validateMigrationBookOfWorkItem` per item, then `validateBookOfWorkHierarchy([...book.items, feature, story, ...stories])` (`migrationBookOfWorkExpansionHandler.ts:1287`) BEFORE the atomic append
    - Append them together with the epic's stories in the single `appendItems(... expansion_state:'expanded')` call (`:1299-1303`)
    - Reuse the existing stamp → schema-validate → merged-hierarchy-validate path; add no new validation code
  - [x] 3.6 Exclude the scaffold story from the coverage check (`:1167-1176`)
    - The "exactly one story per inventory item" check computes `missing` and `extras`
    - Exclude the non-inventory scaffold story (identified by `tags:['seed_build_files']` / its synthetic id, not in `factsById`) from the `extras` calculation
    - The scaffold feature is a feature and is already not counted as a story
  - [x] 3.7 Run ONLY the 2-8 tests written in 3.1
    - Verify a manifest-present expansion SUCCEEDS and is hierarchy-legal by construction
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- An epic expansion SUCCEEDS with a confirmed manifest present (key regression fixed)
- Exactly one scaffold feature (first under host epic) + one scaffold story (under that feature) injected
- Feature+story pass `validateBookOfWorkHierarchy` via the existing merged-validate path, riding the single atomic `appendItems(... 'expanded')` call
- The scaffold story is excluded from the coverage `extras` arm; no injection without a confirmed manifest at expansion time

### Frontend Layer

#### Task Group 4: Reference + header name resolution in the inspector
**Dependencies:** None functionally (place after 1-3 for coherence)

- [x] 4.0 Resolve architecture + discovery-finding refs and header arch ids to `name (id)`
  - [x] 4.1 Write 2-8 focused Vitest tests (run IN ISOLATION)
    - Limit to 2-8 highly focused tests maximum
    - Assert the drawer renders `"name (id)"` for architecture refs and `"title (id)"` for discovery-finding refs, with raw-id fallback on miss (never blank)
    - Assert mapping / source-context / evidence / API-baseline ref lists render verbatim (unchanged)
    - Assert the header shows `"name (id)"` for current/target arch ids with raw-id fallback on fetch failure
    - Skip exhaustive coverage of all chip/state permutations
  - [x] 4.2 Add the optional `resolveRef` prop to `MigrationBookOfWorkItemDrawer`
    - `resolveRef?(type: 'architecture' | 'discoveryFinding', id: string): string`
    - `RefChipList` (`:45-67`) renders `resolveRef(type, value) ?? value` per chip (raw id on miss, never blank)
    - Keep the drawer presentational: lookup injected, not fetched inside the component
  - [x] 4.3 Apply `resolveRef` only at the two intended call sites
    - Architecture references `:212-216` and discovery-finding references `:222-226`
    - Leave evidence, API-baseline, mapping, and source-context call sites verbatim
  - [x] 4.4 Supply `resolveRef` from `MigrationBookOfWorkReviewWorkspace`
    - Architecture ids → `"name (id)"` from a `listArchitectures(projectId)` fetch (`architecturesApi.ts:151`, `{id,name}`)
    - Discovery-finding ids → `"title (id)"` from the already-loaded `findingsCoverage.findings` (`{id,title}`) — zero new fetch for findings
    - Fetch architectures once on mount (or on `projectId`/draft load); tolerate fetch failure by falling back to raw ids everywhere
  - [x] 4.5 Fix the header arch ids (`MigrationBookOfWorkReviewWorkspace.tsx:860-861`)
    - Render current/target arch ids as `"name (id)"` (raw id fallback) using the SAME `listArchitectures(projectId)` result fetched for 4.4 (one fetch serves both)
  - [x] 4.6 Run ONLY the 2-8 tests written in 4.1, in isolation
    - Vitest scoped to these components only; do NOT run the whole-repo frontend suite (baseline is red)

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass in isolation
- Drawer architecture + discovery-finding refs show `name (id)` with raw-id fallback; other ref lists unchanged
- Header current/target arch ids show `name (id)` with raw-id fallback on fetch failure
- One `listArchitectures(projectId)` fetch serves both drawer and header; finding titles use the already-loaded `findingsCoverage.findings`

### Testing

#### Task Group 5: Cross-tier test review & gap analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the gateway tests from 1.1, 2.1, 3.1 and the frontend tests from 4.1
    - Total existing tests: approximately 8-32 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical workflows lacking coverage; focus ONLY on this spec's requirements
    - Prioritize the end-to-end expansion regression and the scaffold hierarchy-legality property over unit gaps
    - Do NOT assess whole-application coverage
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - MUST include the end-to-end regression: an epic expansion SUCCEEDS (hierarchy-legal) with a confirmed manifest present, producing exactly one scaffold feature + one scaffold story under the host epic
    - Optionally cover integration seams (host-epic selection under "Expand all", coverage-check exclusion, service-name fallback feeding the story title)
    - Do NOT write comprehensive coverage for all scenarios; skip edge/perf/a11y unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Gateway (Jest): the tests from 1.1, 2.1, 3.1, plus relevant 5.3 additions
    - Frontend (Vitest, in isolation): the tests from 4.1
    - Expected total: approximately 18-42 tests; do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-42 tests total)
- The end-to-end expansion-succeeds-with-confirmed-manifest regression is covered and green
- No more than 10 additional tests added to fill gaps
- Testing focused exclusively on this spec's requirements

## Execution Order

Recommended implementation sequence:
1. Delete the orphan + bypass (Task Group 1)
2. Ecosystem→workstream + host-epic selection + service-name resolution (Task Group 2)
3. Scaffold feature+story injection at expansion + coverage-check exclusion (Task Group 3)
4. Frontend reference + header name resolution (Task Group 4)
5. Cross-tier test review & gap analysis (Task Group 5)
