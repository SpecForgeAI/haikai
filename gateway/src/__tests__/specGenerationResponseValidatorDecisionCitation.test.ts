/**
 * Tests for the Spec 2026-05-25 PM Tasks Captured Decisions Integration
 * shape-spec validator extension (Group 3.1).
 *
 * Covers (capped at 4-8 tests):
 *   1. Missing-citation: project has captured decisions, story evidenceRefs[]
 *      has zero captured_decision entries -> warning appended + confidence
 *      downgrade high -> medium.
 *   2. Confidence downgrade medium -> low.
 *   3. Confidence stays low -> low when downgrade fires.
 *   4. No downgrade when project has zero captured decisions.
 *   5. No downgrade when story already contains at least one captured_decision evidenceRef.
 *   6. Per-story scope: one story missing citation, another with a citation --
 *      only the missing one is downgraded / warned.
 *   7. Helper predicates (hasCapturedDecisionEvidenceRef + downgradeConfidenceOneNotch).
 *
 * Spec 2026-05-26 tightening (story-level scope cross-check):
 *   8. Architecture-scope decision uncited → downgrade; missingDecisionCodes populated.
 *   9. Element-scope decision name matching affectedAreas → in-scope → downgrade.
 *  10. Element-scope decision name NOT matching → out-of-scope → NO downgrade.
 *  11. Mixed (architecture-scope + non-matching element-scope) → only architecture-scope fires.
 *  12. All in-scope decisions cited → NO downgrade.
 *  13. Legacy callers (no scopeKind populated) → v1 binary fallback → downgrade fires.
 *  14. Case-insensitive matching across specText / affectedAreas.
 *  15. Element-scope with scopeElementName=null → fail-open in-scope → downgrade fires.
 *  16. missingDecisionCodes is sorted alphabetically.
 */

import {
  computeMissingCitationWarning,
  hasCapturedDecisionEvidenceRef,
  downgradeConfidenceOneNotch,
  isDecisionInScopeForStory,
  GeneratedShapeSpecResponseA,
  CapturedDecisionRefForCitationCheck,
} from '../services/specGenerationResponseValidator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGeneratedResponse(
  overrides: Partial<GeneratedShapeSpecResponseA> = {}
): GeneratedShapeSpecResponseA {
  return {
    status: 'generated',
    confidence: 'high',
    specText: '/agent-os:shape-spec ' + 'x'.repeat(250) + ' for story scope',
    warnings: [],
    evidenceRefs: [],
    assumptions: [],
    tests: [{ title: 't-1', description: 'Unit test t-1.', type: 'unit' }],
    coveredEndpointIds: [],
    affectedAreas: ['module-a'],
    ...overrides,
  };
}

const DECISIONS: CapturedDecisionRefForCitationCheck[] = [
  { decisionCode: 'db.engine' },
  { decisionCode: 'service.framework' },
];

describe('shape-spec validator extension -- missing-decision-citation (Spec 2026-05-25, Group 3.1)', () => {
  it('appends a missing_decision_citation warning AND downgrades high -> medium when project has decisions but story cites none', () => {
    const response = makeGeneratedResponse({ confidence: 'high', evidenceRefs: [] });
    const result = computeMissingCitationWarning(response, DECISIONS);

    expect(result.applied).toBe(true);
    expect(result.originalConfidence).toBe('high');
    expect(result.response.confidence).toBe('medium');
    expect(result.response.warnings.length).toBe(1);
    // Spec 2026-05-26: warning now carries `missingDecisionCodes` (alphabetical).
    expect(result.response.warnings[0]).toEqual({
      kind: 'missing_decision_citation',
      recommendedNextAction: 'review and add decision codes',
      missingDecisionCodes: ['db.engine', 'service.framework'],
    });
    // Input response object must NOT be mutated (handler relies on returned response identity).
    expect(response.confidence).toBe('high');
    expect(response.warnings).toEqual([]);
  });

  it('downgrades medium -> low when the extension fires on a medium-confidence response', () => {
    const response = makeGeneratedResponse({ confidence: 'medium', evidenceRefs: [] });
    const result = computeMissingCitationWarning(response, DECISIONS);

    expect(result.applied).toBe(true);
    expect(result.originalConfidence).toBe('medium');
    expect(result.response.confidence).toBe('low');
    expect(result.response.warnings.length).toBe(1);
  });

  it('keeps low at low when the extension fires on a low-confidence response (floor)', () => {
    const response = makeGeneratedResponse({ confidence: 'low', evidenceRefs: [] });
    const result = computeMissingCitationWarning(response, DECISIONS);

    expect(result.applied).toBe(true);
    expect(result.originalConfidence).toBe('low');
    // low -> low: extension still applies (warning appended) but confidence does not change.
    expect(result.response.confidence).toBe('low');
    expect(result.response.warnings.length).toBe(1);
  });

  it('does NOT downgrade or warn when the project has zero captured decisions (additive: no behaviour change)', () => {
    const response = makeGeneratedResponse({ confidence: 'high', evidenceRefs: [] });
    const result = computeMissingCitationWarning(response, []);

    expect(result.applied).toBe(false);
    expect(result.response).toBe(response); // same identity
    expect(result.response.confidence).toBe('high');
    expect(result.response.warnings).toEqual([]);
  });

  it('does NOT downgrade or warn when the story already cites at least one captured_decision evidenceRef', () => {
    const response = makeGeneratedResponse({
      confidence: 'high',
      evidenceRefs: [
        { type: 'architecture_element_mapping', id: 'm-1' },
        { type: 'captured_decision', id: 'db.engine' },
      ],
    });
    const result = computeMissingCitationWarning(response, DECISIONS);

    expect(result.applied).toBe(false);
    expect(result.response).toBe(response);
    expect(result.response.confidence).toBe('high');
  });

  it('per-story scope: one story missing citation, another with a citation -- only the missing one is warned/downgraded', () => {
    const storyA = makeGeneratedResponse({
      confidence: 'high',
      evidenceRefs: [{ type: 'captured_decision', id: 'db.engine' }],
    });
    const storyB = makeGeneratedResponse({
      confidence: 'high',
      evidenceRefs: [{ type: 'discovery_finding', id: 'f-1' }],
    });

    const resultA = computeMissingCitationWarning(storyA, DECISIONS);
    const resultB = computeMissingCitationWarning(storyB, DECISIONS);

    expect(resultA.applied).toBe(false);
    expect(resultA.response.confidence).toBe('high');
    expect(resultA.response.warnings).toEqual([]);

    expect(resultB.applied).toBe(true);
    expect(resultB.response.confidence).toBe('medium');
    expect(resultB.response.warnings.length).toBe(1);
    expect(resultB.response.warnings[0]).toEqual(
      expect.objectContaining({ kind: 'missing_decision_citation' })
    );
  });

  it('helper predicates behave correctly (hasCapturedDecisionEvidenceRef + downgradeConfidenceOneNotch)', () => {
    // hasCapturedDecisionEvidenceRef
    expect(hasCapturedDecisionEvidenceRef([])).toBe(false);
    expect(hasCapturedDecisionEvidenceRef(['some-string-ref'])).toBe(false);
    expect(
      hasCapturedDecisionEvidenceRef([{ type: 'discovery_finding', id: 'f-1' }])
    ).toBe(false);
    expect(
      hasCapturedDecisionEvidenceRef([{ type: 'captured_decision', id: 'db.engine' }])
    ).toBe(true);
    expect(
      hasCapturedDecisionEvidenceRef([
        { type: 'discovery_finding', id: 'f-1' },
        { type: 'captured_decision', id: 'service.framework' },
      ])
    ).toBe(true);
    // camelCase `capturedDecision` does NOT count (snake_case required per spec).
    expect(
      hasCapturedDecisionEvidenceRef([{ type: 'capturedDecision', id: 'db.engine' }])
    ).toBe(false);

    // downgradeConfidenceOneNotch
    expect(downgradeConfidenceOneNotch('high')).toBe('medium');
    expect(downgradeConfidenceOneNotch('medium')).toBe('low');
    expect(downgradeConfidenceOneNotch('low')).toBe('low');
  });

  it('augmented response is a NEW object (does not mutate caller input)', () => {
    const inputWarnings: Array<Record<string, unknown>> = [{ code: 'pre-existing', detail: 'x' }];
    const response = makeGeneratedResponse({
      confidence: 'high',
      evidenceRefs: [],
      warnings: inputWarnings,
    });
    const result = computeMissingCitationWarning(response, DECISIONS);

    expect(result.applied).toBe(true);
    // Returned object is different identity.
    expect(result.response).not.toBe(response);
    // Input warnings array is not mutated (no new entries appended).
    expect(inputWarnings.length).toBe(1);
    // Augmented warnings array has both entries.
    expect(result.response.warnings.length).toBe(2);
    expect(result.response.warnings[0]).toEqual({ code: 'pre-existing', detail: 'x' });
    expect(result.response.warnings[1]).toEqual(
      expect.objectContaining({ kind: 'missing_decision_citation' })
    );
  });
});

// ===========================================================================
// Spec 2026-05-26 tightening: story-level scope cross-check tests
// ===========================================================================

describe('shape-spec validator -- story-level scope cross-check (Spec 2026-05-26)', () => {
  it('architecture-scope decision, uncited -> downgrades; missingDecisionCodes carries the architecture code', () => {
    const archDecision: CapturedDecisionRefForCitationCheck = {
      decisionCode: 'db.engine',
      scopeKind: 'architecture',
      scopeRefId: null,
      scopeElementName: null,
    };
    const response = makeGeneratedResponse({
      confidence: 'high',
      evidenceRefs: [],
      specText:
        '/agent-os:shape-spec body about an unrelated topic that should not match anything '
          .padEnd(260, ' '),
      affectedAreas: ['target/customer-service/src/main/java/Foo.java'],
    });

    const result = computeMissingCitationWarning(response, [archDecision]);

    expect(result.applied).toBe(true);
    expect(result.response.confidence).toBe('medium');
    expect(result.response.warnings.length).toBe(1);
    expect(result.response.warnings[0]).toEqual({
      kind: 'missing_decision_citation',
      recommendedNextAction: 'review and add decision codes',
      missingDecisionCodes: ['db.engine'],
    });
  });

  it('element-scope decision matching affectedAreas substring -> in-scope -> downgrades', () => {
    const elementDecision: CapturedDecisionRefForCitationCheck = {
      decisionCode: 'cs.framework',
      scopeKind: 'element',
      scopeRefId: 'svc-1',
      scopeElementName: 'customer-service',
    };
    const response = makeGeneratedResponse({
      confidence: 'high',
      evidenceRefs: [],
      affectedAreas: [
        'target/customer-service/src/main/java/com/example/customer/CustomerController.java',
      ],
    });

    const result = computeMissingCitationWarning(response, [elementDecision]);

    expect(result.applied).toBe(true);
    expect(result.response.confidence).toBe('medium');
    expect((result.response.warnings[0] as Record<string, unknown>).missingDecisionCodes).toEqual([
      'cs.framework',
    ]);
  });

  it('element-scope decision NOT matching story content -> out-of-scope -> NO downgrade', () => {
    const elementDecision: CapturedDecisionRefForCitationCheck = {
      decisionCode: 'billing.adapter',
      scopeKind: 'element',
      scopeRefId: 'svc-2',
      scopeElementName: 'legacy-billing',
    };
    const response = makeGeneratedResponse({
      confidence: 'high',
      evidenceRefs: [],
      specText:
        '/agent-os:shape-spec This story is exclusively about the customer-service domain '
          .padEnd(260, ' '),
      affectedAreas: ['target/customer-service/src/main/java/Foo.java'],
    });

    const result = computeMissingCitationWarning(response, [elementDecision]);

    expect(result.applied).toBe(false);
    expect(result.response).toBe(response);
    expect(result.response.confidence).toBe('high');
  });

  it('mixed: architecture-scope + non-matching element-scope -> only the architecture-scope fires', () => {
    const decisions: CapturedDecisionRefForCitationCheck[] = [
      {
        decisionCode: 'db.engine',
        scopeKind: 'architecture',
        scopeRefId: null,
        scopeElementName: null,
      },
      {
        decisionCode: 'billing.adapter',
        scopeKind: 'element',
        scopeRefId: 'svc-2',
        scopeElementName: 'legacy-billing',
      },
    ];
    const response = makeGeneratedResponse({
      confidence: 'high',
      evidenceRefs: [],
      specText:
        '/agent-os:shape-spec Story about the customer-service domain only - no billing here '
          .padEnd(260, ' '),
      affectedAreas: ['target/customer-service/src/main/java/Foo.java'],
    });

    const result = computeMissingCitationWarning(response, decisions);

    expect(result.applied).toBe(true);
    expect((result.response.warnings[0] as Record<string, unknown>).missingDecisionCodes).toEqual([
      'db.engine',
    ]);
  });

  it('all in-scope decisions cited -> NO downgrade (cited evidenceRef short-circuits)', () => {
    const decisions: CapturedDecisionRefForCitationCheck[] = [
      {
        decisionCode: 'db.engine',
        scopeKind: 'architecture',
        scopeRefId: null,
        scopeElementName: null,
      },
    ];
    const response = makeGeneratedResponse({
      confidence: 'high',
      evidenceRefs: [{ type: 'captured_decision', id: 'db.engine' }],
    });

    const result = computeMissingCitationWarning(response, decisions);

    expect(result.applied).toBe(false);
    expect(result.response.confidence).toBe('high');
  });

  it('legacy callers (no scopeKind populated) -> v1 binary fallback -> downgrade fires for all uncited codes', () => {
    // Pass decisions without any scope* fields -- mirrors a legacy caller that
    // has not been updated to the Spec 2026-05-26 enrichment path.
    const legacyDecisions: CapturedDecisionRefForCitationCheck[] = [
      { decisionCode: 'db.engine' },
      { decisionCode: 'service.framework' },
      { decisionCode: 'auth.provider' },
    ];
    const response = makeGeneratedResponse({
      confidence: 'high',
      evidenceRefs: [],
      // Story content has no element-name overlap; legacy callers should still
      // downgrade because everything is treated as architecture-scope.
      specText:
        '/agent-os:shape-spec Generic story content with no element-specific anchors. '
          .padEnd(260, ' '),
      affectedAreas: ['some/path.ts'],
    });

    const result = computeMissingCitationWarning(response, legacyDecisions);

    expect(result.applied).toBe(true);
    const warning = result.response.warnings[0] as Record<string, unknown>;
    expect(warning.missingDecisionCodes).toEqual([
      // Alphabetical sort -- this is also the missingDecisionCodes sort
      // assertion (3+ decisions in non-alphabetical input order).
      'auth.provider',
      'db.engine',
      'service.framework',
    ]);
  });

  it('case-insensitive matching: story mentions `Customer Service`, decision scopeElementName=`customer-service` -> in-scope', () => {
    // Note: substring is raw; "customer-service" (with hyphen) is NOT a literal
    // substring of "Customer Service" (with space). The case-insensitive test
    // exercises the lowercase haystack/needle path -- match it on the path
    // entry which DOES contain the hyphenated form.
    const elementDecision: CapturedDecisionRefForCitationCheck = {
      decisionCode: 'cs.framework',
      scopeKind: 'element',
      scopeRefId: 'svc-1',
      scopeElementName: 'CUSTOMER-SERVICE', // uppercase needle
    };
    const response = makeGeneratedResponse({
      confidence: 'high',
      evidenceRefs: [],
      specText:
        '/agent-os:shape-spec Story about Customer Service follow-up work '.padEnd(260, ' '),
      affectedAreas: ['target/Customer-Service/src/Foo.java'],
    });

    expect(isDecisionInScopeForStory(elementDecision, response)).toBe(true);

    const result = computeMissingCitationWarning(response, [elementDecision]);
    expect(result.applied).toBe(true);
    expect((result.response.warnings[0] as Record<string, unknown>).missingDecisionCodes).toEqual([
      'cs.framework',
    ]);
  });

  it('element-scope decision with scopeElementName=null -> fail-open in-scope -> downgrade fires when uncited', () => {
    // Mirrors the handler fail-open path: when the inventory lookup returns
    // no name (deleted element or inventory fetch failed), the validator
    // conservatively treats the decision as in-scope.
    const elementDecisionMissingName: CapturedDecisionRefForCitationCheck = {
      decisionCode: 'ghost.decision',
      scopeKind: 'element',
      scopeRefId: 'svc-ghost',
      scopeElementName: null,
    };
    const response = makeGeneratedResponse({
      confidence: 'high',
      evidenceRefs: [],
    });

    expect(isDecisionInScopeForStory(elementDecisionMissingName, response)).toBe(true);

    const result = computeMissingCitationWarning(response, [elementDecisionMissingName]);
    expect(result.applied).toBe(true);
    expect((result.response.warnings[0] as Record<string, unknown>).missingDecisionCodes).toEqual([
      'ghost.decision',
    ]);
  });
});
