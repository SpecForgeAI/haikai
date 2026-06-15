/**
 * Tests for POST /discovery/runs tier computation + Tier C LLM-solo gate.
 *
 * Spec: 2026-04-20 V3 Tier UX — Task Group 4.
 *
 * These tests verify the route-level contract:
 *   - Tier synthesis (service-scoped via parseCoretech; project-scoped via
 *     discovery config).
 *   - Tier A → mode='pack-supervised', warnings=[], proceeds.
 *   - Tier B → mode='language-only', warnings=[B copy], proceeds.
 *   - Tier C without `confirmLlmSolo: true` → 409
 *     `LLM_SOLO_CONFIRMATION_REQUIRED`; no archmodel call made.
 *   - Tier C with `confirmLlmSolo: true` → proceeds; archmodel receives
 *     `confirmedLlmSolo: true`, `mode: 'C'`, `warnings: [C copy]`.
 *   - `confirmLlmSolo` is ignored (persisted as FALSE) for tier A/B runs.
 *   - Pre-computed tier is forwarded to `startRun` so `runDiscoveryV3`
 *     receives it verbatim and does NOT re-derive via `computeTier`.
 *
 * `archModelClient` and `runManager.startRun` are mocked; the tests focus
 * on the gate logic and the values the route forwards downstream.
 */

jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock archModelClient with the methods the route touches.
jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    createDiscoveryRun: jest.fn(),
    updateDiscoveryRun: jest.fn(),
    getDiscoveryRun: jest.fn(),
    getDiscoveryConfig: jest.fn(),
    getService: jest.fn(),
  },
}));

// Mock runManager.startRun so the fire-and-forget kick-off is observable
// without actually running the pipeline.
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
import {
  clearRegistry,
  registerLanguagePack,
  registerFrameworkPack,
} from '../services/extensionPackRegistry';
import type { LanguagePack, FrameworkPack } from '../services/extensionPacks';
import { startRun } from '../services/runManager';

const mockArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;
const mockStartRun = startRun as jest.MockedFunction<typeof startRun>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const ARCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SERVICE_ID = '22222222-2222-2222-2222-222222222222';

/** Minimal LanguagePack matching `{ language: '<lang>' }` (case-sensitive). */
function makeLanguagePack(id: string, language: string): LanguagePack {
  return {
    id,
    when: { language },
    extract: () => new Map(),
  };
}

/** Minimal FrameworkPack matching `{ language, technology }`. */
function makeFrameworkPack(
  id: string,
  language: string,
  technology: string,
): FrameworkPack {
  return {
    id,
    when: { language, technology },
    adapt: () => [],
  };
}

/** Canonical archmodel-shaped response for a created run. */
function makeCreatedRun(extra: Record<string, unknown> = {}) {
  return {
    id: 'run-0001',
    project_id: PROJECT_ID,
    service_id: null,
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
  // Require inside the helper so mocks are in place when the route wires
  // up its `archModelClient` / `startRun` imports.
  const { runsRouter } = require('../routes/runs');
  const app = express();
  app.use(express.json());
  app.use('/discovery/projects/:projectId/architectures/:architectureId/runs', runsRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('POST /discovery/runs — V3 tier gate (Task Group 4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRegistry();
    mockArchModelClient.createDiscoveryRun.mockResolvedValue(makeCreatedRun());
    mockStartRun.mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  // 1. Tier A (project-scoped) — happy path, no warnings, no gate.
  // -------------------------------------------------------------------------
  test('tier A project-scoped run proceeds with mode=pack-supervised and empty warnings', async () => {
    registerLanguagePack(makeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(makeFrameworkPack('spring-boot', 'Java', 'Spring Boot'));

    mockArchModelClient.getDiscoveryConfig.mockResolvedValue({
      id: 'config-1',
      project_id: PROJECT_ID,
      service_id: null,
      config_payload: {
        techHints: {
          '0': { language: 'Java', version: '25' },
          '1': { technology: 'Spring Boot', version: '3.4' },
        },
      },
      status: 'COMPLETE',
      created_at: '2026-04-20T09:00:00Z',
      updated_at: '2026-04-20T09:30:00Z',
    });

    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('A');
    expect(res.body.mode).toBe('pack-supervised');
    expect(res.body.warnings).toEqual([]);

    // archmodel received the tier metadata with confirmedLlmSolo=FALSE.
    expect(mockArchModelClient.createDiscoveryRun).toHaveBeenCalledTimes(1);
    expect(mockArchModelClient.createDiscoveryRun).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      undefined,
      { mode: 'A', warnings: [], confirmedLlmSolo: false },
    );

    // startRun received the pre-computed tier so the pipeline won't re-derive.
    expect(mockStartRun).toHaveBeenCalledTimes(1);
    expect(mockStartRun).toHaveBeenCalledWith(
      PROJECT_ID,
      'run-0001',
      ARCH_ID,
      undefined,
      { tier: 'A', includeLibraries: false },
    );
  });

  // -------------------------------------------------------------------------
  // 2. Tier B (service-scoped) — language pack only, warnings populated.
  // -------------------------------------------------------------------------
  test('tier B service-scoped run proceeds with mode=language-only and the B warning', async () => {
    // Tier B: resolved-present with a languagePack but no frameworkPacks.
    // Spec: 2026-04-20 Tech Hints LLM Resolution (Task Group 4) — service-scoped
    // tier gate reads the resolved columns directly instead of parseCoretech.
    mockArchModelClient.getService.mockResolvedValue({
      id: SERVICE_ID,
      name: 'checkout-svc',
      description: null,
      application_id: null,
      app_component_id: null,
      service_type: null,
      core_tech: 'Kotlin 1.9',
      repo_location: null,
      repo_subfolder: null,
      tags: null,
      valid_from: null,
      valid_to: null,
      package_set_id: null,
      is_internal: null,
      core_tech_resolved: { language: { name: 'Kotlin', version: '1.9' }, frameworks: [] },
      core_tech_language_pack: 'kotlin-lang',
      core_tech_framework_packs: [],
      core_tech_resolution_confidence: 'tech-only',
      core_tech_resolved_at: '2026-04-20T09:30:00Z',
    });
    mockArchModelClient.createDiscoveryRun.mockResolvedValue(
      makeCreatedRun({ service_id: SERVICE_ID }),
    );

    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({ serviceId: SERVICE_ID });

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('B');
    expect(res.body.mode).toBe('language-only');
    expect(res.body.warnings).toEqual([
      "Discovery will run in language-only mode. No framework-specific adapter matches your service's tech stack. Candidate quality depends on LLM gap-fill.",
    ]);

    // Service entity fetched; project config NOT fetched (service-scoped path).
    expect(mockArchModelClient.getService).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, SERVICE_ID);
    expect(mockArchModelClient.getDiscoveryConfig).not.toHaveBeenCalled();

    // archmodel call carries the Tier B warning and confirmedLlmSolo=FALSE.
    expect(mockArchModelClient.createDiscoveryRun).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      SERVICE_ID,
      {
        mode: 'B',
        warnings: [
          "Discovery will run in language-only mode. No framework-specific adapter matches your service's tech stack. Candidate quality depends on LLM gap-fill.",
        ],
        confirmedLlmSolo: false,
        serviceIdentitySnapshot: {
          serviceId: SERVICE_ID,
          serviceName: 'checkout-svc',
          serviceType: null,
          applicationId: null,
          repoLocation: null,
          repoSubfolder: null,
        },
      },
    );

    expect(mockStartRun).toHaveBeenCalledWith(
      PROJECT_ID,
      'run-0001',
      ARCH_ID,
      SERVICE_ID,
      { tier: 'B', includeLibraries: false },
    );
  });

  // -------------------------------------------------------------------------
  // 3. Tier C without confirmLlmSolo — 409 gate, no archmodel call.
  // -------------------------------------------------------------------------
  test('tier C without confirmLlmSolo returns 409 LLM_SOLO_CONFIRMATION_REQUIRED and creates no run', async () => {
    // No packs registered — everything is tier C.
    mockArchModelClient.getDiscoveryConfig.mockResolvedValue({
      id: 'config-1',
      project_id: PROJECT_ID,
      service_id: null,
      config_payload: {
        techHints: {
          '0': { technology: 'Obscure Lang', version: '1.0' },
        },
      },
      status: 'COMPLETE',
      created_at: '2026-04-20T09:00:00Z',
      updated_at: '2026-04-20T09:30:00Z',
    });

    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LLM_SOLO_CONFIRMATION_REQUIRED');
    expect(res.body.error.tier).toBe('C');
    expect(res.body.error.mode).toBe('llm-solo');
    expect(res.body.error.warnings).toEqual([
      'Discovery will run in LLM-only mode. No language or framework pack matches. Pass confirmLlmSolo: true to proceed.',
    ]);

    // Critical: no run is ever persisted on the 409 gate path.
    expect(mockArchModelClient.createDiscoveryRun).not.toHaveBeenCalled();
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. Tier C WITH confirmLlmSolo — run proceeds, confirmedLlmSolo=TRUE.
  // -------------------------------------------------------------------------
  test('tier C with confirmLlmSolo=true proceeds and persists confirmedLlmSolo=true', async () => {
    // Tier C: resolved-present with no matching language or framework packs.
    // Spec: 2026-04-20 Tech Hints LLM Resolution (Task Group 4).
    mockArchModelClient.getService.mockResolvedValue({
      id: SERVICE_ID,
      name: 'legacy-svc',
      description: null,
      application_id: null,
      app_component_id: null,
      service_type: null,
      core_tech: 'COBOL 85',
      repo_location: null,
      repo_subfolder: null,
      tags: null,
      valid_from: null,
      valid_to: null,
      package_set_id: null,
      is_internal: null,
      core_tech_resolved: { language: null, frameworks: [] },
      core_tech_language_pack: null,
      core_tech_framework_packs: [],
      core_tech_resolution_confidence: 'none',
      core_tech_resolved_at: '2026-04-20T09:30:00Z',
    });
    mockArchModelClient.createDiscoveryRun.mockResolvedValue(
      makeCreatedRun({ service_id: SERVICE_ID }),
    );

    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({ serviceId: SERVICE_ID,
        confirmLlmSolo: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('C');
    expect(res.body.mode).toBe('llm-solo');
    expect(res.body.warnings).toEqual([
      'Discovery will run in LLM-only mode. No language or framework pack matches. Pass confirmLlmSolo: true to proceed.',
    ]);

    expect(mockArchModelClient.createDiscoveryRun).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      SERVICE_ID,
      {
        mode: 'C',
        warnings: [
          'Discovery will run in LLM-only mode. No language or framework pack matches. Pass confirmLlmSolo: true to proceed.',
        ],
        confirmedLlmSolo: true,
        serviceIdentitySnapshot: {
          serviceId: SERVICE_ID,
          serviceName: 'legacy-svc',
          serviceType: null,
          applicationId: null,
          repoLocation: null,
          repoSubfolder: null,
        },
      },
    );

    expect(mockStartRun).toHaveBeenCalledWith(
      PROJECT_ID,
      'run-0001',
      ARCH_ID,
      SERVICE_ID,
      { tier: 'C', includeLibraries: false },
    );
  });

  // -------------------------------------------------------------------------
  // 5. confirmLlmSolo is ignored (persisted FALSE) for tier A/B runs.
  // -------------------------------------------------------------------------
  test('confirmLlmSolo=true is ignored on tier A runs (persisted as confirmedLlmSolo=false)', async () => {
    registerLanguagePack(makeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(makeFrameworkPack('spring-boot', 'Java', 'Spring Boot'));

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
      created_at: '2026-04-20T09:00:00Z',
      updated_at: '2026-04-20T09:30:00Z',
    });

    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({ confirmLlmSolo: true });

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('A');
    // Tier A — confirmedLlmSolo MUST be false regardless of the flag on input.
    expect(mockArchModelClient.createDiscoveryRun).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      undefined,
      { mode: 'A', warnings: [], confirmedLlmSolo: false },
    );
  });

  // -------------------------------------------------------------------------
  // 6. Service not found → 404 before any tier computation / archmodel call.
  // -------------------------------------------------------------------------
  test('service-scoped run with missing service returns 404 and does not create a run', async () => {
    mockArchModelClient.getService.mockResolvedValue(null);

    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({ serviceId: SERVICE_ID });

    expect(res.status).toBe(404);
    expect(mockArchModelClient.createDiscoveryRun).not.toHaveBeenCalled();
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7. confirmLlmSolo as a non-boolean ("true" string) → 400 strict validation.
  // -------------------------------------------------------------------------
  test('confirmLlmSolo as a non-boolean value is rejected with 400', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({ confirmLlmSolo: 'true' });

    expect(res.status).toBe(400);
    expect(mockArchModelClient.getDiscoveryConfig).not.toHaveBeenCalled();
    expect(mockArchModelClient.createDiscoveryRun).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. Project-scoped run with no config → 400 (cannot compute tier without
  //    techHints).
  // -------------------------------------------------------------------------
  test('project-scoped run with missing discovery config returns 400', async () => {
    mockArchModelClient.getDiscoveryConfig.mockResolvedValue(null);

    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({});

    expect(res.status).toBe(400);
    expect(mockArchModelClient.createDiscoveryRun).not.toHaveBeenCalled();
    expect(mockStartRun).not.toHaveBeenCalled();
  });
});
