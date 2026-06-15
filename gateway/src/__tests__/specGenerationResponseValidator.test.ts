/**
 * SpecGenerationResponse hand-rolled validator -- tests.
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 4: Hand-Rolled Response Validator.
 *
 * Verifies `assertSpecGenerationResponse(payload)` against:
 *   - All three Group 2 fixtures (generated / insufficient_context / failed)
 *     validating as { ok: true } (happy paths)
 *   - The five negative cases enumerated in the user's task prompt:
 *       1. missing specText when status='generated'
 *       2. specText that does not start with `/agent-os:shape-spec`
 *       3. missing missingInputs when status='insufficient_context'
 *       4. unknown status value
 *       5. non-array warnings
 *
 * Validator pattern: hand-rolled per A-4, mirrors the precedent in
 * `generatedMigrationBookOfWorkSchema.ts` (Spec 1).
 */

import * as fs from 'fs';
import * as path from 'path';
import { assertSpecGenerationResponse } from '../services/specGenerationResponseValidator';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

function loadFixture(filename: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('assertSpecGenerationResponse (Spec 2026-05-19, Task Group 4)', () => {
  // -------------------------------------------------------------------------
  // Happy paths -- three Group 2 fixtures validate as ok
  // -------------------------------------------------------------------------

  it('validates the llm-output-generated.json fixture (status=generated)', () => {
    const fixture = loadFixture('llm-output-generated.json');
    const result = assertSpecGenerationResponse(fixture);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('generated');
      // Generated branch has confidence + specText
      if (
        result.value.status === 'generated' ||
        result.value.status === 'generated_with_warnings'
      ) {
        expect(result.value.confidence).toBe('high');
        expect(result.value.specText.startsWith('/agent-os:shape-spec')).toBe(
          true
        );
        expect(result.value.affectedAreas.length).toBeGreaterThan(0);
      }
    }
  });

  it('validates the llm-output-insufficient-context.json fixture (status=insufficient_context)', () => {
    const fixture = loadFixture('llm-output-insufficient-context.json');
    const result = assertSpecGenerationResponse(fixture);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('insufficient_context');
      if (result.value.status === 'insufficient_context') {
        expect(Array.isArray(result.value.missingInputs)).toBe(true);
        expect(result.value.missingInputs.length).toBeGreaterThan(0);
        expect(typeof result.value.reason).toBe('string');
        expect(typeof result.value.recommendedNextAction).toBe('string');
      }
    }
  });

  it('validates the llm-output-failed.json fixture (status=failed)', () => {
    const fixture = loadFixture('llm-output-failed.json');
    const result = assertSpecGenerationResponse(fixture);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('failed');
      if (result.value.status === 'failed') {
        expect(typeof result.value.errorMessage).toBe('string');
        expect(result.value.errorMessage.length).toBeGreaterThan(0);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Negative cases
  // -------------------------------------------------------------------------

  it('rejects a status=generated payload missing specText', () => {
    const fixture = loadFixture('llm-output-generated.json');
    delete (fixture as Record<string, unknown>).specText;

    const result = assertSpecGenerationResponse(fixture);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /specText/.test(e))).toBe(true);
    }
  });

  it("rejects a status=generated payload whose specText does not start with '/agent-os:shape-spec'", () => {
    const fixture = loadFixture('llm-output-generated.json');
    fixture.specText =
      'This is a spec body that does NOT start with the required prefix and exceeds the actionable-length floor by being very long indeed. '
        .repeat(5);

    const result = assertSpecGenerationResponse(fixture);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) =>
          /must start with the literal "\/agent-os:shape-spec"/.test(e)
        )
      ).toBe(true);
    }
  });

  it('rejects a status=insufficient_context payload with empty missingInputs[]', () => {
    const fixture = loadFixture('llm-output-insufficient-context.json');
    fixture.missingInputs = [];

    const result = assertSpecGenerationResponse(fixture);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) =>
          /missingInputs must be a non-empty array/.test(e)
        )
      ).toBe(true);
    }
  });

  it('rejects an unknown status value', () => {
    const payload = {
      status: 'mystery_status',
      errorMessage: 'whatever',
    };

    const result = assertSpecGenerationResponse(payload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /status must be one of/.test(e))).toBe(
        true
      );
    }
  });

  it('rejects a status=generated payload where warnings is not an array', () => {
    const fixture = loadFixture('llm-output-generated.json');
    fixture.warnings = { not: 'an array' };

    const result = assertSpecGenerationResponse(fixture);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => /warnings must be an array/.test(e))
      ).toBe(true);
    }
  });

  it('rejects a status=failed payload missing errorMessage', () => {
    const payload = {
      status: 'failed',
    };

    const result = assertSpecGenerationResponse(payload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) =>
          /failed\.errorMessage must be a non-empty string/.test(e)
        )
      ).toBe(true);
    }
  });

  it('rejects a status=generated payload that is too short with no affectedAreas/tests (actionable-detail rule)', () => {
    const payload = {
      status: 'generated',
      confidence: 'high',
      // specText starts with the required prefix but is short AND empty arrays below
      specText: '/agent-os:shape-spec brief',
      warnings: [],
      evidenceRefs: [],
      assumptions: [],
      tests: [],
      affectedAreas: [],
    };

    const result = assertSpecGenerationResponse(payload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) =>
          /specText must reference actionable scope/.test(e)
        )
      ).toBe(true);
    }
  });

  it('validates a non-fixture status=generated_with_warnings payload (the second valid generated status value)', () => {
    const fixture = loadFixture('llm-output-generated.json');
    fixture.status = 'generated_with_warnings';
    (fixture as Record<string, unknown>).warnings = [
      {
        code: 'CONFIDENCE_DOWNGRADED',
        from: 'high',
        to: 'medium',
        missingSignals: ['baselines'],
      },
    ];

    const result = assertSpecGenerationResponse(fixture);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('generated_with_warnings');
    }
  });
});
