# Spec C — Live vulnerability-reduction recompute + OSV gateway→discovery bridge + explicit logging

The "Estimated vulnerability reduction" widget in the Target State → Architect Conversation has three related problems.

## Problem 1: the estimate ignores conversationally-captured versions
The reduction's TARGET versions are sourced ONLY from an uploaded manifest (`targetResolvedDependencies`, populated from the manifest upload response in `ArchitectConversationTab.tsx`). Versioned answers given IN the conversation (e.g. `service.framework = Spring Boot 4.0.0`) do NOT feed the estimate at all. The estimate should also source target versions from the conversation's captured versioned decisions.

## Problem 2: the estimate doesn't update after each captured decision
Today the reduction recomputes only on manifest upload, the one-click "use this version" nudge, and inline manifest edits. It does NOT recompute after a normal captured answer in the conversation. Desired: recompute the (cheap, in-memory) internal delta after EACH captured answer so the widget tracks the conversation live. The (potentially expensive / external) OSV "newly introduced" scan should stay THROTTLED — run on manifest upload and at close, or debounced — not on every answer.

## Problem 3: the gateway→discovery OSV bridge does not exist, so "Newly introduced" is always absent
There are two separate OSV code paths:
- Gateway vulnerability-reduction path (`gateway/src/services/vulnerabilityReduction/osvTargetScan.ts` + `gateway/src/routes/vulnerabilityReduction.ts`) — PURE, no network I/O; it calls an injected `TargetVulnerabilitySource`. In production the resolver is hardcoded `() => null` (`vulnerabilityReduction.ts:90`); `setTargetOsvSourceResolver` is only ever called by tests. So this path ALWAYS emits `no_source` regardless of connectivity — which is exactly what the UI shows ("Automated enrichment unavailable (no_source)").
- Discovery-service enrichment path (`discovery-service/src/services/vulnerabilityEnrichment/osvDevVulnerabilitySource.ts`) — the ONLY code that actually calls api.osv.dev (POST /v1/querybatch, GET /v1/vulns/{id}); driven by the `.../vulnerabilities/scan` endpoint, NOT the reduction endpoint.

Desired: wire a production bridge so the gateway reduction path's `TargetVulnerabilitySource` is backed by the discovery-service OSV source, so the "Newly introduced" bucket can actually populate. (Implementation options to be decided during shaping: call setTargetOsvSourceResolver with a real adapter that proxies to the discovery-service scan endpoint, vs another approach.)

## Problem 4 (the user's explicit ask): explicit, greppable logging so success/failure is visible on the work machine
Add explicit gateway logging at every decision point of the reduction + OSV path so the user can tell on their work machine whether a scan ran and succeeded or failed: source wired or not, scan attempted, outcome + reason (no_source / timeout / http_* / dns / tls / proxy), and counts (scanned coordinates, newly-introduced CVEs). Surface/relay the discovery-side `[VulnEnrich]` and `[OsvDevVulnerabilitySource]` signals. Today the gateway only logs `[VulnReduction] reduction compute requested` and pushes `osv.logLines` into the HTTP RESPONSE rather than the logs.

## Grounding (to be confirmed during shaping)
- Frontend hook: `frontend/src/components/targetState/architectConversation/useVulnerabilityReduction.ts` (recompute triggers; `recomputeToken`/`nonce`; target inputs built ONLY from manifest-resolved deps).
- Wiring: `ArchitectConversationTab.tsx` (`targetResolvedDeps` set only from manifest upload; recompute called on upload/use-version/manual-edit, NOT on captureAnswer).
- Gateway routes/services: `gateway/src/routes/vulnerabilityReduction.ts` (compute + use-version; `resolveTargetOsvSource`), `gateway/src/services/vulnerabilityReduction/osvTargetScan.ts` (pure scan; reason codes no_source/unavailable/error; `unavailableNote`), and the delta/classification service.
- Discovery OSV client: `discovery-service/src/services/vulnerabilityEnrichment/osvDevVulnerabilitySource.ts` (query/queryBatch/hydrate; `classifyOsvFailure` reasons), route `discovery-service/src/routes/vulnerabilityEnrichment.ts` (`[VulnEnrich]` logs), config `discovery-service/src/config.ts:200-245` (OSV_API_BASE_URL, OSV_REQUEST_TIMEOUT_MS, HTTPS_PROXY/NO_PROXY, OSV_CA_CERT_FILE; no API key; no enable toggle).

## Scope notes
- Gateway + frontend + a discovery-service touchpoint (the bridge). Prefer no AMS change.
- SEPARATE from Spec A (right-panel UX) and Spec B (version-unknown → pending questions). Note dependency: Spec B makes confirmed versions flow through the normal capture path, which Problem 1 here consumes; this spec should not require Spec B but should be compatible with it.
- "Estimate, not a guarantee" labelling and the existing single-shared-delta / no-per-surface-re-derivation discipline must be preserved.
