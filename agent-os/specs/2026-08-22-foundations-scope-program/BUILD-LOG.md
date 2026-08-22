# Foundations & Scope Program — BUILD LOG

Autonomous build authorized 2026-08-22 ("continuously build until all
specs are complete"). Base: main d78c182a. One branch + --no-ff merge per
spec; suites green before each merge. This log is the compaction-safe
state record — update after EVERY spec merge.

| Spec | Status | Branch | Merge commit | Notes |
|---|---|---|---|---|
| 0 — Capture resilience | DONE | feature/spec0-capture-resilience | cb2b3219 (+319e8fad test restore) | AMS REBUILD needed on pickup (status machine) |
| 1 — Scope & decisions data plane | DONE | feature/spec1-scope-data-plane | 91205203 | AMS changeset 226 + Java (REBUILD on pickup) |
| 2 — DB-scan foundations review | DONE | feature/spec2-foundations-review | 67b573a7 | save-back = decisions reconciler (fresh-project ordering) |
| 3 — Capture + S0 readers | DONE | feature/spec3-capture-s0-readers | 6e2b576d | keyless detect-only + volatile S0 tolerance + scope conflicts |
| 4 — Target & rec readers | DONE | (direct main commit — convention slip) | eccf9b13 | pack choke-point filter + receipts + surrogate-for-policy |
| 5 — Joint layer + estate entry | DONE | feature/spec5-joint-layer | 565446a1 | ALL SPECS COMPLETE |

## As-built notes

### Spec 0 (merged cb2b3219, test-restore 319e8fad)
- Auth-expiry breaker: `nextAuthExpiryStreak` pure fn + AUTH_EXPIRY_STREAK_THRESHOLD=3 in captureSessionOrchestrator; finaliser maps to `paused_auth_expired`; skips end-of-run fingerprint when pausing (resume expected). AMS status machine + frontend union/badge/label/banner/gates updated.
- `fingerprintMismatchDetail` names top-10 diverged tables (rows expected->actual, +N tail).
- `groupIdenticalMessages` display-only xN collapse in the diagnostics section.
- INCIDENT: `cat >` clobbered the existing captureDiagnosticsSupport.test.ts (Write-tool guard had refused — never bypass it with shell redirection); restored from d78c182a + merged additions in 319e8fad.

### Spec 1 (merged 91205203)
- AMS: changeset 226 (migration_scope/scope_decision_ref on physical_data_entities + foundation_decisions table); PhysicalDataEntityDto/Entity/EntityMapper carry the fields (9 constructor sites patched with nulls); FoundationDecision entity/repo/dto/service/controller (GET list / PUT bulk upsert keyed by decision_key, re-answer clears stale).
- modelScope accessors in all 5 services + RATCHET guard tests (frozen baselines: gw 10 / amvs 2 / discovery 32 / mcp 9(+1 conscious writer) / fe 52).
- MCP apply_foundation_decisions: scope tags + receipts on NAMED entities (unknown skipped honestly), ADDITIVE PK promotion into constraints_metadata.primary_key (provenance foundation_promoted, never over a declared PK), decisions upserted to AMS; mounted at /mcp/tools/apply_foundation_decisions.
- committed_excluded added to discovery CandidateStatus union (frontend status is string-typed; AMS lifecycle status is passthrough).
- DESIGN NOTE for Spec 2: foundation QUESTIONS are DERIVED at review time (pure rules over candidates + stored decisions — accretion/staleness free); DECISIONS are the stored artifact. Questions never enter the candidate stream.

### Spec 2 (merged 67b573a7)
- frontend foundationRules (pure): backup_copy/temp_working/key_posture/engine_hazard; derived questions + evidence-hash settlement/staleness; FoundationsReviewPanel on the DB-run review; foundationsApi via gateway routes (GET list + POST apply).
- MCP: applyDecisionsToEntities pure core shared by the apply tool AND candidateSaveBackService (save-back reconciles stored decisions onto freshly created entities — fresh-project ordering fix); committed_excluded status flip at step 11; scope PRESERVATION on re-save pinned (suppressed exact duplicates never commit — pre-existing semantics).
- Spec 3 notes: promotion already consumable (compensationMetadata reads constraints_metadata.primary_key); materialize payload key_policy onto constraints_metadata.key_policy in the pure core; keyless_multiset = DETECT-ONLY bracket (no undo possible) + end-of-run fingerprint counts keyless-written tables as expected; volatile tolerance = verify-time split, never a re-dump.

### Spec 3 (merged 6e2b576d)
- compensationMetadata: keyPolicy/scope/volatileTables; promoted PK consumed unchanged. Keyless detect-only bracket (count observations; keyless_write_recorded diag; tables tolerated in end-of-job fingerprint). verifyS0Fingerprint tolerance split (tolerated_mismatches). Effect scope filters excluded/volatile with per-op receipts; scope_conflict aggregate + per-scenario refusal citing F-refs. Diag types scope_conflict/keyless_write_recorded in AMVS+AMS+frontend. Bug caught by suite: bare array in condition silenced the no_effect_map aggregate — fixed with .length check.
### Spec 4 (eccf9b13 — DIRECT main commit, branch convention slipped; content tested)
- applyScopeToModelBundle at the pack model-fetch choke point (+ receipt on IR + manifest.scope_receipt); attributes filtered with entities; surrogate rung honors per-table keyless_multiset without the global pack decision; reconcile trace cites the receipt; progress DB section scope_receipt line; pack view receipt line. Baseline-verified pre-existing failures: engineNameGuard(migrationExecution 7>5)/azureOpenaiClient/llmClient — untouched.

### Spec 5 (merged 565446a1) — PROGRAM COMPLETE
- Joint CRUD rules over the committed model (crud_never/write_only/read_only + scope_code_conflict citing F-refs; views skipped); panel mode='code' on code-run reviews (raw model AMS-direct); estate continuation banner on completed DB runs (deliberate divergence: no combined-engine one-click — per-scan credential wizards made the guided two-step banner the right shape). Auto-apply-to-future-matches = evidence-hash REOPEN pre-answered (one-click re-confirm, never silent).

## WORK-MACHINE PICKUP (whole program, clone+copy)
- **AMS: FULL REBUILD required** (`mvn package`): changeset 226 (scope columns + foundation_decisions table — applies on boot), status machine (paused_auth_expired), diagnostics allowlist (scope_conflict/keyless_write_recorded), FoundationDecision entity/repo/service/controller, PhysicalDataEntityDto/Entity/Mapper.
- discovery-service: src/types/candidate.ts, src/services/modelScope.ts (new) → restart.
- gateway: src/routes/foundationDecisions.ts (new), src/server.ts, src/services/modelScope.ts (new), src/services/dbMigrationPack/{inputs,types}.ts, src/services/dbMigrationPackHandler.ts, src/services/migrationDataParityReconcile.ts, src/services/migrationProgressSummary.ts → restart.
- mcp-server: src/services/{foundationDecisionApplyService (new), candidateSaveBackService, archModelClient, modelScope (new)}.ts, src/routes/{applyFoundationDecisionsRoute (new), tools}.ts → restart.
- AMVS: src/types/captureSession.ts, src/services/{captureCompensation, captureSessionOrchestrator, stateDelta, modelScope (new)}.ts, src/services/compensation/{compensationMetadata, compensationRunner, types}.ts, src/services/s0/fingerprint.ts → restart.
- frontend: src/api/{foundationsApi (new), apiBehaviourClient, dbMigrationPackApi, migrationProgressReportApi}.ts, src/utils/modelScope.ts (new), src/components/Discovery/foundations/* (new), src/components/DashboardView/{DiscoveryRunDetailPage, CaptureSessionDetailView, captureDiagnosticsSupport}.tsx/ts, src/components/ProductManager/MigrationDeliveryPlan/DbMigrationPackView.tsx, src/components/ProductManager/MigrationProgressReport/MigrationProgressReport.tsx → restart.
- SHAKEDOWN ORDER: DB scan → Foundations panel (answer backup/temp/key questions) → save → code scan → joint questions → save → capture (expect: promoted-PK tables bracket, keyless detect-only, volatile tolerated in S0, scope conflicts cited).
