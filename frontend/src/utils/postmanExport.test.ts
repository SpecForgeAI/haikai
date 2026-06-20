/**
 * Unit tests for the pure {@link baselineToPostmanCollection} exporter
 * (`frontend/src/utils/postmanExport.ts`).
 *
 * Spec: 2026-06-20 Baseline Save & Review -- Batch + Activate + Export, R6
 * (Task Group 7). Covers the load-bearing R6 mapping rules ONLY:
 *   - a valid Postman Collection v2.1 shape (info.schema + item[]);
 *   - per-item method/path/query/headers/body carry + one response example
 *     (code = status, name "<scenario> (<status>)");
 *   - sequence_json flattening to ordered requests "<scenario> -- <role> #<idx>"
 *     with response_refs preserved in the description (not pm.* scripts);
 *   - the `{{baseUrl}}` collection variable presence + the baseUrl arg
 *     populating it.
 */

import { describe, it, expect } from 'vitest';

import {
  baselineToPostmanCollection,
  POSTMAN_SCHEMA_V21,
} from './postmanExport';
import type { ApiBehaviourBaselineItemDto } from '../api/apiBehaviourClient';

// The em-dash the exporter uses in flattened sequence names (built from its
// code point so this test file stays pure ASCII too).
const EM_DASH = String.fromCharCode(0x2014);

// --- minimal fixtures -------------------------------------------------------

function makeItem(
  overrides: Partial<ApiBehaviourBaselineItemDto> = {},
): ApiBehaviourBaselineItemDto {
  return {
    id: 'item-1',
    baseline_id: 'baseline-1',
    capture_id: 'capture-1',
    operation_id: 'op-1',
    scenario_id: 'scenario-1',
    method: 'GET',
    path: '/users/42',
    scenario_name: 'Get user',
    request_json: null,
    response_status: 200,
    response_json: null,
    business_notes: null,
    sequence_json: null,
    created_at: '2026-06-20T00:00:00Z',
    updated_at: '2026-06-20T00:00:00Z',
    ...overrides,
  };
}

describe('baselineToPostmanCollection', () => {
  it('produces a valid Postman Collection v2.1 shape (info.schema + item[])', () => {
    const collection = baselineToPostmanCollection('My Baseline', [
      makeItem(),
    ]);

    expect(collection.info.schema).toBe(POSTMAN_SCHEMA_V21);
    expect(collection.info.name).toBe('My Baseline');
    expect(Array.isArray(collection.item)).toBe(true);
    expect(collection.item).toHaveLength(1);
    // The whole document round-trips through JSON (no functions/cycles).
    expect(() => JSON.stringify(collection)).not.toThrow();
  });

  it('falls back to a generic collection name when name is blank', () => {
    const collection = baselineToPostmanCollection('   ', [makeItem()]);
    expect(collection.info.name).toBe('API Behaviour Baseline');
  });

  it('carries method/path/query/headers/body + one response example per item', () => {
    const item = makeItem({
      method: 'post',
      path: '/users',
      scenario_name: 'Create user',
      response_status: 201,
      request_json: {
        query: { include: 'profile', page: 2 },
        headers: { Authorization: 'Bearer x', 'X-Trace': 'abc' },
        body: { name: 'Ada' },
      },
      response_json: {
        headers: { 'Content-Type': 'application/json' },
        body: { id: 'u-1', name: 'Ada' },
      },
    });

    const collection = baselineToPostmanCollection('B', [item]);
    expect(collection.item).toHaveLength(1);
    const entry = collection.item[0];

    // Method upper-cased.
    expect(entry.request.method).toBe('POST');

    // URL = {{baseUrl}}{path} with split segments + query carried.
    expect(entry.request.url.host).toEqual(['{{baseUrl}}']);
    expect(entry.request.url.path).toEqual(['users']);
    expect(entry.request.url.raw).toContain('{{baseUrl}}/users');
    const queryKeys = (entry.request.url.query ?? []).map((q) => q.key);
    expect(queryKeys).toContain('include');
    expect(queryKeys).toContain('page');
    const pageParam = (entry.request.url.query ?? []).find(
      (q) => q.key === 'page',
    );
    expect(pageParam?.value).toBe('2');

    // Headers mapped to {key,value}.
    const headerKeys = entry.request.header.map((h) => h.key);
    expect(headerKeys).toContain('Authorization');
    expect(headerKeys).toContain('X-Trace');

    // Body = raw JSON.
    expect(entry.request.body?.mode).toBe('raw');
    expect(entry.request.body?.options?.raw.language).toBe('json');
    expect(JSON.parse(entry.request.body?.raw ?? '{}')).toEqual({
      name: 'Ada',
    });

    // Exactly one response example: code = status, name "<scenario> (<status>)".
    expect(entry.response).toHaveLength(1);
    const example = entry.response[0];
    expect(example.code).toBe(201);
    expect(example.name).toBe('Create user (201)');
    expect(JSON.parse(example.body)).toEqual({ id: 'u-1', name: 'Ada' });
    expect(example.header.map((h) => h.key)).toContain('Content-Type');
  });

  it('omits the body block and query when the item carries none', () => {
    const collection = baselineToPostmanCollection('B', [
      makeItem({ request_json: { headers: { Accept: 'application/json' } } }),
    ]);
    const entry = collection.item[0];
    expect(entry.request.body).toBeUndefined();
    expect(entry.request.url.query).toBeUndefined();
  });

  it('flattens a sequence_json item into ordered requests with refs in the description', () => {
    const item = makeItem({
      scenario_name: 'Checkout flow',
      sequence_json: {
        act_step_index: 1,
        cleanup_best_effort: true,
        steps: [
          // Deliberately OUT of index order to prove the sort.
          {
            index: 2,
            role: 'cleanup',
            kind: 'http',
            request: { method: 'delete', path: '/cart/{id}' },
            expected_status: 204,
          },
          {
            index: 0,
            role: 'setup',
            kind: 'http',
            request: { method: 'post', path: '/cart' },
            expected_status: 201,
          },
          {
            index: 1,
            role: 'act',
            kind: 'http',
            request: { method: 'post', path: '/cart/{id}/checkout' },
            expected_status: 200,
            response_refs: [
              { ref: '$0.body.id', from_step: 0, json_path: 'body.id' },
            ],
          },
        ],
      },
    });

    const collection = baselineToPostmanCollection('B', [item]);

    // Three flattened items, no single-shot fallback.
    expect(collection.item).toHaveLength(3);

    // Ordered setup -> act -> cleanup by each step's own index.
    expect(collection.item.map((i) => i.name)).toEqual([
      `Checkout flow ${EM_DASH} setup #0`,
      `Checkout flow ${EM_DASH} act #1`,
      `Checkout flow ${EM_DASH} cleanup #2`,
    ]);

    // Methods carried + upper-cased per step.
    expect(collection.item[0].request.method).toBe('POST');
    expect(collection.item[2].request.method).toBe('DELETE');
    expect(collection.item[1].request.url.path).toEqual([
      'cart',
      '{id}',
      'checkout',
    ]);

    // The act step's response_refs are preserved as a DESCRIPTION NOTE, and
    // there is NO generated pm.* script anywhere.
    const actDescription = collection.item[1].request.description ?? '';
    expect(actDescription).toContain('$0.body.id');
    const serialized = JSON.stringify(collection);
    expect(serialized).not.toContain('pm.');
    expect(serialized).not.toContain('pm.test');
  });

  it('includes a {{baseUrl}} collection variable that the baseUrl arg populates', () => {
    const withUrl = baselineToPostmanCollection(
      'B',
      [makeItem()],
      'https://api.example.test',
    );
    const varEntry = withUrl.variable.find((v) => v.key === 'baseUrl');
    expect(varEntry).toBeDefined();
    expect(varEntry?.value).toBe('https://api.example.test');

    // Fail-soft: omitted baseUrl => the variable is present but blank.
    const withoutUrl = baselineToPostmanCollection('B', [makeItem()]);
    const blankVar = withoutUrl.variable.find((v) => v.key === 'baseUrl');
    expect(blankVar).toBeDefined();
    expect(blankVar?.value).toBe('');
  });

  it("maps a MIXED array (single-shot + sequence) in one call to correctly ordered items that survive a JSON round-trip", () => {
    // One ordinary single-shot item FOLLOWED by a two-step sequence item, in a
    // SINGLE export call. The existing tests cover a lone single-shot OR a lone
    // sequence; this pins the realistic baseline shape (a sequence interleaved
    // with single-shots) -- the flattened items must appear in submission order
    // (single-shot first, then the sequence steps in index order), and the
    // produced collection must survive the stringify -> parse the download path
    // performs (no functions / cycles / lost fields), re-parsing identically.
    const singleShot = makeItem({
      id: "item-single",
      method: "get",
      path: "/health",
      scenario_name: "Health check",
      response_status: 200,
      response_json: { headers: null, body: { status: "ok" } },
    });
    const sequence = makeItem({
      id: "item-seq",
      scenario_name: "Order flow",
      sequence_json: {
        act_step_index: 1,
        cleanup_best_effort: false,
        steps: [
          {
            index: 1,
            role: "act",
            kind: "http",
            request: { method: "post", path: "/orders/{id}/pay" },
            expected_status: 200,
          },
          {
            index: 0,
            role: "setup",
            kind: "http",
            request: { method: "post", path: "/orders" },
            expected_status: 201,
          },
        ],
      },
    });

    const collection = baselineToPostmanCollection("Mixed", [singleShot, sequence]);

    // 1 single-shot + 2 flattened sequence steps = 3 items, in submission order
    // (single-shot first, then the sequence steps sorted by their own index).
    expect(collection.item).toHaveLength(3);
    expect(collection.item.map((i) => i.name)).toEqual([
      "Health check",
      `Order flow ${EM_DASH} setup #0`,
      `Order flow ${EM_DASH} act #1`,
    ]);

    // The single-shot retains its one response example; the flattened sequence
    // steps carry none (R6: response examples are a single-shot-only concept).
    expect(collection.item[0].response).toHaveLength(1);
    expect(collection.item[1].response).toHaveLength(0);
    expect(collection.item[2].response).toHaveLength(0);

    // The export -> download -> re-import round-trip is loss-free: serialising
    // then parsing yields a structurally identical document.
    const roundTripped = JSON.parse(JSON.stringify(collection));
    expect(roundTripped).toEqual(collection);
    expect(roundTripped.info.schema).toBe(POSTMAN_SCHEMA_V21);
  });
});
