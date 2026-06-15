# Specification: SOAP LLM Extraction and Payload Enrichment (Phase 2)

## Goal
Close the two gaps Phase 1 deferred: (A) when the deterministic Spring Classic SOAP scanner emits zero endpoint candidates, give the user an explicit "Extract endpoints with LLM" action in Step 4 that produces candidates of the same shape via an LLM tool reading cached repo source; (B) give the capture-loop LLM a per-operation payload-context tool so it can build syntactically-valid SOAP envelopes from WSDL message metadata plus JAXB DTO source instead of guessing payload shapes.

## User Stories
- As an architect whose SOAP service has neither `@Endpoint`, `@WebService`, nor `.wsdl` artefacts, I want to click "Extract endpoints with LLM" on an empty Step 4 and have the LLM propose endpoint candidates from the cached source files so Step 4 stops being empty and I can review + save back like any other candidate.
- As a migration engineer running the capture loop, I want the capture LLM to fetch WSDL message types plus JAXB DTO class source for the operation it is currently working on so the SOAP request body it generates parses against the target's WSDL schema instead of being a placeholder shell.
- As a reviewer, I want every endpoint candidate to display whether it came from the deterministic framework scanner or from LLM extraction so I can calibrate how much scrutiny to apply.

## Specific Requirements

**Shared infrastructure — discovery-service source-file endpoint (W-2, W-12, W-13, W-17)**
- New route `GET /discovery/runs/{id}/source/{path}` registered alongside the existing files in `discovery-service/src/routes/`.
- `path` is repo-relative (e.g. `src/main/java/com/foo/Bar.java`); the server resolves it against the cached clone root for run `{id}` internally — callers never see the clone root.
- Reuses discovery-service's existing auth posture (same headers/middleware as `runs.ts` and siblings); no new auth surface introduced.
- Rejects path traversal (`..`, absolute paths, symlinks escaping the clone root) with `400 Bad Request`.
- When the cached clone has been garbage-collected, returns a structured `410 Gone` payload `{ error: 'clone_evicted', runId, message }` so AMVS can translate it into the workstream-specific user-facing fallback.
- No fresh git clone is ever triggered by this endpoint — it serves only what discovery-service already has on disk.

**Shared infrastructure — token-budget configuration (W-7)**
- New env-var-backed config block read once at AMVS startup:
  - `AMVS_LLM_EXTRACT_INPUT_TOKENS_PER_CALL` (default 20000), `AMVS_LLM_EXTRACT_INPUT_TOKENS_PER_SESSION` (default 100000).
  - `AMVS_LLM_PAYLOAD_INPUT_TOKENS_PER_CALL` (default 8000), `AMVS_LLM_PAYLOAD_INPUT_TOKENS_PER_SESSION` (default 50000).
- Shared per-call enforcement helper truncates input at the cap (never hard-fails) and writes a structured `truncated: true, dropped_bytes: N` marker into the LLM-facing response so the model knows context is incomplete.
- Per-session counter is keyed by capture-session id (Workstream B) and by Step 4 review session id (Workstream A); counters reset on session close.

**Shared infrastructure — `discovery_method` trace metadata (W-10)**
- Every endpoint candidate emitted by either workstream sets a new `data.discovery_method` field with value `'framework_scanner'` (Phase 1 emitter) or `'llm_extraction'` (Workstream A emitter).
- Field rides inside the existing `protocol_metadata_json` JSONB blob added in Phase 1 — no AMS schema change.
- AMS endpoint DTO is extended with a `discoveryMethod` getter that reads the JSONB blob; round-trips through the save-back path unchanged.
- Frontend candidate-review UI renders a small "discovered-via" chip next to every endpoint candidate, sourced from `discovery_method`. Chip text: "Framework scan" or "LLM extracted".

**Workstream A — `propose_endpoints_from_code` LLM tool (W-3, W-4, W-8, W-15)**
- New tool file `api-migration-validation-service/src/services/tools/propose_endpoints_from_code.ts`, registered in the AMVS tool registry alongside `list_oas_operations.ts`.
- Inputs: parent interface candidate id, parent service name, and a curated set of candidate Java source file paths (controllers / dispatchers / hand-rolled servlets) fetched from discovery-service via the new source endpoint.
- Output schema (strict): `[{ operationName, soapAction?, path?, requestRootElement?, responseRootElement?, requestDtoClass?, responseDtoClass?, confidence: number }]`.
- Each output entry is converted to an endpoint candidate matching the Phase 1 shape: parent interface candidate `interface_type='SOAP_API'`, child endpoint candidates with the seven `data` fields (`soap_action`, `request_root_element`, `request_namespace`, `response_root_element`, `request_dto_class`, `response_dto_class`, `wsdl_source`) plus the new `discovery_method='llm_extraction'` field.
- Persistence routes through the existing `bulkSaveCandidates` flow so candidates flow through AMS → user review → save-back identically to Phase 1.
- Confidence-tier handling (configured constants, not user-tunable): `<0.4` drop silently; `0.4–0.7` surface with a "low confidence" chip on the candidate review UI; `≥0.7` default-accepted-pending-review.
- Synchronous execution within Step 4 with a 60-second client-side timeout; on timeout, show "Still working — refresh in a minute" and let the result land when the user reopens Step 4.

**Workstream A — Step 4 "Extract endpoints with LLM" trigger UI (W-3)**
- Empty-state messaging in Step 4 when the candidate list is empty: "No endpoints detected. Try LLM extraction?" with an "Extract endpoints with LLM" button.
- Button click invokes `propose_endpoints_from_code` synchronously with a visible progress indicator (spinner + "Analysing source files…").
- No auto-fire on Step 4 entry — user must click. Avoids surprise token spend.
- On successful return, Step 4 re-renders pre-populated rows from the newly-saved candidates without a full page reload.
- On the 410-Gone "clone evicted" path, surface "Source no longer cached — re-run discovery" toast in Step 4 and disable the button until a new run completes.

**Workstream A — Malformed LLM output handling (W-9)**
- On schema-validation failure of the LLM response, retry once with a follow-up prompt that includes the schema and the phrase "your previous response was malformed".
- On second failure: log a structured `[diag-amvs] llm_endpoint_extract result=malformed retries=2` line, emit zero candidates, emit one `evidence_gap` finding with new `gapType='llm_endpoint_extract_malformed'`, and surface a Step 4 toast "LLM extraction failed — review manually".
- Never cascade-fail the discovery run; never re-raise.
- New `gapType` sentinel `'llm_endpoint_extract_malformed'` MUST be registered wherever `gapType` strings are centralised and asserted by tests.

**Workstream A — Diagnostic logging**
- Every emit path produces `[diag-amvs] llm_endpoint_extract ...` lines:
  - Start: `[diag-amvs] llm_endpoint_extract start interface=<id> files=<N>`
  - Result: `[diag-amvs] llm_endpoint_extract result=ok operations=<N> dropped_low_confidence=<N> truncated=<bool>`
  - Retry: `[diag-amvs] llm_endpoint_extract retry=1 reason=<schema_violation|...>`
  - Fail: `[diag-amvs] llm_endpoint_extract result=malformed retries=2`

**Workstream B — `get_operation_payload_context` LLM tool (W-5, W-6, W-14)**
- New tool file `api-migration-validation-service/src/services/tools/get_operation_payload_context.ts`, registered as a sibling of `list_oas_operations.ts` (NOT an extension of it — `list_oas_operations` stays cheap and listing-only).
- Input: `{ operationId: string, depth?: 1 | 2 }`; default `depth=1`, max `depth=2`.
- Returns an inline single response (no pagination, no continuation token in v1):
  - WSDL message metadata pulled from the operation's `protocol_metadata_json`: `request_root_element`, `request_namespace`, `response_root_element`.
  - `request_dto_class` and `response_dto_class` FQNs.
  - JAXB DTO source code for each FQN, resolved by mapping the FQN to a repo-relative path and fetching from the discovery-service source endpoint.
  - At `depth=2`, also resolves and inlines source for non-primitive field types referenced by the request/response DTOs.
  - Optional sibling-operation sample payload when one is available in the same service.
- Per-file 8 KB byte cap; truncated files end with `// ...truncated, N more bytes` marker.
- DTO source unavailable (FQN unresolvable OR 410-Gone clone evicted) → graceful single-string fallback `"DTO source unavailable"` for that field; the rest of the response is still returned so the LLM falls back to WSDL-types-only payload construction.
- Token-cap helper from the shared infrastructure section applies per-call (8 K) and per-session (50 K).

**Workstream B — Smoke-test target pinning (W-16)**
- Smoke-test target pinned: **NumberConversion SOAP service at `https://www.dataaccess.com/webservicesserver/NumberConversion.wso?WSDL`** (DataAccess Worldwide). Chosen because it is stable, has a tiny well-formed WSDL (two operations: `NumberToWords`, `NumberToDollars`), uses document/literal style, has no auth or CORS friction, and is widely used as a SOAP teaching example.
- Acceptance for Workstream B: the capture-loop LLM, given `get_operation_payload_context` output for `NumberToWords`, produces a SOAP envelope that parses against the live WSDL schema (validation via the same `fast-xml-parser` + XSD walk added in Phase 1). Acceptance is NOT "produces a 200 response" — schema parsing is sufficient.
- If the target becomes unreachable from CI, the test falls back to a checked-in copy of the WSDL captured at spec-build time, stored under `planning/visuals/numberconversion.wsdl`.

**Tests (enumerated as concrete test cases)**
- *Workstream A — extraction tool prompt build*: unit test asserts the prompt to the LLM contains the parent interface name, parent service name, and the truncated source-file contents, in the documented order.
- *Workstream A — happy path (mocked LLM)*: with a stubbed LLM returning two operations at confidence 0.85, both land as endpoint candidates via `bulkSaveCandidates` with `discovery_method='llm_extraction'`.
- *Workstream A — malformed-output retry path*: stubbed LLM returns invalid JSON on first call, valid JSON on retry; one candidate lands; one `[diag-amvs] llm_endpoint_extract retry=1` log line emitted.
- *Workstream A — malformed twice*: stubbed LLM returns invalid JSON twice; zero candidates emitted; one `evidence_gap` with `gapType='llm_endpoint_extract_malformed'` emitted; Step 4 toast surfaced.
- *Workstream A — confidence-tier filtering*: stubbed LLM returns three operations at confidences 0.2, 0.55, 0.9; only the latter two are persisted; the 0.55 candidate carries a "low confidence" UI marker; the 0.2 is dropped silently.
- *Workstream A — token-cap truncation*: input source set exceeds 20K-token cap; prompt is truncated; LLM-facing response includes the truncation marker; one warning log line.
- *Workstream A — fixture set end-to-end*: in-tree fixture set under `planning/visuals/fixture-hand-rolled-soap-servlet/` (a hand-rolled SOAP servlet WITHOUT annotations or WSDL) produces ≥1 LLM-extracted endpoint candidate when run through the real prompt-build path against a mocked LLM.
- *Workstream B — WSDL metadata round-trip*: tool called with an operationId whose `protocol_metadata_json` contains the seven Phase 1 fields returns all three WSDL message fields verbatim.
- *Workstream B — DTO source resolution depth-1*: tool with `depth=1` resolves the request DTO FQN, fetches its source via the discovery-service source endpoint, and inlines it in the response.
- *Workstream B — DTO source resolution depth-2*: tool with `depth=2` resolves transitive field-type DTOs as well.
- *Workstream B — byte-cap truncation*: DTO source exceeds 8 KB; response contains the truncated content followed by `// ...truncated, N more bytes`.
- *Workstream B — missing DTO graceful fallback*: FQN unresolvable; response returns `"DTO source unavailable"` for that field; other fields still populated.
- *Workstream B — 410-Gone graceful fallback*: discovery-service source endpoint returns 410; tool returns `"DTO source unavailable"` and the LLM-facing response includes a structured note.
- *Cross-cutting — discovery-service source endpoint happy path*: `GET /discovery/runs/{id}/source/src/main/java/Foo.java` returns file contents.
- *Cross-cutting — 410-Gone when clone GC'd*: endpoint returns `410 Gone` with `{ error: 'clone_evicted' }`.
- *Cross-cutting — path traversal rejection*: requests for `../etc/passwd`, absolute paths, and symlinks escaping the clone root all return `400 Bad Request`.
- *Cross-cutting — `discovery_method` round-trip*: Phase 1 candidate emitted with `discovery_method='framework_scanner'` and Workstream A candidate with `discovery_method='llm_extraction'` both round-trip through AMS save-back and read-back unchanged; frontend chip renders correctly for both.
- *Workstream B acceptance — NumberConversion smoke test*: with `get_operation_payload_context` output for `NumberToWords`, the LLM-built SOAP envelope parses against the NumberConversion WSDL schema.

## Visual Design
No mockups supplied. Three small UI surfaces described textually:

**Step 4 empty-state (Workstream A)**
- Empty list shows centred text "No endpoints detected. Try LLM extraction?" with a primary button "Extract endpoints with LLM" beneath.
- Button disabled state on cached-clone evicted: button shown but disabled, with secondary text "Source no longer cached — re-run discovery".

**Candidate-review chips (cross-cutting)**
- "Discovered-via" chip beside each endpoint candidate's display name; two values — "Framework scan" (neutral colour) or "LLM extracted" (subtle accent).
- "Low confidence" chip on candidates in the 0.4–0.7 tier; same size as discovered-via chip, warning colour.
- Chips reuse the existing candidate-review chip pattern wherever one exists in the frontend codebase.

**Step 4 LLM-extraction progress + toast**
- During the synchronous call: spinner inline beside the button with text "Analysing source files…".
- On 60-second timeout: button reverts and a toast says "Still working — refresh in a minute".
- On malformed-output double-fail: toast "LLM extraction failed — review manually".

## Existing Code to Leverage

**`discovery-service/src/routes/runs.ts` and siblings (`packs.ts`, `phase0.ts`, `phase1.ts`)**
- Structural template for the new `GET /discovery/runs/{id}/source/{path}` route — same Express router registration, same error envelope, same auth posture.
- Reuses the in-process run-id → clone-path resolution already used by `phase1.ts` and `preflightLibraryScan.ts`.

**`discovery-service/src/services/runManager.ts` and `preflightCachedClone.ts`**
- Owns the cached-clone lifecycle (creation, on-disk location, GC eligibility).
- The new source endpoint reads run state from here to (a) resolve the clone root, (b) detect the GC'd-evicted state for the 410 response.

**`api-migration-validation-service/src/services/tools/list_oas_operations.ts` and `get_oas_operation_detail.ts`**
- Tool-registration pattern for the two new tools — same module shape, same `toolTypes.ts` integration, same input/output schema declaration style.
- `get_oas_operation_detail.ts` in particular is the closest analogue to `get_operation_payload_context` (operation-id-keyed lookup, inline response).

**`mcp-server/src/services/candidateSaveBackService.ts` — `case 'endpoints'`**
- Existing save-back arm carries the new `discovery_method` field through into `protocol_metadata_json` without further routing; spec adds no new arm.

**Phase 1 `springClassicSoap/soapEndpointEmitter.ts` (from spec `2026-05-17-soap-discovery-spring-classic-phase-1`)**
- Source of truth for the seven SOAP `data` field shapes; Workstream A's emit step assembles candidates against the same field list plus the new `discovery_method` field.

## Out of Scope
- Source-code MODIFICATION — Phase 1 and Phase 2 both READ code only.
- Recording or replay of live SOAP traffic — capture loop already covers that.
- WSDL generation from existing services (reverse direction) — not the migration-validation use case.
- Multi-call SOAP scenarios — covered by existing AMVS scenario candidate framework.
- Promotion of `discovery_method` (or any other Phase 2 field) from `protocol_metadata_json` JSONB into explicit AMS columns — deferred to a future spec.
- Auto-firing LLM extraction on Step 4 entry — explicit button only.
- A separate LLM provider/model for these tools — reuses AMVS's existing LLM config.
- Pagination / continuation tokens for `get_operation_payload_context` — inline-only in v1.
- User-tunable confidence thresholds — fixed constants in v1.
- Auto-reclone when the cached clone has been GC'd — surfaces a 410 + "re-run discovery" message instead.
