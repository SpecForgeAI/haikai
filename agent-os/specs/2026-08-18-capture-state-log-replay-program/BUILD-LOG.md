# Capture-State Discipline & Log-Replay Program — Build Log

## PROGRAM COMPLETE (2026-08-18)

All 8 specs BUILT + MERGED (--no-ff) + PUSHED, main ending 8ea0603b. Specs
1–4 = state discipline (S0 invariant live end-to-end: derived compensation
with byte-parity verification on BOTH capture and target replay, S0
snapshot/fingerprint/restore, halt-on-residue, credential split, id reseed).
Specs 5–8 = log-replay reconciliation round 2 (corpus extraction via the
existing runtime-evidence parsers, wizard source multi-select +
include-in-initial, the log_replay baseline + second reconciliation through
the EXISTING headless machinery, clustered triage).

### Work-machine pickup (clone+copy convention — big change => FRESH CLONE)

Every service except IVS changed; a fresh clone becoming the new area is the
right move. Then:

1. AMS restarts apply changeset 225 (log_replay_corpus tables) on boot;
   diagnostic-type + baseline-kind allowlists extended (code only).
2. REBUILD the sybase-discovery-sidecar jar (new /mutate endpoint + guards)
   and restart it.
3. Restart AMVS (compensation/s0/log-replay modules + routes; NEW env knobs
   all optional: COMPENSATION_*, S0_*, CAPTURE_COMPENSATION_MODE default
   'required').
4. Restart discovery-service (log-replay-corpus route), gateway (extract
   proxy + round-2 driver/route + scoped-re-rec db threading), frontend
   (wizard sources, log sections, drift rollup, reconcile modal).
5. FIRST OPERATIONAL STEP before any new capture: pin S0 —
   POST /api/s0-snapshot/run with the source DB block (the SIT DB was
   refreshed from Prod 2026-08-18, so S0 pins clean). Optionally supply the
   read-only login in the wizard secrets step (credential split advisory
   clears).

### Shakedown checklist (live)

- Capture a mutating endpoint with brackets active: verify the
  capture.compensation.bracket trace, then POST /api/s0-snapshot/verify ->
  matches: true.
- Kill-switch works: CAPTURE_COMPENSATION_MODE=off restores legacy behaviour.
- Upload a real access log in the wizard: funnel + staging + gaps render;
  round 2 via the Run-reconciliation modal third checkbox; drift tab shows
  the clustered summary.

### Residual risks / notes (also in Per-spec notes below)

- Manual-capture concrete sends (Postman + checked-mode log pre-fires) are
  UNCOMPENSATED (pre-existing hole; mutating LOG items never pre-fire).
- Pre-existing red baselines UNCHANGED: AMVS config/testConnection/
  captureSessionSeeding tests; frontend whole-repo tsc + two
  MigrationDeliveryDashboard suites (all verified failing before this
  program via stash round-trips).
- Round-2 gateway call is synchronous (minutes on huge corpora) — an async
  job wrapper is future polish.

Design source of truth:
`agent-os/planning/2026-08-18-capture-state-discipline-and-log-replay-design.md`.
Read that FIRST (doctrine: S0 invariant, derived compensation, verified-or-
failed, both sides symmetric; log-replay round 2 = second baseline family
through the existing replay+diff pipeline). This log tracks the autonomous
build of the 8-spec program (user go 2026-08-18 after pre-build Q&A: build all,
commit/merge per spec, stop only on genuine blockers).

Conventions: feature branch per spec, --no-ff merge to main after tests green.
PS 5.1: commit via tempfile + `git commit -F`, verify with git log. NEVER
commit the standing local files (.env*, gateway/threads/*, haikai-skills/,
implement-verify-service/package.json). Thresholds/caps/budgets = CONFIG
values, not hardcoded. No client identifiers anywhere.

## Program status

| # | Spec | Branch | Status |
|---|------|--------|--------|
| 0 | Design agreement + build log (docs only) | main | DONE 77cbdb53 |
| 1 | Compensation engine (core, side-agnostic) | feature/csd-01-compensation-engine | built (AMVS compensation/ module: metadata from committed model constraints, full-row keyset imaging w/ CONFIG cap, derived inverse DML + identity wrap + single reseed path, 2-layer guard, PG pool + sidecar /mutate write adapters, bracket runner w/ refused/clean/compensated/residue taxonomy; sidecar MutationSqlGuard + SybaseMutationService + /mutate; 36 jest + 90 maven green) |
| 2 | S0 snapshot + fingerprint + restore | feature/csd-02-s0-snapshot | built (AMVS s0/ module: PK-ordered JSONL dump + manifest w/ streaming sha256 per table, no-PK tables count-only loud skip; fingerprint verify w/ checksum cap CONFIG; restore = TRUNCATE+batched identity-wrapped re-insert+reseed+verify; restore grammar on guard/adapters/sidecar mode=restore; routes /api/s0-snapshot/{run,latest,verify,restore} sync long-run posture; 48 jest + 93 maven green; NOTE pre-existing red baseline on main: config.test, testConnectionAction.test, captureSessionSeeding.test — verified failing on main before merge) |
| 3 | Source capture integration (brackets + credential split) | feature/csd-03-source-capture-integration | built (per-scenario brackets wrap mirror+LLM loop for mutating verbs via captureCompensation context; fail-closed refusals + compensation_refused/residue/inactive diagnostics [AMS allowlist extended]; residue + end-of-job S0 fingerprint mismatch HALT session failed w/ restore remedy; readonly-credential split in secrets bundle/route; mutating id-harvest suppressed under brackets; GET /capture-sessions/:id/compensation-preflight pre-start aggregate warning; CAPTURE_COMPENSATION_MODE config; 4 new orchestrator bracket tests, e2e test advisory-aware; AMVS 746 green + AMS ApiBehaviour* 97 green) |
| 4 | Target replay integration | feature/csd-04-target-replay-integration | built (targetReplayRunner: per-item brackets for mutating single-shot AND sequence items via same context builder; state-delta pair moved INSIDE the bracket [delta records what the call did, before undo]; refusals fail-closed skip w/ diagnostic; residue = CompensationResidueHaltError -> run failed w/ re-run-data-migration remedy; targetDbConfig threaded through /start route [reuses Tier-1 db plumbing]; gateway scoped re-reconcile now passes target-DB creds like the full run; shared fake gained runReadonlySelect for the delta ladder; 3 new tests, AMVS 749 green, gateway reconciliation 92 green; RESIDUAL noted: surrogate-PK target tables order by source natural key — imaging collisions would surface as residue, never silently) |
| 5 | Log ingestion: replay-corpus extraction | feature/csd-05-log-corpus | built (discovery corpusExtractor REUSES runtime-evidence parsers: parseClfLine [query preserved — tier 2a], tryKnownFormatFastPathContent [rich JSONL tier 3], recipe seam; usefulness rules per design [body-less=url_only, body-ful need parseable body else loud discard]; placeholder-equivalent endpoint matching vs committed model; exact-dup collapse w/ counts; honest funnel + unmatched-endpoints list; POST /discovery/log-replay-corpus abandons zero-useful sources loudly, else persists ATOMICALLY to AMS changeset 225 [log_replay_corpus + _item, opaque request_json, snake_case wire, create/latest/items/patch]; 9 discovery tests + 5 AMS tests green; discovery full suite 263 green) |
| 6 | Wizard: source multi-select + include-in-initial | feature/csd-06-wizard-sources | built (PostmanImportWizardStep 3-way radio -> source CHECKBOXES {LLM, Postman, Application log} deriving the existing PostmanRunMode; LogCorpusSection [upload -> gateway extract -> funnel + grouped staging + unmatched gaps + include-in-initial w/ count]; wizard start gate via deriveSourceSelection [log-only unchecked/abandoned/no-source BLOCK; log-only checked = postmanOnly semantics + honest justification]; checked-mode NON-mutating corpus items pre-fire via manual-capture and merge into the SAME postmanCapturedByOp map [zero backend /start changes]; mutating items held w/ visible note [manual-capture is unbracketed — pre-existing Postman hole, logged residual]; LogCorpusAppendModal parity [stages round 2 + capture-now non-mutating w/ gate-recompute refresh]; gateway /log-replay-corpus/extract proxy; discovery extract response now returns items; 24 vitest [11 support + rewritten selector suite] + ApiBehaviour 83 green in isolation, gateway 277 discovery-suite green) |
| 7 | Round-2 run: log_replay baseline + second reconciliation | feature/csd-07-log-replay-run | built (AMVS logReplayCaptureRunner: corpus -> live CURRENT replay at S0 w/ full AMS plumbing [op per distinct template `log:<M> <t>`, manual scenario per item `log:<n>:<hash>` = pairing key], mutating items bracketed or SKIPPED without db creds [unattended = stricter than wizard], residue + fingerprint mismatch fail loud; `log_replay` baseline kind added to AMS ALLOWED_KINDS + AMVS type unions; POST /api/log-replay/run sync route [latest-corpus default, status->replayed_current]; gateway runLogReplayReconcile: phase A gates phase B = EXISTING runHeadlessReconcile w/ purpose='log_replay_round2' [diff never masquerades as round 1]; route POST .../log-replay-reconcile/run beside the manual reconcile trigger; 3 AMVS runner tests + 3 gateway driver tests green; AMVS full 752 green, AMS ApiBehaviourBaseline* 21 green; FE trigger button + rollups land with spec 8) |
| 9 | Auto-S0 at DB-scan completion (2026-08-19 user ruling: ONE action, no separate step/UI) | feature/csd-09-auto-s0 | built (discovery runManager fires the snapshot on scan COMPLETED using the harvest's own tables/PKs/identity via new s0AutoSnapshot module [ambiguous multi-schema bare names skipped loudly] + the scan's credentials; AMVS s0-snapshot/run accepts scan-supplied `tables` specs via buildIndexFromTableSpecs — no committed-model wait; outcome taken/failed/skipped + id + reason lands in steps_payload.database.s0Snapshot; fail-soft loud; manual route = recovery path only; 6 discovery tests + AMVS builder test; discovery full suite green on re-run [known first-run flake]) |
| 8 | Clustered triage (signature grouping + rollups) | feature/csd-08-clustered-triage | built (pure diffClusteringSupport: cluster by [method, path, status class, body class, status pair], worst-first, sample scenarios capped at 5 + full member ids; DiffClusteredSummary panel mounted on DriftReportTab [breakish-only default, matching-groups toggle] — serves round-1 drift checks AND round-2 diffs; RunReconciliationModal gains the "Log-replay reconciliation (round 2)" checkbox reusing its existing credential blocks -> synchronous call to the spec-7 gateway route w/ inline verdict line [diffed/differing counts + current-side replay tally]; runLogReplayReconciliation FE api fn; 4 clustering vitest + modal/drift suites 31 green in isolation; NOTE group-DISPOSE for round-1 breaks already exists server-side [dispose route accepts break_ids[]] — clusters carry itemIds for future group actions) |

## Key as-built facts feeding this program

- Existing log machinery to REUSE in spec 5 (per user ruling): `discovery-service/src/services/logParsing/*` (detector + 4 parsers) and `services/runtimeEvidence/*` — `accessLogParser.ts` (CLF/Combined, streaming, 100MB/file 2GB total caps), `knownFormatFastPath.ts`, `logRecipeInduction.ts` (LLM recipe: field rules incl. requestHeaders/requestBody/responseStatus/responseBody; held-out >=60% gate; format-fingerprint reuse; max 3 LLM calls/file), `routes/logEnrichment.ts` upload chain.
- Compensation seams: `api-migration-validation-service/src/services/stateDelta.ts` (effect-table keyed before/after snapshots from committed endpoint_data_effects), `tools/execute_http_request.ts` (source bracket), `targetReplayRunner.ts` (target bracket, replays source baseline items sequentially, mutating gate), `diffRunner.ts` (pairing `${METHOD}|${path}|${scenario_name}`).
- Wizard seam: `frontend/src/components/ApiBehaviour/StartCaptureSessionWizard.tsx` Step-4 3-way `postmanRunMode` ('llm'|'postman-delta'|'postman-only') + Postman Mode 1b concrete-send/delta machinery + `PostmanImportAppendModal`.
- Rulings from pre-build Q&A: effect-map-missing writes FAIL CLOSED + aggregate warning list; S0 = SIT refreshed from Prod 2026-08-18 (clean); halt-on-residue; snapshot scope = committed physical model tables; credential split back-compat.

## Per-spec notes

- RESIDUAL (spec 6): manual-capture route sends are UNCOMPENSATED — the
  concrete-send path (Postman imports AND checked-mode log pre-fires) runs
  outside the CSD Spec 3 brackets. Mitigated: mutating LOG items never
  pre-fire (held for round 2 / the bracketed LLM loop); Postman mutating
  sends retain the pre-existing hole. Bracketing the manual-capture route is
  future work.
- RESIDUAL (spec 4): target-side bracket imaging orders by the SOURCE natural
  key; a surrogate-PK target table with a demoted non-unique natural key
  could collide in the image map — any real failure surfaces as residue
  (halt), never silently.

(appended as specs complete)
