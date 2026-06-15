/**
 * Tests for the Item N2 safety-net validator extension
 * (`computeUnreferencedCitedDecisionWarning`).
 *
 * Sibling to the Spec 2026-05-25 missing-decision-citation extension covered
 * by `specGenerationResponseValidatorDecisionCitation.test.ts`. Where that
 * extension fires when a story cites ZERO captured decisions (and downgrades
 * confidence), N2 fires when a story DID cite captured decisions but the
 * verbatim `answerValue` of one or more cited decisions does not appear in
 * `specText` (paraphrased or ignored verbatim-quote rule).
 *
 * Key invariants exercised below:
 *   - Warning-only signal -- confidence is NEVER downgraded.
 *   - Per-decision granularity -- the warning carries the list of
 *     decision-codes whose value is missing, NOT a single flag.
 *   - Pure function -- input response object is not mutated.
 *   - Same-identity return on the no-op path (handler relies on that).
 *
 * Three required test cases per the brief:
 *   (a) Happy path -- cited value IS in specText.
 *   (b) Defect path -- cited value NOT in specText (paraphrase / 'Postgres' vs 'PostgreSQL').
 *   (c) Multiple decisions, mixed -- one in specText, one not.
 *
 * Plus supplementary cases that lock in edge-case behaviour the handler
 * relies on (empty decisions list, no citations at all, non-string id, etc).
 */

import {
  computeUnreferencedCitedDecisionWarning,
  GeneratedShapeSpecResponseA,
  CapturedDecisionRefForCitationCheck,
  UnreferencedCitedDecisionWarning,
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
    specText:
      '/agent-os:shape-spec ' +
      'Story scope: migrate the order-history service. '.repeat(6),
    warnings: [],
    evidenceRefs: [],
    assumptions: [],
    tests: [{ title: 't-1', description: 'Unit test t-1.', type: 'unit' }],
    coveredEndpointIds: [],
    affectedAreas: ['module-a'],
    ...overrides,
  };
}

const DB_ENGINE_DECISION: CapturedDecisionRefForCitationCheck = {
  decisionCode: 'db.engine',
  answerValue: 'PostgreSQL',
};
const SERVICE_FRAMEWORK_DECISION: CapturedDecisionRefForCitationCheck = {
  decisionCode: 'service.framework',
  answerValue: 'Spring Boot 3',
};

const DECISIONS: CapturedDecisionRefForCitationCheck[] = [
  DB_ENGINE_DECISION,
  SERVICE_FRAMEWORK_DECISION,
];

describe('shape-spec validator extension -- captured-decision value not in specText (Item N2)', () => {
  it('(a) happy path: cited decision value IS in specText -> no warning, no change', () => {
    const response = makeGeneratedResponse({
      confidence: 'high',
      specText:
        '/agent-os:shape-spec Story scope: migrate to PostgreSQL on RDS. ' +
        'Schema migrations gated behind a feature flag. '.repeat(6),
      evidenceRefs: [{ type: 'captured_decision', id: 'db.engine' }],
    });

    const result = computeUnreferencedCitedDecisionWarning(response, DECISIONS);

    expect(result.applied).toBe(false);
    // Same identity on no-op path.
    expect(result.response).toBe(response);
    // No mutation.
    expect(response.warnings).toEqual([]);
    expect(response.confidence).toBe('high');
  });

  it("(b) defect path: cited value NOT in specText ('Postgres' rephrased from 'PostgreSQL') -> warning appended, confidence unchanged", () => {
    const response = makeGeneratedResponse({
      confidence: 'high',
      specText:
        '/agent-os:shape-spec Story scope: migrate the catalog to Postgres on RDS. ' +
        'Schema migrations gated behind a feature flag. '.repeat(6),
      evidenceRefs: [{ type: 'captured_decision', id: 'db.engine' }],
    });

    const result = computeUnreferencedCitedDecisionWarning(response, DECISIONS);

    expect(result.applied).toBe(true);
    // Returned object is a NEW identity.
    expect(result.response).not.toBe(response);
    // Confidence MUST NOT be downgraded -- warning-only signal.
    expect(result.response.confidence).toBe('high');
    // Exactly one warning appended.
    expect(result.response.warnings.length).toBe(1);
    const warning = result.response.warnings[0] as UnreferencedCitedDecisionWarning;
    expect(warning.kind).toBe('captured_decision_value_not_in_spec_text');
    expect(warning.missingDecisionCodes).toEqual(['db.engine']);
    expect(warning.recommendedNextAction).toBe(
      'verify spec text references the cited decision values'
    );
    // Input response not mutated.
    expect(response.warnings).toEqual([]);
  });

  it('(c) multiple decisions, mixed: one value in specText, the other not -> warning lists only the missing one', () => {
    const response = makeGeneratedResponse({
      confidence: 'medium',
      // specText mentions Spring Boot 3 verbatim but says 'Postgres' instead of 'PostgreSQL'.
      specText:
        '/agent-os:shape-spec Story scope: migrate the order service to Spring Boot 3 ' +
        'backed by Postgres on RDS. Schema migrations gated behind a feature flag. '.repeat(4),
      evidenceRefs: [
        { type: 'captured_decision', id: 'db.engine' },
        { type: 'captured_decision', id: 'service.framework' },
      ],
    });

    const result = computeUnreferencedCitedDecisionWarning(response, DECISIONS);

    expect(result.applied).toBe(true);
    expect(result.response.confidence).toBe('medium'); // no downgrade
    expect(result.response.warnings.length).toBe(1);
    const warning = result.response.warnings[0] as UnreferencedCitedDecisionWarning;
    expect(warning.kind).toBe('captured_decision_value_not_in_spec_text');
    expect(warning.missingDecisionCodes).toEqual(['db.engine']);
    // The cited-AND-found decision is NOT in the missing list.
    expect(warning.missingDecisionCodes).not.toContain('service.framework');
  });

  // ---- supplementary edge cases ----

  it('no-op when capturedDecisions is empty', () => {
    const response = makeGeneratedResponse({
      evidenceRefs: [{ type: 'captured_decision', id: 'db.engine' }],
    });
    const result = computeUnreferencedCitedDecisionWarning(response, []);
    expect(result.applied).toBe(false);
    expect(result.response).toBe(response);
  });

  it('no-op when the story cites no captured decisions at all (different signal handled elsewhere)', () => {
    const response = makeGeneratedResponse({
      // Only a discovery_finding citation -- no captured_decision refs.
      evidenceRefs: [{ type: 'discovery_finding', id: 'f-1' }],
    });
    const result = computeUnreferencedCitedDecisionWarning(response, DECISIONS);
    expect(result.applied).toBe(false);
    expect(result.response).toBe(response);
  });

  it('no-op when the cited decision-code does not resolve to a known decision', () => {
    const response = makeGeneratedResponse({
      evidenceRefs: [
        { type: 'captured_decision', id: 'unknown.decision.code' },
      ],
    });
    const result = computeUnreferencedCitedDecisionWarning(response, DECISIONS);
    // Unresolved citations are a different problem -- out of scope for N2.
    expect(result.applied).toBe(false);
    expect(result.response).toBe(response);
  });

  it('no-op when the resolved decision has an empty answerValue (nothing verbatim to check)', () => {
    const decisionsWithEmptyValue: CapturedDecisionRefForCitationCheck[] = [
      { decisionCode: 'db.engine', answerValue: '' },
    ];
    const response = makeGeneratedResponse({
      evidenceRefs: [{ type: 'captured_decision', id: 'db.engine' }],
    });
    const result = computeUnreferencedCitedDecisionWarning(
      response,
      decisionsWithEmptyValue
    );
    expect(result.applied).toBe(false);
    expect(result.response).toBe(response);
  });

  it('substring match is case-sensitive ("PostgreSQL" in specText != "postgresql" in specText)', () => {
    const response = makeGeneratedResponse({
      specText:
        '/agent-os:shape-spec Story scope: migrate the catalog to postgresql on RDS. ' +
        'Schema migrations gated behind a feature flag. '.repeat(6),
      evidenceRefs: [{ type: 'captured_decision', id: 'db.engine' }],
    });
    const result = computeUnreferencedCitedDecisionWarning(response, DECISIONS);
    expect(result.applied).toBe(true);
    const warning = result.response.warnings[0] as UnreferencedCitedDecisionWarning;
    expect(warning.missingDecisionCodes).toEqual(['db.engine']);
  });

  it('repeat citations of the same decision-code are deduped in the missing list', () => {
    const response = makeGeneratedResponse({
      specText:
        '/agent-os:shape-spec Story scope: migrate the catalog to Postgres on RDS. ' +
        'Schema migrations gated behind a feature flag. '.repeat(6),
      evidenceRefs: [
        { type: 'captured_decision', id: 'db.engine' },
        { type: 'captured_decision', id: 'db.engine' },
      ],
    });
    const result = computeUnreferencedCitedDecisionWarning(response, DECISIONS);
    expect(result.applied).toBe(true);
    const warning = result.response.warnings[0] as UnreferencedCitedDecisionWarning;
    expect(warning.missingDecisionCodes).toEqual(['db.engine']);
  });

  it('augmented response preserves pre-existing warnings and appends N2 warning at the end', () => {
    const preExisting: Record<string, unknown> = {
      kind: 'missing_decision_citation',
      recommendedNextAction: 'review and add decision codes',
    };
    const response = makeGeneratedResponse({
      warnings: [preExisting],
      specText:
        '/agent-os:shape-spec Story scope: migrate the catalog to Postgres on RDS. ' +
        'Schema migrations gated behind a feature flag. '.repeat(6),
      evidenceRefs: [{ type: 'captured_decision', id: 'db.engine' }],
    });
    const result = computeUnreferencedCitedDecisionWarning(response, DECISIONS);
    expect(result.applied).toBe(true);
    expect(result.response.warnings.length).toBe(2);
    expect(result.response.warnings[0]).toEqual(preExisting);
    expect(
      (result.response.warnings[1] as UnreferencedCitedDecisionWarning).kind
    ).toBe('captured_decision_value_not_in_spec_text');
    // Input warnings array not mutated.
    expect(response.warnings.length).toBe(1);
  });
});
