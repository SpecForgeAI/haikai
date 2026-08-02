/**
 * Parameterised-endpoint Postman round trip (2026-08-02).
 *
 * The round trip used to carry templated paths end-to-end: export wrote the
 * literal `{param}` token, import kept it, staging matched it (template ==
 * template), and the send fired the literal token at the server -> "NO
 * CAPTURE was recorded". These tests pin the repaired chain: export emits
 * native Postman path variables (prefilled from mined capture values),
 * import substitutes known values and flags unresolved ones, staging blocks
 * unresolved items until the operator supplies values, and the send layer
 * refuses to fire a templated path.
 */

import { describe, expect, it } from 'vitest';
import { parsePostmanCollection } from './postmanImport';
import {
  applyParamValues,
  stageImportItems,
} from '../components/ApiBehaviour/postmanImportStagingSupport';
import {
  hasUnresolvedSendableParams,
  isItemSendable,
} from '../components/ApiBehaviour/postmanImportRunSupport';
import {
  buildPostmanCollection,
  minePathParamValues,
  type ExportCapture,
  type IncludedEndpoint,
  type PostmanSource,
} from '../components/DashboardView/postmanExport';
import type { ApiBehaviourOperationDto } from '../api/apiBehaviourClient';

function collectionWith(url: unknown, variable?: unknown): Record<string, unknown> {
  return {
    info: { name: 'c' },
    ...(variable ? { variable } : {}),
    item: [{ name: 'POST /nodes/{orgId}', request: { method: 'POST', url } }],
  };
}

describe('import: path-parameter resolution', () => {
  it('substitutes a :param from the URL variable array (concrete send path + template kept)', () => {
    const [req] = parsePostmanCollection(
      collectionWith({
        raw: '{{baseUrl}}/nodes/:orgId',
        host: ['{{baseUrl}}'],
        path: ['nodes', ':orgId'],
        variable: [{ key: 'orgId', value: '2147483647' }],
      }),
    );
    expect(req.path).toBe('/nodes/2147483647');
    expect(req.pathTemplate).toBe('/nodes/{orgId}');
    expect(req.unresolvedParams).toBeUndefined();
  });

  it('flags an unresolved :param / {param} instead of silently keeping or dropping it', () => {
    const [colon] = parsePostmanCollection(
      collectionWith({ host: ['{{baseUrl}}'], path: ['nodes', ':orgId'] }),
    );
    expect(colon.path).toBe('/nodes/:orgId');
    expect(colon.pathTemplate).toBe('/nodes/{orgId}');
    expect(colon.unresolvedParams).toEqual(['orgId']);

    const [curly] = parsePostmanCollection(
      collectionWith({ host: ['{{baseUrl}}'], path: ['nodes', '{orgId}'] }),
    );
    expect(curly.path).toBe('/nodes/{orgId}');
    expect(curly.unresolvedParams).toEqual(['orgId']);
  });

  it('substitutes {{var}} path usages from collection variables (baseUrl stays host-only)', () => {
    // Non-leading {{var}} substitutes from collection variables; a LEADING
    // whole-variable segment is treated as a host token and stripped (the
    // {{baseUrl}} convention).
    const [req] = parsePostmanCollection(
      collectionWith(
        { host: ['{{baseUrl}}'], path: ['api', '{{env}}', 'nodes', '7'] },
        [
          { key: 'baseUrl', value: 'http://x' },
          { key: 'env', value: 'sit1' },
        ],
      ),
    );
    expect(req.path).toBe('/api/sit1/nodes/7');
    expect(req.unresolvedParams).toBeUndefined();
  });
});

describe('staging: template matching + the unresolved-params gate', () => {
  const operations = [
    { id: 'row-1', operation_id: 'op-1', method: 'POST', path: '/nodes/{orgId}' },
  ] as unknown as ApiBehaviourOperationDto[];

  it('matches a substituted item to its templated operation and runs it', () => {
    const [req] = parsePostmanCollection(
      collectionWith({
        host: ['{{baseUrl}}'],
        path: ['nodes', ':orgId'],
        variable: [{ key: 'orgId', value: '42' }],
      }),
    );
    const [item] = stageImportItems([req], operations, null);
    expect(item.archStatus).toBe('matched');
    expect(item.runnable).toBe(true);
  });

  it('tier 3: a fully-concrete import (no surviving token) binds to its templated operation', () => {
    const [req] = parsePostmanCollection(
      collectionWith({ host: ['{{baseUrl}}'], path: ['nodes', '123'] }),
    );
    expect(req.pathTemplate).toBeUndefined(); // nothing token-shaped survived
    const [item] = stageImportItems([req], operations, null);
    expect(item.archStatus).toBe('matched');
    expect(item.runnable).toBe(true);
    expect(item.operation?.path).toBe('/nodes/{orgId}');
  });

  it('blocks an unresolved item until values are applied, then unblocks', () => {
    const [req] = parsePostmanCollection(
      collectionWith({ host: ['{{baseUrl}}'], path: ['nodes', ':orgId'] }),
    );
    const [item] = stageImportItems([req], operations, null);
    expect(item.archStatus).toBe('matched'); // template-level match still lands
    expect(item.runnable).toBe(false);
    expect(isItemSendable(item, {})).toBe(false);
    expect(hasUnresolvedSendableParams([item], {})).toBe(true);

    const resolved = applyParamValues(req, { orgId: '42' });
    expect(resolved.path).toBe('/nodes/42');
    expect(resolved.unresolvedParams).toBeUndefined();
    const [after] = stageImportItems([resolved], operations, null);
    expect(after.runnable).toBe(true);
    expect(isItemSendable(after, {})).toBe(true);
  });
});

describe('export: native path variables prefilled from mined capture values', () => {
  const included: IncludedEndpoint[] = [
    { operation_id: 'op-a', method: 'POST', path: '/hierarchy/{businessDate}/{orgId}' },
    { operation_id: 'op-b', method: 'POST', path: '/nodes/{orgId}' },
  ];
  const captures: ExportCapture[] = [
    {
      operation_id: 'op-a',
      request_method: 'POST',
      request_path: '/hierarchy/10-Jun-2026/11464',
      request_query_json: null,
      request_headers_redacted_json: null,
      request_body_json: null,
      response_status: 200,
      captured_at: '2026-08-01T10:00:00Z',
    },
  ];

  it('mines param values across endpoints (a param captured anywhere prefills same-named ones)', () => {
    expect(minePathParamValues(included, captures)).toEqual({
      businessDate: '10-Jun-2026',
      orgId: '11464',
    });
  });

  it('emits :param segments + variable entries instead of literal {param} tokens', () => {
    const sources: PostmanSource[] = [
      {
        operation_id: 'op-b',
        method: 'POST',
        path: '/nodes/{orgId}',
        covered: false,
        diagnosis: 'last status none — not captured',
        request: null,
      },
    ];
    const collection = buildPostmanCollection(
      'test',
      'http://x',
      sources,
      minePathParamValues(included, captures),
    );
    const item = collection.item[0].item[0];
    const url = item.request.url as {
      raw: string;
      path: string[];
      variable?: Array<{ key: string; value: string }>;
    };
    expect(url.raw).toBe('{{baseUrl}}/nodes/:orgId');
    expect(url.path).toEqual(['nodes', ':orgId']);
    expect(url.variable).toEqual([
      expect.objectContaining({ key: 'orgId', value: '11464' }),
    ]);
  });
});
