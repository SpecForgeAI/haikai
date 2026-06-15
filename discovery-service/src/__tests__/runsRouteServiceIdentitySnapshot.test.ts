/**
 * Tests for POST /discovery/runs route-level service identity snapshot capture.
 *
 * Spec: 2026-05-11 Discovery Run Robustness -- Section 2 (Task Group 5).
 *
 * Verifies the route-level seam at `discovery-service/src/routes/runs.ts:249`:
 *
 *   - Service-scoped runs (serviceId provided) -> the route reuses the
 *     existing `archModelClient.getService(...)` fetch (used for tier
 *     computation) to build a six-field snapshot and forwards it via
 *     `archModelClient.createDiscoveryRun(..., { serviceIdentitySnapshot })`.
 *
 *   - Project-scoped runs (no serviceId) -> the snapshot is omitted from the
 *     options bag (the field is undefined, the POST body shape is unchanged).
 *
 * archModelClient and runManager.startRun are mocked; the tests focus on
 * the route's snapshot-capture-and-thread behaviour, NOT on the AMS
 * persistence which is covered by DiscoveryRunServiceIdentitySnapshotTest.
 */

jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    createDiscoveryRun: jest.fn(),
    updateDiscoveryRun: jest.fn(),
    getDiscoveryRun: jest.fn(),
    getDiscoveryConfig: jest.fn(),
    getService: jest.fn(),
  },
}));

jest.mock('../services/runManager', () => {
  const actual = jest.requireActual('../services/runManager');
  return {
    ...actual,
    startRun: jest.fn().mockResolvedValue(undefined),
    resumeRun: jest.fn().mockResolvedValue(undefined),
  };
});

import express from 'express';
import supertest from 'supertest';
import { archModelClient } from '../services/archModelClient';
import { startRun } from '../services/runManager';

const mockArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;
const mockStartRun = startRun as jest.MockedFunction<typeof startRun>;

const PROJECT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const ARCH_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const SERVICE_ID = 'cccccccc-0000-0000-0000-000000000003';

function makeCreatedRun(extra: Record<string, unknown> = {}) {
  return {
    id: 'run-snapshot-0001',
    project_id: PROJECT_ID,
    service_id: null,
    mode: null,
    status: 'PENDING',
    current_step: null,
    config_snapshot: {},
    steps_payload: {},
    error_message: null,
    created_at: '2026-05-11T10:00:00Z',
    updated_at: '2026-05-11T10:00:00Z',
    ...extra,
  };
}

function buildApp() {
  const { runsRouter } = require('../routes/runs');
  const app = express();
  app.use(express.json());
  app.use('/discovery/projects/:projectId/architectures/:architectureId/runs', runsRouter);
  return app;
}

describe('POST /discovery/runs -- service identity snapshot capture (Task Group 5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockArchModelClient.createDiscoveryRun.mockResolvedValue(makeCreatedRun());
    mockStartRun.mockResolvedValue(undefined);
  });

  test('service-scoped run captures the six-field snapshot from the existing getService fetch', async () => {
    // The service returned here defines what the snapshot will contain.
    mockArchModelClient.getService.mockResolvedValue({
      id: SERVICE_ID,
      name: 'checkout-svc',
      description: 'desc-omitted-from-snapshot',
      application_id: 'app-checkout',
      app_component_id: 'comp-checkout',
      service_type: 'INTERNAL_BUSINESS',
      core_tech: 'Java 21',
      repo_location: 'https://example.test/checkout.git',
      repo_subfolder: 'services/checkout',
      tags: 'tag-omitted',
      valid_from: null,
      valid_to: null,
      package_set_id: null,
      is_internal: null,
      core_tech_resolved: { language: { name: 'Java', version: '21' }, frameworks: [] },
      core_tech_language_pack: 'java-lang',
      core_tech_framework_packs: [],
      core_tech_resolution_confidence: 'tech-only',
      core_tech_resolved_at: '2026-05-11T09:30:00Z',
    });
    mockArchModelClient.createDiscoveryRun.mockResolvedValue(
      makeCreatedRun({ service_id: SERVICE_ID }),
    );

    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({ serviceId: SERVICE_ID });

    expect(res.status).toBe(200);

    // The createDiscoveryRun call must include the snapshot in its options
    // bag with EXACTLY the six identifier-ish fields (spec § 2.4).
    expect(mockArchModelClient.createDiscoveryRun).toHaveBeenCalledTimes(1);
    const callArgs = mockArchModelClient.createDiscoveryRun.mock.calls[0];
    const options = callArgs[3];
    expect(options).toBeDefined();
    expect(options!.serviceIdentitySnapshot).toEqual({
      serviceId: SERVICE_ID,
      serviceName: 'checkout-svc',
      serviceType: 'INTERNAL_BUSINESS',
      applicationId: 'app-checkout',
      repoLocation: 'https://example.test/checkout.git',
      repoSubfolder: 'services/checkout',
    });
  });

  test('snapshot omits description, tags, and resolved-tech columns (spec § 2.4)', async () => {
    mockArchModelClient.getService.mockResolvedValue({
      id: SERVICE_ID,
      name: 'checkout-svc',
      description: 'should-not-appear',
      application_id: 'app-1',
      app_component_id: 'comp-1',
      service_type: 'API',
      core_tech: 'Kotlin 1.9',
      repo_location: 'r',
      repo_subfolder: 's',
      tags: 'should-not-appear',
      valid_from: null,
      valid_to: null,
      package_set_id: null,
      is_internal: null,
      core_tech_resolved: { language: { name: 'Kotlin', version: '1.9' }, frameworks: [] },
      core_tech_language_pack: 'kotlin-lang',
      core_tech_framework_packs: [],
      core_tech_resolution_confidence: 'tech-only',
      core_tech_resolved_at: '2026-05-11T09:30:00Z',
    });
    mockArchModelClient.createDiscoveryRun.mockResolvedValue(
      makeCreatedRun({ service_id: SERVICE_ID }),
    );

    const app = buildApp();
    await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({ serviceId: SERVICE_ID });

    const options = mockArchModelClient.createDiscoveryRun.mock.calls[0][3];
    const snap = options!.serviceIdentitySnapshot!;
    expect(Object.keys(snap).sort()).toEqual([
      'applicationId',
      'repoLocation',
      'repoSubfolder',
      'serviceId',
      'serviceName',
      'serviceType',
    ]);
    // None of these prohibited keys leak through.
    const snapBag = snap as unknown as Record<string, unknown>;
    expect(snapBag.description).toBeUndefined();
    expect(snapBag.tags).toBeUndefined();
    expect(snapBag.core_tech).toBeUndefined();
    expect(snapBag.core_tech_resolved).toBeUndefined();
  });

  test('project-scoped run (no serviceId) omits the snapshot entirely', async () => {
    // Project-scoped path: getDiscoveryConfig is called, getService is NOT
    // called, and the createDiscoveryRun options bag has no snapshot.
    mockArchModelClient.getDiscoveryConfig.mockResolvedValue({
      id: 'config-1',
      project_id: PROJECT_ID,
      service_id: null,
      config_payload: {
        techHints: {
          '0': { language: 'Java' },
          '1': { technology: 'Spring Boot' },
        },
      },
      status: 'COMPLETE',
      created_at: '2026-05-11T09:00:00Z',
      updated_at: '2026-05-11T09:30:00Z',
    });

    // Stub a language + framework pack to land tier A (so the run actually proceeds).
    const {
      clearRegistry,
      registerLanguagePack,
      registerFrameworkPack,
    } = require('../services/extensionPackRegistry');
    clearRegistry();
    registerLanguagePack({
      id: 'java-lang',
      when: { language: 'Java' },
      extract: () => new Map(),
    });
    registerFrameworkPack({
      id: 'spring-boot',
      when: { language: 'Java', technology: 'Spring Boot' },
      adapt: () => [],
    });

    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({});

    expect(res.status).toBe(200);
    expect(mockArchModelClient.getService).not.toHaveBeenCalled();
    const options = mockArchModelClient.createDiscoveryRun.mock.calls[0][3];
    expect(options!.serviceIdentitySnapshot).toBeUndefined();
  });

  test('service-scoped snapshot survives nullable service columns (service_type, application_id, repo_*)', async () => {
    // All identifier-ish columns are optional on the service entity. The
    // snapshot must coerce missing values to null (NOT drop the keys),
    // matching the discovery-service interface contract.
    mockArchModelClient.getService.mockResolvedValue({
      id: SERVICE_ID,
      name: 'minimal-svc',
      description: null,
      application_id: null,
      app_component_id: null,
      service_type: null,
      core_tech: 'Java 21',
      repo_location: null,
      repo_subfolder: null,
      tags: null,
      valid_from: null,
      valid_to: null,
      package_set_id: null,
      is_internal: null,
      core_tech_resolved: { language: { name: 'Java', version: '21' }, frameworks: [] },
      core_tech_language_pack: 'java-lang',
      core_tech_framework_packs: [],
      core_tech_resolution_confidence: 'tech-only',
      core_tech_resolved_at: '2026-05-11T09:30:00Z',
    });
    mockArchModelClient.createDiscoveryRun.mockResolvedValue(
      makeCreatedRun({ service_id: SERVICE_ID }),
    );

    const app = buildApp();
    await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({ serviceId: SERVICE_ID });

    const snap = mockArchModelClient.createDiscoveryRun.mock.calls[0][3]!.serviceIdentitySnapshot!;
    expect(snap.serviceId).toBe(SERVICE_ID);
    expect(snap.serviceName).toBe('minimal-svc');
    expect(snap.serviceType).toBeNull();
    expect(snap.applicationId).toBeNull();
    expect(snap.repoLocation).toBeNull();
    expect(snap.repoSubfolder).toBeNull();
  });
});
