# Spec F — T-SQL Affinity & Consumer Revalidation

**Program:** Code-Tier Oracle (carried over from the Persistence-Tier Oracle Program where
it was deferred; letter retained). See
`agent-os/planning/2026-07-06-code-tier-oracle-gap-analysis.md` §P8 for the full grounding.
**Closes:** Gap P8 — when the database moves Sybase→PostgreSQL, the code paths whose inline
SQL or stored-proc calls break cannot today be enumerated, planned, or re-verified.

## Goal

Every piece of Java-side SQL is dialect-classified; every proc call from code is matched to
the discovered proc inventory; "which endpoints touch table X / proc Y" is a single indexed
query; dialect-affected endpoints are auto-flagged in the plan with rewrite guidance; and a
scoped revalidation run can prove exactly the affected endpoints still behave identically.

## Evidence / current behaviour (verified)

- SQL is captured VERBATIM but dialect-blind: `endpointDataEffectResolver.ts:413–438`
  (`@Query` jpql/native), `:453–464` (JdbcTemplate literals → unresolved findings with SQL),
  MyBatis annotations; no classifier for HOLDLOCK/getdate/@@identity/`*=`/TOP/#temp/etc.
  anywhere in discovery or gateway.
- Proc-call strings captured but unmatched: `springClassicFindingScanner.ts:151–159`
  (`SQL_PROC_KEYWORD_REGEX` EXEC/CALL, `stored_procedure_or_jdbc_usage` finding at
  `:511–553`) — never matched against the sidecar's proc inventory
  (`sybaseIntrospection.ts:397–415`, procs carry `language: "TSQL"`).
- AMS `endpoint_data_effects`: repository finders `findByModelFileId`/`findByEndpointId`
  ONLY; NO REST controller; NO reverse query by data entity; NO index on
  `data_entity_point_id`.
- AMVS diffs accept whole baselines — no endpoint-scoped runs (Spec I builds the scoping;
  this spec consumes it).
- DB-pack translation drafts have no linkage back to calling endpoints.

## Scope

### 1. T-SQL dialect classifier (discovery-service, deterministic)

New `discovery-service/src/services/findings/sqlDialectClassifier.ts`, run over every
captured SQL text (resolved edges' `query_text`, unresolved-persistence findings' SQL,
MyBatis XML SQL once Spec M lands):

- Pattern families (each with construct name + matched text + position):
  functions (`getdate`/`getutcdate`, `dateadd`/`datediff`/`datepart`, `convert(` style,
  `isnull`, `charindex`, `stuff`, `patindex`, `str(`), globals (`@@identity`, `@@rowcount`,
  `@@error`, `@@trancount`), lock hints (`HOLDLOCK`, `NOLOCK`, `READPAST`, `UPDLOCK`),
  legacy joins (`*=`, `=*`), `TOP n` (incl. no-parens form), temp tables (`#name`),
  `RAISERROR`, `PRINT`, proc conventions (`sp_`/`xp_` prefixes, `EXEC`/`EXECUTE`),
  Sybase idioms (`SELECT ... INTO #`, `SET ROWCOUNT`).
- Output per SQL text: `dialect: 'tsql' | 'ansi' | 'unknown'` (tsql iff ≥1 construct;
  unknown for dynamic/fragmentary SQL), `non_portable_constructs[]` with per-construct
  **suggested PostgreSQL equivalent** REUSED from the DB pack's v1 function/type mapping
  tables (`gateway/src/services/dbMigrationPack/` mappings are the single source; exported
  or mirrored via a shared constant module — no second mapping table).
- Persistence: classification stamped into the edge's `path_metadata_json`
  (`sql_dialect`, `non_portable_constructs`) and onto unresolved findings' detail;
  new finding type `tsql_dialect_in_code` (severity medium; high when constructs include
  lock hints or `@@identity`) — capped per the existing MAX_FINDINGS_PER_TYPE_PER_RUN.

### 2. Proc-call linkage

- Extract proc names from `SimpleJdbcCall` (`withProcedureName`/`withFunctionName`),
  `CallableStatement` (`{call x(...)}`), and `EXEC x` strings (existing capture sites).
- Match (case-insensitive, schema-tolerant: `dbo.x` ≡ `x`) against the discovered proc
  inventory (sidecar-sourced committed physical entities / db findings).
- Matched → data-effect-style edge from the endpoint (or internal process, post-Spec M) to
  the PROC (data_entity_point convention extended for proc objects) with
  `query_kind: 'proc_call'` and the proc name verbatim.
  Unmatched proc-name strings → `proc_call_unmatched` finding (nothing silent).

### 3. AMS: data-effects REST + reverse query (shared foundation with Spec H)

- NEW `EndpointDataEffectController`:
  - `GET /api/model/projects/{p}/architectures/{a}/endpoint-data-effects?endpoint_ids=...`
    (Spec H's read)
  - `GET ...?data_entity_point_ids=...` and `?object_name=...&object_kind=table|proc`
    (reverse queries: all effects — hence endpoints — touching a table/proc)
- Index on `endpoint_data_effects(data_entity_point_id)` — NEW Liquibase changeset
  (never edit an existing one).
- DTOs snake_case (wire-format default; no annotation).
- Gateway client `endpointDataEffectsClient.ts` with both directions.

### 4. Affected-consumer computation + plan integration

- New gateway service `dbChangeConsumerResolver.ts`:
  input = the DB pack's object set (tables from the IR, procs/views with translation
  drafts); output = the AFFECTED ENDPOINT SET via the reverse queries + dialect flags
  (endpoint affected iff: touches a translated proc, OR carries `tsql` dialect SQL, OR
  touches a table whose pack changeset alters shape).
- Spec G integration: affected endpoints get flag `dialect_affected` → individual stories;
  the story's spec text (Spec H) embeds, verbatim: the offending SQL, the construct list,
  and the pack's suggested equivalents (rewrite guidance carried, not invented).
- Readiness surfacing: `MigrationDiscoveryContext` database summary gains
  `affectedConsumerCount` (+ gap code `db_consumers_unrevalidated` with wayfinding entry)
  so the DB-side review shows the code-side blast radius.

### 5. Scoped revalidation runs

- Reuse Spec I's `endpoint_scope` on replay/diff. Add a gateway convenience:
  `POST .../revalidate-db-consumers` — computes the affected set (§4), creates the scoped
  target replay + diff against the current pinned baseline, returns the run/diff ids.
- Migrate linkage: the DB streams' closure story (Persistence program) references this run;
  Spec I's completion gate treats `db_consumers_unrevalidated` + an unclean scoped diff as
  blocking for the affected stories.

## Non-goals

- Rewriting the SQL automatically (guidance is carried; the implementer + parity loop do
  the proof). Full T-SQL parsing (pattern classification is deliberate — deterministic,
  auditable, no parser dependency). Trigger/view consumer analysis beyond proc/table
  touch (covered transitively by table effects).

## Acceptance criteria

1. **CLASSIFIER PIN (golden set):** a fixture set of ~30 SQL texts (Sybase-idiomatic,
   ANSI, ambiguous) classifies deterministically; `getdate()` → suggested `now()`,
   `isnull(a,b)` → `coalesce(a,b)`, `HOLDLOCK` → locking-note guidance; ANSI-only text →
   `ansi`, no findings.
2. **MATCH PIN:** `SimpleJdbcCall.withProcedureName("dbo.sp_update_order")` + sidecar proc
   `sp_update_order` → proc edge with verbatim name; unknown proc name →
   `proc_call_unmatched` finding.
3. **REVERSE PIN:** REST reverse query by table/proc returns exactly the seeded effects;
   index present (changeset test).
4. **AFFECTED PIN:** pack with 1 translated proc + 1 tsql-flagged endpoint + 1 clean
   endpoint → affected set = the two, not the third.
5. **PLAN PIN:** affected endpoint is absent from its interface cluster and has an
   individual `dialect_affected` story whose spec text embeds the SQL + construct list +
   suggested equivalents verbatim.
6. **REVALIDATE PIN:** convenience route creates a replay+diff scoped to exactly the
   affected set (mock AMVS asserts scope).
7. Mapping reuse: classifier suggestions come from the DB pack mapping module (single
   source asserted by import, not duplication).

## Test plan

Classifier golden tests (pin 1); linkage tests (pin 2); AMS controller/repository/changeset
tests (pin 3); resolver tests (pin 4); planner integration with Spec G suite (pin 5);
gateway route test with mocked AMVS (pin 6). Baseline-red discipline throughout.

## Dependencies & sizing

Depends on: Spec I's scoped replay (or builds the AMVS scope filter first if F precedes I —
coordination note), Spec G's flag hook, shares the AMS controller with Spec H. Enriched by
Spec M (MyBatis XML SQL feeds the classifier). Size: **M**. Natural slot: after G/H/I,
before the DB-program live shakedown exercises proc translation end-to-end.
