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

### Follow-up (merged 6ed0cacf) — dynamic question set
Live-shakedown finding: pending exclude/volatile answers left conflicting questions below. Fixed both layers: derive-time (stored non-stale excluded/volatile decisions silence backup/temp/key/hazard questions for their tables — tablesScopedOutByDecisions) + live panel (pending selections hide covered cards with an honest hidden-count note; flipping the answer reveals them; bulk cards shrink to remaining targets; Apply sends only visible/effective). PICKUP DELTA: frontend `src/components/Discovery/foundations/{foundationRules,FoundationsReviewPanel}.tsx` (restart frontend only).

### Follow-up 2 (merged 0f9e8195) — partial exclusion decides the remainder
User ruling: deselecting tables from an exclude/volatile bulk answer MEANS keeping them. One apply now emits the scope decision (selected set) + a keep/in_scope decision (deselected remainder) whose evidence hash equals the residual question's hash (bulkTargetsEvidenceHash shared by derive+panel) — so the residual SETTLES, never re-poses. Plus healing: per-question uncheck state resets when the target signature changes (kills the unanswerable 0-of-N card). PICKUP DELTA: same two frontend files (foundationRules.ts + FoundationsReviewPanel.tsx), frontend restart; the stuck residual card becomes answerable immediately (checkboxes reset to all-selected — answer "Keep all" once and it settles).

### Follow-up 3 (merged 13171a34) — scope receipts on the candidate review stage
Live-shakedown finding: excluded tables (e.g. the 20 backup/temp exclusions) still rendered as plain pending_review candidates — the "obvious at every following stage" contract stopped at the questions panel. Now: DiscoveryRunDetailPage fetches stored decisions (non-stale, excluded|volatile) into a table-name map (refreshes on every panel Apply via lastSaveTimestamp) and threads it to DiscoveryCandidateTable, which chips entity rows AND attribute rows (via data.tableName) with `EXCLUDED (F-n)` / `VOLATILE (F-n)` (titles state committed_excluded documentation-only vs S0-tolerated) plus a count-summary split ("N excluded ... commit as documentation only (committed_excluded) on save · M volatile (S0-tolerated)"). modelScopeGuard baseline: 2 conscious adds (candidate_type compares, not raw model reads; foundationRules.ts predated as unnoticed offender). PICKUP DELTA: frontend only — src/components/DashboardView/{DiscoveryCandidateTable,DiscoveryRunDetailPage}.tsx + src/components/Discovery/DiscoveryRunDetailView.tsx (restart frontend).

### Follow-up 4 (merged d4e4ce51) — order-free evidence hashes + stale preselect
Live-shakedown finding: SAVING the candidates reopened 11 settled questions stale ("evidence changed"). Root cause: every evidence hash was computed over arrays in candidate FETCH ORDER (entityFactsFromCandidates assembly, bulkTargetsEvidenceHash name lists, key_posture attrs, crudFactsFromModel) — save-back updates every row, the refetch reorders, reorder read as changed evidence. Fixed by canonical sort at the fact builders + sorted hash inputs (locale-free code-unit compare); hashes are now functions of the evidence SET. Second bug in the same screenshot: stale reopens preselected the RECOMMENDED option instead of the user's previous answer (keep_all reopened showing volatile, which also hid 2 dependent questions) — selectedAnswer now prefers stale_decision.previous_answer. ONE-TIME consequence: pre-fix stored hashes reopen their still-derivable questions stale once, correctly pre-answered — a single Apply re-settles permanently; saves never reopen them again. PICKUP DELTA: frontend only — src/components/Discovery/foundations/{foundationRules.ts, FoundationsReviewPanel.tsx} (restart frontend).

### Follow-up 5 (merged 60b3f360) — committed_excluded made visible + attributes follow
Live-shakedown finding: "All saved DB candidates are committed" — the status column renders review_status ('committed' by design for everything saved); the committed_excluded pipeline status only lived in the cell's hover tooltip. Fixed: (1) the status cell renders committed_excluded as visible styled text when candidate.status carries it (review_status text otherwise, unchanged); (2) save-back's flip now also covers ATTRIBUTE candidates of excluded tables via the model's physical_entity_id FK join — previously only the table's own entity candidate flipped. NOTE: statuses already saved before this fix stay as-is (plain 'committed' on attribute rows) unless the DB run is re-saved — cosmetic only; the model scope tags that capture/pack/rec read were always correct, and the row chips (follow-up 3) mark those rows regardless. PICKUP DELTA: frontend src/components/DashboardView/DiscoveryCandidateTable.tsx (restart frontend) + mcp-server src/services/candidateSaveBackService.ts (restart mcp-server).

## WORK-MACHINE PICKUP (whole program, clone+copy)
- **AMS: FULL REBUILD required** (`mvn package`): changeset 226 (scope columns + foundation_decisions table — applies on boot), status machine (paused_auth_expired), diagnostics allowlist (scope_conflict/keyless_write_recorded), FoundationDecision entity/repo/service/controller, PhysicalDataEntityDto/Entity/Mapper.
- discovery-service: src/types/candidate.ts, src/services/modelScope.ts (new) → restart.
- gateway: src/routes/foundationDecisions.ts (new), src/server.ts, src/services/modelScope.ts (new), src/services/dbMigrationPack/{inputs,types}.ts, src/services/dbMigrationPackHandler.ts, src/services/migrationDataParityReconcile.ts, src/services/migrationProgressSummary.ts → restart.
- mcp-server: src/services/{foundationDecisionApplyService (new), candidateSaveBackService, archModelClient, modelScope (new)}.ts, src/routes/{applyFoundationDecisionsRoute (new), tools}.ts → restart.
- AMVS: src/types/captureSession.ts, src/services/{captureCompensation, captureSessionOrchestrator, stateDelta, modelScope (new)}.ts, src/services/compensation/{compensationMetadata, compensationRunner, types}.ts, src/services/s0/fingerprint.ts → restart.
- frontend: src/api/{foundationsApi (new), apiBehaviourClient, dbMigrationPackApi, migrationProgressReportApi}.ts, src/utils/modelScope.ts (new), src/components/Discovery/foundations/* (new), src/components/DashboardView/{DiscoveryRunDetailPage, CaptureSessionDetailView, captureDiagnosticsSupport}.tsx/ts, src/components/ProductManager/MigrationDeliveryPlan/DbMigrationPackView.tsx, src/components/ProductManager/MigrationProgressReport/MigrationProgressReport.tsx → restart.
- SHAKEDOWN ORDER: DB scan → Foundations panel (answer backup/temp/key questions) → save → code scan → joint questions → save → capture (expect: promoted-PK tables bracket, keyless detect-only, volatile tolerated in S0, scope conflicts cited).
