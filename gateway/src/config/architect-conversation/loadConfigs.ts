/**
 * Loader + Validation — Target State Architect-Persona Conversation (Spec 3, Commit 1)
 *
 * Spec: 2026-05-24-target-state-architect-conversation
 *
 * Loader-time validation of the question library + mapping mutation rules.
 *
 * Per spec §"Question library config":
 * - No duplicate `code` values
 * - Every cascade entry's `decisionCode` resolves to a real library entry
 * - Every `allowedExceptionScopes` value is in the Q12 closed set
 * - Every `relevanceCondition` (where present) is a function
 *
 * Per spec §"Mapping mutation rules config":
 * - Every key in the rules map references a real library entry
 * - Every `defaultMappingTypeChange` is in the closed set
 *
 * The validators return structured error lists. The loader-time entry point
 * (`loadAndValidateArchitectConversationConfigs`) throws on any failure so a
 * misconfiguration is caught at startup or first import, not at request time.
 *
 * IMPORTANT: This file is config + validation only. No orchestration.
 */

import {
  ALLOWED_SCOPE_REF_TYPES,
  QUESTION_LIBRARY,
  QuestionLibrary,
  QuestionLibraryEntry,
  ScopeRefType,
} from './questionLibrary';
import {
  MAPPING_MUTATION_RULES,
  MappingMutationRules,
  MappingTypeChange,
} from './mappingMutationRules';
import { hasBranchList } from './branchLists';
import { hasCompatibilityRule } from './compatibilityMatrix';

// ---------------------------------------------------------------------------
// Closed sets (exported for downstream consumers + tests)
// ---------------------------------------------------------------------------

/**
 * The closed `scope_ref_type` set per Q12. Re-exported from
 * `questionLibrary.ts` (which derives it from `scopeRefType.json` per spec
 * 2026-05-26-low-priority-mechanical-cleanups #14) so the orchestration
 * code, the exception sub-dialog, and tests all share the single source of
 * truth.
 */
export { ALLOWED_SCOPE_REF_TYPES } from './questionLibrary';

/**
 * The closed `mapping_type` change set per F2. Mirrors the union type in
 * `mappingMutationRules.ts` — exported for the validator and tests.
 */
export const ALLOWED_MAPPING_TYPE_CHANGES: readonly MappingTypeChange[] = [
  'none',
  'keep-equivalent',
  'replaced_by',
  'renamed',
  'merged',
  'split',
];

// ---------------------------------------------------------------------------
// Structured validation errors
// ---------------------------------------------------------------------------

export type ValidationError =
  | { kind: 'duplicate-code'; code: string }
  | { kind: 'unresolved-cascade-ref'; ownerCode: string; missingCode: string }
  | {
      kind: 'invalid-scope-ref-type';
      ownerCode: string;
      offendingScope: string;
    }
  | { kind: 'relevance-condition-not-function'; ownerCode: string }
  | {
      kind: 'mutation-rule-references-unknown-code';
      decisionCode: string;
    }
  | {
      kind: 'mutation-rule-invalid-mapping-type';
      decisionCode: string;
      offendingValue: string;
    }
  | {
      kind: 'mutation-rule-missing-for-library-code';
      decisionCode: string;
    }
  // --- Spec 2026-06-24-target-conversation-tech-stack-constraints (FR1 validation) ---
  | { kind: 'unknown-dependency-class'; ownerCode: string; offendingValue: string }
  | {
      kind: 'unresolved-foundational-input';
      ownerCode: string;
      missingCode: string;
    }
  | { kind: 'missing-branch-or-matrix-coverage'; ownerCode: string };

// ---------------------------------------------------------------------------
// Question library validator
// ---------------------------------------------------------------------------

/**
 * Validates a question library. Returns an array of structured errors —
 * empty means the library is valid.
 */
export function validateQuestionLibrary(
  library: QuestionLibrary
): ValidationError[] {
  const errors: ValidationError[] = [];
  const seenCodes = new Set<string>();
  const allCodes = new Set<string>();

  for (const entry of library) {
    allCodes.add(entry.code);
  }

  for (const entry of library) {
    // Duplicate code detection (insertion order).
    if (seenCodes.has(entry.code)) {
      errors.push({ kind: 'duplicate-code', code: entry.code });
    }
    seenCodes.add(entry.code);

    // Relevance condition must be callable when present.
    if (
      entry.relevanceCondition !== undefined &&
      typeof entry.relevanceCondition !== 'function'
    ) {
      errors.push({
        kind: 'relevance-condition-not-function',
        ownerCode: entry.code,
      });
    }

    // Allowed exception scopes must all be in the closed Q12 set.
    for (const scope of entry.allowedExceptionScopes) {
      if (!ALLOWED_SCOPE_REF_TYPES.includes(scope as ScopeRefType)) {
        errors.push({
          kind: 'invalid-scope-ref-type',
          ownerCode: entry.code,
          offendingScope: String(scope),
        });
      }
    }

    // Every cascade decisionCode must resolve to a real library entry.
    for (const cascade of entry.cascades) {
      if (!allCodes.has(cascade.decisionCode)) {
        errors.push({
          kind: 'unresolved-cascade-ref',
          ownerCode: entry.code,
          missingCode: cascade.decisionCode,
        });
      }
    }

    // --- Dependency-matrix metadata validation (Spec 6 FR1) ---

    // dependencyClass must be one of the known enum values.
    const KNOWN_DEPENDENCY_CLASSES = ['hard-dependent', 'grey', 'independent'];
    if (!KNOWN_DEPENDENCY_CLASSES.includes(entry.dependencyClass)) {
      errors.push({
        kind: 'unknown-dependency-class',
        ownerCode: entry.code,
        offendingValue: String(entry.dependencyClass),
      });
    }

    // Every foundationalInputs code must resolve to a real library entry.
    for (const fic of entry.foundationalInputs) {
      if (!allCodes.has(fic)) {
        errors.push({
          kind: 'unresolved-foundational-input',
          ownerCode: entry.code,
          missingCode: fic,
        });
      }
    }

    // Every hard-dependent / grey entry that KEYS ON a foundational input must
    // have deterministic coverage: a branch-list (hard-dependent) OR a
    // compatibility-matrix rule (grey). A branch-list also satisfies a grey
    // entry. Entries with NO foundationalInputs are the primary/sub-foundational
    // branchers (e.g. `service.language`) -- narrowed by nothing, so they need
    // no branch-list. Independent entries need none either.
    if (
      (entry.dependencyClass === 'hard-dependent' ||
        entry.dependencyClass === 'grey') &&
      entry.foundationalInputs.length > 0
    ) {
      const covered =
        hasBranchList(entry.code) || hasCompatibilityRule(entry.code);
      if (!covered) {
        errors.push({
          kind: 'missing-branch-or-matrix-coverage',
          ownerCode: entry.code,
        });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Mapping mutation rules validator
// ---------------------------------------------------------------------------

/**
 * Validates the mapping mutation rules against the question library. Returns
 * an array of structured errors — empty means the rules are valid.
 *
 * Checks:
 * - Every rule key references a real library entry.
 * - Every `defaultMappingTypeChange` is in `ALLOWED_MAPPING_TYPE_CHANGES`.
 * - Every library entry has a corresponding rule (so the orchestrator never
 *   sees an undefined lookup for any of the 51 codes).
 */
export function validateMappingMutationRules(
  rules: MappingMutationRules,
  library: QuestionLibrary
): ValidationError[] {
  const errors: ValidationError[] = [];
  const libraryCodes = new Set<string>(library.map((e) => e.code));

  for (const [decisionCode, rule] of Object.entries(rules)) {
    if (!libraryCodes.has(decisionCode)) {
      errors.push({
        kind: 'mutation-rule-references-unknown-code',
        decisionCode,
      });
    }
    if (
      !ALLOWED_MAPPING_TYPE_CHANGES.includes(
        rule.defaultMappingTypeChange as MappingTypeChange
      )
    ) {
      errors.push({
        kind: 'mutation-rule-invalid-mapping-type',
        decisionCode,
        offendingValue: String(rule.defaultMappingTypeChange),
      });
    }
  }

  // Every library code must have a rule (notes-only counts).
  const ruleKeys = new Set<string>(Object.keys(rules));
  for (const code of libraryCodes) {
    if (!ruleKeys.has(code)) {
      errors.push({
        kind: 'mutation-rule-missing-for-library-code',
        decisionCode: code,
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Combined loader entry point
// ---------------------------------------------------------------------------

/**
 * Loader-time entry point. Validates both configs and throws if any errors
 * are found. Returns the validated configs on success.
 *
 * Safe to call repeatedly; both configs are module-level frozen constants.
 */
export function loadAndValidateArchitectConversationConfigs(): {
  library: QuestionLibrary;
  rules: MappingMutationRules;
} {
  const libraryErrors = validateQuestionLibrary(QUESTION_LIBRARY);
  const rulesErrors = validateMappingMutationRules(
    MAPPING_MUTATION_RULES,
    QUESTION_LIBRARY
  );
  const allErrors = [...libraryErrors, ...rulesErrors];

  if (allErrors.length > 0) {
    const summary = allErrors
      .map((err) => JSON.stringify(err))
      .join('\n  - ');
    throw new Error(
      `Architect-conversation config validation failed:\n  - ${summary}`
    );
  }

  return {
    library: QUESTION_LIBRARY,
    rules: MAPPING_MUTATION_RULES,
  };
}

/**
 * Re-export of the canonical entry for callers that just want the validated
 * library + rules without throwing themselves. Cached at module init.
 */
export const ARCHITECT_CONVERSATION_CONFIGS =
  loadAndValidateArchitectConversationConfigs();
