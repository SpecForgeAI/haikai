# Spec Requirements: API Behaviour Baseline Capture Service

## Initial Description

Add a new microservice (`api-migration-validation-service`) and supporting platform capability to capture API behaviour baselines from a current-state deployed non-prod service. The service uses supplied OAS specs, current-state architecture context, configured API environment/auth details, optional read-only Sybase/PostgreSQL database sampling, and an LLM-guided capture loop to generate and execute API requests. Successful or meaningful captured request/response examples are reviewed by the user and saved as a durable API Behaviour Baseline.

This baseline will later be used by migration planning, target-state implementation backlog generation, Migration Test Pack creation, and a future API reconciliation/reporting capability.

Full detailed raw idea preserved in `planning/raw-idea.md` (200 lines) — covers V1 scope, out-of-scope, high-level flow, architecture responsibilities, full 7-table AMS data model, security/secrets, OAS parsing, LLM-guided capture loop, tool guardrails, DB sampling, request generation, retry/refinement, redaction/masking, frontend wizard + review UX, suggested endpoints, test summaries, acceptance criteria, and implementation notes.

## Requirements Discussion

### First Round Questions

**Q1: Service stack.**
**Answer:** Confirmed — mirror discovery-service skeleton: Node/TS, Express, axios, `tsx watch`, port `8092`, similar `src/{config,routes,services,...}` layout, matching client patterns.

**Q2: State ownership.**
**Answer:** Confirmed — AMS owns all durable state. New service holds no database of its own; writes progress/results back to AMS as it runs.

**Q3: Liquibase numbering.**
**Answer:** Confirmed — start at `128`, one changeset per table (`128`–`134`), each registered separately.

**Q4: LLM tool-call architecture.**
**Answer:** Confirmed (a) — thin gateway LLM tool-calling relay endpoint; new service owns loop, tools, execution, control flow. Hard round-trip cap (e.g. 12 per scenario).

**Q5: Secrets storage.**
**Answer:** Confirmed (a) — secrets NOT persisted in AMS; held in service memory during running session only; persist redacted metadata only; re-entry required for reruns/new sessions.

**Q6: OAS upload + storage.**
**Answer:** Confirmed (c) with strong preference to select existing Interface/OAS records first. Also support ad-hoc upload parsed for the session, parsed inventory persisted, raw bytes not stored unless explicitly saved through existing OAS mechanisms.

**Q7: OAS parser.**
**Answer:** Confirmed — `@apidevtools/swagger-parser` for OAS validation, dereferencing, operation/schema parsing.

**Q8: Sybase — OVERRIDE on recommendation.**
**Answer:** Sybase important for target migration pattern, but avoid JDBC complexity inside Node. PostgreSQL fully implemented in v1 execution path; Sybase as explicit DbAdapter interface/stub plus documented follow-up implementation. Do NOT build Java sidecar in this first spec unless implementation confirms no acceptable Node-compatible Sybase route. Designed-for but not fully implemented.

**Q9: Frontend entry point.**
**Answer:** Confirmed (d) — row action in `ManageArchitecturesModal` AND durable capture session list/detail views in DashboardView, mirroring Discovery UX.

**Q10: Progress UX.**
**Answer:** Confirmed (a) — polling-only for v1, every 2–3 seconds while running.

**Q11: Mutating-call confirmation lifecycle.**
**Answer:** Confirmed (a) — per session, locked once `configured`. Per-operation override → v2.

**Q12: Resumability.**
**Answer:** Confirmed (a) — not resumable in v1. Crash/failure marks session failed, retains already-written captures/diagnostics, "clone configuration from previous session" for fast restart.

**Q13: CRUD ownership.**
**Answer:** Confirmed (a) — AMS-direct CRUD via gateway proxy for all 7 tables; new service exposes only action/orchestration endpoints.

**Q14: Scope reduction.**
**Answer:** Confirmed with adjustments:
- Keep full durable table set (all 7 tables).
- Drop `/captures/{id}/rerun` from v1.
- Defer full Sybase execution per Q8 (keep DbAdapter stub).
- Keep JSONB redacted config fields.
- Keep `api_behaviour_baseline_items` as a proper table (do NOT collapse into array on baseline).

### Existing Code to Reference

**Similar Features Identified:**
- **discovery-service** — primary template for new service skeleton, port allocation, `tsx watch` setup, `src/{config,routes,services,...}` layout, axios client patterns, gateway proxy patterns.
- **AMS Liquibase changesets up to 127** — model for adding 128–134 (one changeset per table, each registered separately).
- **gateway LLM relay** — existing shared LLM access pattern; new gateway endpoint to relay tool-calling round-trips. Provider support inherits from existing gateway abstraction (OpenAI + Azure OpenAI both work via existing provider config).
- **ManageArchitecturesModal** — host of new "Capture API Behaviour Baseline" row action.
- **DashboardView (Discovery UX)** — reference for capture-session list/detail durable views; mirror Discovery's sibling-page pattern for the new "API Behaviour Baselines" surface.
- **Existing OAS / Interface storage** — selectable as authoritative OAS source in step 1 of wizard.
- **Existing Discovery polling/progress UX** — model for 2–3s polling progress UI.
- **Existing redaction/secret handling** — reuse where present; document TODO if absent.

### Follow-up Questions

**Follow-up 1 (Q4): LLM provider + timeouts.**
**Answer:** Use whatever the existing gateway/shared LLM abstraction already supports — both OpenAI and Azure OpenAI work through existing provider config. Add BOTH limits: per-tool-call timeout AND per-loop wall-clock timeout. Defaults:
- **30 seconds** per tool call,
- **5 minutes** per scenario loop wall-clock,
- **12** LLM/tool-call rounds per scenario.

**Follow-up 2 (Q5): Secret-loss UX after crash/restart.**
**Answer:** Option (b) — keep session metadata/configuration intact, block execution actions behind a "re-enter secrets" prompt. Additional rule: if the session was actively `running` when secrets were lost, **mark it `failed`** and offer the user a choice between:
- **"Clone configuration"**, or
- **"Re-enter secrets and start a new run"**.

**Follow-up 3 (Q8): DbAdapter layout + Sybase UX.**
**Answer:** Confirmed layout:
- `src/services/db/DbAdapter.ts` — interface
- `src/services/db/PostgresAdapter.ts` — full v1 implementation
- `src/services/db/SybaseAdapter.stub.ts` — explicit stub

In the wizard's DB-type dropdown, **show "Sybase" greyed-out** with a tooltip such as **"not yet implemented in v1"** (NOT hidden). Sybase is an explicit future requirement and must remain visibly on the roadmap in the UI.

**Follow-up 4 (Q9): DashboardView placement.**
**Answer:** Mirror Discovery's placement — a durable list/detail surface alongside discovery-style run views. **Preference: a sibling page under the architecture/project area**, e.g. **"API Baselines"** or **"API Behaviour Baselines"**. The `ManageArchitecturesModal` row action launches creation, but ongoing sessions and saved baselines live in the dedicated list/detail page.

**Follow-up 5 (Q14): `/rerun` cleanup.**
**Answer:** **Drop the rerun action from the v1 UI entirely.** Do not show a disabled "coming in v2" control — that is not an established pattern in this product, so a placeholder would be noise rather than signal.

## Visual Assets

### Files Provided:
None.

### Visual Insights:
N/A.

## Requirements Summary

### Functional Requirements

- New `api-migration-validation-service` (Node/TS, Express, axios, `tsx watch`, port 8092) mirrors discovery-service skeleton.
- Capture session lifecycle: draft → configured → running → completed/failed/cancelled.
- 5-step wizard: select architecture+OAS → API env+auth → optional DB sampling → endpoint inclusion → start summary.
- OAS parsing via `@apidevtools/swagger-parser`; preferred source = existing Interface/OAS records, fallback = ad-hoc upload (parsed inventory persisted, raw bytes not stored).
- Mutating-call confirmation per session, locked at `configured`.
- LLM-guided capture loop with constrained tools (`list_oas_operations`, `get_oas_operation_detail`, `list_db_metadata`, `sample_db_values`, `run_readonly_sql`, `execute_http_request`, `record_scenario_candidate`, `record_capture_note`).
- LLM provider: whatever the existing gateway LLM abstraction already supports (OpenAI + Azure OpenAI via existing provider config).
- LLM/tool-call loop limits per scenario:
  - **12 rounds** hard cap,
  - **30 seconds** per tool call timeout,
  - **5 minutes** per scenario loop wall-clock timeout.
- DB sampling: PostgreSQL fully implemented; Sybase via stubbed DbAdapter interface only.
  - DbAdapter location: `src/services/db/DbAdapter.ts`, `PostgresAdapter.ts`, `SybaseAdapter.stub.ts`.
  - Wizard DB-type dropdown shows Sybase greyed-out with "not yet implemented in v1" tooltip (visible, not hidden).
- Read-only SQL guardrails (SELECT only; row+timeout limits; allowlists).
- Secrets in-memory only during running session; redacted metadata to AMS; re-entry required after crash/restart/rerun.
- Secret-loss UX:
  - Reopened session with metadata intact but secrets gone → execution actions blocked behind "re-enter secrets" prompt.
  - Session that was actively `running` when secrets were lost → marked `failed`, with choice of "Clone configuration" or "Re-enter secrets and start a new run".
- Polling progress UI (2–3s interval) during run.
- Endpoint+scenario review UX with accept/reject/rename/notes/mask actions. **No "rerun" affordance in v1 (removed entirely, no disabled placeholder).**
- Save accepted captures as durable API Behaviour Baseline with name + warnings.
- "Clone configuration from previous session" action for fast restart after failure.
- All 7 AMS tables retained:
  1. `api_behaviour_capture_sessions`
  2. `api_behaviour_operations`
  3. `api_behaviour_scenarios`
  4. `api_behaviour_captures`
  5. `api_behaviour_diagnostics`
  6. `api_behaviour_baselines`
  7. `api_behaviour_baseline_items`
- Liquibase changesets 128–134, one per table, individually registered.
- AMS-direct CRUD (proxied through gateway) for all 7 tables; new service exposes only orchestration/action endpoints.
- Frontend dual entry point:
  - `ManageArchitecturesModal` row action launches creation wizard.
  - Sibling page under the architecture/project area ("API Baselines" / "API Behaviour Baselines") hosts durable list/detail of capture sessions and saved baselines, mirroring Discovery's pattern.

### Reusability Opportunities

- discovery-service skeleton (folder layout, port pattern, watch, axios clients, gateway-proxy registrations).
- discovery-service polling progress pattern.
- DashboardView discovery list/detail UX (sibling-page pattern is the model).
- ManageArchitecturesModal row-action insertion point.
- gateway shared LLM abstraction (extend with tool-calling relay endpoint; reuse provider config for OpenAI/Azure OpenAI).
- Existing OAS/Interface storage for OAS source selection.
- Existing redaction/secret patterns (or document TODO).
- AMS Liquibase pattern for multi-table feature additions.

### Scope Boundaries

**In Scope:**
- New `api-migration-validation-service` per spec.
- Full 7-table durable AMS persistence (changesets 128–134).
- Gateway LLM tool-calling relay endpoint (provider-agnostic via existing abstraction).
- AMS-direct CRUD via gateway proxy for all 7 tables.
- Service-owned action/orchestration endpoints (parse-oas, test-api-connection, test-db-connection, start, cancel, get-status, get-operations, get-captures).
- 5-step wizard + review UX.
- Entry points: `ManageArchitecturesModal` row action AND sibling "API Behaviour Baselines" page under the architecture/project area for durable list/detail.
- Polling-only progress (2–3s).
- Per-session mutating-call confirmation (locked at configured).
- PostgreSQL DB sampling fully implemented; Sybase DbAdapter stub with greyed-out wizard option.
- "Clone configuration" restart aid; "Re-enter secrets and start a new run" path for sessions that crashed mid-run.
- Secrets-in-memory only model with explicit secret-loss UX rules.
- JSONB redacted config fields.
- `api_behaviour_baseline_items` as a proper table.
- LLM tool guardrails + redaction + masking + bounded retry/refine.
- LLM loop limits: 12 rounds / 30s per tool call / 5min wall-clock per scenario.

**Out of Scope:**
- `/captures/{id}/rerun` endpoint AND any "rerun scenario" UI affordance (no disabled placeholder either).
- Full Sybase execution (interface stub only; documented follow-up; greyed-out in wizard).
- Per-operation mutating override (v2).
- Full session resumability after crash (clone-config / re-enter-secrets-new-run used instead).
- WebSocket/SSE progress (v2).
- Java sidecar for Sybase (unless impl confirms no Node-compatible route).
- API reconciliation against target service.
- DB reconciliation, data migration, proxy/log capture, OAS generation, migration roadmap/backlog generation, full business-rule equivalence proof.
- DB engines beyond Sybase/PostgreSQL.
- Free-form unrestricted SQL.
- Production API/DB execution.

### Technical Considerations

- Node/TS, Express, axios, `tsx watch`, port 8092 — must not collide with existing service ports.
- `@apidevtools/swagger-parser` for OAS work.
- AMS Liquibase changeset numbering must continue cleanly from 127.
- Per the "Liquibase immutable changesets" feedback, new changesets only — never edit applied ones.
- Per "AppShell model cache" memory: any AMS writes that need to surface to UI need a frontend dispatch / cache invalidation path.
- LLM relay: gateway endpoint design must handle tool-call request/response round-trips and enforce all three limits (12 rounds / 30s tool call / 5min wall-clock). Provider selection inherits from existing gateway LLM abstraction (OpenAI + Azure OpenAI).
- Secrets never persisted; Architect must re-enter on rerun/clone. Secret-loss UX must distinguish "session idle" (block actions, prompt for secrets) from "session was running" (auto-fail + offer clone OR re-enter-and-start-new-run).
- PostgreSQL: existing Node pg driver path acceptable. Sybase: design DbAdapter interface so a future implementation (Node driver if available; else sidecar) can slot in without rework. Adapter layout fixed: `src/services/db/DbAdapter.ts` + `PostgresAdapter.ts` + `SybaseAdapter.stub.ts`.
- Wizard DB-type dropdown must include Sybase as a visible-but-disabled option with "not yet implemented in v1" tooltip — do not hide.
- Frontend dual entry-point: row action in `ManageArchitecturesModal` for creation; sibling page ("API Behaviour Baselines") under the architecture/project area for durable list/detail of sessions and baselines (Discovery's sibling-page pattern is the explicit model).
- Removal of `/captures/{id}/rerun` is total: API endpoint removed, review-UX scenario "rerun" action removed, no disabled placeholder.
