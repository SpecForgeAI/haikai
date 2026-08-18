# Capture-State Discipline & Log-Replay Program — Build Log

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
| 6 | Wizard: source multi-select + include-in-initial | feature/csd-06-wizard-sources | pending |
| 7 | Round-2 run: log_replay baseline + second reconciliation | feature/csd-07-log-replay-run | pending |
| 8 | Clustered triage (signature grouping + rollups) | feature/csd-08-clustered-triage | pending |

## Key as-built facts feeding this program

- Existing log machinery to REUSE in spec 5 (per user ruling): `discovery-service/src/services/logParsing/*` (detector + 4 parsers) and `services/runtimeEvidence/*` — `accessLogParser.ts` (CLF/Combined, streaming, 100MB/file 2GB total caps), `knownFormatFastPath.ts`, `logRecipeInduction.ts` (LLM recipe: field rules incl. requestHeaders/requestBody/responseStatus/responseBody; held-out >=60% gate; format-fingerprint reuse; max 3 LLM calls/file), `routes/logEnrichment.ts` upload chain.
- Compensation seams: `api-migration-validation-service/src/services/stateDelta.ts` (effect-table keyed before/after snapshots from committed endpoint_data_effects), `tools/execute_http_request.ts` (source bracket), `targetReplayRunner.ts` (target bracket, replays source baseline items sequentially, mutating gate), `diffRunner.ts` (pairing `${METHOD}|${path}|${scenario_name}`).
- Wizard seam: `frontend/src/components/ApiBehaviour/StartCaptureSessionWizard.tsx` Step-4 3-way `postmanRunMode` ('llm'|'postman-delta'|'postman-only') + Postman Mode 1b concrete-send/delta machinery + `PostmanImportAppendModal`.
- Rulings from pre-build Q&A: effect-map-missing writes FAIL CLOSED + aggregate warning list; S0 = SIT refreshed from Prod 2026-08-18 (clean); halt-on-residue; snapshot scope = committed physical model tables; credential split back-compat.

## Per-spec notes

(appended as specs complete)
