/**
 * Content-type twin guard (Spec 2026-07-23).
 *
 * Pins the AMVS mirror of the AMS `restDiscriminator` grammar and the hardened
 * `findExistingOperationRow` fallback: a bare method+path match must NOT reuse
 * a row whose operation_id carries a DIFFERENT mapping-discriminator suffix
 * (the JSON/XML twin case), while plain and exact-id matching stay unchanged.
 */
import {
  restDiscriminator,
  findExistingOperationRow,
  type NormalisedAddOperation,
} from '../routes/addOperationSupport';

function target(partial: Partial<NormalisedAddOperation>): NormalisedAddOperation {
  return {
    operationId: partial.operationId ?? null,
    endpointId: null,
    method: partial.method ?? 'GET',
    path: partial.path ?? '/report',
    summary: null,
    description: null,
  };
}

describe('restDiscriminator', () => {
  it('extracts the discovery suffix (single and multi key)', () => {
    expect(restDiscriminator('GET /report [produces=application/xml]')).toBe(
      'produces=application/xml',
    );
    expect(
      restDiscriminator(
        'POST /h/{id} [consumes=application/json,application/xml;produces=application/xml]',
      ),
    ).toBe('consumes=application/json,application/xml;produces=application/xml');
  });

  it('null for plain names, OAS operationIds, and non-discriminator brackets', () => {
    expect(restDiscriminator('GET /report')).toBeNull();
    expect(restDiscriminator('getReport')).toBeNull();
    expect(restDiscriminator('GET /report [legacy endpoint]')).toBeNull();
    expect(restDiscriminator(null)).toBeNull();
    expect(restDiscriminator(undefined)).toBeNull();
  });
});

describe('findExistingOperationRow twin guard', () => {
  const jsonTwin = {
    operation_id: 'GET /report [produces=application/json]',
    method: 'GET',
    path: '/report',
  };
  const xmlTwin = {
    operation_id: 'GET /report [produces=application/xml]',
    method: 'GET',
    path: '/report',
  };
  const harnessRow = { operation_id: 'getThings', method: 'GET', path: '/things' };

  it('exact operation_id match still wins', () => {
    expect(
      findExistingOperationRow(
        [jsonTwin, xmlTwin],
        target({ operationId: 'GET /report [produces=application/xml]' }),
      ),
    ).toBe(xmlTwin);
  });

  it('THE BUG GUARD: adding the XML twin does NOT reuse the JSON twin row', () => {
    expect(
      findExistingOperationRow(
        [jsonTwin],
        target({ operationId: 'GET /report [produces=application/xml]' }),
      ),
    ).toBeNull();
  });

  it('a bare target does not reuse a discriminated twin row', () => {
    expect(findExistingOperationRow([jsonTwin, xmlTwin], target({}))).toBeNull();
  });

  it('plain method+path fallback unchanged (harness rows, no discriminators)', () => {
    expect(
      findExistingOperationRow([harnessRow], target({ method: 'get', path: '/things' })),
    ).toBe(harnessRow);
  });
});
