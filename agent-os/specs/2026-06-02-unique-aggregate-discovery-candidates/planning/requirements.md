# Spec Requirements: Unique, Aggregate Discovery Candidates (Spec 0)

## Initial Description

(Verbatim intent from `planning/raw-idea.md`.) "Spec 0" — second of a 5-spec program
(Spec F done → **Spec 0** → 1 → 2 → 3) that unifies + aggregates discovery review and
adds a conversational "Architect" review persona.

Problem (confirmed by direct code reading): when discovery scans a codebase, multiple
"packs"/sources each emit a candidate for the SAME real architecture element, so the user
sees duplicates. Concrete confirmed example — a Java 8 / Spring Classic app produced **3
candidates for every 1 real endpoint**: (a) REST-WADL-PACK endpoint under a generic parent
interface, (b) REST-WADL-PACK endpoint with no parent, (c) SPRING-CLASSIC-JAXRS endpoint
under the specific controller-class interface. 45 real endpoints → 90 WADL + 45 JAX-RS =
135 candidates. Each source holds a DIFFERENT slice of the truth: WADL has verb+path+
description (generic interface, no request/response bodies); JAX-RS has the specific
controller interface + request/response logical-data-entities + consumes/produces media
types BUT its verb/path silently vanish at save.

Goal: replace the parent-inclusive DROP with a UNIVERSAL, identity-keyed, cross-source
MERGE that aggregates attribute-level findings into ONE clean candidate per real element,
across ALL sources (framework packs, contract passes, runtime evidence, LLM gap-fill), with
true value conflicts HELD for review (surfaced in the candidate grid + a Finding + within-
session bulk-resolve-by-pattern). It is the foundation the later review-model/conversation
specs (esp. Spec 3) consume.

This is SHAPING ONLY — requirements + clarifying questions; the spec is written later.

## Requirements Discussion

The raw idea already carries a set of LOCKED DECISIONS from a prior shaping conversation
(raw-idea.md lines 11-18). They are treated as confirmed inputs, not re-litigated. The
clarifying questions below pin down the parts those locked decisions leave open (per-type
identity keys beyond endpoints, source-priority order, conflict/provenance data shapes,
bulk-resolve similarity definition, exact hook ordering, grid-UI scope boundary, confidence
model). The user explicitly asked NOT to auto-resolve these.

### Existing Code to Reference

No NEW similar feature was nominated by the user — instead the brief pins the exact code to
ground in. Verified file:line evidence below; all paths are absolute.

**Root cause #1 — parent-in-key DROP (the thing being replaced):**
`discovery-service/src/services/packPostProcess.ts`
- `buildEntityAwareDedupKey` (lines 138-164). Endpoints key =
  `endpoints \0 verb \0 path \0 parentInterface` (line 158), with
  `parentInterface = data.controllerClassName ?? cand.parentCandidateId ?? ''`
  (lines 152-156). **Because the parent is in the key, the same (verb, path) under the
  generic WADL interface / no parent / specific controller interface lands under THREE
  different keys and never collapses.** All non-endpoint types key on
  `(candidateType, normalizeName(name))` (line 163).
- `dedupPackCandidates` (lines 171-190) — first-occurrence-wins DROP (line 180 `seen.has`).
  Within-array only; no cross-source reconciliation, no attribute aggregation, no
  provenance, no conflict capture. Confirmed.
- The verb/path fallbacks already read both shapes — `data.httpMethod ?? data.operation_verb`
  (lines 142-146) and `data.fullPath ?? data.path_or_address` (lines 147-151). So the dedup
  KEY already tolerates both field-name shapes; only the SAVE-BACK does not (root cause #2).

**Root cause #2 — field-name mismatch drops attributes at save:**
`mcp-server/src/services/candidateSaveBackService.ts`
- Endpoint case (lines 1073-1111): `entity.operation_verb = data.http_method ||
  data.operation_verb || null` (line 1077) and `entity.path_or_address = data.path ||
  data.path_or_address || null` (line 1078). **Neither reads `data.httpMethod` /
  `data.fullPath`** — the exact camelCase fields the JAX-RS detector writes (see below) — so
  JAX-RS endpoints persist with empty verb/path. Confirmed.
- Canonical save-back `data.*` keys per type (the names the merge must normalize TO, so
  nothing is lost at persist):
  - endpoints: `operation_verb`, `path_or_address`, `protocol_metadata_json` (SOAP, via
    `buildSoapProtocolMetadata`), `response_contract` (also tolerates `responseContract`)
    (lines 1077-1110).
  - physical_data_entities / data_entity: `physical_type` (or `objectType`),
    `database_name` (or `databaseName`), `tags` (lines 1036-1051).
  - physical_data_attributes: `data_type`/`dataType`, `is_primary_key`/`isPrimaryKey`,
    `is_nullable`/`isNullable` (lines 1113-1120).
  - logical_data_attributes: same trio + `field_metadata`/`fieldMetadata` (1122-1148).
  - logical_data_entities: `source_provenance` (SOAP) (1028-1034).
  - business_logics: `description_md`/`description`, `type_text`/`typeText`, `tags`,
    `behavior` (1150-1169).
  - logical_data_entity_relationships: `sourceEntity`, `targetEntity`, `cardinality`,
    `relationshipType` (1171-1178).
  Note the existing pattern is already snake/camel dual-tolerant for several fields — the
  fix for endpoints (add `httpMethod`/`fullPath` fallbacks) is the SAME belt-and-braces
  idiom already used elsewhere in this file.

**Stage order + the exact hook point:**
`discovery-service/src/services/discoveryV3Pipeline.ts`
- Stage 2 contract passes append WADL/WSDL/XSD candidates into `filteredPackCandidates`
  (lines 925-940). At this point endpoint candidates DO carry verb+path (WADL writes
  `operation_verb`/`path_or_address`; JAX-RS writes `httpMethod`/`fullPath`) — so the
  merge's identity key has its inputs in hand for endpoints.
- **Stage 2 post-filter block (lines 975-994)** — `filterNonExternalInterfaces` then
  `dedupPackCandidates` (call site **line 985**), result assigned back to
  `filteredPackCandidates` (line 993). **This is the hook point to replace** with the merge.
- Stage 2.5 runtime evidence (lines 996-1038): calls `runDiscoveryRuntimeEvidence({
  deterministicCandidates: filteredPackCandidates, ... })` (line 1032). CRITICAL: runtime
  evidence does NOT add candidates — it **mutates the deterministic candidates in place**
  (`runDiscoveryRuntimeEvidence.ts` line 654 `applyRuntimeEvidenceToCandidates(
  deterministicCandidates, matched, noUsage)`) and matches by an **identity lookup**
  (`buildCandidateIdentityLookup`, line 753). So runtime "folds in by identity" already; the
  merge can reuse the same array + identity model.
- Stage 4 (lines 1366-1437): `merged = [...filteredPackCandidates, ...dedupedLlm]`
  (lines 1412-1415). A FINAL LLM-only dedup runs first (lines 1382-1411) keyed on
  `(candidateType, normalize(name))` (line 1390) — **keep-higher-confidence**, and it
  ALREADY emits a `candidate_conflict` Finding per drop (`dedupConflictPairs`, lines
  1387-1404). Pack candidates are explicitly NOT touched there (lines 1379-1380). Persist is
  batched via `archModelClient.bulkSaveCandidates` (**line 1430**), parents-first
  (`sortCandidatesParentsFirst`, line 1423).

**Per-candidate-TYPE builders + their identity-bearing attributes:**
- WADL (`discovery-service/src/services/findings/packFindingScanners/contractCandidates.ts`):
  - interface (lines 114-141): `name = applicationTitle ?? basename`; `data.interface_type =
    'REST_API'`, `spec_link`, `wadlSource`, `_addedBy: 'rest-wadl-pack'` (line 137).
  - endpoint (lines 143-173): `name = op.compositeId` (line 153); `data.operation_verb =
    op.httpMethod`, `data.path_or_address = op.path` (lines 159-160), plus `base_url`,
    `request_representations`, `response_representations`, `_addedBy: 'rest-wadl-pack'`.
    **WADL forms NO request/response logical_data_entities** (raw-idea line 7).
- JAX-RS (`discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/
  inboundSurfaceDetectors.ts`):
  - `makeCandidate` factory (lines 140-162): `confidence: 0.9`, `status: 'proposed'`,
    `data._addedBy = addedBy` (line 157).
  - interface (lines 339-355): `name = cls.name`; `data.interfaceSubtype = 'jaxrs-resource'`,
    `controllerType`, `className`, `packageName`, `basePath`.
  - endpoint (lines 368-389): `name = \`${httpMethod} ${fullPath}${nameSuffix}\`` (line 381,
    note the discriminator `nameSuffix`); `data.httpMethod`, `data.fullPath`,
    `data.controllerClassName = cls.name`, `data.methodName`, `data.returnType` (lines
    369-374), plus consumes/produces/headers/params via `applyDiscriminatorsAndInputs`
    (line 376). **The endpoint NAME differs from WADL's `compositeId`** → identity MUST key
    on verb+path attributes, never on `name`.
  - There are 3 inbound detectors in this file emitting the same shape: JAX-RS (~339),
    servlet/web.xml (~519), and an interface-derived path (~681) — each writes
    `httpMethod`/`fullPath`/`controllerClassName`.

**Existing endpoint-identity / path-normalization PRECEDENT (reuse candidate):**
`discovery-service/src/services/runtimeEvidence/endpointPathNormalizer.ts`
- `normalizePath(rawPath)` (lines 71-80): strips `?query`, replaces **ID-bearing literal**
  segments (numeric / UUID / 16+-char-with-digit) with `{id}`. Does NOT touch already-named
  placeholders like `{ownerId}`.
- `arePathsEquivalentByPlaceholder(a, b)` (lines 106+): pairwise comparator that treats any
  `{xyz}` placeholder as structurally equal in the same position (collapses
  `{theString}≡{myString}`, raw-idea line 12) and lets a placeholder dominate a literal.
  `PLACEHOLDER_SEGMENT_REGEX = /^\{[^/{}]+\}$/` (endpointRuntimeMatcher.ts line 90).
  **DESIGN GAP for a hash-keyed merge:** this is a pairwise comparator, not a single
  canonical string. The brief wants a single identity KEY (for a Map). So the merge needs a
  canonicalizer that maps EVERY `{anything}` segment → one token (e.g. `{p}`) AND applies
  `normalizePath`'s literal-ID rewrite — i.e. compose/extend the two existing primitives
  into one `canonicalEndpointPath()`. This is a real, small design decision, not a given.

**The candidate model (where merge/provenance/conflict structures live):**
`discovery-service/src/types/candidate.ts`
- `DiscoveryCandidate` (lines 154-216): `id`, `runId`, `candidateType`, `name`,
  `confidence` (0..1), `status`, `sourceClusterIds: string[]`, `data: Record<string,
  unknown>`, `parentCandidateId?`, `logEnrichment?`, `operation? ('create'|'enrich'|'link')`.
- **There is NO first-class `_addedBy` / provenance field** — `_addedBy` lives INSIDE
  `data` as a single string (set by every builder). The merge turns it into a SET and adds
  `_conflicts` / per-attribute provenance / `_mergedFrom`. AMS persists `data` as a JSONB
  passthrough (the spec's reusable conflict data model rides here; Spec 3 reuses it).
- `CandidateType` union (lines 77-103): the multi-sourceable types in play are `service`,
  `interfaces`, `endpoints`, `logical_data_entities`, `logical_data_attributes`,
  `physical_data_entities`, `physical_data_attributes`, plus relationship/link types
  (`interface_logical_entities`, `logical_data_entity_physical_data_entities`,
  `endpoint_data_effects`, `data_movements`, etc.). `class`/`method` exist in the union but
  the meta-model reference says they are NOT minted from discovery.

**The candidate review grid (where conflict UI would surface):**
`frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`
- Flat table, columns: Name / Tier / Type / Confidence / Review Status / Synthesized At /
  Actions (lines 630-636). Per-row Tier badge derived from `data._addedBy` (extractor lines
  156-167, `TierBadge`). Per-row Approve / Reject / Defer (`reviewCandidate`); committed
  rows disable with a tooltip. Bulk Approve/Reject "All" + "Filtered"
  (`handleBulkReview`, lines 477-507; `bulkReviewCandidates`). Column filters per column.
  **No conflict concept today.** A conflict badge fits as a new column or alongside Review
  Status; a per-attribute side-by-side comparison needs an expandable row or a modal (a
  `BulkFindingActionConfirmModal` sibling pattern already exists in `components/Discovery/`).

**Meta-model reference (parentage + relationships the merge must respect/rebuild):**
`gateway/src/config/prompts/shared/architecture-context-explainer.md`
- `endpoints` are individual operations on an `interfaces` (lines 15, 74). `interfaces` are
  EXTERNAL boundaries only (the post-filter drops internal-Spring interfaces).
- `interface_logical_entities` (line 74) links an interface to the logical_data_entities it
  exposes (request/response bodies). `endpoint_data_effects` (line 77) links an endpoint to
  a data entity it reads/writes. Both are relationship rows the merge must re-point when it
  re-parents endpoints / consolidates DTOs / drops emptied interfaces.
- Polymorphic `*_points` are backend auto-managed — the merge NEVER touches them.

### Follow-up Questions

None yet — this is the first shaping pass. The questions below go to the user now; their
answers (and any follow-ups) get appended here before the spec is written.

## Visual Assets

### Files Provided:
No visual assets provided. (`planning/visuals/` exists but is empty — verified via
directory listing; no `.png/.jpg/.jpeg/.gif/.svg/.pdf` files.)

### Visual Insights:
None — no files to analyze.

## Requirements Summary

### Functional Requirements
- Replace the parent-inclusive DROP (`packPostProcess.dedupPackCandidates`) with a
  universal, identity-keyed, cross-source MERGE producing one clean candidate per real
  element while KEEPING single-source candidates (marked with provenance).
- Per-type, meta-model-aware identity keys (endpoints settled = HTTP method + canonical
  path template with every `{param}` collapsed to one positional token; other types TBD by
  the clarifying questions).
- Attribute-level aggregation: union attributes across sources; NORMALIZE field names to the
  save-back's canonical names (fix root cause #2); record per-attribute provenance.
- True value conflicts HOLD for review (never auto-resolve): a per-candidate conflict
  badge/state + per-attribute side-by-side competing values w/ source + chooser in the grid,
  a Finding recording the conflict, and within-session bulk-resolve-by-pattern. A conflict
  gates "clean approve".
- Fold LLM (Stage 3) + runtime-evidence (Stage 2.5) candidates into the same identity model
  so the LLM and the persisted review list both see ONE clean set.
- Re-parent merged endpoints to the specific interface; drop generic interfaces emptied to
  zero endpoints; consolidate request/response logical_data_entities by identity; rebuild
  `interface_logical_entities` / `endpoint_data_effects` relationship rows accordingly.
- Provenance/audit: collapsed source-candidate ids + per-attribute source + a Finding per
  merge group (oracle completeness — nothing silently lost).
- Belt-and-braces save-back fix: have `candidateSaveBackService` read `httpMethod`/`fullPath`
  fallbacks in addition to normalizing in the merge.

### Reusability Opportunities
- `endpointPathNormalizer.normalizePath` + `arePathsEquivalentByPlaceholder` — extend/compose
  into a single `canonicalEndpointPath()` for the endpoint identity KEY.
- `buildCandidateIdentityLookup` (runtimeEvidence) — existing identity model for endpoints to
  align the merge with, so Stage 2.5 keeps matching.
- The Stage 4 LLM-dedup `candidate_conflict` Finding emission (discoveryV3Pipeline.ts
  ~1387-1404) — existing precedent for emitting a Finding per collision; the merge's
  per-group Finding and per-conflict Finding follow this shape.
- `data._addedBy` provenance string + the grid `TierBadge` extractor — extend `_addedBy` to a
  set; the badge already reads it.
- `BulkFindingActionConfirmModal` (`frontend/src/components/Discovery/`) + the existing bulk
  review plumbing — pattern for the bulk-resolve-by-pattern confirm UX.
- Save-back's existing snake/camel dual-tolerant assignments — idiom for the `httpMethod`/
  `fullPath` fallback fix.

### Scope Boundaries
**In Scope (per locked decisions):**
- The merge engine in discovery-service (universal, all types, all sources).
- The conflict + provenance DATA MODEL on the candidate (must be reusable by Spec 3).
- Root-cause-#2 field-name fix (merge normalization + save-back fallbacks).
- Interface re-parenting / emptied-interface drop / DTO consolidation / relationship rebuild.
- A Finding per merge group + per conflict.
- Frontend grid conflict surfacing — EXTENT is an open question (Q9).

**Out of Scope:**
- Cross-scan / cross-run preference memory (deferred; rides with future re-scan support —
  raw-idea line 15).
- The conversational "Architect" review persona itself (that is the later Spec 3, which
  CONSUMES this spec's conflict data model).
- Minting `class`/`method` entities (meta-model says discovery does not).

### Technical Considerations
- CONVENTION: no edits to `discovery-service/src/**` during an active discovery run (tsx
  watch auto-reload kills runs). Implementation/test runs must be done with no run active.
- AMS persists candidate `data` as JSONB passthrough → `_conflicts` / `_mergedFrom` /
  per-attribute provenance survive without an AMS schema change (confirm in spec).
- Endpoint NAME is NOT a reliable identity (WADL `compositeId` ≠ JAX-RS
  `${verb} ${path}${discriminatorSuffix}`) — key on attributes.
- Path canonicalization needs a NEW single-string canonicalizer (existing `normalizePath`
  only rewrites literal IDs; placeholder-name collapse only exists as a pairwise comparator).
- The merge must preserve `sortCandidatesParentsFirst` invariants at persist (parents before
  children) since it re-parents endpoints and drops interfaces.
- Discriminator-suffixed JAX-RS endpoint variants (different consumes/produces) are
  intentionally DISTINCT today — the identity key must decide whether media-type
  discriminators are part of endpoint identity or merged attributes (surfaced in Q1).

## Resolved Decisions (user-confirmed 2026-06-02)

All ten clarifying questions resolved — the shaper's recommended defaults are adopted, with
the two genuine calls (Q1 scope, Q9 grid extent) and the media-type nuance settled as below.

- **Q1 — v1 merge scope + identity keys.** Merge in v1: **`endpoints`, `interfaces`,
  `logical_data_entities`, `physical_data_entities`, `services`**. Their attributes
  (`logical_data_attributes` / `physical_data_attributes`) and relationship/link rows
  reconcile as a CONSEQUENCE of their parents (rebuilt after the entity merge), not merged
  directly. `class` / `method` are OUT (discovery doesn't mint them). Identity keys:
  - `endpoints`: HTTP method + **canonical OAS path template** (every `{param}` → one
    positional token; literal-ID rewrite from `normalizePath`; static vs templated segments
    distinct). Build a new `canonicalEndpointPath()` composing the two existing primitives.
  - `interfaces`: external-surface identity — controller/resource class FQN
    (`data.className`/`controllerClassName`); WADL = `interface_type + spec_link`. A generic
    WADL interface does NOT key-match a specific controller; it collapses only by being
    emptied (Q8).
  - `logical_data_entities`: normalized DTO type name (simple-or-FQN).
  - `physical_data_entities`: `database_name + physical_type + normalized table/view name`.
  - `services`: normalized service name.
  - `*_attributes`: parent-entity-identity + normalized field name (parent-scoped).
  - relationship/link rows (`interface_logical_entities`, `endpoint_data_effects`,
    `logical_data_entity_physical_data_entities`, `data_movements`): keyed by their two
    endpoint identities, rebuilt after the entity merge.
  - **MEDIA-TYPE NUANCE (settled):** the JAX-RS detector currently mints SEPARATE candidates
    for media-type variants (different consumes/produces) of the same method+path. Under OAS,
    method+path is ONE operation and consumes/produces are attributes of it — so the merge
    **collapses those variants into one endpoint and UNIONS the media types** (overriding the
    current discriminator split). Media types are NOT part of endpoint identity.
- **Q2 — Source precedence (gap-fill + equal-but-present canonical slot):** **structural
  framework pack > contract pack (WADL/WSDL/XSD) > runtime evidence > LLM gap-fill.**
  Differing PRESENT values are NEVER auto-resolved by priority → they become a conflict (Q3).
- **Q3 — Conflict data model + gating (LOCKED — Spec 3 reuses this):** conflicts live in
  `data._conflicts` = per-attribute map of competing `{ value, source }[]`. A resolution
  writes the chosen value to the canonical attribute, stamps
  `data._conflictResolutions[attr] = { chosenValue, chosenSource, resolvedBy, resolvedAt }`,
  and emits a Finding. Any UNresolved `_conflicts` entry BLOCKS "clean approve" of that
  candidate (grid disables Approve with a tooltip, mirroring the committed-row pattern).
- **Q4 — Provenance shape:** `data._addedBy` → `string[]` (set of contributing sources);
  add `data._mergedFrom` = collapsed source-candidate ids; add
  `data._attributeProvenance[attr] = source` (per-attribute — required to compute Q5's
  similarity grouping).
- **Q5 — Bulk-resolve similarity class:** two conflicts are "similar" iff **same attribute
  name AND same unordered set of competing source labels** (e.g. `operation_verb`,
  `{WADL, JAX-RS}`). Applying a bulk resolution writes the same chosen **SOURCE** (not the
  literal value) to every member + one bulk-resolution Finding referencing all members.
  **NOTE (Q9 interaction):** the similarity-class DEFINITION + the data model that enables it
  are built in Spec 0; the within-session "N similar — resolve all?" UX ships in **Spec 3**.
- **Q6 — Hook point + two-phase fold-in:** Phase 1 — replace `dedupPackCandidates` at
  `discoveryV3Pipeline.ts:985` with the merge (packs + contract). Stage 2.5 runtime enriches
  the merged array unchanged (it already mutates by identity). Phase 2 — after Stage 3,
  fold LLM candidates into the existing identity index (replacing the name-only LLM dedup at
  ~1382-1411). The **LLM input is the already-merged pack set** (better gap-fill, fewer
  dupes minted).
- **Q7 — Root-cause-#2 fix in BOTH places:** normalize `httpMethod`→`operation_verb` and
  `fullPath`→`path_or_address` during the merge, AND add `data.httpMethod`/`data.fullPath`
  fallbacks to the `candidateSaveBackService` endpoint case (the file's existing dual-tolerant
  idiom).
- **Q8 — Interface + LDE reconciliation (relationship rebuild IN v1):** re-parent a merged
  endpoint to the **specific controller interface**; drop a generic WADL interface once it
  has zero remaining endpoints; consolidate request/response `logical_data_entities` by Q1
  identity; **rebuild `interface_logical_entities` + `endpoint_data_effects` relationship rows**
  to point at the surviving entities. A single-source endpoint keeps its own interface
  untouched. Preserve `sortCandidatesParentsFirst` at persist.
- **Q9 — Grid conflict-UI extent (trimmed-B):** Spec 0 ships the conflict **data model** +
  grid **badge** + expandable per-attribute **side-by-side chooser** (single-conflict
  resolution) + **approve-gating**. The within-session **bulk-resolve-by-pattern** ("45
  similar — resolve all the same?") is **deferred to Spec 3** (its natural conversational
  home), but Spec 0's data model + Q5 similarity definition make it computable there.
- **Q10 — Merged-candidate confidence:** **max()** of contributing source confidences; a
  candidate with any unresolved conflict is flagged regardless of confidence.

### Net guidance for the spec writer
- One reconciliation engine in discovery-service, identity-keyed, universal across the five
  v1 types + all sources, two-phase fold-in (packs/contract at 985, LLM after Stage 3).
- Conflict/provenance structures live in candidate `data` (JSONB passthrough — no AMS schema
  change): `_conflicts`, `_conflictResolutions`, `_addedBy: string[]`, `_mergedFrom`,
  `_attributeProvenance`.
- New `canonicalEndpointPath()`; media-type variants collapse (not identity).
- Findings: one per merge group + one per conflict (reuse the Stage-4 `candidate_conflict`
  emission shape).
- Frontend (this spec): grid conflict badge + per-attribute side-by-side chooser +
  approve-gating. Bulk-resolve-by-pattern UX is Spec 3.
- Belt-and-braces save-back fix (`httpMethod`/`fullPath` fallbacks).
- OUT: cross-scan preference memory; the Spec 3 conversation; bulk-resolve UX; `class`/`method`.
