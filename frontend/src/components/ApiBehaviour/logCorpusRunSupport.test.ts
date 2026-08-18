/**
 * Log-corpus wizard support tests (Capture-State Discipline & Log-Replay
 * program, Spec 6, 2026-08-18): source-selection derivation (mode + blocking
 * verdicts), placeholder-equivalent template matching, the mutating pre-fire
 * split, and corpus-item -> manual-capture conversion.
 */

import { describe, expect, it } from 'vitest';
import type { ApiBehaviourOperationDto } from '../../api/apiBehaviourClient';
import {
  corpusItemToManualCapture,
  deriveSourceSelection,
  isMutatingCorpusItem,
  matchCorpusItemToOperation,
  selectionFromMode,
  splitCorpusForPreFire,
  templatesEquivalent,
  type LogCorpusItemWire,
} from './logCorpusRunSupport';

function item(overrides: Partial<LogCorpusItemWire>): LogCorpusItemWire {
  return {
    method: 'GET',
    path_template: '/pets/{id}',
    concrete_path: '/pets/42?depth=2',
    request_json: { query: { depth: '2' } },
    response_status: 200,
    occurrence_count: 1,
    richness: 'url_only',
    matched_endpoint_id: 'ep-1',
    ...overrides,
  };
}

function op(overrides: Partial<ApiBehaviourOperationDto>): ApiBehaviourOperationDto {
  return {
    id: 'row-1',
    session_id: 's',
    operation_id: 'getPet',
    method: 'GET',
    path: '/pets/{petId}',
    summary: null,
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  } as ApiBehaviourOperationDto;
}

describe('deriveSourceSelection', () => {
  const corpusOk = { abandoned: false, usefulCount: 12 };

  it('maps the checkbox pairs onto the existing PostmanRunMode', () => {
    expect(
      deriveSourceSelection(
        { llm: true, postman: false, log: false, includeLogInInitial: false },
        null,
      ),
    ).toMatchObject({ mode: 'llm', startBlockReason: null, postmanOnly: false });
    expect(
      deriveSourceSelection(
        { llm: true, postman: true, log: false, includeLogInInitial: false },
        null,
      ),
    ).toMatchObject({ mode: 'postman-delta', startBlockReason: null });
    expect(
      deriveSourceSelection(
        { llm: false, postman: true, log: false, includeLogInInitial: false },
        null,
      ),
    ).toMatchObject({ mode: 'postman-only', postmanOnly: true });
  });

  it('log-only + include + useful corpus runs planner-less (postmanOnly semantics)', () => {
    expect(
      deriveSourceSelection(
        { llm: false, postman: false, log: true, includeLogInInitial: true },
        corpusOk,
      ),
    ).toMatchObject({ mode: 'postman-only', startBlockReason: null, postmanOnly: true });
  });

  it('log-only UNCHECKED blocks /start with the round-2 explanation', () => {
    const verdict = deriveSourceSelection(
      { llm: false, postman: false, log: true, includeLogInInitial: false },
      corpusOk,
    );
    expect(verdict.startBlockReason).toContain('round 2');
  });

  it('log-only with an ABANDONED source blocks /start', () => {
    const verdict = deriveSourceSelection(
      { llm: false, postman: false, log: true, includeLogInInitial: true },
      { abandoned: true, usefulCount: 0 },
    );
    expect(verdict.startBlockReason).toContain('no useful requests');
  });

  it('no sources at all blocks /start', () => {
    expect(
      deriveSourceSelection(
        { llm: false, postman: false, log: false, includeLogInInitial: false },
        null,
      ).startBlockReason,
    ).toContain('at least one');
  });

  it('selectionFromMode round-trips the legacy enum', () => {
    expect(selectionFromMode('postman-delta')).toMatchObject({ llm: true, postman: true });
    expect(selectionFromMode('postman-only')).toMatchObject({ llm: false, postman: true });
  });
});

describe('templatesEquivalent + matching', () => {
  it('placeholder segments match each other regardless of name', () => {
    expect(templatesEquivalent('/pets/{petId}', '/pets/{id}')).toBe(true);
    expect(templatesEquivalent('/pets/{petId}/toys', '/pets/{id}')).toBe(false);
    expect(templatesEquivalent('/pets', '/pets')).toBe(true);
    expect(templatesEquivalent('/pets', '/owners')).toBe(false);
  });

  it('matches a corpus item to the session operation on method + template', () => {
    const operations = [op({}), op({ id: 'row-2', operation_id: 'delPet', method: 'DELETE' })];
    expect(matchCorpusItemToOperation(item({}), operations)?.operation_id).toBe('getPet');
    expect(
      matchCorpusItemToOperation(item({ method: 'DELETE' }), operations)?.operation_id,
    ).toBe('delPet');
    expect(matchCorpusItemToOperation(item({ method: 'PATCH' }), operations)).toBeNull();
  });

  it('never matches an excluded operation row', () => {
    expect(matchCorpusItemToOperation(item({}), [op({ included: false })])).toBeNull();
  });
});

describe('mutating split + conversion', () => {
  it('holds mutating items back from the (unbracketed) pre-fire', () => {
    const items = [
      item({}),
      item({ method: 'POST', richness: 'with_body', request_json: { body: { a: 1 } } }),
      item({ method: 'DELETE', concrete_path: '/pets/7' }),
    ];
    const { fireable, heldMutating } = splitCorpusForPreFire(items);
    expect(fireable.map((i) => i.method)).toEqual(['GET']);
    expect(heldMutating.map((i) => i.method)).toEqual(['POST', 'DELETE']);
    expect(isMutatingCorpusItem(item({ method: 'PUT' }))).toBe(true);
  });

  it('converts a corpus item to the manual-capture request shape', () => {
    const request = corpusItemToManualCapture(item({}), op({}), {
      mutatingCallsConfirmed: true,
    });
    expect(request).toMatchObject({
      operationId: 'getPet',
      method: 'GET',
      path: '/pets/42', // query rides separately, not on the path
      query: { depth: '2' },
      mutatingCallsConfirmed: true,
    });
  });
});
