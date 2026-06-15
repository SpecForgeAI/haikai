# Task Breakdown: SOAP LLM Extraction and Payload Enrichment (Phase 2)

## Overview
Total Task Groups: 12
Total Tasks: ~70 (across 12 groups)

This spec closes the two gaps Phase 1 deferred:
- **Workstream A** — LLM endpoint extraction for SOAP services where the deterministic scanner emitted zero candidates.
- **Workstream B** — Capture-loop payload enrichment so the LLM can build syntactically-valid SOAP envelopes from WSDL message metadata plus JAXB DTO source.

The 12 task groups are staged per W-1: **Foundation first, then Workstream A in full, then Workstream B, then E2E, then docs**. This sequencing unblocks the user's reference SOAP service (empty Step 4 case) before improving the already-working capture loop.

## Standing Constraints (apply to every group)

- Per `feedback_liquibase_immutable_changesets.md`: never edit applied Liquibase changesets. No AMS schema change is in scope for this spec — `discovery_method` rides inside the existing `protocol_metadata_json` JSONB blob from Phase 1.
- Per `feedback_no_src_edits_during_run.md`: no edits to `discovery-service/src/**` while a discovery run is active.
- Per `project_primitive_double_dto_overwrite.md`: any DTO field participating in PATCH semantics MUST be boxed with null guards.
- Reuse AMVS's existing LLM config (W-11) — no new provider/model surface.
- Repo-relative path semantics for the new source endpoint (W-12); clone root is never exposed to callers.
- All new structured AMVS log lines use the prefix `[diag-amvs] ...`.
- Token caps TRUNCATE-with-warning (never hard-fail) and surface a truncation marker into the LLM-facing response (W-7).
- Phase 1's `bulkSaveCandidates` flow + `protocol_metadata_json` write path is the **structural template** for Workstream A candidate persistence (W-4).
- `list_oas_operations.ts` and `get_oas_operation_detail.ts` are the **structural template** for the two new AMVS tool registrations.
- No standalone `.md` documentation files — all docs live as inline TSDoc/JSDoc headers.

---

## Task List

### Foundation Layer (cross-cutting; must land before Workstream A or B)

#### Task Group 1: discovery-service Source-File Endpoint
**Dependencies:** None

- [x] 1.0 Implement `GET /discovery/runs/{id}/source/{path}` on discovery-service
  - [x] 1.1 Write 4-6 focused tests for the new route
    - Test file: `discovery-service/src/__tests__/runsSourceEndpoint.test.ts`
    - Test 1 (happy path): `GET /discovery/runs/{id}/source/src/main/java/com/foo/Bar.java` returns the file contents with `200 OK` and `Content-Type: text/plain; charset=utf-8`
    - Test 2 (path traversal — `..`): `GET /discovery/runs/{id}/source/../../etc/passwd` returns `400 Bad Request` with `{ error: 'path_traversal_rejected' }`
    - Test 3 (path traversal — absolute path): a request for an absolute path (e.g. `/etc/passwd`, `C:\\Windows\\...`) returns `400 Bad Request`
    - Test 4 (path traversal — symlink escape): a path resolving via symlink outside the clone root returns `400 Bad Request`
    - Test 5 (cache GC fallback): when the cached clone for the run has been garbage-collected, the endpoint returns `410 Gone` with structured payload `{ error: 'clone_evicted', runId, message }` (W-17)
    - Test 6 (auth posture): the route is registered behind the same middleware as `runs.ts` siblings — no new auth surface; assert the middleware chain matches an existing route's posture (W-13)
  - [x] 1.2 Create `discovery-service/src/routes/source.ts` (or add to existing route file — match the file-organisation convention of `runs.ts`, `packs.ts`, `phase0.ts`, `phase1.ts`)
    - Register the route in `discovery-service/src/routes/index.ts` alongside the existing run-scoped routes
    - Reuse the in-process run-id → clone-path resolution already used by `phase1.ts` and `preflightLibraryScan.ts` (via `runManager.ts` / `preflightCachedClone.ts`)
    - Validate `path` parameter:
      - Reject if it contains `..` segments
      - Reject if it is absolute (`/...` or `<drive>:\\...`)
      - Resolve to canonical absolute path and reject if the resolved path does NOT start with the canonical clone root (catches symlink escapes)
    - Detect GC'd-evicted state by checking `runManager` state; return structured `410 Gone` body
    - Match the existing error envelope shape used elsewhere in discovery-service
    - No fresh git clone is ever triggered by this route — it serves only what is already on disk
  - [x] 1.3 Structured log emission
    - Success: `[diag-discovery] source_endpoint result=ok runId=<id> path=<rel> bytes=<N>`
    - Reject (path traversal): `[diag-discovery] source_endpoint result=rejected runId=<id> reason=path_traversal path=<raw>`
    - GC fallback: `[diag-discovery] source_endpoint result=clone_evicted runId=<id>`
  - [x] 1.4 Run ONLY the 4-6 tests from 1.1
    - Do NOT run the full discovery-service test suite

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Path traversal (relative `..`, absolute paths, symlink escapes) is rejected with `400`
- Cache-GC'd runs return structured `410 Gone`
- Auth posture matches existing run-scoped routes (no new auth surface)
- No fresh git clone is ever triggered by this route

---

#### Task Group 2: AMVS Env Vars + Token-Cap Helper
**Dependencies:** None (can run in parallel with Group 1)

- [x] 2.0 Wire env-driven token caps and per-call enforcement helper
  - [x] 2.1 Write 3-5 focused tests for the helper
    - Test file: `api-migration-validation-service/src/__tests__/tokenCapHelper.test.ts`
    - Test 1: helper reads `AMVS_LLM_EXTRACT_INPUT_TOKENS_PER_CALL` from env at startup; defaults to `20000` when unset
    - Test 2: helper reads `AMVS_LLM_PAYLOAD_INPUT_TOKENS_PER_CALL` from env; defaults to `8000` when unset
    - Test 3 (per-call truncation): input exceeding the per-call cap returns `{ truncated: true, dropped_bytes: N, content: <truncated> }` — NEVER throws
    - Test 4 (per-session counter): two successive calls within the same session id accumulate against the session cap; on overflow, the helper returns `{ truncated: true, session_cap_hit: true, ... }`
    - Test 5 (session reset): counter resets when the session is closed / a new session id is observed
  - [x] 2.2 Create `api-migration-validation-service/src/services/llm/tokenCapHelper.ts`
    - Public shape: `enforceTokenCap(input: string, opts: { sessionId: string; capPerCall: number; capPerSession: number }): { content: string; truncated: boolean; dropped_bytes: number; session_cap_hit?: boolean }`
    - Per-call enforcement: truncate input at the cap, NOT hard-fail; write the truncation marker `// ...truncated, N more bytes` (Workstream B style) or a structured `truncated: true, dropped_bytes: N` envelope (Workstream A style) — caller picks per-tool
    - Per-session counter keyed by capture-session id (Workstream B) and by Step 4 review session id (Workstream A); counters reset on session close
    - The two env vars for Workstream A:
      - `AMVS_LLM_EXTRACT_INPUT_TOKENS_PER_CALL` (default `20000`)
      - `AMVS_LLM_EXTRACT_INPUT_TOKENS_PER_SESSION` (default `100000`)
    - The two env vars for Workstream B:
      - `AMVS_LLM_PAYLOAD_INPUT_TOKENS_PER_CALL` (default `8000`)
      - `AMVS_LLM_PAYLOAD_INPUT_TOKENS_PER_SESSION` (default `50000`)
    - Read env vars once at AMVS startup (constants module pattern; mirror existing config plumbing)
  - [x] 2.3 Structured log emission
    - Truncation: `[diag-amvs] token_cap action=truncate scope=<call|session> tool=<name> dropped_bytes=<N>`
    - Session-cap hit: `[diag-amvs] token_cap action=session_cap_hit tool=<name> session=<id>`
  - [x] 2.4 Run ONLY the 3-5 tests from 2.1

**Acceptance Criteria:**
- The 3-5 tests written in 2.1 pass
- All four env vars are read at startup with correct defaults
- The helper truncates rather than throws on cap overflow
- Per-session counter resets correctly between sessions

---

#### Task Group 3: `discovery_method` Trace Metadata (backend + DTO + frontend chip)
**Dependencies:** None (can run in parallel with Groups 1 and 2)

- [x] 3.0 Add `data.discovery_method` to every endpoint candidate end-to-end
  - [x] 3.1 Write 3-5 focused tests
    - Test file (discovery-service emitter side): `discovery-service/src/__tests__/discoveryMethodFraming.test.ts`
    - Test 1: Phase 1's `soapEndpointEmitter.ts` emits every candidate with `data.discovery_method='framework_scanner'`
    - Test 2 (round-trip through AMS save-back): an `endpoints` candidate with `discovery_method='framework_scanner'` round-trips through `candidateSaveBackService.ts` → AMS → reload with the field intact inside `protocol_metadata_json`
    - Test 3 (round-trip with `'llm_extraction'`): same round-trip with `discovery_method='llm_extraction'`
    - Test file (frontend chip): `frontend/src/components/CandidateReview/__tests__/discoveredViaChip.test.tsx`
    - Test 4: an endpoint candidate with `data.discovery_method='framework_scanner'` renders a chip with text "Framework scan" (neutral colour)
    - Test 5: an endpoint candidate with `data.discovery_method='llm_extraction'` renders a chip with text "LLM extracted" (subtle accent)
  - [x] 3.2 Modify Phase 1's emitter `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/soapEndpointEmitter.ts`
    - In every emitted endpoint candidate's `data` object, set `discovery_method: 'framework_scanner'`
    - The field rides inside the existing `protocol_metadata_json` JSONB blob alongside the seven Phase 1 SOAP fields — no new AMS schema change, no new explicit column
  - [⚠️] 3.3 Extend AMS endpoint DTO read-side (Java)
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/EndpointDto.java` (verify exact path)
    - Add a `discoveryMethod` getter that reads the field out of the deserialised `protocolMetadataJson` blob — no new entity column, no new mapper rule
    - Boxed type (`String`), null-safe
    - PATCH semantics: omitted `discovery_method` does NOT wipe — null-guard per `project_primitive_double_dto_overwrite.md` (this is a JSONB sub-field, but the guard pattern still applies on any PATCH that touches `protocol_metadata_json`)
    - NOTE (verifier): No explicit `discoveryMethod` getter was added to `EndpointDto.java`. The `protocolMetadataJson` `Map<String, Object>` already round-trips the `discovery_method` key through AMS verbatim (verified by `candidateSaveBack.soap.test.ts` tests 4 + 5), so the runtime contract is honoured without the convenience getter. Adding the getter would be a non-breaking enhancement.
  - [x] 3.4 Add the "discovered-via" chip to the frontend candidate-review grid
    - File: `frontend/src/components/CandidateReview/` — locate the existing candidate row component (likely `CandidateRow.tsx` or sibling)
    - Render a small chip beside the endpoint candidate's display name
    - Chip text: `"Framework scan"` (neutral) or `"LLM extracted"` (subtle accent)
    - Reuse the existing candidate-review chip pattern wherever one exists; if none exists, copy the styling of the closest existing chip
    - Source the value from `data.discovery_method` on the candidate object
  - [x] 3.5 Run ONLY the 3-5 tests from 3.1

**Acceptance Criteria:**
- The 3-5 tests written in 3.1 pass
- Phase 1 candidates now carry `discovery_method='framework_scanner'` (back-compat preserved — field is additive inside JSONB)
- The frontend chip renders correctly for both values
- No AMS schema change was made

---

### Workstream A — LLM Endpoint Extraction

#### Task Group 4: New `evidence_gap` Sentinel `'llm_endpoint_extract_malformed'`
**Dependencies:** None (sentinel registration is independent; Group 5 consumes it)

- [x] 4.0 Register the new sentinel alongside Phase 1's sentinels
  - [x] 4.1 Write 1-2 focused tests
    - Test file: `discovery-service/src/__tests__/llmEndpointExtractMalformedSentinel.test.ts`
    - Test 1: the centralised `gapType` enum / constant table now includes `'llm_endpoint_extract_malformed'` alongside Phase 1's `'soap_endpoint_url_unknown'` and `'wsdl_parse_failed'`
    - Test 2 (optional): emitting an `evidence_gap` finding with `gapType='llm_endpoint_extract_malformed'` through the existing `FindingEmitter` passes validation
  - [x] 4.2 Add the sentinel to `discovery-service/src/services/findings/emissionSources.ts` (the file Phase 1 Group 7 modified)
    - Add `'llm_endpoint_extract_malformed'` to whichever union type / constant table the file uses for `gapType` values
    - Mirror the convention used by `'soap_endpoint_url_unknown'` and `'wsdl_parse_failed'`
  - [x] 4.3 Run ONLY the 1-2 tests from 4.1

**Acceptance Criteria:**
- The 1-2 tests written in 4.1 pass
- The new sentinel is registered in the central location next to the Phase 1 sentinels
- The existing `FindingEmitter` accepts the new value with no changes to its emit path

---

#### Task Group 5: AMVS `propose_endpoints_from_code` Tool
**Dependencies:** Task Groups 1, 2, 3, 4

- [x] 5.0 Implement the new AMVS LLM tool
  - [x] 5.1 Write 6-8 focused tests
    - Test file: `api-migration-validation-service/src/__tests__/proposeEndpointsFromCode.test.ts`
    - Test 1 (prompt construction): the prompt sent to the LLM contains the parent interface name, the parent service name, and the truncated source-file contents, in the documented order
    - Test 2 (happy path, mocked LLM): stubbed LLM returns two operations at confidence 0.85; both flow through to the endpoint candidate emit step
    - Test 3 (malformed-output retry path): stubbed LLM returns invalid JSON on first call, valid JSON on retry; one candidate lands; one `[diag-amvs] llm_endpoint_extract retry=1` log line emitted
    - Test 4 (malformed twice): stubbed LLM returns invalid JSON twice; zero candidates emitted; one `evidence_gap` finding with `gapType='llm_endpoint_extract_malformed'` emitted; result log line `[diag-amvs] llm_endpoint_extract result=malformed retries=2`
    - Test 5 (confidence-tier filtering): stubbed LLM returns three ops at confidences 0.2, 0.55, 0.9; only the latter two flow through to emit; the 0.55 one carries a `low_confidence=true` marker; the 0.2 one is dropped silently
    - Test 6 (token-cap truncation): input source set exceeds the 20K-token per-call cap; prompt is truncated; the LLM-facing payload includes the `truncated: true, dropped_bytes: N` marker; one `[diag-amvs] token_cap action=truncate` log line
    - Test 7 (LLM config reuse): the tool uses AMVS's existing LLM config (mock asserts the same config object as `list_oas_operations.ts` was invoked with) — no new provider/model surface (W-11)
    - Test 8 (410-Gone clone evicted): the source endpoint returns `410 Gone`; the tool surfaces the structured error to the caller (Group 6 translates it into UI messaging) — does NOT cascade-fail
  - [x] 5.2 Create `api-migration-validation-service/src/services/tools/propose_endpoints_from_code.ts`
    - Register in the AMVS tool registry alongside `list_oas_operations.ts`
    - Module shape mirrors `list_oas_operations.ts` and `get_oas_operation_detail.ts`
    - Inputs: `{ interfaceCandidateId: string, parentServiceName: string, sourceFilePaths: string[] }`
    - For each `sourceFilePaths` entry, fetch via `GET /discovery/runs/{runId}/source/{path}` (Group 1 endpoint)
    - Apply the token-cap helper (Group 2) using env vars `AMVS_LLM_EXTRACT_INPUT_TOKENS_PER_CALL` and `AMVS_LLM_EXTRACT_INPUT_TOKENS_PER_SESSION`
    - LLM output schema (strict — validate with the schema-validation library AMVS already uses):
      ```
      [{ operationName: string,
         soapAction?: string,
         path?: string,
         requestRootElement?: string,
         responseRootElement?: string,
         requestDtoClass?: string,
         responseDtoClass?: string,
         confidence: number }]
      ```
    - Confidence-tier handling (configured constants, NOT user-tunable — W-8):
      - `confidence < 0.4` → drop silently
      - `0.4 ≤ confidence < 0.7` → emit with `data.low_confidence=true` marker
      - `confidence ≥ 0.7` → emit as default-accepted-pending-review
    - Malformed-output retry loop (W-9):
      - First failure: retry once with follow-up prompt that includes the schema + the phrase "your previous response was malformed"
      - Second failure: log `[diag-amvs] llm_endpoint_extract result=malformed retries=2`, emit zero candidates, emit one `evidence_gap` finding with `gapType='llm_endpoint_extract_malformed'`
      - NEVER cascade-fail the discovery run; NEVER re-raise
    - Reuse AMVS's existing LLM config (W-11) — pull the same client used by `list_oas_operations.ts`
  - [x] 5.3 Structured log line emission (every emit path)
    - Start: `[diag-amvs] llm_endpoint_extract start interface=<id> files=<N>`
    - Success: `[diag-amvs] llm_endpoint_extract result=ok operations=<N> dropped_low_confidence=<N> truncated=<bool>`
    - Retry: `[diag-amvs] llm_endpoint_extract retry=1 reason=<schema_violation|...>`
    - Malformed-twice fail: `[diag-amvs] llm_endpoint_extract result=malformed retries=2`
    - Clone evicted: `[diag-amvs] llm_endpoint_extract result=clone_evicted runId=<id>`
  - [x] 5.4 Run ONLY the 6-8 tests from 5.1

**Acceptance Criteria:**
- The 6-8 tests written in 5.1 pass
- Tool is registered in the AMVS tool registry next to `list_oas_operations`
- Confidence tiers are honoured exactly per W-8
- Malformed-output retry + sentinel emission works per W-9
- Token caps are applied via the Group 2 helper
- Reuses AMVS's existing LLM config (no new provider/model)

---

#### Task Group 6: AMVS Step 4 Wizard Integration ("Extract endpoints with LLM" trigger UI)
**Dependencies:** Task Group 5

- [x] 6.0 Wire the explicit "Extract endpoints with LLM" button into Step 4
  - [x] 6.1 Write 4-6 focused frontend tests
    - Test file: `frontend/src/components/CaptureSession/__tests__/step4LlmExtractTrigger.test.tsx`
    - Test 1 (empty-state visibility): when Step 4's candidate list is empty AND the parent interface is `interface_type='SOAP_API'`, the empty-state shows centred text "No endpoints detected. Try LLM extraction?" with a primary button "Extract endpoints with LLM"
    - Test 2 (button invocation): clicking the button invokes `propose_endpoints_from_code` synchronously with a visible progress spinner + "Analysing source files…" text
    - Test 3 (success rerender): on successful return, Step 4 re-renders pre-populated rows from the newly-saved candidates without a full page reload
    - Test 4 (60-second client-side timeout): when the call exceeds 60 seconds, the button reverts and a toast surfaces "Still working — refresh in a minute" (W-15)
    - Test 5 (410-Gone disabled state): on the `clone_evicted` path from Group 1, the button renders disabled with secondary text "Source no longer cached — re-run discovery"; a toast says "Source no longer cached — re-run discovery"
    - Test 6 (malformed-twice toast): on `gapType='llm_endpoint_extract_malformed'` returning, a toast says "LLM extraction failed — review manually"
  - [x] 6.2 Modify Step 4 component
    - File: `frontend/src/components/CaptureSession/Step4.tsx` (verify exact path — match wherever Phase 1's Step 4 pre-population lands)
    - Add empty-state messaging + button (W-3)
    - NO auto-fire on Step 4 entry — explicit click only; avoids surprise token spend
    - Wire up the synchronous invocation with a 60-second `AbortController` timeout
    - On successful return, refresh the candidate list from the same source the Phase 1 pre-population pass reads (the candidates flow through `bulkSaveCandidates` → AMS → Step 4)
    - Surface the three toast cases (success implicit via row render; timeout; malformed-twice fail; clone-evicted)
  - [x] 6.3 Wire the AMVS-side route that the button invokes
    - File: `api-migration-validation-service/src/routes/captureSessionActions.ts` (Phase 1's Step 4 pre-population route)
    - Add a new action handler `extractEndpointsWithLlm` that:
      1. Fetches the curated source-file path list (controllers / dispatchers / hand-rolled servlets) — reuse Phase 1's pack-source-walk results where available
      2. Invokes `propose_endpoints_from_code` from Group 5
      3. Converts each LLM-output entry into endpoint candidates (Group 7 owns the conversion logic) and calls `bulkSaveCandidates`
      4. Returns the new candidate list to the frontend for rerender
    - On 410-Gone from the source endpoint: short-circuit and return `{ status: 'clone_evicted' }` to the frontend
  - [x] 6.4 Run ONLY the 4-6 tests from 6.1

**Acceptance Criteria:**
- The 4-6 tests written in 6.1 pass
- Button is visible only on the empty-state path; no auto-fire
- 60-second timeout surfaces the correct toast
- Clone-evicted path disables the button with secondary text
- Malformed-twice path surfaces the correct toast

---

#### Task Group 7: LLM-Extracted Candidate Emit + `discovery_method='llm_extraction'`
**Dependencies:** Task Groups 3, 5, 6

- [x] 7.0 Convert LLM output into Phase-1-shaped endpoint candidates and persist via `bulkSaveCandidates`
  - [x] 7.1 Write 3-5 focused tests
    - Test file: `api-migration-validation-service/src/__tests__/llmExtractedCandidateEmit.test.ts`
    - Test 1 (shape match): the converted candidate carries the same shape Phase 1 emits — parent interface candidate `interface_type='SOAP_API'`, child endpoint candidates with the seven `data` fields (`soap_action`, `request_root_element`, `request_namespace`, `response_root_element`, `request_dto_class`, `response_dto_class`, `wsdl_source`) plus `discovery_method='llm_extraction'`
    - Test 2 (operation_verb): every emitted endpoint candidate has `operation_verb='POST'` (Phase 1 D-3 convention)
    - Test 3 (low-confidence marker): a candidate from the 0.4–0.7 tier carries `data.low_confidence=true` in addition to `discovery_method='llm_extraction'`
    - Test 4 (round-trip through `bulkSaveCandidates`): the converted candidate flows through the existing Phase 1 save-back path with no new switch arms; AMS reload returns identical payload
    - Test 5 (back-compat): Phase 1's deterministic emit path still produces `discovery_method='framework_scanner'` unchanged (asserts Group 3's framing wiring is intact)
  - [x] 7.2 Implement the conversion + emit step inside `extractEndpointsWithLlm` handler (Group 6)
    - For each LLM-output operation:
      - Build an endpoint candidate matching the Phase 1 `DiscoveryCandidate` row shape for type `'endpoints'`
      - Set `interface_id` to the parent interface candidate
      - Set `operation_verb='POST'`
      - Populate `data.soap_action`, `data.request_root_element`, `data.response_root_element`, `data.request_dto_class`, `data.response_dto_class` from the LLM output (use `undefined` for missing optional fields, NOT `null`)
      - Set `data.wsdl_source=undefined` (LLM extraction has no WSDL source by construction)
      - Set `data.discovery_method='llm_extraction'`
      - Set `data.low_confidence=true` when the LLM-reported confidence is in the 0.4–0.7 tier
    - Build a parent interface candidate (or reuse the existing one when the caller passes its id) with `interface_type='SOAP_API'`
    - Call `bulkSaveCandidates` (Phase 1's save-back orchestrator) — NO new switch arm; the existing `'endpoints'` arm already carries `data` fields through into `protocol_metadata_json`
  - [x] 7.3 Structured log line on emit
    - `[diag-amvs] llm_endpoint_extract emit_complete interface=<id> persisted=<N> low_confidence=<N>`
  - [x] 7.4 Run ONLY the 3-5 tests from 7.1

**Acceptance Criteria:**
- The 3-5 tests written in 7.1 pass
- LLM-extracted candidates have the same shape as Phase 1 deterministic candidates plus `discovery_method='llm_extraction'`
- The candidate-side `data` field enumeration matches the AMVS Step 4 pre-population enumeration from Phase 1 Group 11 exactly
- Persistence routes through the unchanged `bulkSaveCandidates` flow

---

### Workstream B — Capture-Loop Payload Metadata Enrichment

#### Task Group 8: AMVS `get_operation_payload_context` Tool
**Dependencies:** Task Groups 1, 2

- [x] 8.0 Implement the new sibling tool that returns rich per-operation payload context
  - [x] 8.1 Write 6-8 focused tests
    - Test file: `api-migration-validation-service/src/__tests__/getOperationPayloadContext.test.ts`
    - Test 1 (WSDL metadata round-trip): tool called with an operationId whose `protocol_metadata_json` contains the seven Phase 1 fields returns all three WSDL message fields (`request_root_element`, `request_namespace`, `response_root_element`) verbatim
    - Test 2 (DTO source resolution depth-1): tool with `depth=1` resolves the request DTO FQN to a repo-relative path, fetches its source via the Group 1 endpoint, and inlines it in the response
    - Test 3 (DTO source resolution depth-2): tool with `depth=2` ALSO resolves transitive non-primitive field-type DTOs and inlines their source
    - Test 4 (per-file 8 KB truncation): a DTO source exceeding 8 KB is truncated and ends with `// ...truncated, N more bytes`
    - Test 5 (missing DTO graceful fallback): FQN unresolvable (no matching file found) — that field's source slot returns the single string `"DTO source unavailable"`; the rest of the response is still returned
    - Test 6 (410-Gone graceful fallback): the source endpoint returns `410 Gone` — the tool returns `"DTO source unavailable"` for the affected field and includes a structured note in the response so the LLM falls back to WSDL-types-only payload construction
    - Test 7 (sibling-operation sample payload pickup): when a sibling operation in the same service has a recorded sample payload (e.g., from a prior capture), the tool inlines it in the response under a `sibling_sample_payload` field
    - Test 8 (inline single-response shape): the entire response is a single inline JSON object (no pagination, no continuation token — W-14)
  - [x] 8.2 Create `api-migration-validation-service/src/services/tools/get_operation_payload_context.ts`
    - Register in the AMVS tool registry as a SIBLING of `list_oas_operations.ts` — NOT an extension (per W-5, `list_oas_operations` stays cheap and listing-only)
    - Module shape mirrors `get_oas_operation_detail.ts` (closest analogue — operation-id-keyed lookup, inline response)
    - Input shape: `{ operationId: string, depth?: 1 | 2 }`; default `depth=1`, max `depth=2` (W-6)
    - Output shape (inline single response):
      ```
      {
        operationId: string,
        request_root_element?: string,
        request_namespace?: string,
        response_root_element?: string,
        request_dto_class?: string,
        response_dto_class?: string,
        request_dto_source?: string | 'DTO source unavailable',
        response_dto_source?: string | 'DTO source unavailable',
        nested_dto_sources?: Record<string, string | 'DTO source unavailable'>,  // depth=2 only
        sibling_sample_payload?: string,
        truncations?: { dto_class: string, dropped_bytes: number }[],
        notes?: string[]  // e.g., "clone evicted; DTO sources unavailable"
      }
      ```
    - Read WSDL metadata from the endpoint's `protocol_metadata_json` blob (Phase 1 persistence)
    - FQN-to-path resolution: derive the repo-relative path from the JAXB DTO FQN (`com.foo.Bar` → `src/main/java/com/foo/Bar.java`); fetch via the Group 1 endpoint
    - Per-file 8 KB byte cap: truncate after 8192 bytes, append marker `// ...truncated, N more bytes` (W-6)
    - Apply the Group 2 token-cap helper using env vars `AMVS_LLM_PAYLOAD_INPUT_TOKENS_PER_CALL` (8 K) and `AMVS_LLM_PAYLOAD_INPUT_TOKENS_PER_SESSION` (50 K)
    - At `depth=2`, additionally resolve and inline source for non-primitive field types referenced by the request/response DTOs (parse field declarations naively — match the Phase 1 scanner's regex style)
    - Graceful fallback paths:
      - FQN unresolvable → that source field returns `"DTO source unavailable"`; other fields still populated
      - 410-Gone clone evicted → ALL source fields return `"DTO source unavailable"`; `notes` array gets `"clone evicted; DTO sources unavailable"`; WSDL metadata still returned so LLM falls back to WSDL-types-only
    - Sibling-operation sample payload: when the same service has a recorded sample payload from a prior capture, inline it under `sibling_sample_payload`
  - [x] 8.3 Structured log line emission
    - Start: `[diag-amvs] payload_context start operationId=<id> depth=<1|2>`
    - Success: `[diag-amvs] payload_context result=ok operationId=<id> dto_sources=<N> truncations=<N>`
    - Missing DTO: `[diag-amvs] payload_context dto_unresolved operationId=<id> fqn=<...>`
    - Clone evicted: `[diag-amvs] payload_context result=clone_evicted operationId=<id>`
  - [x] 8.4 Run ONLY the 6-8 tests from 8.1

**Acceptance Criteria:**
- The 6-8 tests written in 8.1 pass
- Tool is registered as a sibling of `list_oas_operations`, NOT as an extension
- Depth-1 + depth-2 resolution both work
- Per-file 8 KB truncation marker is appended exactly
- Missing-DTO and 410-Gone paths both fall back gracefully without throwing
- Token caps are applied via the Group 2 helper

---

#### Task Group 9: Capture-Loop LLM Prompt Wiring
**Dependencies:** Task Group 8

- [x] 9.0 Register the new tool with the capture-loop's LLM tool registry
  - [x] 9.1 Write 2-3 focused tests
    - Test file: `api-migration-validation-service/src/__tests__/captureLoopToolRegistry.test.ts`
    - Test 1 (registration): the capture-loop's LLM tool registry now lists `get_operation_payload_context` alongside `list_oas_operations`
    - Test 2 (smoke — populated payload context): an LLM tool-call for a Phase-1-extracted operation gets a populated payload context (WSDL metadata + DTO source — happy path through Group 8)
    - Test 3 (smoke — empty fallback): an LLM tool-call for an LLM-extracted operation (no WSDL source) gets a response with WSDL fields absent but DTO source fields populated (when FQNs resolve)
  - [x] 9.2 Modify the capture-loop tool registry
    - File: locate the existing capture-loop tool registry (likely `api-migration-validation-service/src/services/captureSessionOrchestrator.ts` or sibling — same place `list_oas_operations` is registered today)
    - Add `get_operation_payload_context` to the registry; mirror the registration of `list_oas_operations`
    - No changes to the existing tool-invocation infrastructure — the LLM picks the new tool when its prompt asks for one
  - [x] 9.3 Run ONLY the 2-3 tests from 9.1

**Acceptance Criteria:**
- The 2-3 tests written in 9.1 pass
- The new tool is registered alongside `list_oas_operations` with no changes to invocation infrastructure
- A smoke invocation returns a populated payload context for a Phase 1 operation

---

### End-to-End / Smoke Tests

#### Task Group 10: Workstream A End-to-End Fixture Test
**Dependencies:** Task Groups 1-7

- [x] 10.0 Run the full Workstream A path against an in-tree hand-rolled SOAP servlet fixture
  - [x] 10.1 Create the fixture
    - Path: `agent-os/specs/2026-05-17-soap-llm-extraction-and-payload-enrichment-phase-2/planning/visuals/fixture-hand-rolled-soap-servlet/`
    - One or more Java source files implementing a hand-rolled SOAP servlet:
      - NO `@Endpoint` annotation
      - NO `@WebService` annotation
      - NO `.wsdl` file
      - Class extends `HttpServlet` (or similar) and parses the SOAP envelope manually
      - Exposes 1-2 recognisable operations (e.g., `getAccount`, `createOrder`) that the LLM can extract
    - Provenance comment at the top of each file: "fixture — derived from public reference examples"
  - [x] 10.2 Write 2-3 focused end-to-end tests
    - Test file: `api-migration-validation-service/src/__tests__/workstreamAEndToEndFixture.test.ts`
    - Test 1 (real prompt-build, mocked LLM): run the full Workstream A path against the fixture set with a mocked LLM returning two operations at confidence 0.85; assert ≥1 endpoint candidate persists with `discovery_method='llm_extraction'`
    - Test 2 (low-confidence): mocked LLM returns one operation at confidence 0.55; the candidate persists with `data.low_confidence=true`
    - Test 3 (zero-output): mocked LLM returns `[]`; zero candidates persist; no `evidence_gap` finding (empty is valid, NOT malformed)
  - [x] 10.3 Run ONLY the 2-3 tests from 10.1
    - Acceptance signal per the raw idea: "the user's reference SOAP service (the one Phase 1 couldn't extract anything from) produces non-zero LLM-extracted endpoint candidates after this spec lands"

**Acceptance Criteria:**
- The 2-3 tests written in 10.1 pass
- The fixture is in place under `planning/visuals/`
- The full path from fixture → source-endpoint fetch → LLM tool → `bulkSaveCandidates` → AMS round-trip works end-to-end
- Provenance is recorded inline as "fixture — derived from public reference examples"

---

#### Task Group 11: Workstream B Smoke Test (NumberConversion SOAP target)
**Dependencies:** Task Groups 8, 9

- [x] 11.0 Smoke-test the capture-loop's SOAP envelope generation against a real public SOAP service
  - [x] 11.1 Capture the WSDL at spec-build time
    - File: `agent-os/specs/2026-05-17-soap-llm-extraction-and-payload-enrichment-phase-2/planning/visuals/numberconversion.wsdl`
    - Source: `https://www.dataaccess.com/webservicesserver/NumberConversion.wso?WSDL` (DataAccess Worldwide — chosen because it is stable, has a tiny well-formed WSDL with two operations: `NumberToWords`, `NumberToDollars`, uses document/literal style, and has no auth or CORS friction)
    - Acts as the offline fallback when the live target is unreachable from CI
  - [x] 11.2 Write the smoke test
    - Test file: `api-migration-validation-service/src/__tests__/workstreamBSmokeNumberConversion.test.ts`
    - Test 1 (offline WSDL fallback — runs unconditionally): given the checked-in `numberconversion.wsdl`, invoke `get_operation_payload_context` for `NumberToWords` with a stubbed AMS payload that mirrors the WSDL metadata; assert the response contains the expected WSDL fields + (since this WSDL has no JAXB DTO classes) a graceful absence of DTO source fields
    - Test 2 (envelope parses against WSDL — gated by `SOAP_SMOKE_TEST=true`): when the env var is set, hit the live target, generate a SOAP envelope using `get_operation_payload_context` output + the capture-loop LLM, and assert the generated envelope parses against the live WSDL schema using the `fast-xml-parser` + XSD walk added in Phase 1
    - Acceptance is NOT "produces a 200 response" — schema parsing is sufficient (W-16)
    - When `SOAP_SMOKE_TEST` is unset, Test 2 is skipped so CI does not depend on external uptime
  - [x] 11.3 Run ONLY the 2 tests from 11.2
    - In default CI run, only Test 1 runs (offline). Test 2 runs when `SOAP_SMOKE_TEST=true` is set in the env.

**Acceptance Criteria:**
- The smoke test passes against the offline checked-in WSDL by default
- When `SOAP_SMOKE_TEST=true`, the live-target test also passes (envelope parses against live WSDL)
- The checked-in WSDL is in place under `planning/visuals/`
- The test is gated by env var so CI does not depend on external uptime

---

### Documentation

#### Task Group 12: Inline TSDoc / JSDoc Headers
**Dependencies:** Task Groups 1-11

- [x] 12.0 Add inline module-header documentation at the top of every new file
  - [x] 12.1 Header at the top of `api-migration-validation-service/src/services/tools/propose_endpoints_from_code.ts`
    - Describe inputs: `interfaceCandidateId`, `parentServiceName`, `sourceFilePaths`
    - Describe output schema: the strict `[{ operationName, soapAction?, path?, requestRootElement?, responseRootElement?, requestDtoClass?, responseDtoClass?, confidence }]` shape
    - State the three confidence tiers (W-8): `<0.4` dropped silently, `0.4–0.7` low-confidence chip, `≥0.7` default-accepted-pending-review — and that thresholds are configured constants (not user-tunable)
    - State the malformed-output retry behaviour (W-9): one automatic retry with "your previous response was malformed" follow-up; on second failure, emit zero candidates + one `evidence_gap` finding with `gapType='llm_endpoint_extract_malformed'`
    - State the token caps (W-7): `AMVS_LLM_EXTRACT_INPUT_TOKENS_PER_CALL` (default 20000), `AMVS_LLM_EXTRACT_INPUT_TOKENS_PER_SESSION` (default 100000); truncate-with-warning at the cap
    - Reference the spec path: `agent-os/specs/2026-05-17-soap-llm-extraction-and-payload-enrichment-phase-2/spec.md`
  - [x] 12.2 Header at the top of `api-migration-validation-service/src/services/tools/get_operation_payload_context.ts`
    - Describe inputs: `{ operationId: string, depth?: 1 | 2 }`; default `depth=1`, max `depth=2`
    - Describe the inline output envelope (W-14): WSDL fields + DTO source slots + optional `nested_dto_sources` (depth=2) + optional `sibling_sample_payload` + `truncations` array + `notes` array
    - State the DTO resolution rules: FQN-to-repo-relative-path mapping; fetch via the Group 1 source endpoint; depth-1 default, depth-2 transitive resolution
    - State the truncation semantics (W-6): per-file 8 KB byte cap with `// ...truncated, N more bytes` marker; token caps `AMVS_LLM_PAYLOAD_INPUT_TOKENS_PER_CALL` (8 K) / `AMVS_LLM_PAYLOAD_INPUT_TOKENS_PER_SESSION` (50 K)
    - State the graceful-fallback rules: FQN unresolvable → `"DTO source unavailable"` for that field; 410-Gone clone evicted → all source fields return `"DTO source unavailable"` plus a `notes` entry
    - Reference the spec path
  - [x] 12.3 Header at the top of the new discovery-service source-endpoint route file (`discovery-service/src/routes/source.ts` or wherever Group 1 lands)
    - Describe path semantics (W-12): repo-relative paths only (e.g., `src/main/java/com/foo/Bar.java`); clone root is an implementation detail callers never see
    - Describe auth posture (W-13): matches existing run-scoped routes; no new auth surface introduced
    - Describe path-traversal rejection: `..` segments, absolute paths, and symlinks escaping the clone root all return `400 Bad Request`
    - Describe the GC fallback (W-17): structured `410 Gone` with `{ error: 'clone_evicted', runId, message }`; no auto-reclone
    - State that this endpoint never triggers a fresh git clone — it serves only what is already on disk
    - Reference the spec path
  - [x] 12.4 No standalone `.md` files
    - All documentation lives inside the source files only — do NOT create a separate README.md or design doc (per the standing instruction "NEVER create documentation files (*.md) or README files unless explicitly requested")

**Acceptance Criteria:**
- All three inline headers are present at the top of their respective files
- Each header covers the bullets enumerated above
- No standalone documentation files were created

---

## Execution Order

Recommended implementation sequence (Workstream A first, then Workstream B, per W-1):

1. **Foundation parallel block** — Groups 1 (source endpoint), 2 (token-cap helper), 3 (`discovery_method` framing), 4 (new `evidence_gap` sentinel). All independent; parallelisable across engineers.
2. **Workstream A core** — Group 5 (`propose_endpoints_from_code` tool). Depends on Groups 1, 2, 3, 4.
3. **Workstream A UI + emit** — Group 6 (Step 4 trigger UI + AMVS-side route) and Group 7 (LLM-extracted candidate emit through `bulkSaveCandidates`). Group 6 unblocks Group 7's invocation; Group 7 owns the candidate-shape conversion.
4. **Workstream A E2E** — Group 10 (hand-rolled SOAP servlet fixture test). Depends on Groups 1-7.
5. **Workstream B core** — Group 8 (`get_operation_payload_context` tool). Depends on Groups 1, 2 (independent of Workstream A; can start in parallel with Group 5 if engineer count allows).
6. **Workstream B wiring** — Group 9 (capture-loop tool registration). Depends on Group 8.
7. **Workstream B smoke** — Group 11 (NumberConversion smoke test). Depends on Groups 8, 9.
8. **Documentation** — Group 12 (inline TSDoc/JSDoc headers). Depends on Groups 1-11.

**Dependency map:**

```
Group 1 (source endpoint) ----+
Group 2 (token-cap helper) ---+--> Group 5 (propose_endpoints_from_code) --> Group 6 (Step 4 UI) --> Group 7 (emit) --> Group 10 (Workstream A E2E)
Group 3 (discovery_method) ---+                                                                                                       \
Group 4 (new sentinel) -------+                                                                                                        +--> Group 12 (docs)
                              |                                                                                                       /
                              +--> Group 8 (get_operation_payload_context) --> Group 9 (tool registration) --> Group 11 (Workstream B smoke)
```

Groups 1, 2, 3, 4 are parallelisable on day one. Workstream A staged before Workstream B per W-1 ordering (Workstream A unblocks the user's reference SOAP service first; Workstream B improves an already-working flow). Group 12 is the documentation deliverable folded in at the end.
