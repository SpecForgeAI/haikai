# Spec V — Plane-based stream vocabulary + plan generator

**Status:** building (lean). Part of the plane-based migration reframe
(`agent-os/planning/2026-07-17-plane-based-migration-execution-shaping.md`
§3, §4, §8).

## Purpose

Replace the flat 10-stream multi-select vocabulary with plane-grouped, generic
streams whose tech specifics live in the generated specs, and make stream
inclusion tier-driven (`[Persistence][Service][UI]` from the target-state
conversation).

## Changes

- Merge `target_service_api_implementation` (REST) +
  `api_soap_integration_compatibility` (SOAP) → single generic **`api_migration`**
  stream. Planner stops partitioning by protocol; the per-endpoint spec carries
  REST/SOAP detail.
- Keep `internal_processing_implementation` as its own stream (auto-detected
  from discovery: jobs / listeners / batch).
- Drop `migration_test_pack` as a stream; tests are peppered into build-story
  specs (unit / functional / integration / e2e per what the story builds).
- Promote reconciles to per-plane **auto** streams (implied, never separately
  picked): `data_parity_reconciliation_reporting` (Persistence) and
  `api_reconciliation_reporting` (Service).
- Persistence build streams: `target_database_schema_implementation` +
  `data_migration` (data always implied with Persistence — no schema-only
  toggle).
- Optional streams retained: `target_infrastructure_environment_implementation`
  (positionable) and `cutover_rollback_decommission`.
- Tier-driven inclusion: tier scope determines which streams exist; the plan
  does not re-ask.

## Files

- `gateway/src/services/migrationCodeStreamPlanner.ts` — drop SOAP partition;
  merge to `api_migration`.
- `gateway/src/services/migrationDbPackPlanner.ts` — persistence streams.
- `gateway/src/services/generatedMigrationBookOfWorkSchema.ts` — stream
  enum / schema.
- `gateway/src/config/tasks/product-manager--migration-delivery-plan.json` +
  `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md`
  — task vocabulary.

## Acceptance

- No stream splits by protocol / tech anywhere; `api_migration` is the sole API
  stream; SOAP detail appears in specs, not streams.
- `migration_test_pack` removed from vocabulary; test stories present within
  build streams.
- Reconcile streams auto-derived from in-scope build planes, not user-selected.
- Stream set derives from tier scope. Existing gateway tests green (adjusted for
  the new vocabulary).

## Out of scope

- Frontend wizard reshape (Spec Z).
- Phased execution / data-parity gate reposition (Spec W).
