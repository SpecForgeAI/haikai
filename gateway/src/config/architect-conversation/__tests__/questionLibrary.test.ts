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
import {
  resolveBranchSubset,
  hasBranchList,
  languageBucketOf,
} from '../branchLists';
import {
  LOCKABLE_GROUP_B_CODES,
  API_SURFACE_MODES,
  DEFAULT_API_SURFACE_MODE,
  LOCKED_TREATMENT_MARKER,
} from '../apiSurfaceMode';
import type { RelevanceContext } from '../questionLibrary';

// ---------------------------------------------------------------------------
// Test 1 — Happy-path load: 51 entries with the expected group distribution.
// ---------------------------------------------------------------------------

describe('QUESTION_LIBRARY structure', () => {
  it('contains exactly 55 entries spread across groups A-J with the expected counts', () => {
    expect(QUESTION_LIBRARY).toHaveLength(55);

    const countsByGroup: Record<string, number> = {};
    for (const entry of QUESTION_LIBRARY) {
      countsByGroup[entry.group] = (countsByGroup[entry.group] || 0) + 1;
    }

    // A=6, B=6, C=6, D=4, E=5, F=5, G=5, H=5, I=5, J=4 per spec Appendix A;
    // C grew 6 -> 10 with the persistence-migration policy questions
    // (Spec 2026-07-02-a-target-inputs-and-pack-wiring).
    expect(countsByGroup).toEqual({
      A: 6,
      B: 6,
      C: 10,
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
      dependencyClass: 'independent',
      foundationalInputs: [],
      versioned: false,
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
      dependencyClass: 'independent',
      foundationalInputs: [],
      versioned: false,
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
    expect(library).toHaveLength(55);
  });

  it('no duplicate codes in the real library (sanity)', () => {
    const seen = new Set<string>();
    for (const entry of QUESTION_LIBRARY) {
      expect(seen.has(entry.code)).toBe(false);
      seen.add(entry.code);
    }
    expect(seen.size).toBe(55);
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

// ---------------------------------------------------------------------------
// Task Group 1 (Spec 2026-06-24-target-conversation-tech-stack-constraints) —
// the finalized per-question dependency matrix encoded as QuestionLibraryEntry
// metadata (FR1). The matrix is the authoritative artifact that drives runtime
// filtering. These tests assert the LOCKED tallies + invariants, NOT every one
// of the 51 rows individually (per tasks.md 1.1: keep to 2-8 tests).
// ---------------------------------------------------------------------------

describe('dependency matrix metadata (Spec 6 FR1)', () => {
  // The 24 codes that render the FR5 framework+version control (Spec
  // 2026-06-26 expanded the closed set from the original 7 to 24).
  const VERSIONED_CODES = [
    // original 7
    'service.language',
    'service.framework',
    'service.runtime',
    'db.engine',
    'db.driver',
    'ui.framework',
    'build.tool',
    // + 17 new (Spec 2026-06-26)
    'db.migrations',
    'db.connectionPool',
    'validation.framework',
    'domain.mappingStrategy',
    'logging.framework',
    'metrics.framework',
    'tracing.framework',
    'ui.buildTool',
    'ui.stateManagement',
    'ui.designSystem',
    'ui.testing',
    'testing.unit',
    'testing.integration',
    'testing.e2e',
    'testing.contractTesting',
    'testing.mocking',
    'interservice.asyncBus',
  ];

  // The LOCKED independent bucket called out in tasks.md 1.1 — these are
  // classified independent and must NEVER carry foundationalInputs.
  const LOCKED_INDEPENDENT_CODES = [
    'cutover.strategy',
    'cutover.dataMigration',
    'cutover.rollback',
    'cutover.parallelRunWindow',
    'api.auth',
    'api.rateLimiting',
    'secrets.management',
    'tracing.framework',
  ];

  it('every entry carries dependencyClass / foundationalInputs / versioned', () => {
    for (const entry of QUESTION_LIBRARY) {
      expect(['hard-dependent', 'grey', 'independent']).toContain(
        entry.dependencyClass
      );
      expect(Array.isArray(entry.foundationalInputs)).toBe(true);
      expect(typeof entry.versioned).toBe('boolean');
    }
  });

  it('the dependencyClass tally is exactly 15 hard-dependent / 9 grey / 31 independent', () => {
    const tally: Record<string, number> = {
      'hard-dependent': 0,
      grey: 0,
      independent: 0,
    };
    for (const entry of QUESTION_LIBRARY) {
      tally[entry.dependencyClass] += 1;
    }
    // independent grew 27 -> 31 with the four persistence-migration policy
    // questions (db.schemaMapping / db.extensions / db.jobsRehoming /
    // db.migrationWindow), all deliberately independent + non-versioned.
    expect(tally).toEqual({
      'hard-dependent': 15,
      grey: 9,
      independent: 31,
    });
  });

  it('db.engine and ui.framework are independent (freely-chosen branchers), NOT hard-dependent', () => {
    for (const code of ['db.engine', 'ui.framework']) {
      const entry = QUESTION_LIBRARY.find((e) => e.code === code)!;
      expect(entry).toBeDefined();
      expect(entry.dependencyClass).toBe('independent');
      expect(entry.foundationalInputs).toEqual([]);
      // They ARE versioned (each drives its group + renders the version control).
      expect(entry.versioned).toBe(true);
    }
  });

  it('the LOCKED independent bucket is class independent and never given foundationalInputs', () => {
    for (const code of LOCKED_INDEPENDENT_CODES) {
      const entry = QUESTION_LIBRARY.find((e) => e.code === code)!;
      expect(entry).toBeDefined();
      expect(entry.dependencyClass).toBe('independent');
      expect(entry.foundationalInputs).toEqual([]);
      // tracing.framework flipped to versioned in the Spec 2026-06-26 24-code
      // set; the rest of the LOCKED independent bucket stays version-less.
      expect(entry.versioned).toBe(code === 'tracing.framework');
    }
    // And, generally, EVERY independent row has an empty foundationalInputs.
    for (const entry of QUESTION_LIBRARY) {
      if (entry.dependencyClass === 'independent') {
        expect(entry.foundationalInputs).toEqual([]);
      }
    }
  });

  it('the versioned set is EXACTLY the 24 framework/version codes', () => {
    const versioned = QUESTION_LIBRARY.filter((e) => e.versioned).map(
      (e) => e.code
    );
    expect(new Set(versioned)).toEqual(new Set(VERSIONED_CODES));
    expect(versioned).toHaveLength(VERSIONED_CODES.length);
  });

  it('a representative hard/grey row names a real foundational code', () => {
    // service.framework (H) keys off service.language; service.healthcheck (G)
    // keys off service.framework; db.driver (H) keys off db.engine. Every named
    // foundational code resolves to a real library entry.
    const allCodes = new Set(QUESTION_LIBRARY.map((e) => e.code));
    const framework = QUESTION_LIBRARY.find((e) => e.code === 'service.framework')!;
    expect(framework.dependencyClass).toBe('hard-dependent');
    expect(framework.foundationalInputs).toContain('service.language');

    const healthcheck = QUESTION_LIBRARY.find(
      (e) => e.code === 'service.healthcheck'
    )!;
    expect(healthcheck.dependencyClass).toBe('grey');
    expect(healthcheck.foundationalInputs.length).toBeGreaterThan(0);

    // Every hard/grey row (except the primary brancher service.language) names
    // at least one foundational input, and every named input resolves.
    for (const entry of QUESTION_LIBRARY) {
      if (entry.dependencyClass !== 'independent' && entry.code !== 'service.language') {
        expect(entry.foundationalInputs.length).toBeGreaterThan(0);
      }
      for (const fi of entry.foundationalInputs) {
        expect(allCodes.has(fi)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Task Group 2 (Spec 6) — deterministic branch-lists + compatibility matrix +
// loader-time FR1 validation. PURE DATA on this path (no LLM). Keep to 2-8
// tests per tasks.md 2.1.
// ---------------------------------------------------------------------------

describe('deterministic branch-lists (Spec 6 FR2)', () => {
  it('LOCKED worked example: service.language="Java 21" narrows service.framework to JVM-only', () => {
    const subset = resolveBranchSubset('service.framework', {
      'service.language': 'Java 21',
    });
    expect(subset).toBeDefined();
    const set = new Set(subset!);
    // Only the three JVM frameworks are offered.
    expect(set).toEqual(new Set(['Spring Boot', 'Quarkus', 'Micronaut']));
    // And FastAPI / NestJS / Gin / ASP.NET are EXCLUDED.
    for (const excluded of ['FastAPI', 'NestJS', 'Gin', 'ASP.NET']) {
      expect(set.has(excluded)).toBe(false);
    }
  });

  it('Micronaut is present in the real service.framework choices (LOCKED example precondition)', () => {
    const framework = QUESTION_LIBRARY.find((e) => e.code === 'service.framework')!;
    expect(framework.choices).toContain('Micronaut');
    // Every branch-list subset is a real subset of the question choices.
    const jvm = resolveBranchSubset('service.framework', { 'service.language': 'Java 21' })!;
    for (const choice of jvm) {
      expect(framework.choices).toContain(choice);
    }
  });

  it('an unrecognised foundational answer yields the FULL set (fail-open, no silent narrowing)', () => {
    expect(languageBucketOf('Some Exotic Lang 9')).toBeUndefined();
    // No recognised bucket => resolver returns undefined => caller offers all.
    expect(
      resolveBranchSubset('service.framework', { 'service.language': 'Some Exotic Lang 9' })
    ).toBeUndefined();
    // A code with no branch-list at all also returns undefined.
    expect(hasBranchList('cutover.strategy')).toBe(false);
    expect(resolveBranchSubset('cutover.strategy', {})).toBeUndefined();
  });
});

describe('validateQuestionLibrary — FR1 dependency-matrix validation', () => {
  it('the real library produces ZERO new FR1 errors (regression guard)', () => {
    const errors = validateQuestionLibrary(QUESTION_LIBRARY);
    const fr1 = errors.filter((e) =>
      [
        'unknown-dependency-class',
        'unresolved-foundational-input',
        'missing-branch-or-matrix-coverage',
      ].includes(e.kind)
    );
    expect(fr1).toEqual([]);
    // Every hard/grey entry is covered by a branch-list OR a matrix rule.
  });

  it('flags an unknown dependencyClass', () => {
    const tampered: QuestionLibrary = [
      ...QUESTION_LIBRARY,
      {
        ...QUESTION_LIBRARY[0],
        code: 'synthetic.bad.class',
        dependencyClass: 'mystery' as unknown as QuestionLibraryEntry['dependencyClass'],
      } as QuestionLibraryEntry,
    ];
    const errors = validateQuestionLibrary(tampered);
    const hit = errors.filter((e) => e.kind === 'unknown-dependency-class');
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({
      kind: 'unknown-dependency-class',
      ownerCode: 'synthetic.bad.class',
      offendingValue: 'mystery',
    });
  });

  it('flags a foundationalInputs code that does not resolve to a real entry', () => {
    const tamperedEntry: QuestionLibraryEntry = {
      ...QUESTION_LIBRARY.find((e) => e.code === 'service.framework')!,
      code: 'synthetic.bad.foundational',
      dependencyClass: 'grey',
      foundationalInputs: ['does.not.exist'],
    };
    const tampered: QuestionLibrary = [...QUESTION_LIBRARY, tamperedEntry];
    const errors = validateQuestionLibrary(tampered);
    const hit = errors.filter((e) => e.kind === 'unresolved-foundational-input');
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({
      kind: 'unresolved-foundational-input',
      ownerCode: 'synthetic.bad.foundational',
      missingCode: 'does.not.exist',
    });
  });

  it('flags a hard-dependent / grey entry with NO branch-list or matrix coverage', () => {
    const tamperedEntry: QuestionLibraryEntry = {
      ...QUESTION_LIBRARY[0],
      code: 'synthetic.uncovered',
      dependencyClass: 'hard-dependent',
      foundationalInputs: ['service.language'],
    };
    const tampered: QuestionLibrary = [...QUESTION_LIBRARY, tamperedEntry];
    const errors = validateQuestionLibrary(tampered);
    const hit = errors.filter(
      (e) =>
        e.kind === 'missing-branch-or-matrix-coverage' &&
        e.ownerCode === 'synthetic.uncovered'
    );
    expect(hit).toHaveLength(1);
    // The combined loader throws on this structured error.
    expect(() => {
      const e = validateQuestionLibrary(tampered);
      if (e.length > 0) {
        throw new Error('Architect-conversation config validation failed');
      }
    }).toThrow(/validation failed/);
  });
});


// ---------------------------------------------------------------------------
// Task Group 7 (Spec 6) — API like-for-like lock matrix metadata (FR9 / FR1
// `L` treatment). EXACTLY the six Group B codes carry `lockableFromSource:
// true`; each STILL records its underlying H/I/G class (the `L` treatment is a
// RUNTIME supersession, it does not erase the base class). Keep to 2-8 tests.
// ---------------------------------------------------------------------------

describe('api like-for-like lock metadata (Spec 6 FR9)', () => {
  const GROUP_B_CODES = [
    'api.protocol',
    'api.versioning',
    'api.contractFormat',
    'api.auth',
    'api.errorContract',
    'api.rateLimiting',
  ];

  it('EXACTLY the six Group B codes carry lockableFromSource: true; every other code is false/absent', () => {
    const lockable = QUESTION_LIBRARY.filter((e) => e.lockableFromSource === true).map(
      (e) => e.code,
    );
    expect(new Set(lockable)).toEqual(new Set(GROUP_B_CODES));
    expect(lockable).toHaveLength(6);

    // Every non-Group-B entry is false or absent (never true).
    for (const entry of QUESTION_LIBRARY) {
      if (!GROUP_B_CODES.includes(entry.code)) {
        expect(entry.lockableFromSource === true).toBe(false);
      }
    }
  });

  it('the matrix lockable set matches the shared LOCKABLE_GROUP_B_CODES source-of-truth', () => {
    const lockable = QUESTION_LIBRARY.filter((e) => e.lockableFromSource === true).map(
      (e) => e.code,
    );
    expect(new Set(lockable)).toEqual(new Set(LOCKABLE_GROUP_B_CODES));
  });

  it('each lockable Group B row STILL records its underlying H/I/G dependencyClass (L supersedes, does not erase)', () => {
    // The underlying classes per spec.md Group B: api.protocol=I, api.versioning=G,
    // api.contractFormat=H, api.auth=I, api.errorContract=G, api.rateLimiting=I.
    const expectedBaseClass: Record<string, string> = {
      'api.protocol': 'independent',
      'api.versioning': 'grey',
      'api.contractFormat': 'hard-dependent',
      'api.auth': 'independent',
      'api.errorContract': 'grey',
      'api.rateLimiting': 'independent',
    };
    for (const code of GROUP_B_CODES) {
      const entry = QUESTION_LIBRARY.find((e) => e.code === code)!;
      expect(entry).toBeDefined();
      // The L treatment is NOT a dependencyClass — the base class is intact.
      expect(entry.dependencyClass).toBe(expectedBaseClass[code]);
      expect(['hard-dependent', 'grey', 'independent']).toContain(
        entry.dependencyClass,
      );
    }
  });

  it('the shared api.surfaceMode closed set + the locked marker are well-formed', () => {
    expect(new Set(API_SURFACE_MODES)).toEqual(
      new Set(['like_for_like', 'may_change']),
    );
    expect(DEFAULT_API_SURFACE_MODE).toBe('like_for_like');
    expect(LOCKED_TREATMENT_MARKER).toBe('locked');
  });
});

// ---------------------------------------------------------------------------
// Spec 2026-06-26-target-conversation-versioned-answer-bare-stem-ux, Task Group 1
// — the versioned set expands from 7 to 24 codes, and every cascade trigger map
// + every downstream seed targeting a versioned code is re-keyed from laden
// strings to BARE STEMS. Keep to a small focused set per tasks.md 1.1.
// ---------------------------------------------------------------------------

describe('bare-stem question library (Spec 2026-06-26, Task Group 1)', () => {
  const VERSIONED_24 = [
    // original 7
    'service.language', 'service.framework', 'service.runtime', 'db.engine',
    'db.driver', 'ui.framework', 'build.tool',
    // + 17 new (Spec 2026-06-26)
    'db.migrations', 'db.connectionPool', 'validation.framework',
    'domain.mappingStrategy', 'logging.framework', 'metrics.framework',
    'tracing.framework', 'ui.buildTool', 'ui.stateManagement', 'ui.designSystem',
    'ui.testing', 'testing.unit', 'testing.integration', 'testing.e2e',
    'testing.contractTesting', 'testing.mocking', 'interservice.asyncBus',
  ];

  function cascadeOf(ownerCode: string, decisionCode: string) {
    const owner = QUESTION_LIBRARY.find((e) => e.code === ownerCode)!;
    const cascade = owner.cascades.find((c) => c.decisionCode === decisionCode)!;
    expect(cascade).toBeDefined();
    return cascade;
  }

  it('versioned: true is set on EXACTLY the closed set of 24 codes (7 original + 17 new)', () => {
    const versioned = QUESTION_LIBRARY.filter((e) => e.versioned).map((e) => e.code);
    expect(new Set(versioned)).toEqual(new Set(VERSIONED_24));
    expect(versioned).toHaveLength(24);
    expect(VERSIONED_24).toHaveLength(24);
  });

  it('cascade valueByTriggerValue maps are keyed by BARE STEMS, not laden version strings', () => {
    // service.language -> service.runtime is keyed by the bare language stem.
    const runtime = cascadeOf('service.language', 'service.runtime');
    expect(Object.keys(runtime.valueByTriggerValue)).toContain('Java');
    expect(Object.keys(runtime.valueByTriggerValue)).not.toContain('Java 21');
    expect(Object.keys(runtime.valueByTriggerValue)).not.toContain('Java 17');

    // service.framework -> logging.framework is keyed by the bare framework stem.
    const logging = cascadeOf('service.framework', 'logging.framework');
    expect(Object.keys(logging.valueByTriggerValue)).toContain('Spring Boot');
    expect(Object.keys(logging.valueByTriggerValue)).not.toContain('Spring Boot 3.4');

    // interservice.asyncBus (flipped to versioned) re-keyed 'Kafka 3.7' -> 'Kafka'.
    const msg = cascadeOf('interservice.asyncBus', 'interservice.messageFormat');
    expect(Object.keys(msg.valueByTriggerValue)).toContain('Kafka');
    expect(Object.keys(msg.valueByTriggerValue)).not.toContain('Kafka 3.7');
  });

  it('downstream SEED VALUES targeting versioned codes are re-keyed to bare stems', () => {
    // service.language -> service.runtime seeds the bare runtime stem.
    expect(cascadeOf('service.language', 'service.runtime').valueByTriggerValue['Java'])
      .toBe('Eclipse Temurin');
    // -> testing.unit seeds the bare unit-test stem.
    expect(cascadeOf('service.language', 'testing.unit').valueByTriggerValue['Java'])
      .toBe('JUnit');
    // -> build.tool seeds the bare build-tool stem (the gateway half of the
    // doubled Maven 3.9 / Maven 3.9 envelope fix: a cascaded value is the stem).
    expect(cascadeOf('service.language', 'build.tool').valueByTriggerValue['Java'])
      .toBe('Gradle');
    // db.engine -> db.migrations seeds the bare migrations stem.
    expect(cascadeOf('db.engine', 'db.migrations').valueByTriggerValue['Postgres'])
      .toBe('Flyway');
  });

  it('none of the re-keyed laden trigger strings remain in any cascade map', () => {
    // 'Node 20 LTS' / 'Go 1.22 alpine' legitimately have NO trailing version to
    // strip, so they stay; the strings below were explicitly re-keyed to stems.
    const FORBIDDEN_LADEN_KEYS = [
      'Java 21', 'Java 17', 'Kotlin 2.0', 'TypeScript/Node 20', 'Python 3.12',
      'Go 1.22', 'C# 12', 'Spring Boot 3.4', 'Quarkus 3', 'NestJS 10',
      'FastAPI 0.115', 'Postgres 18', 'MySQL 8.4', 'MS SQL Server 2022',
      'Oracle 23ai', 'Sybase ASE 16', 'MongoDB 7', 'Eclipse Temurin 21',
      'GraalVM 21', 'React 18', 'Vue 3', 'Angular 17', 'Kafka 3.7', 'RabbitMQ 3.13',
    ];
    const offenders: string[] = [];
    for (const entry of QUESTION_LIBRARY) {
      for (const cascade of entry.cascades) {
        for (const key of Object.keys(cascade.valueByTriggerValue)) {
          if (FORBIDDEN_LADEN_KEYS.includes(key)) {
            offenders.push(`${entry.code} -> ${cascade.decisionCode}: '${key}'`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
