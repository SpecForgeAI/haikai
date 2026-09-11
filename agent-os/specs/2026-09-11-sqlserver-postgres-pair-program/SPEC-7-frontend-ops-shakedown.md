# SPEC 7 — Frontend, ops, shakedown checklist

Design of record: shaping §3 rulings 2, 8; §7 prerequisite. Size: M. Depends on: S6. Wave F.

## Goal
Every UI surface that names or selects a DB engine offers SQL Server with the right fields and
labels driven by the pair display names; ops scripts start the renamed sidecar; the BUILD-LOG
carries the exact user prerequisite and a screenshotable shakedown checklist.

## Tasks
- 7.1 Wizards + modals: `StartCaptureSessionWizard.tsx` (`mssql` option + auth extras block;
  advance gate uses `isDbEngineKey`), `StartProcCaptureSessionWizard.tsx` (engine default from the
  project's discovered source engine via `discoveryApi` latest DB run `steps_payload.database.
  engineKey`; port from `DB_ENGINE_DEFAULT_PORT`), `DbMigrationPackCredentialsModal.tsx`
  (`MODE_COPY` engine label from the pack manifest `source_engine_display`; port per engine),
  `DbMigrationPackHarvestModal.tsx` (engine from manifest; driver select only for sybase; auth
  extras for mssql; title "Harvest from source DB — live <display> connection"),
  `DbMigrationPackTargetBuildModal.tsx` (source engine from manifest), `RunReconciliationModal.tsx`
  (options from `DB_ENGINE_LABEL`), `S0RestorePanel.tsx` (options + prefill for mssql),
  `MigrationBookOfWorkReviewWorkspace.tsx:1247,2589` (engine from context, not literal),
  `DbMigrationPackView.tsx:357` pair label from `source_engine_display → target_engine_display`,
  `DbMigrationPackTranslationReviewer.tsx:224,261` "Source T-SQL (<display>)", workbench
  untranslatable-reason chip (S6 column), decision categories from S5 rendered in the decisions
  panel with their option labels, new finding labels (S2).
- 7.2 API modules: `dbMigrationPackApi.ts` credentials + manifest fields (`pair_id`,
  `source_engine_display`), `procBehaviourApi.ts`, `s0SnapshotApi.ts`, `migrationProgressReportApi.ts`,
  `migrationDeliveryDashboardApi.ts` carry `mssqlAuth` where credentials are posted.
- 7.3 Ops: `install-run-all.ps1`, `install-run-all.sh` (add the sidecar — it is missing there
  today), `run-all-file-mode.ps1` (unchanged: no sidecar by design? — add it, it is required for
  DB migrations), `stop-all.ps1` comment, root `README.md` service table + a "Source database
  prerequisites" section (shaping §7 verbatim), `docker-compose.yml` already renamed in S1;
  `agent-os/diagnostic-runbook.md` step 0.7 env var name.
- 7.4 BUILD-LOG: per-spec rows, work-machine pickup (FRESH CLONE; AMS rebuild for changesets 232
  + 233; sidecar rebuild under the NEW directory name; all restarts), the prerequisite block, and a
  10-line screenshotable shakedown checklist: install SQL Server 2022 Developer → restore WWI →
  create login → scan → S0 row → pack → decisions → target build → translate & reconcile → data
  load → parity → progress report.
- 7.5 Tests: vitest for each touched component (option lists, engine-driven labels, mssql auth
  block rendering, prefill), `coreTechPersistenceCheck` supported list.

## Verification
frontend vitest touched suites + `tsc --noEmit` on touched files; `powershell -NoProfile -Command
"Get-Content install-run-all.ps1 | Out-Null"` parse check; compose config parses.

## Done when
No production UI string names an engine that the data does not supply; the sidecar starts from
every install script; BUILD-LOG complete.
