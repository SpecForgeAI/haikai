# Verification Report: Reconcile-Time Determinism & Volatile-Value Handling

**Spec:** `2026-06-16-reconcile-determinism-volatile-values`
**Date:** 2026-06-16
**Verifier:** implementation-verifier
**Status:** ⚠️ PASS-WITH-FOLLOWUPS (core empirical-probe path implemented + unit-tested, but NOT yet wired into the live current-state pin flow — see FU-1 / FU-2)

---

## Executive Summary

The spec is implemented across all four layers (AMS, validation-service probe, validation-service diff-tolerance, gateway auto-disposition) and all spec-specific tests that COULD be run locally pass: AMS (5), validation-service volatility (22), gateway reconciliation (66, of which 17 are the volatility auto-disposition suite). The load-bearing invariants G1 (null-envelope strict backward-compat), G2 (no break disappears), and G3 (no-override / shape-still-breaks) each have an explicit, passing guard test.

The critical caveat — already documented honestly in `tasks.md` as FU-1 and FU-2 — is that the empirical probe (`runVolatilityProbe` + `volatilityEnvelopeToWire`) is built and unit-tested but has **no production call site**: it is not invoked at the current-state pin/capture-accept site, so new captures still write `volatile_paths_json = null` and fall back to strict comparison. The `probed` / `probed_partial` sources therefore do not fire end-to-end yet. Only the `declared` (in-UI retroactive) path is wired end-to-end today; `endpoint_signal` is built and unit-tested but inert in production (FU-1) until a finding→`METHOD|path` bridge populates `nonDeterministicEndpointKeys`. The frontend layer (Group 5) is code-complete with 5 RTL tests written to convention but is **UNVERIFIED-locally** — the frontend `node_modules` is absent and the offline npm cache cannot satisfy the required toolchain.

The full AMS suite has 4 pre-existing failures in unrelated domains (architecture-id triggers, discovery-finding status vocabulary, terraform golden export); none touch this spec's code. The full validation-service (229 passed) and gateway (2517 passed) suites are green with no regressions.

---

## 1. Tasks Verification

**Status:** ✅ All in-scope tasks complete (5.4 honestly marked `[~]` blocked-by-environment; FU-1/FU-2 are documented open follow-ups, not in-scope tasks)

### Completed Tasks
- [x] Task Group 1: `volatile_paths_json` column + `EXPECTED_VOLATILE` disposition (AMS) — VERIFIED, tests run green
  - [x] 1.1 H2 tests written (`BaselineItemVolatilePathsTest`, `MigrationReconciliationBreakExpectedVolatileTest`)
  - [x] 1.2 `volatile_paths_json` JSONB column on `ApiBehaviourBaselineItemEntity.java` (`@Column(name="volatile_paths_json", columnDefinition="jsonb")`, `Map<String,Object>`)
  - [x] 1.3 Surfaced on `ApiBehaviourBaselineItemDto.java` snake_case (NO `@CamelCaseWire`)
  - [x] 1.4 Changeset `187-baseline-item-volatile-paths.sql` registered in `db.changelog-master.yaml` with `not.columnExists` precondition; `186` confirmed highest prior on disk
  - [x] 1.5 `EXPECTED_VOLATILE = "expected_volatile"` added to BOTH `ALL` and `TERMINAL_HUMAN_DISPOSITIONS`; plain TEXT, NO DDL
  - [x] 1.6 AMS layer tests pass (5/5)
- [x] Task Group 2: Empirical `k`-repeat probe + envelope write (validation-service) — VERIFIED, unit tests green
  - [x] 2.1–2.7 `volatilityProbe.ts` (`runVolatilityProbe`, `volatilityEnvelopeToWire`); envs `VOLATILITY_PROBE_REPEATS` (3), `VOLATILITY_PROBE_BUDGET_MS` (10000), `VOLATILITY_PROBE_SPACING_MS` (250) in `config.ts`; `probed` / `probed_partial` / `non_json` / `not_probed` tagging; 8 tests in `volatilityProbe.test.ts` green
- [x] Task Group 3: Per-path tolerance + endpoint signal + heuristics (validation-service) — VERIFIED, unit tests green
  - [x] 3.1–3.7 `diffRunner.ts` + `jsonShapeComparator.ts`: per-path value/multiset tolerance, shape-still-breaks, `endpoint_signal` consumption (`nonDeterministicEndpointKeys` seam), heuristic down-rank, G1 null-envelope guard; tests in `diffRunner.volatility.test.ts` + `jsonShapeComparator.volatility.test.ts` green
- [x] Task Group 4: Post-diff auto-disposition + retroactive declare + summary count (gateway) — VERIFIED, tests green
  - [x] 4.1–4.5 `autoDisposeVolatileBreaks` + `declareVolatilePaths` in `migrationReconciliationDriver.ts`; `declare-volatile` route in `routes/migrationExecution.ts`; `expectedVolatileCount` run-summary count; 17 tests in `migrationReconciliationVolatileAutoDisposition.test.ts` green (incl. G2 + G3 guards)
- [x] Task Group 5: Frontend volatile-path list + badge + declare control + summary count — CODE COMPLETE, **UNVERIFIED-locally**
  - [x] 5.1 5 RTL tests written (`MigrationDeliveryReconciliationVolatile.test.tsx`)
  - [x] 5.2 Break-detail drawer volatile paths + badge + declare control in `MigrationDeliveryReconciliationPanel.tsx`; `declareVolatilePaths` client in `api/migrationReconciliationApi.ts`
  - [x] 5.3 Reconcile-summary `expected_volatile` count
  - [~] 5.4 **Tests NOT executed** — frontend `node_modules` absent; `npm install --offline` fails `ENOTCACHED` (cannot fetch `ufo-1.6.4.tgz`) and the offline cache resolves only `vitest@1.6.1` not the project toolchain. Re-confirmed by this verifier; matches the implementer's note. Code + tests written to repo RTL/vitest convention; execution blocked by the offline environment.

### Cross-Cutting Guards
- [x] G1 backward-compat: `null` envelope → EXACTLY today's strict comparison. Explicit passing test `diffRunner.volatility.test.ts` "(G1) no envelope + no signal -> strict body_value_drift, no metadata".
- [x] G2 no-break-disappears: passing gateway test "G2 INVARIANT: no break disappears -- every break is expected_volatile (terminal) OR open (info/untouched)".
- [x] G3 no-override: passing gateway tests "MIXED divergence ... stays open [G3 no-override]", "SHAPE diff on a volatile path still breaks", and a no-override test in `jsonShapeComparator.volatility.test.ts`.

### Documented Open Follow-ups (NOT regressions — honestly carried as `- [ ]`)
- [ ] FU-1 — `nonDeterministicEndpointKeys` (`endpoint_signal` tolerance) injectable but UNPOPULATED in production. The diff-time consumer + the gateway `expected_volatile` rule for `endpoint_signal` are both built and unit-tested, but the set defaults empty (= strict), so `endpoint_signal` tolerance is inert until a finding→`${METHOD}|${path}` bridge lands in the validation-service trigger. Purely additive (can only newly-tolerate, never break the strict default = G1).
- [ ] FU-2 (the headline gap) — Probe INVOCATION not wired. **Verified by code search: `runVolatilityProbe` / `volatilityEnvelopeToWire` have NO non-test call sites.** The only `createBaselineItem` call in the validation-service is for TARGET items (`targetReplayRunner.ts:553`), not current/source items. The current-state pin is a frontend→AMS write (`SaveAsBaselineModal.tsx` → `apiBehaviourClient.ts` → AMS `createBaselineItem`), out of the gateway's reach. ⇒ in production, new captures write `volatile_paths_json = null` ⇒ strict; `probed` / `probed_partial` do NOT fire end-to-end. Only `declared` (in-UI retroactive) is wired end-to-end today.

### Incomplete or Issues
None of the IN-SCOPE tasks are incomplete. 5.4 is environment-blocked (not an implementation defect). FU-1/FU-2 are explicitly-documented, deliberately-deferred wiring seams — the spec's core empirical-probe path is implemented and unit-tested but is NOT live in the pin flow.

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found (no per-task implementation reports exist)

### Implementation Documentation
- The `implementation/` folder exists but is **EMPTY** — no per-task-group implementation report markdown files were written (`implementation/1-…`, `2-…`, etc. are absent).

### Verification Documentation
- This report: `agent-os/specs/2026-06-16-reconcile-determinism-volatile-values/verifications/final-verification.md` (created by this run; the `verifications/` folder did not previously exist).

### Missing Documentation
- Per-task-group implementation reports under `implementation/`. Task completion was nonetheless independently verifiable by direct code inspection + executing the tests, so verification did not depend on these reports. Noting their absence for the record.

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` describes a different product (an architecture meta-model editor: JSON CRUD, diagram rendering/editing, Spring Boot + PostgreSQL backend). No roadmap line item corresponds to reconcile-time determinism / volatile-value handling, so there is nothing to mark complete. No roadmap change made.

---

## 4. Test Suite Results

**Status:** ⚠️ Some Failures (4 pre-existing AMS failures unrelated to this spec; frontend suite UNVERIFIED-locally)

### Spec-Specific Tests (all that could be run — GREEN)
| Layer | Suite | Result |
|---|---|---|
| AMS | `BaselineItemVolatilePathsTest` + `MigrationReconciliationBreakExpectedVolatileTest` | 5 passed, 0 failed |
| validation-service | `volatilityProbe` + `diffRunner.volatility` + `jsonShapeComparator.volatility` | 22 passed, 0 failed (incl. G1) |
| gateway | `migrationReconciliation*` (incl. `migrationReconciliationVolatileAutoDisposition`) | 66 passed, 0 failed (17 of them the volatility suite, incl. G2 + G3) |
| validation-service tsc | `npx tsc --noEmit` | exit 0 (clean) |
| gateway tsc | `npx tsc --noEmit` | exit 0 (clean) |
| frontend | `MigrationDeliveryReconciliationVolatile.test.tsx` (5 tests) | **NOT RUN — environment-blocked** |

### Full Suite Summary
- **AMS (`mvn -o test`):** Total **2151**, Passing **2147**, Failing **4**, Errors **0**, Skipped **12** → BUILD FAILURE (due to the 4 pre-existing failures below).
- **validation-service (`npx jest`):** Total **230**, Passing **229**, Failing **0**, Skipped **1** → green.
- **gateway (`npx jest`):** Total **2517**, Passing **2517**, Failing **0** → green.
- **frontend (vitest):** **UNVERIFIED-locally** — could not install/run (offline cache lacks the required toolchain; `node_modules` absent; `npm install --offline` → `ENOTCACHED`).

### Failed Tests (AMS — ALL pre-existing, UNRELATED to this spec)
1. `com.example.architecturemodel.migration.ArchitectureIdAutoDeriveTriggerTest#eachTableRoutesToCorrectDerivationFunction` — architecture-id derivation trigger / `business_users` derivation function. Unrelated to volatility.
2. `com.example.architecturemodel.service.discovery.DiscoveryFindingStatusTransitionTest#allowedStatusesAreCandidateParity` — discovery-finding status vocabulary parity. Unrelated.
3. `com.example.architecturemodel.service.discovery.DiscoveryFindingStatusTransitionTest#reviewerStatusesAreApproveRejectDefer` — discovery-finding reviewer-status set. Unrelated.
4. `com.example.architecturemodel.service.export.terraform.TerraformExportGoldenFileTest#exportTerraform_canonicalFixture_matchesGoldens` — terraform export golden-file mismatch (`expected-main.tf`). Unrelated.

Confirmed by grep: none of the failing surefire reports mention `volatile`, `expected_volatile`, or changeset `187`. The new column + disposition are additive and do not touch any of these domains.

### Notes
- Per instructions, no failing tests were fixed — they are reported only.
- The 4 AMS failures are pre-existing in unrelated subsystems and are NOT regressions introduced by this spec; the spec-specific AMS tests pass and the full validation-service + gateway suites have zero failures.
- This verifier attempted `npm install --offline` for the frontend to confirm the blocker; it failed (`ENOTCACHED`) and left `node_modules` partially populated/corrupt. The frontend was already unverifiable either way; nothing in the frontend was successfully built or tested.
- The headline conclusion stands: the spec's **core empirical-probe path is implemented and unit-tested but is NOT yet wired into the live current-state pin flow** (FU-1 / FU-2). In production today, new captures write `volatile_paths_json = null` ⇒ strict comparison (the backward-compatible G1 default), and only the in-UI `declared` retroactive path is operative end-to-end.
