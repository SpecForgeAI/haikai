# Spec — Vulnerability reduction driven by target-state Decisions (replacement-aware)

## The problem (root-caused)
The "Estimated Vulnerability Reduction" widget in the Target State → Architect Conversation never reduces the current-state CVEs, even after the architect chooses a very modern target stack. With ~83 current CVEs, the estimate stays at 0 eliminated / 83 remaining.

ROOT CAUSE (confirmed in code):
- The shared delta service (`gateway/src/services/vulnerabilityReduction/vulnerabilityDeltaService.ts`) classifies a CVE as `eliminated` only when EVERY affected coordinate is "addressed": either (a) a target version satisfies the fix, OR (b) the coordinate's fate is `removed` (decommissioned / replaced away). It supports a `TargetCoordinateFate` of `{kind:'removed'}` and `{kind:'mapped', targetCoordinate, targetVersion}`.
- BUT the gateway route `runReductionCompute` (`gateway/src/routes/vulnerabilityReduction.ts`) consumes `targetFateByCoordinate` VERBATIM from the request body, and NO caller anywhere ever produces a `removed`/replace fate. The frontend hook `useVulnerabilityReduction` only builds `{kind:'mapped'}` fates from manifest-resolved deps + conversation-captured versioned answers (the inverse coordinate map `capturedDecisionOsvCoordinates.ts`). So a current CVE is only ever "eliminated" when the architect EXPLICITLY answers/uploads a coordinate that matches a current CVE's coordinate at a fixed version.
- For an Oracle/legacy → modern migration, the 83 CVEs live in the OLD stack's coordinates. The conversation's high-level Decisions are NEW coordinates. They never match → 0 eliminated. The delta-service doc claims "the route derives this from architecture_element_mappings" but that derivation is UNIMPLEMENTED.

The per-answer recompute wiring itself already works (verified): `triggerReductionRecompute` fires on every captured-decision path; the hook recomputes. The gap is purely the ELIMINATION MODEL, not reactivity.

## What the user wants (the goal)
A TRUE reflection of reality: the vulnerability estimate must reduce based on the target-state DECISIONS — whether those Decisions were set by an UPLOADED FILE (manifest / decisions-file import) OR by CONVERSATION answers. Both write the same captured "Decisions". Choosing a modern target stack that REPLACES the old vulnerable components should eliminate the CVEs in those old components. It must NOT be "conversation only" — it must unify ALL Decision sources. The user accepts this is a thorough spec and wants the model right (not a hack / not over-counting).

## Design direction (to be refined during shaping)
The core problem to solve: link each CURRENT vulnerable coordinate to the target-state Decision (and/or architecture_element_mapping) that SUPERSEDES it, then emit the right `TargetCoordinateFate`:
- Replacement/decommission of the old component owning a vulnerable coordinate → `{kind:'removed'}` → its CVEs eliminated (even no-known-fix CVEs).
- A surviving coordinate carried forward at a fixed target version → `{kind:'mapped', targetVersion}` → eliminated when the version clears the fix (existing path).
- Never assume removal without an explicit Decision/mapping basis (the delta service explicitly forbids silent removal — avoid over-counting / false reduction).

Candidate linkage models (to evaluate in shaping):
- (a) Decision-family → governed-coordinate mapping: each versioned Decision code "governs" a family of current coordinates it replaces (e.g. a `db.driver` target Decision supersedes the current DB-driver coordinate(s); `service.framework` supersedes the current app-framework coordinate(s)). When that Decision is captured, the old family's CVEs become `removed` (replaced), unless carried forward at a vulnerable version.
- (b) architecture_element_mappings linkage: link CVE coordinate → owning architecture element → element mapping (decommissioned / replaced_by / renamed / split / merged). More precise but needs a coordinate→element association that may not exist yet (the gateway has `ArchitectureElementMappingDto` + a decommission endpoint + `decommissioned-in-target-annotations`, but no CVE-coordinate→element join).
- Likely the right answer combines both: explicit mappings where they exist, plus a Decision-family fallback for coordinates the Decisions clearly supersede.

Server vs client: the fate-map should be derived where the data lives (the gateway route already does the AMS-specific fetch + coordinate↔element resolution per the delta-service doc intent), so the conversation/compare-view surfaces don't each re-derive it (single-source discipline). The route should build `targetFateByCoordinate` (mapped + removed) from: current vulnerabilities' coordinates + the captured target Decisions (manifest + conversation, unified) + architecture_element_mappings / decommission annotations.

## Scope notes
- Gateway + frontend + AMS reads (architecture_element_mappings, decommission annotations, captured decisions). Prefer no AMS schema change if avoidable.
- Unify BOTH Decision sources (uploaded files AND conversation answers) — they are already captured decisions; the fate derivation must read the captured-decision store, not just the manifest hand-off.
- Preserve the existing version-bump path, the "estimate not a guarantee" labelling, the single-shared-delta discipline (every surface reads ONE delta), and the strict no-over-counting rule.
- Must remain NON-BLOCKING / fail-soft (a missing mapping degrades to "still vulnerable", never crashes the conversation).
- SEPARATE from but related to: the OSV "newly introduced" http_400 (a runtime/deploy issue, not this spec) and the #3 API like-for-like auto-answer (a sibling "current-state-derived" feature needing an AMS derived-values read — NOT in this spec's scope).

## Grounding files
- `gateway/src/services/vulnerabilityReduction/vulnerabilityDeltaService.ts` (TargetCoordinateFate, classifyCoordinate, computeVulnerabilityDelta)
- `gateway/src/routes/vulnerabilityReduction.ts` (runReductionCompute, parseTargetFateMap — where server-side fate derivation must be added)
- `gateway/src/services/vulnerabilityReduction/capturedDecisionOsvCoordinates.ts` + frontend mirror (the Decision-code → coordinate inverse map to extend toward "governed/replaced coordinates")
- `frontend/src/components/targetState/architectConversation/useVulnerabilityReduction.ts` + `ArchitectConversationTab.tsx` (the consumer; extraFateByCoordinate param already exists but unused)
- `gateway/src/services/architectureModelClient.ts` (ArchitectureElementMappingDto, mappings/decommission reads)
- the captured-decisions store reads (target-state captured decisions)
