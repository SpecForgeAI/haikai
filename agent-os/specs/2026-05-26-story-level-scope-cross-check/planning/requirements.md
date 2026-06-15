# Spec Requirements: Story-Level Scope Cross-Check for Citation Downgrade

## Initial Description

Tighten the Spec 4 `computeMissingCitationWarning` validator so the
confidence downgrade fires only when at least one **in-scope** captured
decision is uncited. Architecture-scope decisions remain always-in-scope;
element-scope decisions are in-scope only when the story's `specText` or
`affectedAreas` mention the element name (case-insensitive substring).
Validator stays pure; the handler does the enrichment, including a per-batch
inventory fetch to resolve `scopeRefId` -> element name.

Full design + 10 already-settled decisions are in `planning/raw-idea.md`.

## Investigation Findings

### Inventory-Fetch Implementation Path

**Existing client method (ready to call as-is):**

- `getElementsInventory(projectId: string, architectureId: string): Promise<ElementInventoryResponse>`
- Defined in `gateway/src/services/architectureModelClient.ts:1910`
- Hits `GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory`
- Returns nested tree:
  `{domains: [{name, types: [{name, entityType, instances: [{id, name, archived?}]}]}]}`
- Already imported + used by `gateway/src/routes/architectures.ts:31, 528` for
  the selective-copy picker -- so this is a well-trodden path, not a
  speculative one.
- Throws `ArchitectureModelHttpError` on non-2xx (we'll wrap it the same way
  the existing `defaultFetchCapturedDecisionsForCitationCheck` wraps captured
  decisions: fail-soft -> empty map -> all element-scope decisions fall back to
  fail-open in-scope).

**The architecture id is already available in the handler's per-batch scope.**
The handler already resolves it once per batch via
`defaultFetchActiveTargetArchitectureIdForCitation` (imported at
`gateway/src/services/migrationShapeSpecGenerationHandler.ts:125`), wrapped
inside `defaultFetchCapturedDecisionsForCitationCheck` at line 609-625. That
helper discards the resolved `targetId` after calling
`fetchLatestCapturedDecisions`. **The cleanest implementation is to change the
helper's return shape from `TargetStateCapturedDecision[]` to
`{ decisions: TargetStateCapturedDecision[]; targetArchitectureId: string | null }`**
so the handler can reuse the resolved id for the inventory call -- avoiding a
second `fetchActiveTargetArchitectureId` round-trip.

**Recommended call placement:**

In `runSinglePassBatch` at `migrationShapeSpecGenerationHandler.ts:1606`,
between the existing captured-decisions fetch (lines 1637-1646) and the
per-story loop (line 1681). Wire it through a new optional injectable dep
`fetchElementInventoryForCitationCheck?: (projectId, architectureId) =>
Promise<Map<string, string>>` so tests can override.

**Inventory cost note:**

- Inventory is six SQL scans (one per domain), each a `SELECT id, name FROM
  <table> WHERE architecture_id = ?` (or via parent join). For a typical mid-
  sized architecture (~500-2000 elements total across all six domains) this
  is fast (< 200 ms) -- already battle-tested by the selective-copy picker
  which renders it on every dialog open.
- One fetch per batch (not per story) per the raw-idea's existing pattern.
  No caching across batches needed for v1 -- spec explicitly says this is OK.

### Handler Structure

**Key call sites in `gateway/src/services/migrationShapeSpecGenerationHandler.ts`:**

- **Captured-decisions fetch:** lines 1631-1646. Today returns
  `TargetStateCapturedDecision[]` via `defaultFetchCapturedDecisionsForCitationCheck`
  (helper at lines 609-625).
- **`computeMissingCitationWarning` call:** line 1907-1910. Passes
  `capturedDecisionsForCitation` (a `TargetStateCapturedDecision[]`) directly --
  TypeScript's structural typing accepts it because `TargetStateCapturedDecision`
  has `decisionCode`. **There is NO explicit mapping step today;** the
  validator's `CapturedDecisionRefForCitationCheck` is so narrow that the AMS
  DTO satisfies it by structural fit alone.

**Implication for this spec:** the handler needs to introduce a NEW explicit
mapping step before the call -- the structural-fit shortcut breaks once we
need a derived `scopeElementName` field that doesn't exist on the AMS DTO.

**Batching:** the handler operates on a list of stories sequentially in one
batch (lines 1681-1683 `for (const story of eligible)`). The
`capturedDecisionsForCitation` list is computed ONCE before the loop (lines
1637-1646). The inventory map should follow the same pattern: fetch once,
build a `Map<elementId, elementName>`, and reuse for every story.

### Test Coverage Surface

**Existing test file:** `gateway/src/__tests__/specGenerationResponseValidatorDecisionCitation.test.ts`

- Pure-function tests (no I/O mocks needed).
- Fixture builder `makeGeneratedResponse` constructs realistic
  `GeneratedShapeSpecResponseA` objects with `specText`, `affectedAreas`,
  `evidenceRefs`, etc. Fully covers the new validator surface.
- `DECISIONS: CapturedDecisionRefForCitationCheck[]` at line 46 will need
  fixture extensions for `scopeKind` / `scopeRefId` / `scopeElementName`.
- All seven existing tests stay green under the new behaviour (each one
  passes captured-decisions without `scopeKind` populated, which the new
  scope-helper treats as architecture-scope = always in-scope -> v1 binary
  fallback).

**Handler-side tests:** `gateway/src/__tests__/migrationShapeSpecGenerationHandler.test.ts`
will need ONE new test that asserts the handler:

1. Calls the inventory fetch when at least one captured decision has
   `scopeKind='element'`.
2. Builds the `Map<elementId, elementName>` and populates
   `scopeElementName` on the enriched list before passing to the validator.
3. Skips the inventory fetch entirely when ALL decisions are
   `scopeKind='architecture'` (optimisation -- no need to incur the network
   call when no element-name lookup is needed).

### Substring-Match Risk Surface (Sampled)

**Captured-decision `scopeKind` enum in production (sampled):**

From `gateway/src/services/architectConversation/targetStateCapturedDecisionsWriter.ts:58`:
> `scopeKind: 'architecture' | 'element'`

The raw-idea mentions `service` and `interface` as separate scope kinds, but
**they don't exist as a `scopeKind` value -- they exist as `scopeRefType`
values when `scopeKind='element'`**. The full `scopeRefType` set is in
`gateway/src/config/architect-conversation/questionLibrary.ts:38-46`:

```
'service' | 'interface' | 'endpoint' | 'physical_data_entity'
| 'physical_data_attribute' | 'method' | 'class'
```

This is a meaningful **simplification opportunity** for the validator's
`isDecisionInScopeForStory` helper: instead of branching on
`scopeKind === 'service' | 'interface' | 'element'`, the helper only needs
two branches:

- `scopeKind === 'architecture'` (or undefined) -> always in-scope.
- `scopeKind === 'element'` -> substring-match `scopeElementName` against
  `specText` + `affectedAreas`.

The richer `scopeRefType` taxonomy is **invisible to the validator** --
the handler resolves it to a name via the inventory lookup, and the
validator sees only `(scopeKind, scopeElementName)`.

**Sampled story-side `affectedAreas`:**

From `gateway/src/__tests__/migrationShapeSpecGenerationHandler.test.ts:243-244`:

```
'target/customer-service/src/main/java/com/example/customer/CustomerController.java',
'target/customer-service/src/main/resources/openapi.yaml',
```

Substring-matching `customer-service` against this path catches it cleanly.
File paths are the dominant `affectedAreas` shape per the test fixtures and
align with the spec's substring-match strategy.

**False-positive risk:**

- Generic names like `order`, `customer`, `user`, `api` will over-match
  (e.g. `order` matches `reorder`, `customer` matches `customers`,
  `customer-service`, `customer-data`...).
- Service names tend to compound (`customer-service`, `order-management-api`),
  which keeps false-positive rate low in practice -- the architects who
  populate these names follow the architecture's element-naming conventions
  that are usually compound identifiers.
- Method/class names are camelCase or dotted (`CustomerController`,
  `com.example.OrderService.placeOrder`) -- substring-matching these against
  file-path `affectedAreas` works because the class name is a path segment.
- **Conclusion:** the raw-idea's "raw substring, case-insensitive" approach
  is acceptable for v1. Word-boundary matching is a v2 hardening if the
  signal-to-noise ratio is bad in real use.

**False-negative risk:**

- Story `specText` might paraphrase ("the customer service" vs the element's
  actual name `customer-service`). Substring won't match because of the
  hyphen vs space.
- Stories that conceptually touch an element via an indirect reference
  (e.g. they reference an interface, but the captured decision is on the
  service that implements it) will be missed.
- **Mitigation:** the fail-open default (decision in-scope when
  `scopeElementName` is null or the element was deleted) and the
  architecture-scope-always-in-scope baseline ensure we never drop a real
  concern. The risk surface is "this story SHOULD have cited an element
  decision and we let it slide" -- not "we silently dropped a decision
  the architect captured."

### Validator-Function Signature Change

In `gateway/src/services/specGenerationResponseValidator.ts`:

**Extend `CapturedDecisionRefForCitationCheck` (line 505):**

```ts
export interface CapturedDecisionRefForCitationCheck {
  decisionCode: string;
  answerValue?: string;
  /** NEW: 'architecture' or 'element' (matches the production enum, NOT the
   *  raw-idea's wider 'architecture'|'service'|'interface'|'element' set --
   *  see Sampled risk surface above). Undefined -> treated as architecture. */
  scopeKind?: 'architecture' | 'element';
  /** NEW: scope reference id; null/undefined for architecture-scope. */
  scopeRefId?: string | null;
  /** NEW: resolved element name (case-insensitive substring needle). Null
   *  when scope is architecture or when the inventory lookup returned no
   *  name (deleted element, lookup failure) -- the helper treats both as
   *  fail-open. */
  scopeElementName?: string | null;
}
```

**Extend `MissingDecisionCitationWarning` (line 468):**

```ts
export interface MissingDecisionCitationWarning extends Record<string, unknown> {
  kind: 'missing_decision_citation';
  recommendedNextAction: 'review and add decision codes';
  /** NEW: in-scope-but-uncited decision codes, sorted alphabetically for
   *  test-assertion stability. Empty array reserved for legacy v1
   *  envelope; populated array for v2. */
  missingDecisionCodes: string[];
}
```

**New internal helper:**

```ts
function isDecisionInScopeForStory(
  decision: CapturedDecisionRefForCitationCheck,
  response: GeneratedShapeSpecResponseA
): boolean {
  if (!decision.scopeKind || decision.scopeKind === 'architecture') return true;
  // scopeKind === 'element' beyond this point.
  if (!decision.scopeElementName) return true; // fail-open
  const haystack = [response.specText, ...response.affectedAreas]
    .join('\n')
    .toLowerCase();
  return haystack.includes(decision.scopeElementName.toLowerCase());
}
```

**Refined `computeMissingCitationWarning`:** filters `capturedDecisions`
through `isDecisionInScopeForStory` before checking citation; assembles
`missingDecisionCodes` from the in-scope subset; returns
`applied=false` when in-scope subset is empty.

### Handler Enrichment Spec

In `gateway/src/services/migrationShapeSpecGenerationHandler.ts`:

**Touch points:**

1. **Line 558-560** (`CapturedDecisionsForCitationFetcher` type): change
   return type to
   `Promise<{ decisions: TargetStateCapturedDecision[]; targetArchitectureId: string | null }>`
   so the helper exposes the resolved architecture id for the inventory call.
2. **Line 562-578** (`ShapeSpecGenerationDeps`): add new optional dep
   `fetchElementInventoryForCitationCheck?: (projectId: string,
   architectureId: string) => Promise<Map<string, string>>`.
3. **Lines 609-625** (`defaultFetchCapturedDecisionsForCitationCheck`):
   update to return the new `{decisions, targetArchitectureId}` shape;
   add a sibling default `defaultFetchElementInventoryForCitationCheck`
   that calls `getElementsInventory` and flattens
   `domains[].types[].instances[]` into a single `Map<id, name>`.
4. **Lines 1631-1646** (per-batch fetch in `runSinglePassBatch`): update to
   consume the new return shape; if any decision has `scopeKind==='element'`
   AND `targetArchitectureId` is non-null, call the inventory fetcher and
   build the id->name map; otherwise leave the map empty.
5. **Line 1907-1910** (the validator call): replace the direct pass-through
   with an inline mapping that builds the enriched
   `CapturedDecisionRefForCitationCheck[]`:
   - `decisionCode`, `answerValue` from the AMS DTO.
   - `scopeKind`: `decision.scopeKind === 'element' ? 'element' :
     'architecture'` (defensively normalise to the validator's narrow
     enum; any unrecognised value defaults to `'architecture'`).
   - `scopeRefId`: `decision.scopeRefId` directly.
   - `scopeElementName`: `decision.scopeKind === 'element' && decision.scopeRefId
     ? (inventoryMap.get(decision.scopeRefId) ?? null) : null`.

**Inline vs helper extraction:** the enrichment is ~10 LOC of mapping plus
~5 LOC of inventory-map flattening. Inline inside the handler for v1; extract
to a `enrichCapturedDecisionsForCitation` helper in v2 if a second validator
needs it.

### Test Coverage Matrix (8 cases from raw-idea)

In `gateway/src/__tests__/specGenerationResponseValidatorDecisionCitation.test.ts`:

| # | Scenario | scopeKind | scopeElementName | Story content | Cited? | Expected |
|---|----------|-----------|------------------|----|----|----|
| 1 | Architecture-scope, uncited | `architecture` | `null` | any | no | downgrade; `missingDecisionCodes=['db.engine']` |
| 2 | Element-scope, name matches `affectedAreas` | `element` | `customer-service` | path `target/customer-service/...` | no | downgrade; codes populated |
| 3 | Element-scope, name does NOT match | `element` | `legacy-billing` | story on `customer-service` only | no | NO downgrade (out of scope) |
| 4 | Mixed: arch-scope + non-matching element | both | `db.engine` (arch), `legacy-billing` (element-no-match) | story on `customer-service` only | no | downgrade with `['db.engine']` only |
| 5 | All in-scope decisions cited | any | any | matching | yes (cites at least one) | NO downgrade |
| 6 | Legacy caller (no scope fields) | undefined | undefined | any | no | downgrade (v1 binary fallback) -- backwards-compat |
| 7 | Case-insensitive: story says `Customer Service`, name `customer-service` | `element` | `customer-service` | specText mentions `Customer Service` | no | downgrade (matches) |
| 8 | Element-scope with null `scopeElementName` | `element` | `null` | any | no | downgrade (fail-open conservative) |

Plus ONE new handler-side test in
`gateway/src/__tests__/migrationShapeSpecGenerationHandler.test.ts`:

- **Handler enrichment test:** verify the handler calls `getElementsInventory`
  once per batch, builds the id->name map, and passes enriched decisions to
  the validator. Use injected `fetchElementInventoryForCitationCheck` mock
  returning a fixture map; assert the validator receives decisions with
  `scopeElementName` populated.

### Backward-Compat Invariant

Three layers of fallback ensure no existing caller breaks:

1. **Validator level:** missing `scopeKind` -> treated as architecture-scope
   -> always-in-scope -> v1 binary behaviour preserved.
2. **Validator level:** missing `scopeElementName` on element-scope ->
   fail-open conservative -> in-scope -> downgrade fires.
3. **Handler level:** inventory fetch failure / empty map -> all
   element-scope decisions get `scopeElementName=null` -> fail-open
   conservative -> downgrade fires when uncited -> matches v1 behaviour
   except now the warning carries `missingDecisionCodes`.

Existing v1 tests (the seven in
`specGenerationResponseValidatorDecisionCitation.test.ts`) stay green
verbatim; they pass `CapturedDecisionRefForCitationCheck[]` without scope
fields and rely on the architecture-scope-by-default branch.

## Requirements Discussion

### Clarifying Questions

(Returned to user in final response; will be appended here after answers received.)

### Accepted Answers (2026-05-26)

User accepted all defaults. Decisions to encode in the spec:

- **Q1 `scopeKind` enum narrowed to `'architecture' | 'element'`.** Matches
  production reality (`targetStateCapturedDecisionsWriter.ts:58` emits
  only these two). The `service`/`interface` distinction lives on
  `scopeRefType`, not `scopeKind`. Raw-idea's wider enum was incorrect.
  Simplifies the helper.
- **Q2 Change `defaultFetchCapturedDecisionsForCitationCheck` signature.**
  Returns `Promise<{ decisions, targetArchitectureId }>` instead of
  `Promise<TargetStateCapturedDecision[]>`. Saves a duplicate AMS
  round-trip; type signature was already changing for this spec.
- **Q3 Skip inventory fetch when no element-scope decisions exist.**
  Trivial `decisions.some(d => d.scopeKind === 'element')` guard. Saves
  the multi-table SQL scan when not needed (all-architecture-scope
  decision sets are common during early architecture work).
- **Q4 Fail-open at element level on inventory failure.** If
  `getElementsInventory` throws, every element-scope decision gets
  `scopeElementName=null` → conservatively in-scope → downgrade fires.
  Architecture-scope decisions still fire. Does NOT skip the entire
  citation extension. v1 binary behaviour is the degradation.
- **Q5 Sort `missingDecisionCodes` alphabetically** in the warning
  payload. Stable test assertions, stable PR diffs.
- **Q6 Raw substring match** (not word-boundary regex). Production
  element names are compound (`customer-service`, not `order`), so
  over-matching risk is low. Revisit in v2 if false-positive rate
  proves bad.
- **Q7 Match against full path string** in `affectedAreas` (not
  extracted segment). Sampled fixture `'target/customer-service/src/...'`
  substring-matches cleanly.
- **Q8 Helper name `isDecisionInScopeForStory`.** Matches codebase
  predicate-naming convention (`isStoryBlocked`,
  `hasCapturedDecisionEvidenceRef`).
- **Q9 Inline mapping at the enrichment site.** ~15 LOC; no helper
  extraction in v1. Extract to `enrichCapturedDecisionsForCitation`
  only if a second validator needs the same enrichment later.
- **Q10 ONE new handler-side test.** Asserts `getElementsInventory` is
  called once per batch and decisions are enriched with
  `scopeElementName` before the validator call. Validator-side tests
  cover the scope-inference matrix purely.
- **Q11 Fail-soft when `targetArchitectureId` is null.** Existing
  captured-decisions helper returns `[]` (line 614-615); inventory
  fetch follows the same path — no inventory fetch, empty map,
  fail-open at element level if any decision is element-scope.

**Net effect on sizing:** Confirmed **Medium**. ~150-250 LOC,
gateway-only, one commit.

**Test counts:**
- Validator tests: ~8 (scope-inference matrix — architecture-only,
  element-scope matching, element-scope NOT matching, mixed, all
  cited, none cited, legacy callers without scope fields,
  case-insensitive matching, missing scopeElementName fail-open).
- Handler test: 1 (verifies inventory-fetch wire-up + enrichment).

Total: ~9 new tests.

## Visual Assets

No visual assets requested (code-only spec).

## Reusability Opportunities

- **`getElementsInventory` client method** in
  `gateway/src/services/architectureModelClient.ts:1910` -- already in use by
  the selective-copy route at `gateway/src/routes/architectures.ts:528`.
  Direct reuse, no new client method needed.
- **`fetchActiveTargetArchitectureId`** already chained inside
  `defaultFetchCapturedDecisionsForCitationCheck` at lines 609-625 of
  `migrationShapeSpecGenerationHandler.ts` -- amend to expose the resolved
  id rather than discard it.
- **Fail-soft pattern** for the inventory fetch should mirror the existing
  captured-decisions fail-soft (lines 618-624) -- log a warn, return empty
  map, let the validator fall back to fail-open in-scope.
- **Test fixture builders** (`makeGeneratedResponse`, `DECISIONS`) in
  `specGenerationResponseValidatorDecisionCitation.test.ts` -- reuse with
  scope-field extensions.

## Scope Boundaries

### In Scope

- Validator-level scope-inference helper + refined
  `computeMissingCitationWarning`.
- Validator-shape extensions (`CapturedDecisionRefForCitationCheck` gains
  three optional fields; `MissingDecisionCitationWarning` gains
  `missingDecisionCodes`).
- Handler-level enrichment: per-batch inventory fetch via existing
  `getElementsInventory` client; build id->name map; inline-map captured
  decisions before validator call.
- ~8 new validator tests + 1 new handler test.
- Backward compatibility via three fallback layers (see above).

### Out of Scope

- LLM-assisted scope inference.
- Full architecture-inventory traversal (evidenceRef chain resolution).
- Changes to AMS DTOs or new AMS endpoints.
- Frontend changes.
- Retroactive re-evaluation of previously-generated stories.
- Caching the inventory map across batches.
- Word-boundary substring matching (raw substring for v1).
- Per-decision severity weighting.
- A `'no captured_decision evidenceRefs ever -> downgrade'` override.
- Internal-link recognition (`[customer-service]` cross-refs in specText).
- Reporting/dashboards.

## Technical Considerations

- **Inventory fetch is heavy-ish but bounded:** six SQL scans, < 200 ms for
  typical sizes per the selective-copy picker's track record. One call per
  batch is acceptable.
- **Inventory call MAY be skipped** when every captured decision is
  `scopeKind='architecture'` -- a small optimisation that should be wired
  into the handler.
- **Architect-emitted `scopeKind` enum is only `'architecture' | 'element'`**
  per `targetStateCapturedDecisionsWriter.ts:58`. The wider taxonomy
  (`service`, `interface`, etc.) lives on `scopeRefType` and is invisible to
  the validator after the handler resolves a name from the inventory.
- **Type-juggling note at line 1907-1910:** today the handler relies on
  TypeScript's structural typing to feed `TargetStateCapturedDecision[]`
  into the validator's `CapturedDecisionRefForCitationCheck[]` parameter.
  This shortcut breaks once we add the derived `scopeElementName` field --
  we MUST add an explicit mapping step. Make sure no other call site of the
  validator slips through.
- **Sorted `missingDecisionCodes`:** alphabetical sort by `decisionCode`
  inside the validator keeps test assertions stable and PR diffs minimal.

## Acceptance Verification

- `cd gateway && npm test -- specGenerationResponseValidatorDecisionCitation` passes (existing 7 + new 8 = 15 total).
- `cd gateway && npm test -- migrationShapeSpecGenerationHandler` passes (existing tests + 1 new enrichment test).
- `cd gateway && npx tsc --noEmit` clean.
- Manual post-commit verification by user: generate a migration story with
  the architect having captured 4 decisions across both scopes; observe that
  the warning lists only the scope-relevant codes in `missingDecisionCodes`.
