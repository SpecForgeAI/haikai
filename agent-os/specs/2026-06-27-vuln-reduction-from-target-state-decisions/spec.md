# Specification: Vulnerability reduction driven by target-state Decisions (replacement-aware)

## Goal
Make the "Estimated Vulnerability Reduction" widget actually reduce by deriving the per-coordinate target fate server-side from the unified captured target Decisions plus the target-manifest coordinate set, so replacement/decommission of an old vulnerable stack eliminates its CVEs without over-counting.

## User Stories
- As an architect choosing a modern target stack, I want CVEs living in the replaced legacy components to drop out of the estimate so the widget reflects the real migration outcome.
- As a security reviewer, I want each eliminated CVE to show whether it was eliminated because its component was replaced by a Decision or dropped from the target manifest, so I can trust the count.

## Specific Requirements

**Server-side fate derivation is the single source of truth**
- Add a fate-derivation step in `gateway/src/routes/vulnerabilityReduction.ts` that builds the FULL `targetFateByCoordinate` (both `mapped` and `removed`) BEFORE calling `runReductionCompute`; the route no longer relies on the body fate map.
- Inputs the route assembles: the current vulnerable coordinates, the unified captured Decisions via `fetchLatestCapturedDecisions(projectId, targetArchitectureId)`, and the target manifest `resolved_dependencies` via `fetchLatestTargetManifestArtifacts(projectId, targetArchitectureId)`.
- `runReductionCompute` and the pure `vulnerabilityDeltaService` (`classifyCoordinate` / `computeVulnerabilityDelta` / `TargetCoordinateFate`) are consumed UNCHANGED — only the route's fate assembly is new.
- Keep both compute entry points (the `vulnerability-reduction` POST and the `use-version` recompute) on this one derivation so they share identical fate logic.
- `parseTargetFateMap` stays for back-compat parsing, but the derived server map is authoritative; ignore any client-sent fate map.

**Reconstruct existing `mapped` fates server-side**
- The frontend currently turns manifest-resolved deps + conversational captured versions into `{kind:'mapped'}` fates; the server must now rebuild these so dropping the client fate map causes no regression.
- For each captured versioned Decision, resolve `(decisionCode, framework)` to a target coordinate via `coordinateForCapturedVersion` (`capturedDecisionOsvCoordinates.ts`) and emit `{kind:'mapped', targetCoordinate, targetVersion}` (version from the `{framework, version}` envelope; `version-unknown` rides through).
- For each target manifest `resolved_dependencies` entry, emit `{kind:'mapped', targetCoordinate, targetVersion}` at the resolved version.
- Manifest concrete version WINS over a conversational fate on coordinate overlap (preserve the existing concrete-greater-than-generic merge discipline).

**Decision-family removal path (primary linkage)**
- For each CURRENT vulnerable coordinate, run `matchManifestCoordinate(dep)` (`manifestCodeMapping.ts`) to resolve its `{decisionCode, framework_old}` family.
- Look up the captured Decision for that `decisionCode`; if it carries a concrete chosen `framework_new` that DIFFERS from `framework_old`, emit `{kind:'removed', via:'replaced-by-decision:<code>'}`.
- If the captured framework EQUALS the old framework, it is carried forward at a new version: emit `{kind:'mapped', targetVersion}` (existing version-bump path) — never `removed`.
- No forward match, OR no positively-captured Decision for the family, OR an opt-out/unanswered Decision => NO fate (conservatively still-vulnerable).

**Target-manifest coordinate-diff removal path (additional credit)**
- Applies ONLY when `fetchLatestTargetManifestArtifacts` returns a non-empty `resolved_dependencies` set (a concrete target coordinate set to diff against).
- A current vulnerable coordinate NOT carried forward into the target resolved set => `{kind:'removed', via:'dropped-from-target-manifest'}`.
- "Carried forward" = the current coordinate itself, or its mapped/renamed target coordinate, is present in the target resolved set => stays `mapped` (never auto-removed), so a carried-forward vulnerable version is not falsely eliminated.
- NO groupId-prefix / ecosystem-prefix heuristic.

**No over-counting (critical guardrails)**
- Manifest ABSENT => NO blanket removal from absence (the delta service's forbidden silent removal); fall back to the Decision-family path only.
- Decision-family removal requires the three-part evidence bar: forward-map family match AND a positively-captured Decision with a concrete framework AND that framework differs from the old one.
- Distinct provenance per reason: `replaced-by-decision:<code>` vs `dropped-from-target-manifest`.
- Count-only logging only (never log CVE ids, coordinate values, or evidence bodies).

**Frontend stops sending the client-built fate map**
- `frontend/src/components/targetState/architectConversation/useVulnerabilityReduction.ts` STOPS building/sending `targetFateByCoordinate`; the server is the single source.
- It continues to supply the current-state vulnerability rows (already fetched via `listVulnerabilities`) as the current vulnerable coordinate set, plus the recompute trigger/ids.
- Preserve the existing reactivity: `triggerReductionRecompute`, the cheap `skipOsv` per-answer recompute, and the debounced full-scan trigger remain wired in `ArchitectConversationTab.tsx`.
- The in-flight `conversationalTargetDeps`/`mergeTargetDeps` client wiring is no longer needed to BUILD fates (its logic moves server-side); do not conflict with the already-landed `capturedDecisionOsvCoordinates` mirror and per-answer recompute wiring.

**UI provenance label (minimal)**
- On the eliminated list in `VulnerabilityReductionPanel`, surface a minimal "replaced by <Decision>" / "dropped in target" label sourced from the removed fate's `via`.
- Distinguish the two provenances: `replaced-by-decision:<code>` vs `dropped-from-target-manifest`.
- This requires threading the fate `via` onto the per-coordinate `removed` outcome (an additive, optional field on `CoordinateOutcome`) so the panel can read it; no new panels, no classification change.

**Fail-soft / non-blocking**
- Any failed read (captured decisions, manifest artifacts) or unmatched mapping degrades the affected coordinate to still-vulnerable (or skips the manifest-diff entirely), never throws into the conversation.
- Preserve the single-shared-delta discipline (every surface reads the ONE delta), the `null`-on-no-snapshot hide behaviour, and the "estimate, not a guarantee" label.

## Visual Design
No visual assets provided (`planning/visuals/` is empty). The only UI change is a minimal provenance label on the existing eliminated list; no mockup required.

## Existing Code to Leverage

**`gateway/src/services/targetManifest/manifestCodeMapping.ts` (`matchManifestCoordinate`)**
- Forward map: classifies a raw coordinate (`org.springframework.boot:*`, `org.postgresql:postgresql`, `react`, ...) into `{decisionCode, framework}`.
- Use it to bin each current vulnerable coordinate into its Decision-code family for the Decision-family removal path.

**`gateway/src/services/vulnerabilityReduction/capturedDecisionOsvCoordinates.ts` (`coordinateForCapturedVersion`)**
- Inverse allow-list: `(decisionCode, framework)` -> single canonical target `{coordinate, ecosystem}`.
- Use it to rebuild `mapped` fates and target versions from captured versioned Decisions server-side; unmapped pairs are silently skipped.

**`gateway/src/services/targetStateCapturedDecisionsClient.ts` (`fetchLatestCapturedDecisions`)**
- Reads latest non-superseded `TargetStateCapturedDecision[]`, already unifying manifest auto-answer AND conversation answers; `answerValue` is the `{value, sourceQuote, sourceFile}` envelope (`value` = `{framework, version}` for versioned codes).
- The single read for all captured Decisions; parse the envelope to get framework/version per code.

**`gateway/src/services/targetManifestArtifactsClient.ts` (`fetchLatestTargetManifestArtifacts`)**
- Reads the confirmed target manifest `resolved_dependencies` (JSONB coordinate records); presence gates the manifest-diff path.
- Supplies both the target resolved coordinate set (to diff against) and the `mapped` version-bump fates.

**`gateway/src/services/vulnerabilityReduction/vulnerabilityDeltaService.ts` + `gateway/src/routes/vulnerabilityReduction.ts`**
- Pure `classifyCoordinate`/`computeVulnerabilityDelta` already address a coordinate via `{kind:'removed'}` (incl. no-known-fix CVEs); `runReductionCompute` orchestrates the delta + non-blocking OSV scan.
- Reuse verbatim; add only the route-level fate derivation feeding `targetFateByCoordinate`.

## Out of Scope
- The coordinate->element (or library->element) bridge and the `architecture_element_mappings` (model b) linkage — no such association exists in the data.
- The coarse groupId/ecosystem prefix-family heuristic.
- The OSV "newly introduced" http_400 (a runtime/deploy issue).
- The #3 API like-for-like auto-answer (separate sibling needing an AMS derived-values read).
- Any AMS schema change (existing reads only).
- Changing the delta-service classification semantics, adding new panels, or altering the "estimate, not a guarantee" labelling.
</content>
</invoke>
