/**
 * Execution-class unification (Spec 2026-08-04-1) — frontend mirror tests.
 *
 * Mirrors the gateway's `src/__tests__/migrationExecutionClass.test.ts` case
 * for case: the classifier here MUST stay behaviourally identical to
 * `gateway/src/services/migrationExecutionClass.ts` (the oracle deciding
 * automated-vs-manual for every book-of-work item).
 */

import { describe, it, expect } from 'vitest';

import {
  MANUAL_EXECUTION_TAG,
  executionClassForTags,
  isManualExecutionTags,
} from './executionClass';

describe('executionClassForTags', () => {
  it('canonical execution:manual tag → manual', () => {
    expect(executionClassForTags([MANUAL_EXECUTION_TAG])).toBe('manual');
  });

  it('legacy code-stream manual-gate tag → manual', () => {
    expect(
      executionClassForTags(['provenance:plan-deterministic', 'execution:manual-gate']),
    ).toBe('manual');
  });

  it('db-pack review shape (pack-provenance without carriage tag) → manual', () => {
    expect(executionClassForTags(['provenance:pack', 'pack:p-1', 'stream:x'])).toBe(
      'manual',
    );
  });

  it('db-pack verbatim carriage story → automated', () => {
    expect(
      executionClassForTags(['provenance:pack', 'pack:p-1', 'seed_db_pack_files']),
    ).toBe('automated');
  });

  it('rewrite-in-app pack story → automated (real implementation work)', () => {
    expect(
      executionClassForTags(['provenance:pack', 'pack:p-1', 'rewrite_in_app']),
    ).toBe('automated');
  });

  it('prerequisite gate → manual', () => {
    expect(executionClassForTags(['provenance:prerequisite'])).toBe('manual');
  });

  it('structural-gap story (pack + prerequisite tags) → manual', () => {
    expect(
      executionClassForTags([
        'provenance:pack',
        'pack:p-1',
        'stream:s',
        'provenance:prerequisite',
      ]),
    ).toBe('manual');
  });

  it('plain code/deterministic stories → automated', () => {
    expect(executionClassForTags(['provenance:plan-deterministic'])).toBe('automated');
    expect(executionClassForTags([])).toBe('automated');
    expect(executionClassForTags(undefined)).toBe('automated');
    expect(executionClassForTags(null)).toBe('automated');
  });

  it('isManualExecutionTags mirrors the classifier', () => {
    expect(isManualExecutionTags([MANUAL_EXECUTION_TAG])).toBe(true);
    expect(isManualExecutionTags(['seed_db_pack_files', 'provenance:pack'])).toBe(
      false,
    );
  });
});
