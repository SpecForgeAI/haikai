/**
 * Task Group 6 — recipe-aware deterministic full-file extractor.
 *
 * Pins the load-bearing behaviours from tasks.md 6.1. CRITICAL invariant under
 * test: the LLM only ever saw small samples (TG5); THIS code applies the
 * recipe to the WHOLE file deterministically.
 *   1. Multi-line record assembly: a SampleSvc block (`<id> > METHOD http://host/path`,
 *      `<id> > header: value` lines, blank `<id> >`, then JSON body) assembles
 *      into ONE record -> method + path + headers + body extracted.
 *   2. Response captured ONLY when present; a request with no logged response
 *      yields NO invented response field.
 *   3. Streaming a file: extraction works in a streamed pass over a real file.
 *   4. Interleaved log4j noise does not corrupt record assembly.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  extractRecord,
  extractWithRecipeFromContent,
  extractWithRecipe,
  type ExtractorRecipe,
} from '../recipeAwareExtractor';

// ----------------------------------------------------------------------------
// Recipes
// ----------------------------------------------------------------------------

/**
 * The SampleSvc recipe: records START at `<id> > METHOD `; method/path from the
 * start line, headers from `<id> > name: value` lines, request body from the
 * JSON object line. No response rules (the request-only SampleSvc shape).
 */
const LEGACYAPP_REQUEST_RECIPE: ExtractorRecipe = {
  recordDelimiter: { kind: 'start_regex', pattern: '^\\d+ > [A-Z]+ ' },
  fields: {
    method: { kind: 'regex', pattern: '^\\d+ > ([A-Z]+) ' },
    path: { kind: 'regex', pattern: '^\\d+ > [A-Z]+ https?://[^/]+(/\\S+)' },
    requestHeaders: {
      kind: 'line_regex',
      pattern: '^\\d+ > ([A-Za-z][A-Za-z0-9-]*): (.+)$',
      captureKeyValue: true,
    },
    requestBody: { kind: 'line_regex', pattern: '^\\d+ > (\\{.*\\})\\s*$' },
  },
};

/** A SampleSvc recipe that ALSO knows how to read a logged response status + body. */
const LEGACYAPP_WITH_RESPONSE_RECIPE: ExtractorRecipe = {
  recordDelimiter: { kind: 'start_regex', pattern: '^\\d+ > [A-Z]+ ' },
  fields: {
    method: { kind: 'regex', pattern: '^\\d+ > ([A-Z]+) ' },
    path: { kind: 'regex', pattern: '^\\d+ > [A-Z]+ https?://[^/]+(/\\S+)' },
    responseStatus: { kind: 'line_regex', pattern: '^\\d+ < HTTP/[\\d.]+ (\\d{3})' },
    responseBody: { kind: 'line_regex', pattern: '^\\d+ < (\\{.*\\})\\s*$' },
  },
};

// ----------------------------------------------------------------------------
// 1: multi-line record assembly (SampleSvc)
// ----------------------------------------------------------------------------

describe('recipeAwareExtractor — multi-line record assembly', () => {
  it('assembles a SampleSvc multi-line block into ONE record with method+path+headers+body', () => {
    const content = [
      '7 > POST http://svc:8080/api/orders/42',
      '7 > content-type: application/json',
      '7 > accept: application/json',
      '7 >',
      '7 > {"item":"widget","qty":2}',
    ].join('\n');

    const obs = extractWithRecipeFromContent(LEGACYAPP_REQUEST_RECIPE, content, {
      sourceArtifactId: 'art-1',
      sourceFileName: 'app.log',
    });

    expect(obs).toHaveLength(1);
    const o = obs[0];
    expect(o.method).toBe('POST');
    expect(o.rawPath).toBe('/api/orders/42');
    expect(o.normalizedPath).toBe('/api/orders/{id}');
    expect(o.requestHeaders).toBeDefined();
    expect(o.requestHeaders?.['content-type']).toBe('application/json');
    expect(o.requestHeaders?.['accept']).toBe('application/json');
    expect(o.requestBody).toContain('widget');
    expect(o.sourceArtifactId).toBe('art-1');
    expect(o.sourceFileName).toBe('app.log');
    // The record spanned lines 1..5.
    expect(o.lineStart).toBe(1);
    expect(o.lineEnd).toBe(5);
  });

  it('extractRecord directly returns null for a record with no method+path', () => {
    const noise = 'some log4j line with no request at all';
    expect(extractRecord(LEGACYAPP_REQUEST_RECIPE, noise, 1, 1)).toBeNull();
  });

  it('assembles two consecutive SampleSvc records into two observations', () => {
    const content = [
      '1 > GET http://svc:8080/api/users/1',
      '1 > accept: application/json',
      '1 >',
      '1 > {}',
      '2 > POST http://svc:8080/api/orders',
      '2 > content-type: application/json',
      '2 >',
      '2 > {"x":1}',
    ].join('\n');

    const obs = extractWithRecipeFromContent(LEGACYAPP_REQUEST_RECIPE, content);
    expect(obs).toHaveLength(2);
    expect(obs[0].method).toBe('GET');
    expect(obs[0].rawPath).toBe('/api/users/1');
    expect(obs[1].method).toBe('POST');
    expect(obs[1].rawPath).toBe('/api/orders');
  });
});

// ----------------------------------------------------------------------------
// 2: response captured ONLY when present (never invented)
// ----------------------------------------------------------------------------

describe('recipeAwareExtractor — never invents a response', () => {
  it('emits NO response fields when the request logged no response', () => {
    const content = [
      '9 > PUT http://svc:8080/api/users/9',
      '9 > content-type: application/json',
      '9 >',
      '9 > {"name":"Ada"}',
    ].join('\n');

    // Even with a response-aware recipe, a request-only record yields no status/body.
    const obs = extractWithRecipeFromContent(LEGACYAPP_WITH_RESPONSE_RECIPE, content);
    expect(obs).toHaveLength(1);
    expect(obs[0].status).toBeUndefined();
    expect(obs[0].responseBody).toBeUndefined();
  });

  it('captures response status+body ONLY when the record actually logged them', () => {
    const content = [
      '5 > GET http://svc:8080/api/health',
      '5 >',
      '5 < HTTP/1.1 200 OK',
      '5 < {"status":"UP"}',
    ].join('\n');

    const obs = extractWithRecipeFromContent(LEGACYAPP_WITH_RESPONSE_RECIPE, content);
    expect(obs).toHaveLength(1);
    expect(obs[0].method).toBe('GET');
    expect(obs[0].rawPath).toBe('/api/health');
    expect(obs[0].status).toBe(200);
    expect(obs[0].responseBody).toContain('UP');
  });
});

// ----------------------------------------------------------------------------
// 3 + 4: interleaved noise + streamed pass
// ----------------------------------------------------------------------------

describe('recipeAwareExtractor — interleaved noise + streaming', () => {
  it('does not let interleaved log4j noise corrupt record assembly', () => {
    const content = [
      '2026-06-20 10:00:00.123 [http-nio-8080-exec-1] [com.acme.Filter] INFO starting',
      '1 > POST http://svc:8080/api/orders/42',
      '2026-06-20 10:00:00.124 [http-nio-8080-exec-1] [com.acme.Trace] DEBUG wrote header',
      '1 > content-type: application/json',
      '1 >',
      '1 > {"item":"widget"}',
      '2026-06-20 10:00:00.200 [http-nio-8080-exec-2] [com.acme.Pool] INFO idle',
      '2 > GET http://svc:8080/api/users/7',
      '2 > accept: application/json',
      '2 >',
      '2 > {}',
      '2026-06-20 10:00:00.300 [main] [com.acme.Health] INFO ok',
    ].join('\n');

    const obs = extractWithRecipeFromContent(LEGACYAPP_REQUEST_RECIPE, content);

    // Exactly the two real requests, despite the interleaved banners.
    expect(obs).toHaveLength(2);
    expect(obs[0].method).toBe('POST');
    expect(obs[0].rawPath).toBe('/api/orders/42');
    // The noise line that followed the body is absorbed as continuation of the
    // open record but contributes no method+path of its own, and crucially does
    // NOT spawn a phantom observation.
    expect(obs[1].method).toBe('GET');
    expect(obs[1].rawPath).toBe('/api/users/7');
    // Body still recovered correctly even with a trailing noise line in record 1.
    expect(obs[0].requestBody).toContain('widget');
  });

  it('extracts in a STREAMED pass over a real file on disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-extract-'));
    const file = path.join(dir, 'samplesvc.log');
    // Build a multi-record file; interleave a noise line between records.
    const records: string[] = [];
    for (let i = 1; i <= 25; i++) {
      records.push(`${i} > POST http://svc:8080/api/orders/${i}`);
      records.push(`${i} > content-type: application/json`);
      records.push(`${i} >`);
      records.push(`${i} > {"n":${i}}`);
      records.push(`2026-06-20 10:00:0${i % 10}.000 [exec] [Logger] INFO tick`);
    }
    fs.writeFileSync(file, records.join('\n'), 'utf8');

    try {
      const obs = await extractWithRecipe(file, LEGACYAPP_REQUEST_RECIPE, {
        sourceArtifactId: 'art-stream',
        sourceFileName: 'samplesvc.log',
      });
      expect(obs).toHaveLength(25);
      expect(obs[0].method).toBe('POST');
      expect(obs[0].normalizedPath).toBe('/api/orders/{id}');
      expect(obs[24].rawPath).toBe('/api/orders/25');
      // Every observation carries its source metadata + a line range.
      expect(obs[0].sourceArtifactId).toBe('art-stream');
      expect(obs[0].lineEnd).toBeGreaterThanOrEqual(obs[0].lineStart);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
