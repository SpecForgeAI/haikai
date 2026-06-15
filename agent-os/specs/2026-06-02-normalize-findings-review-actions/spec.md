# Specification: Normalize Findings Review Actions (Spec F)

## Goal
Make discovery FINDINGS speak the same review-disposition vocabulary as architecture CANDIDATES (Approve / Reject / Defer) by renaming the findings `status` column to `review_status`, migrating its stored values, removing the restrictive transition graph, and adding a `previous_review_status` audit trail — so the later unified-grid and Architect-conversation specs (Spec 0/1/2/3) operate on one consistent model.

## User Stories
- As a reviewer, I want findings to offer exactly Approve / Reject / Defer (the same verbs as candidates) so I am not switching mental models between the candidate grid and the findings tab.
- As a reviewer, I want to move a finding freely between any disposition (e.g. re-open an approved finding back to deferred) so a mistaken disposition is one click to correct.
- As a maintainer of the later unified-review specs, I want findings and candidates to share the `review_status` / `previous_review_status` field shape so shared review logic does not need a per-entity field-name mapping.

## Specific Requirements

**1. Rename the findings status column to `review_status` (single column, NOT a two-column split)**
- Add a NEW Liquibase changeset under `architecture-model-service/src/main/resources/db/changelog/sql/` (next free numeric prefix; register it in `db.changelog-master.yaml` in the same `sqlFile` block style as the `135`/`160` entries, `relativeToChangelogFile: false`, `splitStatements: true`, `stripComments: true`).
- NEVER edit the applied `135-discovery-findings.sql` changeset (per `feedback_liquibase_immutable_changesets.md`) — all DDL/DML lives in the new changeset.
- Rename `discovery_findings.status` to `review_status` (`ALTER TABLE discovery_findings RENAME COLUMN status TO review_status;`), keep it `TEXT NOT NULL`, change the column DEFAULT to `'pending_review'`.
- Rename the existing index `idx_discovery_finding_status` to track the renamed column (or drop + recreate on `review_status`); keep a single index — do not add a second one.
- NO CHECK constraint is added (preserve today's free-text + pack-extensibility design; `135` never had one).
- Add a `previous_review_status` column: nullable `TEXT`, no default.
- Refresh the COLUMN COMMENT on `review_status` to the new vocabulary `{pending_review (default on emit), approved, rejected, deferred}`; add a COMMENT on `previous_review_status` mirroring the candidate one in `074-candidate-review-fields.sql:44`.

**2. Migrate stored values in the same changeset**
- After the rename, run `UPDATE discovery_findings SET review_status = <new>` for every legacy value: `accepted→approved`, `ignored→rejected`, `needs_review→deferred`, `new→pending_review`, `resolved→approved`.
- `resolved` collapses into `approved` (Decision 5) and `new` becomes `pending_review` (Decision 2 / Q7) so the single column afterward carries only `{pending_review, approved, rejected, deferred}`.
- Mirror the value-migration idiom of `074-candidate-review-fields.sql:29-34` (explicit `UPDATE` for existing rows alongside the new DEFAULT).

**3. AMS service vocabulary, transitions, and audit trail (`DiscoveryFindingService.java`)**
- `ALLOWED_STATUSES` becomes `{pending_review, approved, rejected, deferred}` (was `{new, accepted, ignored, needs_review, resolved}`, lines 126-127).
- `ALLOWED_REVIEWER_STATUSES` becomes `{approved, rejected, deferred}` (was 4 values incl. `resolved`/`needs_review`, lines 136-137) — mirrors `DiscoveryCandidateService.VALID_REVIEW_STATUSES` (`DiscoveryCandidateService.java:60`).
- DELETE the `ALLOWED_TRANSITIONS` map (lines 171-177) and the `InvalidFindingStatusTransitionException` throw inside `applyStatusChange` (lines 929-932); transitions become unrestricted (any→any), matching `reviewCandidate` which accepts any of its three statuses from any state.
- In `applyStatusChange` (lines 913-942): before overwriting, capture the current value into `previous_review_status` on every real transition (mirror `reviewCandidate` lines 413-420); keep the `reviewed_at` stamp. The `else if (!"new".equals(...))` branch (line 936) and the `isTransitionAllowed`/`ALLOWED_TRANSITIONS` test helpers (lines 1116-1124) are removed/rewritten.
- Default on persist (`persistFindingEntity` line 330) becomes `pending_review` (was `new`); the `ALLOWED_STATUSES` membership check still applies.

**4. AMS entity + DTO (`DiscoveryFindingEntity.java`, `DiscoveryFindingDto.java`)**
- Entity: rename field `status`→`reviewStatus` with `@Column(name = "review_status")`, `@Builder.Default` value `"pending_review"` (was `"new"`, lines 119-121); rename the `@Index` on line 58 to match. Add `previousReviewStatus` field (`@Column(name = "previous_review_status")`, nullable) — pattern from `DiscoveryCandidateEntity.java:159-161, 192-193`.
- DTO: rename the `status` record component to `reviewStatus` and add a `previousReviewStatus` component (both serialize snake_case via the global `SNAKE_CASE` strategy — no `@CamelCaseWire`). Update the backward-compat delegating constructor (lines 69-111) accordingly; update `DiscoveryFindingMapper` to map both new fields.
- Update `ReviewDiscoveryFindingRequest` / `UpdateDiscoveryFindingRequest` field names + Javadoc that reference `status` to `review_status` for the findings surface.

**5. Reconcile the in-flight bulk DTOs + service loop (the largest single surface)**
- `BulkReviewDiscoveryFindingsRequest`: rename `status`→`reviewStatus`; rename the nested `Filter.status`→`reviewStatus` (lines 28-29, 40); refresh the Javadoc value list to `approved/rejected/deferred`.
- `BulkReviewDiscoveryFindingsResponse`: rename `deltaByFromStatus` keys' documented vocabulary to `{pending_review, approved, rejected, deferred}` (Javadoc lines 11-13); the field name `deltaByFromStatus` (→ wire `delta_by_from_status`) is retained as-is.
- `bulkReview(...)` (`DiscoveryFindingService.java:460-537`): read `request.reviewStatus()`; validate against the new `ALLOWED_REVIEWER_STATUSES`; since transitions are now unrestricted, the `ALLOWED_TRANSITIONS.getOrDefault(...).contains(...)` pre-check and the `transitionNotAllowed` skip path (lines 506-512) are removed — every non-same-status row is actioned. KEEP `SkippedByReason.transitionNotAllowed` as a field (so the response shape is stable for the frontend) but it is now always `0`; `alreadyInTarget` still counts same-`review_status` rows.
- The controller `bulkReview` Javadoc (`DiscoveryFindingController.java:117-146`) value list + the example body `"status": "accepted"` are updated to `review_status` / `approved`.

**6. discovery-service emit alignment (`FindingEmitter.ts`)**
- `FindingStatus` type + `VALID_STATUSES` set (lines 66-78) become `{pending_review, approved, rejected, deferred}`.
- The emit default + payload field change from `status:'new'` to `review_status:'pending_review'` — OR omit the field entirely and let AMS apply its `pending_review` default (preferred; least coupling). `prepare(...)` (lines 441, 462-468, 501) and `DiscoveryFindingCreatePayload` in `archModelClient.ts` update the field name to match the renamed wire shape. No scanner emits a disposition today, so this is the only emit-path touch.

**7. Frontend API types (`findingsApi.ts`)**
- `DiscoveryFindingStatus` union (lines 107-112) becomes `'pending_review' | 'approved' | 'rejected' | 'deferred'`.
- Rename the `status` field to `review_status` on `DiscoveryFindingDto` (line 169) and add `previous_review_status: string | null`; rename `status` on `CreateDiscoveryFindingRequest`/`UpdateDiscoveryFindingRequest`/`ReviewDiscoveryFindingRequest`/`ListFindingsFilters`/`BulkReviewFindingsRequest` and the nested filter to `review_status`.
- `buildQueryString` (lines 361-373) maps `review_status` to the AMS query param; `BulkReviewFindingsResponse.delta_by_from_status` Javadoc (lines 306-319) updates its documented key vocabulary.

**8. Findings tab + drawer human surface = exactly Approve / Reject / Defer (`FindingsTab.tsx`, `FindingDetailDrawer.tsx`, `BulkFindingActionConfirmModal.tsx`)**
- Drawer (`FindingDetailDrawer.tsx:456-492`): the four action buttons (`Accept`/`Ignore`/`Mark Needs Review`/`Mark Resolved`) become three — `Approve`/`Reject`/`Defer` (calling `reviewFinding` with `approved`/`rejected`/`deferred`); DELETE the `Mark Resolved` and `Mark Needs Review` buttons. `statusBadgeClass` (lines 53-66) re-keys on the new values.
- FindingsTab bulk toolbar: `BULK_TARGET_STATUSES` (lines 354-359) becomes `['approved','rejected','deferred']` (drop `resolved`); `STATUS_BUTTON_LABEL`/`STATUS_DISPLAY_LABEL` (lines 361-375) re-key to Approve/Reject/Defer + Approved/Rejected/Deferred; `statusBadgeClass` (lines 82-95) re-keys.
- Summary pills (`computeSummary` lines 114-144; render lines 838-867; `applyBulkDelta` lines 663-716; `onFindingUpdated` lines 615-640): replace the `needsReview/accepted/ignored/resolved` set with `pendingReview/approved/rejected/deferred`; DROP the `resolved` pill added by the 2026-05-28 work. Keep "Total" and "Critical + High".
- Status filter `<option>`s (lines 882-888) become `pending_review/approved/rejected/deferred`.
- `BulkFindingActionConfirmModal.statusDisplayLabel` (lines 32-45) re-maps to Approved/Rejected/Deferred.

**9. Gateway: NO logic change**
- The findings proxy (`proxyFindingsToAms`, `gateway/src/routes/discovery.ts`) is a verbatim body+query pass-through and never inspects finding status — it requires NO code change. Only the gateway test fixture (`discovery-findings-bulk-review-proxy.test.ts`) asserting `status:'accepted'` / `delta_by_from_status` keys updates to the new vocabulary + `review_status` field.

**10. Out-of-radius confirmations to bake into the spec**
- mcp-server is untouched (it reads only CANDIDATE `review_status`, never finding status).
- No auto-resolver / evidence-gap lifecycle is built here (see Out of Scope).
- The candidate side (`DiscoveryCandidateService`/`Entity`/`Table`) is the parity REFERENCE only — it is NOT modified by this spec.

## Visual Design
No visual assets provided (`planning/visuals/` is empty). The UI changes are described in Requirement 8 against the existing components.

## Existing Code to Leverage

**`DiscoveryCandidateService.java` — review-disposition parity target**
- `VALID_REVIEW_STATUSES = {approved, rejected, deferred}` (line 60) is the exact set to replicate as the findings `ALLOWED_REVIEWER_STATUSES`.
- `reviewCandidate(...)` (lines 395-427) shows the canonical pattern: validate against the set, capture `previousReviewStatus` before overwrite (lines 413-420), stamp `reviewedAt`, no transition graph — replicate this shape in `DiscoveryFindingService.applyStatusChange`.

**`074-candidate-review-fields.sql` — migration template**
- Shows the exact idiom for the new changeset: `review_status` column with `NOT NULL DEFAULT 'pending_review'`, a nullable `previous_review_status`, an explicit `UPDATE ... WHERE` for pre-existing rows, and COLUMN COMMENTs (lines 13-44). Reuse the comment wording for `previous_review_status`.

**`DiscoveryCandidateEntity.java` — entity field shape**
- `reviewStatus` (`@Column(name = "review_status")`, default `"pending_review"`, lines 159-161) and `previousReviewStatus` (`@Column(name = "previous_review_status")`, lines 192-193) are the field declarations to mirror on `DiscoveryFindingEntity`.

**`DiscoveryCandidateTable.tsx` — UI verb parity target**
- Inline per-row Approve/Reject/Defer buttons, filter chips (All/Pending/Approved/Rejected/Deferred), and row-tints keyed on `review_status` (green/red/grey at lines 81-85, 256-263) are the UX the findings drawer/toolbar should converge toward (verbs + value keys), without restyling the findings tab beyond the rename.

**In-flight `2026-05-28-bulk-findings-actions` work — live baseline to reconcile**
- The bulk DTOs, `bulkReview` service loop, toolbar, modal, and tests (`DiscoveryFindingBulkReviewTest.java`, `FindingsTab.bulk.test.tsx`, `discovery-findings-bulk-review-proxy.test.ts`) are committed first (user-owned), then normalized by this spec per Requirement 5/8. Their `delta_by_from_status` Java accumulator keys + TS switch move in lockstep with the value rename.

## Out of Scope
- Building an auto-resolver / evidence-gap "value filled → resolved" lifecycle — `resolved` is retired entirely here; any future system-owned terminal state is a LATER spec, not Spec F.
- Re-introducing a `resolved` (or any system-only / synthesis-lifecycle) value — the migration collapses `resolved→approved`; no replacement state is added.
- A two-column structural split (a separate lifecycle column alongside `review_status`) — explicitly rejected in favor of the single renamed column (Decision 8).
- Adding a CHECK constraint on `review_status` — free-text + pack-extensibility is preserved.
- Any change to candidate code (`DiscoveryCandidateService`/`Entity`/`Table`) — candidates are the parity reference, not a target.
- Any gateway findings-proxy LOGIC change — pass-through only; test-fixture string updates excepted.
- Any mcp-server change — it never reads finding status.
- The later unified-grid / aggregation / Architect-conversation-persona features (Spec 0/1/2/3) — Spec F only normalizes the model they will build on.
- Re-styling the findings tab/table layout, grouping, drawer panels, or pill chrome beyond the vocabulary/field rename and the removal of the two retired buttons + the resolved pill.
- Changing the finding-link target-type vocabulary, severity/category vocabularies, or the exactly-one-origin invariant.
