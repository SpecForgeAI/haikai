/**
 * Task Group 2 — Streaming pre-scan + sample-block assembler.
 *
 * Pins the 7 load-bearing behaviours from tasks.md 2.1:
 *   1. Block assembly: a hit yields a window of ~10 lines before + ~30 after.
 *   2. Byte-offset spread: hits clustered at the top do NOT crowd out
 *      later-file blocks.
 *   3. Dedup: many near-identical hammered-endpoint blocks collapse.
 *   4. Redaction applied: a planted secret in a block is scrubbed.
 *   5. Budget caps: per-line truncation ~2k chars; total ≤ ~12k chars.
 *   6. No-hits fallback: zero request-like lines -> head/middle/tail windows.
 *   7. Determinism: same input bytes -> identical block selection.
 *
 * Most assertions use the in-memory `preScanAndSampleContent` for
 * determinism; one test exercises the streaming `preScanAndSample` against a
 * real temp file to cover the createReadStream + readline path.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  preScanAndSample,
  preScanAndSampleContent,
  isRequestLikeLine,
  BLOCK_LINES_BEFORE,
  BLOCK_LINES_AFTER,
  MAX_LINE_CHARS,
  MAX_SAMPLE_CHARS,
  MAX_TARGET_BLOCKS,
} from '../logPreScanSampler';

/** Build a synthetic log of `n` noise lines with optional injected lines. */
function buildLog(n: number, inject: Record<number, string> = {}): string {
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    if (inject[i] !== undefined) {
      lines.push(inject[i]);
    } else {
      lines.push(
        `2026-05-12 09:00:${String(i % 60).padStart(2, '0')}.000 [main] INFO com.example.App - heartbeat tick ${i}`,
      );
    }
  }
  return lines.join('\n');
}

describe('logPreScanSampler — candidate detection', () => {
  it('flags absolute-URL, bare-path, and bare /seg/seg lines as request-like', () => {
    expect(isRequestLikeLine('req-1 > POST http://svc:8080/api/orders')).toBe(true);
    expect(isRequestLikeLine('GET /api/users 200')).toBe(true);
    expect(isRequestLikeLine('handling request for /api/v1/widgets now')).toBe(true);
    expect(isRequestLikeLine('[main] INFO com.example.App - started')).toBe(false);
    expect(isRequestLikeLine('')).toBe(false);
  });
});

describe('logPreScanSampler — block assembly', () => {
  it('assembles a hit into a window of ~10 lines before + ~30 after', () => {
    // Single hit at line 40 in a 100-line file.
    const content = buildLog(100, {
      40: 'req-7 > POST http://orders:8080/api/orders status=201',
    });
    const result = preScanAndSampleContent(content);

    expect(result.hitCount).toBe(1);
    expect(result.blocks).toHaveLength(1);
    const block = result.blocks[0];
    expect(block.startLineIndex).toBe(40 - BLOCK_LINES_BEFORE);
    expect(block.endLineIndex).toBe(40 + BLOCK_LINES_AFTER);
    // Window spans before+self+after lines.
    const lineCount = block.text.split('\n').length;
    expect(lineCount).toBe(BLOCK_LINES_BEFORE + 1 + BLOCK_LINES_AFTER);
  });
});

describe('logPreScanSampler — byte-offset spread', () => {
  it('does not let top-clustered hits crowd out later-file blocks', () => {
    // 30 distinct hits jammed into the first 60 lines, plus ONE distinct hit
    // near the very end of a long file. The end hit MUST be represented.
    const inject: Record<number, string> = {};
    for (let i = 0; i < 30; i++) {
      inject[i * 2] = `req-${i} > GET http://svc:8080/api/early/${i} status=200`;
    }
    const lastHitLine = 980;
    inject[lastHitLine] =
      'req-late > DELETE http://svc:8080/api/late/resource status=204';
    const content = buildLog(1000, inject);

    const result = preScanAndSampleContent(content);

    expect(result.blocks.length).toBeLessThanOrEqual(MAX_TARGET_BLOCKS);
    // The late hit's line index falls inside one of the selected blocks.
    const coversLate = result.blocks.some(
      (b) => b.startLineIndex <= lastHitLine && b.endLineIndex >= lastHitLine,
    );
    expect(coversLate).toBe(true);
    // And the assembled sample literally contains the late path.
    expect(result.assembledSample).toContain('/api/late/resource');
  });
});

describe('logPreScanSampler — dedup', () => {
  it('collapses many near-identical hammered-endpoint blocks', () => {
    // The SAME endpoint hammered 40 times with varying ids/timestamps, spaced
    // far enough apart that each would be its own block but for dedup.
    const inject: Record<number, string> = {};
    for (let i = 0; i < 40; i++) {
      inject[i * 20] = `req-${1000 + i} > GET http://svc:8080/api/orders/${i} status=200`;
    }
    const content = buildLog(900, inject);

    const result = preScanAndSampleContent(content);

    // Despite 40 hits across the file, the near-identical signature collapses
    // them to a single representative block.
    expect(result.hitCount).toBe(40);
    expect(result.blocks).toHaveLength(1);
  });
});

describe('logPreScanSampler — redaction', () => {
  it('scrubs a planted secret in a sample block', () => {
    const secret = 'super-secret-value-123';
    const content = buildLog(60, {
      20: 'req-1 > POST http://svc:8080/api/login status=200',
      22: `req-1 > Authorization: Bearer ${secret}`,
      24: `req-1 > db connect: password=${secret} host=db`,
    });

    const result = preScanAndSampleContent(content);

    expect(result.assembledSample).not.toContain(secret);
    expect(result.assembledSample).toContain('<REDACTED>');
  });
});

describe('logPreScanSampler — budget caps', () => {
  it('truncates an over-long individual line to ~2k chars', () => {
    const hugePayload = 'x'.repeat(5000);
    const content = buildLog(60, {
      20: 'req-1 > POST http://svc:8080/api/data status=200',
      22: `req-1 > body: ${hugePayload}`,
    });

    const result = preScanAndSampleContent(content);

    // No single line in the assembled output exceeds the per-line cap (+marker).
    for (const line of result.assembledSample.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(MAX_LINE_CHARS + 20);
    }
    expect(result.assembledSample).not.toContain(hugePayload);
  });

  it('caps the assembled sample to ~12k chars total', () => {
    // Many distinct endpoints across the file, each block ~40 lines of
    // moderate length, so the assembled total would blow past 12k without
    // the cap.
    const inject: Record<number, string> = {};
    for (let i = 0; i < 12; i++) {
      inject[i * 100] = `req-${i} > GET http://svc:8080/api/distinct/path/${i}/resource status=200`;
    }
    // Pad noise lines so each block carries substantial bytes.
    const content = buildLog(1300, inject)
      .split('\n')
      .map((l) => l + ' '.repeat(120))
      .join('\n');

    const result = preScanAndSampleContent(content);

    expect(result.assembledSample.length).toBeLessThanOrEqual(MAX_SAMPLE_CHARS);
  });
});

describe('logPreScanSampler — no-hits fallback', () => {
  it('returns offset-stratified head/middle/tail windows when there are zero hits', () => {
    // Pure noise: no verbs, no URLs, no /seg/seg tokens.
    const lines: string[] = [];
    for (let i = 0; i < 120; i++) {
      lines.push(`2026-05-12 09:00:00.000 [main] INFO Heartbeat number ${i} ok`);
    }
    const content = lines.join('\n');

    const result = preScanAndSampleContent(content);

    expect(result.hitCount).toBe(0);
    expect(result.usedFallbackWindows).toBe(true);
    expect(result.blocks.length).toBeGreaterThanOrEqual(2);
    expect(result.assembledSample.length).toBeGreaterThan(0);
    // Head window starts at line 0; a later window is anchored deeper in.
    const starts = result.blocks.map((b) => b.startLineIndex);
    expect(starts[0]).toBe(0);
    expect(Math.max(...starts)).toBeGreaterThan(0);
  });
});

describe('logPreScanSampler — determinism', () => {
  it('produces identical block selection for identical input bytes', () => {
    const inject: Record<number, string> = {};
    for (let i = 0; i < 20; i++) {
      inject[i * 40] = `req-${i} > GET http://svc:8080/api/path/${i} status=200`;
    }
    const content = buildLog(900, inject);

    const a = preScanAndSampleContent(content);
    const b = preScanAndSampleContent(content);

    expect(a.blocks.map((x) => x.hitLineIndex)).toEqual(
      b.blocks.map((x) => x.hitLineIndex),
    );
    expect(a.assembledSample).toBe(b.assembledSample);
  });
});

describe('logPreScanSampler — streaming path', () => {
  it('streams a real temp file and produces redacted, budgeted blocks', async () => {
    const content = buildLog(80, {
      30: 'req-1 > POST http://svc:8080/api/orders status=201',
      32: 'req-1 > Authorization: Bearer leaky-token-streaming-xyz',
    });
    const tmp = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'prescan-')),
      'sample.log',
    );
    fs.writeFileSync(tmp, content, 'utf8');

    try {
      const result = await preScanAndSample(tmp);
      expect(result.hitCount).toBeGreaterThanOrEqual(1);
      expect(result.blocks.length).toBeGreaterThanOrEqual(1);
      expect(result.assembledSample).toContain('/api/orders');
      expect(result.assembledSample).not.toContain('leaky-token-streaming-xyz');
      expect(result.assembledSample.length).toBeLessThanOrEqual(MAX_SAMPLE_CHARS);
    } finally {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  });
});
