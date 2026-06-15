# Raw idea — Phase 2: LLM endpoint extraction + capture-loop payload enrichment

## Why this spec exists

Phase 1 (`agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/`)
shipped deterministic SOAP endpoint discovery in the discovery-service. The
Spring Classic scanner now emits endpoint candidates from three signals
(Spring-WS `@Endpoint` + `@PayloadRoot`, JAX-WS `@WebService` +
`@WebMethod`, and `.wsdl` files), persists SOAP metadata to the AMS
`endpoints` table's new `protocol_metadata_json` JSONB column, and the
api-migration-validation-service (AMVS) wizard's Step 4 pre-populates
from those rows.

Phase 2 closes the two gaps Phase 1 explicitly deferred:

1. SOAP services where the code scan produced ZERO endpoint candidates
   — no `@Endpoint`, no `@WebService`, no `.wsdl`. The user's reference
   SOAP service that motivated this whole programme is one such case:
   Phase 1 ships, the code scan still emits zero endpoints, and Step 4
   stays empty.

2. The capture-loop LLM has only operation name + method signature
   when generating SOAP envelope payloads. Phase 1 captured WSDL message
   types + JAXB DTO class FQNs into `protocol_metadata_json` but did
   not surface that metadata to the LLM tool registry. The LLM is left
   guessing payload shapes.

## Workstream A — LLM endpoint extraction (zero-candidate fallback)

When an interface has zero endpoint candidates after the Phase 1
deterministic pass, AMVS invokes an LLM-driven extraction tool to
identify operations from cached source files.

### Tool surface

- New AMVS LLM tool / route `propose_endpoints_from_code`.
- Inputs: the interface candidate's name + parent service, plus a
  code-snippet set sourced from the discovery-service's cached repo
  clone (which already exists per the discovery-service repo-access
  infrastructure). The tool MUST NOT trigger a fresh git clone — it
  reuses what discovery-service has on disk.
- LLM prompt scope: identify SOAP operations from controller / endpoint
  / dispatcher source files. Output schema:
  `[{ operationName, soapAction?, path?, requestRootElement?,
      responseRootElement?, requestDtoClass?, responseDtoClass?,
      confidence }]`.
- Output persistence: convert each entry into an endpoint candidate of
  the same shape Phase 1 emits (parent interface candidate with
  `interface_type='SOAP_API'`, child endpoints with the seven `data`
  fields), routed through `bulkSaveCandidates` so they reach AMS via
  the existing path. AMVS Step 4 pre-population (Phase 1 Group 11)
  renders them uniformly.

### Open design points (surfaced as clarifying questions in the shaping pass)

- W-3 UX trigger (auto-fire / explicit button / both)
- W-4 Persistence shape (full candidate path vs shortcut to operations table)
- W-7 Token budgeting (per-call cap, per-session cap)
- W-8 Confidence floor (drop-silently threshold)
- W-9 Malformed-LLM-output graceful fallback

## Workstream B — Capture-loop payload metadata enrichment

The capture-loop LLM gets a new tool that returns rich per-operation
payload context regardless of REST / SOAP source.

### Tool surface

- New tool `get_operation_payload_context(operationId)` (W-5 lean —
  open question) that returns:
  - WSDL message types from `protocol_metadata_json.request_root_element`
    / `request_namespace` / `response_root_element`
  - `request_dto_class` / `response_dto_class` FQNs
  - The actual JAXB DTO class source code resolved from FQN against
    the discovery-service's cached clone (depth-1 default; truncated
    at a configured byte cap per W-6)
  - Optionally: a sample payload from a sibling operation in the same
    service when available
- Existing `list_oas_operations` stays narrow (listing only); the new
  tool is the per-op detail resolver. Reusable for REST payload
  enrichment in future.
- The LLM constructs the SOAP envelope from this context. NO changes
  to the HTTP execution path — it is already SOAP-friendly (HTTP POST
  with an XML body).

### Open design points

- W-5 Tool design (extend list_oas_operations vs new sibling tool)
- W-6 DTO source resolution depth + truncation
- W-7 Token budgeting (per-call cap, per-session cap)

## Cross-cutting design point

- W-2 **Repo-clone access from AMVS** (used by BOTH workstreams):
  AMVS currently has no direct access to the discovery-service's
  cached clone. Options:
  - (a) discovery-service exposes a new HTTP endpoint AMVS calls
    (`GET /discovery/runs/{id}/source/{path}`)
  - (b) AMVS clones the repo itself (duplicates discovery's work)
  - (c) discovery-service persists code snippets to AMS at run
    completion as a new entity type
  Recommended default: (a). Smallest infra change, discovery-service
  already owns the clone, permission boundary is "AMVS only reads
  paths under the interface's parent service".

## Cross-cutting trace metadata

- W-10 **`data.discovery_method` field** on endpoint candidates:
  `'framework_scanner' | 'llm_extraction'`. Surfaces in the candidate
  review UI as a "discovered-via" chip so reviewers can calibrate
  trust. Cheap to add at the candidate-emit layer.

## Workstream-split design point

- W-1 **One spec or two?** Workstream A unblocks the user's reference
  service (the empty Step 4 case). Workstream B improves an already-
  working flow. Splitting into two sequential specs would let A ship
  faster. But A and B share infrastructure (W-2 repo-clone access,
  W-7 token caps, W-10 trace metadata), and writing one consolidated
  spec keeps that shared design in one place. My lean: ONE spec; the
  task list inside the spec can stage A first then B.

## Out of scope

- Source-code modifications (Phase 1 + Phase 2 both READ code; neither
  writes)
- Recording / replay of live SOAP traffic — capture loop already
  covers that path conceptually
- WSDL generation from existing services (reverse direction) — not
  the migration-validation use case
- Multi-call SOAP scenarios — same scenario surface AMVS already
  supports via its scenario candidate framework

## Acceptance signal

- **Workstream A**: the user's reference SOAP service (the one Phase 1
  couldn't extract anything from) produces non-zero LLM-extracted
  endpoint candidates after this spec lands. Step 4 pre-populates from
  them. The user can review + save back.

- **Workstream B**: the capture loop's LLM, when generating a SOAP
  envelope for either a `propose_endpoints_from_code`-derived OR a
  Phase-1-deterministic-extracted operation, has access to the WSDL
  message types via `protocol_metadata_json` AND the JAXB DTO class
  source on demand. Smoke-test signal: an end-to-end capture against a
  public SOAP service produces a syntactically-valid SOAP request body
  (not a placeholder shell).
