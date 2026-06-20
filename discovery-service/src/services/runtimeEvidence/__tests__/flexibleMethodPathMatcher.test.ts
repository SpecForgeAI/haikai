/**
 * Task Group 1 — Flexible deterministic HTTP method+path matcher.
 *
 * The current `HTTP_METHOD_PATH_REGEX` required a `/`-leading path
 * IMMEDIATELY after the method, so a bespoke HiFi trace line of the form
 * `POST http://host:port/path` (an ABSOLUTE URL) extracted ZERO
 * observations. This file pins the broadened behaviour:
 *
 *   1. Absolute-URL case (THE load-bearing failure): a `POST
 *      http://host:port/api/orders ... 201` line yields method `POST`,
 *      path `/api/orders` (scheme/host/port stripped), status `201`.
 *   2. Bare-path regression: `GET /api/users ... 200` still yields method
 *      `GET`, path `/api/users`, status `200` (existing behaviour intact).
 *   3. Status capture preserved: the KV-tail and bare-after-quote status
 *      fallbacks still fire on the broadened path.
 *   4. Non-request lines (a log4j banner) yield NO match.
 *
 * It also exercises the exported `detectRequestLikeLine` primitive that
 * Task Group 2's pre-scan reuses, so the candidate detector and the
 * fallback matcher share one source of truth.
 *
 * Pure-module tests, no mocks.
 */

import {
  tryExtractFromMessage,
  detectRequestLikeLine,
  LogFileArtifactEntry,
} from '../runDiscoveryRuntimeEvidence';
import type { ParsedLogEntry } from '../../../types/logParsing';

const TEST_ARTIFACT: LogFileArtifactEntry = {
  artifactId: 'art-1',
  originalFileName: 'hifi.log',
  relativePath: 'logs/hifi.log',
};

function makeEntry(line: string, lineNumber = 1): ParsedLogEntry {
  return {
    timestamp: null,
    level: null,
    logger: null,
    message: line,
    rawLine: line,
    lineNumber,
    metadata: {},
  };
}

describe('flexible HTTP method+path matcher — absolute URL support', () => {
  it('extracts method + PATH from an absolute-URL line (the HiFi failing case)', () => {
    // The bespoke HiFi trace shape: METHOD <absolute-URL> ... status.
    const entry = makeEntry(
      'req-42 > POST http://orders-svc:8080/api/orders status=201',
    );

    const obs = tryExtractFromMessage(entry, TEST_ARTIFACT);

    expect(obs).not.toBeNull();
    expect(obs!.method).toBe('POST');
    // Scheme / host / port stripped -> the PATH portion only.
    expect(obs!.rawPath).toBe('/api/orders');
    expect(obs!.status).toBe(201);
  });

  it('strips the host:port but preserves a query string on the path', () => {
    const entry = makeEntry(
      'GET https://api.example.com:443/api/users?active=true 200',
    );

    const obs = tryExtractFromMessage(entry, TEST_ARTIFACT);

    expect(obs).not.toBeNull();
    expect(obs!.method).toBe('GET');
    // rawPath keeps the query (normalizePath later collapses ids); host gone.
    expect(obs!.rawPath).toBe('/api/users?active=true');
    expect(obs!.rawPath).not.toContain('api.example.com');
    expect(obs!.status).toBe(200);
  });

  it('REGRESSION: a bare-path line still extracts method/path/status', () => {
    const entry = makeEntry('GET /api/users 200');

    const obs = tryExtractFromMessage(entry, TEST_ARTIFACT);

    expect(obs).not.toBeNull();
    expect(obs!.method).toBe('GET');
    expect(obs!.rawPath).toBe('/api/users');
    expect(obs!.status).toBe(200);
  });

  it('preserves the KV-tail status fallback on the broadened matcher', () => {
    // No status adjacent to the request line; status lives in the KV tail.
    const entry = makeEntry(
      '10.0.0.1 - - [12/May/2026:09:01:14 +0000] "GET /vets.html HTTP/1.1" port=8080 statusCode=200 responseBytes=8132',
    );

    const obs = tryExtractFromMessage(entry, TEST_ARTIFACT);

    expect(obs).not.toBeNull();
    expect(obs!.method).toBe('GET');
    expect(obs!.rawPath).toBe('/vets.html');
    expect(obs!.status).toBe(200);
  });

  it('ignores a non-request log4j banner line (no method+path)', () => {
    const entry = makeEntry(
      '2026-05-12 09:01:14.123 [main] INFO com.example.App - Started Application in 4.2 seconds',
    );

    const obs = tryExtractFromMessage(entry, TEST_ARTIFACT);

    expect(obs).toBeNull();
  });
});

describe('detectRequestLikeLine primitive (shared with TG2 pre-scan)', () => {
  it('detects an absolute-URL request line and returns the stripped path', () => {
    const hit = detectRequestLikeLine(
      'req-42 > POST http://orders-svc:8080/api/orders',
    );
    expect(hit).not.toBeNull();
    expect(hit!.method).toBe('POST');
    expect(hit!.path).toBe('/api/orders');
  });

  it('detects a bare-path request line', () => {
    const hit = detectRequestLikeLine('GET /api/users HTTP/1.1 200');
    expect(hit).not.toBeNull();
    expect(hit!.method).toBe('GET');
    expect(hit!.path).toBe('/api/users');
  });

  it('returns null for a non-request line', () => {
    expect(
      detectRequestLikeLine('[main] INFO com.example.App - Started in 4.2s'),
    ).toBeNull();
    expect(detectRequestLikeLine('')).toBeNull();
  });
});
