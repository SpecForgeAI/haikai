# Spec Requirements: Skipped-candidate visibility + grouped bulk-fill (C1) for discovery save-back

## Initial Description

Skipped-candidate visibility + grouped bulk-fill (C1) for discovery save-back, with duplicate-vs-pre-existing labelling.

On the current-state architecture Discovery "Candidates" tab, "Save Remaining Approved" / "Save All Approved" reports a single opaque chip e.g. "Saved: 583 created, 148 skipped, 697 committed". The `entitiesSkipped` integer collapses ~25 distinct branches in `mcp-server/src/services/candidateSaveBackService.ts`, and the per-candidate reasons are computed but only `console.warn`'d (never returned, never persisted, never shown). Two consequences: (1) the user has no idea WHAT was skipped or WHY; (2) candidates skipped for missing data stay `approved`/un-committed and re-skip identically on the next Save. On a BRAND-NEW architecture the math (committed 697 = created 583 + reused 114; skipped 148 = reused 114 + genuine 34) shows ~114 of the 148 are INTRA-SCAN DUPLICATES (a second candidate in the SAME save matching an entity the first candidate just created — counted as both skipped AND committed), and only ~34 genuinely blocked. The user wants (a) to be told honestly why things were skipped, and (b) to fix the missing-data ones IN BULK.

## Fixed Decisions (from raw-idea.md — NOT relitigated)

These three were decided before requirements and are carried verbatim as fixed scope:

1. **Honest skip breakdown** (replaces the single integer). The save-result chip breaks "skipped" down by reason CLASS, and the chip's reason tokens are clickable to open the remediation panel. Classes:
   - `created` (newly minted);
   - ALREADY-THERE sub-classes that must be DISTINGUISHED (the explicit "duplicate-vs-pre-existing labelling" ask): (i) **intra-scan duplicate** = another candidate in THIS save created the same name+parent first; (ii) **pre-existing** = matched an entity committed BEFORE this scan (only possible on re-scans); (iii) **already-saved** = this exact candidate was committed in a PRIOR save run (filtered pre-loop, not currently counted in "skipped"); plus surface the existing `suppressedDuplicates[]` (exact-name auto-suppressed) and `possibleDuplicates[]` (fuzzy-name) arrays the frontend currently drops;
   - **blocked** = genuine failures that did NOT commit (orphan child / no parent; relationship / interface-link / data-effect with a missing or unresolved source/target reference; dangling-FK prune; enrich/link target gone);
   - **quality gap** = committed but missing an important field (e.g. interface with no real `interface_type`, endpoint with empty `operation_verb`/`path`, logical entity with no attributes). These commit today (`interface_type` defaults to `REST_API`; verb/path are nullable) but the user wants to fill them.

2. **C1 — group-by-missing-field bulk remediation panel** (the chosen UX shape; C2 editable-grid/fill-down + C3 inline-row are explicitly OUT / fast-follow). A drawer/panel, opened from the breakdown chip, that GROUPS affected candidates by the SPECIFIC missing/blocking field. Per group: set ONE value (with per-row override) using the right control — a typeahead for reference/FK fields (autocomplete against existing model entities / approved candidates), a dropdown for enums (e.g. `interface_type`), free-text otherwise — then PREVIEW (what will now commit / be filled), then COMMIT in ONE transaction. Targets BOTH blockers (unresolved references) AND quality gaps (empty important fields). Behavioral precedent to mirror: `MigrationDeliveryBulkResolveModal.tsx` (row drafts -> validate -> preview -> commit).

3. **Placement**: inside the Discovery run's Candidates tab (route `/projects/:p/architectures/:a/discovery/runs/:runId?tab=candidates`), NOT inside the architecture-model grids.

## Requirements Discussion

### First Round Questions

The shaper raised eight open questions, each with a recommended default. The user replied **"defaults are fine"**, accepting ALL eight recommended defaults below.

**Q1 — Reason-class taxonomy + user-facing labels.**
Default accepted: use the taxonomy and labels from the fixed decision above — `created`, `intra-scan duplicate`, `pre-existing`, `already-saved`, `suppressed duplicate`, `possible duplicate`, `blocked`, `quality gap`. The chip splits "skipped" into these classes; reason tokens are clickable.
**Answer:** Defaults are fine.

**Q2 — Which quality-gap fields are worth surfacing (vs noise).**
Default accepted: a starter set of quality-gap checks — interface with no real `interface_type` (i.e. only the defaulted `REST_API`), endpoint with empty `operation_verb` and/or `path_or_address`, logical/physical entity committed with no attributes. (Writer may note this set is extensible, but the starter set is what ships.)
**Answer:** Defaults are fine.

**Q3 — Fix that needs a not-yet-existing referenced entity: pick-from-existing only, vs approve-sibling / create-inline.**
Default accepted: **pick-from-existing-only in v1.** The typeahead resolves only against entities already in the committed model or already-approved candidates. Approving a sibling candidate inline or minting a new entity from the panel is OUT for v1 (fast-follow).
**Answer:** Defaults are fine.

**Q4 — Auto-re-commit ("Fix & Save") vs manual re-Save.**
Default accepted: offer a **"Fix & Save"** affordance that applies the edits and immediately re-attempts the commit for just those rows, AND keep the manual path (edit -> close -> re-run "Save Remaining Approved") working too. Both are supported.
**Answer:** Defaults are fine.

**Q5 — Selection model for the panel.**
Default accepted: **grouped-scope panel with per-row override + per-row skip.** The panel scopes to the affected (grouped) candidates; the user sets one value per group, can override any individual row, and can skip individual rows. **No new per-row checkboxes are added to the main candidate table.**
**Answer:** Defaults are fine.

**Q6 — Ephemeral reasons vs persisted skip_reason vs emit a Finding.**
Default accepted: **ephemeral-on-result PLUS emit a linked Finding for the `blocked` and `quality-gap` classes.** Per-candidate reasons ride back on the save-back result (the reason arm) for the immediate chip + panel; for the durable record, emit a linked `DiscoveryFinding` (`discovery_finding_links` -> `target_type='discovery_candidate'`) for blocked and quality-gap candidates. **No new `skip_reason` column** is added to `DiscoveryCandidateEntity` (confirmed: the entity has no such column today).
**Answer:** Defaults are fine.

**Q7 — How preview computes "will now commit".**
Default accepted: **server-side dry-run preview via a `commit=false` mode.** The bulk-edit / fix-and-save endpoint runs the real save-back logic in a non-committing mode and returns what WOULD commit / be filled, so preview cannot drift from commit. This requires the save-back path to support a `commit=false` (dry-run) execution mode.
**Answer:** Defaults are fine.

**Q8 — Intra-scan-duplicate advisory note.**
Default accepted: **include the intra-scan-duplicate advisory note** in the breakdown — surface the intra-scan-duplicate ratio with an advisory explaining these are second-candidate-in-same-save matches of an entity the first candidate just created (counted as both skipped and committed), i.e. mostly benign but worth knowing. The advisory copy references the business_logics name-qualification rule (below) as the targeted remediation for the largest share.
**Answer:** Defaults are fine.

### New Requirement Added by User (folded in): business_logics name qualification

The user added one NEW in-scope requirement after the eight defaults.

**Problem (concrete root cause of a large share of the Q8 intra-scan-duplicate ratio):** many `business_logics` candidates carry just the BARE method name (e.g. `process`, `execute`, `handle`), and the same method name legitimately exists in DIFFERENT classes. The save-back dedup matches top-level candidates by NORMALIZED NAME only, so a second same-named `business_logic` from a different class is treated as an INTRA-SCAN DUPLICATE and effectively dropped — losing a genuinely-distinct business logic.

**Rule to specify:**
- When a `business_logics` candidate's bare method name is duplicated across DIFFERENT parent classes within the run, **QUALIFY the name as `<class_name>.<method_name>`** so the distinct logics are preserved and no longer false-collapse in dedup. A same-name + same-class pair remains a genuine duplicate (collapse as today).
- **Chosen default: qualify ON COLLISION only.** (Alternative the writer may flag: always qualify every `business_logic` as `class.method`. On-collision is the chosen rule.)
- **Preferred placement: at candidate GENERATION**, so names are distinct BEFORE the save-back dedup runs.
- **Fallback:** if the class context is NOT reliably available at generation for some candidates, surface those as a remediation GROUP in the C1 panel ("business_logics name collision — qualify with class"), bulk-resolvable via the same bulk-edit path.
- **Tie-in:** this rule is the targeted fix behind the Q8 advisory; the advisory copy can state that qualifying business_logics names is the remediation.

**Grounded class-name source (verified — see Technical Considerations):** for a `business_logics` candidate the bare method name is the candidate `name`, and the parent class lives in the candidate `data` blob as **`data.className`** (read with fallback **`data.controllerClassName ?? data.className`**), with the stable method identity at **`data.methodId`** (`FQN#name(paramTypes)`). `business_logics` is a TOP-LEVEL candidate type with `parentFkField: null` — there is no structural class parent FK on the candidate, which is exactly why the class name must come from `data.className` (and via the method's source provenance / `methodId` FQN as corroboration). This matches the EXISTING merge-engine keying (`candidateIdentity.ts` keys `business_logics` on `className + methodName`), so the qualification rule reuses the same already-trusted class source.

### Existing Code to Reference

**Similar features identified (grounded — paths verified on disk this pass; corrections to raw-idea noted):**

Backend — save-back + reason arm (mcp-server):
- `mcp-server/src/services/candidateSaveBackService.ts` — the ~25 skip/reuse branches. Key sites confirmed this pass:
  - `normalizeNameForMatch()` (~line 396) lowercases and strips whitespace and `_ - .` (`/[\s_\-.]+/g`) — the dedup normalizer. NOTE for the writer: because it strips the dot, a `Class.method` qualifier still yields a DISTINCT key (`orderserviceprocess` vs `paymentserviceprocess`), so on-collision qualification works against this normalizer.
  - `findExisting`-style match helper (~lines 441/447/449) — exact then normalized name match.
  - reuse-match / intra-scan-dup accumulation site `targetArray.find((e:any) => ...)` (~line 2540, with `action: 'reused'`) — where a later candidate matches an entity the earlier candidate just created in-save.
  - `SaveBackResult` interface (~lines 176-221); `entitiesSkipped` (~line 180); `suppressedDuplicates[]` (~line 192) and `possibleDuplicates[]` (~line 198) already on the result.
  - `CANDIDATE_TYPE_CONFIG`-style map (~lines 248-308): `business_logics` / `business_logic` -> `targetArrayKey: 'business_logics'`, `parentFkField: null` (confirmed top-level).
- `mcp-server/src/routes/saveApprovedCandidatesRoute.ts` (verified) — save-approved route.
- gateway `routes/discovery.ts` save-approved passthrough (per raw-idea).

Backend — bulk-edit endpoint + AMS (architecture-model-service):
- `architecture-model-service/.../service/DiscoveryCandidateService.java` — `updateCandidateInArchitecture` (edits name/type/confidence/status/operation/data-blob/review fields), invoked by PUT `/{candidateId}`. The data-blob write precedent for the bulk-edit endpoint.
- `architecture-model-service/.../controller/DiscoveryCandidateController.java` — `bulkReviewCascade` (POST `/bulk-review-cascade`, ~line 155; atomic bulk precedent + `BulkReviewCascadeRequest` shape) and `updateCandidate` (PUT `/{candidateId}`, ~line 184). No bulk-EDIT (field-patch) endpoint exists today — bulk endpoints only set review_status.
- `architecture-model-service/.../model/entity/DiscoveryCandidateEntity.java` — `data` is JSONB `Map<String,Object>` (~line 127); `reviewStatus` (~line 161, default `pending_review`); `previousReviewStatus`. **Confirmed NO `skip_reason` field** (supports the Q6 "no new column" default).
- `architecture-model-service/.../model/entity/discovery/DiscoveryFindingEntity.java` + `discovery_finding_links` (`target_type='discovery_candidate'`) — string-enum `finding_type` / `severity` / `category`; reusable evidence_gap gapTypes (`interface_missing_contract_detail`, `data_entity_missing_attributes`, `endpoint_missing_response_schema`, `candidate_conflict`, `ambiguous_relationship`) — the durable "what's wrong" signal for the Q6 linked-Finding emission.

Backend — business_logics naming + class source (discovery-service):
- `discovery-service/src/services/candidateIdentity.ts` (~lines 69-74, 101, 165-177) — `buildIdentityKey`; the `business_logics` case keys on `className + methodName` (className read as `data.controllerClassName ?? data.className`); falls back to `business_logics::id::<candidate.id>` when className is absent. The authoritative class-source precedent the qualification rule reuses.
- `discovery-service/src/services/candidateMerge.ts` (~lines 30-37, 65-78) — `MERGEABLE_TYPES` includes `business_logics`; merge already groups same class+method and never fuses distinct-class methods. (This is why the false-collapse the user reports is a SAVE-BACK issue, not a merge issue.)
- `discovery-service/src/services/extensionPacks/languageExtractors/java/extract.ts` (~lines 87-127) — `buildMethodId(fqn, m)` -> `FQN#name(paramTypes)`; `toClassIR` stamps `fqn = package.ClassName`. Where class+method context originates for Java.
- business_logics candidate MINTING sites (where `name`/`data.className` are set at generation — preferred placement for the on-collision qualifier): `discovery-service/src/services/discoveryV3Pipeline.ts` (~line 771; also the `business_logics` selection at ~line 1385), and framework adapters `extensionPacks/frameworkAdapters/springClassic/index.ts` (~lines 1213, 1532), `nestjs/index.ts` (~line 417), `django/index.ts` (~line 329), `angularJsClassic/index.ts` (~lines 291, 1245). `discovery-service/src/types/candidate.ts` (~line 87) declares the `business_logics` type.
- `discovery-service/src/services/llmBehaviourCaptureStep.ts` — consumes `business_logics` candidates keyed by `data.methodId`; corroborates that method-level candidates carry className/methodId in `data`.

Frontend (verified on disk; raw-idea path correction noted):
- `frontend/src/components/DashboardView/DiscoveryRunDetailPage.tsx` — **owns the save-back call + result chip** (raw-idea listed this under `Discovery/`; it actually lives in `DashboardView/`). Save-result string and chip rendering live here.
- `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx` (verified) — tab strip.
- `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx` (verified) — candidate table; bulk-action wiring (`handleOpenCascade` / `handleConfirmCascade`); filters + confidence slider; NO per-row checkboxes today (keep it that way per Q5).
- `frontend/src/components/DashboardView/CandidateDetailsPanel.tsx` (verified) — read-only detail panel.
- `frontend/src/api/discoveryApi.ts` (verified) — `saveApprovedCandidates`, `bulkReviewCascade`, `resolveDiscoveryConflict`, `reviewCandidate`, `getReviewModel`. Needs a NEW client wrapper over AMS PUT `/{candidateId}` and the new bulk-edit / dry-run endpoint.
- C1 UI precedents (verified): `frontend/src/components/ProductManager/MigrationDeliveryDashboard/MigrationDeliveryBulkResolveModal.tsx` (drafts -> validate -> preview -> commit); `frontend/src/components/Discovery/BulkCandidateActionConfirmModal.tsx` (list-with-reason layout); `frontend/src/components/Grid/TypeaheadCell.tsx` + `frontend/src/components/Grid/FreeTextTypeaheadSingleToken.tsx` (FK/typeahead CELLS — reuse the cells, not the Grid container which is bound to the committed model).

### Follow-up Questions

No follow-up questions were required. The user pre-accepted all eight defaults and supplied the one additional requirement with its own embedded decision (qualify on-collision). The only ambiguity the user explicitly flagged — where business_logic names and class context live — was resolved by the grounding pass (see `data.className` above), so no round-trip was needed.

## Visual Assets

### Files Provided:
No visual assets provided. (Mandatory check run: `ls` of `.../planning/visuals/` returned no `.png/.jpg/.jpeg/.gif/.svg/.pdf` files — the folder exists but is empty.)

### Visual Insights:
None — no files to analyze.

## Requirements Summary

### Functional Requirements

Skip-breakdown + visibility:
- The save-result chip splits the single skipped integer into the reason taxonomy: `created`, `intra-scan duplicate`, `pre-existing`, `already-saved`, `suppressed duplicate`, `possible duplicate`, `blocked`, `quality gap`. Reason tokens are clickable and open the C1 panel scoped to that class.
- Intra-scan vs pre-existing vs already-saved are DISTINGUISHED (not collapsed): intra-scan = matched an entity an earlier candidate in THIS save just created; pre-existing = matched an entity committed before this scan; already-saved = this exact candidate committed in a prior run (currently filtered pre-loop, uncounted).
- The existing `suppressedDuplicates[]` / `possibleDuplicates[]` arrays are surfaced (currently dropped by the frontend).
- An intra-scan-duplicate advisory note is shown (Q8), whose copy references business_logics name-qualification as the remediation.

Reason arm (backend prerequisite):
- The save-back result carries a per-candidate reason arm: `{ candidateId, candidateType, name, class, reusedSubclass?, missingField?, reason }` collected at every skip/reuse site (info already in hand from the existing `console.warn`), classifying reused into intra-scan / pre-existing / already-saved, and including the existing `suppressedDuplicates[]` / `possibleDuplicates[]`.
- For `blocked` and `quality-gap` candidates, ALSO emit a linked `DiscoveryFinding` (`discovery_finding_links.target_type='discovery_candidate'`) as the durable record. No new `skip_reason` column.

C1 group-by-missing-field bulk remediation panel:
- Opened from a clickable chip token; groups affected candidates by the specific missing/blocking field.
- Per group: set ONE value with the right control (typeahead for reference/FK fields resolving against existing model entities / approved candidates only; dropdown for enums e.g. `interface_type`; free-text otherwise); per-row override; per-row skip.
- Server-side dry-run PREVIEW (`commit=false`) shows what will now commit / be filled, computed by the real save-back path so preview cannot drift from commit.
- "Fix & Save" applies the edits and re-attempts commit for just those rows in ONE transaction; the manual edit-then-re-Save path also works.
- Targets BOTH blockers (unresolved references) AND quality gaps (empty important fields).
- Includes a remediation group "business_logics name collision — qualify with class" for any business_logics candidates whose collision could not be qualified at generation (fallback path), bulk-resolvable via the same bulk-edit endpoint.

Bulk-candidate-edit endpoint (backend prerequisite):
- New bulk-candidate-EDIT endpoint mirroring atomic `bulkReviewCascade` (curated id set + field patches, one `@Transactional`), writing the candidate `data` blob / top-level fields via the existing `updateCandidateInArchitecture` logic.
- Supports a `commit=false` dry-run mode for the preview.
- Frontend client wrapper over AMS PUT `/{candidateId}` and the new bulk-edit/dry-run endpoint added to `discoveryApi.ts`.

business_logics name qualification:
- At generation, when a `business_logics` candidate's bare method name collides with another candidate's method name in a DIFFERENT class within the run, qualify its `name` to `<class_name>.<method_name>` (class from `data.className`, fallback `data.controllerClassName ?? data.className`). Same-name + same-class stays a genuine duplicate (collapse as today). On-collision only.
- Where class context is not reliably available at generation, route those candidates to the C1 fallback remediation group.

### Reusability Opportunities
- Reason arm: extend the existing `SaveBackResult` and the existing per-candidate `console.warn` sites in `candidateSaveBackService.ts` (data already in hand).
- Bulk-edit endpoint: clone the `bulkReviewCascade` controller/service shape (atomic, curated id set) but call `updateCandidateInArchitecture` for field patches instead of review-status only.
- Linked Findings: reuse `DiscoveryFindingEntity` + `discovery_finding_links` (`target_type='discovery_candidate'`) and existing evidence_gap gapTypes.
- C1 panel: clone `MigrationDeliveryBulkResolveModal.tsx` (drafts/validate/preview/commit); reuse `TypeaheadCell.tsx` / `FreeTextTypeaheadSingleToken.tsx` cells and `BulkCandidateActionConfirmModal.tsx`'s list-with-reason layout.
- business_logics class source: reuse the exact `data.className` (fallback `controllerClassName ?? className`) source already trusted by `candidateIdentity.ts`'s merge keying.

### Scope Boundaries

**In Scope:**
- Honest skip breakdown chip with the full taxonomy + clickable tokens.
- Distinguishing intra-scan / pre-existing / already-saved; surfacing suppressed/possible duplicates.
- Per-candidate reason arm on `SaveBackResult`; linked Findings for blocked + quality-gap.
- C1 group-by-missing-field bulk remediation panel (group value + per-row override + per-row skip; pick-from-existing-only typeahead; enum dropdowns; free-text).
- Server-side dry-run preview (`commit=false`); "Fix & Save" one-transaction commit AND manual re-Save.
- New bulk-candidate-edit endpoint + frontend client wrapper; quality-gap starter checks.
- business_logics on-collision name qualification to `<class>.<method>` at generation, with C1 fallback group.

**Out of Scope:**
- C2 editable-grid / fill-down and C3 inline-row fix (fast-follow).
- Surfacing uncommitted candidates inside the architecture-model grids.
- Approving a sibling candidate inline / creating a referenced entity inline from the panel (v1 is pick-from-existing-only).
- New per-row checkboxes on the main candidate table.
- New `skip_reason` column on the candidate entity.
- Multi-role / permissions.

**Out of Scope — with explicit carve-outs (non-goal adjustment):**
- "Fixing the upstream merge/dedup so fewer intra-scan duplicates reach save-back" stays GENERALLY out of scope, EXCEPT the specific business_logics on-collision name-qualification rule, which is now IN scope.
- "Don't change the save-back / commit algorithm beyond adding the reason arm" is carved out only insofar as (a) the business_logics qualification and (b) the Q7 `commit=false` dry-run mode require save-back changes; both are IN scope.

### Technical Considerations
- AMS speaks `snake_case` at the wire by default (`spring.jackson.property-naming-strategy: SNAKE_CASE`); new DTOs for the bulk-edit/dry-run endpoint follow that unless a camelCase consumer requires `@CamelCaseWire`. Discovery candidate APIs the frontend uses are snake_case-typed.
- Save-back dedup normalizer `normalizeNameForMatch` strips whitespace and `_ - .`; the `<class>.<method>` qualifier still produces a distinct match key after normalization (the dot is stripped but the class token remains), so on-collision qualification is effective against the existing normalizer.
- `business_logics` is top-level (`parentFkField: null`); class context is NOT a structural FK and MUST be read from the candidate `data` blob (`data.className`, fallback `data.controllerClassName ?? data.className`; `data.methodId` = `FQN#name(paramTypes)` as corroboration). This is the same source `candidateIdentity.ts` already uses.
- The merge engine already preserves distinct-class methods; the observed false-collapse is purely a save-back (bare-name dedup) effect — fix belongs at generation (preferred) with a save-back/C1 fallback.
- `DiscoveryCandidateEntity.data` is JSONB `Map<String,Object>`; field patches go through `updateCandidateInArchitecture`. Atomic bulk precedent = `bulkReviewCascade` (`@Transactional`).
- Preview must run the real save-back logic in non-committing mode (`commit=false`) so preview == commit.

### Load-bearing Test Surfaces
- Breakdown chip splits skipped into the taxonomy classes (created / intra-scan duplicate / pre-existing / already-saved / suppressed / possible / blocked / quality gap).
- Intra-scan vs pre-existing vs already-saved are distinguished in the reason arm (not collapsed into one "skipped").
- Blocked + quality-gap reasons are captured on the reason arm AND emit a linked Finding (`target_type='discovery_candidate'`).
- C1 panel groups by missing field, bulk-sets a value with per-row override (and per-row skip).
- Server dry-run preview (`commit=false`) returns what would commit / be filled and matches the actual commit.
- "Fix & Save" commits the patched rows in ONE transaction.
- business_logics collision rule: two same-named methods in DIFFERENT classes survive save-back as TWO distinct business_logics (qualified `<class>.<method>`) rather than collapsing to one; a same-name + same-class pair still collapses to one (genuine duplicate).
- Fallback: a business_logics collision lacking class context at generation appears as the C1 "business_logics name collision — qualify with class" remediation group and is bulk-resolvable.
