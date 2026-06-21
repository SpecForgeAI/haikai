# Specification: Skipped-candidate visibility + grouped bulk-fill (C1) for discovery save-back

## Goal
Replace the opaque "X created, Y skipped, Z committed" save-back chip with an honest breakdown by reason class (with clickable tokens), and let users bulk-fix the missing-data candidates from a group-by-missing-field remediation panel; additionally qualify colliding `business_logics` names as `<class>.<method>` so distinct same-named methods survive save-back.

## User Stories
- As an architect reviewing a discovery run, I want to see exactly what was skipped and why (duplicate vs pre-existing vs blocked vs quality gap), so that I trust the save result instead of guessing.
- As an architect, I want to bulk-fill the missing field(s) that blocked or degraded a group of candidates and re-attempt the save in one step, so that I do not have to fix and re-skip the same candidates repeatedly.
- As an architect, I want two same-named methods on different classes to be saved as two distinct business logics, so that genuinely-distinct logic is not silently dropped as a duplicate.

## Specific Requirements

**Honest skip breakdown chip**
- Replace the single `entitiesCreated / entitiesSkipped / candidatesCommitted` string in `DiscoveryRunDetailPage.tsx` (chip currently composed ~line 505, rendered ~line 664) with a breakdown by reason CLASS.
- Classes: `Created`, `Intra-scan duplicate`, `Pre-existing`, `Already saved`, `Suppressed duplicate`, `Possible duplicate`, `Blocked`, `Quality gap`.
- Each non-zero class renders as a clickable token; clicking opens the C1 panel scoped to that class.
- `Intra-scan duplicate`, `Pre-existing`, and `Already saved` MUST be distinguished, never collapsed into one "skipped".
- Surface the existing `suppressedDuplicates[]` (exact-name) and `possibleDuplicates[]` (fuzzy-name) buckets, which already reach the browser but are dropped by the frontend type.
- Show an advisory note for the intra-scan-duplicate count: these are second-candidate-in-same-save matches of an entity an earlier candidate just created (counted as both skipped and committed) — mostly benign; copy states that qualifying `business_logics` names is the targeted remediation for the largest share. Advisory only; do not otherwise act on it.

**Reason arm on `SaveBackResult` (backend)**
- Extend `SaveBackResult` in `mcp-server/src/services/candidateSaveBackService.ts` (interface ~line 176) with a per-candidate reason arm: `{ candidateId, candidateType, name, class, reusedSubclass?, missingField?, reason }`.
- Populate at every skip/reuse site. `created`/`reused` are already recoverable from `candidateActions[]` (action `created|reused`, ~line 2284); classify `reused` into `intra-scan` (matched an entity accumulated in the in-save `targetArray`, ~line 2540), `pre-existing` (matched a name in the `preExistingNamesByArray` snapshot, ~line 2331), or `already-saved` (in `alreadySavedCandidateIds`, filtered pre-loop ~line 2216, currently uncounted).
- Capture the ~16 BLOCKED branches that today only `console.warn` (26 warn sites total) into the arm with their specific reason and `missingField` (orphan/no-parent, unresolved source/target reference, dangling-FK prune, unknown type).
- Include the existing `suppressedDuplicates[]` / `possibleDuplicates[]` arrays in the result surface.
- Quality-gap detection (starter set, extensible): interface committed with only the defaulted `REST_API` `interface_type`; endpoint with empty `operation_verb` and/or `path_or_address`; logical/physical entity committed with no attributes. Use the existing per-type required-field logic in `convertCandidateToEntity` (~line 920) as the source of truth for what is missing.

**Linked Findings for durability (backend)**
- For `Blocked` and `Quality gap` classes, emit a linked `DiscoveryFinding` so the signal survives a page reload, reusing `DiscoveryFindingEntity` + `DiscoveryFindingLinkEntity` with `target_type='discovery_candidate'`.
- Map to existing `evidence_gap` gapTypes (e.g. `interface_missing_contract_detail`, `data_entity_missing_attributes`, `endpoint_missing_response_schema`, `candidate_conflict`, `ambiguous_relationship`).
- Do NOT add a `skip_reason` column to `DiscoveryCandidateEntity` (it has none today).

**`commit=false` dry-run mode (backend)**
- Add a `commit=false` (non-committing) execution mode to the save-back path so the panel's PREVIEW runs the REAL ~25-branch resolution against the drafted edits and returns would-commit / would-still-block, instead of a client re-implementation that can drift.
- Mirrors the proven preview/commit pattern in `MigrationDeliveryBulkResolveModal.tsx` (`commit=false` preview, `commit=true` commit).

**New bulk-candidate-EDIT endpoint (backend)**
- Add a bulk-candidate-EDIT endpoint mirroring the atomic `bulkReviewCascade` in `DiscoveryCandidateController.java` (POST `/bulk-review-cascade`, ~line 155): a curated id set + per-candidate field patches applied in one `@Transactional`.
- Write the candidate `data` blob / top-level fields via the existing `DiscoveryCandidateService.updateCandidate` / `updateCandidateInArchitecture` logic (`data` is JSONB `Map<String,Object>`); unlike today's bulk endpoints it must patch fields, not only `review_status`.
- New request/response DTOs follow the AMS `snake_case` wire default unless a camelCase consumer requires `@CamelCaseWire`.

**Frontend client wrappers (frontend)**
- Add to `frontend/src/api/discoveryApi.ts`: a wrapper over the existing AMS `PUT /{candidateId}` (server already supports full field edits; UI never wired it) and a wrapper over the new bulk-edit / dry-run endpoint.
- Extend the `SaveApprovedResult` type to carry the reason arm + the suppressed/possible duplicate arrays.

**C1 group-by-missing-field bulk remediation panel (frontend)**
- A drawer/panel opened from a clickable chip token, scoped to that reason class, inside the Discovery run's Candidates tab (`/projects/:p/architectures/:a/discovery/runs/:runId?tab=candidates`); NOT inside the architecture-model grids.
- Group affected candidates by the SPECIFIC missing/blocking field.
- Per group: set ONE value with the right control — typeahead for reference/FK fields (resolving ONLY against existing committed entities + already-approved candidates), dropdown for enums (e.g. `interface_type`), free-text otherwise. Per-row override and per-row "skip this one" are supported; do NOT add per-row checkboxes to the main candidate table.
- Server-side dry-run PREVIEW (`commit=false`) shows what will now commit / be filled before any write.
- Offer "Fix & Save" (apply edits + immediately re-attempt commit for just those rows in ONE transaction) AND keep the manual edit-then-re-run-"Save Remaining Approved" path working.
- Targets BOTH blockers (unresolved references) and quality gaps (empty important fields).
- Include a fallback remediation group "business_logics name collision — qualify with class" for any `business_logics` candidates whose collision could not be qualified at generation, bulk-resolvable via the same bulk-edit endpoint.

**business_logics `<class>.<method>` qualification on collision**
- `business_logics` is a top-level candidate type (`parentFkField: null`); its `name` is the bare method name and the parent class lives in the `data` blob as `data.className` (read with fallback `data.controllerClassName ?? data.className`, corroborated by `data.methodId` = `FQN#name(paramTypes)`).
- RULE: when a `business_logics` candidate's bare method name is duplicated across DIFFERENT parent classes within the run, qualify its `name` to `<class_name>.<method_name>` so distinct logics survive. A same-name + same-class pair remains a genuine duplicate (collapse as today). Qualify ON COLLISION only.
- Preferred placement: at the SAVE-BACK boundary — qualify on collision BEFORE the bare-name dedup (`normalizeNameForMatch`, ~line 396), since that is where the false-collapse happens (the discovery MERGE already keeps these distinct via `candidateIdentity.ts` keying on `className + methodName`, but save-back re-collapses by normalized bare name).
- `normalizeNameForMatch` strips whitespace and `_ - .`, so `<class>.<method>` still yields a distinct key (e.g. `orderserviceprocess` vs `paymentserviceprocess`) after normalization — the qualifier is effective against the existing normalizer.
- Where class context is missing for some candidates, route them to the C1 fallback remediation group instead of guessing.

## Visual Design
No visual assets were provided (the `planning/visuals/` folder is empty). No mockups to reference.

## Existing Code to Leverage

**`mcp-server/src/services/candidateSaveBackService.ts`**
- Owns the ~25 skip/reuse branches, the `SaveBackResult` interface, `candidateActions[]` (created|reused), `preExistingNamesByArray` snapshot, `alreadySavedCandidateIds`, the 26 `console.warn` skip sites, `normalizeNameForMatch`, and `convertCandidateToEntity` per-type required-field logic. Extend in place for the reason arm, the `commit=false` mode, and the business_logics qualifier; the per-candidate skip info is already in hand at the warn sites.

**`architecture-model-service` `DiscoveryCandidateController.java` + `DiscoveryCandidateService.java`**
- `bulkReviewCascade` (atomic `@Transactional` bulk over a curated id set, with `BulkReviewCascadeRequest`) is the shape to clone for the new bulk-EDIT endpoint; `updateCandidate` / `updateCandidateInArchitecture` (PUT `/{candidateId}`) is the field-patch write that the bulk endpoint calls per candidate; `resolveConflict` is the single-attribute data-write precedent.

**`DiscoveryFindingEntity.java` + `DiscoveryFindingLinkEntity.java`**
- Existing finding model with string-enum `finding_type`/`category`/`severity` and a links table supporting `target_type='discovery_candidate'`; reuse for the durable Blocked + Quality-gap signal with existing `evidence_gap` gapTypes — no schema change beyond writing rows.

**`discovery-service/src/services/candidateIdentity.ts`**
- Already keys `business_logics` on `className + methodName` (className read as `data.controllerClassName ?? data.className`, with `business_logics::id::<id>` fallback when absent). Reuse this exact, already-trusted class source for the save-back qualification rule.

**Frontend C1 + cell precedents**
- `MigrationDeliveryBulkResolveModal.tsx` (row drafts -> validate -> `commit=false` preview -> `commit=true` commit) is the behavioral template for the C1 panel and the dry-run flow; `BulkCandidateActionConfirmModal.tsx` is the list-with-reason layout; `Grid/TypeaheadCell.tsx` + `Grid/FreeTextTypeaheadSingleToken.tsx` are the FK/typeahead and free-text CELLS to reuse (not the Grid container, which is bound to the committed model). Chip + save-back live in `DashboardView/DiscoveryRunDetailPage.tsx`; tab strip in `Discovery/DiscoveryRunDetailView.tsx`; table (all|filtered bulk scope, no per-row checkboxes) in `DashboardView/DiscoveryCandidateTable.tsx`; gateway `routes/discovery.ts` save-approved is a pure passthrough.

## Out of Scope
- C2 editable-grid / fill-down and C3 inline-row fix (fast-follow).
- Surfacing uncommitted candidates inside the architecture-model grids.
- A general merge/dedup overhaul (EXCEPT the specific business_logics on-collision name-qualification rule, which IS in scope).
- Changing the save-back / commit algorithm beyond the reason arm, the `commit=false` dry-run mode, and the business_logics qualifier.
- Approving a sibling candidate inline or creating a referenced entity inline from the panel (v1 is pick-from-existing-only).
- New per-row checkboxes on the main candidate table.
- A new `skip_reason` column on `DiscoveryCandidateEntity`.
- "Always qualify" every business_logic as `class.method` (on-collision only is the chosen rule).
- Multi-role / permissions.
