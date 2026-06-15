/**
 * Tests for the behaviour-block save-back mapping (Seam 2 of Spec 2026-05-29
 * Business-logic behaviour capture, Gap C — Task Group 2).
 *
 * On save-approved, `convertCandidateToEntity` for a `business_logics`
 * candidate must map the 7-part behaviour block on `candidate.data.behavior`
 * onto the AMS `business_logics.behavior` JSONB column (added in Task Group 1).
 * When no block is present the column is left UNSET (absent key) — the block
 * is optional enrichment, not a required field.
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({ config: jest.fn() }));

import { DiscoveryCandidateDto } from '../services/archModelClient';
import { convertCandidateToEntity } from '../services/candidateSaveBackService';

function makeBusinessLogicCandidate(
  overrides: Partial<DiscoveryCandidateDto> = {},
): DiscoveryCandidateDto {
  return {
    id: 'cand-bl-1',
    run_id: 'run-001',
    candidate_type: 'business_logics',
    name: 'registerOwner',
    confidence: 0.66,
    status: 'proposed',
    source_cluster_ids: ['src/main/java/com/foo/service/OwnerService.java'],
    data: {},
    synthesized_at: '2026-05-29T10:00:00Z',
    parent_candidate_id: null,
    ...overrides,
  };
}

const BEHAVIOUR_BLOCK = {
  schema_version: 'behaviour.v1',
  method_id: 'com.foo.service.OwnerService#registerOwner(Owner)',
  source_hash: 'abc123',
  confidence: 0.66,
  io: { inputs: [{ name: 'owner', type: 'Owner', meaning: 'owner to register' }], output: { type: 'Owner', meaning: 'persisted owner' } },
  validation: [{ check: 'lastName non-empty', on_failure: 'InvalidOwnerException -> 400' }],
  transformation: 'normalize then save',
  data_effects: 'writes Owner (insert-or-update)',
  side_effects: 'none',
  edge_cases: ['null lastName'],
  provenance: { method_id: 'com.foo.service.OwnerService#registerOwner(Owner)' },
};

describe('candidateSaveBackService - business_logics behaviour mapping (Gap C)', () => {
  it('maps data.behavior onto entity.behavior verbatim, preserving the embedded confidence and 7 parts', () => {
    const candidate = makeBusinessLogicCandidate({
      data: {
        description: 'Registers a new owner',
        type_text: 'service-method',
        methodId: 'com.foo.service.OwnerService#registerOwner(Owner)',
        behavior: BEHAVIOUR_BLOCK,
      },
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', {});

    expect(entity.id).toMatch(/^bl-/);
    expect(entity.name).toBe('registerOwner');
    expect(entity.description_md).toBe('Registers a new owner');
    expect(entity.type_text).toBe('service-method');
    // The whole block rides through verbatim onto the JSONB column.
    expect(entity.behavior).toEqual(BEHAVIOUR_BLOCK);
    // Embedded confidence preserved as a number (boxed Double on the AMS side).
    expect(entity.behavior.confidence).toBe(0.66);
    expect(entity.behavior.io).toBeDefined();
    expect(Array.isArray(entity.behavior.edge_cases)).toBe(true);
  });

  it('leaves entity.behavior UNSET when the candidate carries no behaviour block', () => {
    const candidate = makeBusinessLogicCandidate({
      data: { description: 'No block captured', methodId: 'com.foo.X#m()' },
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', {});

    expect(entity.description_md).toBe('No block captured');
    // Absent key (not null) — mirrors the optional-enrichment contract.
    expect('behavior' in entity).toBe(false);
  });
});
