/**
 * Internal (non-HTTP) entry-point save-back (Spec 2026-07-23).
 *
 * Pre-fix, scheduled / listener / batch endpoint candidates were dropped at
 * commit in TWO ways: (1) skipped WHOLESALE as orphans (a scheduler class has
 * no parent interface candidate), and (2) even a committed row lost its
 * `endpoint_subtype` discriminator. The committed model therefore never
 * carried internal entry points and the migration plan's "re-scan and commit"
 * prerequisite was a dead end.
 *
 * Pins: subtype + provenance land in protocol_metadata_json (SOAP idiom);
 * outbound subtypes derive `direction='outbound'`; plain REST rows unchanged;
 * the synthesized "Internal Processing" interface find-or-create contract.
 */
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

import { DiscoveryCandidateDto } from '../services/archModelClient';
import {
  convertCandidateToEntity,
  findOrCreateInternalProcessingInterface,
  INTERNAL_PROCESSING_INTERFACE_NAME,
} from '../services/candidateSaveBackService';

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-ep-1',
    run_id: 'run-1',
    candidate_type: 'endpoints',
    name: 'SCHEDULED 0 0 * * * *',
    confidence: 0.9,
    status: 'approved',
    source_cluster_ids: [],
    data: {},
    parent_candidate_id: 'cand-ifc-1',
    ...overrides,
  } as DiscoveryCandidateDto;
}

const PARENT_MAP: Record<string, string> = { 'cand-ifc-1': 'ifc-internal-1' };

describe('internal endpoint subtype persistence', () => {
  it('bundles endpoint_subtype + job provenance into protocol_metadata_json', () => {
    const entity = convertCandidateToEntity(
      makeCandidate({
        data: {
          httpMethod: 'SCHEDULED',
          fullPath: '0 0 * * * *',
          endpoint_subtype: 'scheduled',
          listenerAnnotation: 'Scheduled',
          className: 'NightlyRollupJob',
          methodName: 'run',
        },
      }),
      'TestProject',
      PARENT_MAP,
    );
    expect(entity.operation_verb).toBe('SCHEDULED'); // non-HTTP token -> planner classifies internal
    expect(entity.protocol_metadata_json).toEqual({
      endpoint_subtype: 'scheduled',
      listenerAnnotation: 'Scheduled',
      className: 'NightlyRollupJob',
      methodName: 'run',
    });
    expect(entity.direction).toBeUndefined(); // internal, not outbound
  });

  it('outbound subtype derives direction=outbound (latent planner-exclusion fix)', () => {
    const entity = convertCandidateToEntity(
      makeCandidate({
        name: 'GET /downstream/thing',
        data: {
          httpMethod: 'GET',
          fullPath: '/downstream/thing',
          endpoint_subtype: 'outbound-rest',
          integrationKind: 'feign',
        },
      }),
      'TestProject',
      PARENT_MAP,
    );
    expect(entity.direction).toBe('outbound');
    expect(entity.protocol_metadata_json).toEqual({ endpoint_subtype: 'outbound-rest' });
  });

  it('plain REST endpoint (no subtype) is byte-identical to before: no blob, no direction', () => {
    const entity = convertCandidateToEntity(
      makeCandidate({
        name: 'GET /things',
        data: { httpMethod: 'GET', fullPath: '/things' },
      }),
      'TestProject',
      PARENT_MAP,
    );
    expect(entity.protocol_metadata_json).toBeUndefined();
    expect(entity.direction).toBeUndefined();
  });
});

describe('findOrCreateInternalProcessingInterface', () => {
  function model(entities: Record<string, unknown[]>) {
    return { metaModel: { entities } };
  }

  it('creates the interface under the model\'s first service (service_id NOT NULL)', () => {
    const m = model({ services: [{ id: 'svc-1', name: 'App' }], interfaces: [] });
    const iface = findOrCreateInternalProcessingInterface(m, 'TestProject');
    expect(iface).not.toBeNull();
    const created = (m.metaModel.entities.interfaces as any[])[0];
    expect(created.name).toBe(INTERNAL_PROCESSING_INTERFACE_NAME);
    expect(created.service_id).toBe('svc-1');
    expect(created.model_file_id).toBe('TestProject');
    expect(created.interface_type).toBe('INTERNAL_PROCESS');
    expect(created.id).toMatch(/^ifc-/);
  });

  it('idempotent: an existing "Internal Processing" interface is reused, never duplicated', () => {
    const existing = { id: 'ifc-prior', name: INTERNAL_PROCESSING_INTERFACE_NAME };
    const m = model({ services: [{ id: 'svc-1' }], interfaces: [existing] });
    const iface = findOrCreateInternalProcessingInterface(m, 'TestProject');
    expect(iface).toBe(existing);
    expect((m.metaModel.entities.interfaces as any[]).length).toBe(1);
  });

  it('no services in the model -> null (caller keeps the honest orphan-block)', () => {
    const m = model({ services: [], interfaces: [] });
    expect(findOrCreateInternalProcessingInterface(m, 'TestProject')).toBeNull();
  });
});
