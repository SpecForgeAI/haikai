/**
 * Unit tests for the pure {@link parsePostmanCollection} import parser
 * (`frontend/src/utils/postmanImport.ts`).
 *
 * Spec: 2026-06-23 Import a Postman Collection into Capture, R1 (Task Group 1).
 * Covers the load-bearing R1 behaviours ONLY (2-8 focused tests):
 *   - a well-formed collection -> ImportedRequest[] with
 *     { method, path, query, headers, body, sourceItemName };
 *   - folder + multi-step (sequence) FLATTEN preserving order;
 *   - a malformed / partial item degrades (skipped fields) and NEVER throws;
 *   - `{{baseUrl}}` / host stripped (path + query kept);
 *   - a non-application/json body flagged unsupported (not silently sent);
 *   - embedded collection / item `auth` blocks IGNORED.
 */

import { describe, it, expect } from 'vitest';

import { parsePostmanCollection } from './postmanImport';

describe('parsePostmanCollection', () => {
  it('maps a well-formed item to { method, path, query, headers, body, sourceItemName }', () => {
    const collection = {
      info: { name: 'C', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [
        {
          name: 'Create user',
          request: {
            method: 'post',
            header: [
              { key: 'Authorization', value: 'Bearer x' },
              { key: 'X-Trace', value: 'abc' },
            ],
            url: {
              raw: '{{baseUrl}}/users?include=profile&page=2',
              host: ['{{baseUrl}}'],
              path: ['users'],
              query: [
                { key: 'include', value: 'profile' },
                { key: 'page', value: '2' },
              ],
            },
            body: { mode: 'raw', raw: '{"name":"Ada"}', options: { raw: { language: 'json' } } },
          },
        },
      ],
    };

    const result = parsePostmanCollection(collection);
    expect(result).toHaveLength(1);
    const req = result[0];

    expect(req.method).toBe('POST'); // upper-cased
    expect(req.path).toBe('/users'); // {{baseUrl}}/host stripped, path kept
    expect(req.query).toEqual({ include: 'profile', page: '2' }); // query kept
    expect(req.headers).toEqual({ Authorization: 'Bearer x', 'X-Trace': 'abc' });
    expect(req.body).toEqual({ name: 'Ada' }); // JSON body parsed
    expect(req.sourceItemName).toBe('Create user');
    expect(req.unsupportedReason).toBeUndefined();
  });

  it('flattens folders and multi-step (sequence) items into a flat list in order', () => {
    const collection = {
      item: [
        // A folder with two requests (order preserved).
        {
          name: 'Users folder',
          item: [
            { name: 'List users', request: { method: 'get', url: { path: ['users'] } } },
            { name: 'Get user', request: { method: 'get', url: { path: ['users', '42'] } } },
          ],
        },
        // A multi-step sequence item -- steps deliberately OUT of index order.
        {
          name: 'Checkout',
          sequence: {
            steps: [
              { index: 1, role: 'act', request: { method: 'post', url: { path: ['cart', 'checkout'] } } },
              { index: 0, role: 'setup', request: { method: 'post', url: { path: ['cart'] } } },
            ],
          },
        },
      ],
    };

    const result = parsePostmanCollection(collection);

    // Folder (2) + sequence (2 steps sorted by index) = 4, in source order.
    expect(result.map((r) => r.path)).toEqual([
      '/users',
      '/users/42',
      '/cart', // setup #0 sorted ahead of act #1 despite array order
      '/cart/checkout',
    ]);
    expect(result.map((r) => r.method)).toEqual(['GET', 'GET', 'POST', 'POST']);
    // Step source names carry the role/index for an unambiguous staging list.
    expect(result[2].sourceItemName).toContain('setup');
    expect(result[3].sourceItemName).toContain('act');
  });

  it('degrades gracefully on malformed / partial input and never throws', () => {
    // null / non-object root -> empty array, no throw.
    expect(parsePostmanCollection(null)).toEqual([]);
    expect(parsePostmanCollection(42 as unknown)).toEqual([]);
    expect(parsePostmanCollection({})).toEqual([]);

    const collection = {
      item: [
        null, // not an object -> skipped
        { name: 'No request here' }, // no request / steps / folder -> skipped
        {
          // missing method + url; header is the wrong type; body is garbage
          name: 'Partial',
          request: { header: 'not-an-array', url: { path: [null, '', 'ok'] } },
        },
      ],
    };

    let result: ReturnType<typeof parsePostmanCollection> = [];
    expect(() => {
      result = parsePostmanCollection(collection);
    }).not.toThrow();

    // Only the partial-but-request-bearing item survives, with safe fallbacks.
    expect(result).toHaveLength(1);
    expect(result[0].method).toBe('GET'); // fallback
    expect(result[0].path).toBe('/ok'); // null/empty segments dropped
    expect(result[0].headers).toEqual({}); // non-array header -> empty
    expect(result[0].body).toBeNull();
  });

  it('strips {{baseUrl}}/host but keeps the path and query (string and object URLs)', () => {
    const collection = {
      item: [
        {
          name: 'String url',
          request: { method: 'get', url: 'https://api.example.test/v1/pets?status=sold&limit=5' },
        },
        {
          name: 'BaseUrl token string',
          request: { method: 'get', url: '{{baseUrl}}/orders/7?expand=items' },
        },
      ],
    };

    const result = parsePostmanCollection(collection);
    expect(result[0].path).toBe('/v1/pets'); // scheme + host stripped
    expect(result[0].query).toEqual({ status: 'sold', limit: '5' });
    expect(result[1].path).toBe('/orders/7'); // {{baseUrl}} token stripped
    expect(result[1].query).toEqual({ expand: 'items' });
  });

  it('flags a non-application/json body as unsupported with a null body (never silently sent)', () => {
    const collection = {
      item: [
        {
          name: 'Form upload',
          request: {
            method: 'post',
            url: { path: ['upload'] },
            body: { mode: 'formdata', formdata: [{ key: 'file', type: 'file' }] },
          },
        },
        {
          name: 'Raw text not JSON',
          request: {
            method: 'post',
            url: { path: ['notes'] },
            body: { mode: 'raw', raw: 'just plain text', options: { raw: { language: 'text' } } },
          },
        },
      ],
    };

    const result = parsePostmanCollection(collection);
    expect(result).toHaveLength(2);
    // Items are still emitted (visible + flaggable) but carry no body to send.
    expect(result[0].body).toBeNull();
    expect(result[0].unsupportedReason).toBeTruthy();
    expect(result[1].body).toBeNull();
    expect(result[1].unsupportedReason).toBeTruthy();
  });

  it('ignores embedded collection-level and item-level auth blocks', () => {
    const collection = {
      auth: { type: 'bearer', bearer: [{ key: 'token', value: 'collection-secret' }] },
      item: [
        {
          name: 'Authed request',
          request: {
            method: 'get',
            url: { path: ['secure'] },
            auth: { type: 'apikey', apikey: [{ key: 'value', value: 'item-secret' }] },
            header: [{ key: 'Accept', value: 'application/json' }],
          },
        },
      ],
    };

    const result = parsePostmanCollection(collection);
    expect(result).toHaveLength(1);
    // No auth artifacts leak into headers; the secret values never appear.
    expect(result[0].headers).toEqual({ Accept: 'application/json' });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('collection-secret');
    expect(serialized).not.toContain('item-secret');
  });
});

/**
 * Example mining (2026-08-08): unresolved tokens backfill from the item's
 * saved response examples (`response[].originalRequest` — the exact request as
 * actually sent). Pins the honesty rules: variables WIN over the example, a
 * literal-segment divergence (technically an invalid file) discards the
 * example, and provenance names what the example supplied.
 */
describe('parsePostmanCollection — example mining', () => {
  const templatedItem = (over: Record<string, unknown> = {}) => ({
    name: 'Get order line',
    request: {
      method: 'GET',
      url: { raw: '{{baseUrl}}/orders/{{orderId}}/lines/:lineId' },
    },
    ...over,
  });

  it('backfills unresolved path params from the 2xx example originalRequest (concrete send path, provenance, runnable-ready)', () => {
    const result = parsePostmanCollection({
      item: [
        templatedItem({
          response: [
            {
              name: 'Not found',
              code: 404,
              originalRequest: { method: 'GET', url: '{{baseUrl}}/orders/999999/lines/0' },
            },
            {
              name: 'OK',
              code: 200,
              originalRequest: { method: 'GET', url: 'https://api.example.com/orders/12345/lines/7' },
            },
          ],
        }),
      ],
    });
    expect(result).toHaveLength(1);
    const req = result[0];
    // The 2xx example wins over the earlier 4xx one.
    expect(req.path).toBe('/orders/12345/lines/7');
    expect(req.pathTemplate).toBe('/orders/{orderId}/lines/{lineId}');
    expect(req.unresolvedParams).toBeUndefined();
    expect(req.exampleProvenance).toEqual({
      exampleName: 'OK',
      resolvedNames: ['orderId', 'lineId'],
    });
  });

  it('variables WIN over the example — the example only fills what they could not', () => {
    const result = parsePostmanCollection({
      variable: [{ key: 'orderId', value: 'from-collection-var' }],
      item: [
        templatedItem({
          response: [
            {
              name: 'OK',
              code: 200,
              originalRequest: { method: 'GET', url: '{{baseUrl}}/orders/12345/lines/7' },
            },
          ],
        }),
      ],
    });
    const req = result[0];
    expect(req.path).toBe('/orders/from-collection-var/lines/7');
    expect(req.exampleProvenance).toEqual({ exampleName: 'OK', resolvedNames: ['lineId'] });
  });

  it('a literal-segment divergence (technically an invalid file) discards the example — top-level stands, params stay unresolved', () => {
    const result = parsePostmanCollection({
      item: [
        templatedItem({
          response: [
            {
              name: 'OK',
              code: 200,
              // `invoices` disagrees with the top-level `orders` literal.
              originalRequest: { method: 'GET', url: '{{baseUrl}}/invoices/12345/lines/7' },
            },
          ],
        }),
      ],
    });
    const req = result[0];
    expect(req.path).toBe('/orders/{{orderId}}/lines/:lineId');
    expect(req.unresolvedParams).toEqual(['orderId', 'lineId']);
    expect(req.exampleProvenance).toBeUndefined();
  });

  it('backfills a query token from the example same-key value and a body token by JSON-path alignment', () => {
    const result = parsePostmanCollection({
      item: [
        {
          name: 'Create line',
          request: {
            method: 'POST',
            url: { raw: '{{baseUrl}}/lines?orderRef={{orderRef}}' },
            body: {
              mode: 'raw',
              raw: '{"orderId":"{{orderId}}","qty":2}',
              options: { raw: { language: 'json' } },
            },
          },
          response: [
            {
              name: 'Created',
              code: 201,
              originalRequest: {
                method: 'POST',
                url: '{{baseUrl}}/lines?orderRef=ORD-88',
                body: { mode: 'raw', raw: '{"orderId":"12345","qty":9}' },
              },
            },
          ],
        },
      ],
    });
    const req = result[0];
    expect(req.query).toEqual({ orderRef: 'ORD-88' });
    // Token leaf takes the example's value; token-free leaves keep top-level.
    expect(req.body).toEqual({ orderId: '12345', qty: 2 });
    expect(req.exampleProvenance?.resolvedNames).toEqual(
      expect.arrayContaining(['orderRef', 'orderId']),
    );
  });

  it('a body that only fails to parse because of tokens takes the example body wholesale; token-free non-JSON stays flagged', () => {
    const tokenBody = parsePostmanCollection({
      item: [
        {
          name: 'Tokenised body',
          request: {
            method: 'POST',
            url: '{{baseUrl}}/orders',
            // Bare token -> not JSON until it resolves.
            body: { mode: 'raw', raw: '{"id": {{orderId}}}' },
          },
          response: [
            {
              name: 'Created',
              code: 201,
              originalRequest: {
                method: 'POST',
                url: '{{baseUrl}}/orders',
                body: { mode: 'raw', raw: '{"id": 12345}' },
              },
            },
          ],
        },
      ],
    });
    expect(tokenBody[0].unsupportedReason).toBeUndefined();
    expect(tokenBody[0].body).toEqual({ id: 12345 });
    expect(tokenBody[0].exampleProvenance?.resolvedNames).toContain('body');

    const garbage = parsePostmanCollection({
      item: [
        {
          name: 'Plain non-JSON',
          request: {
            method: 'POST',
            url: '{{baseUrl}}/orders',
            body: { mode: 'raw', raw: 'not json at all' },
          },
          response: [
            {
              name: 'Created',
              code: 201,
              originalRequest: {
                method: 'POST',
                url: '{{baseUrl}}/orders',
                body: { mode: 'raw', raw: '{"id": 12345}' },
              },
            },
          ],
        },
      ],
    });
    // No tokens -> the non-JSON body is honestly flagged, never masked.
    expect(garbage[0].unsupportedReason).toBeDefined();
    expect(garbage[0].body).toBeNull();
  });

  it('with no saved example the behaviour is unchanged — params stay unresolved for the manual ask', () => {
    const result = parsePostmanCollection({ item: [templatedItem()] });
    const req = result[0];
    expect(req.path).toBe('/orders/{{orderId}}/lines/:lineId');
    expect(req.unresolvedParams).toEqual(['orderId', 'lineId']);
    expect(req.exampleProvenance).toBeUndefined();
  });

  it('an example that is itself unresolved at a param position contributes no value there', () => {
    const result = parsePostmanCollection({
      item: [
        templatedItem({
          response: [
            {
              name: 'Half-resolved',
              code: 200,
              originalRequest: { method: 'GET', url: '{{baseUrl}}/orders/12345/lines/:lineId' },
            },
          ],
        }),
      ],
    });
    const req = result[0];
    expect(req.path).toBe('/orders/12345/lines/:lineId');
    expect(req.unresolvedParams).toEqual(['lineId']);
    expect(req.exampleProvenance).toEqual({
      exampleName: 'Half-resolved',
      resolvedNames: ['orderId'],
    });
  });
});
