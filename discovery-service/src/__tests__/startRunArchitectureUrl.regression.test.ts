/**
 * Regression test: Start Discovery Run produces architecture-scoped URLs.
 *
 * Bug (2026-05-05): Clicking "Start Discovery Run" on a service in the grid
 * surfaced "no static resource ..." (Spring NoResourceFoundException) from
 * the architecture-model-service. Root cause: discovery-service's
 * archModelClient.createDiscoveryRun and the per-run sub-resources
 * (evidence, relationships, clusters, candidates, decision-tasks) targeted
 * `/api/model/projects/{projectId}/discovery/...` but Spec #4 Group 2
 * reshaped every Discovery* controller to mount under
 * `/api/model/projects/{projectId}/architectures/{architectureId}/discovery/...`.
 * The mismatch produced a 404 at the Spring static-resource fallback, never
 * reaching any controller.
 *
 * This regression test asserts that every discovery archModelClient method
 * that hits a `/discovery/...` URL embeds `architectures/{architectureId}/`
 * in the right position. If a future refactor re-introduces a non-scoped
 * URL, this test fails immediately.
 */

import { AxiosError } from 'axios';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('axios');

const PROJECT_ID = 'proj-uuid-aaaa';
const ARCH_ID = 'arch-uuid-bbbb';
const RUN_ID = 'run-uuid-cccc';

// Stub the registry so `_resolveArchitectureForRun` returns ARCH_ID for
// every run-scoped method. Without this the helper would hit the spec #1
// default-resolver (which would itself need an axios mock) and our intent
// would be muddied.
jest.mock('../services/runArchitectureRegistry', () => ({
  ...jest.requireActual('../services/runArchitectureRegistry'),
  getRunArchitectureId: jest.fn(() => ARCH_ID),
}));

interface MockAxiosCalls {
  post: jest.Mock;
  get: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
}

function setupMockAxios(): MockAxiosCalls {
  const axios = require('axios');
  const mocks: MockAxiosCalls = {
    post: jest.fn().mockResolvedValue({ data: {} }),
    get: jest.fn().mockResolvedValue({ data: [] }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: { deleted: 0 } }),
  };
  const mockInstance = {
    ...mocks,
    interceptors: { response: { use: jest.fn() } },
  };
  axios.create = jest.fn().mockReturnValue(mockInstance);
  return mocks;
}

describe('Regression: archModelClient discovery URLs include architectures/{architectureId}/', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.mock('../services/runArchitectureRegistry', () => ({
      ...jest.requireActual('../services/runArchitectureRegistry'),
      getRunArchitectureId: jest.fn(() => ARCH_ID),
    }));
  });

  // ==========================================================================
  // The immediate bug: createDiscoveryRun targeted the unscoped URL.
  // ==========================================================================
  describe('createDiscoveryRun (the immediate bug)', () => {
    it('POSTs to /projects/{projectId}/architectures/{architectureId}/discovery/runs', async () => {
      const mocks = setupMockAxios();
      mocks.post.mockResolvedValue({ data: { id: RUN_ID } });

      const { archModelClient } = require('../services/archModelClient');

      await archModelClient.createDiscoveryRun(PROJECT_ID, ARCH_ID);

      expect(mocks.post).toHaveBeenCalledTimes(1);
      const url = mocks.post.mock.calls[0][0] as string;
      expect(url).toBe(
        `/api/model/projects/${PROJECT_ID}/architectures/${ARCH_ID}/discovery/runs`
      );
      // Negative assertion: never the unscoped (bug) shape.
      expect(url).not.toBe(`/api/model/projects/${PROJECT_ID}/discovery/runs`);
    });

    it('forwards optional service_id, mode, warnings, confirm_llm_solo in body', async () => {
      const mocks = setupMockAxios();
      mocks.post.mockResolvedValue({ data: { id: RUN_ID } });

      const { archModelClient } = require('../services/archModelClient');

      await archModelClient.createDiscoveryRun(PROJECT_ID, ARCH_ID, 'svc-123', {
        mode: 'A',
        warnings: ['warn-1'],
        confirmedLlmSolo: false,
      });

      expect(mocks.post).toHaveBeenCalledTimes(1);
      const body = mocks.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body.service_id).toBe('svc-123');
      expect(body.mode).toBe('A');
      // warnings is JSON-encoded so the Java TEXT column stores the verbatim payload.
      expect(body.warnings).toBe(JSON.stringify(['warn-1']));
      expect(body.confirm_llm_solo).toBe(false);
    });
  });

  // ==========================================================================
  // The broader scope: every run-scoped method must also embed architectureId.
  // ==========================================================================
  describe('all run-scoped methods embed architectures/{architectureId}/', () => {
    const RUN_PATH = `/api/model/projects/${PROJECT_ID}/architectures/${ARCH_ID}/discovery/runs/${RUN_ID}`;

    it('updateDiscoveryRun -> PUT scoped URL', async () => {
      const mocks = setupMockAxios();
      mocks.put.mockResolvedValue({ data: {} });
      const { archModelClient } = require('../services/archModelClient');
      await archModelClient.updateDiscoveryRun(PROJECT_ID, RUN_ID, { status: 'COMPLETED' });
      expect(mocks.put.mock.calls[0][0]).toBe(RUN_PATH);
    });

    it('getDiscoveryRun (no explicit arch) -> GET scoped URL via registry', async () => {
      const mocks = setupMockAxios();
      mocks.get.mockResolvedValue({ data: { id: RUN_ID } });
      const { archModelClient } = require('../services/archModelClient');
      await archModelClient.getDiscoveryRun(PROJECT_ID, RUN_ID);
      expect(mocks.get.mock.calls[0][0]).toBe(RUN_PATH);
    });

    it('getDiscoveryRun (explicit arch) -> GET URL with that arch verbatim', async () => {
      const mocks = setupMockAxios();
      mocks.get.mockResolvedValue({ data: { id: RUN_ID } });
      const { archModelClient } = require('../services/archModelClient');
      const otherArch = 'arch-uuid-OTHER';
      await archModelClient.getDiscoveryRun(PROJECT_ID, RUN_ID, otherArch);
      expect(mocks.get.mock.calls[0][0]).toBe(
        `/api/model/projects/${PROJECT_ID}/architectures/${otherArch}/discovery/runs/${RUN_ID}`
      );
    });

    it('bulkSaveEvidence -> POST scoped /evidence URL', async () => {
      const mocks = setupMockAxios();
      const { archModelClient } = require('../services/archModelClient');
      await archModelClient.bulkSaveEvidence(PROJECT_ID, RUN_ID, []);
      expect(mocks.post.mock.calls[0][0]).toBe(`${RUN_PATH}/evidence`);
    });

    it('getEvidenceCount -> GET scoped /evidence/count URL', async () => {
      const mocks = setupMockAxios();
      mocks.get.mockResolvedValue({ data: 0 });
      const { archModelClient } = require('../services/archModelClient');
      await archModelClient.getEvidenceCount(PROJECT_ID, RUN_ID);
      expect(mocks.get.mock.calls[0][0]).toBe(`${RUN_PATH}/evidence/count`);
    });

    it('bulkSaveRelationships -> POST scoped /relationships URL', async () => {
      const mocks = setupMockAxios();
      const { archModelClient } = require('../services/archModelClient');
      await archModelClient.bulkSaveRelationships(PROJECT_ID, RUN_ID, []);
      expect(mocks.post.mock.calls[0][0]).toBe(`${RUN_PATH}/relationships`);
    });

    it('bulkSaveClusters -> POST scoped /clusters URL', async () => {
      const mocks = setupMockAxios();
      const { archModelClient } = require('../services/archModelClient');
      await archModelClient.bulkSaveClusters(PROJECT_ID, RUN_ID, []);
      expect(mocks.post.mock.calls[0][0]).toBe(`${RUN_PATH}/clusters`);
    });

    it('deleteClustersByRunId -> DELETE scoped /clusters URL', async () => {
      const mocks = setupMockAxios();
      const { archModelClient } = require('../services/archModelClient');
      await archModelClient.deleteClustersByRunId(PROJECT_ID, RUN_ID);
      expect(mocks.delete.mock.calls[0][0]).toBe(`${RUN_PATH}/clusters`);
    });

    it('bulkSaveCandidates -> POST scoped /candidates URL', async () => {
      const mocks = setupMockAxios();
      const { archModelClient } = require('../services/archModelClient');
      await archModelClient.bulkSaveCandidates(PROJECT_ID, RUN_ID, []);
      expect(mocks.post.mock.calls[0][0]).toBe(`${RUN_PATH}/candidates`);
    });

    it('updateCandidate -> PUT scoped /candidates/{candidateId} URL', async () => {
      const mocks = setupMockAxios();
      mocks.put.mockResolvedValue({ data: { id: 'cand-1' } });
      const { archModelClient } = require('../services/archModelClient');
      await archModelClient.updateCandidate(PROJECT_ID, RUN_ID, 'cand-1', { status: 'accepted' });
      expect(mocks.put.mock.calls[0][0]).toBe(`${RUN_PATH}/candidates/cand-1`);
    });

    it('bulkSaveDecisionTasks -> POST scoped /decision-tasks URL', async () => {
      const mocks = setupMockAxios();
      const { archModelClient } = require('../services/archModelClient');
      await archModelClient.bulkSaveDecisionTasks(PROJECT_ID, RUN_ID, []);
      expect(mocks.post.mock.calls[0][0]).toBe(`${RUN_PATH}/decision-tasks`);
    });
  });

  // ==========================================================================
  // The project-scoped (no runId) method also needs architectureId.
  // ==========================================================================
  describe('project-scoped getDiscoveryConfig embeds architectures/{architectureId}/', () => {
    it('GETs /projects/{projectId}/architectures/{architectureId}/discovery/config', async () => {
      const mocks = setupMockAxios();
      mocks.get.mockResolvedValue({ data: { id: 'cfg-1', config_payload: {} } });
      const { archModelClient } = require('../services/archModelClient');
      await archModelClient.getDiscoveryConfig(PROJECT_ID, ARCH_ID);
      expect(mocks.get.mock.calls[0][0]).toBe(
        `/api/model/projects/${PROJECT_ID}/architectures/${ARCH_ID}/discovery/config`
      );
    });

    it('returns null on 404 (no config yet)', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed with status code 404',
        response: { status: 404, data: {}, statusText: '', headers: {}, config: {} },
      } as AxiosError;
      const mocks = setupMockAxios();
      mocks.get.mockRejectedValue(axiosError);
      const { archModelClient } = require('../services/archModelClient');
      const result = await archModelClient.getDiscoveryConfig(PROJECT_ID, ARCH_ID);
      expect(result).toBeNull();
    });
  });
});
