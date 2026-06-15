/**
 * Tests for the Endpoint->Data-Effect Call Graph save-back layer.
 *
 * Spec: Endpoint->Data-Effect Call Graph for Discovery (2026-05-29)
 * Task Group 2: Persist edge candidates + upgrade the shared identity/matching
 * primitive.
 *
 * Covers (per sub-task 2.1, 5-7 focused cases):
 *  1. `resolveEntityToPointId` resolves `Owner` == `owners` == `OWNER` to the
 *     SAME point id (the duplication fix), across logical AND physical arrays.
 *  2. Exact-name matches return the pre-upgrade result unchanged (no regression
 *     for the existing call sites).
 *  3. A normalized (below-threshold fuzzy) match exposes a LOW confidence via
 *     the richer `resolveEntityPoint` primitive (not just a string).
 *  4. A genuinely unresolved name returns the unresolved outcome (null + 'none')
 *     so the caller can route to a finding instead of fabricating a point id.
 *  5. An `endpoint_data_effects` candidate converts to the AMS relationship row
 *     with both sides resolved THROUGH the primitive, carrying access_mode +
 *     confidence + path_metadata_json.
 *  6. The new candidate type maps to the `relationships` section /
 *     `endpoint_data_effects` target array (parallel to
 *     `interface_logical_entities`).
 *  7. When a side cannot be resolved, the converter fabricates NO row.
 */

// Mock dotenv before importing anything else (matches the sibling test files).
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

import { DiscoveryCandidateDto } from '../services/archModelClient';
import {
  CANDIDATE_TYPE_CONFIG,
  getTargetArrayKey,
  resolveEntityToPointId,
  resolveEntityPoint,
  convertEndpointDataEffectToRow,
  CANDIDATE_AUTO_ACCEPT_THRESHOLD,
  NAME_MATCH_EXACT_CONFIDENCE,
} from '../services/candidateSaveBackService';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a minimal architecture model with the given logical / physical /
 * endpoint entities. Only the fields the matcher reads (`name`, `id`) matter.
 */
function makeModel(opts: {
  logical?: Array<{ id: string; name: string }>;
  physical?: Array<{ id: string; name: string }>;
  endpoints?: Array<{ id: string; name: string }>;
}): any {
  return {
    metaModel: {
      entities: {
        logical_data_entities: opts.logical || [],
        physical_data_entities: opts.physical || [],
        endpoints: opts.endpoints || [],
      },
      relationships: {},
    },
  };
}

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-ede-default',
    run_id: 'run-001',
    candidate_type: 'endpoint_data_effects',
    name: 'OwnerController.create -> Owner',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-05-29T10:00:00Z',
    parent_candidate_id: null,
    ...overrides,
  };
}

describe('candidateSaveBackService - endpoint data-effect edges (TG2)', () => {
  // ==========================================================================
  // Test 1: Owner / owners / OWNER all resolve to the SAME point id.
  // ==========================================================================
  describe('resolveEntityToPointId - normalized-name match (duplication fix)', () => {
    it('resolves "Owner", "owners" and "OWNER" to the SAME logical point id', () => {
      const model = makeModel({ logical: [{ id: 'le-owner', name: 'Owner' }] });

      const exact = resolveEntityToPointId(model, 'Owner');
      const plural = resolveEntityToPointId(model, 'owners');
      const upper = resolveEntityToPointId(model, 'OWNER');

      expect(exact).toBe('dep_log_le-owner');
      expect(plural).toBe('dep_log_le-owner');
      expect(upper).toBe('dep_log_le-owner');
    });

    it('also resolves across the physical array (snake_case plural -> Pascal singular)', () => {
      // The physical entity is named with a snake_case plural ("owners_table"
      // is intentionally NOT used here -- we test the separator+plural fold on
      // a representative physical table name).
      const model = makeModel({ physical: [{ id: 'pe-owner', name: 'owners' }] });

      // A PascalCase singular reference resolves to the plural physical row.
      expect(resolveEntityToPointId(model, 'Owner')).toBe('dep_phy_pe-owner');
      expect(resolveEntityToPointId(model, 'owners')).toBe('dep_phy_pe-owner');
    });
  });

  // ==========================================================================
  // Test 2: Exact match returns the pre-upgrade result unchanged.
  // ==========================================================================
  describe('resolveEntityToPointId - exact match unchanged (no regression)', () => {
    it('returns dep_log_<id> for an exact logical name and dep_phy_<id> for an exact physical name', () => {
      const model = makeModel({
        logical: [{ id: 'le-1', name: 'Customer' }],
        physical: [{ id: 'pe-1', name: 'orders_table' }],
      });

      expect(resolveEntityToPointId(model, 'Customer')).toBe('dep_log_le-1');
      expect(resolveEntityToPointId(model, 'orders_table')).toBe('dep_phy_pe-1');
    });

    it('prefers an exact match over a normalized near-match in the other array', () => {
      // Logical has the normalized near-name; physical has the EXACT name.
      // The exact match must win regardless of array order.
      const model = makeModel({
        logical: [{ id: 'le-near', name: 'visits' }],
        physical: [{ id: 'pe-exact', name: 'Visit' }],
      });

      const match = resolveEntityPoint(model, 'Visit');
      expect(match.matchKind).toBe('exact');
      expect(match.confidence).toBe(NAME_MATCH_EXACT_CONFIDENCE);
      expect(match.pointId).toBe('dep_phy_pe-exact');
    });
  });

  // ==========================================================================
  // Test 3: Normalized (fuzzy) match exposes a LOW confidence.
  // ==========================================================================
  describe('resolveEntityPoint - normalized match carries a LOW confidence', () => {
    it('returns the resolved point id with a confidence below the auto-accept threshold', () => {
      const model = makeModel({ logical: [{ id: 'le-pet', name: 'Pet' }] });

      const match = resolveEntityPoint(model, 'pets');

      expect(match.pointId).toBe('dep_log_le-pet');
      expect(match.matchKind).toBe('normalized');
      // The matcher exposes a confidence, not just a string...
      expect(typeof match.confidence).toBe('number');
      // ...and a fuzzy resolution is LOW (below the 0.75 auto-accept gate).
      expect(match.confidence).toBeLessThan(CANDIDATE_AUTO_ACCEPT_THRESHOLD);
    });
  });

  // ==========================================================================
  // Test 4: Genuinely unresolved name -> unresolved outcome (no fabrication).
  // ==========================================================================
  describe('resolveEntityPoint - unresolved name', () => {
    it('returns { pointId: null, matchKind: "none" } so the caller can route to a finding', () => {
      const model = makeModel({ logical: [{ id: 'le-1', name: 'Owner' }] });

      const match = resolveEntityPoint(model, 'SomethingNotInTheModel');
      expect(match.pointId).toBeNull();
      expect(match.matchKind).toBe('none');
      expect(match.confidence).toBe(0);

      // The compat shim collapses the same outcome to null.
      expect(resolveEntityToPointId(model, 'SomethingNotInTheModel')).toBeNull();
    });
  });

  // ==========================================================================
  // Test 5: endpoint_data_effects candidate -> AMS relationship row.
  // ==========================================================================
  describe('convertEndpointDataEffectToRow - emits the AMS row shape', () => {
    it('resolves BOTH sides via the primitive and carries access_mode / confidence / path_metadata_json', () => {
      const model = makeModel({
        endpoints: [{ id: 'ep-create-owner', name: 'OwnerController.create' }],
        logical: [{ id: 'le-owner', name: 'Owner' }],
      });

      const pathMetadata = {
        hops: [
          { fqn: 'com.foo.OwnerController', signature: 'create(Owner)' },
          { fqn: 'com.foo.OwnerService', signature: 'save(Owner)' },
          { fqn: 'com.foo.OwnerRepository', signature: 'save(Owner)' },
        ],
        operation: 'insert',
        transactional: true,
      };

      const candidate = makeCandidate({
        id: 'cand-ede-1',
        confidence: 0.92,
        data: {
          endpointName: 'OwnerController.create',
          // entity reference is a PascalCase singular; resolves via the primitive
          entityName: 'owners',
          access_mode: 'write',
          path_metadata_json: pathMetadata,
          description: 'create writes Owner',
        },
      });

      const conversion = convertEndpointDataEffectToRow(candidate, model, 'TestProject');

      expect(conversion.resolved).toBe(true);
      expect(conversion.unresolvedSide).toBeNull();

      const row = conversion.row;
      expect(row).not.toBeNull();
      // AMS endpoint_data_effects row shape -- snake_case wire keys.
      expect(row.id).toMatch(/^ede-/);
      expect(row.endpoint_id).toBe('ep-create-owner');
      expect(row.data_entity_point_id).toBe('dep_log_le-owner');
      expect(row.access_mode).toBe('write');
      expect(row.path_metadata_json).toEqual(pathMetadata);
      expect(row.description).toBe('create writes Owner');
      // Confidence is carried through (folded with the side confidences).
      expect(typeof row.confidence).toBe('number');
      // Snake_case-only contract: no camelCase leakage of the point-id field.
      expect(row.dataEntityPointId).toBeUndefined();
    });
  });

  // ==========================================================================
  // Test 6: The candidate type maps to relationships / endpoint_data_effects.
  // ==========================================================================
  describe('CANDIDATE_TYPE_CONFIG - endpoint_data_effects entry', () => {
    it('maps to { section: relationships, array: endpoint_data_effects, prefix: ede-, parentFkField: null }', () => {
      const config = CANDIDATE_TYPE_CONFIG['endpoint_data_effects'];
      expect(config).toBeDefined();
      expect(config.targetSection).toBe('relationships');
      expect(config.targetArrayKey).toBe('endpoint_data_effects');
      expect(config.idPrefix).toBe('ede-');
      expect(config.parentFkField).toBeNull();
      // getTargetArrayKey resolves the same array key.
      expect(getTargetArrayKey('endpoint_data_effects')).toBe('endpoint_data_effects');
    });
  });

  // ==========================================================================
  // Test 7: Unresolved side -> NO fabricated row.
  // ==========================================================================
  describe('convertEndpointDataEffectToRow - unresolved side', () => {
    it('returns resolved:false and row:null when the data entity cannot be resolved', () => {
      const model = makeModel({
        endpoints: [{ id: 'ep-1', name: 'OwnerController.create' }],
        logical: [{ id: 'le-owner', name: 'Owner' }],
      });

      const candidate = makeCandidate({
        id: 'cand-ede-unresolved',
        data: {
          endpointName: 'OwnerController.create',
          entityName: 'GhostEntityNotInModel',
          access_mode: 'read',
        },
      });

      const conversion = convertEndpointDataEffectToRow(candidate, model, 'TestProject');
      expect(conversion.resolved).toBe(false);
      expect(conversion.row).toBeNull();
      expect(conversion.unresolvedSide).toBe('data_entity');
    });
  });
});
