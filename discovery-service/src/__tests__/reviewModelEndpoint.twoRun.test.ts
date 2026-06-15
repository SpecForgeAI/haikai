/**
 * Task Group 7 — strengthened 2-run END-TO-END endpoint→model scenarios.
 *
 * The Group-4 `reviewModelEndpoint.test.ts` `(b)` test asserts a cross-scan edge
 * EXISTS for two runs; these strengthen the END-TO-END contract through the REAL
 * AMS fetch wiring (the runs router + the pure builder), closing the gaps the
 * Group 4 test left:
 *   (e) the two `archModelClient` fetches union into ONE model whose node set
 *       carries BOTH scan-kinds joined, the cross-scan logical↔physical edge
 *       links the code-scan LDE NODE ↔ the DB-scan physical NODE by identity, AND
 *       a DB-run FINDING bridges onto its DB candidate via `links[]` (Spec F
 *       review status) — proving the end-to-end union + bridge, not just the edge;
 *   (f) the same two-run path honors the meta-model fan-out: rejecting the
 *       code-scan LDE reaches its attribute (intra-scan `parent_child`) AND the
 *       DB physical entity (cross-scan mapping) in ONE blast-radius entry.
 *
 * Mocks `archModelClient` + `runManager` exactly as the Group-4 suite does, so no
 * parser module is ever invoked (tree-sitter-safe; runs cleanly in isolation or
 * combined).
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    getDiscoveryRun: jest.fn(),
    getCandidatesByRun: jest.fn(),
    listDiscoveryFindings: jest.fn(),
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
  partial: Partial<DiscoveryCandidate> &
    Pick<DiscoveryCandidate, 'id' | 'candidateType' | 'name' | 'runId'>,
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

function wireTwoRuns(args: {
  codeCandidates: DiscoveryCandidate[];
  dbCandidates: DiscoveryCandidate[];
  dbFindings?: unknown;
}) {
  mockArch.getDiscoveryRun.mockImplementation(async (_p, id) => {
    if (id === CODE_RUN) return runDto(CODE_RUN, 'code') as never;
    if (id === DB_RUN) return runDto(DB_RUN, 'database') as never;
    return null as never;
  });
  mockArch.getCandidatesByRun.mockImplementation(async (_p, runId) =>
    (runId === CODE_RUN ? args.codeCandidates : args.dbCandidates) as never,
  );
  mockArch.listDiscoveryFindings.mockImplementation(async (_p, runId) =>
    (runId === DB_RUN ? args.dbFindings ?? EMPTY_FINDINGS : EMPTY_FINDINGS) as never,
  );
}

describe('GET .../review-model — 2-run end-to-end (Spec 1, Group 7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('(e) unions both runs into one model: cross-scan edge links the code LDE node ↔ the DB physical node, and a DB finding bridges onto its candidate', async () => {
    wireTwoRuns({
      codeCandidates: [
        candidate({ id: 'c-lde', candidateType: 'logical_data_entities', name: 'Order', runId: CODE_RUN }),
      ],
      dbCandidates: [
        candidate({
          id: 'd-pde',
          candidateType: 'physical_data_entities',
          name: 'Order',
          runId: DB_RUN,
          data: { database_name: 'orders', physical_type: 'table' },
        }),
      ],
      dbFindings: {
        items: [
          {
            id: 'f-sp',
            runId: DB_RUN,
            projectId: PROJECT_ID,
            architectureId: ARCH_ID,
            findingType: 'stored_procedure',
            category: 'data_layer',
            severity: 'high',
            reviewStatus: 'pending_review',
            links: [
              {
                id: 'l1',
                findingId: 'f-sp',
                linkType: 'affects',
                targetType: 'discovery_candidate',
                targetId: 'd-pde',
                label: null,
                createdAt: 'x',
              },
            ],
          },
        ],
        total: 1,
        page: 0,
        size: 1,
      },
    });

    const res = await supertest(buildApp()).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${CODE_RUN}/review-model?secondRunId=${DB_RUN}`,
    );

    expect(res.status).toBe(200);

    // ONE unioned node set carrying BOTH scan-kinds, globally-unique AMS ids.
    const nodesByScan = new Map<string, string>(
      res.body.nodes.map((n: { id: string; scan_kind: string }) => [n.id, n.scan_kind]),
    );
    expect(nodesByScan.get('c-lde')).toBe('code');
    expect(nodesByScan.get('d-pde')).toBe('database');

    // The cross-scan logical↔physical edge links the two NODES across runs.
    const cross = res.body.edges.filter(
      (e: { edge_kind: string; cross_scan: boolean }) =>
        e.cross_scan && e.edge_kind === 'logical_data_entity_physical_data_entities',
    );
    expect(cross).toHaveLength(1);
    expect(cross[0].from_id).toBe('c-lde');
    expect(cross[0].to_id).toBe('d-pde');

    // The DB-run finding bridged onto its DB candidate via links[] (Spec F status).
    expect(res.body.findings).toHaveLength(1);
    expect(res.body.findings[0]).toMatchObject({
      id: 'f-sp',
      review_status: 'pending_review',
      severity: 'high',
      candidate_link_ids: ['d-pde'],
    });

    // Both runs fetched (candidates + findings).
    expect(mockArch.getCandidatesByRun).toHaveBeenCalledTimes(2);
    expect(mockArch.listDiscoveryFindings).toHaveBeenCalledTimes(2);
  });

  test('(f) two-run meta-model fan-out: rejecting the code LDE reaches its attribute (parent_child) but NOT the DB physical entity — the cross-scan mapping is preserved as an EDGE yet not cascaded', async () => {
    wireTwoRuns({
      codeCandidates: [
        candidate({ id: 'c-lde', candidateType: 'logical_data_entities', name: 'Order', runId: CODE_RUN }),
        candidate({
          id: 'c-attr',
          candidateType: 'logical_data_attributes',
          name: 'total',
          runId: CODE_RUN,
          parentCandidateId: 'c-lde',
        }),
      ],
      dbCandidates: [
        candidate({
          id: 'd-pde',
          candidateType: 'physical_data_entities',
          name: 'Order',
          runId: DB_RUN,
          data: { database_name: 'orders', physical_type: 'table' },
        }),
      ],
    });

    const res = await supertest(buildApp()).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${CODE_RUN}/review-model?secondRunId=${DB_RUN}`,
    );

    expect(res.status).toBe(200);
    const ldeRadius = res.body.blast_radius.find(
      (b: { candidate_id: string }) => b.candidate_id === 'c-lde',
    );
    expect(ldeRadius).toBeDefined();
    const byDep = new Map<string, { via_edge_kind: string; via_predecessor_id: string }>(
      ldeRadius.dependents.map(
        (d: { dependent_id: string; via_edge_kind: string; via_predecessor_id: string }) => [
          d.dependent_id,
          d,
        ],
      ),
    );
    // attribute via parent_child (intra-scan, within the logical layer).
    expect(byDep.get('c-attr')).toMatchObject({
      via_edge_kind: 'parent_child',
      via_predecessor_id: 'c-lde',
    });
    // The DB physical entity is NOT in the radius — the cross-scan logical↔physical
    // mapping is intentionally NOT cascaded (layers are reviewed as separate
    // families). Only the cascade skips it; the connecting edge is still emitted.
    expect(byDep.has('d-pde')).toBe(false);
    expect(new Set(byDep.keys())).toEqual(new Set(['c-attr']));

    // The cross-scan mapping EDGE is still present (the connection is preserved for
    // the cross-layer note + the cross-scan links agenda section).
    const crossEdge = res.body.edges.find(
      (e: { from_id: string; to_id: string; cross_scan: boolean }) =>
        e.cross_scan && e.from_id === 'c-lde' && e.to_id === 'd-pde',
    );
    expect(crossEdge).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Per-service scan selection (`2026-06-05-per-service-scan-selection`, Task Group
// 3): the review-model ROUTE now accepts the FULL N-run additional set. The old
// two-run cap + same-kind rejection are GONE; the existence / arch-mismatch /
// self-reference guards remain. `buildReviewModel(runInputs)` is UNCHANGED.
// ---------------------------------------------------------------------------

const UI_RUN = 'run-ui-0001';

describe('GET .../review-model — N-run route relaxation (Spec per-service, Group 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('(a) accepts a 2 code + 1 database selection (3 run ids) and unions all three runs', async () => {
    // UI + Service are BOTH code-kind; DB is database-kind. The old route capped
    // at two runs AND rejected two same-kind runs — both gone now.
    mockArch.getDiscoveryRun.mockImplementation(async (_p, id) => {
      if (id === UI_RUN) return runDto(UI_RUN, 'code') as never;
      if (id === CODE_RUN) return runDto(CODE_RUN, 'code') as never;
      if (id === DB_RUN) return runDto(DB_RUN, 'database') as never;
      return null as never;
    });
    mockArch.getCandidatesByRun.mockImplementation(async (_p, runId) => {
      if (runId === UI_RUN)
        return [candidate({ id: 'c-ui', candidateType: 'service', name: 'UiSvc', runId: UI_RUN })] as never;
      if (runId === CODE_RUN)
        return [candidate({ id: 'c-api', candidateType: 'service', name: 'ApiSvc', runId: CODE_RUN })] as never;
      return [
        candidate({
          id: 'd-pde',
          candidateType: 'physical_data_entities',
          name: 'Order',
          runId: DB_RUN,
          data: { database_name: 'orders', physical_type: 'table' },
        }),
      ] as never;
    });
    mockArch.listDiscoveryFindings.mockResolvedValue(EMPTY_FINDINGS as never);

    const res = await supertest(buildApp()).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${CODE_RUN}/review-model` +
        `?secondRunId=${UI_RUN}&secondRunId=${DB_RUN}`,
    );

    expect(res.status).toBe(200);
    // The model unions ALL THREE runs (2 code + 1 DB) — no 400 cap, no same-kind 400.
    const ids = new Set(res.body.nodes.map((n: { id: string }) => n.id));
    expect(ids).toEqual(new Set(['c-ui', 'c-api', 'd-pde']));
    // All three scan-selection rows are present in the unioned model.
    expect(res.body.scan_selection).toHaveLength(3);
    // Every selected run was fetched (primary + 2 additional).
    expect(mockArch.getCandidatesByRun).toHaveBeenCalledTimes(3);
  });

  test('(b) accepts a same-kind multi-run selection (2 code) — the old same-kind 400 is gone', async () => {
    mockArch.getDiscoveryRun.mockImplementation(async (_p, id) => {
      if (id === CODE_RUN) return runDto(CODE_RUN, 'code') as never;
      if (id === UI_RUN) return runDto(UI_RUN, 'code') as never;
      return null as never;
    });
    mockArch.getCandidatesByRun.mockImplementation(async (_p, runId) =>
      (runId === CODE_RUN
        ? [candidate({ id: 'c-api', candidateType: 'service', name: 'ApiSvc', runId: CODE_RUN })]
        : [candidate({ id: 'c-ui', candidateType: 'service', name: 'UiSvc', runId: UI_RUN })]) as never,
    );
    mockArch.listDiscoveryFindings.mockResolvedValue(EMPTY_FINDINGS as never);

    const res = await supertest(buildApp()).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${CODE_RUN}/review-model?secondRunId=${UI_RUN}`,
    );

    expect(res.status).toBe(200);
    expect(new Set(res.body.nodes.map((n: { id: string }) => n.id))).toEqual(new Set(['c-api', 'c-ui']));
  });

  test('(c1) still rejects a missing additional run with 404 (the existence guard survives)', async () => {
    mockArch.getDiscoveryRun.mockImplementation(async (_p, id) =>
      (id === CODE_RUN ? runDto(CODE_RUN, 'code') : null) as never,
    );

    const res = await supertest(buildApp()).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${CODE_RUN}/review-model?secondRunId=run-missing`,
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(404);
    // No candidate fetch happened — the whole selection is validated first.
    expect(mockArch.getCandidatesByRun).not.toHaveBeenCalled();
  });

  test('(c2) still rejects an architecture mismatch with 409 (the arch guard survives)', async () => {
    mockArch.getDiscoveryRun.mockImplementation(async (_p, id) => {
      if (id === CODE_RUN) return runDto(CODE_RUN, 'code') as never;
      if (id === UI_RUN) return { ...runDto(UI_RUN, 'code'), architecture_id: 'other-arch' } as never;
      return null as never;
    });

    const res = await supertest(buildApp()).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${CODE_RUN}/review-model?secondRunId=${UI_RUN}`,
    );

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(409);
  });

  test('(c3) still rejects an additional run id equal to the primary (self-reference guard survives)', async () => {
    mockArch.getDiscoveryRun.mockResolvedValue(runDto(CODE_RUN, 'code') as never);

    const res = await supertest(buildApp()).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${CODE_RUN}/review-model?secondRunId=${CODE_RUN}`,
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(400);
  });
});
