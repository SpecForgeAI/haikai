/**
 * Log-replay corpus extractor tests (Capture-State Discipline & Log-Replay
 * program, Spec 5, 2026-08-18): CLF URL-grade extraction with query strings
 * preserved (tier 2a), rich JSON-lines with bodies (tier 3), endpoint
 * matching via placeholder equivalence, usefulness rules, exact-dup
 * collapse with counts, and the honest funnel.
 */

import {
  extractReplayCorpus,
  type CorpusEndpoint,
} from '../services/logReplayCorpus/corpusExtractor';

const ENDPOINTS: CorpusEndpoint[] = [
  { id: 'ep-get-pet', method: 'GET', template: '/pets/{petId}' },
  { id: 'ep-list-pets', method: 'GET', template: '/pets' },
  { id: 'ep-create-pet', method: 'POST', template: '/pets' },
  { id: 'ep-delete-pet', method: 'DELETE', template: '/pets/{petId}' },
];

const CLF_LOG = [
  '10.0.0.1 - - [10/Oct/2026:13:55:36 +0000] "GET /pets/42?depth=2 HTTP/1.1" 200 512 "-" "curl/8"',
  '10.0.0.2 - - [10/Oct/2026:13:55:37 +0000] "GET /pets/42?depth=2 HTTP/1.1" 200 512 "-" "curl/8"',
  '10.0.0.3 - - [10/Oct/2026:13:55:38 +0000] "GET /pets HTTP/1.1" 200 2048 "-" "curl/8"',
  '10.0.0.4 - - [10/Oct/2026:13:55:39 +0000] "POST /pets HTTP/1.1" 201 128 "-" "curl/8"',
  '10.0.0.5 - - [10/Oct/2026:13:55:40 +0000] "DELETE /pets/7 HTTP/1.1" 204 0 "-" "curl/8"',
  '10.0.0.6 - - [10/Oct/2026:13:55:41 +0000] "GET /unknown/route HTTP/1.1" 200 64 "-" "curl/8"',
  '10.0.0.7 - - [10/Oct/2026:13:55:42 +0000] "GET /static/logo.png HTTP/1.1" 200 9000 "-" "curl/8"',
].join('\n');

describe('extractReplayCorpus — CLF (tier 2a, URL grade)', () => {
  const result = extractReplayCorpus({
    content: CLF_LOG,
    fileName: 'access.log',
    endpoints: ENDPOINTS,
  });

  it('keeps query strings on the concrete replay path and dedups identical requests', () => {
    const getPet = result.items.find((i) => i.matched_endpoint_id === 'ep-get-pet');
    expect(getPet).toBeTruthy();
    expect(getPet?.concrete_path).toBe('/pets/42?depth=2');
    expect(getPet?.occurrence_count).toBe(2); // two identical logged calls
    expect(getPet?.request_json).toEqual({ query: { depth: '2' } });
    expect(getPet?.richness).toBe('url_only');
  });

  it('DELETE is URL-grade useful; POST without a logged body is discarded loudly', () => {
    expect(result.items.some((i) => i.matched_endpoint_id === 'ep-delete-pet')).toBe(true);
    expect(result.items.some((i) => i.matched_endpoint_id === 'ep-create-pet')).toBe(false);
    expect(result.funnel.discarded_no_request_body).toBe(1);
  });

  it('unmatched API-shaped calls are counted AND listed (missed-endpoint evidence)', () => {
    expect(result.funnel.discarded_no_matching_endpoint).toBe(2);
    expect(result.funnel.unmatched_endpoints).toEqual(
      expect.arrayContaining([expect.stringContaining('GET /unknown/')]),
    );
  });

  it('accounts the funnel honestly', () => {
    expect(result.funnel.parse_mode).toBe('clf');
    expect(result.funnel.observations_parsed).toBe(7);
    expect(result.funnel.matched_endpoint).toBe(5);
    expect(result.funnel.useful).toBe(4); // 3×GET(2 dedup into 1 + 1) + DELETE
    expect(result.funnel.deduplicated_into).toBe(3);
  });

  it('keeps the logged status as a diagnostic only', () => {
    const getPet = result.items.find((i) => i.matched_endpoint_id === 'ep-get-pet');
    expect(getPet?.response_status).toBe(200);
  });
});

const JSONL_LOG = [
  JSON.stringify({
    method: 'POST',
    path: '/pets',
    request_headers: { 'content-type': 'application/json' },
    request_body: '{"name":"nemo"}',
    status: 201,
    response_body: '{"id":3}',
  }),
  JSON.stringify({
    method: 'GET',
    path: '/pets/3?depth=1',
    request_headers: { accept: 'application/json' },
    status: 200,
    response_body: '{"id":3,"name":"nemo"}',
  }),
].join('\n');

describe('extractReplayCorpus — rich JSON lines (tier 3, bodies)', () => {
  const result = extractReplayCorpus({
    content: JSONL_LOG,
    fileName: 'app.jsonl',
    endpoints: ENDPOINTS,
  });

  it('POST with a parseable logged body is useful at with_body richness', () => {
    const create = result.items.find((i) => i.matched_endpoint_id === 'ep-create-pet');
    expect(create).toBeTruthy();
    expect(create?.richness).toBe('with_body');
    expect(create?.request_json).toMatchObject({
      body: { name: 'nemo' },
      headers: { 'content-type': 'application/json' },
    });
  });

  it('GET rides URL-grade with headers when logged', () => {
    const get = result.items.find((i) => i.matched_endpoint_id === 'ep-get-pet');
    expect(get?.concrete_path).toBe('/pets/3?depth=1');
    expect(get?.richness).toBe('url_only');
  });

  it('parse mode is the deterministic rich fast path', () => {
    expect(result.funnel.parse_mode).toBe('json_lines_rich');
  });
});

describe('extractReplayCorpus — unreadable formats', () => {
  it('yields zero items with an honest unreadable funnel (source abandoned upstream)', () => {
    const result = extractReplayCorpus({
      content: 'bespoke trace line one\nanother line without any request shape',
      endpoints: ENDPOINTS,
    });
    expect(result.items).toHaveLength(0);
    expect(result.funnel.parse_mode).toBe('unreadable');
    expect(result.funnel.observations_parsed).toBe(0);
  });
});
