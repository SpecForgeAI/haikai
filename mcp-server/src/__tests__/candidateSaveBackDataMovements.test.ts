/**
 * Tests for the Outbound Integration Graph `data_movements` save-back producer.
 *
 * Spec: Outbound Integration Graph for Discovery (Java / Spring Classic +
 * Spring Boot), 2026-05-30 -- Task Group 5 (sub-task 5.1).
 *
 * The discovery Group-3 builder (`outboundIntegrationCandidates.ts`) emits a
 * `data_movements` candidate per resolved outbound edge whose `data` carries the
 * source service/interface NAME + the verbatim resolved target NAME (NO ids, NO
 * `*_points`). This producer resolves BOTH names to their AUTO-MANAGED
 * `application_point` ids via the deterministic `ap_{serviceId}` convention,
 * REUSING the shared normalized-name primitive.
 *
 * Covers (5.1, focused cases):
 *  1. A modellable candidate (source + target both resolve to in-model services)
 *     -> a row with `source_application_point_id` / `target_application_point_id`
 *     = `ap_{serviceId}` (NO `*_points` minted; exact MIXED snake/camel wire shape).
 *  2. `resolveApplicationPoint` reuses the SHARED matcher: a normalized name
 *     (`order-service` vs `OrderService`) resolves to the SAME `ap_{id}`, and an
 *     interface name resolves to `ap_{interfaceId}` (service vs interface arrays).
 *  3. A purely-external candidate (`targetLooksExternal: true`) produces NO row
 *     (skippedReason `external_target`) -- never a fabricated / null target.
 *  4. A candidate whose target name simply doesn't resolve in-model is ALSO
 *     external-only (no row), so the Finding (Group 3) is the sole record.
 *  5. Skip-not-fabricate: a candidate whose SOURCE cannot be resolved is skipped
 *     (skippedReason `source`), not written.
 *  6. The new candidate type maps to `relationships` / `data_movements`.
 *  7. Idempotency: re-running the full save-back does not duplicate a row matched
 *     on (source ap, target ap, movement_type).
 */

// Mock dotenv before importing anything else (matches the sibling test files).
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock the archModelClient so the orchestration idempotency test can drive the
// full `saveDiscoveryCandidatesToModel` flow against an in-memory model.
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
import {
  CANDIDATE_TYPE_CONFIG,
  getTargetArrayKey,
  resolveApplicationPoint,
  convertDataMovementToRow,
  saveDiscoveryCandidatesToModel,
  NAME_MATCH_EXACT_CONFIDENCE,
  CANDIDATE_AUTO_ACCEPT_THRESHOLD,
} from '../services/candidateSaveBackService';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a minimal architecture model carrying the given services / interfaces.
 * Only the fields the matcher reads (`name`, `id`) matter. `data_movements`
 * starts empty (the producer fills it).
 */
function makeModel(opts: {
  services?: Array<{ id: string; name: string }>;
  interfaces?: Array<{ id: string; name: string }>;
  dataMovements?: any[];
}): any {
  return {
    metaModel: {
      entities: {
        services: opts.services || [],
        interfaces: opts.interfaces || [],
      },
      relationships: {
        data_movements: opts.dataMovements || [],
      },
    },
  };
}

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-dm-default',
    run_id: 'run-001',
    candidate_type: 'data_movements',
    name: 'OrderService → InventoryService (HTTP)',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-05-30T10:00:00Z',
    parent_candidate_id: null,
    ...overrides,
  };
}

describe('candidateSaveBackService - outbound data_movements producer (TG5)', () => {
  // ==========================================================================
  // Test 1: modellable candidate -> a row with ap_{serviceId} on both sides.
  // ==========================================================================
  describe('convertDataMovementToRow - both sides in-model', () => {
    it('resolves source + target NAMES to ap_{serviceId} and emits the EXACT mixed wire shape', () => {
      const model = makeModel({
        services: [
          { id: 'svc-order', name: 'OrderService' },
          { id: 'svc-inventory', name: 'InventoryService' },
        ],
      });

      const candidate = makeCandidate({
        id: 'cand-dm-1',
        confidence: 0.92,
        data: {
          sourceServiceName: 'OrderService',
          targetName: 'InventoryService',
          target: 'InventoryService',
          movementType: 'outbound-rest',
          targetLooksExternal: false,
          httpVerb: 'GET',
        },
      });

      const conversion = convertDataMovementToRow(candidate, model, 'TestProject');

      expect(conversion.resolved).toBe(true);
      expect(conversion.skippedReason).toBeNull();

      const row = conversion.row;
      expect(row).not.toBeNull();
      // ap_{serviceId} convention on BOTH sides.
      expect(row.source_application_point_id).toBe('ap_svc-order');
      expect(row.target_application_point_id).toBe('ap_svc-inventory');
      // movement_type carries the integration kind.
      expect(row.movement_type).toBe('outbound-rest');
      // Mixed wire shape: snake_case structural + camelCase legacy XOR fields.
      expect(row.id).toMatch(/^dm-/);
      expect(row).toHaveProperty('dataEntityPointId', null);
      expect(row).toHaveProperty('interfaceWithSchemaId', null);
      expect(row).toHaveProperty('biDirectional', false);
      expect(row).toHaveProperty('description');
      expect(row).toHaveProperty('tags');
      expect(row).toHaveProperty('valid_from', null);
      expect(row).toHaveProperty('valid_to', null);
      // XOR both absent (null) -- never fabricated for an outbound dependency.
      expect(row.dataEntityPointId).toBeNull();
      expect(row.interfaceWithSchemaId).toBeNull();
      // No `*_points` wrapper minted: the producer only writes the relationship row.
      expect(model.metaModel.entities.application_points).toBeUndefined();
    });
  });

  // ==========================================================================
  // Test 2: resolveApplicationPoint REUSES the shared matcher (no fork).
  // ==========================================================================
  describe('resolveApplicationPoint - shared normalized-name primitive', () => {
    it('resolves an exact AND a normalized service name to the SAME ap_{serviceId}', () => {
      const model = makeModel({ services: [{ id: 'svc-order', name: 'OrderService' }] });

      const exact = resolveApplicationPoint(model, 'OrderService');
      expect(exact.pointId).toBe('ap_svc-order');
      expect(exact.matchKind).toBe('exact');
      expect(exact.confidence).toBe(NAME_MATCH_EXACT_CONFIDENCE);

      // A normalized variant (separator + case fold) resolves to the SAME id,
      // proving the shared `matchByNormalizedName` primitive is reused, not forked.
      const normalized = resolveApplicationPoint(model, 'order-service');
      expect(normalized.pointId).toBe('ap_svc-order');
      expect(normalized.matchKind).toBe('normalized');
      expect(normalized.confidence).toBeLessThan(CANDIDATE_AUTO_ACCEPT_THRESHOLD);
    });

    it('resolves an interface name to ap_{interfaceId} (services checked first)', () => {
      const model = makeModel({
        services: [{ id: 'svc-order', name: 'OrderService' }],
        interfaces: [{ id: 'ifc-payments', name: 'PaymentsApi' }],
      });

      expect(resolveApplicationPoint(model, 'PaymentsApi').pointId).toBe('ap_ifc-payments');
      // Unresolved name -> no fabrication.
      const miss = resolveApplicationPoint(model, 'NotInTheModel');
      expect(miss.pointId).toBeNull();
      expect(miss.matchKind).toBe('none');
    });
  });

  // ==========================================================================
  // Test 3: purely-external target (hint) -> NO row, no fabricated target.
  // ==========================================================================
  describe('convertDataMovementToRow - purely-external target (targetLooksExternal)', () => {
    it('produces NO row and skippedReason "external_target" (never a null/fake target)', () => {
      const model = makeModel({ services: [{ id: 'svc-order', name: 'OrderService' }] });

      const candidate = makeCandidate({
        id: 'cand-dm-ext',
        data: {
          sourceServiceName: 'OrderService',
          targetName: 'https://api.stripe.com/v1/charges',
          target: 'https://api.stripe.com/v1/charges',
          movementType: 'outbound-rest',
          targetLooksExternal: true,
        },
      });

      const conversion = convertDataMovementToRow(candidate, model, 'TestProject');
      expect(conversion.resolved).toBe(false);
      expect(conversion.row).toBeNull();
      expect(conversion.skippedReason).toBe('external_target');
    });
  });

  // ==========================================================================
  // Test 4: target name that simply doesn't resolve in-model -> external-only.
  // ==========================================================================
  describe('convertDataMovementToRow - unmodellable target name', () => {
    it('produces NO row when the target does not resolve to an in-model service/interface', () => {
      const model = makeModel({ services: [{ id: 'svc-order', name: 'OrderService' }] });

      const candidate = makeCandidate({
        id: 'cand-dm-unmodellable',
        data: {
          sourceServiceName: 'OrderService',
          // Not external by hint, but no in-model counterpart exists either.
          targetName: 'orders.events.topic',
          target: 'orders.events.topic',
          movementType: 'messaging-producer',
          targetLooksExternal: false,
        },
      });

      const conversion = convertDataMovementToRow(candidate, model, 'TestProject');
      expect(conversion.resolved).toBe(false);
      expect(conversion.row).toBeNull();
      expect(conversion.skippedReason).toBe('external_target');
    });
  });

  // ==========================================================================
  // Test 5: SOURCE unresolved -> skip-not-fabricate.
  // ==========================================================================
  describe('convertDataMovementToRow - unresolved source', () => {
    it('skips (skippedReason "source") and fabricates NO row when the source service is absent', () => {
      const model = makeModel({ services: [{ id: 'svc-inventory', name: 'InventoryService' }] });

      const candidate = makeCandidate({
        id: 'cand-dm-nosrc',
        data: {
          sourceServiceName: 'GhostServiceNotInModel',
          targetName: 'InventoryService',
          target: 'InventoryService',
          movementType: 'outbound-rest',
          targetLooksExternal: false,
        },
      });

      const conversion = convertDataMovementToRow(candidate, model, 'TestProject');
      expect(conversion.resolved).toBe(false);
      expect(conversion.row).toBeNull();
      expect(conversion.skippedReason).toBe('source');
    });
  });

  // ==========================================================================
  // Test 6: candidate type maps to relationships / data_movements.
  // ==========================================================================
  describe('CANDIDATE_TYPE_CONFIG - data_movements entry', () => {
    it('maps to { section: relationships, array: data_movements, prefix: dm-, parentFkField: null }', () => {
      const config = CANDIDATE_TYPE_CONFIG['data_movements'];
      expect(config).toBeDefined();
      expect(config.targetSection).toBe('relationships');
      expect(config.targetArrayKey).toBe('data_movements');
      expect(config.idPrefix).toBe('dm-');
      expect(config.parentFkField).toBeNull();
      expect(getTargetArrayKey('data_movements')).toBe('data_movements');
    });
  });

  // ==========================================================================
  // Test 7: idempotency through the full save-back flow (no duplicate row).
  // ==========================================================================
  describe('saveDiscoveryCandidatesToModel - data_movements idempotency', () => {
    it('does not duplicate a row matched on (source ap, target ap, movement_type) on re-run', async () => {
      const candidate = makeCandidate({
        id: 'cand-dm-idem',
        confidence: 0.9,
        data: {
          sourceServiceName: 'OrderService',
          targetName: 'InventoryService',
          target: 'InventoryService',
          movementType: 'outbound-rest',
          targetLooksExternal: false,
        },
      });

      // Persisted model accumulates across PUTs (simulates AMS storage).
      const persisted: any = makeModel({
        services: [
          { id: 'svc-order', name: 'OrderService' },
          { id: 'svc-inventory', name: 'InventoryService' },
        ],
      });

      const client = archModelClient as jest.Mocked<typeof archModelClient>;
      client.getProjectById.mockResolvedValue({ id: 'proj-1', name: 'TestProject' } as any);
      client.getCandidatesByRun.mockResolvedValue([candidate] as any);
      client.getCandidateEntityMappingsByRun.mockResolvedValue([] as any);
      // getModel returns the (mutating) persisted model each time.
      client.getModel.mockImplementation(async () => persisted);
      // putModel "saves" by replacing the persisted relationships with the PUT body's.
      // Signature: putModel(projectId, architectureId, filename, model).
      client.putModel.mockImplementation(async (..._args: any[]) => {
        const body = _args[3];
        persisted.metaModel.relationships.data_movements =
          body.metaModel.relationships.data_movements;
        return body;
      });
      client.updateCandidate.mockResolvedValue(undefined as any);
      client.bulkCreateCandidateEntityMappings.mockResolvedValue(undefined as any);
      client.bulkCreateDiscoveryFindings.mockResolvedValue(undefined as any);

      // First run: writes one data_movements row.
      await saveDiscoveryCandidatesToModel('proj-1', 'arch-1', 'run-001', 'auto');
      expect(persisted.metaModel.relationships.data_movements).toHaveLength(1);
      const firstRow = persisted.metaModel.relationships.data_movements[0];
      expect(firstRow.source_application_point_id).toBe('ap_svc-order');
      expect(firstRow.target_application_point_id).toBe('ap_svc-inventory');
      expect(firstRow.movement_type).toBe('outbound-rest');

      // Second run with the SAME candidate (idempotent re-run): still ONE row.
      // (The candidate mapping store is empty so the candidate is re-processed;
      // the producer's (source ap, target ap, movement_type) match prevents a dup.)
      await saveDiscoveryCandidatesToModel('proj-1', 'arch-1', 'run-001', 'auto');
      expect(persisted.metaModel.relationships.data_movements).toHaveLength(1);
    });
  });
});
