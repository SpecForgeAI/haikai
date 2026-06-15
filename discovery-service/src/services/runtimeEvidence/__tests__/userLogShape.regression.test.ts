/**
 * Regression tests pinning the user's actual log-line shape and the
 * three Image-#5 hotfixes that make the runtime-evidence pipeline
 * recognise it.
 *
 * Why this file exists:
 *   The user's access logs do NOT match strict CLF — they tail the
 *   request line with key=value pairs (`port=8080 statusCode=200
 *   responseBytes=8132`). Earlier work added three fallbacks to make
 *   the pipeline pick this shape up, but at least one of them
 *   (`tryExtractFromMessage` KV-status fallback) was lost in a
 *   subsequent file rewrite. These tests are a CONTRACT — if a future
 *   rewrite drops any of the three behaviours below, these tests fail
 *   loudly.
 *
 * Pinned behaviours:
 *   1. `tryExtractFromMessage` KV-status fallback fires on a
 *      strict-format CLF-with-KV-tail line (Fix 2).
 *   2. `tryExtractFromMessage` extracts the status from the user's
 *      EXACT log shape `... port=8080 statusCode=200 responseBytes=8132`
 *      (Fix 2 — the format the user actually had open in the screenshot).
 *   3. End-to-end orchestrator-style: feed the three fixture lines
 *      through `parseLogContent` + per-entry `tryExtractFromMessage`,
 *      assert that 3 observations are emitted with method/path/status
 *      all populated.
 *   4. `arePathsEquivalentByPlaceholder('/owners/{id}', '/owners/123')`
 *      returns true (Fix 3b — placeholder dominates literal).
 *   5. `normalizePath('/owners/cloudprod-green.1777556997748.367530')`
 *      returns `/owners/{id}` (Fix 3a — LONG_TOKEN_REGEX includes dots).
 *
 * Pure-module tests, no mocks.
 */

import {
  tryExtractFromMessage,
  LogFileArtifactEntry,
} from '../runDiscoveryRuntimeEvidence';
import {
  arePathsEquivalentByPlaceholder,
  normalizePath,
} from '../endpointPathNormalizer';
import { parseLogContent } from '../../logParsing';
import type { ParsedLogEntry } from '../../../types/logParsing';

// The user's actual log lines (exact shape from the screenshot they
// showed). Pinned verbatim so any drift in the regex tail-matching
// fails this file before it can silently break the pipeline.
const USER_FIXTURE_LINES: string[] = [
  '10.0.12.45 sourceIP=- - - [12/May/2026:09:01:14 +0000] "GET /vets.html HTTP/1.1" port=8080 statusCode=200 responseBytes=8132',
  '10.0.12.45 sourceIP=- - - [12/May/2026:09:01:22 +0000] "GET /owners/find HTTP/1.1" port=8080 statusCode=200 responseBytes=3211',
  '11.193.196.176 sourceIP=- - - [13/May/2026:08:01:14 +0000] "GET /ui/owners/101 HTTP/1.1" port=10086 statusCode=200 responseBytes=5210',
];

const TEST_ARTIFACT: LogFileArtifactEntry = {
  artifactId: 'art-1',
  originalFileName: 'access.log',
  relativePath: 'logs/access.log',
};

function makeEntry(line: string, lineNumber: number): ParsedLogEntry {
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

describe('Image-#5 regression — user log shape', () => {
  it('Fix 2: tryExtractFromMessage extracts method/path/status=200 from a strict-format CLF-with-KV-tail line (KV fallback fires)', () => {
    const entry = makeEntry(USER_FIXTURE_LINES[0], 1);

    const obs = tryExtractFromMessage(entry, TEST_ARTIFACT);

    expect(obs).not.toBeNull();
    expect(obs!.method).toBe('GET');
    expect(obs!.rawPath).toBe('/vets.html');
    expect(obs!.status).toBe(200);
    // normalizedPath is rawPath here (no ID-bearing segments)
    expect(obs!.normalizedPath).toBe('/vets.html');
  });

  it("Fix 2: tryExtractFromMessage extracts status 200 from the user's EXACT `... port=8080 statusCode=200 responseBytes=8132` shape", () => {
    // The third fixture line: a /ui/owners/101 path with port=10086.
    // The 101 path segment normalizes to {id} (Tier 1 numeric).
    const entry = makeEntry(USER_FIXTURE_LINES[2], 1);

    const obs = tryExtractFromMessage(entry, TEST_ARTIFACT);

    expect(obs).not.toBeNull();
    expect(obs!.method).toBe('GET');
    expect(obs!.rawPath).toBe('/ui/owners/101');
    expect(obs!.normalizedPath).toBe('/ui/owners/{id}');
    expect(obs!.status).toBe(200);
  });

  it('End-to-end: feed the three fixture lines through parseLogContent + per-entry tryExtractFromMessage → 3 observations with method/path/status all populated', () => {
    // Join lines into a synthetic log file and parse via the same
    // parseLogContent the orchestrator uses for non-CLF formats. (The
    // user's lines fall through to plaintext / framework_pattern
    // depending on detection; either way, the message field carries
    // the full line.)
    const content = USER_FIXTURE_LINES.join('\n');
    const parsed = parseLogContent(content);

    expect(parsed.entries.length).toBe(3);

    const observations = parsed.entries
      .map((e) => tryExtractFromMessage(e, TEST_ARTIFACT))
      .filter((o): o is NonNullable<typeof o> => o !== null);

    expect(observations).toHaveLength(3);

    // Pin per-line outcomes. Order is preserved from input.
    expect(observations[0].method).toBe('GET');
    expect(observations[0].rawPath).toBe('/vets.html');
    expect(observations[0].status).toBe(200);

    expect(observations[1].method).toBe('GET');
    expect(observations[1].rawPath).toBe('/owners/find');
    expect(observations[1].status).toBe(200);

    expect(observations[2].method).toBe('GET');
    expect(observations[2].rawPath).toBe('/ui/owners/101');
    expect(observations[2].normalizedPath).toBe('/ui/owners/{id}');
    expect(observations[2].status).toBe(200);

    // Every observation has a non-zero status in the 100-599 range.
    for (const o of observations) {
      expect(o.status).toBeGreaterThanOrEqual(100);
      expect(o.status).toBeLessThanOrEqual(599);
    }
  });

  it("Fix 3b: arePathsEquivalentByPlaceholder('/owners/{id}', '/owners/123') returns true — placeholder dominates literal in the same position", () => {
    expect(arePathsEquivalentByPlaceholder('/owners/{id}', '/owners/123')).toBe(true);
    // Symmetry: literal-vs-placeholder both directions
    expect(arePathsEquivalentByPlaceholder('/owners/123', '/owners/{id}')).toBe(true);
    // Different LITERAL first segment still rejects (placeholder rule does not paper over distinct literals)
    expect(arePathsEquivalentByPlaceholder('/a/{id}', '/b/{id}')).toBe(false);
  });

  it("Fix 3a: normalizePath('/owners/cloudprod-green.1777556997748.367530') returns '/owners/{id}' — LONG_TOKEN_REGEX includes dots", () => {
    expect(
      normalizePath('/owners/cloudprod-green.1777556997748.367530'),
    ).toBe('/owners/{id}');

    // Sanity: a slug-only segment with dots but NO digits stays literal.
    expect(normalizePath('/owners/some.long.slug.name.here.value')).toBe(
      '/owners/some.long.slug.name.here.value',
    );

    // Sanity: a colon-segmented ID with digits also normalizes.
    expect(normalizePath('/objects/host.example.com:1700000000000')).toBe(
      '/objects/{id}',
    );
  });
});
