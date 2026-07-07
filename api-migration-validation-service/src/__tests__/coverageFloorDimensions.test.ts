/**
 * Spec 2026-07-06-k — Scenario Coverage Floor (AMVS side). Pins:
 *
 *   DIMENSION PIN — a list-shaped, multi-media-type, required-field operation
 *                   generates pagination / content_type / validation
 *                   dimensions with the floor taxonomy stamped; pagination +
 *                   content_type (+ enum/filter) are REPORTED-only.
 *   LEGACY PIN    — scenarios without a dimensionKind score with the
 *                   expected_status-derived default (pre-K sessions
 *                   unchanged).
 *   SCORER PIN    — dimension_kind + reported_only ride the persisted
 *                   CoverageDimensionResult rows.
 */

import {
  defaultScenarioSet,
  scoreEndpointCoverage,
  type GeneratedScenario,
} from '../services/captureSessionOrchestrator';
import type { OperationDto } from '../services/archModelClient';

const LIST_OP = {
  id: 'op-1',
  operation_id: 'op-1',
  method: 'GET',
  path: '/orders',
  request_schema_json: null,
} as unknown as OperationDto;

const LIST_OAS = {
  parameters: [
    { name: 'page', in: 'query', required: false, schema: { type: 'integer' } },
    { name: 'size', in: 'query', required: false, schema: { type: 'integer' } },
  ],
};

const CREATE_OP = {
  id: 'op-2',
  operation_id: 'op-2',
  method: 'POST',
  path: '/orders',
  request_schema_json: { required: ['customerId', 'lines'] },
} as unknown as OperationDto;

const CREATE_OAS = {
  requestBody: {
    content: {
      'application/json': { schema: {} },
      'application/xml': { schema: {} },
    },
  },
};

describe('DIMENSION PIN', () => {
  it('list-shaped op gains reported-only pagination dimensions', () => {
    const scenarios = defaultScenarioSet(LIST_OP, undefined, LIST_OAS);
    const pagination = scenarios.filter((s) => s.dimensionKind === 'pagination');
    expect(pagination.map((s) => s.name)).toEqual([
      'pagination_first_page',
      'pagination_next_page',
      'pagination_past_end_page',
    ]);
    expect(pagination.every((s) => s.reportedOnly === true)).toBe(true);
    // The happy path stays floor-bearing.
    const happy = scenarios.find((s) => s.name === 'happy_path')!;
    expect(happy.dimensionKind).toBe('happy');
    expect(happy.reportedOnly).toBeUndefined();
  });

  it('multi-media-type body gains a reported-only content_type dimension; required fields gain floor-bearing validation dimensions', () => {
    const scenarios = defaultScenarioSet(CREATE_OP, undefined, CREATE_OAS);
    const contentType = scenarios.find((s) => s.dimensionKind === 'content_type')!;
    expect(contentType.name).toBe('content_type_application_xml');
    expect(contentType.reportedOnly).toBe(true);

    const missing = scenarios.filter((s) => s.name.startsWith('validation_missing_'));
    expect(missing.map((s) => s.name).sort()).toEqual([
      'validation_missing_customerId',
      'validation_missing_lines',
    ]);
    expect(missing.every((s) => s.dimensionKind === 'validation')).toBe(true);
    expect(missing.every((s) => s.reportedOnly !== true)).toBe(true);
    // bad_request_body (schema-violating body) also carries validation kind.
    const badBody = scenarios.find((s) => s.name === 'bad_request_body')!;
    expect(badBody.dimensionKind).toBe('validation');
  });
});

describe('LEGACY + SCORER PINS', () => {
  it('stamps dimension_kind + reported_only on scored dimensions, defaulting legacy scenarios', () => {
    const scenarios: GeneratedScenario[] = [
      { name: 'happy_path', type: 'happy_path', expectedStatus: 'success' }, // legacy: no kind
      {
        name: 'pagination_first_page',
        type: 'pagination',
        expectedStatus: 'success',
        dimensionKind: 'pagination',
        reportedOnly: true,
      },
      { name: 'not_found_id', type: 'not_found', expectedStatus: 'not_found' }, // legacy
    ];
    const result = scoreEndpointCoverage(
      { operation_id: 'op-1', method: 'GET', path: '/orders' } as never,
      scenarios,
      new Map(), // no captures -> every dimension missed
      undefined as never,
    );
    const byName = new Map(result.dimensions.map((d) => [d.name, d]));
    expect(byName.get('happy_path')).toMatchObject({
      dimension_kind: 'happy',
      reported_only: false,
      achieved: false,
    });
    expect(byName.get('pagination_first_page')).toMatchObject({
      dimension_kind: 'pagination',
      reported_only: true,
    });
    expect(byName.get('not_found_id')).toMatchObject({
      dimension_kind: 'error_status',
      reported_only: false,
    });
  });
});
