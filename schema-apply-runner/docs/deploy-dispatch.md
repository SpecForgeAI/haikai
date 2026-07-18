# Schema-Apply Dispatch — Deploy-Time Integration (Spec X)

> **Audience: an LLM coding/deploy agent** (Claude Code, Kiro, an IVS deploy
> step, a CI pipeline author) wiring the schema-apply runner into a target
> service's deployment.
>
> **Style:** describes WHAT must be true, not exactly HOW — mirrors
> `implement-verify-service/docs/docker-deployment.md`. Pick the OS/orchestrator
> specifics (compose vs k8s Job vs init-container vs bare `java -jar`) to fit
> the deploy target.

---

## Why this is a deploy-time concern (and not gateway code)

The schema-apply runner (Spec X) is a **standalone JVM process**: Spring Boot +
Liquibase-on-boot that applies a generated migration pack's changelog to the
target database, then exits with a status code. It is the same mechanism a real
Spring target service uses to apply its schema on boot.

The Node gateway that orchestrates a migration run **cannot spawn a JVM**, and
the schema must be applied **as the target service is stood up** — a deployment
moment, not a gateway request. So X's *dispatch* lives in the **deployment
layer**: a pipeline step (IVS, compose, a k8s `Job`, an init-container) runs the
runner at deploy time and gates the next step on its exit code.

This is the deliberate split:

| Concern | Owner |
|---|---|
| **Run orchestration** — plane gating, pause/approve, firing data-migration (Y) + data-parity reconcile (P) during a run | Node gateway phased executor (Spec W) — already wired |
| **Schema apply at deploy time** — running Liquibase against the real target as the service stands up | **This runner + this deploy integration (Spec X dispatch)** |

The gateway's DB-plane pause is where a human reviews the reconcile and clicks
*approve & continue*; the actual schema/data application against the live target
DB is this deploy-time integration.

---

## The runner contract (what a dispatcher relies on)

A one-shot process. Configure it entirely by environment; gate on its exit code.

### Inputs (environment only)

| Env var | Meaning |
|---|---|
| `SCHEMA_APPLY_JDBC_URL` | Target JDBC URL (e.g. `jdbc:postgresql://host:5432/target`) |
| `SCHEMA_APPLY_DB_USER` / `SCHEMA_APPLY_DB_PASSWORD` | Target credentials — process env only |
| `SCHEMA_APPLY_PACK_ROOT` | Filesystem root of the generated pack (the dir containing `liquibase/`). Empty ⇒ resolve the changelog from the classpath |
| `SCHEMA_APPLY_CHANGELOG` | Master changelog path relative to the pack root (default `liquibase/db.changelog-master.xml`) |
| `SCHEMA_APPLY_CONTEXTS` | `structural` \| `post-load` \| empty (⇒ apply all at once) |
| `HAIKAI_RUN` / `HAIKAI_PROJECT` / `HAIKAI_ARCH` | Correlation ids stamped on every trace line |
| `HAIKAI_GIT_SHA` | Stamped into the trace config header (provenance) |
| `HAIKAI_TRACE` / `HAIKAI_TRACE_FILE` | `off`\|`summary`\|`detail`; shared trace file path |

### Output (the gate)

- **Exit `0`** — the requested contexts have **no unrun changesets left**: the
  apply is complete. The dispatcher proceeds to the next step.
- **Non-zero** — the apply failed (or left changesets unrun). The dispatcher
  **halts the DB plane** (hard block); a human decides.
- The apply **self-scores** as `EXEC.SCHEMA.01/02` predicates on the shared
  trace log, so a run is judgeable by `docs/run-judge` after the fact.

### Credential discipline (must hold in every dispatch form)

Target credentials live in the **process environment only**. Never bake them
into an image layer (no `COPY .env`, no `ENV SCHEMA_APPLY_DB_PASSWORD=…`), never
write them to a persisted file, never log them. Pass them at run time
(`--env-file`, compose `environment:` from `${VAR}`, a k8s `Secret`). The runner
emits a `db_creds_present` boolean in its trace header, never the value.

---

## The two-phase sequence (why the runner is invoked twice)

The pack tags its changesets so schema application can **straddle the data
load**:

- `context:structural` — tables, PKs, unique/check constraints (no FKs, no
  non-PK indexes). Empty tables the data load can `COPY` into fast.
- `context:post-load` — all FKs + indexes, then sequence/identity reseed. Cheap
  and correct only **after** the rows are in.

So the DB-plane deploy runs, each step gated on the previous exiting `0`:

1. `SCHEMA_APPLY_CONTEXTS=structural` → build empty tables.
2. **data-migration runner (Spec Y)** → bulk-load source → forward-transform →
   target.
3. `SCHEMA_APPLY_CONTEXTS=post-load` → apply FKs/indexes, reseed sequences.
4. **data-parity reconcile (Spec P)** → the tool compares source vs target →
   **HARD PAUSE** for human approval.
5. **target service boots** against the ready schema.

A **schema-only** migration (no data step) can leave `SCHEMA_APPLY_CONTEXTS`
unset and apply everything in one pass.

`deploy/docker-compose.db-plane.yml` is a runnable example of steps 1–3 + 5,
gated with `depends_on: { condition: service_completed_successfully }` — the
compose primitive that matches the runner's exit-code contract.

---

## How a dispatcher invokes it

Pick the form that fits the deploy target; the contract above is identical
across all of them.

- **Container (recommended).** Build the image from this module's `Dockerfile`
  (`docker build -t schema-apply-runner:latest schema-apply-runner/`). Run it as
  a one-shot: compose service gated by `service_completed_successfully`, a k8s
  `Job` (or an init-container on the target `Deployment`), or `docker run --rm`.
- **Bare jar.** `mvn -f schema-apply-runner/pom.xml -DskipTests package` then
  `java -jar target/schema-apply-runner-*.jar` with the env set. Useful for a
  work-machine shakedown.

### Materialising the pack

The runner reads a **filesystem** pack root (`SCHEMA_APPLY_PACK_ROOT`). The
gateway *generates* the pack; a deploy step must put it where the runner can
read it. How is a pipeline choice — extract it from AMS, check it into the
target repo, or write it from the pack generator — but it MUST exist at
`SCHEMA_APPLY_PACK_ROOT` (a shared volume / mounted `ConfigMap` / a path in the
build context) before step 1 runs. The same pack root feeds the data-migration
runner in step 2.

### Slotting into the target-service deploy

Two equivalent placements:

- **Before boot (preferred for a like-for-like migration):** run the two
  schema-apply phases + data load as deploy steps, then start the migrated
  service against the ready DB (what the compose example shows).
- **On boot (a "real Spring app applies its own schema" deploy):** the target
  service itself carries the pack changelog and runs Liquibase-on-boot. This
  runner is that mechanism extracted so it can straddle the data load; a target
  that has no separate data step can fold `context` = all into its own startup.

---

## Verification (after a dispatch)

Run with `HAIKAI_TRACE=summary` and confirm, in the shared trace log:

- a `HAIKAI_CONFIG` header for service `schema-apply` with `db_creds_present:true`
  and the expected `contexts`;
- `EXEC.SCHEMA.01` **pass** (`0 unrun changesets remain`) and `EXEC.SCHEMA.02`
  **pass** for each phase you ran;
- a `HAIKAI_SCORECARD` for stage `EXEC` with `fail: 0`;
- process **exit code `0`**.

Any `EXEC.SCHEMA.*` **fail** or non-zero exit is a DB-plane hard block — surface
it, don't paper over it. `scripts/haikai-trace-summarize.mjs` + `docs/run-judge`
render the verdict.

The live Sybase→PostgreSQL apply of a real generated pack is a **work-machine
shakedown** (needs a real target DB); the H2-backed unit tests
(`mvn -f schema-apply-runner/pom.xml test`) cover the apply/context/exit/predicate
logic without Docker.

---

## What this deliberately does NOT specify

- The orchestrator — compose vs k8s `Job` vs init-container vs bare jar; pick
  per deploy target.
- How the pack gets to `SCHEMA_APPLY_PACK_ROOT` — a pipeline choice (see above).
- The target-service image — whatever IVS built for the migration.
- Secrets management — plain `--env-file` for a local box; a `Secret` / Vault /
  cloud SM if the environment has one. Only the credential discipline above is
  non-negotiable.
- Rollback of a partial apply — Liquibase changesets are the unit; a failed
  apply halts the plane and a human decides. Not automated here.
