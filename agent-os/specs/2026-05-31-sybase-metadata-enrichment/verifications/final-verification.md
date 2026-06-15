# Verification Report: Sybase metadata enrichment (data-layer fidelity parity)

**Spec:** `2026-05-31-sybase-metadata-enrichment`
**Date:** 2026-05-31
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

The spec is fully and correctly implemented across the two in-scope services
(`sybase-discovery-sidecar` Java/Spring Boot and `discovery-service` TypeScript).
All six metadata groups are surfaced by the sidecar and consumed by discovery,
the new three-state applicability model (`present` / `not_applicable_for_engine`
/ `unavailable`) is plumbed end to end, and the cross-side capability-key and
wire-field contract matches exactly on both sides. Real verifications were run:
the sidecar Maven suite is green (74 tests, 0 failures/errors), `tsc --noEmit`
is clean, and the always-on Sybase Jest suite is green (39 tests). AMS / frontend
were correctly left untouched.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

All six task groups and every sub-task were already marked `- [x]` in
`tasks.md`, and each was spot-checked against the actual code (no checkboxes
needed flipping). Evidence below.

### Completed Tasks
- [x] Task Group 1: Additive `IntrospectionResponse` contract + per-row mapper extraction
  - [x] 1.1–1.5 — `IntrospectionResponse.java` carries all new optional/nullable
    fields (`KeyRow`: `indexDefinition`/`indexMethod`/`isClustered`/`indexPredicate`/`columnDirections`,
    `updateRule`/`deleteRule`; `ColumnRow`: `collation`/`isComputed`/`computedExpression`/`isIdentity`;
    top-level `capabilities`/`serverVersion`/`databaseCollation`). No AMS
    `@CamelCaseWire`/snake_case annotations added (confirmed in the record + javadoc).
- [x] Task Group 2: Per-group catalog queries (collation, computed columns, FK actions)
  - [x] 2.1–2.6 — capability constants `CAP_COLLATION`, `CAP_COMPUTED_COLUMNS`,
    `CAP_FK_ACTIONS` advertised on their read paths (`SybaseQueryService.java`
    lines 662–663, 829). Catalog-only base-table reads; no `sp_helpsort`.
- [x] Task Group 3: Sequence/identity current value + index clustering (group 5)
  - [x] 3.1–3.6 — identity synthesis + `MAX(col)` fallback, version-branched
    native SEQUENCE (`supportsNativeSequenceCatalog`, line 1792), group-5 index
    query; `CAP_SEQUENCE_CURRENT_VALUE` (1090) and `CAP_INDEX_CLUSTERING` (821)
    advertised; `indexPredicate` left absent.
- [x] Task Group 4: DB-resident jobs + `SidecarSqlGuard` narrow allowlist
  - [x] 4.1–4.5 — `scheduledJobs[]` projection, `CAP_SCHEDULED_JOBS = "db_jobs"`
    (1259); `SidecarSqlGuardTest` runs 43 tests green (allowlist-on-introspect vs
    blocked-on-`/query`).
- [x] Task Group 5: Sidecar full-module verification
  - [x] 5.1–5.2 — full `mvn -f sybase-discovery-sidecar/pom.xml test` is green (see §4).
- [x] Task Group 6: Discovery wiring + three-state applicability + always-on tests
  - [x] 6.1–6.7 — `SidecarIntrospectionResponse` extended (`sybaseSidecarClient.ts`),
    group-5 mapper lines replace the bare `TODO(oracle-W3)` on the `keys[]` map
    (`sybaseIntrospection.ts` 366–386), `databaseCollation` set on the IR
    (480–482, 526), three-state resolver (`resolveSybaseMetadataApplicability`,
    `parseAseMajorVersion`), and the always-on `sybaseDiscoveryPack.test.ts`
    asserts all new fields + all three states. Tests green (see §4).

### Incomplete or Issues
None. Every acceptance criterion across all six groups maps to verified code.

> Note: tasks.md task 6.7 (and the "Final Verification" section) use the wording
> "vitest". The discovery-service in fact uses **Jest**; the suite was run with
> `npx jest sybaseDiscoveryPack` and is green. This is a documentation wording
> nit only, not an implementation issue.

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found (non-blocking)

### Implementation Documentation
- The spec's `implementation/` directory exists but is **empty** — no per-task-group
  implementation reports were written.

### Verification Documentation
- This report (`verifications/final-verification.md`) — created by this run; the
  `verifications/` directory did not previously exist.

### Missing Documentation
- Per-task-group implementation reports under
  `agent-os/specs/2026-05-31-sybase-metadata-enrichment/implementation/`.

This is non-blocking: the implementation itself is complete and fully evidenced
by the source code and the green test suites. The missing reports are a
process/paper-trail gap, not a code gap.

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Notes
No `agent-os/product/roadmap.md` file exists in the repository, and this spec is
a fidelity-parity enrichment of an existing discovery capability (driven by the
discovery oracle-perfection program in user memory, not a roadmap checklist
item). No roadmap checkbox corresponds to it. No update required.

---

## 4. Test Suite Results

**Status:** ✅ All Passing (within the verified scope)

Per the scope guardrails, the verification surface is: the Sybase sidecar Maven
module, `tsc --noEmit`, and the always-on Sybase Jest suite. The full
discovery-service Jest suite was intentionally NOT run (it carries ~30 known
pre-existing failures unrelated to this spec, being fixed in a separate pass).

### Commands run + results

**(1) Sidecar — `mvn -f sybase-discovery-sidecar/pom.xml test`**
- Result: **BUILD SUCCESS** — `Tests run: 74, Failures: 0, Errors: 0, Skipped: 0`
- Per-class (from `target/surefire-reports/*.txt`):
  - `SidecarControllerTest` — Tests run: 2, Failures: 0, Errors: 0
  - `SidecarSqlGuardTest` — Tests run: 43, Failures: 0, Errors: 0
  - `SybaseQueryServiceTest` — Tests run: 29, Failures: 0, Errors: 0

**(2) Discovery — `npx tsc --noEmit` (from `discovery-service/`)**
- Result: **clean**, exit code 0, zero type errors.

**(3) Discovery — `npx jest sybaseDiscoveryPack` (from `discovery-service/`)**
- Result: **Test Suites: 1 passed; Tests: 39 passed, 39 total.**
- Includes the new Spec-2026-05-31 describe blocks: new-field IR mapping +
  null-tolerance, JSONB/`constraints_metadata`/`fk_columns` reshaping, the
  data-Findings firing (`collation_case_sensitivity_hazard`,
  `sequence_cutover_hazard`, `db_resident_scheduled_job`), the three-state model
  (incl. older-sidecar-missing-capability ⇒ `unavailable`), and evidence-gap
  suppression vs emission.

### Test Summary (verified scope)
- **Total Tests:** 113 (74 Java + 39 Jest) + tsc clean
- **Passing:** 113
- **Failing:** 0
- **Errors:** 0

### Failed Tests
None within the verified scope — all passing.

### Notes
- The full discovery-service Jest suite was deliberately not run (out of scope;
  ~30 known pre-existing, unrelated failures per the spec's scope guardrails).
- The live-DB Sybase catalog SQL is exercised only via the opt-in
  `SYBASE_INTEGRATION` path (not in CI). Per requirements decision 5, the
  always-on bar is the pure per-row mapper unit tests + the fetch-mocked
  discovery suite — both green. The absence of a live-DB run is the agreed
  testing bar, not a gap.

---

## 5. Cross-Side Contract Seam (key integration point)

**Status:** ✅ Verified — exact match on both sides

### Capability-key vocabulary
Both sides use the identical six verbatim keys.

| Sidecar (`SybaseQueryService.java`) | Discovery (`sybaseIntrospection.ts` `SYBASE_METADATA_CAPABILITY`) |
| --- | --- |
| `CAP_COLLATION = "collation"` | `collation: 'collation'` |
| `CAP_COMPUTED_COLUMNS = "computed_columns"` | `computedColumns: 'computed_columns'` |
| `CAP_SEQUENCE_CURRENT_VALUE = "sequence_current_value"` | `sequenceCurrentValue: 'sequence_current_value'` |
| `CAP_FK_ACTIONS = "fk_actions"` | `fkActions: 'fk_actions'` |
| `CAP_INDEX_CLUSTERING = "index_clustering"` | `indexClustering: 'index_clustering'` |
| `CAP_SCHEDULED_JOBS = "db_jobs"` | `dbJobs: 'db_jobs'` |

The sidecar appends each key via `addCapability(...)` only on the path where that
group's read actually succeeds; discovery keys `resolveSupportedGroup(...)` on the
same strings. A capability absent from an older sidecar resolves to `unavailable`
(read gap), distinct from the discovery-internal structural N/A markers
(`index_predicate`, `native_sequence`) which the sidecar deliberately never advertises.

### Wire field names
- **Engine version: `serverVersion`** (NOT `engineVersion`) on both the sidecar
  record (`IntrospectionResponse.serverVersion`, read via `readServerVersion` →
  `SELECT @@version`) and the TS `SidecarIntrospectionResponse.serverVersion`.
  Confirmed — no `engineVersion` anywhere.
- **`keys[]` index fields** match verbatim on both sides: `indexDefinition`,
  `indexMethod`, `isClustered`, `indexPredicate`, `columnDirections`
  (plus `updateRule`/`deleteRule` for FK actions). The TS mapper copies all five
  onto `KeyOrIndexMetadata` (lines 366–386), replacing the prior bare
  `TODO(oracle-W3)` comment on the map.
- **Top-level `databaseCollation`** present on both records; discovery sets
  `IntrospectionResult.databaseCollation` from it.
- `indexPredicate` is carried for symmetry but is always null for ASE and resolves
  to `not_applicable_for_engine` (no evidence-gap Finding) — verified in both the
  resolver (`index_predicate: 'not_applicable_for_engine'`) and the Jest assertions.

---

## Verdict

✅ **PASS.** The Sybase metadata-enrichment spec is fully implemented, the
cross-side contract seam matches exactly, and all in-scope tests
(sidecar Maven 74/74, `tsc` clean, Sybase Jest 39/39) are green. The only
findings are non-blocking documentation gaps: the empty `implementation/`
directory (no per-group reports) and a tasks.md "vitest"→Jest wording nit.
AMS / frontend correctly untouched.
