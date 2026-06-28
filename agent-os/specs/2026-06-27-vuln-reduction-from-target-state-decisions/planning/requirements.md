# Spec Requirements: Vulnerability reduction driven by target-state Decisions (replacement-aware)

> STATUS: shaping COMPLETE — all clarifying questions answered and confirmed.

## Initial Description
See `planning/raw-idea.md`. In short: the "Estimated Vulnerability Reduction" widget never reduces (0 eliminated / 83 remaining) because no caller ever produces a `removed`/replace fate. A CVE is only eliminated today when an explicitly-answered/uploaded coordinate matches a current CVE coordinate at a fixed version. The user wants reduction driven by ALL captured target Decisions (uploaded files AND conversation answers, unified), crediting REPLACEMENT/decommission of the old vulnerable stack, without over-counting.

## Code Grounding (read before questions)

- `gateway/src/services/vulnerabilityReduction/vulnerabilityDeltaService.ts`
  - `TargetCoordinateFate` = `{kind:'mapped', targetCoordinate, targetVersion}` | `{kind:'removed', via?}` (lines 106-120).
  - `classifyCoordinate` (270-344): `removed` => ADDRESSED even for no-known-fix CVEs; NO fate entry => conservatively `still vulnerable` ("never assume removal", 294-306).
  - `computeVulnerabilityDelta` (445-478): returns `null` when the fate map is null/empty (hide on no-snapshot). The service is PURE and consumes the fate map verbatim.
- `gateway/src/routes/vulnerabilityReduction.ts`
  - `runReductionCompute` (357-463) consumes `targetFateByCoordinate` VERBATIM from the request body; `parseTargetFateMap` (232-253) just parses what the caller sent. This is where server-side fate derivation would be added. The doc comment in the delta service claims the route "derives this from `architecture_element_mappings`" — that derivation is UNIMPLEMENTED.
- `frontend/.../useVulnerabilityReduction.ts`
  - Builds the fate map CLIENT-side from manifest-resolved deps only (`buildTargetInputsFromResolvedDeps`, 137-172) — every fate is `{kind:'mapped'}`; no `removed` is ever produced. `extraFateByCoordinate` is a supported-but-unused param intended for mapping-aware fates.
- `gateway/src/services/targetManifest/manifestCodeMapping.ts`
  - FORWARD map: `matchManifestCoordinate(dep)` recognises a raw coordinate (`org.postgresql:postgresql`, `react`, `io.quarkus:*`, ...) and emits `{ decisionCode, framework }`. This is the deterministic bridge that can classify a CURRENT vulnerable coordinate into the decision-code FAMILY it belongs to (e.g. `org.springframework.boot:*` -> `service.framework`/`Spring Boot`).
- `gateway/src/services/vulnerabilityReduction/capturedDecisionOsvCoordinates.ts`
  - INVERSE map: `coordinateForCapturedVersion(decisionCode, framework)` -> the single canonical TARGET coordinate + ecosystem. Curated allow-list; unmapped pairs are silently skipped.
- `gateway/src/services/targetStateCapturedDecisionsClient.ts`
  - `fetchLatestCapturedDecisions(projectId, targetArchitectureId)` -> `TargetStateCapturedDecision[]` (latest non-superseded). The store UNIFIES both sources: manifest auto-answer AND conversation answers both write `target_state_captured_decisions` via `targetStateCapturedDecisionsWriter`. `answerValue` is a JSON envelope `{ value, sourceQuote, sourceFile }`; for versioned codes `value` = `{ framework, version }`.
- `gateway/src/services/targetManifestArtifactsClient.ts`
  - `fetchLatestTargetManifestArtifacts(...)` -> the confirmed target manifest's `resolved_dependencies` (JSONB array of resolved coordinate records, lines 73 / 106 / 186). This is the TARGET MANIFEST RESOLVED COORDINATE SET to diff against (only populated when a target manifest has actually been uploaded/resolved).
- `gateway/src/services/architectureModelClient.ts`
  - `ArchitectureElementMappingDto` (2404-2420): element->element only — `sourceElementType/sourceElementId` -> `targetElementType/targetElementId` + `mappingType` (e.g. decommissioned/replaced_by) + `status`. `listArchitectureMappings(projectId, filters)` reads them. NO dependency-coordinate field.

### THE CRUX (reported as found — confirmed, drives Q1)
There is **NO association between a vulnerability's `affected_coordinate` (a dependency GAV/npm coordinate) and an architecture ELEMENT (service/component)**.
- `VulnerabilityDto` (`frontend/src/api/vulnerabilitiesApi.ts:128-164`) links a coordinate only to `matched_library_id` (a current-state dependency-inventory LIBRARY) and a verbatim `location` blob (the report's Location column, e.g. the GitLab path) — **not** to a meta-model element. No `service_id` / `element_id` / owning-element field exists.
- `architecture_element_mappings` are between meta-model elements (services/components), with `mappingType` carrying decommission/replace — but there is no join from a CVE coordinate (or its library) to those elements.
- Therefore model (b) "CVE coordinate -> element -> element-mapping fate" **cannot be implemented without inventing a new coordinate->element bridge**. Model (a) "Decision-family -> governed/replaced coordinate" IS implementable today from the two existing maps (forward `manifestCodeMapping` + inverse `capturedDecisionOsvCoordinates`) plus the captured-decision store. This is why the recommended primary is the Decision-family model. The coordinate->element/library->element bridge (model b) is OUT OF SCOPE this spec.

## Requirements Discussion

### First Round Questions

**Q1 — Primary linkage model.**
*Question:* Given there is NO coordinate->element association in the data, use the Decision-family model as the sole primary linkage (classify each current vulnerable coordinate into its decision-code family via the forward `manifestCodeMapping`; if a captured target Decision exists for that family code, the old coordinate is a candidate for `removed`). The element-mapping (model b) path stays UNIMPLEMENTED because no coordinate->element join exists.
**Answer:** ACCEPTED as recommended. Decision-family model is the primary linkage. Element-mapping (model b) and inventing a coordinate->element bridge are explicitly OUT OF SCOPE.

**Q2 — Matching key: how a current coordinate is tied to "the Decision that supersedes it".**
*Question:* Run each current vulnerable `affected_coordinate` (+ `ecosystem`) through `matchManifestCoordinate` to get `{ decisionCode, framework_old }`; look up the captured Decision for that `decisionCode` to get `{ framework_new, version_new }`. If `framework_new != framework_old` => REPLACED => `{kind:'removed', via:'replaced-by-decision:<code>'}`. If `framework_new == framework_old` => carried forward => `{kind:'mapped', targetVersion: version_new}`. No forward match OR no captured Decision for the family => NO fate (conservatively still-vulnerable).
**Answer:** ACCEPTED as recommended. Family code is the matching key; framework-label difference is the "genuinely replaced" signal.

**Q3 — Coverage limitation / the 83-CVE reality (MODIFIED from default).**
*Question:* The forward map only recognises the curated decision-answerable coordinate set, so the estimate reduces for recognised families but may not zero-out. Accept partial/conservative credit for v1, or add a coarser fallback (option i: ecosystem/groupId-prefix family heuristic; option ii: target-manifest coordinate diff)?
**Answer:** BOTH partial Decision-family credit AND the target-manifest coordinate diff (option ii). Specifically:
  - v1 credits removal via the Decision-family model for coordinates the curated forward map recognises (PARTIAL), AND
  - ALSO include the TARGET-MANIFEST COORDINATE DIFF: when a CURRENT vulnerable coordinate (from the current-state dependency inventory / the vulnerability's matched library) is NOT carried forward into the TARGET manifest's resolved coordinate set, treat it as `removed` (replaced/dropped by the migration) => its CVEs eliminated.
  - The coarse groupId-prefix family heuristic (option i) is EXCLUDED.

**Q4 — Opt-out / unanswered Decisions.**
*Question:* A Decision answered "Not applicable"/opt-out, or a family with NO captured Decision, yields NO removal. Only a positively-captured Decision with a concrete chosen framework can drive a `removed`/`mapped` fate.
**Answer:** ACCEPTED as recommended. Opt-out/unanswered => no removal (conservative).

**Q5 — When does `removed` apply vs `mapped`?**
*Question:* `removed` ONLY when the current coordinate is genuinely NOT carried forward (different chosen framework for that family). Same framework at a new version => existing `mapped` version-bump path (so a vulnerable carried-forward version is NOT falsely eliminated).
**Answer:** ACCEPTED as recommended. `removed` only when genuinely replaced; carried-forward => `mapped`.

**Q6 — Where the derivation lives + single-source.**
*Question:* The GATEWAY route derives `targetFateByCoordinate` server-side (fetch current vulnerabilities + `fetchLatestCapturedDecisions` + the two maps + the target-manifest resolved set, build mapped/removed fate map, then run `runReductionCompute`). The FRONTEND hook STOPS sending its client-built fate map (server becomes single source); it supplies ids/triggers only.
**Answer:** ACCEPTED as recommended. Full server-side derivation; frontend `useVulnerabilityReduction` stops sending the client-built fate map — single source on the server.

**Q7 — Over-counting guardrails (the explicit concern).**
*Question:* Evidence bar for a Decision-family `removed` credit: (a) the current coordinate resolves to a known decision-code family via the forward map, AND (b) a captured Decision for that family exists with a concrete chosen framework, AND (c) that framework differs from the old one. No prefix guesses, no "decommission assumed from absence". Each removal carries `via` provenance + count-only log.
**Answer:** ACCEPTED as recommended (three-part evidence bar + provenance + count-only logging) for the DECISION-FAMILY path. See the additional manifest-diff guardrails below, which add a fourth, distinct guarded path.

**Q8 — UI provenance.**
*Question:* Small UI addition: surface WHY an eliminated CVE was eliminated ("replaced by <target Decision>") from the `removed` fate's `via`/provenance, in the existing eliminated-list surfaces (no new panels).
**Answer:** ACCEPTED as recommended. Minimal provenance label in the existing eliminated list; no new panels. The label must distinguish the two removal provenances (Decision-family vs dropped-from-manifest — see below).

**Q9 — Out-of-scope confirmations.**
*Question:* Explicitly out of scope: the OSV "newly introduced" http_400 (deploy/runtime); the #3 API like-for-like auto-answer; any AMS schema change; inventing a coordinate->element/library->element bridge; the coarse prefix-family fallback.
**Answer:** ACCEPTED as recommended. All of the above OUT of scope. (The coarse prefix-family heuristic remains out of scope; the target-manifest coordinate diff is the chosen non-prefix fallback per Q3.)

### Manifest-diff design constraints (Q3 option ii — user's explicit anti-over-counting rules)

These constraints govern the SECOND removal path (the target-manifest coordinate diff) and exist to prevent over-counting, which is the user's explicit concern:

1. **Manifest-presence gate (no silent removal from absence).** The manifest-diff `removed` credit applies ONLY when a TARGET MANIFEST has actually been uploaded/resolved (a concrete target coordinate set exists to diff against). With NO target manifest there is nothing to reliably diff against => do NOT mark current coordinates removed from absence alone (that is the forbidden "silent removal"). So:
   - Target manifest PRESENT => diff credits `removed` for current vulnerable coordinates not carried forward.
   - Target manifest ABSENT => fall back to the Decision-family model ONLY (partial); NEVER blanket-remove.
2. **"Carried forward" definition.** A current coordinate is "carried forward" when the coordinate itself (or its mapped/renamed target coordinate) is present in the target manifest's resolved coordinate set. A carried-forward coordinate stays `mapped` (version-bump path) and is NEVER auto-removed (so a carried-forward vulnerable version is not falsely eliminated).
3. **Distinct provenance.** Manifest-diff removals carry `via:'dropped-from-target-manifest'` — distinct from the Decision-family `via:'replaced-by-decision:<code>'`. Count-only logging for both; both surfaced as a minimal provenance label in the eliminated list.
4. **Two reads required.** The gateway must read BOTH:
   - the CURRENT-STATE dependency coordinate set (to enumerate the current vulnerable coordinates), and
   - the TARGET manifest's RESOLVED coordinate set (the confirmed-manifest resolved dependencies) to diff against.
   See "Technical Considerations / data source confirmation" for which clients supply each.

### Existing Code to Reference

**Similar Features Identified (intended reuse surface — already exist):**
- Forward family classifier: `gateway/src/services/targetManifest/manifestCodeMapping.ts` (`matchManifestCoordinate`) — classify a current vulnerable coordinate into its decision-code family.
- Inverse coordinate map: `gateway/src/services/vulnerabilityReduction/capturedDecisionOsvCoordinates.ts` (`coordinateForCapturedVersion`) — Decision-code -> canonical target coordinate.
- Unified captured-decisions read: `gateway/src/services/targetStateCapturedDecisionsClient.ts` (`fetchLatestCapturedDecisions`) — unifies manifest auto-answer AND conversation answers.
- Pure compute: `gateway/src/services/vulnerabilityReduction/vulnerabilityDeltaService.ts` (`classifyCoordinate`, `computeVulnerabilityDelta`, `TargetCoordinateFate`).
- Route home for server-side fate derivation: `gateway/src/routes/vulnerabilityReduction.ts` (`runReductionCompute`, `parseTargetFateMap`).
- Target manifest resolved coordinates: `gateway/src/services/targetManifestArtifactsClient.ts` (`fetchLatestTargetManifestArtifacts` -> `resolved_dependencies`).
- Frontend consumer: `frontend/src/components/targetState/architectConversation/useVulnerabilityReduction.ts` + `ArchitectConversationTab.tsx`.

No additional helper that already groups current coordinates by decision family, and no current-state library->service association, was identified beyond the above (the absence of that association is THE CRUX).

### Follow-up Questions
None required — all defaults accepted and Q3 fully specified by the user with explicit design constraints.

## Visual Assets

No visual assets provided. The mandatory check of `planning/visuals/` returned no image/PDF files (the folder is not present). This is a compute-correctness change; the only UI work is a minimal provenance label in an existing surface (Q8), for which no mockup is required.

## Requirements Summary

### Functional Requirements
- Server-side derivation of `targetFateByCoordinate` in the gateway route so the "Estimated Vulnerability Reduction" widget reduces based on captured target-state Decisions (manifest-uploaded AND conversation-answered, unified) plus the target-manifest coordinate diff.
- TWO removal paths, both guarded against over-counting:
  1. Decision-family path (Q1/Q2/Q5/Q7): current coordinate -> family code (forward map) -> captured Decision with a different chosen framework => `{kind:'removed', via:'replaced-by-decision:<code>'}`. Same framework, new version => `{kind:'mapped', targetVersion}` (existing version-bump path).
  2. Manifest-diff path (Q3 option ii): when a target manifest is present, a current vulnerable coordinate NOT carried forward into the target's resolved coordinate set => `{kind:'removed', via:'dropped-from-target-manifest'}`.
- Conservative defaults: no forward match + no captured Decision + (manifest absent or coordinate carried forward) => NO fate => still vulnerable. Opt-out/unanswered Decisions => no removal.
- Frontend `useVulnerabilityReduction` stops building/sending the client fate map; supplies ids/triggers only — single source on the server.
- Minimal eliminated-list provenance label distinguishing the two removal provenances; no new panels.
- Fail-soft / non-blocking: a missing map/manifest/decision degrades to "still vulnerable", never crashes the conversation. Preserve the single-shared-delta discipline and the "estimate, not a guarantee" labelling.

### Reusability Opportunities
- Extend the existing forward (`manifestCodeMapping`) + inverse (`capturedDecisionOsvCoordinates`) maps rather than inventing new classification.
- Reuse `fetchLatestCapturedDecisions` (already unifies both Decision sources) and `fetchLatestTargetManifestArtifacts` (resolved coordinate set) — no new persistence.
- Reuse the pure `vulnerabilityDeltaService` verbatim; only the route's fate-derivation is new.

### Scope Boundaries
**In Scope:**
- Gateway server-side fate-map derivation (Decision-family + manifest-diff) in `runReductionCompute`/`parseTargetFateMap`.
- Reads: current vulnerabilities/current-state dependency coordinates, unified captured decisions, target-manifest resolved coordinates, the two coordinate maps.
- Frontend: stop sending the client-built fate map; minimal eliminated-list provenance label.

**Out of Scope:**
- Inventing a coordinate->element or library->element bridge; the architecture_element_mappings (model b) linkage.
- The coarse groupId/ecosystem prefix-family heuristic (option i).
- The OSV "newly introduced" http_400 (deploy/runtime issue).
- The #3 API like-for-like auto-answer.
- Any AMS schema change (prefer existing reads only).

### Technical Considerations
- **Crux:** no CVE-coordinate -> architecture-element association exists, so the Decision-family model is the primary linkage and the element-mapping bridge is out of scope.
- **Key code seams:**
  - `gateway/src/routes/vulnerabilityReduction.ts` — `runReductionCompute` + `parseTargetFateMap`: the server-side fate-derivation home (currently consumes the body fate map verbatim).
  - `gateway/src/services/vulnerabilityReduction/vulnerabilityDeltaService.ts` — `TargetCoordinateFate` `mapped`/`removed`; pure classify/compute consumed verbatim.
  - `gateway/src/services/targetManifest/manifestCodeMapping.ts` — forward family map; `gateway/src/services/vulnerabilityReduction/capturedDecisionOsvCoordinates.ts` — inverse coordinate map.
  - `gateway/src/services/targetStateCapturedDecisionsClient.ts` — `fetchLatestCapturedDecisions` (unified captured-decisions read).
  - `gateway/src/services/targetManifestArtifactsClient.ts` — `fetchLatestTargetManifestArtifacts` (confirmed-manifest resolved-coordinate read).
  - `frontend/.../useVulnerabilityReduction.ts` — stops sending the client-built fate map (single source moves to server).
- **Data source confirmation (which gateway read/client supplies each — per the user's request):**
  - CURRENT-STATE vulnerable coordinate set: the current vulnerabilities' `affected_coordinate` (+ `ecosystem`), each linked to a `matched_library_id` (current-state dependency-inventory library). These flow into the route via the `projectCurrentVulnerability` projection in `gateway/src/routes/vulnerabilityReduction.ts` (~line 158); the underlying source is the vulnerabilities API (`gateway/src/routes/vulnerabilities.ts`) / the discovery OSV bridge (`gateway/src/services/vulnerabilityReduction/discoveryOsvBridgeSource.ts`). The "current-state dependency inventory" for the manifest-diff is this same matched-library/coordinate set. (Spec-writer to finalise whether the route re-reads vulnerabilities server-side or continues to receive them in the body once the frontend stops sending the fate map.)
  - TARGET manifest RESOLVED coordinate set: `fetchLatestTargetManifestArtifacts(...)` -> `resolved_dependencies` (JSONB array) in `gateway/src/services/targetManifestArtifactsClient.ts`. Presence of this artifact is the gate for the manifest-diff path (manifest present => diff; absent => Decision-family only).
- **Provenance values:** `via:'replaced-by-decision:<code>'` (Decision-family) and `via:'dropped-from-target-manifest'` (manifest-diff); both count-only logged and surfaced as a minimal label.
</content>
</invoke>
