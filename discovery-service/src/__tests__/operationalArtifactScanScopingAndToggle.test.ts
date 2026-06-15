/**
 * Strategic gap-fill tests for Generic Operational-Artifact Discovery (D1).
 *
 * Spec: 2026-06-14, Task Group 4. Fills the feature-critical workflows the
 * Group 1-3 suites did not already cover:
 *  - end-to-end with a monitoring/connection XML fixture -> monitoring_config;
 *  - service-scoped scoping: a file OUTSIDE the run's include-paths is NOT
 *    scanned;
 *  - the always-on toggle (`OPERATIONAL_ARTIFACT_SCAN_ENABLED`): default ON,
 *    explicit `false` OFF (parsed from config);
 *  - a true content-addressed cache-HIT reuse (cache class level).
 *
 * Mocks `gatewayClient` -- NO live LLM. NO tree-sitter.
 */

// Mock the gateway client BEFORE importing the step under test.
jest.mock('../services/gatewayClient', () => ({
  gatewayClient: {
    summariseOperationalArtifact: jest.fn(),
  },
  OperationalArtifactGatewayError: class OperationalArtifactGatewayError extends Error {
    public readonly filePath: string;
    public readonly status: number | null;
    constructor(message: string, filePath: string, status: number | null) {
      super(message);
      this.name = 'OperationalArtifactGatewayError';
      this.filePath = filePath;
      this.status = status;
    }
  },
}));

import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { gatewayClient } from '../services/gatewayClient';
import { runOperationalArtifactScan } from '../services/operationalArtifactScanStep';
import {
  OperationalArtifactResponseCache,
  readOperationalArtifactCacheModel,
  OPERATIONAL_ARTIFACT_RELAY_TEMPERATURE,
} from '../services/operationalArtifactResponseCache';

const summariseMock = gatewayClient.summariseOperationalArtifact as jest.Mock;

function okResponse(overrides: Record<string, unknown> = {}): { content: string } {
  return {
    content: JSON.stringify({
      purpose: 'Operational file.',
      artifactKind: 'other',
      behaviourBearing: false,
      invokes: [],
      inputs: [],
      outputs: [],
      sideEffects: [],
      externalSystems: [],
      evidence: [],
      language: 'unknown',
      confidence: 0.6,
      ...overrides,
    }),
  };
}

let tmpDir: string;

async function writeFile(rel: string, contents: string): Promise<void> {
  const abs = path.join(tmpDir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents, 'utf-8');
}

beforeEach(async () => {
  summariseMock.mockReset();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-scope-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('runOperationalArtifactScan — monitoring XML end-to-end', () => {
  it('summarises a monitoring/connection .xml as a monitoring_config artifact', async () => {
    await writeFile('monitoring/geneos-gateway.xml', '<?xml version="1.0"?>\n<gateway><probe/></gateway>\n');
    summariseMock.mockResolvedValue(
      okResponse({ artifactKind: 'monitoring_config', language: 'xml', behaviourBearing: false }),
    );

    const result = await runOperationalArtifactScan({
      runId: 'run-oa-xml',
      repoRoot: tmpDir,
      claimedPaths: new Set<string>(), // unclaimed by any pack
    });

    const artifacts = result.findingInputs.filter((f) => f.findingType === 'operational_artifact');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].category).toBe('monitoring_config');
    const dj = artifacts[0].detailJson as Record<string, unknown>;
    expect(dj.artifactKind).toBe('monitoring_config');
    expect(dj.filePath).toBe('monitoring/geneos-gateway.xml');
    expect(dj.language).toBe('xml');
    expect(dj.relevanceSignal).toBe('operational_extension');
  });
});

describe('runOperationalArtifactScan — service-scoped scoping', () => {
  it('does NOT scan files outside the run include-paths', async () => {
    // In scope (under services/risk) + out of scope (under services/other).
    await writeFile('services/risk/bin/run.sh', '#!/bin/bash\necho in-scope\n');
    await writeFile('services/other/bin/run.sh', '#!/bin/bash\necho out-of-scope\n');
    summariseMock.mockResolvedValue(okResponse({ artifactKind: 'shell_script' }));

    const result = await runOperationalArtifactScan({
      runId: 'run-oa-scope',
      repoRoot: tmpDir,
      includePaths: ['services/risk'],
    });

    const artifacts = result.findingInputs.filter((f) => f.findingType === 'operational_artifact');
    expect(artifacts).toHaveLength(1);
    expect((artifacts[0].detailJson as any).filePath).toBe('services/risk/bin/run.sh');

    const calledPaths = summariseMock.mock.calls.map((c) => c[1]);
    expect(calledPaths).toEqual(['services/risk/bin/run.sh']);
    expect(calledPaths).not.toContain('services/other/bin/run.sh');
  });

  it('honours excludePaths within an in-scope tree', async () => {
    await writeFile('app/scripts/keep.sh', '#!/bin/bash\necho keep\n');
    await writeFile('app/scripts/test/skip.sh', '#!/bin/bash\necho skip\n');
    summariseMock.mockResolvedValue(okResponse({ artifactKind: 'shell_script' }));

    const result = await runOperationalArtifactScan({
      runId: 'run-oa-exclude',
      repoRoot: tmpDir,
      includePaths: ['app'],
      excludePaths: ['app/scripts/test'],
    });

    const calledPaths = summariseMock.mock.calls.map((c) => c[1]);
    expect(calledPaths).toEqual(['app/scripts/keep.sh']);
  });
});

describe('Operational-artifact always-on toggle (OPERATIONAL_ARTIFACT_SCAN_ENABLED)', () => {
  const ORIGINAL = process.env.OPERATIONAL_ARTIFACT_SCAN_ENABLED;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OPERATIONAL_ARTIFACT_SCAN_ENABLED;
    else process.env.OPERATIONAL_ARTIFACT_SCAN_ENABLED = ORIGINAL;
    jest.resetModules();
  });

  it('defaults the pass ON when the env var is unset', () => {
    delete process.env.OPERATIONAL_ARTIFACT_SCAN_ENABLED;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cfg = require('../config');
      expect(cfg.OPERATIONAL_ARTIFACT_SCAN_ENABLED).toBe(true);
    });
  });

  it('turns the pass OFF when the env var is the literal "false"', () => {
    process.env.OPERATIONAL_ARTIFACT_SCAN_ENABLED = 'false';
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cfg = require('../config');
      expect(cfg.OPERATIONAL_ARTIFACT_SCAN_ENABLED).toBe(false);
    });
  });

  it('leaves the pass ON for any non-"false" value (e.g. "true")', () => {
    process.env.OPERATIONAL_ARTIFACT_SCAN_ENABLED = 'true';
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cfg = require('../config');
      expect(cfg.OPERATIONAL_ARTIFACT_SCAN_ENABLED).toBe(true);
    });
  });
});

describe('OperationalArtifactResponseCache — content-addressed cache HIT', () => {
  it('returns the prior response on a byte-identical (prompt, model, temp) key and bumps hitCount', () => {
    const cache = new OperationalArtifactResponseCache();
    const model = readOperationalArtifactCacheModel();
    const prompt = '# summariser prompt\nfile: jobs/x.jil\n<contents>';
    const key = cache.keyFor(prompt, model, OPERATIONAL_ARTIFACT_RELAY_TEMPERATURE);

    expect(cache.get(key)).toBeUndefined(); // miss
    cache.set(key, { content: '{"purpose":"cached"}' });

    // A second lookup with the SAME (prompt, model, temperature) is a HIT.
    const again = cache.keyFor(prompt, model, OPERATIONAL_ARTIFACT_RELAY_TEMPERATURE);
    const hit = cache.get(again);
    expect(hit).toEqual({ content: '{"purpose":"cached"}' });
    expect(cache.hitCount).toBe(1);

    // A different prompt MISSES (different key).
    const other = cache.keyFor('different prompt', model, OPERATIONAL_ARTIFACT_RELAY_TEMPERATURE);
    expect(cache.get(other)).toBeUndefined();
  });
});
