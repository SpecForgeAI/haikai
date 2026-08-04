# Spec 3 — Sybase schema harvest + model backfill

Program: `agent-os/planning/2026-08-03-manual-work-and-structural-gaps-program.md`
Depends on: Spec 2 (findings dispositions).

## Key discovery (changed the shape)

Full Sybase live-DB introspection ALREADY EXISTS:
`discovery-service/src/services/databasePacks/sybase/*` (catalog walk via the
`sybase-discovery-sidecar` JVM service — sysobjects/syscolumns/sysindexes/
sysreferences/syscomments; jTDS→jConnect auto-fallback), and the 2026-08-01
save-back already carries structural fidelity ADDITIVELY into the AMS model
(constraints_metadata, fk_columns, 6 attribute fidelity slots) via the MCP
server's `save_approved_candidates`. So Spec 3 is ORCHESTRATION, not
introspection:

    findings panel → one call →
      discovery run (metadata-only: profilingMode 'none') →
      poll to COMPLETED →
      approve structural candidates (deterministic catalog truth; save-back
      is additive and never overwrites populated fields — auto-approval is
      the designed behaviour for THIS flow) →
      MCP save_approved_candidates (commit) →
      regenerate DB pack →
      return refreshed finding states (harvest-resolved findings are simply
      no longer emitted — auto-cleared).

## Endpoints (gateway)

- `POST /projects/:projectId/db-migration-packs/structural-harvest`
  { architecture_id, target_architecture_id?, host, port, database_name,
    username, password, sybase_driver?, include_schemas?, service_id? }
  → staged result { runId, stage: completed|scan_failed|save_failed|
    regenerate_failed, savedBack, packRegenerated, findings[] }.
  Credentials per-request only — never persisted, never logged.
- `POST /projects/:projectId/db-migration-packs/test-source-connection`
  → discovery-service `/discovery/db/test-connection` pass-through
  (dbEngine defaulted to sybase) for the FE modal probe.

Service module: `gateway/src/services/dbSchemaHarvest.ts` (deps-seam,
poll timeout default 10min).

## FE

"Harvest from source DB" button on the Structural findings panel →
credentials modal (probe + harvest) → staged progress → refetched findings.

## Upload fallback

Deferred follow-up: a DDL-file upload entry into the same candidate pipeline
for environments without connectivity (the user's environment HAS
connectivity, so harvest-first shipped alone).
