# schema-apply-runner (Spec X)

A generic **Spring Boot + Liquibase bootstrap** that *applies* a generated DB
migration pack's changelog to a target database as it boots, then exits with a
status code that reflects the outcome. Part of the plane-based migration
execution reframe (`agent-os/planning/2026-07-17-plane-based-migration-execution-shaping.md`,
§5 — the schema half of the two "generate vs apply" runner gaps).

## Why it exists

The gateway `dbMigrationPack` **generates** a deterministic Liquibase changelog
(`liquibase/db.changelog-master.xml` + per-table / FK / index / sequence-seed
changesets). Generation is not application — something has to *run* Liquibase
against the target. This runner is that something: the same mechanism a real
Spring target service uses to apply its schema on boot.

## Generic by construction

The runner never names a source or target engine. It drives Liquibase against
whatever changelog it is pointed at; every engine specific (type mappings,
dialect rewrites, phase ordering) is baked into the **pack content** by the
generator and the migration-pair ruleset. Targeting another engine is a matter
of the pack's SQL plus the JDBC driver on the classpath — not a code change
here.

## Two-phase apply (Liquibase contexts)

The pack tags its changesets so schema application can straddle the data load:

- `context:structural` — tables, PKs, unique/check constraints (no FKs, no
  non-PK indexes).
- `context:post-load` — all FKs + indexes once, then sequence/identity reseed.

So the **deploy orchestration** invokes this runner **twice**, straddling the
data load:

1. `SCHEMA_APPLY_CONTEXTS=structural` → build empty tables.
2. *(data-migration runner, Spec Y, loads the data)*
3. `SCHEMA_APPLY_CONTEXTS=post-load` → apply FKs/indexes, reseed sequences.

The sequencing lives in the **deployment layer** (a compose chain / k8s Job set /
IVS deploy step), gated on each phase exiting `0` — see **Dispatch** below. The
gateway's phased executor (Spec W) governs the *run's* plane gating and pause,
but it cannot spawn this JVM, so it never invokes the runner directly.

Leaving `SCHEMA_APPLY_CONTEXTS` unset applies **all** changesets at once — valid
for a schema-only migration with no data step.

## Dispatch (deploy-time)

This runner is applied at **deploy time**, as the target service is stood up —
the Node gateway cannot spawn a JVM, so the dispatch is a deployment-level
integration, never gateway code. Three artefacts make it dispatchable:

- **`Dockerfile`** — packages the runner as a one-shot image (multi-stage,
  Temurin 21, non-root). `docker build -t schema-apply-runner:latest .`
- **`deploy/docker-compose.db-plane.yml`** — a runnable example of the DB-plane
  sequence (structural → data-migrate → post-load → target boot), gated with
  `depends_on: { condition: service_completed_successfully }` — the compose
  primitive that matches the runner's exit-code contract.
- **`docs/deploy-dispatch.md`** — the agent-followable dispatch contract (env
  wiring, two-phase sequence, exit-code gating, credential discipline, how it
  slots into the target-service deploy, and the pack-materialisation
  responsibility).

## Configuration (all via environment)

| Env var | Meaning |
|---|---|
| `SCHEMA_APPLY_JDBC_URL` | Target JDBC URL |
| `SCHEMA_APPLY_DB_USER` / `SCHEMA_APPLY_DB_PASSWORD` | Target credentials (process env only) |
| `SCHEMA_APPLY_PACK_ROOT` | Filesystem root of the generated pack (the dir containing `liquibase/`). Empty ⇒ resolve changelog from the classpath |
| `SCHEMA_APPLY_CHANGELOG` | Master changelog path, relative to the pack root (default `liquibase/db.changelog-master.xml`) |
| `SCHEMA_APPLY_CONTEXTS` | Comma-separated Liquibase contexts; empty ⇒ all |
| `HAIKAI_RUN` / `HAIKAI_PROJECT` / `HAIKAI_ARCH` | Correlation ids stamped on every trace line |
| `HAIKAI_TRACE` | `off` \| `summary` \| `detail` (see `docs/trace-logging.md`) |

**Credential discipline:** the target datasource is Spring's standard
`spring.datasource.*`, sourced from the environment at invocation. Credentials
are never written to a persisted file and never logged — the trace config header
emits a `db_creds_present` boolean only.

## Run

```
mvn -f schema-apply-runner/pom.xml spring-boot:run
# or, packaged:
java -jar schema-apply-runner/target/schema-apply-runner-1.0.0-SNAPSHOT.jar
```

Exit code `0` = the requested contexts have no unrun changesets left; non-zero =
the apply failed. The apply self-scores as `EXEC.SCHEMA.*` predicates on the
shared trace log so a run is judgeable by `docs/run-judge`.

## Tests

`mvn -f schema-apply-runner/pom.xml test` — drives the runner against in-memory
H2 (PostgreSQL mode): full apply, context filtering, failure→non-zero exit,
idempotent rerun, and predicate/scorecard emission. No Docker required. The live
Sybase→PostgreSQL apply of a real generated pack is a work-machine shakedown via
`HAIKAI_TRACE=summary`.

> Note: a benign compile warning flags Liquibase 4.24's deprecation of the
> `update(Contexts, LabelExpression)` convenience method; it remains functional
> and stable across the Liquibase 4.x line shipped with Spring Boot 3.2.5.
