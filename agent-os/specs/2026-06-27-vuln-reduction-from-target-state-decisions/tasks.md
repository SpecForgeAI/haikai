# Task Breakdown: Vulnerability reduction driven by target-state Decisions (replacement-aware)

## Overview
Total Tasks: 4 task groups

Server-side fate-map derivation is the core change: the gateway route stops trusting the client-built `targetFateByCoordinate` and instead reconstructs the FULL fate map (both `mapped` version-bumps and the new `removed` replacement/drop fates) from the unified captured Decisions plus the target-manifest resolved coordinate set. The pure delta service is reused unchanged except for an additive optional `via` provenance on the removed outcome. The frontend stops sending the fate map and surfaces a minimal provenance label.

No AMS schema change. Gateway + frontend only.

## Verification ground rules (apply to EVERY group)
- The application runs on a DIFFERENT machine. Do NOT start servers, do NOT curl/probe `localhost`, do NOT hit any live AMS/discovery/OSV endpoint.
- ALL verification is via unit/component tests with INJECTED STUBS for the gateway clients (`fetchLatestCapturedDecisions`, `fetchLatestTargetManifestArtifacts`, the OSV source resolver) and the frontend API module.
- Gateway: run jest IN ISOLATION inside the `gateway/` package; run ONLY the new/touched test files, not the whole gateway suite.
- Frontend: whole-repo `tsc`/`lint` is pre-existingly RED on `main`. Verify IN ISOLATION — run only the touched component/hook test files and type-check only the touched files where practical. Do NOT gate on the pre-existing red baseline.

## Task List

### Gateway Core (pure derivation)

#### Task Group 1: Server-side fate-map derivation module (pure)
**Dependencies:** None

A NEW pure module (e.g. `gateway/src/services/vulnerabilityReduction/targetFateDerivation.ts`) that builds `Map<currentCoordinate, TargetCoordinateFate>` from injected inputs. No I/O — callers pass the already-fetched captured Decisions, the target manifest resolved set, and the current vulnerable coordinates. Heavily unit-tested. This group does NOT touch the route yet.

- [x] 1.0 Complete the pure fate-derivation module
  - [x] 1.1 Write 2-8 focused tests for the derivation module
    - Limit to 2-8 highly focused tests maximum.
    - Cover the load-bearing branches ONLY: (a) Decision-family REPLACED — current coordinate matches a family whose captured Decision carries a DIFFERENT framework => `{kind:'removed', via:'replaced-by-decision:<code>'}`; (b) Decision-family carried-forward — SAME framework, new version => `{kind:'mapped', targetVersion}` (NOT removed); (c) manifest-diff DROP — manifest present + current coordinate not carried forward => `{kind:'removed', via:'dropped-from-target-manifest'}`; (d) over-counting guards — manifest ABSENT => no blanket removal, and opt-out/unanswered/no-captured-Decision => NO fate (still vulnerable).
    - Use injected plain objects for captured Decisions + resolved deps; no network.
    - Skip exhaustive coordinate-mapping enumeration (that lives in the existing maps' own tests).
  - [x] 1.2 Implement the `mapped` reconstruction (no regression on version-bumps)
    - For each captured versioned Decision, resolve `(decisionCode, framework)` to a target coordinate via `coordinateForCapturedVersion` (`capturedDecisionOsvCoordinates.ts`); emit `{kind:'mapped', targetCoordinate, targetVersion}` from the `{framework, version}` envelope; `version-unknown` rides through; unmapped pairs silently skipped.
    - For each target manifest `resolved_dependencies` entry, emit `{kind:'mapped', targetCoordinate, targetVersion}` at the resolved version.
    - Manifest concrete version WINS over a conversational fate on coordinate overlap (preserve concrete-greater-than-generic merge discipline).
  - [x] 1.3 Implement the Decision-family removal path (primary linkage)
    - For each CURRENT vulnerable coordinate, run `matchManifestCoordinate(dep)` (`manifestCodeMapping.ts`) to resolve `{decisionCode, framework_old}`.
    - Look up the captured Decision for that `decisionCode`; if it carries a concrete chosen framework that DIFFERS from `framework_old` => `{kind:'removed', via:'replaced-by-decision:<code>'}`.
    - If captured framework EQUALS old framework => carried forward => `{kind:'mapped', targetVersion}` (NEVER removed).
    - No forward match, OR no positively-captured Decision, OR opt-out/unanswered => NO fate.
  - [x] 1.4 Implement the target-manifest coordinate-diff removal path (additional credit)
    - Applies ONLY when the resolved set is non-empty (presence gate).
    - Current vulnerable coordinate NOT carried forward => `{kind:'removed', via:'dropped-from-target-manifest'}`.
    - "Carried forward" = the current coordinate itself OR its mapped/renamed target coordinate is present in the resolved set => stays `mapped`, never auto-removed.
    - NO groupId-prefix / ecosystem-prefix heuristic.
  - [x] 1.5 Enforce the over-counting guardrails + count-only logging
    - Manifest ABSENT => fall back to the Decision-family path only; NEVER blanket-remove.
    - Decision-family removal requires the three-part evidence bar (family match AND positively-captured concrete framework AND framework differs).
    - Fail-soft: a malformed/missing Decision or resolved entry degrades the affected coordinate to still-vulnerable; the module NEVER throws.
    - Log count-only (never log CVE ids, coordinate values, or evidence bodies).
  - [x] 1.6 Ensure derivation-module tests pass
    - Run ONLY the 2-8 tests written in 1.1, in the gateway package, in isolation.
    - Do NOT run the entire gateway suite. Do NOT start any server.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- Module is pure (no I/O); all inputs injected.
- Both removal paths + both guard branches behave per the spec; `mapped` version-bump reconstruction produces no regression.
- Count-only logging; no sensitive values logged.

### Gateway Route (wiring)

#### Task Group 2: Wire derivation into the route + reconstruct the full fate map
**Dependencies:** Task Group 1

In `gateway/src/routes/vulnerabilityReduction.ts`, derive the FULL fate map server-side (call Group 1) for BOTH compute entry points (the `vulnerability-reduction` POST and the `use-version` recompute), instead of consuming only the client body fate map. Read captured Decisions via `fetchLatestCapturedDecisions` and the resolved set via `fetchLatestTargetManifestArtifacts`. Keep the request contract back-compatible / fail-soft.

- [x] 2.0 Complete the route wiring
  - [x] 2.1 Write 2-8 focused tests for the route fate-derivation
    - Limit to 2-8 highly focused tests maximum.
    - Cover: (a) the route now produces `removed` fates and the delta `eliminated` count rises when a stubbed captured Decision replaces a vulnerable family; (b) the version-bump `mapped` path is NOT regressed (a stubbed resolved dep still maps); (c) a client-sent body fate map is IGNORED in favour of the server-derived map; (d) fail-soft — a thrown/empty captured-decisions or manifest read degrades to still-vulnerable and never errors the response.
    - Inject stubs for `fetchLatestCapturedDecisions`, `fetchLatestTargetManifestArtifacts`, and the OSV source resolver (use the existing `setTargetOsvSourceResolver` seam or equivalent injection); no network.
  - [x] 2.2 Assemble the derivation inputs in the route
    - Gather the current vulnerable coordinates (the `projectCurrentVulnerability` projection the route already has), the unified captured Decisions, and the target manifest resolved set.
    - Confirm whether the route re-reads vulnerabilities server-side or continues to receive them in the body once the frontend stops sending the fate map; keep the chosen source explicit and documented in-code.
  - [x] 2.3 Build the authoritative server map and feed `runReductionCompute`
    - Call the Group 1 module to build the FULL `targetFateByCoordinate` (mapped + removed) BEFORE `runReductionCompute`.
    - Pass the derived map as `targetFateByCoordinate`; `runReductionCompute` and the pure delta service stay UNCHANGED.
    - `parseTargetFateMap` stays for back-compat parsing but is no longer authoritative; the derived server map wins. Ignore any client-sent fate map as the source of truth.
  - [x] 2.4 Apply the same derivation to the `use-version` recompute path
    - Both compute entry points share the ONE derivation so fate logic is identical; preserve `skipOsv` and the non-blocking recompute contract.
  - [x] 2.5 Preserve fail-soft + back-compat
    - A failed captured-decisions or manifest read degrades the affected coordinates to still-vulnerable (or skips the manifest-diff), never throws into the response.
    - `hasTarget`/`null`-on-no-snapshot behaviour preserved; count-only logging preserved.
  - [x] 2.6 Ensure route tests pass
    - Run ONLY the 2-8 tests written in 2.1, in the gateway package, in isolation.
    - Do NOT run the entire gateway suite. Do NOT start any server or curl localhost.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- Both compute entry points derive the fate map server-side; client fate map ignored as source of truth.
- Version-bump `mapped` path not regressed; `removed` fates now produced.
- Reads via the gateway clients only; fail-soft preserved; no AMS schema change.

#### Task Group 3: Provenance (`via`) on the delta output
**Dependencies:** Task Group 1 (can run alongside Task Group 2; both touch gateway delta/route files, so sequence with Group 2 — do not run concurrently against the same files)

Add an additive optional provenance field to `CoordinateOutcome` in `gateway/src/services/vulnerabilityReduction/vulnerabilityDeltaService.ts` so eliminated CVEs carry WHY they were eliminated (`replaced-by-decision:<code>` vs `dropped-from-target-manifest`). Thread it through `classifyCoordinate`. Count-only logging preserved; classification semantics unchanged.

- [x] 3.0 Complete the delta-output provenance
  - [x] 3.1 Write 2-8 focused tests for the provenance threading
    - Limit to 2-8 highly focused tests maximum.
    - Cover: (a) a `{kind:'removed', via:'replaced-by-decision:<code>'}` fate surfaces that `via` on the eliminated coordinate outcome; (b) a `{kind:'dropped-from-target-manifest'}` fate surfaces its distinct `via`; (c) absence of `via` (mapped/version-bump elimination) leaves the field undefined — no classification change.
  - [x] 3.2 Add the optional `via`/removal-reason field to `CoordinateOutcome`
    - Additive + optional only; do NOT change existing fields or classification buckets.
  - [x] 3.3 Thread `via` through `classifyCoordinate`
    - Copy the `removed` fate's `via` onto the per-coordinate outcome; mapped fates leave it undefined.
    - Preserve the "estimate, not a guarantee" labelling and the single-shared-delta discipline.
  - [x] 3.4 Preserve count-only logging
    - No CVE ids/coordinates/evidence bodies in logs.
  - [x] 3.5 Update the delta-service tests + ensure they pass
    - Update existing delta-service tests for the additive field as needed.
    - Run ONLY the 2-8 tests written in 3.1 (plus any delta-service tests directly touched), in the gateway package, in isolation.
    - Do NOT run the entire gateway suite. Do NOT start any server.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass.
- `via` is additive/optional; classification semantics unchanged.
- Eliminated-by-removal outcomes carry the correct distinct provenance; mapped eliminations carry none.
- Count-only logging preserved.

### Frontend

#### Task Group 4: Stop sending the client fate map + surface provenance
**Dependencies:** Task Group 2 (route/contract) and Task Group 3 (`via` field)

In `frontend/src/components/targetState/architectConversation/useVulnerabilityReduction.ts` and `ArchitectConversationTab.tsx`, stop sending the client-built `targetFateByCoordinate`/`targetVersions` as the source of truth (server now derives it); keep sending the current-state vulnerability rows the server needs plus ids/triggers. In `VulnerabilityReductionPanel.tsx`, surface the minimal provenance label on the eliminated list from the new `via`.

- [x] 4.0 Complete the frontend changes
  - [x] 4.1 Write 2-8 focused tests for the hook + panel
    - Limit to 2-8 highly focused tests maximum.
    - Cover: (a) the hook no longer sends the client-built fate map but STILL sends the current-state vulnerability rows + ids/triggers; (b) the per-answer recompute + `skipOsv` + debounce wiring still fire; (c) the panel renders "replaced by <Decision>" for `replaced-by-decision:<code>` and "dropped in target" for `dropped-from-target-manifest` on eliminated items; (d) an eliminated item with no `via` renders no provenance label.
    - Stub the `vulnerabilityReductionApi` module; no network.
  - [x] 4.2 Stop building/sending the client fate map in `useVulnerabilityReduction.ts`
    - Remove the client-built `targetFateByCoordinate`/`targetVersions` from the request as the source of truth (the `buildTargetInputsFromResolvedDeps`/`mergeTargetDeps` fate-BUILDING logic moves server-side).
    - Continue supplying the current-state vulnerability rows (already fetched via `listVulnerabilities`) and any inputs the server cannot fetch, plus the recompute trigger/ids.
    - Do NOT conflict with the already-landed `capturedDecisionOsvCoordinates` mirror and per-answer recompute wiring.
  - [x] 4.3 Preserve reactivity wiring in `ArchitectConversationTab.tsx`
    - Keep `triggerReductionRecompute`, the cheap `skipOsv` per-answer recompute, and the debounced full-scan trigger wired exactly as before.
  - [x] 4.4 Surface the minimal provenance label in `VulnerabilityReductionPanel.tsx`
    - On the eliminated list, read the new `via` and render a minimal label distinguishing `replaced-by-decision:<code>` ("replaced by <Decision>") vs `dropped-from-target-manifest` ("dropped in target").
    - No new panels; no other UI/structure change.
  - [x] 4.5 Ensure frontend tests pass IN ISOLATION
    - Run ONLY the touched component/hook test files (the tests from 4.1).
    - Whole-repo `tsc`/`lint` is pre-existingly RED on `main`; verify ONLY touched files. Do NOT start any dev server or probe localhost.

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass in isolation.
- Hook no longer sends the client fate map but still supplies the current-state vulnerability rows + ids/triggers; per-answer recompute + `skipOsv` + debounce preserved.
- Eliminated list shows the correct distinct provenance label from `via`; no label when absent; no new panels.

### Testing

#### Task Group 5: Test review & gap analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the derivation tests (1.1), route tests (2.1), delta-provenance tests (3.1), and frontend tests (4.1). Total existing: approximately 8-32 tests.
  - [x] 5.2 Analyze coverage gaps for THIS feature only
    - Focus on the end-to-end fate-derivation -> delta -> provenance-label flow and the over-counting guardrails.
    - Do NOT assess whole-application coverage.
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Fill only critical gaps (e.g. a combined Decision-family + manifest-diff scenario producing both provenances in one delta; manifest-absent => Decision-family-only credit end to end).
    - Skip edge cases / performance / accessibility unless business-critical.
  - [x] 5.4 Run feature-specific tests only
    - Gateway tests in the gateway package in isolation; frontend touched-file tests in isolation.
    - Do NOT run the entire application test suite. Do NOT start servers or probe localhost.

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-42 tests total).
- The two removal paths, the no-over-counting guards, and both provenance labels are covered end to end.
- No more than 10 additional tests added.

## Execution Order

Recommended implementation sequence:
1. Task Group 1 — pure server-side fate-derivation module (no dependencies).
2. Task Group 2 — wire derivation into the route + reconstruct mapped fates (depends on 1).
3. Task Group 3 — provenance `via` on the delta output (depends on 1; sequence with 2 since both touch gateway delta/route files — do not run concurrently against the same files).
4. Task Group 4 — frontend: stop sending the fate map + surface provenance (depends on the route/contract from 2 and the `via` field from 3).
5. Task Group 5 — test review & gap analysis (depends on 1-4).

Groups touching the same gateway files run sequentially.
</content>
</invoke>
