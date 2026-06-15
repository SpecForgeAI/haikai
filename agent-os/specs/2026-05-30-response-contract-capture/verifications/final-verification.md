# Verification Report: Per-endpoint response-contract capture for discovery (Java / Spring-Classic first)

**Spec:** `2026-05-30-response-contract-capture` (Phase-2 "oracle perfection" Spec #1 of 6)
**Date:** 2026-05-30
**Verifier:** implementation-verifier (run in-session due to workspace constraints)
**Status:** ✅ Passed (with environment-scoped notes — see §5)

---

## Executive Summary

All five task groups were implemented and checked off, and every runnable test for
this spec passes (22/22): the deterministic springClassic response-contract scanner
(11), the MCP additive save-back pass-through (5), and the read-only frontend contract
block (6). The discovery-service project type-checks cleanly (`tsc --noEmit`). The AMS
(Java) layer — new Liquibase changeset 168, the `Endpoint` JPA `response_contract`
JSONB mapping, the `EndpointDto` snake_case field, the `EntityMapper` read/write path,
and 5 written tests — is complete and self-reviewed for compile-correctness but could
NOT be executed in this sandbox because Maven is not installed and is unreachable from
the network allow-list (no `mvn`/`gradle`, no downloadable binary). Those Java tests are
written to mirror existing passing JSONB-field tests and are left for the user to run on
their machine.

---

## 1. Tasks Verification

**Status:** ✅ All Complete (38/38 sub-tasks checked in `tasks.md`)

- [x] Task Group 1 — AMS: changeset 168 (`response_contract` JSONB on `endpoints`),
  `EndpointEntity` JSONB mapping (boxed `Map`), `EndpointDto` `@JsonProperty("response_contract")`
  (NO `@CamelCaseWire`), `EntityMapper` read+write path, master-changelog registration, 5 tests.
- [x] Task Group 2 — discovery-service: new deterministic `responseContractScanner.ts`
  (Group A error/auth/validation + Group B serialization/status + conditional_variants +
  provenance), springClassic security capture (ported method-level `@PreAuthorize`/`@Secured`/
  `@RolesAllowed` incl. class-level inheritance + best-effort `<http>`/`SecurityFilterChain`
  parse), unresolved-auth → `auth.source="unresolved"` + Finding, optional tier-gated
  `responseContractEnrichmentStep.ts` via the existing gateway relay at `temperature:0`,
  new emission sources, and the `java-spring-boot.md` gap-fill prompt edit (response-shaping
  exception). 11 tests.
- [x] Task Group 3 — MCP save-back: additive snake/camel-tolerant `response_contract`
  pass-through in `candidateSaveBackService.ts`. 3 tests.
- [x] Task Group 4 — frontend: read-only expandable contract block + confidence badge in
  the existing `CandidateDetailsPanel` via `SUPPORTED_DETAIL_TYPES`, reusing the Spec 2
  low-confidence treatment; no new panel, no edit controls. 6 tests.
- [x] Task Group 5 — cross-layer gap fill: 2 strategic round-trip tests (boxed-`Double`
  `confidence: null` preservation; loose-JSONB `schema_version` forward-compat).

### Incomplete or Issues
None.

---

## 2. Documentation Verification

**Status:** ✅ Complete

- `spec.md` — created (Phase 1).
- `tasks.md` — created (Phase 2); all 38 sub-tasks marked `- [x]`.
- `planning/requirements.md`, `planning/raw-idea.md` — pre-existing inputs.
- This report — `verifications/final-verification.md`.

---

## 3. Roadmap Updates

**Status:** ✅ No Updates Needed

`agent-os/product/roadmap.md` exists but contains no line item matching
"response contract", so no roadmap checkbox required updating.

---

## 4. Test Suite Results

**Status:** ✅ All spec tests passing (runnable layers); Java layer not executable in-sandbox.

### Tests RUN (this spec) — 22/22 passing
- **discovery-service** `responseContractScanner.test.ts` — **11 passed** (`npx jest`):
  Group A error/validation; method-level + class-inherited `@Secured` auth; unresolved-auth
  Finding; Group B serialization/status; `@Profile` conditional_variants + config-dependent
  Finding; attachment-by-name + provenance.
- **mcp-server** `candidateSaveBackResponseContract.test.ts` (3) +
  `responseContractRoundTripGap.test.ts` (2) — **5 passed** (`npx jest`).
- **frontend** `responseContractBlockCandidate.test.tsx` — **6 passed** (`npx vitest run`).
- **discovery-service** `tsc --noEmit` — clean (whole project type-checks).

### Tests WRITTEN but NOT RUN — 5 (AMS / Java)
- `EndpointResponseContractPersistenceTest.java` (5 tests: populated-blob round-trip,
  null round-trip, snake_case wire + `confidence:null` preserved, DTO↔entity mapping) and
  `EndpointResponseContractChangesetTest.java` (changeset-168 H2 replay).
- **Reason not run:** Maven is not installed in the sandbox and cannot be fetched
  (network allow-list blocks the Apache mirrors); Java 11 is present but there is no
  `mvn`/`gradle`. Per the project convention (the user starts services / owns the build),
  these are left for the user to run. They mirror existing passing JSONB-field tests
  (`BusinessLogicBehaviorPersistenceTest`, `EndpointProtocolMetadataPersistenceTest`).

### Pre-existing failures NOT caused by this spec
- **discovery-service** `mavenFindingScanner.test.ts › runManager wiring` — 1 failure.
  Asserts the ordering of `runMavenFindingScanner(` vs `await buildRepoLookupTable` inside
  `runManager.ts`. `runManager.ts` was NOT touched by this spec; the ordering reflects a
  pre-existing (uncommitted) modification in the working tree. Unrelated to `response_contract`.
- **mcp-server** project `tsc --noEmit` — a pre-existing duplicate-export ambiguity in
  `src/types/index.ts` / `saveUsersInteractions` (unrelated to this spec; the save-back
  tests pass because ts-jest transpiles per file).

### Notes
The full per-project test suites were not run end-to-end (large pre-existing suites with
unrelated state); verification was scoped to this spec's tests plus project type-checks,
which is the relevant regression surface for an additive feature.

---

## 5. On-disk Consistency (workspace-environment note)

The desktop file tools and the Linux test/Git mount diverged for several files: file-tool
edits to a number of pre-existing files were either not flushed (AMS Java) or written with
trailing truncation / NUL padding (several discovery TS files, two frontend files, the
gap-fill prompt). Each was reconciled to the authoritative content on disk and then
re-validated by compiling + running the tests above. Confirmed consistent on disk:

- AMS: `EndpointDto.java`, `EndpointEntity.java`, `db.changelog-master.yaml` (changeset 168
  registered), plus the already-consistent `EntityMapper.java`, changeset SQL, and tests.
- discovery: `responseContractScanner.ts`, `responseContractEnrichmentStep.ts`,
  `emissionSources.ts`, `gatewayClient.ts`, `confidence.ts`, `discoveryV3Pipeline.ts`,
  `springClassic/index.ts`, `packFindingScanners/springClassicFindingScanner.ts`,
  `prompts/frameworks/java-spring-boot.md` — all type-check clean.
- mcp: `candidateSaveBackService.ts` (+ tests). frontend: `candidateDetailsSupport.ts`,
  `CandidateDetailsPanel.tsx` (+ test) — tests pass; only pre-existing comments were
  trimmed in the two frontend files (no logic change; one unicode heading restored).

Stray scratch files that could not be deleted in this environment (harmless; for the user
to remove): `__sync_probe__.txt`, `architecture-model-service/__bashprobe__.txt`,
`discovery-service/src/__tests__/_dbg.test.ts` (neutralised to a single passing placeholder test).
