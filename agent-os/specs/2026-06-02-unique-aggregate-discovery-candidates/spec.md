# Specification: Unique, Aggregate Discovery Candidates (Spec 0)

## Goal
Replace the parent-inclusive dedup-DROP in discovery with a universal, identity-keyed, cross-source MERGE that produces one clean candidate per real architecture element — aggregating attribute-level findings from every source (framework packs, contract passes, runtime evidence, LLM gap-fill), holding true value conflicts for review, and recording full provenance — so the user reviews ONE truthful candidate instead of 2-3 partial duplicates.

## User Stories
- As an architect reviewing a discovery run, I want each real endpoint/interface/entity/service to appear exactly once with all its known attributes (verb+path AND its specific interface AND request/response bodies AND media types), so that I review the truth instead of reconciling duplicates by hand.
- As an architect, I want true value conflicts between sources surfaced on the candidate with each competing value and its source, and a chooser to resolve them, so that I never silently lose evidence and cannot clean-approve a candidate with an unresolved conflict.
- As a migration lead, I want every merge and every conflict recorded as a Finding with collapsed source ids and per-attribute provenance, so that the discovery output stays a complete, auditable oracle.

## Specific Requirements

**Universal merge engine (replaces the dedup-DROP)**
- Add a new reconciliation module in `discovery-service/src/services/` (e.g. `candidateMerge.ts`) exporting a pure `mergeCandidates(candidates)` that returns the merged array plus merge-group + conflict metadata; no I/O, fully unit-testable.
- Replace the `dedupPackCandidates` call at `discoveryV3Pipeline.ts:985` with this merge (packs + Stage-2 contract candidates as input); keep the existing console-log summary of what collapsed.
- Group candidates by a per-type identity key; within a group, fold all sources into ONE surviving candidate; emit single-source candidates unchanged except for provenance marking.
- v1 merged types: `endpoints`, `interfaces`, `logical_data_entities`, `physical_data_entities`, `services`. `class`/`method` are NOT merged or minted.
- Merged-candidate `confidence` = `max()` of contributing source confidences; a candidate with any unresolved conflict is flagged regardless of confidence.
- Preserve the merged array's reference semantics for Stage 2.5 (runtime evidence mutates the merged array in place by identity — it must keep matching).

**Per-type identity keys + path canonicalization**
- `endpoints`: HTTP method + canonical OAS path template. Media types are NOT part of identity.
- Add a new `canonicalEndpointPath(rawPath)` (e.g. in `endpointPathNormalizer.ts`) that composes the two existing primitives: apply `normalizePath`'s literal-ID rewrite, THEN collapse every `{anything}` placeholder segment to one positional token (e.g. `{p}`); static vs templated segments stay distinct.
- `interfaces`: controller/resource class FQN (`data.controllerClassName ?? data.className`); WADL interfaces key on `interface_type + spec_link`. A generic WADL interface NEVER key-matches a specific controller (it collapses only by being emptied — see interface reconciliation).
- `logical_data_entities`: normalized DTO type name (simple-or-FQN). `physical_data_entities`: `database_name + physical_type + normalized table/view name`. `services`: normalized service name.
- `*_attributes` keys = parent-entity identity + normalized field name (parent-scoped); attributes are reconciled as a consequence of their parent, not merged independently.
- Relationship/link rows (`interface_logical_entities`, `endpoint_data_effects`, `logical_data_entity_physical_data_entities`, `data_movements`) are keyed by their two endpoint identities and REBUILT after the entity merge.

**Media-type variant collapse**
- The JAX-RS detector currently mints separate endpoint candidates for media-type variants (different consumes/produces) of the same method+path; merge collapses these into ONE endpoint.
- UNION `consumes` and `produces` (and headers/params where the detector splits on them) across the collapsed variants; this overrides the current discriminator split.

**Attribute aggregation + source precedence**
- Union all `data` attributes across grouped sources into the surviving candidate.
- Source precedence (for gap-fill of an absent slot AND for choosing the canonical slot when values are EQUAL): structural framework pack > contract pack (WADL/WSDL/XSD) > runtime evidence > LLM gap-fill.
- Differing PRESENT values for the same attribute are NEVER auto-resolved by precedence — they become a conflict (see conflict model).
- Normalize field names to the save-back's canonical names during aggregation (see save-back fix) so nothing is lost at persist; record `data._attributeProvenance[attr] = sourceLabel` for every populated attribute.
- Source labels derive from the contributing candidates' `data._addedBy` (and the runtime/LLM stage).

**Conflict + provenance data model (in candidate `data`, JSONB passthrough — reusable by Spec 3)**
- `data._conflicts[attr]` = array of competing `{ value, source }` (one per distinct present value across sources). No AMS schema change — `data` is a JSONB passthrough.
- `data._conflictResolutions[attr]` = `{ chosenValue, chosenSource, resolvedBy, resolvedAt }`, written when a conflict is resolved; the chosen value is also written to the canonical attribute slot.
- `data._addedBy` becomes `string[]` (set of contributing source labels), upgrading the current single-string field.
- `data._mergedFrom` = array of the collapsed source-candidate ids (audit trail).
- An UNRESOLVED `_conflicts` entry gates clean-approve (enforced in the grid; see UI).
- This entire shape MUST be reusable by Spec 3 — do not couple any of it to the grid UI.

**Findings (oracle completeness — nothing silently lost)**
- Emit one Finding per merge group (records the surviving candidate, the collapsed source-candidate ids from `_mergedFrom`, and per-source contribution).
- Emit one Finding per detected conflict (records `attr`, the competing `{value, source}[]`).
- Reuse the existing Stage-4 `candidate_conflict` Finding emission shape (`discoveryV3Pipeline.ts` ~1387-1404) — extend it rather than inventing a new emission path.

**Interface + logical-data-entity reconciliation (relationship rebuild IN v1)**
- Re-parent a merged endpoint to its SPECIFIC controller interface (from the JAX-RS source) when sources disagree on parent.
- Drop a generic WADL interface once it has zero remaining endpoints after re-parenting.
- Consolidate request/response `logical_data_entities` by their identity key (one surviving DTO per identity).
- REBUILD `interface_logical_entities` and `endpoint_data_effects` relationship rows to point at the surviving interfaces/entities; drop rows orphaned by an emptied interface.
- A single-source endpoint keeps its own interface untouched.
- Preserve `sortCandidatesParentsFirst` invariants at persist (`discoveryV3Pipeline.ts:1423`) — parents before children, after re-parenting/drops.

**Two-phase pipeline wiring**
- Phase 1: at `discoveryV3Pipeline.ts:985`, run the merge over `filterResult.kept` (packs + contract); assign the merged result back to `filteredPackCandidates`. Stage 2.5 runtime evidence then enriches this merged array unchanged (it already mutates by identity via `buildCandidateIdentityLookup`).
- Phase 2: after Stage 3, fold the LLM candidates into the SAME identity index, replacing the name-only LLM dedup at `discoveryV3Pipeline.ts` ~1382-1411 (keep its `candidate_conflict` Finding emission). The LLM's input context is the already-merged pack set (so the LLM gap-fills against one clean set and mints fewer dupes).
- The final `merged` array (~1412) and the batched `bulkSaveCandidates` persist (~1430) are otherwise unchanged.

**Save-back field-name fix (root cause #2 — fix in BOTH places)**
- In the merge: normalize endpoint `data.httpMethod` -> `operation_verb` and `data.fullPath` -> `path_or_address` (so the canonical slots are populated before persist).
- In `mcp-server/src/services/candidateSaveBackService.ts` endpoint case (~1077-1078): add `data.httpMethod` and `data.fullPath` as additional fallbacks, mirroring the file's existing snake/camel dual-tolerant idiom, so JAX-RS endpoints no longer persist with empty verb/path even on un-merged paths.

**Grid conflict UI (this spec)**
- In `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`: add a conflict badge per row (new column or alongside Review Status) driven by presence of unresolved `data._conflicts`.
- Add an expandable row (or modal, following the `BulkFindingActionConfirmModal` sibling pattern) showing, per conflicted attribute, the competing values side-by-side WITH their source, and a single-conflict chooser; selecting a value writes `_conflictResolutions[attr]` + the canonical slot and clears that conflict.
- Gate clean-approve: disable Approve while any `_conflicts` entry is unresolved, with a tooltip, mirroring the existing committed-row disable pattern.
- Update the `getAddedBy`/`TierBadge` extractor (~159-163) to tolerate `data._addedBy` as `string[]` as well as the legacy string.
- Bulk-resolve-by-pattern UX is OUT (Spec 3); Spec 0 only defines the Q5 similarity class (same attribute name AND same unordered set of competing source labels) and ensures the data model makes it computable.

## Existing Code to Leverage

**`discovery-service/src/services/packPostProcess.ts` — `buildEntityAwareDedupKey` (138-164), `dedupPackCandidates` (171-190)**
- The thing being replaced: endpoint key includes `parentInterface` (158), so the same verb+path under generic WADL / no parent / specific controller never collapses.
- Its verb/path fallbacks (`data.httpMethod ?? data.operation_verb`, `data.fullPath ?? data.path_or_address`, 142-151) are the dual-shape read the merge identity key must replicate.

**`discovery-service/src/services/runtimeEvidence/endpointPathNormalizer.ts`**
- `normalizePath` (71-80) does the literal-ID rewrite; `arePathsEquivalentByPlaceholder` (106+) is a pairwise comparator that collapses `{x}≡{y}` but is NOT a single canonical string. Compose both into the new `canonicalEndpointPath()` (a single hashable key for a Map).

**`discovery-service/src/services/discoveryV3Pipeline.ts` — Stage-2 post-filter (975-994), Stage 2.5 (996-1038), Stage 4 (1366-1437)**
- Hook point at 985; runtime evidence mutates the array in place by identity (so the merge must hand it the same array); Stage-4 LLM dedup (1382-1411) is the Phase-2 replacement site and carries the `candidate_conflict` Finding precedent (1387-1404). `sortCandidatesParentsFirst` (1423) + batched `bulkSaveCandidates` (1430) are the persist contract to preserve.

**`mcp-server/src/services/candidateSaveBackService.ts` — endpoint case (1073-1111)**
- Lines 1077-1078 read `http_method`/`operation_verb` and `path`/`path_or_address` but NOT `httpMethod`/`fullPath`. The file already uses snake/camel dual-tolerant assignments elsewhere (e.g. `response_contract`/`responseContract` at 1106) — same idiom for the fix.

**`discovery-service/src/types/candidate.ts` — `DiscoveryCandidate` (154-216)**
- No first-class provenance field; `_addedBy` lives inside `data`. The merge upgrades it to a set and adds `_conflicts`/`_conflictResolutions`/`_mergedFrom`/`_attributeProvenance` all inside `data` (JSONB passthrough — no AMS schema change). `CandidateType` union enumerates the mergeable types.

**`frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx` — columns (630-636), `getAddedBy`/`TierBadge` (159+), bulk review (`handleBulkReview` ~477-507), committed-row disable pattern**
- The conflict badge slots into the column row; the committed-row Approve-disable+tooltip pattern is the model for conflict-gating; `BulkFindingActionConfirmModal` (`frontend/src/components/Discovery/`) is the sibling modal pattern for the side-by-side chooser.

## Out of Scope
- Cross-scan / cross-run preference memory (rides with future re-scan support).
- The conversational "Architect" review persona (Spec 3) — it CONSUMES this spec's conflict data model.
- The within-session bulk-resolve-by-pattern UX ("45 similar — resolve all?") — deferred to Spec 3; Spec 0 only defines the similarity class + the data model.
- Minting or merging `class` / `method` candidates (discovery does not mint them).
- Merging attributes or relationship/link rows as independent identity groups — they reconcile only as a consequence of their parents.
- Any AMS schema change — the conflict/provenance model rides in the existing `data` JSONB passthrough.
- Changing the meta-model's backend-managed polymorphic `*_points` rows — the merge never touches them.
- Adding a new `VALID_STEPS` entry or `runManager` change for the merge step.

## Test Plan
Merge correctness is the crux — drive it with `mergeCandidates` unit tests (pure, no I/O). No edits to `discovery-service/src/**` while a discovery run is active.

**Merge correctness (discovery-service)**
- 45-endpoint 3x->1x scenario: 90 WADL (generic-parent + no-parent) + 45 JAX-RS (specific controller) -> 45 merged endpoints, each carrying verb+path (WADL) + specific interface + request/response LDEs + media types (JAX-RS).
- `canonicalEndpointPath()`: `{theString}`≡`{myString}` and `/users/123`≡`/users/{id}` collapse to one key; static vs templated segments stay distinct; method is part of the key.
- Media-type collapse: JAX-RS media-type variants of the same method+path merge into one endpoint with UNIONed consumes/produces.
- Source precedence: absent slot gap-filled by precedence; EQUAL values pick the canonical slot by precedence; per-attribute provenance recorded in `_attributeProvenance`.
- Conflict detection: differing present values produce `_conflicts[attr]` with each `{value, source}`; never auto-resolved by precedence.
- Single-source preservation: a candidate found by one source survives with `_addedBy: [source]`, `_mergedFrom`, and its interface untouched.
- Interface/LDE rebuild: re-parent to specific interface; generic WADL interface emptied to zero endpoints is dropped; DTOs consolidated by identity; `interface_logical_entities` + `endpoint_data_effects` rebuilt; `sortCandidatesParentsFirst` holds.
- Confidence = max() of sources; conflicted candidate flagged regardless of confidence.
- Findings: one per merge group (with `_mergedFrom` ids) + one per conflict.

**Pipeline wiring (discovery-service)**
- Phase 1 merge replaces dedup at the hook point; Stage 2.5 still matches/enriches the merged array by identity.
- Phase 2 folds LLM candidates into the same index; the legacy name-only LLM dedup is gone but its `candidate_conflict` Finding still emits.

**Save-back round-trip (mcp-server)**
- A JAX-RS endpoint with only `data.httpMethod`/`data.fullPath` persists with populated `operation_verb`/`path_or_address` via the new fallbacks; merged endpoints (already normalized) round-trip unchanged.

**Grid conflict UI (frontend)**
- Conflict badge renders when unresolved `_conflicts` present; absent otherwise.
- Expandable chooser shows competing values + source; selecting writes `_conflictResolutions[attr]` + canonical slot and clears the conflict.
- Approve disabled (with tooltip) while any conflict unresolved; enabled once all resolved.
- `getAddedBy`/`TierBadge` renders for both `_addedBy: string[]` and the legacy string.
