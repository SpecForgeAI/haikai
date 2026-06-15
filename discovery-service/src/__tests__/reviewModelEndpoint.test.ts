/**
 * Task Group 4 — Read Endpoint + AMS Fetch Wiring (Spec 1 — Deterministic
 * Review Model + Cascade/Dependency Graph + Aggregation Backbone).
 *
 * The new run-scoped read endpoint
 *   GET /discovery/projects/:projectId/architectures/:architectureId/runs/:runId/review-model
 *       [?secondRunId=<run-id>]
 * fetches candidates + findings from AMS per selected run, classifies each run's
 * kind via `discovery_kind`, assembles the deterministic model via the Groups
 * 1-3 module, and returns it (READ-ONLY, snake_case).
 *
 * Focused tests:
 *   (a) returns the computed model for a single run id;
 *   (b) returns the model for two run ids (one code + one DB) including the
 *       cross-scan logical↔physical edge;
 *   (c) [REMOVED in spec 2026-06-05-per-service-scan-selection, Group 3] the
 *       former same-kind / >2-run rejection — N runs of any kind mix are now
 *       accepted; N-run acceptance + retained guards live in
 *       `reviewModelEndpoint.twoRun.test.ts`;
 *   (d) the endpoint writes NOTHING back to AMS (no review/update/PATCH client
 *       methods invoked).
 *
 * tree-sitter caution: importing the runs router may transitively pull parser
 * modules; this suite mocks `archModelClient` + `runManager` and never invokes a
 * parser, so it runs cleanly in isolation.
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    getDiscoveryRun: jest.fn(),
    getCandidatesByRun: jest.fn(),
    listDiscoveryFindings: jest.fn(),
    // write-path methods — asserted NEVER called by the read endpoint.
    updateCandidate: jest.fn(),
    updateDiscoveryFinding: jest.fn(),
    reviewDiscoveryFinding: jest.fn(),
    updateDiscoveryRun: jest.fn(),
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
import type { DiscoveryCandidate } from '../types/candidate';

const mockArch = archModelClient as jest.Mocked<typeof archModelClient>;

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const ARCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CODE_RUN = 'run-code-0001';
const DB_RUN = 'run-db-0001';

function buildApp() {
  const { runsRouter } = require('../routes/runs');
  const app = express();
  app.use(express.json());
  app.use('/discovery/projects/:projectId/architectures/:architectureId/runs', runsRouter);
  return app;
}

function runDto(id: string, kind: 'code' | 'database') {
  return {
    id,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    service_id: null,
    mode: null,
    status: 'COMPLETED',
    current_step: null,
    config_snapshot: {},
    steps_payload: {},
    error_message: null,
    created_at: 'x',
    updated_at: 'x',
    discovery_kind: kind,
  };
}

function candidate(
  partial: Partial<DiscoveryCandidate> & Pick<DiscoveryCandidate, 'id' | 'candidateType' | 'name' | 'runId'>,
): DiscoveryCandidate {
  return {
    confidence: 0.9,
    status: 'pending_review',
    sourceClusterIds: [],
    data: {},
    synthesizedAt: 'x',
    operation: 'create',
    ...partial,
  };
}

const EMPTY_FINDINGS = { items: [], total: 0, page: 0, size: 0 };

describe('GET .../runs/:runId/review-model (Spec 1, Group 4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('(a) returns the computed model for a single run id', async () => {
    mockArch.getDiscoveryRun.mockImplementation(async (_p, id) =>
      id === CODE_RUN ? (runDto(CODE_RUN, 'code') as never) : (null as never),
    );
    mockArch.getCandidatesByRun.mockResolvedValue([
      candidate({ id: 'svc', candidateType: 'service', name: 'OrderService', runId: CODE_RUN }),
      candidate({
        id: 'iface',
        candidateType: 'interfaces',
        name: 'OrderController',
        runId: CODE_RUN,
        parentCandidateId: 'svc',
      }),
    ] as never);
    mockArch.listDiscoveryFindings.mockResolvedValue(EMPTY_FINDINGS as never);

    const res = await supertest(buildApp()).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${CODE_RUN}/review-model`,
    );

    expect(res.status).toBe(200);
    // snake_case top-level shape
    expect(res.body.scan_selection).toEqual([{ run_id: CODE_RUN, scan_kind: 'code' }]);
    expect(res.body.nodes.map((n: { id: string }) => n.id).sort()).toEqual(['iface', 'svc']);
    expect(res.body.edges).toHaveLength(1);
    expect(res.body.edges[0].edge_kind).toBe('parent_child');
    expect(res.body.aggregations.total_candidates).toBe(2);
    // fetched exactly one run's candidates + findings
    expect(mockArch.getCandidatesByRun).toHaveBeenCalledTimes(1);
    expect(mockArch.listDiscoveryFindings).toHaveBeenCalledTimes(1);
    // Regression guard: the URL architectureId MUST be forwarded VERBATIM to the
    // candidate + finding reads (NOT re-resolved). A read has no in-flight run
    // binding, so re-resolution would fall back to the project DEFAULT architecture
    // and a run in a non-default architecture would 404 via the AMS run guard.
    expect(mockArch.getCandidatesByRun).toHaveBeenCalledWith(
      PROJECT_ID, CODE_RUN, undefined, undefined, ARCH_ID,
    );
    expect(mockArch.listDiscoveryFindings).toHaveBeenCalledWith(
      PROJECT_ID, CODE_RUN, undefined, ARCH_ID,
    );
  });

  test('(b) returns the model for two run ids (code + DB) including a cross-scan edge', async () => {
    mockArch.getDiscoveryRun.mockImplementation(async (_p, id) => {
      if (id === CODE_RUN) return runDto(CODE_RUN, 'code') as never;
      if (id === DB_RUN) return runDto(DB_RUN, 'database') as never;
      return null as never;
    });
    mockArch.getCandidatesByRun.mockImplementation(async (_p, runId) => {
      if (runId === CODE_RUN) {
        return [
          candidate({ id: 'lde', candidateType: 'logical_data_entities', name: 'Order', runId: CODE_RUN }),
        ] as never;
      }
      return [
        candidate({
          id: 'pde',
          candidateType: 'physical_data_entities',
          name: 'Order',
          runId: DB_RUN,
          data: { database_name: 'orders', physical_type: 'table' },
        }),
      ] as never;
    });
    mockArch.listDiscoveryFindings.mockResolvedValue(EMPTY_FINDINGS as never);

    const res = await supertest(buildApp()).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${CODE_RUN}/review-model?secondRunId=${DB_RUN}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.scan_selection).toHaveLength(2);
    const cross = res.body.edges.filter(
      (e: { edge_kind: string; cross_scan: boolean }) =>
        e.edge_kind === 'logical_data_entity_physical_data_entities' && e.cross_scan,
    );
    expect(cross).toHaveLength(1);
    expect(cross[0].from_id).toBe('lde');
    expect(cross[0].to_id).toBe('pde');
    // fetched BOTH runs
    expect(mockArch.getCandidatesByRun).toHaveBeenCalledTimes(2);
    expect(mockArch.listDiscoveryFindings).toHaveBeenCalledTimes(2);
  });

  // NOTE (spec 2026-06-05-per-service-scan-selection, Group 3): the former
  // same-kind rejection + >2-run cap were REMOVED — N runs of any kind mix are
  // now accepted. N-run acceptance + the retained guards (unknown run → 404,
  // arch mismatch → 409, self-reference → 400) are covered in
  // `reviewModelEndpoint.twoRun.test.ts`.

  test('(d) writes NOTHING back to AMS', async () => {
    mockArch.getDiscoveryRun.mockResolvedValue(runDto(CODE_RUN, 'code') as never);
    mockArch.getCandidatesByRun.mockResolvedValue([
      candidate({ id: 'svc', candidateType: 'service', name: 'S', runId: CODE_RUN, status: 'rejected' }),
    ] as never);
    mockArch.listDiscoveryFindings.mockResolvedValue(EMPTY_FINDINGS as never);

    const res = await supertest(buildApp()).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${CODE_RUN}/review-model`,
    );

    expect(res.status).toBe(200);
    expect(mockArch.updateCandidate).not.toHaveBeenCalled();
    expect(mockArch.updateDiscoveryFinding).not.toHaveBeenCalled();
    expect(mockArch.reviewDiscoveryFinding).not.toHaveBeenCalled();
    expect(mockArch.updateDiscoveryRun).not.toHaveBeenCalled();
  });
});
