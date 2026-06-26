/**
 * Tests for the scaffold-homing helpers (Spec 2026-06-26 Book-of-Work Scaffold +
 * Reference Names — Task Group 2): ecosystem -> workstream mapping, host-epic
 * selection (lowest sequenceOrder in the mapped workstream), and the
 * service-name resolution fallback chain. All helpers are pure.
 */

import {
  resolveScaffoldHostForEpic,
  resolveScaffoldServiceName,
  workstreamForEcosystem,
} from '../services/migrationBookOfWorkExpansionHandler';
import { MigrationBookOfWorkItem } from '../services/generatedMigrationBookOfWorkSchema';
import { TargetManifestArtifactWire } from '../services/targetManifestArtifactsClient';

function epic(
  id: string,
  workstream: string,
  sequenceOrder: number
): MigrationBookOfWorkItem {
  return {
    id,
    type: 'epic',
    parentId: 'I1',
    title: id,
    description: '',
    acceptanceCriteria: [],
    workstream: workstream as MigrationBookOfWorkItem['workstream'],
    sequenceOrder,
    tags: [`stream:${workstream}`],
    confidence: 'high',
    readiness: 'ready_for_spec',
    readinessReasons: [],
    missingInputs: [],
    recommendedNextAction: '',
    traceabilitySummary: '',
  };
}

function manifest(overrides: Partial<TargetManifestArtifactWire> = {}): TargetManifestArtifactWire {
  return {
    id: 'row-1',
    project_id: 'p',
    target_architecture_id: 'arch',
    tag: 'orders-service',
    kind: 'pom',
    ecosystem: 'maven',
    manifest_path: 'orders-service/pom.xml',
    content: '<project/>',
    package_lock_content: null,
    resolved_dependencies: [],
    target_service_element_id: null,
    is_latest: true,
    created_at: '2026-06-26T00:00:00Z',
    ...overrides,
  };
}

describe('workstreamForEcosystem — code-owned, case-insensitive', () => {
  it('maps maven -> target_service_api_implementation and npm -> target_frontend_implementation', () => {
    expect(workstreamForEcosystem('maven')).toBe('target_service_api_implementation');
    expect(workstreamForEcosystem('npm')).toBe('target_frontend_implementation');
  });

  it('is case-insensitive and trims, and returns null for unmapped/empty ecosystems', () => {
    expect(workstreamForEcosystem('MAVEN')).toBe('target_service_api_implementation');
    expect(workstreamForEcosystem('  Npm ')).toBe('target_frontend_implementation');
    expect(workstreamForEcosystem('gradle')).toBeNull();
    expect(workstreamForEcosystem(null)).toBeNull();
    expect(workstreamForEcosystem(undefined)).toBeNull();
  });
});

describe('resolveScaffoldHostForEpic — lowest sequenceOrder in the mapped workstream', () => {
  const WS = 'target_service_api_implementation';
  const items: MigrationBookOfWorkItem[] = [
    epic('svc:E2', WS, 5),
    epic('svc:E1', WS, 2), // lowest sequenceOrder in this workstream -> host
    epic('fe:E1', 'target_frontend_implementation', 1), // different workstream
  ];

  it('flags the lowest-sequenceOrder epic in the manifest-mapped workstream as the host (any click order)', () => {
    const host = resolveScaffoldHostForEpic({ epic: items[1], items, manifests: [manifest()] });
    expect(host.isHost).toBe(true);
    expect(host.hostEpicId).toBe('svc:E1');
    expect(host.workstream).toBe(WS);
    expect(host.manifest?.tag).toBe('orders-service');

    // Expanding the higher-sequence epic in the same workstream is NOT the host.
    const notHost = resolveScaffoldHostForEpic({ epic: items[0], items, manifests: [manifest()] });
    expect(notHost.isHost).toBe(false);
    expect(notHost.hostEpicId).toBe('svc:E1');
  });

  it('returns isHost:false with no manifest when no confirmed manifest maps to the epic workstream', () => {
    const res = resolveScaffoldHostForEpic({ epic: items[1], items, manifests: [] });
    expect(res.isHost).toBe(false);
    expect(res.manifest).toBeNull();
    // An npm manifest does not make a maven (service-api) epic a host.
    const npmOnly = resolveScaffoldHostForEpic({
      epic: items[1],
      items,
      manifests: [manifest({ ecosystem: 'npm' })],
    });
    expect(npmOnly.isHost).toBe(false);
  });
});

describe('resolveScaffoldServiceName — graceful fallback chain (never blocks)', () => {
  const WS = 'target_service_api_implementation';

  it('(1) resolves the Spec-4 FK to the bound services element name + carries the FK id', () => {
    const res = resolveScaffoldServiceName({
      manifest: manifest({ target_service_element_id: 'svc-el-9' }),
      workstream: WS,
      services: [
        { id: 'svc-el-9', name: 'Orders Service' },
        { id: 'svc-el-3', name: 'Other Service' },
      ],
    });
    expect(res.serviceName).toBe('Orders Service');
    expect(res.serviceId).toBe('svc-el-9');
  });

  it('(2) falls back to the single service by cardinality when no FK is present', () => {
    const res = resolveScaffoldServiceName({
      manifest: manifest({ target_service_element_id: null }),
      workstream: WS,
      services: [{ id: 'only-1', name: 'Sole Service' }],
    });
    expect(res.serviceName).toBe('Sole Service');
    expect(res.serviceId).toBe('only-1');
  });

  it('(3) falls back to the workstream label with a null service id when nothing resolves', () => {
    const apiRes = resolveScaffoldServiceName({
      manifest: manifest({ target_service_element_id: null }),
      workstream: WS,
      services: [],
    });
    expect(apiRes.serviceName).toBe('service API');
    expect(apiRes.serviceId).toBeNull();

    const feRes = resolveScaffoldServiceName({
      manifest: manifest({ ecosystem: 'npm', target_service_element_id: null }),
      workstream: 'target_frontend_implementation',
      services: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    });
    expect(feRes.serviceName).toBe('frontend');
    expect(feRes.serviceId).toBeNull();
  });
});
