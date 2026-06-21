# Task Breakdown: Skipped-candidate visibility + grouped bulk-fill (C1) for discovery save-back

## IMPLEMENTER GUARDRAILS (READ FIRST - NON-NEGOTIABLE)

Implementer subagents have **Write but NO Edit**. Whole-file `Write` calls have **CLOBBERED large files** in this repo. To prevent data loss:

- **EXISTING files MUST be edited in place via anchored Bash/Node string splices** against unique anchors. **NEVER re-`Write` an entire existing file.** This applies especially to:
  - `mcp-server/src/services/candidateSaveBackService.ts` (VERY large - ~3500+ lines)
  - `mcp-server/src/routes/saveApprovedCandidatesRoute.ts`
  - `architecture-model-service/.../controller/DiscoveryCandidateController.java`
  - `architecture-model-service/.../service/DiscoveryCandidateService.java`
  - `gateway/src/routes/discovery.ts`
  - `frontend/src/api/discoveryApi.ts`
  - `frontend/src/components/DashboardView/DiscoveryRunDetailPage.tsx`
  - `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`
- **NEW files MAY use `Write`**: the C1 panel component, an extracted breakdown-chip component, new Java DTO records, and all new test files.
- **NEVER use `git checkout` / `git stash` / `git reset`.**
- **After EVERY edit to an existing file**: grep it for the mojibake marker `â€"` (expect **zero** hits) and re-read the spliced region plus its surroundings to confirm byte-intactness. **Preserve each file's existing line endings** (do not convert CRLF<->LF).
- **WORKING-DIRECTORY CAUTION**: the Bash cwd may persist across calls and may be wrong. **Always use ABSOLUTE paths**, e.g.:
  - `mvn -o -f C:/Workspaces/SSD/haikai/architecture-model-service/pom.xml test -Dtest=...`
  - `cd C:/Workspaces/SSD/haikai/mcp-server && npx jest ...`
  - `cd C:/Workspaces/SSD/haikai/frontend && npx vitest run ...`
- **Test discipline (every group)**: write only **2-8 focused tests** per dev group, and at the end of the group run **ONLY** that group's new tests - never the whole suite. The dedicated review group (Group 8) adds **at most 10** additional tests.

## NON-GOALS (do not implement)

- C2 editable-grid / fill-down and C3 inline-row fix (fast-follow).
- Surfacing uncommitted candidates inside the architecture-model grids.
- A general merge/dedup overhaul - **EXCEPT** the specific `business_logics` on-collision name-qualification rule, which IS in scope.
- Changing the save-back / commit algorithm beyond: the reason arm, the `commit=false` dry-run mode, and the `business_logics` qualifier.
- A new `skip_reason` column on `DiscoveryCandidateEntity` - use linked Findings + the ephemeral result arm instead.
- Approving a sibling candidate inline or minting a referenced entity inline from the panel (v1 = pick-from-existing only).
- New per-row checkboxes on the main candidate table.
- "Always qualify" every `business_logic` as `class.method` (on-collision only).
- Multi-role / permissions.

## Overview
Total Tasks: 8 task groups

## Task List

### Backend - mcp-server save-back core

#### Task Group 1: Reason arm + reused-subclass classification + business_logics qualifier + dry-run mode
**File (edit IN PLACE, anchored splices only):** `mcp-server/src/services/candidateSaveBackService.ts`
**Dependencies:** None

- [x] 1.0 Extend save-back with the reason arm, reused classification, the business_logics collision qualifier, and a `commit=false` dry-run mode
  - [x] 1.1 Write 2-8 focused tests (new file `mcp-server/src/__tests__/candidateSaveBackReasonArm.test.ts`, mirroring existing `candidateSaveBack*.test.ts` setup)
    - A BLOCKED candidate (e.g. orphan child / no parent) is captured on the reason arm with `reason` + `missingField` (not just `console.warn`'d)
    - `reused` is classified correctly into `intra-scan` (matched an entity accumulated in the in-save `targetArray`), `pre-existing` (matched a name in `preExistingNamesByArray`), and `already-saved` (in `alreadySavedCandidateIds`)
    - Two same-named `business_logics` methods on DIFFERENT parent classes survive as TWO qualified `business_logics` (`<class>.<method>`); a same-name + same-class pair still collapses to one
    - `commit=false` dry-run persists nothing AND returns the would-commit / would-still-block projection
    - Limit to 2-8 tests total; do not exhaustively cover all ~26 warn branches
  - [x] 1.2 Add the per-candidate reason arm type and field on `SaveBackResult` (interface ~line 176)
    - Arm element: `{ candidateId, candidateType, name, class, reusedSubclass?, missingField?, reason }`
    - Add the arm array field to the interface; keep existing `entitiesSkipped`, `suppressedDuplicates[]` (~line 192), `possibleDuplicates[]` (~line 198), `candidateActions[]`, and `findingsEmitted` (~line 220) intact
    - Also populate the arm on the early-return path (the all-already-saved short-circuit ~line 2233)
  - [x] 1.3 Populate the arm at every skip/reuse site (info is already in hand at the `console.warn` sites - 26 total, ~16 BLOCKED)
    - `created` / `reused`: derive from `candidateActions[]` (action `created|reused`, push site ~line 2549/2566)
    - Classify `reused`: `intra-scan` (matched in-save `targetArray.find(...)` ~line 2540), `pre-existing` (name in `preExistingNamesByArray` snapshot ~line 2331/2485), `already-saved` (in `alreadySavedCandidateIds` ~line 2216 - currently uncounted)
    - BLOCKED branches (the `entitiesSkipped++` + `console.warn` sites, e.g. ~lines 2386/2407/2453/2555/2678/2694): capture specific `reason` + `missingField` (orphan/no-parent, unresolved source/target reference, dangling-FK prune, unknown type)
    - Quality-gap detection (starter set, extensible): interface committed with only the defaulted `REST_API` `interface_type`; endpoint with empty `operation_verb` and/or `path_or_address`; logical/physical entity committed with no attributes. Use the per-type required-field logic in `convertCandidateToEntity` (~line 920) as the source of truth for what is missing.
  - [x] 1.4 Add the `business_logics` `<class>.<method>` qualification ON COLLISION at the save-back boundary
    - Qualify BEFORE the bare-name dedup driven by `normalizeNameForMatch` (~line 396) - that is where the false-collapse happens
    - `business_logics` is top-level (`parentFkField: null`, per `CANDIDATE_TYPE_CONFIG` ~lines 248-308); read class as `data.controllerClassName ?? data.className` (corroborated by `data.methodId`); reuse the exact source `discovery-service/src/services/candidateIdentity.ts` already uses
    - RULE: only when the bare method name is duplicated across DIFFERENT parent classes within the run, rewrite `name` -> `<class_name>.<method_name>`. Same-name + same-class stays a genuine duplicate (collapse as today)
    - Where class context is missing, do NOT guess - leave the candidate for the C1 fallback group (Group 7) and (per Group 2) it surfaces as a finding/arm entry
    - Note for implementer: `normalizeNameForMatch` strips `\s _ - .`, so `Order.process` -> `orderprocess` stays distinct from `Payment.process` -> `paymentprocess`; the qualifier IS effective against the existing normalizer
  - [x] 1.5 Add a `commit=false` dry-run execution mode
    - Thread a `commit` flag (default `true`) into the save-back entry function so PREVIEW runs the REAL ~25-branch resolution against drafted edits and returns would-commit / would-still-block WITHOUT persisting (no archModelClient writes, no finding emission side-effects)
    - Mirror the proven preview/commit pattern in `MigrationDeliveryBulkResolveModal.tsx` (`commit=false` preview, `commit=true` commit)
  - [x] 1.6 Run ONLY this group's tests
    - `cd C:/Workspaces/SSD/haikai/mcp-server && npx jest candidateSaveBackReasonArm`
    - After each edit, grep `candidateSaveBackService.ts` for `â€"` (expect zero) and re-read the spliced regions
    - Do NOT run the full mcp-server suite

**Acceptance Criteria:**
- The 2-8 tests in 1.1 pass
- The reason arm rides back on `SaveBackResult`, populated at every skip/reuse site; reused classified into intra-scan / pre-existing / already-saved
- BLOCKED + quality-gap candidates carry `reason` + `missingField` on the arm
- Two distinct-class same-named methods survive as two qualified `business_logics`; same-name+same-class still collapses
- `commit=false` persists nothing and returns the would-commit / would-still-block projection
- `suppressedDuplicates[]` / `possibleDuplicates[]` / `candidateActions[]` remain on the result
- Zero `â€"` markers; file byte-intact

---

#### Task Group 2: Emit linked Findings for Blocked + Quality-gap
**File (edit IN PLACE, anchored splices only):** `mcp-server/src/services/candidateSaveBackService.ts`
**Dependencies:** Task Group 1

- [x] 2.0 Emit durable linked `DiscoveryFinding` rows for Blocked + Quality-gap candidates so the signal survives a page reload
  - [x] 2.1 Write 2-8 focused tests (extend `candidateSaveBackReasonArm.test.ts` or a sibling `candidateSaveBackFindings*.test.ts`)
    - A BLOCKED candidate emits a linked finding (`target_type='discovery_candidate'`, an `evidence_gap` gapType)
    - A QUALITY-GAP candidate likewise emits a linked finding
    - Emission is best-effort: a finding-emit failure does NOT fail the save-back
    - Limit to 2-8 tests
  - [x] 2.2 Build finding payloads for Blocked + Quality-gap arm entries
    - Reuse the existing `DiscoveryFindingCreatePayload` shape and the `saveBackFindings[]` accumulator (~line 2321) that already flows to `archModelClient.bulkCreateDiscoveryFindings` (~line 3490); follow the existing finding-builder precedent (~line 1736)
    - Link each finding to its candidate via `target_type='discovery_candidate'`
    - Map to existing `evidence_gap` gapTypes: `interface_missing_contract_detail`, `data_entity_missing_attributes`, `endpoint_missing_response_schema`, `candidate_conflict`, `ambiguous_relationship`
    - Reuse `findingsEmitted` (~line 220) on the result so the count is visible
  - [x] 2.3 Gate emission behind the `commit` flag from Group 1
    - In `commit=false` dry-run mode, do NOT write findings (preview side-effect-free)
  - [x] 2.4 Run ONLY this group's tests
    - `cd C:/Workspaces/SSD/haikai/mcp-server && npx jest candidateSaveBackReasonArm candidateSaveBackFindings`
    - Grep for `â€"` (expect zero); re-read spliced regions
    - Do NOT run the full suite

**Acceptance Criteria:**
- The 2-8 tests in 2.1 pass
- Blocked + Quality-gap candidates emit findings linked with `target_type='discovery_candidate'` via the existing `bulkCreateDiscoveryFindings` path
- Emission is best-effort and skipped under `commit=false`
- No new `skip_reason` column added anywhere
- Zero `â€"` markers; file byte-intact

---

### Backend - AMS bulk-edit endpoint

#### Task Group 3: AMS bulk-candidate-edit endpoint
**Files:** `architecture-model-service/.../controller/DiscoveryCandidateController.java` (edit IN PLACE), `architecture-model-service/.../service/DiscoveryCandidateService.java` (edit IN PLACE), new DTO records (Write OK)
**Dependencies:** None (parallelizable with Groups 1-2)

- [x] 3.0 Add a new atomic bulk-candidate-EDIT endpoint mirroring `bulkReviewCascade`
  - [x] 3.1 Write 2-8 focused tests
    - Controller test (new `DiscoveryCandidateBulkEditControllerTest.java` or extend `DiscoveryCandidateControllerTest.java`): valid bulk-edit request returns the expected response shape
    - Service test (new `DiscoveryCandidateBulkEditServiceTest.java` or extend an existing service test): the `data` JSONB blob patch round-trips through the write
    - Atomicity per spec: all-or-nothing within the `@Transactional` (and/or best-effort per the chosen contract) - assert the documented behavior
    - Basic validation (e.g. unknown candidate id / empty id set) is rejected
    - Limit to 2-8 tests
  - [x] 3.2 Create new request/response DTO records (Write OK - new files)
    - Request: a curated candidate-id set + per-candidate field patches (top-level fields + `data` blob `Map<String,Object>` patch). Response: per-candidate applied/failed results
    - Follow the AMS `snake_case` wire default; only add `@CamelCaseWire` if a camelCase consumer requires it (the frontend client here is snake_case-typed, so default is correct)
    - Clone the shape of `BulkReviewCascadeRequest` but for field patches, not `review_status`
  - [x] 3.3 Add the controller endpoint (anchored splice into `DiscoveryCandidateController.java`)
    - Mirror `bulkReviewCascade` (`@PostMapping("/bulk-review-cascade")` ~line 155): a new `@PostMapping` (e.g. `/bulk-edit`) accepting the new request DTO
    - Keep the existing logging + response-wrapping conventions
  - [x] 3.4 Add the service method (anchored splice into `DiscoveryCandidateService.java`)
    - One `@Transactional` method iterating the curated id set, applying each patch via the EXISTING `updateCandidateInArchitecture` / `updateCandidate` field-patch logic (the precedent invoked by PUT `/{candidateId}` ~line 184; `resolveConflict` is the single-attribute data-write precedent)
    - Patch fields AND the `data` JSONB blob - NOT only `review_status`
  - [x] 3.5 Run ONLY this group's tests
    - `mvn -o -f C:/Workspaces/SSD/haikai/architecture-model-service/pom.xml test -Dtest=DiscoveryCandidateBulkEdit*Test`
    - After each edit to existing Java files, grep for `â€"` (expect zero); re-read spliced regions
    - Do NOT run the full AMS test suite

**Acceptance Criteria:**
- The 2-8 tests in 3.1 pass
- New atomic bulk-edit endpoint exists, mirroring `bulkReviewCascade`, applying per-candidate field + `data`-blob patches in one `@Transactional`
- `data` JSONB patch round-trips
- DTOs are snake_case (no needless `@CamelCaseWire`)
- Zero `â€"` markers; existing files byte-intact

---

### Backend - Gateway

#### Task Group 4: Proxy the bulk-edit endpoint + the save-approved `commit=false` passthrough
**File (edit IN PLACE, anchored splices only):** `gateway/src/routes/discovery.ts`
**Dependencies:** Task Group 1 (dry-run flag), Task Group 3 (bulk-edit endpoint)

- [x] 4.0 Register the bulk-edit proxy route and ensure the dry-run flag flows through the existing save-approved proxy
  - [x] 4.1 Write 2-8 focused tests (gateway route test, following existing gateway discovery route test conventions)
    - The new bulk-edit route forwards the request to AMS and returns its response/status
    - The save-approved proxy forwards the `commit=false` flag through to MCP (dry-run passthrough)
    - Limit to 2-8 tests
  - [x] 4.2 Register the bulk-edit route (anchored splice)
    - Add a new `discoveryRouter.post(...)` proxying to the AMS bulk-edit endpoint from Group 3, mirroring the existing candidate proxy routes (e.g. the `bulk-review` proxy ~line 1392 and the AMS URL-building pattern)
    - Respect the route-ordering note in the file (more specific paths before `/candidates`)
  - [x] 4.3 Thread `commit=false` through the existing save-approved passthrough (~line 1375+, currently a pure passthrough to MCP `save_approved_candidates`)
    - Forward the dry-run flag (query param or body) unchanged to MCP; do not re-implement resolution in the gateway
  - [x] 4.4 Run ONLY this group's tests
    - `cd C:/Workspaces/SSD/haikai/gateway && npx jest discovery`
    - Grep for `â€"` (expect zero); re-read spliced regions
    - Do NOT run the full gateway suite

**Acceptance Criteria:**
- The 2-8 tests in 4.1 pass
- Bulk-edit route proxies to AMS correctly
- The `commit=false` dry-run flag flows through the save-approved proxy to MCP
- Zero `â€"` markers; file byte-intact

---

### Frontend - API client

#### Task Group 5: Frontend API client wrappers + result types
**File (edit IN PLACE, anchored splices only):** `frontend/src/api/discoveryApi.ts`
**Dependencies:** Task Groups 1, 3, 4

- [x] 5.0 Extend `SaveApprovedResult` and add the bulk-edit / per-candidate-edit / dry-run client wrappers
  - [x] 5.1 Write 2-8 focused tests (new `frontend/src/api/__tests__/discoveryApi.bulkEdit.test.ts` or extend the existing discoveryApi tests)
    - The bulk-edit client posts to the correct gateway URL with the curated id set + patches and parses the snake_case response
    - The `PUT /{candidateId}` wrapper hits the correct URL/shape
    - The dry-run save call sends `commit=false` and parses the would-commit / would-still-block + reason-arm shape
    - Limit to 2-8 tests
  - [x] 5.2 Extend the `SaveApprovedResult` type (interface ~line 616)
    - Add the per-candidate reason arm (`{ candidateId, candidateType, name, class, reusedSubclass?, missingField?, reason }`)
    - Add the `suppressedDuplicates[]` and `possibleDuplicates[]` arrays (already reach the browser but are dropped by the type today)
    - Keep `entitiesCreated` / `entitiesSkipped` / `candidatesCommitted` / `belowGateCount` intact
  - [x] 5.3 Add a wrapper over the existing AMS `PUT /{candidateId}` (server already supports full field edits; UI never wired it)
  - [x] 5.4 Add a wrapper over the new bulk-edit endpoint (snake_case wire), plus the dry-run save call (extend / add alongside `saveApprovedCandidates` ~line 1111 to pass `commit=false`)
  - [x] 5.5 Run ONLY this group's tests
    - `cd C:/Workspaces/SSD/haikai/frontend && npx vitest run src/api/__tests__/discoveryApi.bulkEdit.test.ts`
    - Grep for `â€"` (expect zero); re-read spliced regions
    - Do NOT run the full frontend suite

**Acceptance Criteria:**
- The 2-8 tests in 5.1 pass
- `SaveApprovedResult` carries the reason arm + suppressed/possible duplicate arrays
- Bulk-edit, `PUT /{candidateId}`, and dry-run client wrappers hit the correct URLs with the correct shapes
- Zero `â€"` markers; file byte-intact

---

### Frontend - Honest breakdown chip

#### Task Group 6: Honest breakdown chip with clickable tokens
**File (edit IN PLACE, anchored splices only):** `frontend/src/components/DashboardView/DiscoveryRunDetailPage.tsx`; an extracted breakdown-chip component (Write OK if extracted)
**Dependencies:** Task Group 5

- [x] 6.0 Replace the single opaque counts string with a taxonomy breakdown of clickable tokens
  - [x] 6.1 Write 2-8 focused tests (new `frontend/src/components/DashboardView/__tests__/DiscoveryBreakdownChip.test.tsx` if extracted, else a focused test on the page)
    - The chip renders the non-zero reason CLASSES (Created / Intra-scan duplicate / Pre-existing / Already saved / Suppressed duplicate / Possible duplicate / Blocked / Quality gap)
    - Reason tokens are clickable (clicking invokes the open-panel handler scoped to that class)
    - The intra-scan-duplicate advisory note renders when that count is non-zero
    - Limit to 2-8 tests
  - [x] 6.2 Replace the counts string (composed ~line 505, rendered downstream)
    - Compute counts from the new reason arm + `suppressedDuplicates[]` / `possibleDuplicates[]` on `SaveApprovedResult`
    - Render each non-zero class as a clickable token; clicking opens the C1 panel (Group 7) scoped to that class
    - `Intra-scan duplicate`, `Pre-existing`, and `Already saved` MUST be distinguished - never collapsed into one "skipped"
  - [x] 6.3 Add the intra-scan-duplicate advisory note (Q8)
    - Copy: these are second-candidate-in-same-save matches of an entity an earlier candidate just created (counted as both skipped and committed) - mostly benign; state that qualifying `business_logics` names is the targeted remediation for the largest share
    - Advisory only - do not otherwise act on it
  - [x] 6.4 Wire the token click to open the panel scoped to the clicked class (panel itself lands in Group 7; expose the open handler + selected-class state here)
  - [x] 6.5 Run ONLY this group's tests
    - `cd C:/Workspaces/SSD/haikai/frontend && npx vitest run src/components/DashboardView/__tests__/DiscoveryBreakdownChip.test.tsx`
    - Grep for `â€"` (expect zero); re-read spliced regions
    - Do NOT run the full frontend suite

**Acceptance Criteria:**
- The 2-8 tests in 6.1 pass
- The chip renders the full taxonomy of non-zero classes as clickable tokens
- Intra-scan / pre-existing / already-saved are distinguished
- The intra-scan-duplicate advisory note renders
- Zero `â€"` markers; file byte-intact

---

### Frontend - C1 remediation panel

#### Task Group 7: C1 group-by-missing-field bulk remediation panel
**Files:** new panel component (Write OK), wiring edits IN PLACE into `DiscoveryRunDetailPage.tsx` (anchored splices); reuse `Grid/TypeaheadCell.tsx` + `Grid/FreeTextTypeaheadSingleToken.tsx` CELLS (not the Grid container)
**Dependencies:** Task Groups 5, 6

- [x] 7.0 Build the drawer/panel that groups affected candidates by missing/blocking field and bulk-fixes them
  - [x] 7.1 Write 2-8 focused tests (new `frontend/src/components/DashboardView/__tests__/CandidateBulkFillPanel.test.tsx`)
    - Affected candidates are GROUPED by the specific missing/blocking field
    - A group's single-value control bulk-sets the value, a per-row override changes one row, and a per-row "skip this one" excludes a row
    - Server dry-run PREVIEW (`commit=false`) renders would-commit / would-still-block
    - "Fix & Save" applies edits + re-attempts commit (calls the bulk-edit + dry-run/commit clients)
    - Limit to 2-8 tests
  - [x] 7.2 Create the panel component (Write OK - new file), mirroring `MigrationDeliveryBulkResolveModal.tsx` (row drafts -> validate -> `commit=false` preview -> commit)
    - Drawer opened from a chip token (Group 6), scoped to the clicked reason class, inside the Discovery run's Candidates tab; NOT inside the architecture-model grids
    - Group affected candidates by the SPECIFIC missing/blocking field
    - Layout precedent for the list-with-reason: `BulkCandidateActionConfirmModal.tsx`
  - [x] 7.3 Per-group single-value control with the right widget
    - Typeahead for FK/reference fields resolving ONLY against existing committed entities + already-approved candidates (reuse `Grid/TypeaheadCell.tsx`)
    - Dropdown for enums (e.g. `interface_type`)
    - Free-text otherwise (reuse `Grid/FreeTextTypeaheadSingleToken.tsx`)
    - Per-row override + per-row "skip this one"; do NOT add per-row checkboxes to the main candidate table
  - [x] 7.4 Server dry-run PREVIEW (`commit=false`) via the Group 5 client - shows what will now commit / be filled before any write (preview cannot drift from commit because it runs the real save-back path)
  - [x] 7.5 COMMIT paths
    - "Fix & Save": apply edits via the bulk-edit endpoint + immediately re-attempt commit for just those rows in ONE transaction
    - Keep the manual edit-then-re-run-"Save Remaining Approved" path working too (do not remove it)
  - [x] 7.6 Targets BOTH blockers (unresolved references) AND quality gaps (empty important fields), PLUS the fallback group "business_logics name collision - qualify with class" for `business_logics` candidates whose collision could not be qualified at generation/save-back (bulk-resolvable via the same bulk-edit endpoint)
  - [x] 7.7 Wire the panel into `DiscoveryRunDetailPage.tsx` (anchored splice) using the open handler + selected-class state from Group 6
  - [x] 7.8 Run ONLY this group's tests
    - `cd C:/Workspaces/SSD/haikai/frontend && npx vitest run src/components/DashboardView/__tests__/CandidateBulkFillPanel.test.tsx`
    - Grep edited existing files for `â€"` (expect zero); re-read spliced regions
    - Do NOT run the full frontend suite

**Acceptance Criteria:**
- The 2-8 tests in 7.1 pass
- The panel groups by missing field; bulk-set + per-row override + per-row skip all work
- Dry-run preview renders would-commit / would-still-block from the server
- "Fix & Save" applies edits + re-attempts commit in one transaction; manual re-Save still works
- The `business_logics` collision fallback group is present and bulk-resolvable
- Reuses the Grid CELLS (not the Grid container)
- Zero `â€"` markers; existing files byte-intact

---

### Testing

#### Task Group 8: Test review and gap analysis (feature-only)
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill only the highest-value end-to-end gaps
  - [x] 8.1 Review the tests written in Groups 1-7
    - Group 1 (reason arm + classification + qualifier + dry-run), Group 2 (findings), Group 3 (AMS bulk-edit), Group 4 (gateway proxy), Group 5 (API client), Group 6 (chip), Group 7 (panel)
    - Total existing feature tests: roughly 16-56
  - [x] 8.2 Analyze coverage gaps for THIS feature only
    - Identify the critical workflows not yet covered end-to-end
    - Do NOT assess whole-application coverage; focus exclusively on this spec
  - [x] 8.3 Write up to 10 additional strategic tests MAXIMUM, prioritizing:
    - The headline workflow: a BLOCKED candidate -> surfaced with reason on the chip -> opened in the C1 panel -> bulk-fill the missing field -> dry-run PREVIEW -> COMMIT (would-still-block becomes would-commit; commit matches preview)
    - The `business_logics` two-distinct-survive case end-to-end (two same-named methods in different classes survive save-back as two qualified `business_logics`; same-name+same-class still collapses)
    - Skip edge cases / performance / accessibility unless business-critical
  - [x] 8.4 Run ONLY this feature's tests (the tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, plus 8.3)
    - mcp-server: `cd C:/Workspaces/SSD/haikai/mcp-server && npx jest candidateSaveBackReasonArm candidateSaveBackFindings`
    - AMS: `mvn -o -f C:/Workspaces/SSD/haikai/architecture-model-service/pom.xml test -Dtest=DiscoveryCandidateBulkEdit*Test`
    - gateway: `cd C:/Workspaces/SSD/haikai/gateway && npx jest discovery`
    - frontend: `cd C:/Workspaces/SSD/haikai/frontend && npx vitest run src/api/__tests__/discoveryApi.bulkEdit.test.ts src/components/DashboardView/__tests__/DiscoveryBreakdownChip.test.tsx src/components/DashboardView/__tests__/CandidateBulkFillPanel.test.tsx`
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass
- The headline blocked -> surface -> bulk-fill -> preview -> commit workflow is covered end-to-end
- The `business_logics` two-distinct-survive (and same-class-collapse) case is covered
- No more than 10 additional tests added
- Testing focused exclusively on this spec's feature

---

## Execution Order

Recommended implementation sequence (Groups 1+2 and Group 3 are independent and may run in parallel; Group 4 needs both):

1. Task Group 1 - mcp-server reason arm + reused classification + business_logics qualifier + dry-run mode
2. Task Group 2 - mcp-server linked Findings for Blocked + Quality-gap (after Group 1)
3. Task Group 3 - AMS bulk-candidate-edit endpoint (parallelizable with 1-2)
4. Task Group 4 - Gateway proxy + dry-run passthrough (needs Groups 1 and 3)
5. Task Group 5 - Frontend API client wrappers + result types (needs Groups 1, 3, 4)
6. Task Group 6 - Honest breakdown chip (needs Group 5)
7. Task Group 7 - C1 group-by-missing-field remediation panel (needs Groups 5, 6)
8. Task Group 8 - Test review and gap analysis (feature-only)
