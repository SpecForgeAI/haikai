# Spec Requirements: Add New Behaviour — Manual Capture

## Initial Description

Topic: "Add New Behaviour" — manually add a request to an API Behaviour Baseline
capture session during review (api-migration-validation-service [amvs] +
architecture-model-service [AMS] + gateway + frontend).

Problem: After the LLM-driven capture loop runs and a reviewer accepts/rejects the
captured rows in `CaptureReviewPanel`, there is no way to manually add an additional
request/behaviour before saving the baseline. Reviewers want to add an extra request
(a specific request body + headers they know matter) for an endpoint that is ALREADY
in the session's scope, have the tool physically send that request to the
current-state service, then review the resulting capture (accept/reject) like any
LLM-generated one.

### Fixed Constraints Carried From raw-idea.md (do NOT relitigate)

1. **Trigger/UI**: an "Add New Behaviour" button in the capture review surface
   (`frontend/src/components/DashboardView/CaptureReviewPanel.tsx`), shown when the
   panel is NOT read-only (review time — session completed/failed — not while
   running). Opens a modal.
2. **Modal scope = SELECT EXISTING method/path ONLY**. The user selects an HTTP
   method + path from the session's EXISTING operations (`listOperations` by
   sessionId). NO free-form endpoint entry; NO creation of new operations; the modal
   NEVER mutates the current-state architecture. (Adding a brand-new endpoint is a
   SEPARATE, already-supported flow via the Current State Architecture endpoints grid
   + the start-baseline wizard Step 4 Model-Seeded Capture Inventory "Unmatched
   committed endpoints -> Include" flow. That wizard flow is EXPLICITLY OUT OF SCOPE —
   leave the wizard as-is.)
3. **Modal fields**: (a) request body payload as a free-text JSON textbox; (b) HTTP
   headers prefilled from the UNION of request headers across the session's SUCCESSFUL
   (2xx) captures (editable; auth headers are redacted out of those, so their values
   are not shown); plus path params / query as needed to form the request for
   parameterised paths. (c) Save -> closes the modal and physically sends the request
   to the current-state service, producing a capture the reviewer can then
   accept/reject.
4. **Auth**: reuse the session's in-memory secret if it is still loaded; otherwise
   show the existing inline "re-enter secrets" prompt before sending. The auth secret
   value is NEVER persisted — it lives only in the amvs in-memory secrets store while
   configured/running and is purged on cancel/restart. Reuse the existing secret-loss
   UX pattern.
5. **Backend**: a NEW amvs action endpoint (e.g.
   `POST /api/capture-sessions/:id/manual-capture`) that REUSES existing primitives —
   `createSessionHttpExecutor` (base URL + auth injection + default headers), the
   redactor (`redactHeaders`/`redactJson`/`redactUrl`), and
   `archModelClient.createCapture`. The frontend must NOT POST directly to AMS (that
   would bypass redaction). The endpoint first ensures a scenario row exists — it
   creates a NEW scenario under the selected EXISTING operation
   (`scenario_type='manual'`, `generation_source='manual'`) — then persists the
   capture against (operation_id, scenario_id) with `accepted = null` (un-reviewed) so
   it flows through the EXISTING review/accept-reject/Save-as-Baseline path with ZERO
   changes to that path.
6. **Works on a completed (or failed) session, not just running** — the send is ad-hoc
   and independent of the LLM scenario loop.
7. **v1 scope: SKIP the k=3 volatility probe** for a manual send (single fire ->
   `volatile_paths_json = null` -> strict comparison; the reviewer can still Mask
   fields + Accept). Volatility probing can be a later follow-up.
8. **Mutating verbs**: the manual send MAY use mutating verbs (POST/PUT/PATCH/DELETE)
   by explicit user intent; surface a confirmation in the modal consistent with the
   session's mutating-calls posture.

## Requirements Discussion

### First Round Questions

**Q1: Scenario enum handling.** The manual scenario uses `scenario_type='manual'`
and `generation_source='manual'`, but AMS's `ApiBehaviourScenarioService` validates
both values against fixed allow-sets that do NOT currently include `'manual'`. How
should we admit the new value — (a) keep the literals AMS already allows and reuse one
of those, or (b) add `'manual'` to both allow-sets as a one-line constant change (NOT
a DB/Liquibase schema change)?
**Answer:** (b). Add `'manual'` to BOTH allow-sets in `ApiBehaviourScenarioService` —
`ALLOWED_SCENARIO_TYPES` and `ALLOWED_GENERATION_SOURCES` (one-line constant change
each; NOT a DB schema change). Manual scenarios use `scenario_type='manual'` and
`generation_source='manual'`. This is the ONLY AMS code change; still no DB/Liquibase
schema change.

**Q2: Scenario name.** Should the manual scenario auto-generate a name, and what
format?
**Answer:** Default — auto-generate `Manual: <METHOD> <path> <timestamp>` (the
reviewer can rename it later via the existing panel rename action).

**Q3: Path-param entry.** How are parameterised path params (e.g. `{id}` tokens)
entered in the modal?
**Answer:** Default — render one labelled text input per detected `{param}` token;
substitute into the path before sending; store the resolved concrete path on the
capture (`request_path`).

**Q4: Unfilled path params.** What happens when the chosen path has unfilled path
params at Save time?
**Answer:** Default — block the send with an inline validation error naming the
missing param(s).

**Q5: Manual visual label.** Should manual captures get a visual label in the review
table?
**Answer:** Default — yes; a small "Manual" badge on the scenario row in
`CaptureReviewPanel`, mirroring the existing `db_sample` badge pattern (keyed off the
scenario's `generation_source='manual'` / `scenario_type='manual'`).

**Q6: Header prefill source.** Does header prefill union across ALL successful
captures or only accepted ones, and what counts as "successful"?
**Answer:** Default — union across ALL 2xx captures regardless of accept/reject state
("successful" = HTTP 2xx). Auth headers remain redacted out.

**Q7: Mutating-verb confirmation.** What is the exact confirmation behaviour for
mutating sends, and how does it interact with the session's mutating-calls posture?
**Answer:** Default — (a) when method is POST/PUT/PATCH/DELETE, require an explicit
"Yes, send this mutating request" confirm before Save is enabled; (b) if the session's
`mutating_calls_confirmed = false`, STILL ALLOW the manual mutating send (explicit
user intent, independent of the LLM loop) but show a STRONGER warning. Do not
hard-block on session posture.

**Q8: Invalid / non-JSON body.** How is non-JSON / invalid-JSON body text handled?
**Answer:** Default — reject with an inline "not valid JSON" error and block send. NO
"send as raw text" escape hatch in v1.

**Q9: Query-string editor.** Should the modal include a query-string editor?
**Answer:** Default — yes; include a small key/value query-param rows widget (matches
`request_query_json` storage shape).

**Q10: Operation picker scope.** Which operations does the method/path picker offer?
**Answer:** Default — offer ONLY `included=true` operations in the method/path picker.

### Existing Code to Reference

**Similar Features Identified (all paths verified to exist in the repo):**

Frontend:
- `frontend/src/components/DashboardView/CaptureReviewPanel.tsx` — host for the new
  "Add New Behaviour" button + new modal mount; reuses accept/reject/save; contains
  the existing `db_sample` badge pattern to mirror (around line 855, keyed off
  `scenario.generation_source === 'db_sample'`, testid
  `capture-review-scenario-db-sample-badge`).
- `frontend/src/components/DashboardView/CaptureSessionDetailView.tsx` — owns the
  existing PARENT-level re-enter-secrets prompt (testid
  `capture-session-detail-reenter-secrets-prompt`, around line 715) to reuse rather
  than rebuild.
- `frontend/src/components/DashboardView/SaveAsBaselineModal.tsx` — unchanged
  downstream consumer.
- `frontend/src/api/apiBehaviourClient.ts` — `listOperations`, `listCaptures`, capture
  DTO shape, secrets re-enter helpers; add a `manualCapture` action client here.

amvs (api-migration-validation-service):
- `api-migration-validation-service/src/routes/captureSessionActions.ts` — new
  manual-capture route mirrors the `test-api-connection` / `start` structure +
  secrets-store usage.
- `api-migration-validation-service/src/services/tools/execute_http_request.ts` —
  send + redact + createCapture sequence to mirror (the new endpoint reuses the
  primitives directly and is NOT bound to the tool's `ToolExecutionContext`).
- `api-migration-validation-service/src/services/httpExecutor.ts` —
  `createSessionHttpExecutor` + `applyAuthToConfig`.
- `api-migration-validation-service/src/services/redactor.ts` — `redactHeaders` /
  `redactJson` / `redactUrl`.
- `api-migration-validation-service/src/services/archModelClient.ts` —
  `createCapture`, `createScenario`, `getCaptureSession`, secrets store.
- `api-migration-validation-service/src/services/amsBodyEnvelope.ts` —
  `normaliseBodyForAms`.

AMS (architecture-model-service):
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/apibehaviour/ApiBehaviourScenarioService.java`
  — the ONLY AMS code change: add `'manual'` to `ALLOWED_SCENARIO_TYPES` (line 42) and
  `ALLOWED_GENERATION_SOURCES` (line 50). `request_method` + `request_path` required
  non-blank.
- `ApiBehaviourCaptureController` / `Service` / `Entity` — capture create; `accepted`
  nullable = un-reviewed; `request_url_redacted` / `method` / `path` required
  non-blank.

Gateway:
- Proxy the new manual-capture action route (mirror the existing capture-session
  action proxies).

### Follow-up Questions

No additional follow-up questions were required. The user answered all first-round
questions in a single consolidated decision set: Q1 = option (b); ALL OTHER questions
take the recommended defaults.

## Visual Assets

### Files Provided:

No visual assets provided. The mandatory bash check of
`agent-os/specs/2026-06-20-add-new-behaviour-manual-capture/planning/visuals/`
returned no image files. Proceed from written requirements.

### Visual Insights:

None — no visuals to analyse.

## Requirements Summary

### Functional Requirements

- An "Add New Behaviour" button appears in `CaptureReviewPanel` ONLY when the panel is
  not read-only (session completed or failed — i.e. review time, not while running).
- The button opens a modal scoped to SELECT EXISTING method/path only. The operation
  picker offers ONLY `included=true` operations from `listOperations` by sessionId. No
  free-form endpoint entry; no new-operation creation; never mutates current-state
  architecture.
- Modal fields:
  - Method + path picker (existing included operations only).
  - Path-param inputs: one labelled text input per detected `{param}` token in the
    selected path; values are substituted into the path before sending; the resolved
    concrete path is stored on the capture (`request_path`).
  - Request body: free-text JSON textbox. Invalid / non-JSON body is rejected with an
    inline "not valid JSON" error that blocks the send. No raw-text escape hatch in v1.
  - Headers: prefilled from the UNION of request headers across ALL 2xx captures in the
    session (regardless of accept/reject state); auth headers remain redacted out
    (values not shown); editable.
  - Query-string editor: small key/value query-param rows widget matching the
    `request_query_json` storage shape.
- Validation at Save: if any path param is unfilled, block the send with an inline
  validation error naming the missing param(s).
- Mutating-verb handling: for POST/PUT/PATCH/DELETE, require an explicit "Yes, send
  this mutating request" confirmation before Save is enabled. If the session's
  `mutating_calls_confirmed = false`, STILL allow the manual mutating send (explicit
  user intent, independent of the LLM loop) but show a STRONGER warning. Do not
  hard-block on session posture.
- Auth: reuse the session's in-memory secret if still loaded; otherwise surface the
  EXISTING parent-owned re-enter-secrets prompt (do NOT rebuild secret entry in the
  modal — the modal indicates "secrets not loaded → use the existing re-enter prompt").
  The secret value is never persisted.
- On Save: the modal closes and the request is physically sent to the current-state
  service via the new amvs endpoint, producing a capture row (`accepted = null`) the
  reviewer can accept/reject like any LLM-generated one.
- Scenario creation: the endpoint ensures a NEW scenario exists under the selected
  EXISTING operation with `scenario_type='manual'` and `generation_source='manual'`,
  auto-named `Manual: <METHOD> <path> <timestamp>` (renameable later via the existing
  panel rename action).
- Visual label: a small "Manual" badge on the scenario row in `CaptureReviewPanel`,
  mirroring the existing `db_sample` badge (keyed off `generation_source='manual'` /
  `scenario_type='manual'`).
- Volatility: a manual send is a single fire → `volatile_paths_json = null` → strict
  comparison. Reviewer may still Mask fields + Accept.
- The new capture appears as a normal row in `CaptureReviewPanel`, grouped under the
  selected operation with its manual scenario, and flows through the existing
  review/accept-reject/Save-as-Baseline path with zero changes to that path.

### Reusability Opportunities

- Frontend modal UX/secret-loss handling reuses the existing parent-owned re-enter
  prompt in `CaptureSessionDetailView.tsx` (testid
  `capture-session-detail-reenter-secrets-prompt`).
- "Manual" badge reuses the `db_sample` badge styling/pattern in
  `CaptureReviewPanel.tsx`.
- amvs route mirrors `test-api-connection` / `start` structure and secrets-store usage
  in `captureSessionActions.ts`; send+redact+createCapture sequence mirrors
  `execute_http_request.ts` but binds directly to primitives (not the tool's
  `ToolExecutionContext`).
- Reuses `createSessionHttpExecutor` + `applyAuthToConfig` (httpExecutor), the redactor
  primitives, `archModelClient` (`createCapture`, `createScenario`, `getCaptureSession`,
  secrets store), and `normaliseBodyForAms` (amsBodyEnvelope).
- Gateway reuses existing capture-session action proxy pattern.
- Downstream Save-as-Baseline flow (`SaveAsBaselineModal.tsx`) is reused unchanged.

### Scope Boundaries

**In Scope:**
- "Add New Behaviour" button + modal in `CaptureReviewPanel` (review-time only).
- Selecting an existing `included=true` method/path; path-param inputs;
  JSON body textbox; header prefill (union of all 2xx captures, auth redacted);
  query-string key/value editor.
- Mutating-verb confirmation (with stronger warning when session posture is
  unconfirmed; no hard block).
- New amvs `POST /api/capture-sessions/:id/manual-capture` endpoint reusing existing
  send/redact/createCapture primitives and creating a `manual` scenario.
- Single AMS code change: add `'manual'` to `ALLOWED_SCENARIO_TYPES` and
  `ALLOWED_GENERATION_SOURCES` (constant change only).
- Gateway proxy for the new route.
- "Manual" badge on the scenario row.
- New capture lands as `accepted = null` and flows through the existing review path.

**Out of Scope (explicit v1 non-goals):**
- The start-baseline wizard Step 4 Model-Seeded Capture Inventory flow / adding
  brand-new endpoints — left entirely as-is.
- The k=3 volatility probe for manual sends (single fire → `volatile_paths_json=null`
  → strict comparison). Volatility probing is a possible later follow-up.
- A "send as raw text" body escape hatch (declined in Q8).
- Any DB / Liquibase schema change (none required).
- Any change to the downstream review/accept-reject/Save-as-Baseline path.
- Any `/rerun` affordance (manual-add is a NEW behaviour, not a re-run; the existing
  "NO /rerun affordance anywhere" constraint is NOT violated).

Note: the query-string editor IS in scope (Q9 default), distinct from the above
non-goals.

### Technical Considerations

- Wire-format: AMS speaks `snake_case` by default; the amvs↔AMS capture/scenario DTOs
  follow the existing snake_case convention (e.g. `request_path`, `request_query_json`,
  `generation_source`, `scenario_type`, `mutating_calls_confirmed`,
  `volatile_paths_json`). Match the shapes already used by `archModelClient`.
- Frontend must NEVER POST directly to AMS — all sends go through the new amvs endpoint
  so redaction (`redactHeaders` / `redactJson` / `redactUrl`) is applied identically to
  LLM captures.
- The manual capture must be redacted identically to LLM captures.
- AMS capture create requires `request_url_redacted` / `method` / `path` non-blank;
  scenario create requires `request_method` + `request_path` non-blank.
- New capture is persisted with `accepted = null` (un-reviewed).
- The new amvs endpoint reuses primitives directly and is NOT bound to the tool's
  `ToolExecutionContext`.
- The send is independent of the LLM scenario loop and works on completed or failed
  sessions.
- The only AMS code change is the two-constant allow-set addition; no schema/Liquibase
  change.
