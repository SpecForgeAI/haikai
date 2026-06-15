/**
 * SpecGenerationResponse validator -- structured tests + coveredEndpointIds.
 *
 * Spec: 2026-06-14 Implementation-Ready Migration Spec Generation (Spec 1 of 4)
 * Task Group 2.1 -- validator enrichment tests.
 *
 * Verifies the widened Generated branch:
 *   - `tests` is now a structured array of { title, description, type } where
 *     type is constrained to 'unit' | 'functional' (D6).
 *   - `coveredEndpointIds` is a string[] that MAY be empty (D9, non-endpoint
 *     stories emit []).
 *
 * The validator is hand-rolled (A-4); no LLM is exercised here.
 */

import {
  assertSpecGenerationResponse,
  STRUCTURED_TEST_TYPE_VALUES,
} from '../services/specGenerationResponseValidator';

function baseGenerated(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    status: 'generated',
    confidence: 'high',
    specText:
      '/agent-os:shape-spec Implement Customer Lookup API Compatibility\n\n' +
      'Feature summary: rehome the legacy operation as a like-for-like split. ' +
      'The body is intentionally long enough to clear the actionable-length floor.',
    warnings: [],
    evidenceRefs: [{ type: 'architecture_element_mapping', id: 'm-1' }],
    assumptions: ['Target service owns the customer domain.'],
    tests: [
      {
        title: 'GET /customers/{id} returns 200 for a known id',
        description:
          'Given a seeded active customer, the endpoint returns the documented schema.',
        type: 'functional',
      },
      {
        title: 'CustomerLookupService maps row to DTO',
        description: 'Unit-level mapping of a DB row to the Customer DTO.',
        type: 'unit',
      },
    ],
    coveredEndpointIds: ['55555555-5555-5555-5555-5555bbbb2004'],
    affectedAreas: ['target/customer-service/src/main/java/CustomerController.java'],
    ...overrides,
  };
}

describe('SpecGenerationResponse structured tests + coveredEndpointIds (Spec 2026-06-14, Task Group 2)', () => {
  it('exports the allowed structured-test type values as exactly unit|functional', () => {
    expect([...STRUCTURED_TEST_TYPE_VALUES].sort()).toEqual([
      'functional',
      'unit',
    ]);
  });

  it('accepts a well-formed structured tests array + non-empty coveredEndpointIds', () => {
    const result = assertSpecGenerationResponse(baseGenerated());
    expect(result.ok).toBe(true);
    if (result.ok && result.value.status === 'generated') {
      expect(result.value.tests).toHaveLength(2);
      expect(result.value.tests[0].type).toBe('functional');
      expect(result.value.coveredEndpointIds).toEqual([
        '55555555-5555-5555-5555-5555bbbb2004',
      ]);
    }
  });

  it('accepts an EMPTY coveredEndpointIds array (non-endpoint story, D9)', () => {
    const result = assertSpecGenerationResponse(
      baseGenerated({ coveredEndpointIds: [] })
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.value.status === 'generated') {
      expect(result.value.coveredEndpointIds).toEqual([]);
    }
  });

  it('rejects a tests entry missing title or description', () => {
    const result = assertSpecGenerationResponse(
      baseGenerated({
        tests: [{ description: 'no title here', type: 'unit' }],
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /tests\[0\]\.title/.test(e))).toBe(true);
    }
  });

  it("rejects a tests entry whose type is outside unit|functional (e.g. 'integration')", () => {
    const result = assertSpecGenerationResponse(
      baseGenerated({
        tests: [
          {
            title: 'broad integration test',
            description: 'spans services',
            type: 'integration',
          },
        ],
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /tests\[0\]\.type/.test(e))).toBe(true);
    }
  });

  it('rejects a legacy string[] tests payload (contract widened to objects)', () => {
    const result = assertSpecGenerationResponse(
      baseGenerated({ tests: ['Contract test', 'Reconciliation replay'] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /tests\[0\]/.test(e))).toBe(true);
    }
  });

  it('rejects a non-string coveredEndpointIds member', () => {
    const result = assertSpecGenerationResponse(
      baseGenerated({ coveredEndpointIds: ['ok', 42] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => /coveredEndpointIds/.test(e))
      ).toBe(true);
    }
  });

  it('rejects coveredEndpointIds that is not an array', () => {
    const result = assertSpecGenerationResponse(
      baseGenerated({ coveredEndpointIds: 'not-an-array' })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => /coveredEndpointIds/.test(e))
      ).toBe(true);
    }
  });
});
