# DB-Plane Execution Chain (WS2) — Design (2026-07-31)

User-locked decisions (2026-07-31): assembly = merge spec branches + deterministic
pack overlay from AMS + validation gate on ONE new branch (+MR); chain runs fully
automatically after the stage's specs implement; pause = the parity report review
(the plane-precedence gate at the next Start); schema-apply becomes run-dispatchable
(revisits "X is deployment-level only").

## Root cause being fixed

The driver's DB-plane chain (data-migration Y -> data-parity reconcile P) exists but
only fires on a `deployed` build-results outcome (`migrationExecutionDriver.ts`
advance -> `kickPlaneReconcile('db')`). `deployed` can only come from IVS
`_deploy_completed_run` = the haibox APP-SERVING deploy — a DB pack has nothing to
serve, so the outcome degrades to `implemented` and the chain never fires; X's
schema apply was Liquibase-on-boot at deploy-compose time, unreachable natively.
Net: "it just runs the 15 specs".

## The chain (gateway `migrationDbPlaneCompletion.ts`)

Trigger: build-results `implemented` for an item with `deploy_on_complete=true`
whose plane is `db` (the plane-final marker), in BOTH the per-spec advance and the
batch advance. The driver decouples the AMS marker from the IVS haibox flag: for
db-plane items the submit now sends `deployOnComplete=false` (no pointless haibox
attempt + bogus "deploy failed" error), while the AMS item keeps
`deploy_on_complete=true` as the plane-final marker.

Steps (each failure -> item FAILED with step-labelled error_detail + run HALTED —
kills the "completed successfully"/silent-502 reporting quirks):

1. ASSEMBLE (IVS job, polled): POST `/api/v2/jobs/assemblies`
   {company, project, branch_name: `db-migration/<runId8>`, spec_names (run items'
   spec_name), pack_files: [{path, content}] (gateway fetches AMS
   `/db-migration-packs` by architecture + `/{packId}/files` and inlines them),
   open_merge_request: true}. IVS: branch from origin/<default>, merge each
   `feature/<spec>[--<folder>]` branch (conflict = clear failure), overlay pack
   files at the repo target root (path-safety enforced), STRUCTURAL VALIDATION
   (master changelog XML parses; every <include> resolves; changeset ids charset;
   manifest.json parses, BOM-free), commit + push + MR. Poll
   GET /api/v2/jobs/{id} (3s interval, 15 min cap). This structurally kills:
   manifest-never-committed, 15-branches-no-runnable-whole, dangling includes.
2. SCHEMA-APPLY structural (AMVS): POST `/api/schema-apply/run`
   {project_id, architecture_id, target_db (from migrationTargetCredentialsStore
   by runId), files (liquibase files from the pack), contexts:["structural"]}.
   AMVS parses the master changelog include order + formatted-SQL changesets
   (`--changeset author:id context:x splitStatements:false`), executes each body
   via pg, records applied ids in `haikai_schema_apply_log` (Liquibase-lite
   idempotency: re-runs skip applied ids).
3. DATA LOAD: `runDataMigrationViaAmvs` directly (same gathering as the Y trigger:
   source creds from currentSystemCredentialsStore, manifest from the pack view) —
   the chain needs the pass/fail result, so it does NOT go through the fail-soft
   fire-and-forget trigger seam.
4. SCHEMA-APPLY post-load (FKs + indexes + sequence reseed): same route,
   contexts:["post-load"].
5. RECONCILE: existing `triggerDataParityReconcile` seam (report persisted; an
   unclean report blocks the next plane's Start — that gate + parityOverride IS
   the human pause, per the locked decision).
6. FINALIZE: final item -> DEPLOYED (+ pr_url = assembled MR); pending later items
   -> run AWAITING_APPROVAL (mid-book plane boundary), else run DEPLOYED.

Missing creds (e.g. gateway restarted; stores are in-memory) -> chain FAILS with an
explicit message naming what to re-register. Known limitation, documented.

## Receipts (read 2026-07-31)

- Y dispatch template: `migrationDataRunnerDispatch.ts` (creds stores, pack view via
  `defaultFetchPackView`, AMVS POST body shape, never-log-creds posture).
- AMVS is Node/TS (`api-migration-validation-service/src`): routes/index.ts
  registration, dataMigrationRun.ts route conventions (snake_case body, db block
  validation, creds function-scope only), PostgresAdapter/PostgresTargetLoader pg
  Pool patterns. Schema-apply = new route + services/schemaApply/*.
- Pack files in AMS: `GET /api/projects/{pid}/db-migration-packs/{packId}/files` ->
  DbMigrationPackFileDto {file_path, file_kind (liquibase_master |
  liquibase_changeset | bulk_load_script | incremental_script | manifest | readme),
  content, sort_order}.
- Pack layout (`dbMigrationPack/liquibase.ts`): liquibase/db.changelog-master.xml +
  changesets/000-schemas.sql, 010-tables/<s>.<t>.sql (context:structural),
  020-foreign-keys.sql, 030-indexes.sql, 040-sequences-seed.sql (context:post-load).
- IVS: spec branches are `feature/<spec>` or `feature/<spec>--<folder>` (tasks.py
  ~:660); GitManager has push_branch + create_pull_request + checkout_default_branch;
  job dispatch by type in api/__init__.py `_run_job_in_background` (:718).
- Gateway->IVS seam: `implementationLlmProxyClient.request` (Bearer auto-injected),
  used by migrationOrchestrationSubmit.ts.

## WS3 defect receipts found during this read (fix targets)

- `liquibase.ts:361-362`: `<!-- ... --contexts=structural ... -->` — `--` inside XML
  comments = illegal XML (live bug 10). Reword without double-dash.
- `liquibase.ts:165` `changesetHeader('table--${qn}')` — `--` in changeset ids broke
  Liquibase formatted-SQL parsing (live bug 11). Use `table-${qn}`.
- Casing blocker: DDL identifiers UNQUOTED everywhere in liquibase.ts (folds to
  lowercase) while `targetLoader.ts:60` `quoteIdent`s (case-exact INSERTs) — 53/65
  tables failed to load. Fix: quote-all-preserve-source-case in the DDL emitters.
- Empty 020/030 + zero PKs: emitters are correct; the IR arrived empty — the drop
  is upstream in `dbMigrationPack/inputs.ts` (constraints_metadata -> IrTable/
  IrForeignKey). Investigate + count-tied acceptance criteria.
- Dangling `050-translations.sql`: include-list assembly emits includes for files
  never generated — find in dbMigrationPackHandler/translationEmission; includes
  must resolve or generation fails; empty story -> empty-but-valid changeset.
