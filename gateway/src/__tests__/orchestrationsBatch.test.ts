/**
 * Tests for batch-mode validation on POST /api/v2/jobs/orchestrations.
 *
 * Batch feature (2026-06-26): the gateway accepts >1 spec_intents only when a
 * non-empty `batch_name` is supplied (coupled batch -> single branch + single
 * merge request). Multi-spec without batch_name stays a 400; single-spec is
 * unchanged.
 *
 * Unit-tests the exported validator directly — the route maps its string
 * return value into a 400 envelope, so the validator is the contract.
 */

import { validateCreateJobRequest } from '../routes/orchestrations';

const intent = (name: string) => ({ spec_name: name });

describe('validateCreateJobRequest — batch mode', () => {
  it('accepts a single spec with no batch_name (unchanged behaviour)', () => {
    expect(
      validateCreateJobRequest({
        company: 'Acme',
        project: 'portal',
        spec_intents: [intent('2026-06-26-spec-one')],
      })
    ).toBeNull();
  });

  it('rejects multi-spec when batch_name is absent', () => {
    const err = validateCreateJobRequest({
      company: 'Acme',
      project: 'portal',
      spec_intents: [intent('2026-06-26-spec-one'), intent('2026-06-26-spec-two')],
    });
    expect(err).toMatch(/batch_name/);
  });

  it('rejects multi-spec when batch_name is empty/whitespace', () => {
    const err = validateCreateJobRequest({
      company: 'Acme',
      project: 'portal',
      spec_intents: [intent('a-spec-one'), intent('a-spec-two')],
      batch_name: '   ',
    });
    expect(err).toMatch(/batch_name/);
  });

  it('accepts multi-spec when a non-empty batch_name is set', () => {
    expect(
      validateCreateJobRequest({
        company: 'Acme',
        project: 'portal',
        spec_intents: [intent('a-spec-one'), intent('a-spec-two'), intent('a-spec-three')],
        batch_name: 'checkout-revamp',
      })
    ).toBeNull();
  });

  it('accepts a single spec WITH a batch_name (degenerate batch)', () => {
    expect(
      validateCreateJobRequest({
        company: 'Acme',
        project: 'portal',
        spec_intents: [intent('a-spec-one')],
        batch_name: 'checkout-revamp',
      })
    ).toBeNull();
  });

  it('rejects a non-string batch_name', () => {
    const err = validateCreateJobRequest({
      company: 'Acme',
      project: 'portal',
      spec_intents: [intent('a-spec-one')],
      batch_name: 123,
    });
    expect(err).toMatch(/batch_name must be a string/);
  });

  it('still enforces the base rules even in batch mode (empty spec_intents)', () => {
    const err = validateCreateJobRequest({
      company: 'Acme',
      project: 'portal',
      spec_intents: [],
      batch_name: 'x',
    });
    expect(err).toMatch(/at least one element/);
  });
});
