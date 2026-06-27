# Spec Requirements: Live vulnerability-reduction recompute + OSV gateway→discovery bridge + explicit logging (Spec C)

## Initial Description
See `planning/raw-idea.md`. Four problems in the "Estimated vulnerability reduction" widget (Target State → Architect Conversation):
1. Target versions come only from an uploaded manifest, not from conversationally-captured versioned answers.
2. The estimate does not recompute after each captured answer (only on upload / use-version / manual-edit).
3. The gateway reduction path's OSV source is hardcoded `null` (`vulnerabilityReduction.ts:90`), so "Newly introduced" is always `no_source` — the gateway→discovery OSV bridge does not exist.
4. The user wants explicit, greppable gateway logging so success/failure of an OSV scan is visible on the work machine.

## Requirements Discussion

### First Round Questions

All seven clarifying questions were answered by the user with "Defaults fine on all" — every recommended default below is CONFIRMED exactly as proposed.

**Q1 — How is the gateway→discovery OSV bridge built?**
**Answer (confirmed default):** Build a NEW discovery-service endpoint (e.g. `POST /discovery/vulnerabilities/osv-query-batch`) that exposes `OsvDevVulnerabilitySource.queryBatch` over the raw `{ coordinate, version, ecosystem }` contract, PLUS a gateway-side `TargetVulnerabilitySource` adapter (e.g. `DiscoveryOsvBridgeSource`) that POSTs to it, mirroring the existing `gateway/src/routes/vulnerabilities.ts` proxy. The architecture-scoped `vulnerabilities/scan` endpoint CANNOT serve the raw queryBatch contract (it builds its own queries from the architecture SBOM), so it is NOT reused.

**Q2 — Where is the resolver wired in production?**
**Answer (confirmed default):** Wire `setTargetOsvSourceResolver(() => new DiscoveryOsvBridgeSource(getConfig().discoveryServiceBaseUrl))` ONCE at gateway bootstrap (`server.ts`, near where `vulnerabilityReductionRouter` is mounted), NOT lazily inside the route.

**Q3 — How are captured versioned decisions turned into OSV coordinates?**
**Answer (confirmed default):** Maintain a small EXPLICIT allow-list mapping versioned decision codes → coordinate + ecosystem. Feed only mapped codes into `targetResolvedDependencies` (merged with the manifest set; the manifest's concrete version WINS on overlap). Silently skip unmapped codes (logged count-only, never guessed).

**Q4 — How does per-answer recompute avoid hammering OSV?**
**Answer (confirmed default):** Per-answer recompute hits the existing gateway compute endpoint but with the OSV scan SUPPRESSED via a new `skipOsv: true` request flag; only the throttled triggers run OSV. Re-fetching current-vulns per answer is acceptable (established pattern).

**Q5 — When does the (expensive) OSV scan actually run?**
**Answer (confirmed default):** Throttled OSV triggers are: (a) on manifest upload, (b) on conversation close (critical hard-gate evaluation), and (c) a ~3s debounce after captured answers settle.

**Q6 — What is the logging shape?**
**Answer (confirmed default):**
- Gateway lifecycle at `log.info`; degrades at `log.warn`.
- Stable greppable prefixes: `[VulnReduction]` (orchestration) and `[OSV]` (scan outcome).
- EMIT the existing `osv.logLines` to the logger (not only into the HTTP response).
- Log: source-wired/not, scan attempted, outcome + reason, counts (scanned coordinates, newly-introduced CVEs).
- Add a per-compute correlation id — REUSE the existing `requestId`.
- The bridge adapter logs `[OSV bridge]` request/outcome.
- The discovery endpoint keeps its existing `[VulnEnrich]` / `[OsvDevVulnerabilitySource]` lines.

**Q7 — Default on/off and failure behaviour?**
**Answer (confirmed default):**
- Bridge default ON, behind env kill-switch `OSV_REDUCTION_BRIDGE_ENABLED` (default `true`).
- On ANY bridge error, degrade SOFT to the existing reason codes (`unavailable`, or the discovery-reported `timeout` / `proxy` / `tls` / `dns` / `http_*` when present), NEVER blocking the conversation, ALWAYS logged.
- Gateway→discovery fetch timeout ~20s (above discovery's 15s OSV timeout).

### Q3 Map Finding (IMPORTANT — record for spec-writer)

An existing map already lives at `gateway/src/services/targetManifest/manifestCodeMapping.ts`, but it is the FORWARD direction: it recognises a coordinate via a predicate `test()` and emits a `decisionCode + framework` label (e.g. `startsWith('org.springframework.boot:spring-boot')` → `service.framework` / "Spring Boot"). It is NOT directly invertible to a single canonical coordinate for an OSV lookup.

Therefore Spec C must author a small explicit `(decisionCode, framework) → (coordinate, ecosystem)` map, kept CONSISTENT with `manifestCodeMapping.ts` (same framework labels), and ideally guarded by a drift test mirroring that module's R10 guardrail test (`gateway/src/services/targetManifest/__tests__/manifestCodeMapping.guardrail.test.ts`, which exercises `ALL_COORDINATE_RULE_ANSWERS` / `COORDINATE_ANSWERABLE_CODES`, both exported from `manifestCodeMapping.ts` at lines ~503/516).

Frameworks worth mapping INITIALLY (the ones with real package coordinates):
- `service.framework` — Spring Boot / Quarkus / Micronaut / NestJS
- `db.driver` — pgjdbc / mysql-connector-j / etc.
- `ui.framework` — React / Vue / Angular / Svelte
- other versioned codes with unambiguous coordinates per that module.

SKIP codes with no useful OSV coordinate (e.g. `testing.unit`, `build.tool`, etc.).

### Existing Code to Reference

**Similar Features Identified:**
- Bridge proxy model: `gateway/src/routes/vulnerabilities.ts` (~320-360) — existing thin gateway→discovery proxy to `vulnerabilities/scan` (`fetch(discoveryServiceBaseUrl + /discovery/...)`); the `DiscoveryOsvBridgeSource` adapter mirrors this.
- OSV source resolver seam: `gateway/src/routes/vulnerabilityReduction.ts` — `setTargetOsvSourceResolver` / `resolveTargetOsvSource`.
- Pure scan + reason codes: `gateway/src/services/vulnerabilityReduction/osvTargetScan.ts`.
- Real OSV client: `discovery-service/src/services/vulnerabilityEnrichment/osvDevVulnerabilitySource.ts`.
- Forward coordinate map + its guardrail test (consistency target for the new inverse map): `gateway/src/services/targetManifest/manifestCodeMapping.ts` + `__tests__/manifestCodeMapping.guardrail.test.ts`.
- Prior contracts: `agent-os/specs/2026-06-24-vulnerability-reduction-and-steering`, `agent-os/specs/2026-06-24-osv-automated-vulnerability-enrichment`.

### Follow-up Questions
None required — all seven first-round questions were answered with confirmed defaults.

## Visual Assets

### Files Provided:
No visual assets provided. The `planning/visuals/` folder was checked via directory listing and is EMPTY (no png/jpg/jpeg/gif/svg/pdf files). None expected for this spec — it is grounded entirely on code.

### Visual Insights:
N/A — no visuals.

## Key Code Seams Traced

**Frontend**
- `frontend/src/components/targetState/architectConversation/useVulnerabilityReduction.ts` — recompute driven by `recomputeToken` (host-bumped) + internal `nonce`; target inputs built ONLY from `targetResolvedDependencies` (manifest). Fetches current vulns via `listVulnerabilities` (page size 500). This is where target-input assembly must additionally fold in captured versioned answers and where per-answer recompute triggers route through.
- `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx` — `targetResolvedDeps` set only from manifest upload (`captureTargetDepsFromUpload` ~383-402); `handleCaptureAnswer` (~616-658) does NOT recompute today; hook wired ~367-377 with NO `recomputeToken` passed. Captured-versioned-answer sourcing + the per-answer recompute wiring (and ~3s debounce for OSV) land here.

**Gateway**
- `gateway/src/routes/vulnerabilityReduction.ts:90` — `targetOsvSourceResolver = () => null`; `setTargetOsvSourceResolver` is only ever called by tests (confirmed via grep, no production caller). `runReductionCompute` (~297) calls `resolveTargetOsvSource()` for both compute and use-version routes. The new `skipOsv: true` request flag is added here to suppress the scan on per-answer recompute. Existing log lines are `[VulnReduction] …`; `osv.logLines` is currently returned in the HTTP response, not logged.
- `gateway/src/services/vulnerabilityReduction/osvTargetScan.ts` — pure; consumes injected `TargetVulnerabilitySource` with `query` / optional `queryBatch(queries)` over raw `{ coordinate, version, ecosystem }`. Reason codes: `no_source` / `unavailable` / per-query reasons. Builds `logLines` (counts only) — these must now be EMITTED to the logger under `[OSV]`.
- `TargetVulnerabilitySource` interface — the seam the new `DiscoveryOsvBridgeSource` adapter implements (`query` / optional `queryBatch`).
- New `DiscoveryOsvBridgeSource` adapter — POSTs raw `{ coordinate, version, ecosystem }` batches to the new discovery `osv-query-batch` endpoint; logs `[OSV bridge]`; ~20s fetch timeout; honours `OSV_REDUCTION_BRIDGE_ENABLED`; soft-degrades to existing reason codes on any error.
- `gateway/src/server.ts` — bootstrap wiring of `setTargetOsvSourceResolver(() => new DiscoveryOsvBridgeSource(getConfig().discoveryServiceBaseUrl))`, near where `vulnerabilityReductionRouter` is mounted.

**Discovery**
- New `POST /discovery/vulnerabilities/osv-query-batch` route — exposes `OsvDevVulnerabilitySource.queryBatch` over the raw coordinate+version+ecosystem contract (distinct from the architecture-scoped `vulnerabilities/scan`); keeps `[VulnEnrich]` / `[OsvDevVulnerabilitySource]` logging.
- `discovery-service/src/services/vulnerabilityEnrichment/osvDevVulnerabilitySource.ts` — `query` / `queryBatch` over raw coordinate+version; `classifyOsvFailure` → `timeout`/`proxy`/`tls`/`dns`/`http_*`/`error`; constructor injects axios client + egress config.
- `discovery-service/src/config.ts:200-245` — existing OSV env (`OSV_API_BASE_URL`, `OSV_REQUEST_TIMEOUT_MS`, `HTTPS_PROXY`/`NO_PROXY`, `OSV_CA_CERT_FILE`; no API key; OSV timeout ~15s). New `OSV_REDUCTION_BRIDGE_ENABLED` (default `true`) is the gateway-side kill-switch.

## Requirements Summary

### Functional Requirements
- Source the estimate's TARGET versions from BOTH the uploaded manifest AND the conversation's captured versioned decisions, via an explicit `(decisionCode, framework) → (coordinate, ecosystem)` allow-list; manifest concrete version wins on overlap; unmapped codes silently skipped (count-only log).
- Recompute the cheap in-memory delta after EACH captured answer (per-answer compute call carries `skipOsv: true`).
- Keep the expensive OSV "newly introduced" scan THROTTLED: manifest upload, conversation close, and a ~3s post-answer debounce.
- Build the gateway→discovery OSV bridge so the reduction path's `TargetVulnerabilitySource` is backed by the real discovery OSV source, allowing the "Newly introduced" bucket to populate instead of always `no_source`.
- Add explicit, greppable gateway logging at every decision point (`[VulnReduction]`, `[OSV]`, `[OSV bridge]`), emitting the existing `osv.logLines`, with source-wired/not, scan attempted, outcome + reason, and counts, correlated by the existing `requestId`.

### Reusability Opportunities
- `gateway/src/routes/vulnerabilities.ts` proxy as the template for `DiscoveryOsvBridgeSource`.
- `setTargetOsvSourceResolver` / `resolveTargetOsvSource` already-present DI seam (only tests currently use it).
- `manifestCodeMapping.ts` framework labels + its guardrail test pattern as the consistency/drift-guard target for the new inverse coordinate map.

### Scope Boundaries
**In Scope:**
- Gateway + frontend + a discovery-service touchpoint (the new raw-query bridge endpoint + adapter + bootstrap wiring).
- The inverse `(decisionCode, framework) → (coordinate, ecosystem)` map and its drift test.
- The `skipOsv` request flag, throttled OSV triggers, per-answer delta recompute.
- Explicit greppable logging and the `OSV_REDUCTION_BRIDGE_ENABLED` kill-switch.

**Out of Scope:**
- Any AMS change.
- Spec A (right-panel UX) and Spec B (version-unknown → pending questions). This spec is COMPATIBLE with but NOT dependent on Spec B (Spec B makes confirmed versions flow through the normal capture path that Problem 1 consumes).
- Coordinate mapping for codes without unambiguous OSV coordinates (e.g. `testing.unit`, `build.tool`).
- Guessing/inferring coordinates for unmapped codes.

### Technical Considerations
- Preserve the "estimate, not a guarantee" labelling.
- Preserve the single-shared-delta / no-per-surface-re-derivation discipline (one shared delta, no per-surface re-derivation).
- Soft-degrade on bridge failure to existing reason codes (`unavailable` / `timeout` / `proxy` / `tls` / `dns` / `http_*`); never block the conversation; always log.
- Gateway→discovery fetch timeout ~20s, above discovery's ~15s OSV timeout.
- Bridge default ON via `OSV_REDUCTION_BRIDGE_ENABLED` (default `true`).
- New discovery endpoint must NOT reuse the architecture-scoped `vulnerabilities/scan` contract — it needs the raw `{ coordinate, version, ecosystem }` queryBatch shape.
</content>
</invoke>
