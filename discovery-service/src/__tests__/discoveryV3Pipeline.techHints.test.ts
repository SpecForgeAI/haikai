/**
 * Tests for the V3 tier gate at `POST /discovery/runs` when the service-scoped
 * path reads the resolved-column tech-hints state (Task Group 4, Spec:
 * 2026-04-20 Tech Hints LLM Resolution).
 *
 * Before this spec the gate called `parseCoretech(service.core_tech)` and ran
 * `computeTier` over the resulting hints. After this spec the gate reads
 * `ServiceEntity.coreTechResolved`, `coreTechLanguagePack` and
 * `coreTechFrameworkPacks` directly — no hint-array reconstruction is needed
 * for the tier decision. `parseCoretech` stays in-repo for the
 * `package_set_default_rules` evaluator but is NOT called on the service-scoped
 * run path anymore.
 *
 * Matrix covered below:
 *   1. `coreTechResolved IS NULL` → HTTP 409, `TECH_HINTS_UNRESOLVED`.
 *   2. `coreTechResolved` present, `languagePack` null + `frameworkPacks` empty
 *      → tier C; existing `confirmLlmSolo: true` gate still applies.
 *   3. `coreTechResolved` present, `languagePack` null + `frameworkPacks` empty,
 *      `confirmLlmSolo: true` → tier C proceeds, `confirmedLlmSolo: true`
 *      forwarded to archmodel.
 *   4. `languagePack` non-null + `frameworkPacks` non-empty → tier A, reading
 *      columns directly (no `parseCoretech` call).
 *   5. `languagePack` non-null + `frameworkPacks` empty → tier B.
 *   6. Repo absent + `coreTechResolved` good → tier gate proceeds (the
 *      pre-existing runtime block in `runManager.startServiceScopedRun`
 *      continues to reject at execution time; the gate itself does NOT add a
 *      new repo-absent check).
 *
 * `archModelClient`, `runManager.startRun`, and the tier-computation side of
 * `extensionPackRegistry` are mocked exactly the same way as
 * `runsRouteTierGate.test.ts` so these tests focus on the gate contract only.
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

// Spy on parseCoretech so we can assert the service-scoped path does NOT call
// it (the whole point of this task group).
jest.mock('../utils/coreTechParser', () => {
  const actual = jest.requireActual('../utils/coreTechParser');
  return {
    ...actual,
    parseCoretech: jest.fn(actual.parseCoretech),
  };
});

import express from 'express';
import supertest from 'supertest';
import { archModelClient } from '../services/archModelClient';
import { clearRegistry } from '../services/extensionPackRegistry';
import { startRun } from '../services/runManager';
import { parseCoretech } from '../utils/coreTechParser';

const mockArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;
const mockStartRun = startRun as jest.MockedFunction<typeof startRun>;
const mockParseCoretech = parseCoretech as jest.MockedFunction<typeof parseCoretech>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const SERVICE_ID = '22222222-2222-2222-2222-222222222222';
const ARCH_ID = '33333333-3333-3333-3333-333333333333';

/**
 * Minimal ServiceResponseDto shape with resolved-column fields set to the
 * values under test. Other fields default to safe nulls / zeros.
 */
function makeService(
  overrides: Partial<{
    core_tech: string | null;
    repo_location: string | null;
    repo_subfolder: string | null;
    core_tech_resolved: Record<string, unknown> | null;
    core_tech_language_pack: string | null;
    core_tech_framework_packs: string[] | null;
    core_tech_resolution_confidence: string | null;
    core_tech_resolved_at: string | null;
  }> = {},
) {
  return {
    id: SERVICE_ID,
    name: 'orders-svc',
    description: null,
    application_id: null,
    app_component_id: null,
    service_type: null,
    core_tech: 'Java 21 (Spring Boot 3)',
    repo_location: 'https://github.com/acme/orders-service.git',
    repo_subfolder: null,
    tags: null,
    valid_from: null,
    valid_to: null,
    package_set_id: null,
    is_internal: null,
    core_tech_resolved: null,
    core_tech_language_pack: null,
    core_tech_framework_packs: null,
    core_tech_resolution_confidence: null,
    core_tech_resolved_at: null,
    ...overrides,
  };
}

function makeCreatedRun(extra: Record<string, unknown> = {}) {
  return {
    id: 'run-0001',
    project_id: PROJECT_ID,
    service_id: SERVICE_ID,
    mode: null,
    status: 'PENDING',
    current_step: null,
    config_snapshot: {},
    steps_payload: {},
    error_message: null,
    created_at: '2026-04-20T10:00:00Z',
    updated_at: '2026-04-20T10:00:00Z',
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('POST /discovery/runs — service-scoped tier gate reads resolved columns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRegistry();
    mockArchModelClient.createDiscoveryRun.mockResolvedValue(makeCreatedRun());
    mockStartRun.mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  // 1. coreTechResolved IS NULL → 409 TECH_HINTS_UNRESOLVED.
  // -------------------------------------------------------------------------
  test('coreTechResolved NULL rejects with 409 TECH_HINTS_UNRESOLVED', async () => {
    mockArchModelClient.getService.mockResolvedValue(
      makeService({
        core_tech_resolved: null,
        core_tech_language_pack: null,
        core_tech_framework_packs: null,
      }),
    );

    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({ projectId: PROJECT_ID, serviceId: SERVICE_ID });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TECH_HINTS_UNRESOLVED');
    expect(res.body.error.message).toBe(
      'Resolve tech hints before starting discovery.',
    );

    // No run is ever persisted on the unresolved gate path.
    expect(mockArchModelClient.createDiscoveryRun).not.toHaveBeenCalled();
    expect(mockStartRun).not.toHaveBeenCalled();

    // The service-scoped path no longer calls parseCoretech.
    expect(mockParseCoretech).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 2. resolved + languagePack null + frameworkPacks empty + no confirmLlmSolo
  //    → 409 LLM_SOLO_CONFIRMATION_REQUIRED (tier C gate still applies).
  // -------------------------------------------------------------------------
  test('resolved but no packs matched → tier C; confirmLlmSolo gate rejects without opt-in', async () => {
    mockArchModelClient.getService.mockResolvedValue(
      makeService({
        core_tech_resolved: { language: null, frameworks: [] },
        core_tech_language_pack: null,
        core_tech_framework_packs: [],
        core_tech_resolution_confidence: 'none',
        core_tech_resolved_at: '2026-04-20T09:55:00Z',
      }),
    );

    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({ projectId: PROJECT_ID, serviceId: SERVICE_ID });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LLM_SOLO_CONFIRMATION_REQUIRED');
    expect(res.body.error.tier).toBe('C');
    expect(res.body.error.mode).toBe('llm-solo');

    expect(mockArchModelClient.createDiscoveryRun).not.toHaveBeenCalled();
    expect(mockStartRun).not.toHaveBeenCalled();
    expect(mockParseCoretech).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. resolved + languagePack null + frameworkPacks empty + confirmLlmSolo:
  //    true → tier C proceeds; confirmedLlmSolo=true forwarded to archmodel.
  // -------------------------------------------------------------------------
  test('resolved but no packs matched + confirmLlmSolo=true → tier C proceeds with confirmedLlmSolo=true', async () => {
    mockArchModelClient.getService.mockResolvedValue(
      makeService({
        core_tech_resolved: { language: null, frameworks: [] },
        core_tech_language_pack: null,
        core_tech_framework_packs: [],
        core_tech_resolution_confidence: 'none',
        core_tech_resolved_at: '2026-04-20T09:55:00Z',
      }),
    );
    mockArchModelClient.createDiscoveryRun.mockResolvedValue(
      makeCreatedRun({ service_id: SERVICE_ID }),
    );

    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        confirmLlmSolo: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('C');
    expect(res.body.mode).toBe('llm-solo');

    expect(mockArchModelClient.createDiscoveryRun).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      SERVICE_ID,
      expect.objectContaining({
        mode: 'C',
        confirmedLlmSolo: true,
      }),
    );

    expect(mockStartRun).toHaveBeenCalledWith(
      PROJECT_ID,
      'run-0001',
      ARCH_ID,
      SERVICE_ID,
      { tier: 'C', includeLibraries: false },
    );

    expect(mockParseCoretech).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. languagePack non-null + frameworkPacks non-empty → tier A (no
  //    parseCoretech call; tier computed from denormalised columns).
  // -------------------------------------------------------------------------
  test('languagePack + frameworkPacks both set → tier A from resolved columns (no parseCoretech)', async () => {
    mockArchModelClient.getService.mockResolvedValue(
      makeService({
        core_tech_resolved: {
          language: { name: 'Java', version: '21' },
          frameworks: [{ name: 'Spring Boot', version: '3' }],
        },
        core_tech_language_pack: 'java-21',
        core_tech_framework_packs: ['spring-boot-3'],
        core_tech_resolution_confidence: 'high',
        core_tech_resolved_at: '2026-04-20T09:55:00Z',
      }),
    );
    mockArchModelClient.createDiscoveryRun.mockResolvedValue(
      makeCreatedRun({ service_id: SERVICE_ID }),
    );

    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({ projectId: PROJECT_ID, serviceId: SERVICE_ID });

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('A');
    expect(res.body.mode).toBe('pack-supervised');
    expect(res.body.warnings).toEqual([]);

    expect(mockArchModelClient.createDiscoveryRun).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      SERVICE_ID,
      expect.objectContaining({
        mode: 'A',
        warnings: [],
        confirmedLlmSolo: false,
      }),
    );

    expect(mockStartRun).toHaveBeenCalledWith(
      PROJECT_ID,
      'run-0001',
      ARCH_ID,
      SERVICE_ID,
      { tier: 'A', includeLibraries: false },
    );

    // No hint-array reconstruction via parseCoretech.
    expect(mockParseCoretech).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. languagePack non-null + frameworkPacks empty → tier B.
  // -------------------------------------------------------------------------
  test('languagePack set + frameworkPacks empty → tier B from resolved columns', async () => {
    mockArchModelClient.getService.mockResolvedValue(
      makeService({
        core_tech_resolved: {
          language: { name: 'Kotlin', version: '1.9' },
          frameworks: [],
        },
        core_tech_language_pack: 'kotlin-1',
        core_tech_framework_packs: [],
        core_tech_resolution_confidence: 'high',
        core_tech_resolved_at: '2026-04-20T09:55:00Z',
      }),
    );
    mockArchModelClient.createDiscoveryRun.mockResolvedValue(
      makeCreatedRun({ service_id: SERVICE_ID }),
    );

    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({ projectId: PROJECT_ID, serviceId: SERVICE_ID });

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('B');
    expect(res.body.mode).toBe('language-only');
    expect(res.body.warnings.length).toBeGreaterThan(0);

    expect(mockArchModelClient.createDiscoveryRun).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      SERVICE_ID,
      expect.objectContaining({ mode: 'B', confirmedLlmSolo: false }),
    );

    expect(mockParseCoretech).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. Repo absent + resolved good → the tier gate itself proceeds; the
  //    existing runtime block in `startServiceScopedRun` is what rejects
  //    repo-absent, not this gate.
  // -------------------------------------------------------------------------
  test('repo_location absent + resolved good → gate proceeds (existing runtime block is unchanged)', async () => {
    mockArchModelClient.getService.mockResolvedValue(
      makeService({
        repo_location: null,
        core_tech_resolved: {
          language: { name: 'Java', version: '21' },
          frameworks: [{ name: 'Spring Boot', version: '3' }],
        },
        core_tech_language_pack: 'java-21',
        core_tech_framework_packs: ['spring-boot-3'],
      }),
    );
    mockArchModelClient.createDiscoveryRun.mockResolvedValue(
      makeCreatedRun({ service_id: SERVICE_ID }),
    );

    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({ projectId: PROJECT_ID, serviceId: SERVICE_ID });

    // Tier gate is independent of repo_location — it proceeds; the runtime
    // block in runManager.startServiceScopedRun handles repo-absent at
    // execution time (unchanged by this spec).
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('A');

    expect(mockParseCoretech).not.toHaveBeenCalled();
  });
});
