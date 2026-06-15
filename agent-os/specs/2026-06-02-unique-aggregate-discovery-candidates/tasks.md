# Task Breakdown: Unique, Aggregate Discovery Candidates (Spec 0)

## Overview
Total Tasks: 8 task groups

Replace the parent-inclusive dedup-DROP in discovery with a universal, identity-keyed,
cross-source MERGE that produces one clean candidate per real architecture element —
aggregating attribute-level findings from every source, holding true value conflicts for
review, and recording full provenance. Plus the save-back field-name fix and the frontend
grid conflict UI.

The engine is a pure, unit-testable TypeScript module (`candidateMerge.ts`) in
discovery-service. Groups 1-5 build and wire it; Group 6 fixes save-back (mcp-server);
Group 7 surfaces conflicts in the frontend grid; Group 8 is cross-stack verification.

## CRITICAL Implementation Cautions (read before touching discovery-service)

- **NO `discovery-service/src/**` edits during an active discovery run.** `tsx watch`
  auto-reloads on save and KILLS any in-flight discovery run (repo rule
  `feedback_no_src_edits_during_run`). Before starting Groups 1-5 and 8, CONFIRM no
  discovery run is active. This applies to test files under `src/**` too.
- **tree-sitter jest isolation.** Parser/parse-touching jest suites are unsafe to combine
  if they re-require the native binding. If a combined discovery-service jest run flakes
  on parse suites, re-run the parse-touching suites in ISOLATION (per
  `project_tree_sitter_jest_isolation_fix`). The merge engine itself does not parse, but
  pipeline-wiring tests that import `discoveryV3Pipeline` may pull parser modules in.
- **No `git` operations.** Stop at code + verification; the user owns all commits/pushes
  (`feedback_no_git_operations`).
- **The merge `data` shape is reusable by Spec 3** — do NOT couple `_conflicts`,
  `_conflictResolutions`, `_addedBy`, `_mergedFrom`, or `_attributeProvenance` to the grid
  UI. They live in candidate `data` (JSONB passthrough — no AMS schema change).

## Test Commands

- discovery-service: jest (run only the new suites; isolate parse-touching suites if flaky)
- mcp-server: jest
- gateway: jest
- frontend: `npx vitest run <files>`

---

## Task List

### Identity Primitives (discovery-service)

#### Task Group 1: Path Canonicalization + Per-Type Identity Keys
**Dependencies:** None

Foundational, pure, unit-testable first. `canonicalEndpointPath()` composes the two
existing `endpointPathNormalizer.ts` primitives into one hashable string; the identity-key
builder produces a single Map key per candidate for the five v1 types.

- [x] 1.0 Complete identity + canonicalization primitives
  - [x] 1.1 Write 2-8 focused tests for canonicalization + identity keys
    - Limit to 2-8 highly focused tests maximum
    - `canonicalEndpointPath`: `{theString}` and `{myString}` collapse to ONE key (both
      become the single positional token, e.g. `{p}`); `/users/123` and `/users/{id}`
      collapse to one key (literal-ID rewrite from `normalizePath` applies); static vs
      templated segments stay DISTINCT (`/users/me` != `/users/{id}` is NOT forced equal
      at the key level — only `arePathsEquivalentByPlaceholder` dominance is out of scope
      for the key); HTTP method is part of the endpoint key
    - Identity key per type: two endpoints differing only on `name`/`parentInterface` but
      same verb+canonical-path produce the SAME key (this is the root-cause-#1 fix);
      interface keys on FQN vs WADL `interface_type + spec_link`; LDE on normalized DTO
      name; physical_data_entities on `database_name + physical_type + normalized table`;
      services on normalized service name
    - Skip exhaustive segment-shape coverage
  - [x] 1.2 Add `canonicalEndpointPath(rawPath)` to
    `discovery-service/src/services/runtimeEvidence/endpointPathNormalizer.ts`
    - Compose existing primitives: apply `normalizePath`'s literal-ID rewrite FIRST
      (`endpointPathNormalizer.ts:71-80`), THEN collapse every `{anything}` placeholder
      segment to ONE positional token (reuse `PLACEHOLDER_SEGMENT_REGEX` at line 130)
    - Returns a single canonical string usable as a `Map` key (NOT a pairwise comparator
      like `arePathsEquivalentByPlaceholder` at 106+)
    - Static vs templated segments stay distinct in the output
  - [x] 1.3 Add a per-type `buildIdentityKey(candidate)` builder (in the new
    `candidateMerge.ts` or a small co-located `candidateIdentity.ts`)
    - `endpoints`: HTTP method + `canonicalEndpointPath`; read verb/path with the SAME
      dual-shape fallbacks as `packPostProcess.ts:142-151`
      (`data.httpMethod ?? data.operation_verb`, `data.fullPath ?? data.path_or_address`);
      media types are NOT part of identity
    - `interfaces`: controller/resource class FQN
      (`data.controllerClassName ?? data.className`); WADL interfaces key on
      `interface_type + spec_link`; a generic WADL interface must NEVER key-match a specific
      controller
    - `logical_data_entities`: normalized DTO type name (simple-or-FQN)
    - `physical_data_entities`: `database_name + physical_type + normalized table/view name`
    - `services`: normalized service name
    - `*_attributes` and relationship/link rows are NOT keyed here (reconciled as a
      consequence of their parents in Group 3)
  - [x] 1.4 Ensure identity-primitive tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Do NOT run the entire discovery-service test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- `canonicalEndpointPath` returns one hashable string; placeholder-name collapse +
  literal-ID rewrite both applied; static vs templated distinct; method in key
- Endpoints differing only by parent/name but same verb+canonical-path collapse to one key
- Generic WADL interface and specific controller produce DIFFERENT interface keys

---

### Merge Engine (discovery-service)

#### Task Group 2: Core `mergeCandidates` — Aggregation, Precedence, Conflicts
**Dependencies:** Task Group 1

The crux. A pure `mergeCandidates(candidates)` (no I/O) that groups by identity key, folds
sources into one surviving candidate, applies source precedence for gap-fill/equal values,
detects true conflicts, collapses media-type variants, and records the full conflict +
provenance data model. Single-source candidates survive provenance-marked.

- [x] 2.0 Complete the core merge engine
  - [x] 2.1 Write 2-8 focused tests for `mergeCandidates`
    - Limit to 2-8 highly focused tests maximum
    - Attribute union + gap-fill by precedence: an absent slot is filled from the
      higher-precedence source; precedence order is structural framework pack > contract
      pack (WADL/WSDL/XSD) > runtime evidence > LLM gap-fill
    - Equal-value canonical-slot pick by precedence; `_attributeProvenance[attr]` recorded
    - Conflict detection: DIFFERING present values for the same attribute produce
      `_conflicts[attr]` = `{ value, source }[]` (one per distinct value) and are NEVER
      auto-resolved by precedence
    - Media-type variant collapse: JAX-RS variants of the same method+path merge into ONE
      endpoint with UNIONed `consumes`/`produces`
    - Confidence = `max()` of contributing source confidences; conflicted candidate flagged
      regardless of confidence
    - Single-source preservation: a one-source candidate survives with `_addedBy: [source]`,
      `_mergedFrom`, no conflicts
    - Skip exhaustive per-attribute coverage
  - [x] 2.2 Create `discovery-service/src/services/candidateMerge.ts` exporting pure
    `mergeCandidates(candidates)`
    - Returns `{ merged: DiscoveryCandidate[], mergeGroups, conflicts }` (merged array +
      per-group + conflict metadata for Group 4 Findings); NO I/O, fully unit-testable
    - Group candidates by Group-1 identity key; within a group fold ALL sources into ONE
      surviving candidate; emit single-source candidates unchanged except provenance marking
    - v1 merged types ONLY: `endpoints`, `interfaces`, `logical_data_entities`,
      `physical_data_entities`, `services`; `class`/`method` are NOT merged or minted;
      non-v1 types pass through untouched
    - Preserve the merged array's REFERENCE semantics so Stage 2.5 runtime evidence can
      mutate it in place by identity (it must keep matching via
      `buildCandidateIdentityLookup`)
  - [x] 2.3 Implement attribute union + source precedence
    - Union all `data` attributes across grouped sources into the surviving candidate
    - Precedence (gap-fill of an absent slot AND canonical slot when values are EQUAL):
      structural framework pack > contract pack > runtime evidence > LLM gap-fill
    - Derive source labels from each contributing candidate's `data._addedBy` (and the
      runtime/LLM stage label)
    - Record `data._attributeProvenance[attr] = sourceLabel` for every populated attribute
  - [x] 2.4 Implement conflict detection + the conflict/provenance data model in `data`
    - `data._conflicts[attr]` = array of competing `{ value, source }` (one per distinct
      PRESENT value across sources); differing present values are NEVER auto-resolved by
      precedence
    - `data._addedBy` becomes `string[]` (set of contributing source labels), upgrading the
      current single-string field
    - `data._mergedFrom` = array of collapsed source-candidate ids (audit trail)
    - Reserve `data._conflictResolutions[attr]` shape
      (`{ chosenValue, chosenSource, resolvedBy, resolvedAt }`) — written later by the grid
      (Group 7); the engine leaves it absent for unresolved conflicts
    - This entire shape MUST be reusable by Spec 3 — do NOT couple it to the grid
  - [x] 2.5 Implement media-type variant collapse + root-cause-#2 normalization
    - Collapse JAX-RS media-type variants (different consumes/produces) of the same
      method+path into ONE endpoint; UNION `consumes` and `produces` (and headers/params
      where the detector splits on them); this overrides the current discriminator split
    - Normalize endpoint field names to the save-back canonical names during aggregation:
      `data.httpMethod` -> `operation_verb`, `data.fullPath` -> `path_or_address` (so the
      canonical slots are populated before persist — root cause #2, merge side)
  - [x] 2.6 Ensure core-merge tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Do NOT run the entire discovery-service test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- Attribute union folds all sources; gap-fill + equal-value resolved by precedence;
  per-attribute provenance recorded
- Differing present values become `_conflicts`, never auto-resolved
- Media-type variants collapse to one endpoint with UNIONed media types
- `confidence = max()`; conflicted candidate flagged regardless of confidence
- Single-source candidates survive with `_addedBy: string[]` + `_mergedFrom`
- `httpMethod`/`fullPath` normalized to `operation_verb`/`path_or_address`
- The conflict/provenance shape is self-contained in `data` (no UI coupling, no AMS change)

---

#### Task Group 3: Interface + Logical-Data-Entity Reconciliation (Relationship Rebuild)
**Dependencies:** Task Group 2

After the entity merge, re-parent endpoints to the specific controller interface, drop
generic interfaces emptied to zero endpoints, consolidate request/response LDEs by identity,
and REBUILD the relationship/link rows to point at survivors. Parents-first ordering held.

- [x] 3.0 Complete interface + LDE reconciliation
  - [x] 3.1 Write 2-8 focused tests for reconciliation + relationship rebuild
    - Limit to 2-8 highly focused tests maximum
    - Re-parent: a merged endpoint sourced from both generic WADL and specific JAX-RS
      re-parents to the SPECIFIC controller interface
    - Drop: a generic WADL interface emptied to zero endpoints after re-parenting is dropped
    - DTO consolidation: request/response `logical_data_entities` with the same Group-1
      identity collapse to one surviving DTO
    - Relationship rebuild: `interface_logical_entities` and `endpoint_data_effects` rows
      re-point at surviving interfaces/entities; rows orphaned by an emptied interface are
      dropped
    - Single-source endpoint keeps its own interface untouched
    - `sortCandidatesParentsFirst` invariants still hold (parents before children) after
      re-parenting/drops
    - Skip exhaustive relationship-permutation coverage
  - [x] 3.2 Re-parent merged endpoints to the specific controller interface
    - When sources disagree on parent, prefer the specific JAX-RS controller interface over
      the generic WADL interface / no-parent
    - A single-source endpoint keeps its existing `parentCandidateId` untouched
  - [x] 3.3 Drop generic interfaces emptied to zero endpoints
    - After re-parenting, a generic WADL interface with zero remaining child endpoints is
      removed from the merged set
    - A generic WADL interface NEVER key-matches a specific controller — it collapses ONLY
      by being emptied (per Q8)
  - [x] 3.4 Consolidate request/response logical_data_entities by identity
    - One surviving DTO per Group-1 identity key (normalized DTO type name)
  - [x] 3.5 Rebuild `interface_logical_entities` + `endpoint_data_effects` relationship rows
    - Re-point rows at the surviving interfaces/entities (keyed by their two endpoint
      identities, rebuilt after the entity merge)
    - Drop rows orphaned by an emptied interface or consolidated-away entity
    - Do NOT touch backend-managed polymorphic `*_points` rows
  - [x] 3.6 Preserve `sortCandidatesParentsFirst` invariants
    - Confirm the merged output still sorts parents-before-children after re-parenting/drops
      (the persist contract at `discoveryV3Pipeline.ts:1423`)
  - [x] 3.7 Ensure reconciliation tests pass
    - Run ONLY the 2-8 tests written in 3.1
    - Do NOT run the entire discovery-service test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Merged endpoints re-parent to the specific controller interface
- Generic WADL interfaces emptied to zero endpoints are dropped
- DTOs consolidated by identity; one survivor per identity
- `interface_logical_entities` + `endpoint_data_effects` rebuilt; orphaned rows dropped
- Single-source endpoint interface untouched
- `sortCandidatesParentsFirst` holds after re-parenting/drops

---

#### Task Group 4: Findings Emission (Oracle Completeness)
**Dependencies:** Task Groups 2-3

Nothing silently lost: one Finding per merge group + one per conflict, reusing the existing
Stage-4 `candidate_conflict` emission shape rather than inventing a new path.

- [x] 4.0 Complete Findings emission
  - [x] 4.1 Write 2-8 focused tests for merge/conflict Findings
    - Limit to 2-8 highly focused tests maximum
    - One Finding per merge group records the surviving candidate, the collapsed
      source-candidate ids from `_mergedFrom`, and per-source contribution
    - One Finding per detected conflict records `attr` and the competing `{value, source}[]`
    - Findings reuse the Stage-4 `candidate_conflict` emission shape
    - Skip exhaustive Finding-field coverage
  - [x] 4.2 Emit one Finding per merge group
    - Records surviving candidate id, `_mergedFrom` ids, and per-source contribution
    - Extend the existing Stage-4 `candidate_conflict` emission shape
      (`discoveryV3Pipeline.ts` ~1387-1404) rather than inventing a new emission path
  - [x] 4.3 Emit one Finding per detected conflict
    - Records `attr` and the competing `{value, source}[]` from `_conflicts[attr]`
  - [x] 4.4 Ensure Findings tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Do NOT run the entire discovery-service test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- One Finding per merge group (with `_mergedFrom` ids + per-source contribution)
- One Finding per conflict (with `attr` + competing values/sources)
- Emission reuses/extends the Stage-4 `candidate_conflict` shape (no new path invented)

---

#### Task Group 5: Pipeline Wiring (Two-Phase Fold-In)
**Dependencies:** Task Groups 2-4

Wire the engine into `discoveryV3Pipeline.ts`. Phase 1 replaces `dedupPackCandidates` at the
hook point; Stage 2.5 runtime enriches the merged array unchanged; Phase 2 folds LLM
candidates into the same identity index after Stage 3. Parents-first persist preserved.

**CONFIRM no discovery run is active before editing `discoveryV3Pipeline.ts`.**

- [x] 5.0 Complete pipeline wiring
  - [x] 5.1 Write 2-8 focused tests for pipeline wiring
    - Limit to 2-8 highly focused tests maximum
    - Phase 1: the merge replaces dedup at the hook point; its result is assigned back to
      `filteredPackCandidates`
    - Stage 2.5: runtime evidence still matches/enriches the merged array by identity
      (reference semantics preserved)
    - Phase 2: LLM candidates fold into the SAME identity index; the legacy name-only LLM
      dedup is gone BUT its `candidate_conflict` Finding still emits
    - Parents-first persist contract preserved
    - If a combined run flakes on parser modules pulled in by importing the pipeline,
      isolate the parse-touching suite (tree-sitter note)
    - Skip exhaustive pipeline-path coverage
  - [x] 5.2 Phase 1 — replace `dedupPackCandidates` at `discoveryV3Pipeline.ts:985`
    - Run `mergeCandidates` over `filterResult.kept` (packs + Stage-2 contract candidates)
    - Assign the merged result back to `filteredPackCandidates` (the line ~993 assignment
      target)
    - KEEP the existing console-log summary of what collapsed
  - [x] 5.3 Confirm Stage 2.5 enriches the merged array unchanged
    - `runDiscoveryRuntimeEvidence({ deterministicCandidates: filteredPackCandidates, ... })`
      still mutates the merged array in place by identity (no change needed beyond verifying
      reference semantics from 2.2 hold)
  - [x] 5.4 Phase 2 — fold LLM candidates into the same identity index after Stage 3
    - Replace the name-only LLM dedup at `discoveryV3Pipeline.ts` ~1382-1411 with a fold
      into the merge identity index; the LLM's input context is the already-merged pack set
      (so it gap-fills against one clean set and mints fewer dupes)
    - KEEP the existing `candidate_conflict` Finding emission (~1387-1404)
    - Leave the final `merged` array (~1412) and the batched `bulkSaveCandidates` persist
      (~1430) otherwise unchanged
  - [x] 5.5 Preserve parents-first persist
    - `sortCandidatesParentsFirst` (~1423) still runs before `bulkSaveCandidates` (~1430)
  - [x] 5.6 Ensure pipeline-wiring tests pass
    - Run ONLY the 2-8 tests written in 5.1 (isolate parse-touching suites if a combined run
      flakes)
    - Do NOT run the entire discovery-service test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- Phase 1 merge replaces dedup at the hook point; result assigned to `filteredPackCandidates`
- Stage 2.5 runtime still matches/enriches the merged array by identity
- Phase 2 folds LLM into the same index; legacy name-only LLM dedup removed; its
  `candidate_conflict` Finding still emits
- `sortCandidatesParentsFirst` + batched `bulkSaveCandidates` unchanged
- Console-log collapse summary preserved

---

### Save-Back (mcp-server)

#### Task Group 6: Save-Back Field-Name Fix (Root Cause #2)
**Dependencies:** None (independent of discovery-service groups; can run in parallel)

Belt-and-braces: even on un-merged paths, JAX-RS endpoints must persist with populated
verb/path. Add `data.httpMethod`/`data.fullPath` fallbacks to the endpoint case, mirroring
the file's existing snake/camel dual-tolerant idiom.

- [x] 6.0 Complete save-back fix
  - [x] 6.1 Write 2-8 focused tests for the endpoint save-back fallbacks
    - Limit to 2-8 highly focused tests maximum
    - A JAX-RS endpoint with ONLY `data.httpMethod`/`data.fullPath` persists with populated
      `operation_verb`/`path_or_address` via the new fallbacks
    - A merged endpoint (already normalized to `operation_verb`/`path_or_address`)
      round-trips unchanged (existing reads still win)
    - Skip exhaustive field coverage
  - [x] 6.2 Add `httpMethod`/`fullPath` fallbacks in
    `mcp-server/src/services/candidateSaveBackService.ts` endpoint case (~1077-1078)
    - `entity.operation_verb = data.http_method ?? data.operation_verb ?? data.httpMethod ?? null`
    - `entity.path_or_address = data.path ?? data.path_or_address ?? data.fullPath ?? null`
    - Mirror the file's existing dual-tolerant idiom (e.g. `response_contract` /
      `responseContract` at ~1106); preserve existing precedence so already-normalized
      values still win
  - [x] 6.3 Ensure save-back tests pass
    - Run ONLY the 2-8 tests written in 6.1
    - Do NOT run the entire mcp-server test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass
- JAX-RS endpoints with only `httpMethod`/`fullPath` persist with populated verb/path
- Already-normalized (merged) endpoints round-trip unchanged
- Fix uses the file's existing snake/camel dual-tolerant idiom

---

### Frontend Grid Conflict UI (frontend)

#### Task Group 7: Conflict Badge, Side-by-Side Chooser, Approve-Gating
**Dependencies:** Task Group 2 (consumes the `data._conflicts` / `_conflictResolutions` /
`_addedBy: string[]` shape)

Surface conflicts in `DiscoveryCandidateTable.tsx`: a per-row conflict badge, an expandable
per-attribute side-by-side chooser (single-conflict resolution), and approve-gating on
unresolved conflicts. Bulk-resolve-by-pattern UX is OUT (deferred to Spec 3).

- [x] 7.0 Complete grid conflict UI
  - [x] 7.1 Write 2-8 focused tests for the conflict UI (vitest)
    - Limit to 2-8 highly focused tests maximum
    - Conflict badge renders when unresolved `data._conflicts` present; absent otherwise
    - Expandable chooser shows competing values + source side-by-side; selecting a value
      writes `_conflictResolutions[attr]` + the canonical slot and clears that conflict
    - Approve disabled (with tooltip) while any `_conflicts` entry is unresolved; enabled
      once all resolved
    - `getAddedBy`/`TierBadge` renders for BOTH `_addedBy: string[]` and the legacy string
    - Skip exhaustive interaction/state coverage
  - [x] 7.2 Add a per-row conflict badge in
    `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`
    - New column or alongside Review Status (columns at ~630-636), driven by presence of
      unresolved `data._conflicts`
  - [x] 7.3 Add the expandable per-attribute side-by-side chooser
    - Expandable row OR modal following the `BulkFindingActionConfirmModal` sibling pattern
      (`frontend/src/components/Discovery/`)
    - Per conflicted attribute: competing values side-by-side WITH their source, single
      chooser; selecting writes `_conflictResolutions[attr]`
      (`{ chosenValue, chosenSource, resolvedBy, resolvedAt }`) + the canonical attribute
      slot and clears that conflict
    - SINGLE-conflict resolution only; bulk-resolve-by-pattern UX is OUT (Spec 3)
  - [x] 7.4 Gate clean-approve on unresolved conflicts
    - Disable Approve while any `data._conflicts` entry is unresolved, with a tooltip,
      mirroring the existing committed-row disable pattern
  - [x] 7.5 Make `getAddedBy`/`TierBadge` tolerate `_addedBy: string[]`
    - Update the extractor (~159-163) to handle `data._addedBy` as `string[]` AND the legacy
      single string
  - [x] 7.6 Ensure grid-conflict-UI tests pass
    - Run ONLY the 2-8 tests written in 7.1: `npx vitest run <files>`
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 7.1 pass
- Conflict badge renders only when unresolved `_conflicts` present
- Side-by-side chooser shows competing values + source; selecting writes
  `_conflictResolutions[attr]` + canonical slot and clears the conflict
- Approve disabled with tooltip while any conflict unresolved; enabled once all resolved
- `TierBadge` renders for both `_addedBy: string[]` and the legacy string
- No bulk-resolve-by-pattern UX added (Spec 3 boundary respected)

---

### Cross-Stack Verification

#### Task Group 8: Merge-Correctness Scenarios + Cross-Stack Verification
**Dependencies:** Task Groups 1-7

Review existing tests, fill ONLY critical gaps for THIS feature, and run the confirmed
end-to-end merge-correctness scenarios across all three stacks.

**CONFIRM no discovery run is active before running discovery-service suites.**

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Identity primitives (1.1), core merge (2.1), reconciliation (3.1), Findings (4.1),
      pipeline wiring (5.1), save-back (6.1), grid UI (7.1)
    - Total existing tests: approximately 14-56 tests across discovery-service, mcp-server,
      and frontend
  - [x] 8.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows lacking coverage; focus ONLY on this spec's
      requirements; do NOT assess whole-application coverage
    - Prioritize the confirmed scenarios below over unit-test gaps
  - [x] 8.3 Write up to 10 additional strategic tests maximum for the confirmed scenarios
    - 45-endpoint 3x->1x scenario (discovery-service `mergeCandidates`): 90 WADL
      (generic-parent + no-parent) + 45 JAX-RS (specific controller) -> 45 merged endpoints,
      each carrying verb+path (WADL) + specific interface + request/response LDEs + media
      types (JAX-RS)
    - Media-type collapse end-to-end (variants of one method+path -> one endpoint, UNIONed
      consumes/produces)
    - Conflict detection + approve-gating round-trip (differing present value -> `_conflicts`
      -> grid badge -> chooser resolves -> Approve enabled)
    - Single-source preservation (one-source candidate survives with `_addedBy`/`_mergedFrom`
      + interface untouched)
    - Relationship rebuild (re-parent + emptied-interface drop + `interface_logical_entities`
      / `endpoint_data_effects` rebuilt + `sortCandidatesParentsFirst` holds)
    - Save-back round-trip (JAX-RS `httpMethod`/`fullPath`-only endpoint persists with
      populated verb/path; merged endpoint round-trips unchanged)
    - Add a maximum of 10 new tests; do NOT write comprehensive coverage for all scenarios;
      skip edge cases / performance / accessibility unless business-critical
  - [x] 8.4 Run feature-specific tests only, across all three stacks
    - discovery-service: jest on the new suites (1.1, 2.1, 3.1, 4.1, 5.1, 8.3-discovery);
      isolate parse-touching suites if a combined run flakes (tree-sitter note)
    - mcp-server: jest on the save-back suite (6.1, 8.3-mcp)
    - frontend: `npx vitest run <files>` on the grid-UI suite (7.1, 8.3-frontend)
    - Expected total: approximately 24-66 tests maximum; do NOT run any full application
      test suite
    - Verify the confirmed scenarios pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-66 tests total) across discovery-service,
  mcp-server, and frontend
- The 45-endpoint 3x->1x scenario produces exactly 45 merged endpoints with the full
  attribute set
- Media-type collapse, conflict detection + approve-gating, single-source preservation,
  relationship rebuild, and save-back round-trip all verified
- No more than 10 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements
- No discovery-service `src/**` edits were made while a run was active

---

## Execution Order

Recommended implementation sequence:
1. Identity Primitives — path canonicalization + per-type identity keys (Task Group 1)
2. Core Merge Engine — aggregation, precedence, conflicts (Task Group 2)
3. Interface + LDE Reconciliation — relationship rebuild (Task Group 3)
4. Findings Emission (Task Group 4)
5. Pipeline Wiring — two-phase fold-in (Task Group 5)
6. Save-Back Field-Name Fix — mcp-server (Task Group 6; independent, may run in parallel
   from the start)
7. Frontend Grid Conflict UI (Task Group 7; needs Group 2's data shape, otherwise
   independent of Groups 3-5)
8. Cross-Stack Verification + merge-correctness scenarios (Task Group 8)

Parallelization notes:
- Group 6 (mcp-server save-back) has NO dependency on the discovery-service groups and can
  start immediately.
- Group 7 (frontend) depends only on Group 2's `data` shape being settled; it can proceed
  alongside Groups 3-5.
- Groups 1 -> 2 -> 3 -> 4 -> 5 are a strict chain in discovery-service.
