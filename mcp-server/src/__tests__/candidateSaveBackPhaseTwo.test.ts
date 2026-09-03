/**
 * Save-back phase 2 — FAIL LOUD (2026-09-03).
 *
 * Relationship rows that FK to entities created by the first model PUT
 * (`endpoint_data_effects` among them) are held out and landed by a SECOND
 * PUT. Pre-fix a phase-2 failure was a console.warn and every candidate was
 * still stamped `committed` — while the replace-all phase-1 PUT had already
 * deleted the PRIOR rows of those kinds. A whole architecture's effect map
 * vanished with 525 candidates reading `committed`.
 *
 * Pins:
 *   1. a rejected phase-2 PUT leaves the effect candidate UN-committed,
 *      records a blocked reason naming the HTTP status, and reports the
 *      phase on the result;
 *   2. a phase-2 PUT that "succeeds" while the store drops the rows is caught
 *      by the post-PUT re-read and treated exactly like a failure;
 *   3. control: rows that land are stamped committed with a clean phase.
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../services/archModelClient', () => {
  const actual = jest.requireActual('../services/archModelClient');
  return {
    ...actual,
    archModelClient: {
      getProjectById: jest.fn(),
      getCandidatesByRun: jest.fn(),
      getCandidateEntityMappingsByRun: jest.fn(),
      getModel: jest.fn(),
      putModel: jest.fn(),
      updateCandidate: jest.fn(),
      bulkCreateCandidateEntityMappings: jest.fn(),
      bulkCreateDiscoveryFindings: jest.fn(),
    },
  };
});

import { DiscoveryCandidateDto, archModelClient } from '../services/archModelClient';
import { saveDiscoveryCandidatesToModel } from '../services/candidateSaveBackService';

function makeModel(): any {
  return {
    metaModel: {
      entities: {
        services: [],
        interfaces: [],
        endpoints: [{ id: 'ep-1', name: 'POST /api/deal-books' }],
        physical_data_entities: [{ id: 'pde-1', name: 'deal_book' }],
      },
      relationships: {
        endpoint_data_effects: [],
      },
    },
  };
}

function effectCandidate(id: string): DiscoveryCandidateDto {
  return {
    id,
    run_id: 'run-001',
    candidate_type: 'endpoint_data_effects',
    name: 'POST /api/deal-books → deal_book (write)',
    confidence: 0.9,
    status: 'approved',
    source_cluster_ids: [],
    data: {
      endpoint_id: 'ep-1',
      data_entity_point_id: 'dep_phy_pde-1',
      access_mode: 'write',
    },
  } as unknown as DiscoveryCandidateDto;
}

type PutBehaviour = 'persist' | 'reject-second' | 'drop-silently';

function wireClient(candidates: DiscoveryCandidateDto[], persisted: any, behaviour: PutBehaviour) {
  const client = archModelClient as jest.Mocked<typeof archModelClient>;
  let putCalls = 0;
  client.getProjectById.mockResolvedValue({ id: 'proj-1', name: 'TestProject' } as any);
  client.getCandidatesByRun.mockResolvedValue(candidates as any);
  client.getCandidateEntityMappingsByRun.mockResolvedValue([] as any);
  // The store hands back a COPY, as the real GET does — otherwise the
  // save-back's in-memory mutations would leak into the "persisted" model
  // and the post-PUT assertion could never observe a dropped row.
  client.getModel.mockImplementation(async () => JSON.parse(JSON.stringify(persisted)));
  client.putModel.mockImplementation(async (..._args: any[]) => {
    putCalls += 1;
    const body = _args[3];
    if (behaviour === 'reject-second' && putCalls === 2) {
      throw Object.assign(new Error('Request failed with status code 413'), {
        response: { status: 413, data: 'request entity too large' },
      });
    }
    if (behaviour !== 'drop-silently') {
      persisted.metaModel.relationships.endpoint_data_effects =
        body.metaModel.relationships.endpoint_data_effects;
    }
    return body;
  });
  client.updateCandidate.mockResolvedValue(undefined as any);
  client.bulkCreateCandidateEntityMappings.mockResolvedValue(undefined as any);
  client.bulkCreateDiscoveryFindings.mockResolvedValue(undefined as any);
  return client;
}

function committedStampsFor(client: jest.Mocked<typeof archModelClient>, candidateId: string) {
  return client.updateCandidate.mock.calls.filter(
    (call: any[]) => call[3] === candidateId && call[4]?.review_status === 'committed',
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('save-back phase 2 fails loud (2026-09-03)', () => {
  it('a rejected phase-2 PUT leaves the effect candidate UN-committed, blocked with the HTTP status', async () => {
    const persisted = makeModel();
    const client = wireClient([effectCandidate('cand-write')], persisted, 'reject-second');

    const result = await saveDiscoveryCandidatesToModel('proj-1', 'arch-1', 'run-001', 'auto');

    // Two PUTs were attempted (phase 1 + phase 2).
    expect(client.putModel).toHaveBeenCalledTimes(2);
    // NOT stamped committed.
    expect(committedStampsFor(client, 'cand-write')).toHaveLength(0);
    // Blocked reason names the failure.
    const blocked = result.reasons.find((r) => r.candidateId === 'cand-write');
    expect(blocked?.reason).toBe('blocked');
    expect(result.relationshipsPhase).toMatchObject({ attempted: 1, landed: 0, failed: 1 });
    expect(result.relationshipsPhase?.error).toContain('HTTP 413');
    expect(result.candidatesCommitted).toBe(0);
  });

  it('a phase-2 PUT that succeeds while the store DROPS the rows is caught by the post-PUT re-read', async () => {
    const persisted = makeModel();
    const client = wireClient([effectCandidate('cand-write')], persisted, 'drop-silently');

    const result = await saveDiscoveryCandidatesToModel('proj-1', 'arch-1', 'run-001', 'auto');

    expect(committedStampsFor(client, 'cand-write')).toHaveLength(0);
    expect(result.reasons.find((r) => r.candidateId === 'cand-write')?.reason).toBe('blocked');
    expect(result.relationshipsPhase).toMatchObject({ attempted: 1, landed: 0, failed: 1 });
    expect(result.relationshipsPhase?.error).toContain('post-PUT assertion');
  });

  it('control: rows that land are stamped committed with a clean phase report', async () => {
    const persisted = makeModel();
    const client = wireClient([effectCandidate('cand-write')], persisted, 'persist');

    const result = await saveDiscoveryCandidatesToModel('proj-1', 'arch-1', 'run-001', 'auto');

    expect(committedStampsFor(client, 'cand-write')).toHaveLength(1);
    expect(persisted.metaModel.relationships.endpoint_data_effects).toHaveLength(1);
    expect(result.relationshipsPhase).toEqual({ attempted: 1, landed: 1, failed: 0, error: null });
    expect(result.reasons.find((r) => r.candidateId === 'cand-write')?.reason).toBe('created');
  });
});
