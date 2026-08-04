/**
 * Execution-class unification (Spec 2026-08-04-1): ONE classifier decides
 * automated (IVS) vs manual (human) for every book-of-work item, honouring
 * the canonical tag plus all three legacy mechanisms.
 */
import {
  MANUAL_EXECUTION_TAG,
  executionClassForItem,
  isManualExecutionItem,
} from '../services/migrationExecutionClass';

describe('executionClassForItem', () => {
  it('canonical execution:manual tag → manual', () => {
    expect(executionClassForItem({ tags: [MANUAL_EXECUTION_TAG] })).toBe('manual');
  });

  it('legacy code-stream manual-gate tag → manual', () => {
    expect(
      executionClassForItem({ tags: ['provenance:plan-deterministic', 'execution:manual-gate'] })
    ).toBe('manual');
  });

  it('db-pack review shape (pack-provenance without carriage tag) → manual', () => {
    expect(
      executionClassForItem({ tags: ['provenance:pack', 'pack:p-1', 'stream:x'] })
    ).toBe('manual');
  });

  it('db-pack verbatim carriage story → automated', () => {
    expect(
      executionClassForItem({ tags: ['provenance:pack', 'pack:p-1', 'seed_db_pack_files'] })
    ).toBe('automated');
  });

  it('rewrite-in-app pack story → automated (real implementation work)', () => {
    expect(
      executionClassForItem({ tags: ['provenance:pack', 'pack:p-1', 'rewrite_in_app'] })
    ).toBe('automated');
  });

  it('prerequisite gate → manual', () => {
    expect(executionClassForItem({ tags: ['provenance:prerequisite'] })).toBe('manual');
  });

  it('structural-gap story (pack + prerequisite tags) → manual', () => {
    expect(
      executionClassForItem({
        tags: ['provenance:pack', 'pack:p-1', 'stream:s', 'provenance:prerequisite'],
      })
    ).toBe('manual');
  });

  it('plain code/deterministic stories → automated', () => {
    expect(executionClassForItem({ tags: ['provenance:plan-deterministic'] })).toBe('automated');
    expect(executionClassForItem({ tags: [] })).toBe('automated');
    expect(executionClassForItem({})).toBe('automated');
    expect(executionClassForItem({ tags: null })).toBe('automated');
  });

  it('isManualExecutionItem mirrors the classifier', () => {
    expect(isManualExecutionItem({ tags: [MANUAL_EXECUTION_TAG] })).toBe(true);
    expect(isManualExecutionItem({ tags: ['seed_db_pack_files', 'provenance:pack'] })).toBe(false);
  });
});
