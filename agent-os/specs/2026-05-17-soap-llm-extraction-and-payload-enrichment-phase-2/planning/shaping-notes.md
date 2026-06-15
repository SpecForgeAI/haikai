# Shaping Notes: SOAP LLM Extraction and Payload Enrichment (Phase 2)

**Spec path:** `agent-os/specs/2026-05-17-soap-llm-extraction-and-payload-enrichment-phase-2`
**Shaping pass status:** COMPLETE — all clarifying questions resolved; no open items blocking `/write-spec`.
**Visuals:** none supplied. Spec-writer works from textual descriptions only.

---

## 1. Scope summary

One consolidated spec covering two workstreams plus shared infrastructure:

- **Workstream A — LLM endpoint extraction.** Adds an explicit "Extract endpoints with LLM" action to the Step 4 reference service, populating the currently-empty candidate list via an LLM tool call that reads source files from the discovery repo clone.
- **Workstream B — Capture-loop payload enrichment.** Adds a new LLM tool that returns rich per-operation payload context (DTO field shapes from source) so the capture-loop LLM can build accurate SOAP envelopes instead of WSDL-types-only guesses.

Both workstreams share three pieces of infrastructure introduced in this spec:

- A new discovery-service endpoint that serves repo-clone source files to AMVS.
- Token-budget caps applied to every new LLM tool call.
- A `discovery_method` trace field plus matching "discovered-via" chip in the candidate review UI.

---

## 2. Task ordering inside the spec

Spec-writer should sequence the task list as:

1. **Shared infrastructure first.**
   - W-2 discovery-service source-file endpoint (`GET /discovery/runs/{id}/source/{path}`).
   - W-7 token-budget configuration plumbing (env vars + per-call enforcement helper).
   - W-10 backend `discovery_method` field on endpoint candidates (DTO + persistence) ahead of the consumers that need it.

2. **Workstream A — LLM endpoint extraction** (unblocks the empty Step 4 reference service first).
   - Tool registration: `propose_endpoints_from_code`.
   - Step 4 "Extract endpoints with LLM" trigger + progress UI + 60-second client timeout.
   - Candidate persistence via the Phase 1 `bulkSaveCandidates` flow.
   - Confidence-floor handling and malformed-output retry.
   - "Discovered-via" chip on the candidate review UI.

3. **Workstream B — Capture-loop payload enrichment.**
   - Tool registration: `get_operation_payload_context`.
   - Depth-1 DTO resolution + per-file 8 KB truncation.
   - Inline single-response shape with truncation markers.
   - Cached-clone-missing fallback ("DTO source unavailable → WSDL-types-only").

4. **Acceptance harness.**
   - Workstream A acceptance: candidates appear in Step 4 review against an in-repo sample SOAP service.
   - Workstream B acceptance: generated envelope parses against the pinned demo SOAP target's WSDL schema (target selected by spec-writer per W-16).

---

## 3. Resolved decisions (verbatim)

### Workstream split

- **W-1 — Consolidated spec.** ONE spec covering both workstreams. Task list orders Workstream A first (unblocks empty Step 4 reference service), then Workstream B (capture-loop payload enrichment). Shared infra (W-2, W-7, W-10) lives in one design pass.

### Shared infrastructure

- **W-2 — Repo-clone access via option (a).** Discovery-service exposes a new endpoint `GET /discovery/runs/{id}/source/{path}`. AMVS calls it for both workstreams.
- **W-12 — Path semantics.** REPO-RELATIVE paths only (e.g. `src/main/java/com/foo/Bar.java`). The server prefixes the clone-root path internally; clone-root is an implementation detail callers never see.
- **W-13 — Auth posture.** Match discovery-service's existing endpoints — same headers/middleware, no new auth surface. Internal service-to-service call. Spec records this decision so it surfaces during security review.
- **W-17 — Cached clone GC fallback.** Return a structured 410-Gone-style error from the new source endpoint. AMVS surfaces "Source no longer cached — re-run discovery" in Step 4 for Workstream A. Capture-loop tool returns "DTO source unavailable" so the LLM falls back to WSDL-types-only payload construction. NO auto-reclone.

### Workstream A — LLM endpoint extraction

- **W-3 — Trigger.** Explicit "Extract endpoints with LLM" button in Step 4 with empty-state messaging ("No endpoints detected. Try LLM extraction?"). NO auto-fire on Step 4 entry. Avoids surprise token spend; user retains control.
- **W-4 — Persistence shape.** Full candidate path — LLM-derived ops route through `bulkSaveCandidates` → AMS candidates → user review → save back. Uniform UX with Phase 1.
- **W-8 — Confidence floor.**
  - `<0.4`: drop silently.
  - `0.4–0.7`: surface with "low confidence" chip in the candidate review UI.
  - `≥0.7`: default-accepted-pending-review.
  - Threshold is a configured constant, not user-tunable.
- **W-9 — Malformed LLM output handling.** One automatic retry with a "your previous response was malformed, here's the schema again" re-prompt. On second failure: log structured error, emit zero candidates, surface a Step 4 toast "LLM extraction failed — review manually". Never cascade-fail the discovery run.
- **W-15 — Sync execution.** Synchronous within Step 4 with a visible progress indicator and a 60-second client-side timeout. If the timeout fires, show "still working — refresh in a minute" and let the result land in candidates on next Step 4 open. No polling/notification infrastructure.

### Workstream B — Capture-loop payload enrichment

- **W-5 — Tool design.** NEW sibling tool `get_operation_payload_context(operationId)`. Keeps `list_oas_operations` cheap and listing-only; pulls rich payload context only for the operation the LLM is currently working on. Reusable for REST DTO enrichment later.
- **W-6 — DTO depth + truncation.** Depth-1 by default (resolve the request/response DTO + its direct field types; do NOT follow transitive references). Per-file 8 KB byte cap, truncated with a `// ...truncated, N more bytes` marker. Tool input accepts an optional `depth` param (1 or 2); the LLM rarely needs depth-2.
- **W-14 — Tool response shape.** INLINE single response, capped at W-6 / W-7 limits with truncation markers. NO pagination in v1. If real cases blow past the cap, add a `continuation_token` later.

### Cross-cutting

- **W-7 — Token budgeting.**
  - Workstream A `propose_endpoints_from_code`: **20 K input tokens / call**, **100 K / session**.
  - Workstream B `get_operation_payload_context`: **8 K input tokens / call**, **50 K / session** across all operations.
  - TRUNCATE-with-warning at the cap (NOT hard-fail). Surface truncation in the LLM-facing response so the model knows context is incomplete.
  - Caps are configurable via env vars.
- **W-10 — Trace metadata in scope.** Add `data.discovery_method: 'framework_scanner' | 'llm_extraction'` on every endpoint candidate, with a "discovered-via" chip in the candidate review UI. Backend + AMS DTO field + frontend chip all bundled into this spec. Splitting would risk the backend field landing without the visible signal.
- **W-11 — LLM provider/model.** Reuse AMVS's existing LLM config — one moving part. Revisit cost-tuning after real usage data.
- **W-16 — Smoke-test target for Workstream B acceptance.** Spec-writer picks ONE stable public SOAP demo (e.g. NOAA-style services or a calculator demo) and pins it in the spec. Acceptance = generated envelope parses against the target's WSDL schema, NOT "produces a 200 response". User did not name a specific target — leave the pick to the spec-writer.

---

## 4. Existing code reuse pointers

User did not supply explicit paths. Spec-writer to confirm during implementation phase:

- **Phase 1 `bulkSaveCandidates` flow + `protocol_metadata_json` write path.** Likely sites:
  - `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/` (Phase 1 emitter).
  - `mcp-server/src/services/candidateSaveBackService.ts` (Phase 1 save-back arm).
- **AMVS LLM tool registry.** Likely under `api-migration-validation-service/src/services/tools/`. `list_oas_operations` is the cheap-listing tool to mirror when registering `propose_endpoints_from_code` and `get_operation_payload_context`.
- **Discovery-service repo-clone infrastructure.** On-disk location + GC rules: spec-writer to discover at write time (likely `discovery-service/src/services/runManager.ts` or sibling).
- **Confidence-chip / "discovered-via" UI.** No pre-existing pattern named by the user. Frontend implementer will model on existing candidate review UI chip patterns.

---

## 5. Visual assets

NONE. User did not supply mockups for:

- The Step 4 empty-state with the "Extract endpoints with LLM" button.
- The "discovered-via" chip or "low confidence" chip on candidate review.
- The `get_operation_payload_context` tool response.

Spec-writer works from textual descriptions in `raw-idea.md` and this file.

---

## 6. Open items

None. Every clarifying question was resolved via accepted defaults. Ready for `/write-spec`.
