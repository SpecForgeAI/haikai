/**
 * Tests for the runtime-evidence atom builder (Task Group 7).
 *
 * The load-bearing assertion is the gap-clearing contract: every atom must
 * carry `source: 'log'` with `type: 'string_pattern'`,
 * `data.patternName: 'endpoint_usage_log'`, and a populated `logOrigin`. That is
 * the EXACT shape AMS `buildRuntimeUsageSummary` counts
 * (`runtimeEvidence = count of discovery_evidence rows where source == 'log'`),
 * so these atoms are what flips `hasRuntimeEvidence` true and clears the
 * `insufficient_runtime_evidence` gap.
 */

import { buildLogEvidenceAtoms } from '../runtimeEvidenceAtomBuilder';
import type { RichObservation } from '../knownFormatFastPath';

const CTX = {
  runId: '11111111-1111-1111-1111-111111111111',
  repoUrl: 'https://example.com/repo.git',
  logFilePath: 'app-2026-06-20.log',
};

function obs(partial: Partial<RichObservation>): RichObservation {
  return {
    method: 'GET',
    rawPath: '/api/users/42',
    normalizedPath: '/api/users/{id}',
    lineNumber: 1,
    ...partial,
  };
}

describe('runtimeEvidenceAtomBuilder.buildLogEvidenceAtoms', () => {
  it('produces source:log string_pattern atoms with patternName endpoint_usage_log and populated logOrigin', () => {
    const atoms = buildLogEvidenceAtoms(
      [obs({ method: 'POST', rawPath: '/api/orders', normalizedPath: '/api/orders', status: 201, lineNumber: 7 })],
      CTX,
    );

    expect(atoms).toHaveLength(1);
    const atom = atoms[0];
    // The EXACT gap-clearing condition AMS buildRuntimeUsageSummary counts.
    expect(atom.source).toBe('log');
    expect(atom.type).toBe('string_pattern');
    expect((atom.data as { patternName: string }).patternName).toBe('endpoint_usage_log');
    expect((atom.data as { matchedText: string }).matchedText).toBe('POST /api/orders');
    expect(atom.logOrigin).toBeDefined();
    expect(atom.logOrigin!.filePath).toBe(CTX.logFilePath);
    expect(atom.logOrigin!.lineStart).toBe(7);
    expect(atom.logOrigin!.lineEnd).toBe(7);
    expect(atom.logOrigin!.occurrenceCount).toBe(1);
    expect(atom.runId).toBe(CTX.runId);
    expect(atom.filePath).toBe(CTX.logFilePath);
  });

  it('aggregates repeated METHOD+normalizedPath into one atom with an occurrence count and line span', () => {
    const atoms = buildLogEvidenceAtoms(
      [
        obs({ rawPath: '/api/users/1', lineNumber: 3, status: 200 }),
        obs({ rawPath: '/api/users/2', lineNumber: 9, status: 200 }),
        obs({ rawPath: '/api/users/3', lineNumber: 5, status: 404 }),
      ],
      CTX,
    );

    expect(atoms).toHaveLength(1);
    const atom = atoms[0];
    expect(atom.logOrigin!.occurrenceCount).toBe(3);
    // First/last lines span the min/max observed lines regardless of input order.
    expect(atom.logOrigin!.lineStart).toBe(3);
    expect(atom.logOrigin!.lineEnd).toBe(9);
  });

  it('emits a distinct atom per distinct METHOD+normalizedPath, all source:log', () => {
    const atoms = buildLogEvidenceAtoms(
      [
        obs({ method: 'GET', rawPath: '/api/users/1', normalizedPath: '/api/users/{id}' }),
        obs({ method: 'DELETE', rawPath: '/api/users/1', normalizedPath: '/api/users/{id}' }),
        obs({ method: 'GET', rawPath: '/api/orders', normalizedPath: '/api/orders' }),
      ],
      CTX,
    );
    expect(atoms).toHaveLength(3);
    expect(atoms.every((a) => a.source === 'log')).toBe(true);
    const ids = new Set(atoms.map((a) => a.id));
    expect(ids.size).toBe(3); // deterministic ids are distinct per endpoint
  });

  it('uses the recipe-aware lineStart/lineEnd record range when present', () => {
    const ranged = {
      ...obs({ method: 'POST', rawPath: '/api/orders', normalizedPath: '/api/orders', status: 201 }),
      lineStart: 12,
      lineEnd: 18,
    } as RichObservation;
    const atoms = buildLogEvidenceAtoms([ranged], CTX);
    expect(atoms[0].logOrigin!.lineStart).toBe(12);
    expect(atoms[0].logOrigin!.lineEnd).toBe(18);
  });

  it('skips observations without a usable method or /path and returns [] when none are usable', () => {
    const atoms = buildLogEvidenceAtoms(
      [
        obs({ method: '', normalizedPath: '/api/x' }),
        obs({ method: 'GET', normalizedPath: 'not-a-path', rawPath: 'not-a-path' }),
      ],
      CTX,
    );
    expect(atoms).toEqual([]);
  });

  it('does not invent a response: contextSnippet omits status when none was logged', () => {
    const atoms = buildLogEvidenceAtoms(
      [obs({ method: 'GET', rawPath: '/api/ping', normalizedPath: '/api/ping' })],
      CTX,
    );
    expect(atoms).toHaveLength(1);
    expect((atoms[0].data as { contextSnippet: string }).contextSnippet).not.toMatch(/->/);
  });
});
