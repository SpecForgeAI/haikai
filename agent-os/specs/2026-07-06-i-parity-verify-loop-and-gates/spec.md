# Spec I — Implement→Parity Verify Loop + Execution Gates

**Program:** Code-Tier Oracle (see `agent-os/planning/2026-07-06-code-tier-oracle-gap-analysis.md`)
**Closes:** Gap P1 — the open verify seam. Parity ("same request → same response") becomes
a machine-enforced loop and gate, not acceptance-criterion prose.
**Mirrors:** Persistence Spec E's gate architecture (`migrationDbExecutionGate.ts`, gate-4b
stacking, FAIL-CLOSED) and its per-invocation-credentials pattern.

## Goal

After a code story is implemented and deployed, the system automatically replays the
story's captured baseline scenarios against the deployed target, diffs the responses,
feeds breaks back into the repair loop, and repeats until parity (or a capped, visible
failure). Migrate refuses to start code stories without baseline coverage and refuses to
call them done without a clean (or explicitly waived) parity diff.

## Evidence / current behaviour

- IVS verify = inline test-gate repair only (`implement-verify-service/src/job_queue/tasks.py:555–576`,
  `/haikai:debug` → `/haikai:fix`); CI-verdict binding exists (`:171–198`, `verification.db`)
  as the async re-entry pattern; deploy returns `base_url` (`deploy_on_complete`).
- AMVS has the whole parity harness (target sessions, `targetReplayRunner.ts`, auto-diff,
  `diffRunner.ts`, finding emission) — wizard-initiated only; `apiBehaviourClient.ts` in the
  gateway is UNUSED by the plan/exec pipeline.
- Plan stamps "Behavioural parity with baseline {id}" as unenforced AC text
  (`migrationBookOfWorkExpansionHandler.ts:429–432`).
- Execution driver hard-gate checks an active baseline EXISTS (pinned at kickoff), nothing
  more (`migrationExecutionDriver.ts:136–142`).

## Scope

### 1. Scoped replay + diff (AMVS)

- Extend target-session start and diff creation to accept an optional
  `endpoint_scope` (list of committed endpoint element ids and/or `{method,path}` keys):
  replay only baseline items whose operation maps into the scope; diff pairs likewise.
  (SHARED COMPONENT with Spec F's "revalidate affected endpoints" — build once here.)
- Scoped runs persist their scope on the run/diff record (auditable; a scoped-clean diff
  never masquerades as full-surface-clean).

### 2. Gateway parity orchestrator

New `gateway/src/services/migrationParityVerifier.ts`:

- Input: story (extras `apiEndpointIds`, `protocol`), deployed `base_url`, per-invocation
  target auth config (Spec E credentials pattern: supplied on the Migrate request,
  held in memory, NEVER persisted).
- Flow: resolve pinned current baseline → create target capture session (programmatic;
  reuse existing AMVS routes) → push secrets → start scoped replay → await completion
  (poll with timeout) → scoped diff → collect verdict
  `{ clean: boolean, breaks: DiffBreak[], coverage: {replayed, skipped, transportFailures} }`.
- Verdict semantics FAIL CLOSED: transport failures, zero-replayed, or unreadable state
  are NOT clean.
- Mutating scenarios: replay honours the session's mutating-calls confirmation; the Migrate
  request carries an explicit `allow_mutating_replays` flag (target side-by-side DB is
  disposable during migration — user's operating model — but the flag stays explicit).

### 3. Repair loop (IVS)

- New inbound verdict path mirroring the CI-verdict pattern: parity verdict posted to IVS
  (binding key: orchestrate_id + spec_name), breaks serialized as structured failure detail
  (per endpoint: request summary, expected vs actual status/shape/value paths).
- On breaks: launch the verification-loop skill with the parity report as the defect input
  (`/verify-task-group` pattern), attempts capped by `PARITY_REPAIR_CAP` (default 5).
  Each attempt: fix → redeploy → gateway re-runs scoped replay+diff → re-verdict.
- On cap exhaustion: story marked parity-failed with the final diff attached — visible,
  never silently passed.

### 4. Migrate gates (stacking with `evaluateHardBlock`, gate 4c)

New `gateway/src/services/migrationCodeExecutionGate.ts`:

- `codeStoriesInScope`: tags `provenance:plan-deterministic` + code streams (Spec G),
  plus flagged code stories.
- **PRE-DISPATCH blocks** (codes, wayfinding entries per the Spec A pattern):
  - `code_baseline_missing` — an in-scope endpoint has no accepted baseline coverage
    (flagged `missing_baseline` stories are exempt: their job is to create it).
  - `code_baseline_unpinned` — no active pinned current baseline for the run.
  - `code_coverage_floor_unmet` — Spec K floor violated (gate reads the persisted score
    when K is built; until then this code is not emitted).
  - `code_gate_read_failed` — FAIL CLOSED on unreadable state.
- **COMPLETION blocks:** a code story is not completable while its latest scoped parity
  verdict is missing/unclean and unwaived (`code_parity_unverified`, `code_parity_broken`);
  the stream's closure story requires a FULL-surface (unscoped) clean diff.

### 5. Waivers (interim model)

Per-diff-break waiver: persisted record (break fingerprint: endpoint + path/pointer + kind;
reason; author; timestamp) consumed by the gate's verdict evaluation. Spec J supersedes the
fingerprint model with its durable comparison-policy waivers; this spec keeps the surface
minimal and forward-compatible (same AMS table, J extends it).

## Non-goals

- Comparator strictness / SOAP envelopes (Spec J — this loop uses the comparator as-is and
  inherits J's improvements transparently).
- Coverage floor computation (Spec K; gate consumes when present).
- Internal-job parity (Spec M's oracle; internal-stream stories are exempt from THIS gate
  and gated by M's design).
- UI build-out beyond surfacing gate codes and verdicts in existing surfaces.

## Acceptance criteria

1. **LOOP PIN (mocked ends):** implemented story → deploy callback → verifier runs scoped
   replay+diff (mock AMVS asserts the endpoint scope equals story extras) → breaks posted
   to IVS inbound → repair attempt → clean second diff → story completable.
2. **FAIL-CLOSED PIN:** AMVS unreachable / zero-replayed / transport-failures →
   verdict unclean; completion blocked with `code_parity_unverified`.
3. **GATE PIN:** endpoint without baseline coverage → `code_baseline_missing` blocks
   dispatch; flagged `missing_baseline` story does NOT trigger it.
4. **CAP PIN:** persistent break exhausts `PARITY_REPAIR_CAP` → parity-failed state with
   final diff attached; run does not report success.
5. **WAIVER PIN:** waived break fingerprint → verdict clean-with-waivers; waiver id
   recorded on the verdict.
6. **SCOPE AUDIT PIN:** scoped-clean diff record carries its scope; closure story requires
   an unscoped clean diff and rejects a scoped one.
7. Secrets: target auth never persisted (assert absence in AMS writes and logs).

## Test plan

Unit: verifier flow with mocked AMVS/IVS clients (pins 1,2,4,5); gate tests mirroring
`migrationDbExecutionGate` suite (pin 3,6); AMVS scoped-replay/diff filter tests; IVS
inbound-verdict test (Python, mirroring CI-verdict tests). Integration-shaped test through
the driver with all seams mocked. Baseline discipline as per program.

## Dependencies & sizing

Depends on: G (extras), existing deploy path; consumes K (floor) and J (strictness) when
built. Shares scoped replay with F. Size: **L**. Build after G+H (and ideally after J for
SOAP estates; the loop itself is comparator-agnostic).

---

## Amendment 2026-07-06 — capture-scan review (gap analysis §9)

Two extensions, both reusing this spec's machinery:

- **§2/§4 — state parity in the verdict (Spec N):** for mutating scenarios the verdict
  gains a state dimension: `clean` requires `state_match` (or explicit waiver) in addition
  to response cleanliness; `state_unverified` is unclean (FAIL CLOSED). Breaks posted to
  the repair loop include the state-drift detail (table/column/expected/actual).
- **NEW §6 — baseline behavioural-drift check:** the live legacy system keeps running
  while migration proceeds (side-by-side model), so a baseline can silently rot. Add a
  drift-check run mode: the scoped-replay machinery pointed at the CURRENT system's own
  base URL, diffing against the pinned baseline — drift means the legacy behaviour changed
  since capture (or volatility was under-modelled; the volatility envelope disambiguates).
  Existing inventory-staleness protection (D8 reconcile at `/start`) covers model drift
  only; this covers behaviour. Surfacing: baseline age + last drift-check result in the
  readiness/migration-discovery-context summary; new gate codes `baseline_drift_unchecked`
  (warning-level, configurable max age, default 14 days) and `baseline_behaviour_drift`
  (blocking until re-captured or waived). Drift-check runs are cheap to schedule from the
  existing wizard/run surfaces; no new UI beyond the gate codes.
- **Additional acceptance criteria:** **STATE PIN** — mutating scenario with `state_drift`
  → story not completable; waiver path works; `state_unverified` blocks. **DRIFT PIN** —
  drift-check run against a mutated mock "current" → `baseline_behaviour_drift` blocks;
  clean re-check clears it; stale-age fixture triggers `baseline_drift_unchecked`.
