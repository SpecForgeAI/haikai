/**
 * Coverage Closure Pass C — Postman export builder (CC4, Spec 2026-07-20).
 *
 * Pins: covered endpoints resolve their proven 2xx request; uncovered resolve
 * their last attempt + diagnosis; auth headers are stripped and auth is a
 * placeholder variable (no secrets); the collection folders/shape are v2.1.
 */
import { describe, it, expect } from 'vitest';
import {
  resolvePostmanSources,
  buildPostmanCollection,
  type ExportCapture,
  type IncludedEndpoint,
} from './postmanExport';

const included: IncludedEndpoint[] = [
  { operation_id: 'op1', method: 'GET', path: '/orders' },
  { operation_id: 'op2', method: 'GET', path: '/orders/{id}' },
];

const gate = {
  unresolved: [{ operation_id: 'op2', method: 'GET', path: '/orders/{id}', reason: 'id 999 not found' }],
};

const captures: ExportCapture[] = [
  // op1 covered — a 404 then a 200; the 200 must win.
  {
    operation_id: 'op1',
    request_method: 'GET',
    request_path: '/orders',
    request_query_json: { page: 1 },
    request_headers_redacted_json: { Authorization: 'REDACTED', Accept: 'application/json' },
    request_body_json: null,
    response_status: 404,
    captured_at: '2026-07-20T10:00:00Z',
  },
  {
    operation_id: 'op1',
    request_method: 'GET',
    request_path: '/orders',
    request_query_json: { page: 2 },
    request_headers_redacted_json: { Accept: 'application/json' },
    request_body_json: null,
    response_status: 200,
    captured_at: '2026-07-20T10:05:00Z',
  },
  // op2 uncovered — last attempt was a 404.
  {
    operation_id: 'op2',
    request_method: 'GET',
    request_path: '/orders/999',
    request_query_json: null,
    request_headers_redacted_json: null,
    request_body_json: null,
    response_status: 404,
    captured_at: '2026-07-20T10:10:00Z',
  },
];

describe('resolvePostmanSources', () => {
  it('covered endpoint resolves its most-recent 2xx request', () => {
    const sources = resolvePostmanSources(included, captures, gate);
    const op1 = sources.find((s) => s.operation_id === 'op1')!;
    expect(op1.covered).toBe(true);
    expect(op1.request?.query).toEqual({ page: 2 }); // the 200, not the 404
    expect(op1.diagnosis).toBeNull();
  });

  it('uncovered endpoint resolves its last attempt + a diagnosis', () => {
    const sources = resolvePostmanSources(included, captures, gate);
    const op2 = sources.find((s) => s.operation_id === 'op2')!;
    expect(op2.covered).toBe(false);
    expect(op2.request?.path).toBe('/orders/999');
    expect(op2.diagnosis).toMatch(/last status 404/);
    expect(op2.diagnosis).toMatch(/id 999 not found/);
  });
});

describe('buildPostmanCollection', () => {
  it('emits v2.1 shape with two folders and placeholder bearer auth', () => {
    const sources = resolvePostmanSources(included, captures, gate);
    const col = buildPostmanCollection('Session baseline', 'https://api.example.com', sources);
    expect(col.info.schema).toMatch(/v2\.1\.0/);
    expect(col.auth.bearer[0].value).toBe('{{bearerToken}}');
    expect(col.variable.find((v) => v.key === 'baseUrl')?.value).toBe('https://api.example.com');
    const uncovered = col.item.find((f) => f.name.startsWith('Uncovered'))!;
    const covered = col.item.find((f) => f.name.startsWith('Covered'))!;
    expect(uncovered.item).toHaveLength(1);
    expect(covered.item).toHaveLength(1);
  });

  it('strips auth headers from items — never exports a secret', () => {
    const sources = resolvePostmanSources(included, captures, gate);
    const col = buildPostmanCollection('c', 'https://api.example.com', sources);
    const coveredItem = col.item.find((f) => f.name.startsWith('Covered'))!.item[0];
    const headerKeys = coveredItem.request.header.map((h) => h.key.toLowerCase());
    expect(headerKeys).not.toContain('authorization');
    expect(headerKeys).toContain('accept');
  });

  it('uncovered item description tells the user to fix + re-upload', () => {
    const sources = resolvePostmanSources(included, captures, gate);
    const col = buildPostmanCollection('c', 'https://api.example.com', sources);
    const uncoveredItem = col.item.find((f) => f.name.startsWith('Uncovered'))!.item[0];
    expect(uncoveredItem.request.description).toMatch(/re-upload/);
    expect(uncoveredItem.request.url.raw).toBe('{{baseUrl}}/orders/999');
  });
});
