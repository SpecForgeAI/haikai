/**
 * Tests — Tech-Stack Pre-fill Response Validator
 * Spec 2026-05-25 Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write, Task Group 2.
 *
 * Per tasks.md §2.1 — validator-side tests:
 *   - rejects hallucinated `decisionCode` not in library
 *   - rejects missing or non-contained `sourceQuote`
 *   - rejects duplicate `decisionCode` entries
 *   - rejects `decisionCode` that appears in both lists
 *   - happy path produces a typed PreFillResponse
 */

import {
  assertPreFillResponse,
  looseContains,
} from '../techStackPrefillResponseValidator';

const ORG_MARKDOWN = `# Organisation Standards

## Backend
- Language: Java 21 (LTS)
- Framework: Spring Boot 3.4
- Build: Gradle 8

## Database
- Engine: Postgres 16
`;

const PROJECT_MARKDOWN = `# Project Standards (Alpha)

## Backend
- Language: Java 21
- Logging: SLF4J + Logback JSON

## Frontend
- React 18
`;

const LIBRARY_CODES = new Set([
  'service.language',
  'service.framework',
  'build.tool',
  'db.engine',
  'logging.framework',
  'ui.framework',
  'api.protocol',
]);

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('happy path: valid response with mixed org/project sources passes validation', () => {
  const payload = {
    preFilledAnswers: [
      {
        decisionCode: 'service.language',
        value: 'Java 21',
        sourceQuote: 'Language: Java 21',
        sourceFile: 'project',
      },
      {
        decisionCode: 'service.framework',
        value: 'Spring Boot 3.4',
        sourceQuote: 'Framework: Spring Boot 3.4',
        sourceFile: 'organisation',
      },
    ],
    unmatchedCodes: ['api.protocol'],
    summary: 'Matched 2 of 3 questions.',
  };

  const result = assertPreFillResponse(payload, LIBRARY_CODES, ORG_MARKDOWN, PROJECT_MARKDOWN);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.preFilledAnswers).toHaveLength(2);
    expect(result.value.preFilledAnswers[0].sourceFile).toBe('project');
    expect(result.value.preFilledAnswers[1].sourceFile).toBe('organisation');
    expect(result.value.unmatchedCodes).toEqual(['api.protocol']);
  }
});

// ---------------------------------------------------------------------------
// Hallucinated decisionCode
// ---------------------------------------------------------------------------

test('rejects hallucinated decisionCode that is not present in the question library', () => {
  const payload = {
    preFilledAnswers: [
      {
        decisionCode: 'service.notARealCode',
        value: 'Quantum',
        sourceQuote: 'Language: Java 21',
        sourceFile: 'organisation',
      },
    ],
    unmatchedCodes: [],
    summary: 'Hallucinated test.',
  };

  const result = assertPreFillResponse(payload, LIBRARY_CODES, ORG_MARKDOWN, PROJECT_MARKDOWN);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.includes('not present in the question library'))).toBe(
      true,
    );
  }
});

// ---------------------------------------------------------------------------
// Missing sourceQuote
// ---------------------------------------------------------------------------

test('rejects pre-fill answer with empty sourceQuote', () => {
  const payload = {
    preFilledAnswers: [
      {
        decisionCode: 'service.language',
        value: 'Java 21',
        sourceQuote: '',
        sourceFile: 'organisation',
      },
    ],
    unmatchedCodes: [],
    summary: 'Missing source quote.',
  };

  const result = assertPreFillResponse(payload, LIBRARY_CODES, ORG_MARKDOWN, PROJECT_MARKDOWN);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.includes('sourceQuote'))).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Non-contained sourceQuote
// ---------------------------------------------------------------------------

test('rejects pre-fill answer whose sourceQuote does not appear in either markdown', () => {
  const payload = {
    preFilledAnswers: [
      {
        decisionCode: 'service.language',
        value: 'Java 21',
        sourceQuote: 'COBOL on the mainframe',
        sourceFile: 'organisation',
      },
    ],
    unmatchedCodes: [],
    summary: 'Source quote fabricated.',
  };

  const result = assertPreFillResponse(payload, LIBRARY_CODES, ORG_MARKDOWN, PROJECT_MARKDOWN);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(
      result.errors.some((e) => e.includes('does not appear in either')),
    ).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Duplicate decisionCode
// ---------------------------------------------------------------------------

test('rejects payload with the same decisionCode listed twice in preFilledAnswers', () => {
  const payload = {
    preFilledAnswers: [
      {
        decisionCode: 'service.language',
        value: 'Java 21',
        sourceQuote: 'Language: Java 21',
        sourceFile: 'project',
      },
      {
        decisionCode: 'service.language',
        value: 'Java 17',
        sourceQuote: 'Language: Java 21',
        sourceFile: 'organisation',
      },
    ],
    unmatchedCodes: [],
    summary: 'Duplicates.',
  };

  const result = assertPreFillResponse(payload, LIBRARY_CODES, ORG_MARKDOWN, PROJECT_MARKDOWN);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.includes('appears more than once'))).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Code appears in both lists
// ---------------------------------------------------------------------------

test('rejects payload where the same decisionCode is in both preFilledAnswers and unmatchedCodes', () => {
  const payload = {
    preFilledAnswers: [
      {
        decisionCode: 'service.language',
        value: 'Java 21',
        sourceQuote: 'Language: Java 21',
        sourceFile: 'project',
      },
    ],
    unmatchedCodes: ['service.language'],
    summary: 'Conflicting lists.',
  };

  const result = assertPreFillResponse(payload, LIBRARY_CODES, ORG_MARKDOWN, PROJECT_MARKDOWN);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.includes('also appears in unmatchedCodes'))).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Invalid sourceFile value
// ---------------------------------------------------------------------------

test('rejects sourceFile values other than organisation or project', () => {
  const payload = {
    preFilledAnswers: [
      {
        decisionCode: 'service.language',
        value: 'Java 21',
        sourceQuote: 'Language: Java 21',
        sourceFile: 'global',
      },
    ],
    unmatchedCodes: [],
    summary: 'Bad source-file enum.',
  };
  const result = assertPreFillResponse(payload, LIBRARY_CODES, ORG_MARKDOWN, PROJECT_MARKDOWN);
  expect(result.ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Loose contains-check is whitespace-tolerant
// ---------------------------------------------------------------------------

test('looseContains tolerates whitespace drift between needle and haystack', () => {
  expect(looseContains('Java   21', 'Language: Java 21')).toBe(true);
  expect(looseContains('Java\n21', 'Language: Java 21')).toBe(true);
  expect(looseContains('Java 21', null)).toBe(false);
  expect(looseContains('', 'Language: Java 21')).toBe(false);
});
