# Specification: Story-Level Scope Cross-Check for Citation Downgrade (Spec 4 Tightening)

## Goal

Tighten the Spec 4 `computeMissingCitationWarning` validator so the confidence downgrade fires only when at least one **in-scope** captured decision is uncited, instead of firing on any uncited project-level decision. Architecture-scope decisions stay always-in-scope; element-scope decisions are in-scope only when the story's `specText` or `affectedAreas` mention the element name (case-insensitive substring). This is a Medium, gateway-only, single-commit tightening (~150-250 LOC) that extends the existing validator and handler in place.

## User Stories

- As a migration architect, I want a story about `customer-service` not to be flagged for missing decisions about `legacy-billing`, so the citation downgrade is a meaningful signal rather than noise.
- As a Product Manager reviewing a downgraded story, I want the warning to list the specific in-scope decision codes I missed citing, so I know exactly which captured decisions to add to `evidenceRefs[]`.
- As a backend developer extending the validator, I want legacy callers that don't populate scope fields to keep getting the v1 binary behaviour, so the change is backward-compatible and doesn't require touching every call site.

## Specific Requirements

**Extend `CapturedDecisionRefForCitationCheck` with scope fields**
- File: `gateway/src/services/specGenerationResponseValidator.ts`.
- Add three optional fields: `scopeKind?: 'architecture' | 'element'`, `scopeRefId?: string | null`, `scopeElementName?: string | null`.
- Narrow enum is deliberate: production `targetStateCapturedDecisionsWriter.ts:58` emits only `'architecture' | 'element'`. The `service`/`interface` distinction lives on `scopeRefType`, NOT `scopeKind`. Raw-idea's wider enum was incorrect — corrected here.
- All three optional. Callers that don't populate them get v1 binary behaviour (treated as architecture-scope → always in-scope).

**Extend `MissingDecisionCitationWarning` with `missingDecisionCodes`**
- Same file. Add `missingDecisionCodes: string[]` to the warning interface.
- Populated with the in-scope-but-uncited decision codes, sorted alphabetically for stable test assertions and PR diffs.
- Existing readers of `kind` + `recommendedNextAction` keep working — additive change.

**New internal helper `isDecisionInScopeForStory`**
- Signature: `(decision: CapturedDecisionRefForCitationCheck, response: GeneratedShapeSpecResponseA) => boolean`.
- Architecture scope (or `scopeKind` undefined) → returns `true`.
- Element scope with `scopeElementName` null/undefined → fail-open `true` (conservative; better safe).
- Element scope with non-null `scopeElementName` → case-insensitive raw substring match against `response.specText` joined with `response.affectedAreas.join('\n')`.
- Raw substring (not word-boundary regex) — production element names are compound (`customer-service`), false-positive risk is low; revisit in v2 if signal/noise degrades.
- Matches against the full path string in `affectedAreas` (e.g. `target/customer-service/src/...` substring-matches `customer-service` cleanly).

**Refined `computeMissingCitationWarning`**
- Same signature `(response, capturedDecisions): MissingCitationExtensionResult`. Stays pure (no I/O).
- Early return `{ response, applied: false }` when `capturedDecisions.length === 0` (unchanged).
- NEW: filter through `isDecisionInScopeForStory`. If the in-scope subset is empty, return `{ response, applied: false }`.
- Existing-citation check unchanged: if any `captured_decision` evidenceRef is present, return `{ response, applied: false }`.
- Build `missingDecisionCodes` from the in-scope subset sorted alphabetically; attach to the warning payload.
- Confidence-downgrade behaviour unchanged (one notch, floor at `low`).

**Change `defaultFetchCapturedDecisionsForCitationCheck` signature**
- File: `gateway/src/services/migrationShapeSpecGenerationHandler.ts` (helper at lines 609-625).
- Return shape changes from `Promise<TargetStateCapturedDecision[]>` to `Promise<{ decisions: TargetStateCapturedDecision[]; targetArchitectureId: string | null }>`.
- Saves a duplicate `fetchActiveTargetArchitectureId` round-trip by hoisting the resolved id to the caller for the new inventory fetch.
- Fail-soft when `targetArchitectureId` is null — matches existing behaviour at lines 614-615 (return empty decisions list, null id).
- Update the `CapturedDecisionsForCitationFetcher` type signature accordingly (line 558-560).

**New default fetcher `defaultFetchElementInventoryForCitationCheck`**
- Same file. Signature: `(projectId: string, architectureId: string) => Promise<Map<string, string>>`.
- Calls existing `getElementsInventory` from `architectureModelClient.ts:1910` (already battle-tested by the selective-copy picker at `architectures.ts:528`).
- Flattens `domains[].types[].instances[]` into a single `Map<id, name>`.
- Failure path (network error, `ArchitectureModelHttpError`) → log warn, return empty Map. Fail-open at element level (per backward-compat layer 3).
- Skip path: when `architectureId === null` returns empty Map without calling AMS.
- Wire through a new optional injectable dep `fetchElementInventoryForCitationCheck?` on `ShapeSpecGenerationDeps` (line 562-578) so handler tests can override.

**Inline enrichment at the citation-check call site**
- Same file, `runSinglePassBatch` around lines 1631-1646 and 1907-1910.
- After loading `{ decisions, targetArchitectureId }`: if `decisions.some(d => d.scopeKind === 'element')` AND `targetArchitectureId` is non-null, call the inventory fetcher; otherwise skip the fetch entirely and use an empty Map.
- Map `TargetStateCapturedDecision[]` → `CapturedDecisionRefForCitationCheck[]` inline (~15 LOC; no helper extraction in v1) with:
  - `decisionCode`, `answerValue` from the AMS DTO.
  - `scopeKind`: defensively normalised — `'element'` when source is `'element'`, `'architecture'` otherwise (covers any unrecognised value).
  - `scopeRefId`: passed through from the DTO.
  - `scopeElementName`: `decision.scopeKind === 'element' && decision.scopeRefId ? (inventoryMap.get(decision.scopeRefId) ?? null) : null`.
- Replace the current structural-typing pass-through (today the AMS DTO satisfies `CapturedDecisionRefForCitationCheck` by structural fit) with this explicit mapping. The shortcut breaks once `scopeElementName` is derived and not present on the DTO.

**Backward-compat fallback layers**
- Layer 1 (validator): missing `scopeKind` → treated as architecture-scope → always-in-scope → v1 binary behaviour preserved.
- Layer 2 (validator): missing `scopeElementName` on element-scope → fail-open conservative → in-scope → downgrade fires.
- Layer 3 (handler): inventory fetch failure or null `targetArchitectureId` → empty Map → all element-scope decisions get `scopeElementName=null` → fail-open conservative → downgrade fires when uncited, but warning now carries `missingDecisionCodes`.

**Validator-side tests** (target ~8)
- File: extend existing `gateway/src/__tests__/specGenerationResponseValidatorDecisionCitation.test.ts`. Reuse `makeGeneratedResponse` + `DECISIONS` fixtures.
- Architecture-scope, no citation → downgrades; `missingDecisionCodes` populated.
- Element-scope decision name matches `affectedAreas` → in-scope, no citation → downgrades.
- Element-scope decision name does NOT match → not in-scope → no downgrade.
- Mixed: architecture-scope + element-scope-not-matching → architecture-scope alone fires; `missingDecisionCodes` contains only the architecture code.
- All in-scope decisions cited → no downgrade.
- Legacy callers (no scope fields populated) → v1 binary fallback (always-in-scope).
- Case-insensitive: story mentions `Customer Service`, decision `scopeElementName='customer-service'` → in-scope.
- Missing `scopeElementName` for element-scope decision → fail-open in-scope.
- Plus an assertion that `missingDecisionCodes` is sorted alphabetically.

**Handler-side test** (target 1)
- File: `gateway/src/__tests__/migrationShapeSpecGenerationHandler.test.ts` (or sibling).
- Verify `getElementsInventory` is called once per batch (not per story).
- Verify decisions are enriched with `scopeElementName` from the inventory Map before the validator call.
- Verify inventory-fetch failure path: validator still called; decisions enriched with `scopeElementName=null`.
- Optional sub-assertion (within the same test): when all decisions are `scopeKind='architecture'`, the inventory fetcher is NOT called.

## Existing Code to Leverage

**`getElementsInventory` in `gateway/src/services/architectureModelClient.ts:1910`**
- Existing client method hitting `GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory`.
- Already in use by selective-copy route at `gateway/src/routes/architectures.ts:31, 528` — well-trodden path.
- Returns nested tree `{domains: [{name, types: [{name, entityType, instances: [{id, name, archived?}]}]}]}` that the new default fetcher flattens to a `Map<id, name>`.
- Throws `ArchitectureModelHttpError` on non-2xx — wrap with the same fail-soft pattern used by `defaultFetchCapturedDecisionsForCitationCheck`.

**`defaultFetchCapturedDecisionsForCitationCheck` in `migrationShapeSpecGenerationHandler.ts:609-625`**
- Today resolves `targetArchitectureId` via `fetchActiveTargetArchitectureId` then discards it after calling `fetchLatestCapturedDecisions`.
- Amend to expose the resolved id in the return shape rather than discard — single-call optimisation for the new inventory fetch.
- Existing fail-soft on null `targetArchitectureId` (line 614-615) — extend the same pattern to the new fetcher.

**`computeMissingCitationWarning` + `MissingDecisionCitationWarning` + `CapturedDecisionRefForCitationCheck` in `specGenerationResponseValidator.ts`**
- The Spec 4 validator extension this spec tightens. All three are extended additively; existing v1 callers and the seven existing tests stay green via backward-compat layer 1.

**Test fixture builders `makeGeneratedResponse` + `DECISIONS` in `specGenerationResponseValidatorDecisionCitation.test.ts`**
- Reuse for the new ~8 validator tests. Extend `DECISIONS` fixture with `scopeKind` / `scopeRefId` / `scopeElementName` variants — no new builder utility needed.

**Fail-soft pattern at `migrationShapeSpecGenerationHandler.ts:618-624`**
- Existing wrap-and-log-and-return-empty pattern for captured-decisions fetch. Mirror it verbatim for the new inventory fetcher — same log shape, same empty-result fallback.

## Out of Scope

- LLM-assisted scope inference. v1 is deterministic substring matching only.
- Full architecture-inventory traversal (e.g. resolving `evidenceRefs` to elements then to services). v2 candidate if v1 lossy.
- Changes to AMS captured-decisions wire shape (`TargetStateCapturedDecisionDto` stays as-is).
- Changes to `computeUnreferencedCitedDecisionWarning` (N2 — separate concern; coexists; both extensions fire independently).
- Retroactive re-evaluation of previously-generated stories.
- Reporting / dashboards of cited-vs-uncited decisions.
- Per-decision severity weighting (all uncited in-scope decisions are equal weight).
- Caching the inventory id→name Map across batch invocations.
- A `'no captured_decision evidenceRefs ever → downgrade'` override.
- Internal-link recognition for cross-references inside `specText` (e.g. `[customer-service]` linkify).
- Word-boundary regex matching (v1 uses raw substring per Q6).
- New AMS endpoints.
- Frontend changes.

## Dependencies

- `2026-05-25-pm-tasks-captured-decisions-integration` (Spec 4, shipped) — the validator extension this spec tightens.
- `2026-05-24-target-state-captured-decisions-data-plane` (shipped) — provides `scopeKind` / `scopeRefId` on `TargetStateCapturedDecisionDto`.
- N2 (just shipped) — coexists; validator now has two extensions (`computeMissingCitationWarning` + `computeUnreferencedCitedDecisionWarning`), both fire independently.
- `getElementsInventory` in `architectureModelClient.ts` (existing) — the inventory-fetch client method this spec consumes.

No new external dependencies.

## Commit Boundary

One commit, gateway-only. ~150-250 LOC covering:
- `specGenerationResponseValidator.ts`: extended `CapturedDecisionRefForCitationCheck` (three optional fields), extended `MissingDecisionCitationWarning` (`missingDecisionCodes`), new `isDecisionInScopeForStory` helper, refined `computeMissingCitationWarning`.
- `migrationShapeSpecGenerationHandler.ts`: `CapturedDecisionsForCitationFetcher` return-shape change, new `defaultFetchElementInventoryForCitationCheck`, new optional dep on `ShapeSpecGenerationDeps`, inline enrichment in `runSinglePassBatch`.
- ~8 new validator tests + 1 new handler test (~9 total).

No frontend changes, no new gateway client methods, no new AMS endpoints, no Liquibase changesets.

## Acceptance Verification

- `cd gateway && npm test -- specGenerationResponseValidatorDecisionCitation` passes (existing 7 + new ~8 = ~15 total).
- `cd gateway && npm test -- migrationShapeSpecGenerationHandler` passes (existing + 1 new enrichment test).
- `cd gateway && npx tsc --noEmit` clean.
- Manual post-commit verification: generate a migration story with the architect having captured 4 decisions across both scopes; observe the warning lists only the scope-relevant codes in `missingDecisionCodes`.
