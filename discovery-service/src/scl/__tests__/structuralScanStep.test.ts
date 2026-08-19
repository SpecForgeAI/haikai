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

describe('runStructuralScanStep', () => {
  it('maps a successful run to completed + scanId + contractCount', async () => {
    const recorded: RunSclScanArgs[] = [];
    const outcome = await runStructuralScanStep(ARGS, {
      hasJava: async () => true,
      runScan: async (a) => {
        recorded.push(a);
        return fakeResult({ scanId: 'scan-77', contractCount: 133 });
      },
    });
    expect(outcome).toEqual({
      status: 'completed',
      scanId: 'scan-77',
      contractCount: 133,
      detail: null,
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].sourceDir).toBe('/tmp/some-clone');
    expect(recorded[0].projectId).toBe('proj-1');
    expect(recorded[0].architectureId).toBe('arch-1');
    // The AMS base URL comes from config — present, never empty.
    expect(typeof recorded[0].amsBaseUrl).toBe('string');
    expect(recorded[0].amsBaseUrl.length).toBeGreaterThan(0);
  });

  it('skips WITHOUT calling the runner when the root has no Java sources', async () => {
    let runnerCalled = false;
    const outcome = await runStructuralScanStep(ARGS, {
      hasJava: async () => false,
      runScan: async () => {
        runnerCalled = true;
        return fakeResult();
      },
    });
    expect(outcome.status).toBe('skipped');
    expect(outcome.scanId).toBeNull();
    expect(outcome.detail).toContain('no Java sources');
    expect(runnerCalled).toBe(false);
  });

  it('never throws: a runner failure becomes a failed outcome with the reason', async () => {
    const outcome = await runStructuralScanStep(ARGS, {
      hasJava: async () => true,
      runScan: async () => {
        throw new Error('AMS bulk upsert returned 502');
      },
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.scanId).toBeNull();
    expect(outcome.detail).toContain('AMS bulk upsert returned 502');
  });

  it('never throws: a detection failure becomes a failed outcome', async () => {
    const outcome = await runStructuralScanStep(ARGS, {
      hasJava: async () => {
        throw new Error('EACCES: permission denied');
      },
      runScan: async () => fakeResult(),
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('Java-source detection failed');
    expect(outcome.detail).toContain('EACCES');
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
