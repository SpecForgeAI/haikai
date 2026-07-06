# Spec H — Verbatim Code-Spec Carriage

**Program:** Code-Tier Oracle (see `agent-os/planning/2026-07-06-code-tier-oracle-gap-analysis.md`)
**Closes:** Gap P4 (spec text carries IDs, not facts; the implementer LLM invents what AMS
already stores byte-exact).
**Mirrors:** Persistence Spec C (`2026-07-02-c-verbatim-db-specs`) — same fence discipline,
same no-fabrication posture.

## Goal

The generated spec text for every code story embeds, verbatim, every relevant fact the
model holds: request/response contracts, protocol metadata, data-effect paths with SQL,
behaviour blocks, attached findings, and real captured request/response examples from the
active baseline. The implementer reproduces facts; it does not reinvent them.

## Evidence / current behaviour

- `gateway/src/services/migrationShapeSpecGenerationHandler.ts` +
  `migrationSpecContextClient.ts:59–238`: context blocks carry `oasContractId`,
  `behaviourBaselineIds[]`, `mappingIds[]` — IDs only. Generated spec text = story
  title/description/ACs + references. Contracts/behaviour/SQL/examples never embedded.
- The facts exist committed: `EndpointEntity.request_contract` / `.response_contract` /
  `.protocol_metadata_json` (JSONB), `BusinessLogicEntity.behavior` (7-part block),
  `EndpointDataEffectEntity.path_metadata_json` (hops + `query_text` + `query_kind`),
  `api_behaviour_baseline_items` (captured request/response pairs, redacted).

## Scope

### 1. Deterministic carriage branch

New module `gateway/src/services/migrationCodeSpecCarriage.ts` (sibling of
`migrationDbPackSpecCarriage.ts`):

- `isCodeCarriageStory(item)`: tag `provenance:plan-deterministic` + stream in the three
  code streams (Spec G extras present).
- `runCodeSpecCarriage(item, deps)`: executes BEFORE the generic spec-gen path (same
  interception point as the DB carriage branch), fully deterministic — the LLM is NOT
  called for cluster stories. Flagged single-endpoint stories keep their LLM prose but the
  fact section below is APPENDED deterministically (facts are never paraphrased).

### 2. Embedded fact sections (per story)

Spec text starts `/agent-os:shape-spec <story title>` followed by:

1. **Interface & endpoints** — for each endpoint in `apiEndpointIds`: method, path,
   endpoint_type, protocol, direction.
2. **Request contract** — the committed `request_contract` JSONB, canonically serialized
   (sorted keys, 2-space indent) inside an unbreakable fence.
3. **Response contract** — same treatment for `response_contract`.
4. **Protocol metadata** — `protocol_metadata_json` for SOAP endpoints (soap_action,
   namespaces, root elements, DTO classes, wsdl_source).
5. **Data effects** — per endpoint: access_mode, transactional flag, hop path
   (controller→service→repository method ids), and `query_text` VERBATIM inside a fence
   with `query_kind` labelled. Unresolved-persistence findings for the endpoint are
   included with their captured SQL.
6. **Behaviour blocks** — the `behavior` JSONB of every business_logic on the endpoints'
   data-effect paths (7-part blocks, canonical serialization, fenced).
7. **Captured examples** — up to `MIGRATION_SPEC_CAPTURE_EXAMPLES_PER_ENDPOINT` (default 3)
   accepted baseline items per endpoint from the ACTIVE current baseline, selected
   deterministically (canonical happy-path first, then highest-status-diversity):
   request method/path/query/headers/body + response status/headers/body, exactly as
   persisted (already redacted at capture time). Fenced.
8. **Findings** — attached findings (title, severity, detail) verbatim.
9. **Parity obligation** — a stamped closing section: the target must reproduce these
   responses byte-equivalently for these requests; verification per Spec I.

Fence discipline: longest backtick run in embedded content + 1, minimum 4 (Spec C idiom).
Canonical JSON serialization is asserted round-trip-equal to the source in tests (content
fidelity; no paraphrase, no truncation of any JSON fact).

### 3. Size guardrails & degradation ladder (nothing silent)

- Per-spec character budget `MIGRATION_SPEC_TEXT_MAX_CHARS` (default 300_000, Spec C parity).
- Deterministic drop order when over budget: (a) reduce capture examples per endpoint
  3→2→1, (b) drop behaviour blocks of non-transactional pure-read paths, (c) NEVER drop
  contracts, data-effect SQL, or protocol metadata. Any drop → status
  `generated_with_warnings` + an explicit "omitted for size" manifest inside the spec.
- Missing critical facts → `insufficient_context` with a precise reason (existing detector
  extended): no committed contracts on ANY endpoint of the story; no active baseline item
  for ANY endpoint when the story is unflagged (flagged `missing_baseline` stories instead
  carry the flag explanation and proceed — their purpose IS to fix that).

### 4. New AMS focused reads (shared with Spec F)

Gateway needs efficient reads (full-model load is too heavy per story):

- `GET /api/model/projects/{p}/architectures/{a}/endpoints?ids=...` → EndpointDto list
  including the three JSONB blobs (snake_case, no annotation needed).
- `GET /api/model/projects/{p}/architectures/{a}/endpoint-data-effects?endpoint_ids=...`
  → EndpointDataEffectDto list. (Controller is NEW — repository exists. Spec F extends the
  same controller with reverse queries; build once, extend there.)
- `GET .../business-logics?ids=...` (or by method-id containment) for behaviour blocks.
- Baseline items by endpoint: reuse/extend the existing gateway `apiBehaviourClient`
  read path for `baseline_items` filtered to operation/endpoint (verify exact existing
  route at build time; add a filtered variant if only whole-baseline reads exist).

## Non-goals

- Changing what discovery captures (L/M enrich inputs later; carriage renders whatever is
  present). Parity execution (I). DB stories (Spec C remains authoritative).

## Acceptance criteria

1. **VERBATIM PIN:** for a story with 2 endpoints, generated text contains the canonical
   serialization of both contracts + all data-effect SQL + behaviour blocks; parsing the
   fenced JSON back yields deep-equal objects vs the AMS fixtures.
2. **FENCE PIN:** embedded content containing ```` ```` sequences renders with a longer
   fence; spec text round-trips through a markdown fence parser without truncation.
3. **EXAMPLES PIN:** 5 accepted baseline items for an endpoint → exactly 3 embedded,
   deterministic selection order stable across runs.
4. **BUDGET PIN:** oversized story degrades per the ladder, emits
   `generated_with_warnings` + omission manifest; contracts/SQL never dropped.
5. **NO-LLM PIN:** cluster-story carriage path never invokes the LLM (throwing-LLM mock).
6. **INSUFFICIENT PIN:** story whose endpoints have no contracts →
   `insufficient_context` with reason `no_committed_contracts`.
7. Flagged-story path: LLM prose + appended deterministic fact section, facts byte-equal.

## Test plan

`migrationCodeSpecCarriage.test.ts` (pins 1–6), handler wiring test (carriage precedes
generic path; DB carriage untouched), AMS controller tests for the new focused reads
(snake_case wire asserted), flagged-story hybrid test. Baseline discipline as per program.

## Dependencies & sizing

Depends on: Spec G (tags/extras). Shares the AMS data-effects controller with Spec F.
Size: **M**. Build second (with/after G), parallel to L.

---

## Amendment 2026-07-06 — capture-scan review (gap analysis §9)

The captured baseline is a primary spec INPUT, not garnish. Two changes:

- **§2.7 revised — full canonical scenario set:** instead of a fixed
  `MIGRATION_SPEC_CAPTURE_EXAMPLES_PER_ENDPOINT = 3`, embed the endpoint's CANONICAL
  scenario set — one captured example per achieved coverage-rubric dimension (happy path,
  each declared error status, auth variants, validation errors, pagination/content-type
  when scored; typically 3–8 per endpoint). Selection stays deterministic (the canonical
  capture per dimension, per `selectCanonicalCapture` semantics). The budget ladder (§3)
  trims pagination/content-type extras first and never drops below happy + declared error
  statuses; every trim remains visible in the omission manifest.
- **§2 new item 7b — expected state deltas (Spec N):** for mutating endpoints, embed the
  captured `state_delta_json` verbatim (fenced) alongside each mutating example — the
  implementer sees exactly which tables and rows a write must produce, and the parity
  obligation section (§2.9) states both proofs: byte-equivalent response AND matching
  state delta. When Spec N is not yet built/backfilled, the section renders
  `state delta: not captured` explicitly (nothing silent).
- **Acceptance criterion 3 (EXAMPLES PIN) superseded:** an endpoint with 5 achieved rubric
  dimensions embeds 5 canonical examples; trimming under budget removes the pagination
  dimension first and records it in the manifest. New **DELTA PIN:** a mutating endpoint
  with a captured state delta embeds it byte-equal; one without renders the explicit
  not-captured marker.
