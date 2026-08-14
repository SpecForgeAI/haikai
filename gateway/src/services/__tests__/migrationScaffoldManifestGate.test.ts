/**
 * Scaffold manifest-gate diagnosis (2026-08-14). Pins the four named failure
 * modes — especially the upload/plan ARCHITECTURE-BINDING MISMATCH class
 * (manifest uploaded against a different target architecture than the plan's),
 * which previously read as a silent "no manifest" and cost a live plan its
 * scaffold story. Fail-soft: probe errors are recorded, never thrown.
 */

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  diagnoseScaffoldManifestGate,
  scaffoldManifestGateRemedy,
} from '../migrationScaffoldManifestGate';
import { TargetManifestArtifactWire } from '../targetManifestArtifactsClient';

const ARTIFACT = { tag: 'svc', content: '<project/>' } as TargetManifestArtifactWire;

function deps(overrides: {
  byArch?: Record<string, TargetManifestArtifactWire[]>;
  active?: string | null;
  saved?: string | null;
  artifactsThrow?: boolean;
}) {
  const byArch = overrides.byArch ?? {};
  return {
    fetchArtifacts: jest.fn(async (_p: string, arch: string) => {
      if (overrides.artifactsThrow) throw new Error('AMS 503');
      return byArch[arch] ?? [];
    }),
    fetchActiveArchId: jest.fn(async () => ({
      activeTargetArchitectureId: overrides.active ?? null,
    })),
    fetchSavedArchId: jest.fn(async () => ({
      savedTargetArchitectureId: overrides.saved ?? null,
    })),
  };
}

describe('diagnoseScaffoldManifestGate', () => {
  it('ok when the book architecture holds artifacts', async () => {
    const d = await diagnoseScaffoldManifestGate('p1', 'arch-book', deps({
      byArch: { 'arch-book': [ARTIFACT] },
    }));
    expect(d.status).toBe('ok');
    expect(d.artifactCount).toBe(1);
  });

  it('no_target_architecture when the book has none', async () => {
    const d = await diagnoseScaffoldManifestGate('p1', null, deps({}));
    expect(d.status).toBe('no_target_architecture');
    expect(scaffoldManifestGateRemedy(d)).toContain('no target architecture bound');
  });

  it('detects the ARCHITECTURE-BINDING MISMATCH (manifest under the active arch, plan bound elsewhere)', async () => {
    const d = await diagnoseScaffoldManifestGate('p1', 'arch-book', deps({
      byArch: { 'arch-active': [ARTIFACT] },
      active: 'arch-active',
      saved: 'arch-book',
    }));
    expect(d.status).toBe('manifest_under_other_architecture');
    expect(d.otherArchitectureId).toBe('arch-active');
    const remedy = scaffoldManifestGateRemedy(d);
    expect(remedy).toContain('arch-active');
    expect(remedy).toContain("this plan's arch-book");
    expect(remedy).toContain('re-expand the foundations epic');
  });

  it('no_manifest when nothing exists anywhere (remedy names upload + re-expand)', async () => {
    const d = await diagnoseScaffoldManifestGate('p1', 'arch-book', deps({
      active: 'arch-book',
      saved: null,
    }));
    expect(d.status).toBe('no_manifest');
    const remedy = scaffoldManifestGateRemedy(d);
    expect(remedy).toContain('Upload it on the Target State screen');
    expect(remedy).toContain('re-expand the foundations epic');
  });

  it('fail-soft: probe errors are recorded, never thrown', async () => {
    const d = await diagnoseScaffoldManifestGate('p1', 'arch-book', deps({
      artifactsThrow: true,
      active: 'arch-active',
    }));
    expect(d.status).toBe('no_manifest');
    expect(d.probeErrors.length).toBeGreaterThan(0);
    expect(d.probeErrors[0]).toContain('AMS 503');
  });
});
