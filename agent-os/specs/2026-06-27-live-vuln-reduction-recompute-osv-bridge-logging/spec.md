# Specification: Live vulnerability-reduction recompute + OSV gateway→discovery bridge + explicit logging (Spec C)

## Goal
Make the Target State → Architect Conversation "Estimated vulnerability reduction" widget track the conversation live: source target versions from captured answers (not just the manifest), recompute the cheap delta after every answer, and wire a real gateway→discovery OSV bridge so the "Newly introduced" bucket can actually populate — all behind a kill-switch, soft-degrading, and explicitly logged.

## User Stories
- As an architect, I want the reduction estimate to update after each versioned answer I capture so the widget reflects my in-conversation decisions, not only the uploaded manifest.
- As an operator on the work machine, I want greppable gateway logs showing whether an OSV scan ran and succeeded/failed (with reason + counts) so I can diagnose the "Newly introduced" bucket without a debugger.

## Specific Requirements

**New discovery raw-query OSV endpoint**
- Add `POST /discovery/vulnerabilities/osv-query-batch` to `discovery-service/src/routes/vulnerabilityEnrichment.ts` (router is mounted at `/` under `/discovery` in `discovery-service/src/routes/index.ts:99`), distinct from the architecture-scoped `vulnerabilities/scan`.
- Accept a raw body `{ queries: [{ coordinate, version, ecosystem }] }` (`ecosystem` is OSV-style `Maven`|`npm`) and call `OsvDevVulnerabilitySource.queryBatch` directly — it CANNOT reuse `vulnerabilities/scan`, which builds its own queries from the architecture SBOM.
- Return the structured `BatchQueryResult` projected onto the gateway's `TargetQueryResult` shape: `{ outcome: 'ok'|'unavailable', advisories: [{ cveId, nativeAdvisoryId, severity, affectedCoordinate, ecosystem }], unavailableReason? }` — drop the heavy `Advisory` fields the scan does not consume.
- STRICTLY NON-BLOCKING: always HTTP 200 with the structured result even when OSV degraded (the source already resolves `UNAVAILABLE` with `unavailableReason` from `classifyOsvFailure` → `timeout`/`proxy`/`tls`/`dns`/`http_*`/`error`); reserve 500 only for an unexpected handler fault.
- Keep the existing `[VulnEnrich]` / `[OsvDevVulnerabilitySource]` log lines; log request size (query count) and outcome.

**Gateway `DiscoveryOsvBridgeSource` adapter**
- New gateway-side class implementing `TargetVulnerabilitySource` (`gateway/src/services/vulnerabilityReduction/osvTargetScan.ts:116-123`): `id` (e.g. `discovery-osv-bridge`), and `queryBatch(queries)` POSTing to the new discovery endpoint; mirror the proxy shape in `gateway/src/routes/vulnerabilities.ts:320-394`.
- Construct from `getConfig().discoveryServiceBaseUrl` (`gateway/src/config.ts:260`); POST `{ queries }` with `Content-Type`/`Accept: application/json`.
- Fetch timeout ~20s (above discovery's 15s OSV timeout `OSV_REQUEST_TIMEOUT_MS`) via `AbortController`.
- MUST NEVER reject: any fetch/timeout/non-OK/parse error resolves to `{ outcome: 'unavailable', advisories: [], unavailableReason }` — map a non-OK or transport error to `unavailable` (or pass through the discovery-reported reason when the body carries one).
- Honour the kill-switch: when `OSV_REDUCTION_BRIDGE_ENABLED` is false, the resolver supplies `null` (so the scan emits `no_source`) — do not construct/POST.
- Implement `query(single)` by delegating to `queryBatch([single])` (the scan prefers `queryBatch` when present, per `queryAll`).

**Production resolver wiring at bootstrap**
- Call `setTargetOsvSourceResolver(() => OSV_REDUCTION_BRIDGE_ENABLED ? new DiscoveryOsvBridgeSource(getConfig().discoveryServiceBaseUrl) : null)` ONCE in `gateway/src/server.ts`, near the `vulnerabilityReductionRouter` mount (line ~161) — NOT lazily in the route.
- This replaces the hardcoded `() => null` seam at `gateway/src/routes/vulnerabilityReduction.ts:90`; `resolveTargetOsvSource()` already catches a resolver throw and degrades to null.
- Add `OSV_REDUCTION_BRIDGE_ENABLED` (default `true`) to gateway config; document it alongside `discoveryServiceBaseUrl`.

**Inverse `(decisionCode, framework) → (coordinate, ecosystem)` map**
- Author a NEW gateway module (e.g. `targetManifest/capturedDecisionOsvCoordinates.ts`) holding an explicit allow-list keyed by `decisionCode` + framework label, emitting `{ coordinate, ecosystem }`. The existing `manifestCodeMapping.ts` is FORWARD-direction (coordinate `test()` → code+framework) and is NOT invertible, so do not derive from it at runtime.
- Keep framework labels BYTE-CONSISTENT with `manifestCodeMapping.ts` (e.g. `Spring Boot`, `Quarkus`, `Micronaut`, `NestJS`, `pgjdbc`, `mysql-connector-j`, `React`, `Vue`, `Angular`, `Svelte`).
- Map only codes with an unambiguous OSV coordinate: `service.framework`, `db.driver`, `ui.framework`, and other versioned codes whose coordinate is unambiguous in `manifestCodeMapping.ts`; SKIP codes with no useful single coordinate (e.g. `build.tool`, `testing.unit`).
- For a multi-coordinate framework (e.g. Spring Boot spans many artifacts) pick the single canonical OSV coordinate (e.g. `org.springframework.boot:spring-boot`).
- Feed only MAPPED codes into the target set; silently skip unmapped codes (logged count-only, never guessed).
- Guard with a drift test mirroring `__tests__/manifestCodeMapping.guardrail.test.ts`: assert every framework label the new map keys on is a label `manifestCodeMapping.ts` can emit (read `ALL_COORDINATE_RULE_ANSWERS` / `COORDINATE_ANSWERABLE_CODES`, never a fixture copy).

**Conversational versions feed the target set**
- In the frontend (`ArchitectConversationTab.tsx` / `useVulnerabilityReduction.ts`), additionally derive target versions from the conversation's captured versioned answers (the `{ framework, version }` envelope), resolved through the new inverse map to `{ coordinate, version, ecosystem }`.
- MERGE with the manifest-derived `targetResolvedDependencies`: the manifest's concrete resolved version WINS on coordinate overlap (preserve the existing "concrete > generic" merge discipline in `buildTargetInputsFromResolvedDeps`).
- A `version-unknown` / sentinel captured version rides through unchanged (the scan's `isScannableTargetVersion` excludes it; never guess).
- Skipped (unmapped) captured codes are surfaced count-only in logging, never sent to OSV.

**Live per-answer delta recompute (OSV suppressed)**
- Add a `skipOsv: true` request flag to the gateway compute route (`gateway/src/routes/vulnerabilityReduction.ts` compute handler + `runReductionCompute`): when set, compute the in-memory delta but pass `null`/skip to `applyTargetScanToDelta` so the OSV scan does not run.
- Wire `handleCaptureAnswer` (`ArchitectConversationTab.tsx:617-659`) to trigger a recompute after a successful capture (bump a `recomputeToken` passed into the hook, or call the hook's `recompute()`), with the per-answer compute carrying `skipOsv: true`.
- Pass `recomputeToken` into `useVulnerabilityReduction` (currently NOT passed at `ArchitectConversationTab.tsx:372-377`); a per-answer current-vulns re-fetch is acceptable (established pattern).
- Preserve the single-shared-delta discipline: one delta computed in the hook, read by both steering surfaces; no per-surface re-derivation.

**Throttled OSV triggers**
- Run the (expensive) OSV scan only on: (a) manifest upload, (b) conversation close (critical hard-gate evaluation), and (c) a ~3s debounce after captured answers settle.
- The debounced/throttled triggers issue a compute WITHOUT `skipOsv` (full scan); per-answer recomputes use `skipOsv: true`.
- Implement the ~3s debounce in the frontend close to `handleCaptureAnswer` so rapid answers coalesce into one OSV scan.

**Soft-degrade + reason-code preservation**
- On ANY bridge error degrade SOFT to the existing reason codes via the unchanged `osvTargetScan.ts` contract: `no_source` (when resolver returns null / flag off), `unavailable`, or the discovery-reported `timeout`/`proxy`/`tls`/`dns`/`http_*` when the bridge surfaces them in `unavailableReason`.
- NEVER block the conversation; the `unavailableNote` "estimate, not a guarantee" copy and the absent-vs-empty `newly_introduced` bucket semantics MUST be preserved exactly.

**Explicit greppable logging**
- Gateway lifecycle at `logger.info`, degrades at `logger.warn`, correlated by the existing `requestId`.
- Stable prefixes: `[VulnReduction]` (orchestration), `[OSV]` (scan outcome), `[OSV bridge]` (adapter request/outcome).
- EMIT the existing `osv.logLines` (built in `osvTargetScan.ts`) to the LOGGER under `[OSV]` (today they only ride the HTTP response in `osvSlice`); do not remove them from the response.
- Log at decision points: source wired/not, scan attempted (vs `skipOsv`), outcome + reason, and counts (scanned coordinates = `queriesBuilt`, newly-introduced CVE count, excluded count, unmapped captured-code skip count).
- The bridge adapter logs `[OSV bridge]` request (query count, target URL) + outcome (status/reason). The discovery endpoint keeps `[VulnEnrich]` / `[OsvDevVulnerabilitySource]`.

## Visual Design
No visual assets provided (`planning/visuals/` is empty); this spec is grounded entirely on code.

## Existing Code to Leverage

**`gateway/src/routes/vulnerabilities.ts` (`vulnerabilities/scan` proxy, ~320-394)**
- The thin `fetch(discoveryServiceBaseUrl + /discovery/...)` proxy template — copy its status/body relay + try/catch → 503 shape for the `DiscoveryOsvBridgeSource` POST.
- Demonstrates the gateway→discovery URL construction and JSON content-type handling.

**`gateway/src/routes/vulnerabilityReduction.ts` (resolver seam + `runReductionCompute`)**
- `setTargetOsvSourceResolver` / `resolveTargetOsvSource` (lines 90-110) is the DI seam to wire in `server.ts`; `resolveTargetOsvSource` already degrades a resolver throw to null.
- `runReductionCompute` (~297) is the single shared recompute used by both compute and use-version routes — add `skipOsv` here, not in a parallel path.

**`gateway/src/services/vulnerabilityReduction/osvTargetScan.ts`**
- `TargetVulnerabilitySource` / `TargetVulnerabilityQuery` / `TargetQueryResult` / `TargetAdvisory` are the EXACT contracts the new endpoint + adapter must satisfy; `queryAll` prefers `queryBatch`.
- The reason-code, `unavailableNote`, and absent-vs-empty bucket semantics are reused unchanged; only the `logLines` emission target changes (now also the logger).

**`discovery-service/src/services/vulnerabilityEnrichment/osvDevVulnerabilitySource.ts` + `vulnerabilitySource.ts`**
- `OsvDevVulnerabilitySource.queryBatch(queries: VulnerabilityQuery[])` already does the OSV `querybatch` + hydrate and returns a non-rejecting `BatchQueryResult`; the new endpoint calls it directly and projects `Advisory` → the lean `TargetAdvisory` fields.
- `classifyOsvFailure` already yields the `timeout`/`proxy`/`tls`/`dns`/`http_*` reasons the soft-degrade contract expects.

**`gateway/src/services/targetManifest/manifestCodeMapping.ts` + `__tests__/manifestCodeMapping.guardrail.test.ts`**
- Source of truth for framework labels the new inverse map must match; `ALL_COORDINATE_RULE_ANSWERS` / `COORDINATE_ANSWERABLE_CODES` (lines ~503/516) are the drift-guard enumeration to read in the new map's guardrail test.

## Out of Scope
- Any AMS (`architecture-model-service`) change.
- Spec A (right-panel UX) and Spec B (version-unknown → pending questions); this spec is compatible with but NOT dependent on Spec B, which routes confirmed versions through the normal capture path that this spec's conversational-version sourcing consumes.
- Coordinate mapping for codes without an unambiguous single OSV coordinate (e.g. `build.tool`, `testing.unit`, ambiguous combo codes).
- Guessing/inferring coordinates or versions for unmapped codes or `version-unknown` answers.
- Building a new OSV client / offline mirror in the gateway (the gateway only bridges to discovery).
- Changing the architecture-scoped `vulnerabilities/scan` endpoint or its contract.
- Reworking the delta classification, reason-code set, `unavailableNote` copy, or the single-shared-delta discipline.

## Verification / Testing
- The application runs on a DIFFERENT machine: do NOT start servers or curl/probe localhost. Verify only via unit/integration tests with injected stubs.
- Mirror the constructor/seam-injection style of `osvTargetScan.test.ts` and `osvVulnerabilitySource.test.ts`: inject a stub `TargetVulnerabilitySource` / stub fetch into `DiscoveryOsvBridgeSource`; assert non-rejection + correct reason mapping across the failure matrix (timeout/non-OK/parse/abort).
- Add the inverse-map drift test mirroring `manifestCodeMapping.guardrail.test.ts` (read the REAL `ALL_COORDINATE_RULE_ANSWERS`, not a fixture).
- Test the new discovery endpoint with an injected `OsvDevVulnerabilitySource` stub (its constructor already accepts an injected axios client) asserting the lean `TargetQueryResult` projection and always-200 degrade.
- Whole-repo frontend `tsc`/lint is pre-existingly RED on `main`; verify frontend changes in isolation.
</content>
</invoke>
