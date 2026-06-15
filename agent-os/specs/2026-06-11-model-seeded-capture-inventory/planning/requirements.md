# Spec Requirements: Model-Seeded Capture Inventory — Guaranteed Operation-Capture Completeness

> Status: AUTHORITATIVE / BUILD-READY. All eight clarifying recommendations from the
> shaping session were accepted by the user verbatim and are baked in below as settled.
> Do NOT re-ask. The raw idea in `planning/raw-idea.md` carries the full problem
> statement and solution direction (treat its content as settled too).

## Initial Description

See `planning/raw-idea.md` (comprehensive). Summary:

The product is a like-for-like migration oracle; the API behavioural baseline is its
ground truth, and discovery is supposed to seed COMPLETE operation capture. Today the
capture session's operations inventory comes from the USER-SUPPLIED OAS/WADL file
(resolved from selected Interface rows' discovery `spec_link` files, or an ad-hoc
upload), not from the discovered ENDPOINT set committed to the architecture model.
If the spec file is stale or partial, the baseline silently has holes — and
everything downstream (target replay, diff, reconciliation, migration-plan readiness)
trusts that baseline. The discovery↔harness inventory reconciliation already exists
in AMS (`MigrationDiscoveryContextService` coverage gate C →
`DISCOVERY_HARNESS_INVENTORY_MISMATCH`) but is ADVISORY only and runs read-side, far
from the capture flow.

Solution direction (the "coverage guarantee in code" philosophy applied to capture):

1. **Reconcile, don't re-enumerate:** after the existing `parse-oas` schema-enrichment
   path runs, the session's operation rows are RECONCILED against the committed
   endpoint set for the selected interfaces. Every in-scope committed endpoint ends
   up either with an operation row or an explicit exclusion-with-reason. Nothing
   silently absent.
2. **Hard-block Start** while any in-scope endpoint is unaccounted, unless explicitly
   overridden with a persisted justification.
3. **Both directions surfaced:** model-endpoint-without-operation (hole in the
   oracle → one-click include or exclude-with-reason) AND
   operation-without-model-endpoint (the harness knows something discovery doesn't →
   auto-emitted discovery finding + wizard display).
4. The existing advisory readiness mismatch then clears naturally when coverage is
   genuine.

## Pre-Shaping Research (verified in repo 2026-06-11)

Research performed in the main session; all file references re-verified while
writing this document.

### The existing model-aware path (partial — this spec EXTENDS it)

- **Wizard:** `frontend/src/components/ApiBehaviour/StartCaptureSessionWizard.tsx` —
  Step 1 selects Interface rows from the committed model (or falls back to ad-hoc
  OAS/WADL upload). Step 4 shows an inclusion table over the parsed operations.
- **Backend actions:** `api-migration-validation-service/src/routes/captureSessionActions.ts` —
  - `parse-oas` (`POST /api/capture-sessions/{id}/parse-oas`): reads the selected
    `Interface` rows from AMS, resolves each interface's discovery `spec_link` file
    via the discovery-service source endpoint, parses, writes operation rows to AMS,
    and caches the in-memory OAS inventory for `/start`.
  - `extract-endpoints`: synchronous LLM fallback that proposes endpoints from code
    when no spec file exists.
  - `start`: guards only on `status='configured' AND secrets present AND OAS
    inventory present`. **This is where the new hard-block lands.**
- **Operation rows:** `api_behaviour_operations` / `OperationDto` — id, session_id,
  operation_id, method, path, summary, description, included (boolean|null),
  safe_to_execute, request/response/oas schema JSON.

### THE GAP

The enumerator is the spec FILES, not the committed ENDPOINT rows:

- Endpoints committed by discovery but absent from an interface's OAS file are
  silently missed (stale/partial spec file → silent baseline hole).
- Unselected interfaces vanish without trace — no "excluded by scope" record.
- Nothing compares the session's operation rows against the full committed endpoint
  set at any point in the capture flow.
- `/start` has no coverage awareness at all.

### The identity key + comparison ALREADY EXIST in Java (reuse, don't reimplement)

`architecture-model-service/src/main/java/com/example/architecturemodel/service/migration/MigrationDiscoveryContextService.java`:

- `computeInventoryReconciliation(...)` (static, ~line 1350; called from the
  readiness gate at ~line 1124) — both-directions endpoint↔operation comparison.
- Identity key: REST → `method + path`; SOAP →
  `soap::<soap_action|request_root_element>` with fallback `soap::<endpoint id>`
  (~lines 1341–1402).

The spec REUSES this code via a NEW AMS reconciliation endpoint rather than
reimplementing the key/comparison logic in TypeScript — single source of truth
shared with the readiness gate.

### Other verified foundations

- Baseline activation control exists: `frontend/src/components/DashboardView/BaselinesList.tsx`
  Activate action + AMS draft→active transitions.
- Session detail view for surfacing the override:
  `frontend/src/components/DashboardView/CaptureSessionDetailView.tsx`.
- Latest Liquibase changeset is **177**
  (`architecture-model-service/src/main/resources/db/changelog/sql/177-db-migration-pack-file-kind-translation.sql`)
  — the new override columns go in a NEW changeset (178+), never an edit to an
  applied one.
- Findings emission precedent: `api-migration-validation-service/src/services/diffRunner.ts`
  finding emission (see `diffRunnerFindingEmission.test.ts`) / FindingEmitter patterns.

## Requirements Discussion

### Settled Decisions (all 8 recommendations accepted verbatim)

**D1: Reconciliation step EXTENDS the existing flow — parse-oas stays the
schema-enrichment path.**
After parsing, the session's operation rows are reconciled against the committed
endpoint set. Unmatched endpoints are listed for one-click INCLUDE (auto-create an
operation row from the endpoint's method/path/protocol metadata, schema-less when no
OAS match exists) or EXCLUDE-WITH-REASON. The UI extends the wizard's existing
Step 4 inclusion table — not a new wizard step.

**D2: Identity key — a NEW AMS reconciliation endpoint reusing
`computeInventoryReconciliation`.**
The existing Java key/comparison code in `MigrationDiscoveryContextService` is the
single source of truth, shared with the readiness gate. NO TypeScript
reimplementation of the key or the both-directions comparison.

**D3: Blocking — HARD-BLOCK session Start; Activate informs but does not re-block.**
Session Start is hard-blocked while any in-scope endpoint is unaccounted (no
operation row AND no exclusion), unless explicitly overridden with a justification.
Baseline Activate shows the coverage figure + override note but does NOT re-block
(the gate already ran at Start; double-gating adds friction without information).

**D4: Override persistence — nullable columns on the capture session row.**
Justification text + unaccounted count at override time, added via a NEW Liquibase
changeset (latest applied is 177). Surfaced on the session detail view and on the
baseline (coverage figure + override note per D3).

**D5: Reverse direction (operation-without-model-endpoint) — auto-emit a discovery
FINDING and display in the wizard.**
Finding category: reconciliation; linked to the capture session. The wizard also
displays these so the user sees the discovery gap at configuration time.

**D6: Readiness — NO changes.**
`DISCOVERY_HARNESS_INVENTORY_MISMATCH` stays advisory and clears naturally with real
seeding. Overridden sessions keep the mismatch visible by construction (the
unaccounted endpoints genuinely have no operations, so the read-side gate still
reports them).

**D7: Scope — per-interface selection remains the scope mechanism.**
The coverage guarantee applies to the SELECTED interfaces' endpoints. Unselected
interfaces' endpoints display as "excluded by scope" (bulk, one reason) — never
silently absent. The whole-architecture coverage % is still displayed.

**D8: Back-compat + staleness — old sessions/baselines untouched; reconciliation
re-runs at Start.**
No retroactive gates on existing sessions/baselines. The reconciliation re-runs at
Start (the gate), catching model changes between session create/configure and start.

### Existing Code to Reference

**Similar Features / Reuse Pointers Identified:**

- **The identity key + comparison (the core reuse):**
  `MigrationDiscoveryContextService.computeInventoryReconciliation` —
  `architecture-model-service/src/main/java/com/example/architecturemodel/service/migration/MigrationDiscoveryContextService.java`
  (~line 1350; SOAP key ~1341–1402; readiness-gate call site ~1124). Expose via a
  new AMS reconciliation endpoint.
- **Where the block lands:** the `/start` guard in
  `api-migration-validation-service/src/routes/captureSessionActions.ts`
  (currently `status='configured' AND secrets AND OAS inventory present`).
- **The UI extension point:** `frontend/src/components/ApiBehaviour/StartCaptureSessionWizard.tsx`
  Step 4 inclusion table (extend, don't replace).
- **Coverage-guarantee philosophy (accounted-or-throw):** sibling specs
  `agent-os/specs/2026-06-11-two-phase-migration-plan-generation` (template
  stamping — coverage becomes a code guarantee) and
  `agent-os/specs/2026-06-11-db-schema-and-data-migration-pack` (every inventory
  item accounted for or the build throws).
- **Override display:** `frontend/src/components/DashboardView/CaptureSessionDetailView.tsx`.
- **Findings emission precedent:**
  `api-migration-validation-service/src/services/diffRunner.ts` finding emission
  (`diffRunnerFindingEmission.test.ts`) / FindingEmitter patterns.
- **Baseline display point:** `frontend/src/components/DashboardView/BaselinesList.tsx`
  (Activate flow — coverage figure + override note).

### Follow-up Questions

None required — all open design areas from `raw-idea.md` were resolved by the eight
accepted recommendations above.

## Visual Assets

### Files Provided:

No visual assets provided (verified: `planning/visuals/` contains no image files).

### Visual Insights:

Follow the existing capture-wizard styling
(`StartCaptureSessionWizard.tsx` / `StartCaptureSessionWizard.module.css`) for the
Step 4 inclusion-table extension; follow `CaptureSessionDetailView` and
`BaselinesList` conventions for the override/coverage surfaces.

## Requirements Summary

### Functional Requirements

1. **New AMS reconciliation endpoint** that takes a capture session's operation rows
   (or session reference) + the selected interface scope and returns the
   both-directions reconciliation, computed by the existing
   `computeInventoryReconciliation` key/comparison code (D2).
2. **Wizard reconciliation in Step 4:** after `parse-oas` (which remains the
   schema-enrichment/parsing path), call the reconciliation endpoint and extend the
   existing inclusion table with:
   - Unmatched committed endpoints (model-endpoint-without-operation) with one-click
     INCLUDE (auto-create a schema-less operation row from the endpoint's
     method/path/protocol metadata when no OAS match) or EXCLUDE-WITH-REASON (D1).
   - Operations-without-model-endpoint displayed as discovery gaps (D5).
   - Unselected interfaces' endpoints shown as "excluded by scope" (bulk, single
     reason) — never silently absent (D7).
   - Whole-architecture coverage % displayed alongside selected-scope coverage (D7).
3. **Hard-block at `/start`:** the start guard re-runs reconciliation (catching model
   drift since configure — D8) and refuses to start while any in-scope endpoint is
   unaccounted (no operation row AND no exclusion), unless the user overrides with a
   justification (D3).
4. **Override persistence:** nullable capture-session columns (override justification
   + unaccounted count at override time) via a NEW Liquibase changeset (178+, latest
   applied is 177); surfaced on `CaptureSessionDetailView` and on the baseline (D4).
5. **Baseline Activate:** displays the coverage figure + override note; does NOT
   block (D3).
6. **Auto-emitted discovery finding** (reconciliation category, linked to the
   session) for every operation-without-model-endpoint, following the diffRunner
   finding-emission precedent (D5).
7. **Readiness gate untouched:** `DISCOVERY_HARNESS_INVENTORY_MISMATCH` remains
   advisory; no changes to `MigrationDiscoveryContextService` gate behaviour beyond
   exposing the reconciliation computation for reuse (D6).

### Reusability Opportunities

- `computeInventoryReconciliation` (Java) — the SOAP-aware identity key and
  both-directions comparison; exposed via a new endpoint, never duplicated in TS.
- `parse-oas` / `extract-endpoints` action plumbing in `captureSessionActions.ts` —
  the new reconciliation/include/exclude/override actions follow the same
  session-action route shape.
- Step 4 inclusion-table component in `StartCaptureSessionWizard.tsx` — extended,
  not replaced.
- diffRunner finding-emission pattern for the reconciliation findings.
- Accounted-or-throw coverage philosophy from the two sibling 2026-06-11 specs.

### Scope Boundaries

**In Scope:**
- AMS reconciliation endpoint reusing the existing Java comparison.
- Wizard Step 4 reconciliation UX (include / exclude-with-reason / excluded-by-scope
  / discovery-gap display / coverage %).
- `/start` hard-block + override with persisted justification (new changeset).
- Override + coverage surfacing on session detail and baseline (Activate informs).
- Auto-emitted reconciliation findings for operations without model endpoints.
- Reconciliation re-run at Start for staleness protection.

**Out of Scope:**
- Replacing `parse-oas`/`extract-endpoints` as the schema-enrichment paths (they
  stay; reconciliation runs after them).
- Any change to the advisory readiness gate `DISCOVERY_HARNESS_INVENTORY_MISMATCH`.
- Re-blocking at baseline Activate.
- Retroactive gating or migration of existing sessions/baselines.
- A discovery re-scan trigger from the finding (the finding + display is the v-now
  surface; re-scan remains a user action).

### Technical Considerations

- **Wire format:** the new AMS reconciliation endpoint follows AMS conventions —
  snake_case global default unless its consumers (the validation service / frontend)
  require `@CamelCaseWire` (per `CLAUDE.md`); decide per the consuming client's
  existing typing in the validation service.
- **Liquibase:** NEW changeset only (latest is 177); never edit applied changesets.
- **DTO nullability:** the new override columns / DTO fields must be boxed/nullable
  (justification string, unaccounted count as boxed integer) to survive PATCH
  semantics.
- **Single source of truth:** any future change to the identity key happens once in
  `computeInventoryReconciliation` and serves both the readiness gate and the
  capture gate.
- **Staleness:** configure-time reconciliation is advisory UX; Start-time
  reconciliation is the gate (D8) — both call the same endpoint.
- **Schema-less auto-created operations:** operation rows created from endpoint
  metadata without an OAS match carry method/path/protocol metadata but null
  schemas; downstream scenario generation must tolerate schema-less operations (it
  already tolerates `included=null` rows; verify during build).
