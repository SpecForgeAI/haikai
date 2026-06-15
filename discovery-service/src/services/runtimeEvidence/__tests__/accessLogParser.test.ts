/**
 * Foundation tests for accessLogParser.
 *
 * Per Spec 5 Task 1.1, just two focused tests — one Common Log Format
 * line and one Combined Log Format line — covering the critical
 * extraction behaviour (method, path, status, timestamp) and the
 * privacy invariant (referrer / user-agent / IP DISCARDED, never
 * appearing in the parsed output).
 */

import { parseClfLine } from '../accessLogParser';

describe('accessLogParser.parseClfLine', () => {
  it('parses a Common Log Format line and extracts method, path, status, and timestamp', () => {
    const line =
      '127.0.0.1 - frank [10/Oct/2026:13:55:36 +0000] "GET /api/users/123 HTTP/1.1" 200 2326';
    const result = parseClfLine(line, 'clf_common', 42);

    expect(result).not.toBeNull();
    expect(result!.method).toBe('GET');
    expect(result!.rawPath).toBe('/api/users/123');
    expect(result!.normalizedPath).toBe('/api/users/{id}');
    expect(result!.status).toBe(200);
    expect(result!.timestampIso).toBe('2026-10-10T13:55:36.000Z');
    expect(result!.lineNumber).toBe(42);
    // Snippet must NOT include IP, ident, authuser
    expect(result!.snippet).not.toContain('127.0.0.1');
    expect(result!.snippet).not.toContain('frank');
  });

  it('parses a Combined Log Format line, extracting the same fields and discarding referrer + user-agent', () => {
    const line =
      '203.0.113.5 - - [10/Oct/2026:14:02:11 +0000] "POST /orders HTTP/1.1" 201 512 "https://example.com/checkout" "Mozilla/5.0 (X11; Linux) AppleWebKit/537.36"';
    const result = parseClfLine(line, 'clf_combined', 7);

    expect(result).not.toBeNull();
    expect(result!.method).toBe('POST');
    expect(result!.rawPath).toBe('/orders');
    expect(result!.normalizedPath).toBe('/orders');
    expect(result!.status).toBe(201);
    expect(result!.timestampIso).toBe('2026-10-10T14:02:11.000Z');
    expect(result!.lineNumber).toBe(7);
    // Privacy invariant — IP, referrer, user-agent must NOT be retained anywhere on the result
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('203.0.113.5');
    expect(serialized).not.toContain('example.com/checkout');
    expect(serialized).not.toContain('Mozilla/5.0');
  });
});
