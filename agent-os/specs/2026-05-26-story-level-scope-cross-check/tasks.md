# Task Breakdown: Story-Level Scope Cross-Check for Citation Downgrade (Spec 4 Tightening)

## Overview

Single-commit, gateway-only Medium spec (~150-250 LOC). Tightens the existing Spec 4 `computeMissingCitationWarning` validator so the confidence downgrade fires only when at least one **in-scope** captured decision is uncited. Architecture-scope decisions stay always-in-scope; element-scope decisions are in-scope only when the story's `specText` or `affectedAreas` mention the resolved element name (case-insensitive substring). Validator stays pure; the handler performs the per-batch inventory fetch and inline enrichment.

Total Task Groups: 3
Total new tests: ~9 (8 validator + 1 handler)

Files touched (all in `gateway/`):
- `gateway/src/services/specGenerationResponseValidator.ts` (extend types + new helper + refined validator)
- `gateway/src/services/migrationShapeSpecGenerationHandler.ts` (fetcher return-shape change + new inventory fetcher + inline enrichment)
- `gateway/src/__tests__/specGenerationResponseValidatorDecisionCitation.test.ts` (extend with ~8 new tests)
- `gateway/src/__tests__/migrationShapeSpecGenerationHandler.test.ts` (1 new enrichment test)

## Critical Pitfalls (read before starting)

1. **`scopeKind` enum is `'architecture' | 'element'` ONLY.** Production `targetStateCapturedDecisionsWriter.ts:58` emits only these two values. The `service`/`interface` distinction lives on `scopeRefType`, NOT `scopeKind`. The raw-idea's wider enum was incorrect — the validator only ever sees two `scopeKind` values.
2. **`missingDecisionCodes` MUST be sorted alphabetically** in the warning payload. Stable test assertions, stable PR diffs.
3. **Fail-open at element level on inventory failure.** Element-scope decisions with `scopeElementName=null` are conservatively in-scope. The extension is NOT skipped — architecture-scope decisions still fire normally; only element-scope decisions degrade to fail-open.
4. **Skip the inventory fetch when zero element-scope decisions exist.** Trivial `decisions.some(d => d.scopeKind === 'element')` guard saves a multi-table SQL scan when not needed.
5. **Fail-soft when `targetArchitectureId` is null.** Matches the existing captured-decisions fetcher behaviour at lines 614-615 of `migrationShapeSpecGenerationHandler.ts`. No inventory fetch; empty Map.
6. **Case-insensitive raw substring match.** No word-boundary regex. Production element names are compound enough (e.g. `customer-service`) that over-matching risk is low.
7. **Backward-compat: legacy callers preserve v1 binary behaviour.** Callers that don't populate `scopeKind` are treated as architecture-scope → always-in-scope → v1 binary behaviour fallback. All seven existing tests in `specGenerationResponseValidatorDecisionCitation.test.ts` stay green verbatim.
8. **Validator stays pure (no I/O).** The handler is solely responsible for the inventory fetch and inline enrichment. Do NOT introduce any AMS calls inside `specGenerationResponseValidator.ts`.

## Task List

### Group 1 - Validator Extensions (pure, no I/O)

#### Task Group 1: Extend types, add scope-inference helper, refine `computeMissingCitationWarning`
**Dependencies:** None

- [x] 1.0 Complete validator-side scope-inference extensions in `gateway/src/services/specGenerationResponseValidator.ts`
  - [x] 1.1 Write ~8 focused tests for the scope-inference matrix
    - Extend existing test file: `gateway/src/__tests__/specGenerationResponseValidatorDecisionCitation.test.ts`
    - Reuse fixture builders `makeGeneratedResponse` and `DECISIONS`; extend `DECISIONS` with `scopeKind` / `scopeRefId` / `scopeElementName` variants
    - Cover (cap ~8 total new tests; existing 7 v1 tests stay green via backward-compat):
      - Architecture-scope, uncited → downgrades; `missingDecisionCodes=['db.engine']` populated
      - Element-scope, `scopeElementName='customer-service'` matches `affectedAreas` path `target/customer-service/...`, uncited → downgrades; codes populated
      - Element-scope, `scopeElementName='legacy-billing'` does NOT match story on `customer-service` only → NO downgrade (out-of-scope filter wins)
      - Mixed: architecture-scope (`db.engine`) + non-matching element-scope (`legacy-billing`) → downgrade fires for architecture-scope alone; `missingDecisionCodes=['db.engine']` only
      - All in-scope decisions cited (story has at least one `captured_decision` evidenceRef) → NO downgrade
      - Legacy caller: decisions passed without scope fields populated → v1 binary fallback (always-in-scope → downgrade fires)
      - Case-insensitive: story specText says `Customer Service`, decision `scopeElementName='customer-service'` → in-scope → downgrade
      - Element-scope with `scopeElementName=null` → fail-open conservative → in-scope → downgrade fires when uncited
      - Assertion that `missingDecisionCodes` is sorted alphabetically (use 3+ decisions with codes in mixed order; assert returned array is alphabetical)
    - Skip exhaustive coverage of all confidence-notch transitions — those are covered by the existing v1 tests
  - [x] 1.2 Extend `CapturedDecisionRefForCitationCheck` interface (around line 505)
    - Add `scopeKind?: 'architecture' | 'element'` — narrow enum matching production emission, NOT raw-idea's wider set
    - Add `scopeRefId?: string | null`
    - Add `scopeElementName?: string | null`
    - All three fields optional; legacy callers that omit them get v1 binary fallback behaviour
  - [x] 1.3 Extend `MissingDecisionCitationWarning` interface (around line 468)
    - Add `missingDecisionCodes: string[]` — populated with in-scope-but-uncited decision codes, sorted alphabetically
    - Existing `kind` and `recommendedNextAction` fields untouched
  - [x] 1.4 Add new internal helper `isDecisionInScopeForStory`
    - Signature: `(decision: CapturedDecisionRefForCitationCheck, response: GeneratedShapeSpecResponseA) => boolean`
    - Branch 1: `!decision.scopeKind || decision.scopeKind === 'architecture'` → return `true`
    - Branch 2: `scopeKind === 'element'` and `!decision.scopeElementName` → return `true` (fail-open conservative)
    - Branch 3: `scopeKind === 'element'` with non-null `scopeElementName` → case-insensitive raw substring match against `[response.specText, ...response.affectedAreas].join('\n').toLowerCase()` containing `decision.scopeElementName.toLowerCase()`
    - Raw substring (NOT word-boundary regex) — production element names are compound enough; revisit in v2 if signal/noise degrades
  - [x] 1.5 Refine `computeMissingCitationWarning`
    - Signature unchanged: `(response, capturedDecisions): MissingCitationExtensionResult`
    - Stays pure (no I/O); no new dependencies
    - Existing early return when `capturedDecisions.length === 0` unchanged
    - NEW: filter `capturedDecisions` through `isDecisionInScopeForStory`; if in-scope subset is empty, return `{ response, applied: false }`
    - Existing citation check unchanged: if any `captured_decision` evidenceRef present, return `{ response, applied: false }`
    - NEW: build `missingDecisionCodes` from the in-scope subset; sort alphabetically; attach to warning payload
    - Confidence-downgrade behaviour unchanged (one notch, floor at `low`)
  - [x] 1.6 Ensure Group 1 tests pass
    - Run ONLY the tests in `gateway/src/__tests__/specGenerationResponseValidatorDecisionCitation.test.ts`
    - Command: `cd gateway && npx jest specGenerationResponseValidatorDecisionCitation`
    - Expected: existing 7 v1 tests + ~8 new = ~15 tests all passing
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- All ~15 tests in `specGenerationResponseValidatorDecisionCitation.test.ts` pass (existing 7 + ~8 new)
- `CapturedDecisionRefForCitationCheck` gains three optional fields; `MissingDecisionCitationWarning` gains `missingDecisionCodes: string[]`
- `isDecisionInScopeForStory` implements the three-branch decision tree with case-insensitive raw substring matching
- `computeMissingCitationWarning` filters to in-scope first, returns no-op when in-scope subset is empty, and populates `missingDecisionCodes` sorted alphabetically
- Validator remains pure (no new imports, no I/O)
- Legacy callers (no `scopeKind` populated) still get v1 binary behaviour

### Group 2 - Handler Enrichment (I/O + wire-up)

#### Task Group 2: Inventory fetcher + return-shape change + inline enrichment in `runSinglePassBatch`
**Dependencies:** Task Group 1 (handler enrichment populates the new validator fields)

- [x] 2.0 Complete handler-side enrichment in `gateway/src/services/migrationShapeSpecGenerationHandler.ts`
  - [x] 2.1 Write 1 focused test for the handler enrichment + inventory wire-up
    - Test file: `gateway/src/__tests__/migrationShapeSpecGenerationHandler.test.ts` (extend existing file)
    - Mock the LLM client, `fetchCapturedDecisionsForCitationCheck`, and the new `fetchElementInventoryForCitationCheck` injected dep
    - Single test covering multiple sub-assertions (cap = 1 new handler test per spec):
      - With at least one `scopeKind='element'` captured decision AND non-null `targetArchitectureId`: handler calls `fetchElementInventoryForCitationCheck` exactly once per batch (not per story), builds the id→name Map, and passes enriched `CapturedDecisionRefForCitationCheck[]` (with `scopeElementName` populated) to `computeMissingCitationWarning`
      - Fail-soft path: when the injected `fetchElementInventoryForCitationCheck` mock throws / rejects, the validator is STILL called, decisions enriched with `scopeElementName=null`, and the citation extension proceeds (element-scope decisions fail-open to in-scope)
      - Optimisation sub-assertion: when all captured decisions are `scopeKind='architecture'`, the inventory fetcher is NOT called at all
    - Keep this as ONE test with multiple `expect` assertions, or split into at most 2 sub-tests — do not exceed the 1-test cap meaningfully
  - [x] 2.2 Change `CapturedDecisionsForCitationFetcher` type signature (lines 558-560)
    - Return type changes from `Promise<TargetStateCapturedDecision[]>` to `Promise<{ decisions: TargetStateCapturedDecision[]; targetArchitectureId: string | null }>`
    - Saves a duplicate `fetchActiveTargetArchitectureId` round-trip by hoisting the resolved id for the inventory fetcher to reuse
  - [x] 2.3 Update `defaultFetchCapturedDecisionsForCitationCheck` (lines 609-625)
    - Resolve `targetArchitectureId` as before; include it in the return shape rather than discarding
    - Preserve existing fail-soft on null `targetArchitectureId` (lines 614-615): return `{ decisions: [], targetArchitectureId: null }`
    - Preserve existing fail-soft on `fetchLatestCapturedDecisions` error: return `{ decisions: [], targetArchitectureId }` (with the resolved id intact so the caller can decide not to fetch inventory)
  - [x] 2.4 Add new optional dep on `ShapeSpecGenerationDeps` (lines 562-578)
    - Field: `fetchElementInventoryForCitationCheck?: (projectId: string, architectureId: string) => Promise<Map<string, string>>`
    - Optional so handler tests can inject a mock; default is `defaultFetchElementInventoryForCitationCheck` below
  - [x] 2.5 Add new default fetcher `defaultFetchElementInventoryForCitationCheck`
    - Signature: `(projectId: string, architectureId: string) => Promise<Map<string, string>>`
    - Calls existing `getElementsInventory` from `gateway/src/services/architectureModelClient.ts:1910` (already in use by selective-copy route at `architectures.ts:528`)
    - Flatten the returned `{domains: [{types: [{instances: [{id, name}]}]}]}` tree into a single `Map<id, name>`
    - Fail-soft pattern mirroring lines 618-624 of the captured-decisions fetcher: on `ArchitectureModelHttpError` / network error → log warn → return empty Map (fail-open at element level)
    - Use plain-English "Architecture Model Service" in log lines per project memory `feedback_no_invented_acronyms.md`
  - [x] 2.6 Inline enrichment at the citation-check call site (around lines 1631-1646 and 1907-1910)
    - After loading `{ decisions, targetArchitectureId }`:
      - Skip-inventory guard: if `decisions.length === 0` OR `targetArchitectureId === null` OR `!decisions.some(d => d.scopeKind === 'element')` → use empty Map without calling the inventory fetcher
      - Otherwise: call `fetchElementInventoryForCitationCheck(projectId, targetArchitectureId)` and reuse the Map across all stories in the batch
    - Replace the existing structural-typing pass-through (today the AMS DTO satisfies `CapturedDecisionRefForCitationCheck` by structural fit) with an explicit inline map from `TargetStateCapturedDecision[]` → `CapturedDecisionRefForCitationCheck[]`:
      - `decisionCode`, `answerValue` from the AMS DTO
      - `scopeKind`: defensively normalised — `decision.scopeKind === 'element' ? 'element' : 'architecture'` (any unrecognised value defaults to `'architecture'`, matching the narrow validator enum)
      - `scopeRefId`: passed through from the DTO
      - `scopeElementName`: `decision.scopeKind === 'element' && decision.scopeRefId ? (inventoryMap.get(decision.scopeRefId) ?? null) : null`
    - Inline (~15 LOC); no helper extraction in v1 per Q9
  - [x] 2.7 Ensure Group 2 tests pass
    - Run ONLY the new handler test in `gateway/src/__tests__/migrationShapeSpecGenerationHandler.test.ts` plus any existing tests in that file that touch the citation-check path
    - Command: `cd gateway && npx jest migrationShapeSpecGenerationHandler`
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 1 new handler enrichment test passes; all existing tests in `migrationShapeSpecGenerationHandler.test.ts` still pass
- `CapturedDecisionsForCitationFetcher` return shape changed to `{decisions, targetArchitectureId}` with fail-soft on null id preserved
- `defaultFetchElementInventoryForCitationCheck` exists and flattens the inventory tree into a `Map<id, name>` with fail-soft on AMS error
- Skip-inventory guard fires when zero element-scope decisions are present (no AMS call)
- Inline enrichment populates `scopeKind`, `scopeRefId`, `scopeElementName` correctly; defensively normalises any non-`'element'` `scopeKind` to `'architecture'`
- Inventory fetch failure → empty Map → element-scope decisions get `scopeElementName=null` → validator fail-opens them to in-scope (architecture-scope decisions still fire normally)
- Log lines use plain English "Architecture Model Service"

### Group 3 - Combined Verification (no commit)

#### Task Group 3: Run all touched test files + `tsc --noEmit`
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Verify the spec's Acceptance Verification bullets are satisfied
  - [x] 3.1 Run the feature-specific test suites
    - `cd gateway && npx jest specGenerationResponseValidatorDecisionCitation` — expect ~15 tests pass (existing 7 + ~8 new)
    - `cd gateway && npx jest migrationShapeSpecGenerationHandler` — expect existing tests + 1 new enrichment test pass
    - Do NOT run the entire application test suite
  - [x] 3.2 TypeScript clean check
    - `cd gateway && npx tsc --noEmit`
    - Must be clean — note that the return-shape change on `CapturedDecisionsForCitationFetcher` is a breaking type change; verify no call sites outside `migrationShapeSpecGenerationHandler.ts` rely on the old shape
  - [x] 3.3 Backward-compat invariant grep sweeps
    - Confirm no caller of `computeMissingCitationWarning` passes scope fields without going through the handler enrichment path (the validator extension itself is additive; only the handler call site changes)
    - Confirm no new file under `architecture-model-service/` (no AMS endpoint changes)
    - Confirm no new file under `frontend/` (no frontend changes)
    - Confirm no new Liquibase changeset added
    - Confirm no new method added to `architectureModelClient.ts` — only the existing `getElementsInventory` is consumed
  - [x] 3.4 Walk the spec's Acceptance Verification bullets
    - Validator: extended types, new helper, refined function, all ~15 tests green
    - Handler: return-shape change, new inventory fetcher, inline enrichment, 1 new test green
    - `tsc --noEmit` clean
    - Manual post-commit verification (to be performed by user after commit): generate a migration story with the architect having captured 4 decisions across both scopes; observe that the warning lists only the scope-relevant codes in `missingDecisionCodes`
  - [x] 3.5 Confirm pre-existing test failures untouched
    - Per project memory, the listed pre-existing failures (`bootstrap-summary-fetching.test.ts`, `conversation-memory-edge-cases.test.ts`, `dashboardSummary*.test.ts`, `hub-bootstrap-4-task-definition.test.ts`, `chatV2-panel-integration.test.ts`, `chatV2-panel-context-and-filtering.test.ts`) are unrelated to this work
    - Do NOT modify any of these tests; confirm by `git status` showing no edits to those files

**Acceptance Criteria:**
- All feature-specific tests pass (~15 validator + 1 handler enrichment = ~16 new/touched tests total)
- `npx tsc --noEmit` clean across the gateway
- No out-of-scope files touched (no AMS, no frontend, no Liquibase, no new client method)
- Pre-existing test failures from project memory are untouched
- Spec is ready for a single-commit gateway-only landing

## Execution Order

Recommended implementation sequence:
1. **Group 1** — Validator extensions (pure, lowest-risk, fully covered by extending an existing test file)
2. **Group 2** — Handler enrichment (depends on Group 1's new validator field shape; introduces the only I/O change)
3. **Group 3** — Combined verification (no code changes; runs feature-scoped tests and `tsc`)

All work lands in a single commit per the spec's commit-boundary requirement (~150-250 LOC across two source files and two test files).
