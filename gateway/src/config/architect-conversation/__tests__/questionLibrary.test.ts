/**
 * Tests — Architect-Conversation Question Library Loader + Validation
 * Spec 2026-05-24-target-state-architect-conversation, Task Group 1.
 *
 * Per tasks.md §1.1 — 4-8 focused backend tests, exhaustive per-entry
 * assertions deliberately skipped.
 */

import {
  QUESTION_LIBRARY,
  QuestionLibrary,
  QuestionLibraryEntry,
  ScopeRefType,
} from '../questionLibrary';
import {
  MAPPING_MUTATION_RULES,
  MappingMutationRule,
  MappingMutationRules,
  V1_MUTATION_CASE_CODES,
} from '../mappingMutationRules';
import {
  ALLOWED_MAPPING_TYPE_CHANGES,
  ALLOWED_SCOPE_REF_TYPES,
  loadAndValidateArchitectConversationConfigs,
  validateMappingMutationRules,
  validateQuestionLibrary,
} from '../loadConfigs';
import { evaluateRelevance } from '../../../services/architectConversation/relevanceEvaluator';
import type { RelevanceContext } from '../questionLibrary';

// ---------------------------------------------------------------------------
// Test 1 — Happy-path load: 51 entries with the expected group distribution.
// ---------------------------------------------------------------------------

describe('QUESTION_LIBRARY structure', () => {
  it('contains exactly 51 entries spread across groups A-J with the expected counts', () => {
    expect(QUESTION_LIBRARY).toHaveLength(51);

    const countsByGroup: Record<string, number> = {};
    for (const entry of QUESTION_LIBRARY) {
      countsByGroup[entry.group] = (countsByGroup[entry.group] || 0) + 1;
    }

    // A=6, B=6, C=6, D=4, E=5, F=5, G=5, H=5, I=5, J=4 per spec Appendix A
    expect(countsByGroup).toEqual({
      A: 6,
      B: 6,
      C: 6,
      D: 4,
      E: 5,
      F: 5,
      G: 5,
      H: 5,
      I: 5,
      J: 4,
    });
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Validator rejects a library with duplicate codes.
// ---------------------------------------------------------------------------

describe('validateQuestionLibrary — duplicate codes', () => {
  it('flags duplicate codes; the real library has none', () => {
    // Real library: no duplicates.
    const baseErrors = validateQuestionLibrary(QUESTION_LIBRARY);
    expect(
      baseErrors.filter((e) => e.kind === 'duplicate-code')
    ).toHaveLength(0);

    // Synthetic library: clone with a duplicate code.
    const tampered: QuestionLibrary = [
      ...QUESTION_LIBRARY,
      { ...QUESTION_LIBRARY[0] } as QuestionLibraryEntry,
    ];

    const errors = validateQuestionLibrary(tampered);
    const dupErrors = errors.filter((e) => e.kind === 'duplicate-code');
    expect(dupErrors).toHaveLength(1);
    expect(dupErrors[0]).toEqual({
      kind: 'duplicate-code',
      code: QUESTION_LIBRARY[0].code,
    });
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Validator rejects an unresolved cascade decisionCode.
// ---------------------------------------------------------------------------

describe('validateQuestionLibrary — cascade reference resolution', () => {
  it('every cascade decisionCode in the real library resolves; synthetic missing refs are flagged', () => {
    const baseErrors = validateQuestionLibrary(QUESTION_LIBRARY);
    expect(
      baseErrors.filter((e) => e.kind === 'unresolved-cascade-ref')
    ).toHaveLength(0);

    // Synthetic library: inject an entry whose cascade points at a phantom code.
    const tamperedEntry: QuestionLibraryEntry = {
      code: 'synthetic.test.entry',
      group: 'A',
      orderInGroup: 99,
      prompt: 'synthetic',
      expectedAnswerShape: 'single-choice',
      choices: ['x'],
      defaultsWhenUnchanged: 'x',
      cascades: [
        {
          decisionCode: 'does.not.exist',
          valueByTriggerValue: { x: 'y' },
          sourceStandardId: 'std.test.v1',
        },
      ],
      allowedExceptionScopes: ['service'],
    };

    const tampered: QuestionLibrary = [...QUESTION_LIBRARY, tamperedEntry];
    const errors = validateQuestionLibrary(tampered);
    const refErrors = errors.filter(
      (e) => e.kind === 'unresolved-cascade-ref'
    );
    expect(refErrors).toHaveLength(1);
    expect(refErrors[0]).toEqual({
      kind: 'unresolved-cascade-ref',
      ownerCode: 'synthetic.test.entry',
      missingCode: 'does.not.exist',
    });
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Validator rejects `allowedExceptionScopes` values outside the
// Q12 closed set.
// ---------------------------------------------------------------------------

describe('validateQuestionLibrary — scope_ref_type closed set', () => {
  it('every allowedExceptionScopes value in the real library is in the closed set; synthetic offenders are flagged', () => {
    // Real library: every scope must be in the closed set.
    for (const entry of QUESTION_LIBRARY) {
      for (const scope of entry.allowedExceptionScopes) {
        expect(ALLOWED_SCOPE_REF_TYPES).toContain(scope);
      }
    }
    const baseErrors = validateQuestionLibrary(QUESTION_LIBRARY);
    expect(
      baseErrors.filter((e) => e.kind === 'invalid-scope-ref-type')
    ).toHaveLength(0);

    // Synthetic library: inject a forbidden scope value.
    const tamperedEntry: QuestionLibraryEntry = {
      code: 'synthetic.bad.scope',
      group: 'A',
      orderInGroup: 99,
      prompt: 'synthetic',
      expectedAnswerShape: 'free-text',
      defaultsWhenUnchanged: 'x',
      cascades: [],
      // Cast to bypass compile-time closed-set check — emulates a config
      // hand-edit that drifts away from the closed set.
      allowedExceptionScopes: ['system' as unknown as ScopeRefType],
    };
    const tampered: QuestionLibrary = [...QUESTION_LIBRARY, tamperedEntry];
    const errors = validateQuestionLibrary(tampered);
    const scopeErrors = errors.filter(
      (e) => e.kind === 'invalid-scope-ref-type'
    );
    expect(scopeErrors).toHaveLength(1);
    expect(scopeErrors[0]).toEqual({
      kind: 'invalid-scope-ref-type',
      ownerCode: 'synthetic.bad.scope',
      offendingScope: 'system',
    });
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Relevance predicates are callable functions that return booleans.
// Group E (Frontend) entries skip when hasUiTier=false; all other entries
// are always-relevant (no predicate).
// ---------------------------------------------------------------------------

describe('QUESTION_LIBRARY — relevance predicates', () => {
  it('Group E predicates evaluate to false when no UI screens, true when present; other groups have no predicate', () => {
    const groupE = QUESTION_LIBRARY.filter((e) => e.group === 'E');
    expect(groupE.length).toBeGreaterThan(0);

    for (const entry of groupE) {
      expect(typeof entry.relevanceCondition).toBe('function');
      const fn = entry.relevanceCondition!;
      expect(fn({ hasUiTier: false, hasServiceTier: true, hasPersistenceTier: true })).toBe(false);
      expect(fn({ hasUiTier: true, hasServiceTier: true, hasPersistenceTier: true })).toBe(true);
    }

    // Spot-check a few generic (F/G/I/J) entries default to always-relevant
    // (no predicate). NOTE: A/B/C/D are now tier-tagged, so they are no
    // longer valid 'ungated' spot-checks.
    const codesExpectedToHaveNoPredicate = [
      'logging.framework', // F
      'build.tool', // G
      'testing.unit', // I
      'cutover.strategy', // J
    ];
    for (const code of codesExpectedToHaveNoPredicate) {
      const entry = QUESTION_LIBRARY.find((e) => e.code === code);
      expect(entry).toBeDefined();
      expect(entry!.relevanceCondition).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Mapping mutation rules reference only library codes; all
// `defaultMappingTypeChange` values are in the closed set; v1 mutation cases
// match the 4 spec-named codes.
// ---------------------------------------------------------------------------

describe('MAPPING_MUTATION_RULES + validateMappingMutationRules', () => {
  it('covers every library code, every mapping_type is in the closed set, and synthetic offenders are flagged', () => {
    // Every library code has a rule.
    for (const entry of QUESTION_LIBRARY) {
      expect(MAPPING_MUTATION_RULES[entry.code]).toBeDefined();
    }

    // Every defaultMappingTypeChange is in the closed set.
    for (const [, rule] of Object.entries(MAPPING_MUTATION_RULES)) {
      expect(ALLOWED_MAPPING_TYPE_CHANGES).toContain(
        rule.defaultMappingTypeChange
      );
    }

    // v1 mutation cases are exactly the 4 spec-named codes.
    expect(new Set(V1_MUTATION_CASE_CODES)).toEqual(
      new Set([
        'db.engine',
        'api.protocol',
        'service.framework',
        'service.language',
      ])
    );
    expect(MAPPING_MUTATION_RULES['db.engine'].defaultMappingTypeChange).toBe(
      'keep-equivalent'
    );
    expect(
      MAPPING_MUTATION_RULES['api.protocol'].defaultMappingTypeChange
    ).toBe('replaced_by');
    expect(
      MAPPING_MUTATION_RULES['service.framework'].defaultMappingTypeChange
    ).toBe('keep-equivalent');
    expect(
      MAPPING_MUTATION_RULES['service.language'].defaultMappingTypeChange
    ).toBe('keep-equivalent');

    // Real rules + real library => no errors.
    const baseErrors = validateMappingMutationRules(
      MAPPING_MUTATION_RULES,
      QUESTION_LIBRARY
    );
    expect(baseErrors).toEqual([]);

    // Synthetic: rules map containing an unknown decision code AND an invalid
    // mapping_type value.
    const tamperedRules: MappingMutationRules = {
      ...MAPPING_MUTATION_RULES,
      'phantom.decision.code': {
        affectedTableSets: [],
        defaultMappingTypeChange: 'none',
        scopeBoundary: 'parent-not-leaf',
      },
      'service.framework': {
        affectedTableSets: ['service'],
        defaultMappingTypeChange:
          'reshaped' as unknown as MappingMutationRule['defaultMappingTypeChange'],
        scopeBoundary: 'parent-not-leaf',
      },
    };
    const errors = validateMappingMutationRules(
      tamperedRules,
      QUESTION_LIBRARY
    );
    expect(
      errors.some(
        (e) =>
          e.kind === 'mutation-rule-references-unknown-code' &&
          e.decisionCode === 'phantom.decision.code'
      )
    ).toBe(true);
    expect(
      errors.some(
        (e) =>
          e.kind === 'mutation-rule-invalid-mapping-type' &&
          e.decisionCode === 'service.framework' &&
          e.offendingValue === 'reshaped'
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 7 — Happy-path combined loader returns the validated configs and
// throws on any synthetic validation failure.
// ---------------------------------------------------------------------------

describe('loadAndValidateArchitectConversationConfigs', () => {
  it('returns both configs cleanly when the real library + rules are valid', () => {
    const { library, rules } = loadAndValidateArchitectConversationConfigs();
    expect(library).toBe(QUESTION_LIBRARY);
    expect(rules).toBe(MAPPING_MUTATION_RULES);
    expect(library).toHaveLength(51);
  });

  it('no duplicate codes in the real library (sanity)', () => {
    const seen = new Set<string>();
    for (const entry of QUESTION_LIBRARY) {
      expect(seen.has(entry.code)).toBe(false);
      seen.add(entry.code);
    }
    expect(seen.size).toBe(51);
  });
});

// ---------------------------------------------------------------------------
// Test 8 (Spec 2026-06-05-architect-tier-gating, Task Group 1) — tier gating.
//
// The A-J library is classified by TECHNOLOGY tier (UI / Service / Persistence):
//   - Service:     A, B, D, H -> onlyWhenServiceTier
//   - Persistence: C          -> onlyWhenPersistenceTier
//   - UI:          E          -> onlyWhenUiTier (folds in former hasUiScreens)
//   - Generic:     F, G, I, J -> ALWAYS asked (no relevanceCondition)
// A group is skipped ONLY when its tier flag is confirmed false. Asserted both
// at the predicate level and through the real evaluateRelevance machinery.
// ---------------------------------------------------------------------------

const SERVICE_GROUPS = new Set(['A', 'B', 'D', 'H']);
const PERSISTENCE_GROUPS = new Set(['C']);
const UI_GROUPS = new Set(['E']);
const GENERIC_GROUPS = new Set(['F', 'G', 'I', 'J']);

const allTrue: RelevanceContext = {
  hasUiTier: true,
  hasServiceTier: true,
  hasPersistenceTier: true,
};

/** Is `entry` asked under `ctx`, per the real evaluator? */
function isAsked(code: string, ctx: RelevanceContext): boolean {
  const entry = QUESTION_LIBRARY.find((e) => e.code === code)!;
  return evaluateRelevance(entry, ctx).relevant;
}

describe('architect tier-gating — predicates', () => {
  it('each tier predicate returns true ONLY when its own flag is true', () => {
    // Pull the live predicates straight off a tagged entry per group so we test
    // the actual functions wired into the library (not re-declared copies).
    const servicePred = QUESTION_LIBRARY.find((e) => e.code === 'service.language')!
      .relevanceCondition!;
    const persistPred = QUESTION_LIBRARY.find((e) => e.code === 'db.engine')!
      .relevanceCondition!;
    const uiPred = QUESTION_LIBRARY.find((e) => e.code === 'ui.framework')!
      .relevanceCondition!;

    expect(servicePred({ ...allTrue, hasServiceTier: true })).toBe(true);
    expect(servicePred({ ...allTrue, hasServiceTier: false })).toBe(false);

    expect(persistPred({ ...allTrue, hasPersistenceTier: true })).toBe(true);
    expect(persistPred({ ...allTrue, hasPersistenceTier: false })).toBe(false);

    expect(uiPred({ ...allTrue, hasUiTier: true })).toBe(true);
    expect(uiPred({ ...allTrue, hasUiTier: false })).toBe(false);

    // Cross-tier independence: flipping a different tier must NOT flip the
    // predicate (the Service predicate ignores hasUiTier / hasPersistenceTier).
    expect(servicePred({ hasUiTier: false, hasServiceTier: true, hasPersistenceTier: false })).toBe(true);
  });
});

describe('architect tier-gating — group classification', () => {
  it('every A/B/D/H entry is Service-tagged, every C entry Persistence-tagged, every E entry UI-tagged, and F/G/I/J are ungated', () => {
    for (const entry of QUESTION_LIBRARY) {
      if (SERVICE_GROUPS.has(entry.group)) {
        // Service predicate: false iff hasServiceTier=false (with others true).
        expect(typeof entry.relevanceCondition).toBe('function');
        expect(entry.relevanceCondition!({ ...allTrue, hasServiceTier: false })).toBe(false);
        expect(entry.relevanceCondition!({ ...allTrue, hasUiTier: false, hasPersistenceTier: false })).toBe(true);
      } else if (PERSISTENCE_GROUPS.has(entry.group)) {
        expect(typeof entry.relevanceCondition).toBe('function');
        expect(entry.relevanceCondition!({ ...allTrue, hasPersistenceTier: false })).toBe(false);
        expect(entry.relevanceCondition!({ ...allTrue, hasUiTier: false, hasServiceTier: false })).toBe(true);
      } else if (UI_GROUPS.has(entry.group)) {
        expect(typeof entry.relevanceCondition).toBe('function');
        expect(entry.relevanceCondition!({ ...allTrue, hasUiTier: false })).toBe(false);
        expect(entry.relevanceCondition!({ ...allTrue, hasServiceTier: false, hasPersistenceTier: false })).toBe(true);
      } else {
        // Generic (F/G/I/J): no predicate at all.
        expect(GENERIC_GROUPS.has(entry.group)).toBe(true);
        expect(entry.relevanceCondition).toBeUndefined();
      }
    }
  });
});

describe('architect tier-gating — evaluateRelevance skip behaviour', () => {
  it('Service-tier ABSENT skips A/B/D/H but still asks E/C/generic', () => {
    const ctx: RelevanceContext = { hasUiTier: true, hasServiceTier: false, hasPersistenceTier: true };
    expect(isAsked('service.language', ctx)).toBe(false); // A
    expect(isAsked('api.protocol', ctx)).toBe(false); // B
    expect(isAsked('dto.style', ctx)).toBe(false); // D
    expect(isAsked('interservice.syncProtocol', ctx)).toBe(false); // H
    // Other tiers untouched:
    expect(isAsked('db.engine', ctx)).toBe(true); // C (persistence present)
    expect(isAsked('ui.framework', ctx)).toBe(true); // E (ui present)
    expect(isAsked('logging.framework', ctx)).toBe(true); // F generic
  });

  it('Persistence-tier ABSENT skips C only (of the gated tiers)', () => {
    const ctx: RelevanceContext = { hasUiTier: true, hasServiceTier: true, hasPersistenceTier: false };
    expect(isAsked('db.engine', ctx)).toBe(false); // C
    expect(isAsked('db.driver', ctx)).toBe(false); // C
    expect(isAsked('service.language', ctx)).toBe(true); // A still asked
    expect(isAsked('ui.framework', ctx)).toBe(true); // E still asked
  });

  it('UI-tier ABSENT skips E (the folded former hasUiScreens=false behaviour)', () => {
    const ctx: RelevanceContext = { hasUiTier: false, hasServiceTier: true, hasPersistenceTier: true };
    for (const e of QUESTION_LIBRARY.filter((x) => x.group === 'E')) {
      expect(isAsked(e.code, ctx)).toBe(false);
    }
    // Folded equivalence: hasUiTier reproduces the old hasUiScreens gate — every
    // Group E entry is asked when hasUiTier=true and skipped when false, and no
    // non-E group is affected by the UI flag.
    const uiPresent: RelevanceContext = { hasUiTier: true, hasServiceTier: true, hasPersistenceTier: true };
    for (const e of QUESTION_LIBRARY.filter((x) => x.group === 'E')) {
      expect(isAsked(e.code, uiPresent)).toBe(true);
    }
    expect(isAsked('service.language', ctx)).toBe(true);
    expect(isAsked('db.engine', ctx)).toBe(true);
  });

  it('F/G/I/J are ALWAYS asked regardless of any tier flag combination', () => {
    const generics = ['logging.framework', 'build.tool', 'testing.unit', 'cutover.strategy'];
    const combos: RelevanceContext[] = [
      { hasUiTier: false, hasServiceTier: false, hasPersistenceTier: false },
      { hasUiTier: true, hasServiceTier: false, hasPersistenceTier: false },
      { hasUiTier: false, hasServiceTier: true, hasPersistenceTier: false },
      { hasUiTier: false, hasServiceTier: false, hasPersistenceTier: true },
      allTrue,
    ];
    for (const code of generics) {
      for (const ctx of combos) {
        expect(isAsked(code, ctx)).toBe(true);
      }
    }
  });
});
