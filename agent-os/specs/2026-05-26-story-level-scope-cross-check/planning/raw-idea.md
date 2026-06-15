# Raw Idea: Story-Level Scope Cross-Check for Citation Downgrade (Spec 4 Tightening)

## Why this spec exists

Spec 4 (`2026-05-25-pm-tasks-captured-decisions-integration`, shipped) introduced a validator extension `computeMissingCitationWarning` that **downgrades confidence on a generated migration story** when:

1. The project has at least one captured decision, AND
2. The story's `evidenceRefs[]` contains zero entries with `type='captured_decision'`.

The rule is **project-level binary**: any uncited captured decision triggers the downgrade regardless of whether that decision actually relates to what the story does. A story about "migrate the order-service to PostgreSQL" gets downgraded equally for not citing `api.protocol`, `auth.protocol`, or `frontend.framework` — even though none of those decisions apply to a database-engine story.

This is too aggressive. Stories that legitimately touch only a narrow domain end up with `low` confidence not because they're poor specs but because the architect made many captured decisions across the whole architecture. The downgrade noise dilutes the signal of the validator.

**This spec tightens the rule**: the downgrade fires only when at least one **in-scope** captured decision is uncited. Architecture-scope decisions are always in-scope (defaults that every story should acknowledge). Service / interface / element-scope decisions are in-scope only when the story actually touches that scope.

The hard problem is **inferring story scope** from the available signal. Stories carry `affectedAreas: string[]` (file paths) and `evidenceRefs[]` (mapping/decision/element refs) — but no structured "I touch element X" field. v1 takes a substring-match approach using element names; more sophisticated resolution (architecture-inventory joins, evidenceRef traversal) is deferred to v2 if the rule proves too lossy.

Spec 4 explicitly deferred this: *"Story-level scope cross-check (e.g. only downgrade if the story actually touches a domain that has a decision) is deferred — see Out of Scope."* This spec is the deferred piece.

## What this spec is (and isn't)

**This spec is:**

- An extension to the existing `computeMissingCitationWarning` validator in `gateway/src/services/specGenerationResponseValidator.ts`.
- A richer captured-decision shape (`CapturedDecisionRefForCitationCheck`) carrying scope metadata (`scopeKind`, `scopeRefId`, `scopeElementName`).
- **Scope-inference logic** that, for each captured decision, decides whether it's in-scope for the current story:
  - `scopeKind='architecture'` → ALWAYS in-scope.
  - `scopeKind='service'|'interface'|'element'` → in-scope iff the decision's `scopeElementName` (case-insensitive substring) appears in the story's `specText` OR any `affectedAreas` entry.
- **Refined downgrade rule**: fires only when at least one in-scope decision is uncited.
- **Enriched warning payload**: the existing `missing_decision_citation` warning gains a `missingDecisionCodes: string[]` field listing the codes that were in-scope-but-uncited (so the architect knows what to add).
- Upstream changes in `migrationShapeSpecGenerationHandler.ts` (or wherever captures are loaded) to populate the new `scopeKind` / `scopeRefId` / `scopeElementName` fields on the list passed to the validator.

**This spec is not:**

- A change to the existing behavior for projects with **zero** captured decisions (still no-op).
- A change to the downgrade semantics (still "one notch, floor at `low`"). Just narrows when it fires.
- A change to the existing `computeUnreferencedCitedDecisionWarning` (N2 safety net — separate concern).
- A new mechanism for stories to declare scope. We work with the existing `specText` + `affectedAreas` signal.
- A full architecture-inventory resolution. v1 uses substring matching on names; v2 can integrate inventory lookups.
- A change to the wire shape of captured decisions on AMS or in transit. The new fields on `CapturedDecisionRefForCitationCheck` are validator-input only; the gateway constructs them from the existing `TargetStateCapturedDecisionDto` + an in-process resolution.
- An LLM-assisted matching mechanism.
- A new validator variant or branch. The existing function is extended in-place.
- A change to the test surface for other validator rules (the existing `MissingCitationExtensionResult` envelope stays the same shape; only the `missingDecisionCodes` field is new on the warning).
- A retroactive re-evaluation of previously-generated stories. Only stories generated AFTER this ships go through the new rule.

## Decisions already made (don't re-litigate in shape-spec)

These were settled while drafting this raw idea:

1. **Substring match on `scopeElementName` for v1.** Architecture inventory resolution is deferred to v2 if false-positives/negatives surface in real use.
2. **Architecture-scope decisions are ALWAYS in-scope.** Defaults are universal; every story is expected to acknowledge them.
3. **Case-insensitive substring match.** Element names in stories may be capitalized differently than in the captured decisions (e.g. `customer-service` vs `Customer Service`).
4. **Warning shape extended additively.** New `missingDecisionCodes: string[]` field on `MissingDecisionCitationWarning`; existing callers that read only `kind` + `recommendedNextAction` still work.
5. **Captured-decision metadata expansion is backward-compatible.** New fields on `CapturedDecisionRefForCitationCheck` are optional; existing callers that don't populate them get the v1 (project-level binary) behavior as a fallback.
6. **The validator stays a pure function.** No I/O. The handler is responsible for fetching the architecture inventory and enriching the captured-decision list before calling the validator.
7. **No retroactive re-evaluation.** Only new stories get the tightened rule.
8. **One commit, gateway-only.**
9. **Test coverage matrix**: matches/no-matches across architecture/service/element scope decisions, single and multiple in-scope decisions, all-cited / none-cited / partially-cited.

## Specific requirements (rough — let shape-spec refine)

### Validator signature change

In `gateway/src/services/specGenerationResponseValidator.ts`:

**Extend `CapturedDecisionRefForCitationCheck`**:

```ts
export interface CapturedDecisionRefForCitationCheck {
  decisionCode: string;
  /** Optional verbatim answer string (Item N2 extension). */
  answerValue?: string;
  /** NEW (#9): decision scope kind. */
  scopeKind?: 'architecture' | 'service' | 'interface' | 'element';
  /** NEW (#9): scope-specific reference id (UUID for non-architecture scopes; null for architecture). */
  scopeRefId?: string | null;
  /** NEW (#9): human-readable element name for substring matching (null when scope is architecture or name not resolvable). */
  scopeElementName?: string | null;
}
```

Backward-compatible: existing callers that don't populate the new fields get v1 binary behavior (treated as architecture-scope by default).

**Extend `MissingDecisionCitationWarning`**:

```ts
export interface MissingDecisionCitationWarning extends Record<string, unknown> {
  kind: 'missing_decision_citation';
  recommendedNextAction: 'review and add decision codes';
  /** NEW (#9): the in-scope-but-uncited decision codes. Empty array = legacy v1 behavior. */
  missingDecisionCodes: string[];
}
```

**Internal scope-match helper**:

```ts
function isDecisionInScopeForStory(
  decision: CapturedDecisionRefForCitationCheck,
  response: GeneratedShapeSpecResponseA
): boolean {
  // Architecture scope (or unspecified — legacy callers) → always in-scope.
  if (!decision.scopeKind || decision.scopeKind === 'architecture') return true;
  // Element-bound scope but no name to match → conservatively in-scope (better safe).
  if (!decision.scopeElementName) return true;
  const haystackParts = [
    response.specText,
    ...response.affectedAreas,
  ];
  const haystack = haystackParts.join('\n').toLowerCase();
  const needle = decision.scopeElementName.toLowerCase();
  return haystack.includes(needle);
}
```

**Refined `computeMissingCitationWarning`**:

```ts
export function computeMissingCitationWarning(
  response: GeneratedShapeSpecResponseA,
  capturedDecisions: readonly CapturedDecisionRefForCitationCheck[]
): MissingCitationExtensionResult {
  if (!capturedDecisions || capturedDecisions.length === 0) {
    return { response, applied: false };
  }

  // NEW (#9): filter to in-scope decisions for this story.
  const inScopeDecisions = capturedDecisions.filter((d) =>
    isDecisionInScopeForStory(d, response)
  );
  if (inScopeDecisions.length === 0) {
    return { response, applied: false }; // Project has decisions but none apply to this story.
  }

  // Story-cited check stays the same.
  if (hasCapturedDecisionEvidenceRef(response.evidenceRefs)) {
    return { response, applied: false };
  }

  // Build the missing-codes list from in-scope set.
  const missingDecisionCodes = inScopeDecisions.map((d) => d.decisionCode);

  const warning: MissingDecisionCitationWarning = {
    kind: 'missing_decision_citation',
    recommendedNextAction: 'review and add decision codes',
    missingDecisionCodes,
  };
  const originalConfidence = response.confidence;
  const newConfidence = downgradeConfidenceOneNotch(originalConfidence);
  const augmented: GeneratedShapeSpecResponseA = {
    ...response,
    warnings: [...response.warnings, warning],
    confidence: newConfidence,
  };
  return {
    response: augmented,
    applied: true,
    originalConfidence,
  };
}
```

### Handler / coordinator update

In `gateway/src/services/migrationShapeSpecGenerationHandler.ts` (or wherever `computeMissingCitationWarning` is called):

- The handler currently maps `TargetStateCapturedDecision[]` to `CapturedDecisionRefForCitationCheck[]` with just `decisionCode` (+ N2's `answerValue`).
- Extend the mapping to populate the new fields:
  - `scopeKind: decision.scopeKind` (already on the AMS DTO).
  - `scopeRefId: decision.scopeRefId` (already on the AMS DTO).
  - `scopeElementName`: derived. For `scopeKind='architecture'` → `null`. For other scopes → look up the element name from the architecture inventory by `scopeRefId`.
- The inventory lookup is the new piece of plumbing. Two paths:
  - **(a) Lazy inventory fetch**: the handler fetches the inventory once per generation batch and builds an id→name map. Each story reuses the same map.
  - **(b) Pre-resolved by AMS**: extend the `TargetStateCapturedDecisionDto` with a `scopeElementName` field populated server-side. Bigger change but cleaner.
  - My instinct: **(a) lazy inventory fetch** for v1. Keeps AMS untouched.

### Tests

In `gateway/src/__tests__/specGenerationResponseValidatorDecisionCitation.test.ts` (or new sibling file):

New test cases covering the matrix:

1. **Architecture-scope decision, no citation** → downgrades (existing behaviour preserved). `missingDecisionCodes: ['db.engine']` populated.
2. **Service-scope decision matching story's `affectedAreas`** → in-scope, no citation → downgrades.
3. **Service-scope decision NOT matching story's content** → not in-scope → no downgrade.
4. **Mixed: arch-scope + service-scope-not-matching** → arch-scope alone fires → downgrades with just `['db.engine']` in `missingDecisionCodes`.
5. **All in-scope decisions cited** → no downgrade.
6. **Legacy callers (no scope fields populated)** → fall back to v1 behaviour (always in-scope).
7. **Case-insensitive matching**: story mentions `Customer Service`, decision's `scopeElementName='customer-service'` → in-scope.
8. **Missing scopeElementName for non-architecture scope** → conservatively in-scope (fail-open).

Aim for ~6-8 new tests. Existing v1 tests stay green (backward compat).

### Verification

- `cd gateway && npm test -- specGenerationResponseValidatorDecisionCitation` passes.
- `cd gateway && npx tsc --noEmit` clean.
- `cd gateway && npm test -- migrationShapeSpecGenerationHandler` passes (handler enrichment doesn't regress existing behaviour).
- Manual verification (post-commit, by user): generate a migration story with the architect having captured 4 decisions across different scopes; observe that the warning includes only the scope-relevant codes in `missingDecisionCodes`.

## Out of Scope

- LLM-assisted scope inference. v1 is deterministic substring matching only.
- Full architecture-inventory traversal (e.g. resolving evidenceRefs to elements then to services). v2 candidate if v1 lossy.
- Changes to AMS captured-decisions wire shape (`TargetStateCapturedDecisionDto` stays as-is).
- Changes to the existing `computeUnreferencedCitedDecisionWarning` (N2 — separate concern).
- Retroactive re-evaluation of previously-generated stories.
- Reporting / dashboards of cited-vs-uncited decisions.
- Per-decision severity (currently all uncited in-scope decisions are equal weight).
- Caching the inventory id→name map across batch invocations. The handler fetches it once per batch; not optimised.
- A "no captured-decision evidenceRefs ever => downgrade" override for stories that should always cite something. Out of scope.
- Internal-link recognition for cross-references inside `specText` (e.g. `[customer-service]` linkifies to an element). v2 enhancement.
- New AMS endpoints.
- Frontend changes.

## Dependencies

- `2026-05-25-pm-tasks-captured-decisions-integration` (Spec 4, shipped) — the validator extension this spec tightens.
- `2026-05-24-target-state-captured-decisions-data-plane` (shipped) — provides the `scopeKind` / `scopeRefId` fields on `TargetStateCapturedDecisionDto`.
- `2026-05-25-ams-test-infrastructure-cleanup` (shipped) — `mvn test` works (not strictly needed since this spec is gateway-only, but the wider arc depends on it).
- Item N2 (just shipped) — coexists alongside; the validator now has two extensions, both fire-independent.

No new external dependencies.

## Open questions for shape-spec to clarify

1. **Inventory lookup path: lazy fetch in handler (a) or extend AMS DTO with `scopeElementName` (b)?** My instinct: **(a) lazy fetch**. Keeps AMS untouched; the lookup is cheap (one inventory fetch per batch, cached for the batch's lifetime). (b) would be cleaner long-term but is a wider change.

2. **What if the inventory lookup returns no name for a `scopeRefId`?** (Element deleted after the decision was captured.) Conservative-in-scope (fail-open) or skip the decision entirely? My instinct: **conservative-in-scope** (fail-open) — better to flag a citation than silently drop a real concern. Matches the helper's existing `if (!decision.scopeElementName) return true;` line.

3. **Substring match boundary: word-boundary vs raw substring?** A decision with `scopeElementName='order'` would match a story containing "order-service" (correct) but also "reorder" (incorrect). My instinct: **raw substring** for v1 — simpler, slightly more permissive. Word-boundary matching is a future hardening if false positives surface.

4. **`affectedAreas` file paths often contain service names as path segments.** Match against the raw path string, or extract a "service name" segment? My instinct: **raw path string** — substring match against the full path catches "target/customer-service/Foo.java" → "customer-service" naturally.

5. **Should the warning's `missingDecisionCodes` field be deterministic (e.g. sorted)?** My instinct: **yes, sorted alphabetically** — keeps test assertions and PR diffs stable.

6. **Migration paths for callers that already populate `CapturedDecisionRefForCitationCheck` without the new fields.** Backward-compat: legacy callers omit the new fields → `scopeKind` is undefined → helper treats as architecture-scope (always in-scope) → v1 binary behaviour preserved. My instinct: **as proposed** — backward-compat is load-bearing.

7. **Should the handler enrich the captured-decisions list inline, or expose a new helper for it?** My instinct: **inline mapping inside the handler** for v1; if more validators need the same enrichment later, extract to a helper.

8. **Test cap.** ~6-8 new tests for the matrix. My instinct: **8** — covers the core matrix cleanly without over-investing.

9. **Commit boundary.** One commit, gateway-only. My instinct: **yes**.

10. **Naming for the helper function.** `isDecisionInScopeForStory`, `decisionAppliesToStory`, `decisionRelatesToStory`. My instinct: **`isDecisionInScopeForStory`** — most precise.

## Verification

After this spec:
- The validator's `computeMissingCitationWarning` only downgrades when at least one in-scope decision is uncited.
- Architecture-scope decisions remain always-in-scope.
- Service / interface / element-scope decisions are in-scope only when the story's `specText` or `affectedAreas` mention the element name (case-insensitive substring).
- The warning carries `missingDecisionCodes: string[]` listing which decisions were in-scope-but-uncited.
- The handler enriches captured decisions with `scopeKind` / `scopeRefId` / `scopeElementName` before passing to the validator.
- Legacy callers (no scope fields populated) get the v1 binary behaviour as a fallback.

## Commit boundary

One commit, gateway-only. ~150-250 LOC: validator changes + handler enrichment + ~8 new tests.
