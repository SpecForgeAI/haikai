# Spec Y — Data-migration runner

**Status:** building (lean). Reframe doc §5, §8. Second runner gap.

## Purpose

Execute the source→target data pipe that the pack currently only **documents**.
`gateway/src/services/dbMigrationPack/dataScripts.ts` emits extract→`COPY`
templates + manifest but "does NOT execute it." Spec Y runs it: source read →
ruleset transform → target `COPY`, **generic + ruleset-driven** (NOT
per-migration bespoke ETL).

## Changes

- New data-migration runner in **AMVS** (`api-migration-validation-service`),
  beside the `DbAdapter` / `PostgresAdapter` / `SybaseAdapter` + data-parity
  comparator (Spec P).
- Consume the pack's generated data manifest / scripts (five-phase ordering:
  structural → bulk load → FKs / indexes → reseed sequences → incremental).
- Apply ruleset transforms on values during transfer (reuse the migration-pair
  ruleset strategies used by the comparator, in the **apply / forward**
  direction).
- Credentials per-invocation, in-memory only, never persisted / logged.

## Acceptance

- Given a generated pack + source rows, writes transformed rows to the target
  via `COPY` / upsert; row counts + a sample verify against source through the
  ruleset.
- Ruleset-cited transforms (which rule applied per column type).
- Unit / integration tested here (embedded / Testcontainers target;
  adapter-level source fixtures); live source→target validation on the work
  machine via predicate logging.
- **Generic core:** no engine name in the runner logic (engine specifics via
  ruleset / pack) — `engineNameGuard` respected.

## Out of scope

- Schema apply (Spec X).
- Data-parity reconciliation itself (Spec P comparator, invoked in W's DB
  reconcile).
