# Model-Seeded Capture Inventory — Guaranteed Operation-Capture Completeness

## Problem / north star
The product is a like-for-like migration oracle; the API behavioural baseline is its ground truth, and discovery is supposed to seed COMPLETE operation capture. Today the capture session's operations inventory comes from the USER-SUPPLIED OAS/WADL file, not from the discovered endpoint set committed to the architecture model. If the WADL is stale or partial, the baseline silently has holes — and everything downstream (target replay, diff, reconciliation, migration-plan readiness) trusts that baseline. The discovery↔harness inventory reconciliation exists (MigrationDiscoveryContextService coverage gate C → DISCOVERY_HARNESS_INVENTORY_MISMATCH) but is ADVISORY only.

## Solution direction (the template-stamping philosophy applied to capture)
Enumeration belongs to code, not to user-supplied files:
1. SEED the capture session's operations inventory FROM THE COMMITTED MODEL's endpoint set (REST endpoints with method/path; SOAP operations with their message bindings — the SOAP-aware identity key already exists in the reconciliation gate). The OAS/WADL becomes ENRICHMENT (request/response schema detail merged onto matched operations), not the enumerator.
2. COVERAGE GUARANTEE in code: every in-scope committed endpoint becomes exactly one operation row — included, or explicitly excluded-with-reason. Nothing silently absent.
3. BLOCKING-BY-DEFAULT mismatch: starting a capture run (and/or activating a current baseline) with unaccounted model endpoints is blocked unless the user explicitly overrides with a persisted justification. The existing advisory readiness gap then clears naturally when coverage is genuine.
4. BOTH directions surfaced: model-endpoint-without-operation (a hole in the oracle) AND operation-without-model-endpoint (the harness knows something discovery doesn't → a discovery gap worth a finding or re-scan prompt).

## Existing foundations (verify in repo)
- api-migration-validation-service: captureSessionOrchestrator.ts (operations inventory build, oasInventory), oasParser.ts / oasInventoryStore.ts / wadlToInventory.ts, scenario generation + seeds, capture wizard flow (frontend StartCaptureSessionWizard.tsx).
- AMS committed model: endpoints with method/path + protocol_metadata_json (SOAP), endpoint response contracts (changeset 168 endpoint-response-contract), interfaces with message bindings; api_behaviour_operations rows per session.
- MigrationDiscoveryContextService coverage gate (C) INVENTORY reconciliation — the SOAP-aware matching key to reuse, both-directions logic already written (read-side).
- Baseline activation control (BaselinesList Activate, built 2026-06-11).
- Per-service capture scoping considerations: sessions are architecture-scoped today; endpoints belong to interfaces/services.

## Open design areas (for shaping)
- Where seeding happens: a wizard inventory step listing the model endpoints (include/exclude + reason), with OAS/WADL optionally uploaded for schema enrichment matched by the SOAP-aware key; or seed server-side at session create.
- What blocking means precisely: block Start vs block baseline Activate vs both; override semantics + persisted justification; how the override surfaces in readiness.
- Whether operation-without-model-endpoint should auto-emit a discovery finding (re-scan prompt) or just display.
- Whether the readiness gate DISCOVERY_HARNESS_INVENTORY_MISMATCH should stay advisory (it clears naturally) or harden.
- Back-compat for existing sessions/baselines created the old way.
- Scope selection: whole-architecture vs per-service/interface subsets within a session.
