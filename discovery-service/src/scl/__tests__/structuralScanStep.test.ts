/**
 * Structural-scan-as-a-code-discovery-step tests (2026-08-19 ruling: the ONE
 * code scan produces the structural model — no separate trigger).
 *
 * Pins: the never-throws fail-soft contract, the no-Java skip (NO scan row —
 * an empty scan must never supersede a real corpus for the architecture),
 * the outcome mapping from the runner result, and the real-fs Java walk
 * (fixture app positive; excluded-dirs negative).
 */

import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import {
  hasJavaSources,
  runStructuralScanStep,
} from '../structuralScanStep';
import type { RunSclScanArgs, RunSclScanResult } from '../sclScanRunner';

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'legacy-app');

const ARGS = {
  projectId: 'proj-1',
  architectureId: 'arch-1',
  sourceDir: '/tmp/some-clone',
};

function fakeResult(overrides?: Partial<{ scanId: string; contractCount: number }>): RunSclScanResult {
  return {
    scanId: overrides?.scanId ?? 'scan-9',
    corpus: {
      stats: { contractCount: overrides?.contractCount ?? 42 },
    } as unknown as RunSclScanResult['corpus'],
  };
}

/** Minimal fetch fake for the gateway annotation request. */
function fakeFetch(options?: { status?: number; throwWith?: string }) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fn = (async (url: unknown, init?: { body?: unknown }) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (options?.throwWith) throw new Error(options.throwWith);
    const status = options?.status ?? 202;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (status >= 300 ? 'annotation route error body' : ''),
    } as unknown as Response;
  }) as typeof fetch;
  return { fn, calls };
}

describe('runStructuralScanStep', () => {
  it('maps a successful run to completed + scanId + contractCount, and requests annotation', async () => {
    const recorded: RunSclScanArgs[] = [];
    const gateway = fakeFetch();
    const result = await runStructuralScanStep(ARGS, {
      hasJava: async () => true,
      runScan: async (a) => {
        recorded.push(a);
        return fakeResult({ scanId: 'scan-77', contractCount: 133 });
      },
      fetchFn: gateway.fn,
    });
    expect(result.outcome).toEqual({
      status: 'completed',
      scanId: 'scan-77',
      contractCount: 133,
      detail: null,
      annotation: { status: 'requested', detail: null },
    });
    // The in-memory corpus rides back for same-run consumers (effect
    // candidates) — never serialized into the payload outcome.
    expect(result.corpus).not.toBeNull();
    expect(
      (result.corpus as { stats: { contractCount: number } }).stats.contractCount,
    ).toBe(133);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].sourceDir).toBe('/tmp/some-clone');
    expect(recorded[0].projectId).toBe('proj-1');
    expect(recorded[0].architectureId).toBe('arch-1');
    // The AMS base URL comes from config — present, never empty.
    expect(typeof recorded[0].amsBaseUrl).toBe('string');
    expect(recorded[0].amsBaseUrl.length).toBeGreaterThan(0);
    // The auto-annotation request targets the gateway route with the scan id.
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0].url).toContain('/projects/proj-1/architectures/arch-1/scl/annotation/run');
    expect(gateway.calls[0].body).toEqual({ scan_id: 'scan-77' });
  });

  it('records request_failed (scan still completed) when the gateway is down', async () => {
    const gateway = fakeFetch({ throwWith: 'connect ECONNREFUSED 127.0.0.1:8081' });
    const { outcome } = await runStructuralScanStep(ARGS, {
      hasJava: async () => true,
      runScan: async () => fakeResult(),
      fetchFn: gateway.fn,
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.annotation?.status).toBe('request_failed');
    expect(outcome.annotation?.detail).toContain('ECONNREFUSED');
  });

  it('records request_failed with the HTTP status on a non-2xx gateway answer', async () => {
    const gateway = fakeFetch({ status: 503 });
    const { outcome } = await runStructuralScanStep(ARGS, {
      hasJava: async () => true,
      runScan: async () => fakeResult(),
      fetchFn: gateway.fn,
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.annotation?.status).toBe('request_failed');
    expect(outcome.annotation?.detail).toContain('HTTP 503');
  });

  it('skips WITHOUT calling the runner or the gateway when the root has no Java sources', async () => {
    let runnerCalled = false;
    const gateway = fakeFetch();
    const result = await runStructuralScanStep(ARGS, {
      hasJava: async () => false,
      runScan: async () => {
        runnerCalled = true;
        return fakeResult();
      },
      fetchFn: gateway.fn,
    });
    expect(result.outcome.status).toBe('skipped');
    expect(result.outcome.scanId).toBeNull();
    expect(result.outcome.detail).toContain('no Java sources');
    expect(result.outcome.annotation).toBeNull();
    expect(result.corpus).toBeNull();
    expect(runnerCalled).toBe(false);
    expect(gateway.calls).toHaveLength(0);
  });

  it('never throws: a runner failure becomes a failed outcome, no annotation request', async () => {
    const gateway = fakeFetch();
    const result = await runStructuralScanStep(ARGS, {
      hasJava: async () => true,
      runScan: async () => {
        throw new Error('AMS bulk upsert returned 502');
      },
      fetchFn: gateway.fn,
    });
    expect(result.outcome.status).toBe('failed');
    expect(result.outcome.scanId).toBeNull();
    expect(result.outcome.detail).toContain('AMS bulk upsert returned 502');
    expect(result.outcome.annotation).toBeNull();
    expect(result.corpus).toBeNull();
    expect(gateway.calls).toHaveLength(0);
  });

  it('never throws: a detection failure becomes a failed outcome', async () => {
    const { outcome, corpus } = await runStructuralScanStep(ARGS, {
      hasJava: async () => {
        throw new Error('EACCES: permission denied');
      },
      runScan: async () => fakeResult(),
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('Java-source detection failed');
    expect(outcome.detail).toContain('EACCES');
    expect(corpus).toBeNull();
  });
});

describe('hasJavaSources (real fs)', () => {
  it('finds Java in the fixture legacy app', async () => {
    await expect(hasJavaSources(FIXTURE_ROOT)).resolves.toBe(true);
  });

  it('is false for a tree whose only .java files sit in excluded dirs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scl-step-'));
    try {
      await fs.mkdir(path.join(root, 'target', 'classes'), { recursive: true });
      await fs.writeFile(path.join(root, 'target', 'classes', 'Gen.java'), 'class Gen {}');
      await fs.mkdir(path.join(root, 'docs'), { recursive: true });
      await fs.writeFile(path.join(root, 'docs', 'readme.md'), 'no java here');
      await expect(hasJavaSources(root)).resolves.toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('is false for a missing directory (unreadable subtree tolerated)', async () => {
    await expect(hasJavaSources(path.join(os.tmpdir(), 'scl-step-does-not-exist'))).resolves.toBe(
      false,
    );
  });
});
