/**
 * DB Gap-Proposal routes (Spec 4 — LLM gap-proposal queue, 2026-08-04) —
 * focused route-surface tests.
 *
 * Covers ONLY:
 *   1. POST generate happy path: the LLM draft is validated + persisted to the
 *      AMS queue via the bulk upsert (origin 'llm').
 *   2. An unsupported finding kind returns supported:false and persists
 *      NOTHING (no AMS call, no LLM call).
 *   3. POST review approve: PATCHes review_status, calls the MCP
 *      apply_gap_metadata tool with the delta built from payload_json, and
 *      stamps applied_at ONLY on a real apply; an already-populated slot
 *      leaves the row approved with the skip note surfaced honestly.
 *   4. POST manual with a hallucinated column -> 400, nothing persisted.
 *
 * Deps-seam injection via createDbGapProposalsRouter (fetchModel / callLlm /
 * fetchImpl) — the same injected-deps idiom the pack generator uses.
 */

// ---------------------------------------------------------------------------
// Mocks — declared before importing the units under test
// ---------------------------------------------------------------------------

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    discoveryServiceBaseUrl: 'http://localhost:8091',
    mcpBaseUrl: 'http://localhost:8090',
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import { createDbGapProposalsRouter } from '../routes/dbGapProposals';
import { CommittedPhysicalModel } from '../services/dbMigrationPack/inputs';

function createTestApp(deps: {
  fetchModel?: jest.Mock;
  callLlm?: jest.Mock;
  fetchImpl?: jest.Mock;
}) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(
    '/api/v1',
    createDbGapProposalsRouter({
      fetchModel: deps.fetchModel as never,
      callLlm: deps.callLlm as never,
      fetchImpl: deps.fetchImpl as never,
    })
  );
  return app;
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    text: async () => JSON.stringify(body),
  };
}

/** Committed model: TRADE -> CUSTOMER relationship WITHOUT fk_columns. */
function makeModel(): CommittedPhysicalModel {
  return {
    physicalDataEntities: [
      { id: 'pe-1', name: 'TRADE', physical_type: 'Table' },
      { id: 'pe-2', name: 'CUSTOMER', physical_type: 'Table' },
    ],
    physicalDataAttributes: [
      {
        id: 'pa-1',
        name: 'customer_id',
        physical_entity_id: 'pe-1',
        data_type: 'numeric',
        ordinal: 1,
      },
      { id: 'pa-2', name: 'id', physical_entity_id: 'pe-2', data_type: 'numeric', ordinal: 1 },
    ],
    dataEntityPoints: [
      { id: 'dep-1', physical_entity_id: 'pe-1' },
      { id: 'dep-2', physical_entity_id: 'pe-2' },
    ],
    dataEntityRelationships: [
      { id: 'rel-1', fromDataEntityPointId: 'dep-1', toDataEntityPointId: 'dep-2' },
    ],
  };
}

const FK_LLM_CONTENT = JSON.stringify({
  proposals: [
    {
      relationship_id: 'rel-1',
      from_table: 'TRADE',
      join_columns: ['customer_id'],
      to_table: 'CUSTOMER',
      referenced_columns: ['id'],
      rationale: 'customer_id matches CUSTOMER.id by convention',
      confidence: 'high',
    },
  ],
});

// ---------------------------------------------------------------------------
// 1. generate happy path persists rows to AMS
// ---------------------------------------------------------------------------

describe('POST generate', () => {
  it('validates the LLM draft against the model and PUTs the rows to the AMS queue with origin llm', async () => {
    const fetchModel = jest.fn().mockResolvedValue(makeModel());
    const callLlm = jest.fn().mockResolvedValue({ content: FK_LLM_CONTENT });
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, []));
    const app = createTestApp({ fetchModel, callLlm, fetchImpl });

    const res = await request(app)
      .post('/api/v1/projects/p-1/db-gap-proposals/generate')
      .send({
        architecture_id: 'arch-1',
        finding_kind: 'relationships_without_fk_columns',
        finding_key: 'sf--relationships_without_fk_columns',
      });

    expect(res.status).toBe(200);
    expect(res.body.supported).toBe(true);
    expect(res.body.proposals).toHaveLength(1);
    expect(res.body.proposals[0].proposal_key).toBe('fk--rel-1');
    expect(fetchModel).toHaveBeenCalledWith('p-1', 'arch-1');

    // Exactly one AMS round trip: the bulk upsert of the validated rows.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:8080/api/projects/p-1/db-gap-proposals');
    expect(init.method).toBe('PUT');
    const rows = JSON.parse(init.body);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      proposal_key: 'fk--rel-1',
      finding_key: 'sf--relationships_without_fk_columns',
      kind: 'fk_join',
      origin: 'llm',
      confidence: 'high',
      payload_json: {
        relationship_id: 'rel-1',
        from_table: 'TRADE',
        join_columns: ['customer_id'],
        to_table: 'CUSTOMER',
        referenced_columns: ['id'],
      },
    });
  });

  // -------------------------------------------------------------------------
  // 2. unsupported finding kind persists nothing
  // -------------------------------------------------------------------------
  it('returns supported:false for a non-draftable finding kind and persists NOTHING', async () => {
    const fetchModel = jest.fn().mockResolvedValue(makeModel());
    const callLlm = jest.fn();
    const fetchImpl = jest.fn();
    const app = createTestApp({ fetchModel, callLlm, fetchImpl });

    const res = await request(app)
      .post('/api/v1/projects/p-1/db-gap-proposals/generate')
      .send({
        architecture_id: 'arch-1',
        finding_kind: 'collation_hazard',
        finding_key: 'sf--collation_hazard',
      });

    expect(res.status).toBe(200);
    expect(res.body.supported).toBe(false);
    expect(res.body.unsupportedReason).toContain('collation_hazard');
    expect(res.body.proposals).toEqual([]);
    // Neither the LLM nor AMS was touched.
    expect(callLlm).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. review approve — MCP apply + applied_at stamping
// ---------------------------------------------------------------------------

describe('POST review approve', () => {
  const QUEUE_ROW = {
    id: 'gp-1',
    proposal_key: 'fk--rel-1',
    finding_key: 'sf--relationships_without_fk_columns',
    kind: 'fk_join',
    payload_json: {
      relationship_id: 'rel-1',
      from_table: 'TRADE',
      join_columns: ['customer_id'],
      to_table: 'CUSTOMER',
      referenced_columns: ['id'],
    },
    review_status: 'unreviewed',
  };

  function reviewFetchImpl(mcpResult: { applied: number; skipped: unknown[] }) {
    return jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.startsWith('http://localhost:8090/mcp/tools/apply_gap_metadata')) {
        return jsonResponse(200, mcpResult);
      }
      if (method === 'GET') return jsonResponse(200, [QUEUE_ROW]);
      if (method === 'PATCH') return jsonResponse(200, {});
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
  }

  it('PATCHes approved, calls MCP apply with the payload-derived delta, and stamps applied_at on a real apply', async () => {
    const fetchImpl = reviewFetchImpl({ applied: 1, skipped: [] });
    const app = createTestApp({ fetchImpl });

    const res = await request(app)
      .post('/api/v1/projects/p-1/db-gap-proposals/gp-1/review')
      .send({ action: 'approve', architecture_id: 'arch-1', reviewer_notes: 'looks right' });

    expect(res.status).toBe(200);
    expect(res.body.review_status).toBe('approved');
    expect(res.body.apply).toEqual({ applied: 1, skipped: [] });
    expect(res.body.applied_at).toEqual(expect.any(String));

    // MCP apply carried the delta built from payload_json (explicit null
    // referential actions — proposals never infer them).
    const mcpCall = fetchImpl.mock.calls.find(([u]: [string]) =>
      u.includes('/mcp/tools/apply_gap_metadata')
    );
    expect(mcpCall).toBeDefined();
    expect(JSON.parse(mcpCall![1].body)).toEqual({
      sessionId: 'gateway',
      projectId: 'p-1',
      architectureId: 'arch-1',
      deltas: [
        {
          kind: 'fk_join',
          relationship_id: 'rel-1',
          fk_columns: {
            join_columns: ['customer_id'],
            referenced_columns: ['id'],
            on_delete: null,
            on_update: null,
          },
        },
      ],
    });

    // Two AMS PATCHes: first the approve verdict, then the applied_at stamp.
    const patches = fetchImpl.mock.calls.filter(
      ([, init]: [string, RequestInit]) => init?.method === 'PATCH'
    );
    expect(patches).toHaveLength(2);
    expect(patches[0][0]).toBe('http://localhost:8080/api/projects/p-1/db-gap-proposals/gp-1');
    expect(JSON.parse(patches[0][1].body)).toEqual({
      review_status: 'approved',
      reviewer_notes: 'looks right',
    });
    expect(JSON.parse(patches[1][1].body)).toEqual({ applied_at: expect.any(String) });
  });

  it('still marks approved but surfaces the skip note honestly (and stamps NO applied_at) when the slot was already populated', async () => {
    const skip = { delta: { kind: 'fk_join' }, reason: 'relationship "rel-1" already carries fk_columns' };
    const fetchImpl = reviewFetchImpl({ applied: 0, skipped: [skip] });
    const app = createTestApp({ fetchImpl });

    const res = await request(app)
      .post('/api/v1/projects/p-1/db-gap-proposals/gp-1/review')
      .send({ action: 'approve', architecture_id: 'arch-1' });

    expect(res.status).toBe(200);
    expect(res.body.review_status).toBe('approved');
    expect(res.body.apply.skipped[0].reason).toContain('already carries fk_columns');
    expect(res.body.applied_at).toBeNull();
    // ONLY the approve PATCH — no applied_at stamp for a no-op apply.
    const patches = fetchImpl.mock.calls.filter(
      ([, init]: [string, RequestInit]) => init?.method === 'PATCH'
    );
    expect(patches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. manual proposal with a hallucinated column -> 400
// ---------------------------------------------------------------------------

describe('POST manual', () => {
  it('rejects a payload naming a column the committed model does not have (400, nothing persisted)', async () => {
    const fetchModel = jest.fn().mockResolvedValue(makeModel());
    const fetchImpl = jest.fn();
    const app = createTestApp({ fetchModel, fetchImpl });

    const res = await request(app)
      .post('/api/v1/projects/p-1/db-gap-proposals/manual')
      .send({
        architecture_id: 'arch-1',
        finding_key: 'sf--relationships_without_fk_columns',
        kind: 'fk_join',
        payload_json: {
          relationship_id: 'rel-1',
          join_columns: ['not_a_real_column'],
          referenced_columns: ['id'],
        },
        rationale: 'typo on purpose',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.warnings.join(' ')).toContain('hallucinated column');
    // The invalid row NEVER reached the AMS queue.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('persists a valid manual row with origin manual and the derived proposal_key', async () => {
    const fetchModel = jest.fn().mockResolvedValue(makeModel());
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, []));
    const app = createTestApp({ fetchModel, fetchImpl });

    const res = await request(app)
      .post('/api/v1/projects/p-1/db-gap-proposals/manual')
      .send({
        architecture_id: 'arch-1',
        finding_key: 'sf--no_primary_keys',
        kind: 'primary_key',
        payload_json: { table: 'CUSTOMER', columns: ['id'] },
        rationale: 'id is the natural key',
      });

    expect(res.status).toBe(200);
    expect(res.body.proposal.proposal_key).toBe('pk--customer');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:8080/api/projects/p-1/db-gap-proposals');
    expect(init.method).toBe('PUT');
    const rows = JSON.parse(init.body);
    expect(rows[0]).toMatchObject({
      proposal_key: 'pk--customer',
      kind: 'primary_key',
      origin: 'manual',
      confidence: 'high',
      rationale: 'id is the natural key',
      payload_json: { table: 'CUSTOMER', entity_id: 'pe-2', columns: ['id'] },
    });
  });
});
