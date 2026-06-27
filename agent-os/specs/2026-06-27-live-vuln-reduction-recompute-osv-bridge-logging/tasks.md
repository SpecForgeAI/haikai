# Task Breakdown: Live vuln-reduction recompute + OSV gateway→discovery bridge + explicit logging (Spec C)

## Overview
Total Tasks: 5 task groups

Spec touches three services with no AMS change: discovery (new raw-query OSV endpoint), gateway (bridge adapter + bootstrap wiring + inverse map + skipOsv flag + logging), and frontend (conversational versions feed + live recompute + throttle).

**Cross-cutting verification rule (applies to EVERY group):** The application runs on a DIFFERENT machine. Do NOT start servers, do NOT curl/probe localhost, do NOT hit the network. ALL verification is via unit/integration tests with INJECTED STUBS, mirroring the seam-injection style of `gateway/src/services/vulnerabilityReduction/__tests__/osvTargetScan.test.ts` and `discovery-service/src/services/vulnerabilityEnrichment/__tests__/osvVulnerabilitySource.test.ts` (inject a stub `TargetVulnerabilitySource` / stub fetch / injected axios client). Gateway and discovery run their own test runners in isolation. Whole-repo frontend `tsc`/lint is pre-existingly RED on `main` — verify frontend changes IN ISOLATION (touched files + relevant component/hook tests only), never the whole-repo build.

## Task List

### Discovery Layer

#### Task Group 1: Raw-query OSV batch endpoint
**Dependencies:** None
**Service:** discovery-service (own test runner)

- [x] 1.0 Complete the discovery raw-query OSV batch endpoint
  - [x] 1.1 Write 2-8 focused tests for the new endpoint
    - Limit to 2-8 highly focused tests maximum
    - Inject a stub `OsvDevVulnerabilitySource` (its constructor already accepts an injected axios client — mirror `osvVulnerabilitySource.test.ts`); do NOT hit the network
    - Cover: (a) happy-path projection of `BatchQueryResult` → lean `TargetQueryResult` shape (`{ outcome, advisories: [{ cveId, nativeAdvisoryId, severity, affectedCoordinate, ecosystem }], unavailableReason? }`), (b) always-HTTP-200 degrade when the source resolves `UNAVAILABLE` with a `unavailableReason` (timeout/proxy/tls/dns/http_*), (c) heavy `Advisory` fields are dropped
    - Skip exhaustive coverage of every reason-code permutation
  - [x] 1.2 Add `POST /discovery/vulnerabilities/osv-query-batch` to `discovery-service/src/routes/vulnerabilityEnrichment.ts`
    - Router is mounted at `/` under `/discovery` (`discovery-service/src/routes/index.ts:99`)
    - Distinct from the architecture-scoped `vulnerabilities/scan` (which builds its own SBOM queries — do NOT reuse it)
    - Accept raw body `{ queries: [{ coordinate, version, ecosystem }] }` where `ecosystem` is OSV-style `Maven`|`npm`
    - Call `OsvDevVulnerabilitySource.queryBatch` directly
  - [x] 1.3 Project the rich discovery `Advisory` down to the lean `TargetQueryResult` shape
    - Emit only `{ outcome: 'ok'|'unavailable', advisories: [{ cveId, nativeAdvisoryId, severity, affectedCoordinate, ecosystem }], unavailableReason? }`
    - This is the exact shape the gateway adapter (Group 2) consumes — keep it byte-aligned with `osvTargetScan.ts` `TargetQueryResult`/`TargetAdvisory`
  - [x] 1.4 Enforce strictly non-blocking semantics
    - ALWAYS HTTP 200 with the structured result, even on OSV degrade (source already resolves `UNAVAILABLE` with `unavailableReason` from `classifyOsvFailure`)
    - Reserve HTTP 500 ONLY for an unexpected handler fault
  - [x] 1.5 Preserve existing logging
    - Keep the `[VulnEnrich]` / `[OsvDevVulnerabilitySource]` log lines unchanged
    - Add log of request size (query count) and outcome
  - [x] 1.6 Ensure discovery endpoint tests pass (isolation only)
    - Run ONLY the 2-8 tests from 1.1 via the discovery-service test runner
    - Do NOT start the server, do NOT curl localhost, do NOT hit OSV
    - Do NOT run the entire discovery test suite

**Acceptance Criteria:**
- The 2-8 tests from 1.1 pass via the discovery test runner with an injected source stub
- Endpoint returns the lean `TargetQueryResult` projection and always-200 on degrade
- Heavy `Advisory` fields are dropped; `[VulnEnrich]`/`[OsvDevVulnerabilitySource]` logging retained
- No network access in any test

### Gateway Layer

#### Task Group 2: `DiscoveryOsvBridgeSource` adapter + bootstrap wiring + kill-switch
**Dependencies:** Task Group 1 (consumes the new endpoint's request/response shape)
**Service:** gateway (own test runner)

- [x] 2.0 Complete the gateway bridge adapter, bootstrap wiring, and flag
  - [x] 2.1 Write 2-8 focused tests for the adapter
    - Limit to 2-8 highly focused tests maximum
    - Inject a stub `fetch` into `DiscoveryOsvBridgeSource`; do NOT hit the network (mirror `osvTargetScan.test.ts` seam style)
    - Cover the failure matrix asserting NON-REJECTION + correct reason mapping: transport error → `unavailable`, abort/timeout → `timeout`, non-2xx → `http_*`/`unavailable`, parse error → `unavailable`, and pass-through of a discovery-reported `unavailableReason`
    - Cover `query(single)` delegating to `queryBatch([single])`
    - Skip exhaustive coverage of every HTTP status code
  - [x] 2.2 Implement `DiscoveryOsvBridgeSource` implementing `TargetVulnerabilitySource`
    - `id` e.g. `discovery-osv-bridge`; `queryBatch(queries)` POSTs `{ queries }` to the new discovery endpoint with `Content-Type`/`Accept: application/json`
    - Construct from `getConfig().discoveryServiceBaseUrl` (`gateway/src/config.ts:260`)
    - Mirror the proxy shape in `gateway/src/routes/vulnerabilities.ts:320-394`
    - Implement `query(single)` by delegating to `queryBatch([single])` (`queryAll` prefers `queryBatch`)
  - [x] 2.3 Add ~20s fetch timeout via `AbortController`
    - Above discovery's 15s OSV timeout (`OSV_REQUEST_TIMEOUT_MS`)
  - [x] 2.4 Guarantee the adapter NEVER rejects
    - Any fetch/timeout/non-OK/parse error resolves to `{ outcome: 'unavailable', advisories: [], unavailableReason }`
    - Map non-OK / transport / abort errors to the existing reason codes (`unavailable`/`timeout`/`proxy`/`tls`/`dns`/`http_*`); pass through the discovery-reported reason when the body carries one
  - [x] 2.5 Add `OSV_REDUCTION_BRIDGE_ENABLED` to `gateway/src/config.ts` (default `true`)
    - Document it alongside `discoveryServiceBaseUrl`
  - [x] 2.6 Wire the production resolver ONCE at bootstrap in `gateway/src/server.ts`
    - `setTargetOsvSourceResolver(() => OSV_REDUCTION_BRIDGE_ENABLED ? new DiscoveryOsvBridgeSource(getConfig().discoveryServiceBaseUrl) : null)` near the `vulnerabilityReductionRouter` mount (~line 161)
    - Replaces the hardcoded `() => null` seam at `gateway/src/routes/vulnerabilityReduction.ts:90`; NOT lazily in the route
    - When the flag is false the resolver returns `null` (existing `no_source` degrade); do NOT construct/POST
  - [x] 2.7 Ensure adapter tests pass (isolation only)
    - Run ONLY the 2-8 tests from 2.1 via the gateway test runner with the injected fetch stub
    - Do NOT start servers, do NOT curl localhost, do NOT hit the network
    - Do NOT run the entire gateway test suite

**Acceptance Criteria:**
- The 2-8 tests from 2.1 pass with injected stubs only
- Adapter never rejects; full failure matrix maps to the correct existing reason codes
- `query` delegates to `queryBatch`; ~20s timeout enforced
- Resolver wired exactly once in `server.ts`; flag off → resolver returns null
- `OSV_REDUCTION_BRIDGE_ENABLED` defaults true and is documented

#### Task Group 3: Inverse decision-code→coordinate map + guardrail + `skipOsv` flag
**Dependencies:** Task Group 2 (same gateway files / `runReductionCompute`; run sequentially after 2)
**Service:** gateway (own test runner)

- [x] 3.0 Complete the inverse coordinate map and the skipOsv compute flag
  - [x] 3.1 Write 2-8 focused tests for the map + skipOsv behaviour
    - Limit to 2-8 highly focused tests maximum
    - Cover: (a) a representative mapped code resolves to the expected `{ coordinate, ecosystem }` (e.g. `service.framework`/`Spring Boot` → `org.springframework.boot:spring-boot`, Maven), (b) an unmapped code (e.g. `build.tool`/`testing.unit`) returns no coordinate (silently skipped), (c) `skipOsv: true` on the compute route suppresses the OSV scan (delta still computed, `applyTargetScanToDelta` receives null/skip)
    - The drift/guardrail test (3.4) is in addition to these
    - Skip exhaustive enumeration of every framework
  - [x] 3.2 Author the inverse map module `gateway/src/services/targetManifest/capturedDecisionOsvCoordinates.ts`
    - Explicit allow-list keyed by `decisionCode` + framework label → `{ coordinate, ecosystem }`
    - Framework labels BYTE-CONSISTENT with `manifestCodeMapping.ts` (`Spring Boot`, `Quarkus`, `Micronaut`, `NestJS`, `pgjdbc`, `mysql-connector-j`, `React`, `Vue`, `Angular`, `Svelte`)
    - Do NOT derive from `manifestCodeMapping.ts` at runtime (it is forward-only / not invertible)
  - [x] 3.3 Scope the mapped codes
    - Map only codes with an unambiguous single OSV coordinate: `service.framework`, `db.driver`, `ui.framework`, and other versioned codes whose coordinate is unambiguous
    - For multi-coordinate frameworks (e.g. Spring Boot) pick the single canonical coordinate (`org.springframework.boot:spring-boot`)
    - SKIP codes with no useful single coordinate (`build.tool`, `testing.unit`, ambiguous combo codes)
  - [x] 3.4 Add the drift/guardrail test
    - Mirror `gateway/src/services/targetManifest/__tests__/manifestCodeMapping.guardrail.test.ts`
    - Assert every framework label the new map keys on is a label `manifestCodeMapping.ts` can emit, reading the REAL `ALL_COORDINATE_RULE_ANSWERS` / `COORDINATE_ANSWERABLE_CODES` (lines ~503/516) — NEVER a fixture copy
  - [x] 3.5 Add the `skipOsv: true` request flag to the compute path
    - Thread through the compute handler + `runReductionCompute` (~297) in `gateway/src/routes/vulnerabilityReduction.ts` — the single shared recompute used by both compute and use-version routes (do NOT add a parallel path)
    - When set: compute the in-memory delta but pass `null`/skip to `applyTargetScanToDelta` so the OSV scan does not run
    - Preserve the single-shared-delta discipline (one delta, no per-surface re-derivation)
  - [x] 3.6 Ensure map + skipOsv tests pass (isolation only)
    - Run ONLY the tests from 3.1 + 3.4 via the gateway test runner
    - Do NOT start servers, do NOT curl localhost, do NOT hit the network
    - Do NOT run the entire gateway test suite

**Acceptance Criteria:**
- The 2-8 tests from 3.1 pass plus the guardrail test from 3.4
- Inverse map emits canonical coordinates for mapped codes; unmapped codes return nothing
- Guardrail test reads the real `ALL_COORDINATE_RULE_ANSWERS` and detects label drift
- `skipOsv: true` suppresses the OSV scan while still producing the delta; single-shared-delta preserved

#### Task Group 4: Explicit greppable logging
**Dependencies:** Task Groups 2-3 (same gateway compute/scan files; run sequentially after 3)
**Service:** gateway (own test runner)

- [x] 4.0 Complete explicit gateway logging across the reduction path
  - [x] 4.1 Write 2-8 focused tests for logging
    - Limit to 2-8 highly focused tests maximum
    - Spy on the logger; assert expected log lines fire on (a) a success path and (b) a degrade path
    - Assert prefixes `[VulnReduction]` / `[OSV]` / `[OSV bridge]`, info-vs-warn level split, and that counts + reason appear
    - Skip exhaustive per-line assertions
  - [x] 4.2 Add lifecycle logging at `logger.info`, degrades at `logger.warn`
    - Correlate by the existing `requestId` (per-compute correlation id — reuse, do not invent)
    - Log decision points: source wired/not, scan attempted (vs `skipOsv`), outcome + reason
  - [x] 4.3 Emit `osv.logLines` to the logger under `[OSV]`
    - These are built in `osvTargetScan.ts` and today only ride the HTTP response via `osvSlice` — EMIT to the logger too; do NOT remove them from the response
  - [x] 4.4 Log the counts and the `[OSV bridge]` adapter lines
    - Counts: scanned coordinates (`queriesBuilt`), newly-introduced CVE count, excluded count, unmapped captured-code skip count
    - `[OSV bridge]` logs request (query count, target URL) + outcome (status/reason)
    - Use the stable prefixes: `[VulnReduction]` (orchestration), `[OSV]` (scan outcome), `[OSV bridge]` (adapter)
  - [x] 4.5 Ensure logging tests pass (isolation only)
    - Run ONLY the tests from 4.1 via the gateway test runner with a spied logger
    - Do NOT start servers, do NOT curl localhost, do NOT hit the network
    - Do NOT run the entire gateway test suite

**Acceptance Criteria:**
- The 2-8 tests from 4.1 pass with a spied logger
- Success path logs at info, degrade at warn, both correlated by `requestId`
- `[VulnReduction]`/`[OSV]`/`[OSV bridge]` prefixes present; `osv.logLines` emitted to logger AND retained in response
- Counts (scanned/newly-introduced/excluded/unmapped-skip) appear in logs

### Frontend Layer

#### Task Group 5: Conversational versions feed estimate + live recompute + throttle
**Dependencies:** Task Group 3 (inverse map + `skipOsv` flag contract)
**Service:** frontend (verify IN ISOLATION — whole-repo tsc/lint is RED on main)

- [x] 5.0 Complete frontend conversational sourcing, live recompute, and throttle
  - [x] 5.1 Write 2-8 focused tests for the frontend wiring
    - Limit to 2-8 highly focused tests maximum
    - Cover: (a) a captured versioned answer feeds the target set (resolved through the inverse map to `{ coordinate, version, ecosystem }` and merged into `targetResolvedDependencies`, with manifest concrete version winning on overlap), (b) a per-answer recompute fires after a successful capture carrying `skipOsv: true`, (c) debounce/throttle: rapid answers coalesce into ONE full (no-skipOsv) OSV compute after ~3s
    - Skip exhaustive component-state coverage
  - [x] 5.2 Derive target versions from captured versioned answers
    - In `useVulnerabilityReduction.ts` / `ArchitectConversationTab.tsx`, map the conversation's captured `{ framework, version }` envelopes through the inverse map (or its frontend mirror) to `{ coordinate, version, ecosystem }`
    - A `version-unknown` / sentinel version rides through unchanged (scan's `isScannableTargetVersion` excludes it — never guess)
  - [x] 5.3 Merge with the manifest-derived target set
    - MERGE into `targetResolvedDependencies`; manifest concrete resolved version WINS on coordinate overlap (preserve the "concrete > generic" merge discipline in `buildTargetInputsFromResolvedDeps`)
    - Unmapped captured codes are skipped (surfaced count-only in logging, never sent to OSV)
  - [x] 5.4 Wire per-answer live recompute (OSV suppressed)
    - `handleCaptureAnswer` (`ArchitectConversationTab.tsx:617-659`) triggers a recompute after a successful capture (bump a `recomputeToken` into the hook or call the hook's `recompute()`)
    - Pass `recomputeToken` into `useVulnerabilityReduction` (currently NOT passed at `ArchitectConversationTab.tsx:372-377`)
    - The per-answer compute carries `skipOsv: true`; a per-answer current-vulns re-fetch is acceptable (established pattern)
    - Preserve the single-shared-delta discipline (one delta read by both steering surfaces)
  - [x] 5.5 Implement throttled OSV triggers
    - Full OSV scan (WITHOUT `skipOsv`) runs only on: (a) manifest upload, (b) conversation close (hard-gate evaluation), (c) a ~3s debounce after captured answers settle
    - Implement the ~3s debounce near `handleCaptureAnswer` so rapid answers coalesce into one OSV scan
    - Preserve the `unavailableNote` "estimate, not a guarantee" copy and absent-vs-empty `newly_introduced` bucket semantics exactly
  - [x] 5.6 Ensure frontend tests pass IN ISOLATION
    - Run ONLY the tests from 5.1 plus relevant touched-component/hook tests
    - Verify touched files in isolation; do NOT run whole-repo `tsc`/lint (pre-existingly RED on main)
    - Do NOT start servers, do NOT curl localhost, do NOT hit the network

**Acceptance Criteria:**
- The 2-8 tests from 5.1 pass in isolation
- Captured versioned answers feed the target set; manifest concrete version wins on overlap
- Per-answer recompute fires with `skipOsv: true`; rapid answers coalesce into one ~3s-debounced full OSV compute
- `version-unknown` rides through unchanged; unmapped codes skipped count-only
- "estimate, not a guarantee" copy and bucket semantics preserved; single-shared-delta intact

## Execution Order

Recommended implementation sequence (groups touching the same gateway files run sequentially):
1. Discovery raw-query OSV endpoint (Task Group 1) — defines the endpoint request/response shape
2. Gateway bridge adapter + bootstrap wiring + flag (Task Group 2) — depends on Group 1's shape
3. Gateway inverse map + guardrail + `skipOsv` flag (Task Group 3) — gateway, after Group 2
4. Gateway explicit logging (Task Group 4) — gateway, after Group 3 (same compute/scan files)
5. Frontend conversational sourcing + live recompute + throttle (Task Group 5) — depends on Group 3's map + `skipOsv`

Groups 1 can proceed independently; 2→3→4 are sequential on shared gateway files; 5 follows 3.
