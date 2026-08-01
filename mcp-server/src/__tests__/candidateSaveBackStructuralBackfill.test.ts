/**
 * Structural-fidelity carriage + backfill (2026-08-01).
 *
 * The pre-fix save-back dropped the DB packs' structural truth at commit:
 *   - physical entities lost `constraints_metadata` entirely and wrote the
 *     database name under `database_name` (the DTO wire key is `database`,
 *     so Jackson silently ignored it);
 *   - physical attributes lost all six PhysicalDataAttributeDto fidelity
 *     slots (source_type/scale/precision/column_default/ordinal/is_identity);
 *   - relationship rows never carried `fk_columns`.
 *
 * Because re-discovery routes through the dedup-suppression / idempotent
 * reuse paths (which reuse existing rows untouched), the fix also BACKFILLS
 * those fields additively on existing rows so a re-scan + approve + save
 * repairs a model committed before the fix. These tests drive the REAL
 * `saveDiscoveryCandidatesToModel` orchestration with axios mocked at the
 * module level (mirrors candidateSaveBackModelAware.test.ts).
 */

// Mock dotenv before importing anything else.
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios at the module level so archModelClient uses our mock.
jest.mock('axios');

import { DiscoveryCandidateDto } from '../services/archModelClient';

// ============================================================================
// Helpers
// ============================================================================

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-default',
    run_id: 'run-001',
    candidate_type: 'physical_data_entities',
    name: 'DefaultEntity',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-08-01T10:00:00Z',
    parent_candidate_id: null,
    ...overrides,
  };
}

function makeModel(opts: {
  physical?: any[];
  physicalAttrs?: any[];
  rels?: any[];
} = {}): any {
  return {
    metaModel: {
      entities: {
        applications: [],
        services: [],
        interfaces: [],
        endpoints: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: opts.physical || [],
        physical_data_attributes: opts.physicalAttrs || [],
      },
      relationships: {
        logical_data_entity_relationships: opts.rels || [],
        logical_data_entity_physical_data_entities: [],
        interface_logical_entities: [],
        endpoint_data_effects: [],
      },
    },
    diagrams: [],
  };
}

function wireAxios(model: any, candidates: DiscoveryCandidateDto[]) {
  const axios = require('axios');
  const putModels: any[] = [];

  const mockClient = {
    get: jest.fn().mockImplementation((url: string) => {
      if (url === '/api/projects') {
        return Promise.resolve({ data: [{ id: 'proj-001', name: 'TestProject' }] });
      }
      if (url.includes('/candidate-entity-mappings')) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes('/candidates')) {
        return Promise.resolve({ data: candidates });
      }
      if (url.startsWith('/api/model/projects/') && url.endsWith('/architectures/arch-001')) {
        return Promise.resolve({ data: model });
      }
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    }),
    put: jest.fn().mockImplementation((url: string, body: any) => {
      if (url.startsWith('/api/model/projects/') && url.endsWith('/architectures/arch-001')) {
        putModels.push(JSON.parse(JSON.stringify(body)));
      }
      return Promise.resolve({ data: {} });
    }),
    post: jest.fn().mockResolvedValue({ data: [] }),
    patch: jest.fn().mockResolvedValue({ data: {} }),
  };
  axios.create = jest.fn().mockReturnValue(mockClient);
  return { mockClient, putModels };
}

function lastModel(putModels: any[]): any {
  return putModels[putModels.length - 1];
}

const CONSTRAINTS = {
  primary_key: { name: 'trade_pk', columns: ['trade_id'] },
  unique_constraints: [{ name: 'trade_ref_uq', columns: ['trade_ref'] }],
  check_constraints: [{ name: 'trade_qty_ck', expression: 'qty > 0' }],
  indexes: [{ name: 'trade_cust_ix', columns: ['customer_id'], is_unique: false }],
};

const FK_COLUMNS = {
  join_columns: ['customer_id'],
  referenced_columns: ['id'],
  on_delete: 'CASCADE',
  on_update: null,
};

const ATTR_FIDELITY = {
  source_type: 'numeric(19,0)',
  scale: 0,
  precision: 19,
  column_default: '0',
  ordinal: 3,
  is_identity: false,
};

describe('candidateSaveBackService - structural carriage + backfill (2026-08-01)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('carries constraints_metadata / database / attribute fidelity / fk_columns end-to-end on a FRESH save', async () => {
    const model = makeModel();
    const candidates = [
      makeCandidate({
        id: 'cand-trade',
        name: 'TRADE',
        candidate_type: 'physical_data_entities',
        data: {
          objectType: 'table',
          databaseName: 'hier_dev1',
          constraints_metadata: CONSTRAINTS,
        },
      }),
      makeCandidate({
        id: 'cand-trade-amount',
        name: 'amount',
        candidate_type: 'physical_data_attributes',
        parent_candidate_id: 'cand-trade',
        data: { dataType: 'numeric', isNullable: false, ...ATTR_FIDELITY },
      }),
      makeCandidate({
        id: 'cand-customer',
        name: 'CUSTOMER',
        candidate_type: 'physical_data_entities',
        data: { objectType: 'table', databaseName: 'hier_dev1' },
      }),
      makeCandidate({
        id: 'cand-rel',
        name: 'TRADE -> CUSTOMER',
        candidate_type: 'logical_data_entity_relationships',
        data: {
          sourceEntity: 'TRADE',
          targetEntity: 'CUSTOMER',
          cardinality: 'MANY_TO_ONE',
          relationshipType: 'ASSOCIATION',
          fk_columns: FK_COLUMNS,
        },
      }),
    ];
    const { putModels } = wireAxios(model, candidates);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    const saved = lastModel(putModels);
    const trade = saved.metaModel.entities.physical_data_entities.find(
      (e: any) => e.name === 'TRADE',
    );
    expect(trade).toBeDefined();
    expect(trade.constraints_metadata).toEqual(CONSTRAINTS);
    expect(trade.database).toBe('hier_dev1');
    expect(trade.database_name).toBeUndefined();

    const amount = saved.metaModel.entities.physical_data_attributes.find(
      (a: any) => a.name === 'amount',
    );
    expect(amount).toBeDefined();
    expect(amount.physical_entity_id).toBe(trade.id);
    expect(amount.source_type).toBe('numeric(19,0)');
    expect(amount.scale).toBe(0); // falsy scale survives
    expect(amount.precision).toBe(19);
    expect(amount.column_default).toBe('0');
    expect(amount.ordinal).toBe(3);
    expect(amount.is_identity).toBe(false); // falsy identity survives

    const rels = saved.metaModel.relationships.logical_data_entity_relationships;
    expect(rels).toHaveLength(1);
    expect(rels[0].fk_columns).toEqual(FK_COLUMNS);
    expect(rels[0].fromDataEntityPointId).toBe(`dep_phy_${trade.id}`);
  });

  it('BACKFILLS a pre-fix model on re-scan: suppression, reuse and existing-relationship paths all repair additively', async () => {
    // A model committed BEFORE the carriage fix: no constraints, empty
    // database, bare attribute, relationship without fk_columns.
    const model = makeModel({
      physical: [
        {
          id: 'pde-existing',
          name: 'TRADE',
          physical_type: 'Table',
          database: '',
          constraints_metadata: null,
          tags: '',
        },
        { id: 'pde-other', name: 'CUSTOMER', physical_type: 'Table', database: '', tags: '' },
      ],
      physicalAttrs: [
        {
          id: 'pda-existing',
          name: 'amount',
          physical_entity_id: 'pde-existing',
          data_type: 'numeric',
          is_primary_key: false,
          is_nullable: false,
        },
      ],
      rels: [
        {
          id: 'ler-existing',
          fromDataEntityPointId: 'dep_phy_pde-existing',
          toDataEntityPointId: 'dep_phy_pde-other',
          cardinality: 'MANY_TO_ONE',
          relationship: 'ASSOCIATION',
          description: '',
          tags: '',
          valid_from: null,
          valid_to: null,
        },
      ],
    });

    // The re-scan re-discovers the same names, now carrying the structure.
    const candidates = [
      makeCandidate({
        id: 'cand-trade-rescan',
        name: 'TRADE',
        candidate_type: 'physical_data_entities',
        data: {
          objectType: 'table',
          databaseName: 'hier_dev1',
          constraints_metadata: CONSTRAINTS,
        },
      }),
      makeCandidate({
        id: 'cand-amount-rescan',
        name: 'amount',
        candidate_type: 'physical_data_attributes',
        parent_candidate_id: 'cand-trade-rescan',
        data: { dataType: 'numeric', isNullable: false, ...ATTR_FIDELITY },
      }),
      makeCandidate({
        id: 'cand-rel-rescan',
        name: 'TRADE -> CUSTOMER',
        candidate_type: 'logical_data_entity_relationships',
        data: {
          sourceEntity: 'TRADE',
          targetEntity: 'CUSTOMER',
          cardinality: 'MANY_TO_ONE',
          relationshipType: 'ASSOCIATION',
          fk_columns: FK_COLUMNS,
        },
      }),
    ];
    const { putModels } = wireAxios(model, candidates);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    // Nothing minted: entity suppressed as an exact duplicate, attribute and
    // relationship reused idempotently.
    expect(result.entitiesCreated).toBe(0);

    const saved = lastModel(putModels);
    const trade = saved.metaModel.entities.physical_data_entities.find(
      (e: any) => e.id === 'pde-existing',
    );
    expect(trade.constraints_metadata).toEqual(CONSTRAINTS);
    expect(trade.database).toBe('hier_dev1');

    const amount = saved.metaModel.entities.physical_data_attributes.find(
      (a: any) => a.id === 'pda-existing',
    );
    expect(amount.source_type).toBe('numeric(19,0)');
    expect(amount.scale).toBe(0);
    expect(amount.precision).toBe(19);
    expect(amount.column_default).toBe('0');
    expect(amount.ordinal).toBe(3);
    expect(amount.is_identity).toBe(false);

    const rels = saved.metaModel.relationships.logical_data_entity_relationships;
    expect(rels).toHaveLength(1); // no duplicate minted
    expect(rels[0].id).toBe('ler-existing');
    expect(rels[0].fk_columns).toEqual(FK_COLUMNS);
  });

  it('NEVER overwrites structure already present on existing rows', async () => {
    const presentConstraints = { primary_key: { name: 'orig_pk', columns: ['id'] } };
    const presentFk = { join_columns: ['orig_col'], referenced_columns: ['id'] };
    const model = makeModel({
      physical: [
        {
          id: 'pde-existing',
          name: 'TRADE',
          physical_type: 'Table',
          database: 'orig_db',
          constraints_metadata: presentConstraints,
          tags: '',
        },
        { id: 'pde-other', name: 'CUSTOMER', physical_type: 'Table', database: '', tags: '' },
      ],
      physicalAttrs: [
        {
          id: 'pda-existing',
          name: 'amount',
          physical_entity_id: 'pde-existing',
          data_type: 'numeric',
          is_primary_key: false,
          is_nullable: false,
          scale: 5,
        },
      ],
      rels: [
        {
          id: 'ler-existing',
          fromDataEntityPointId: 'dep_phy_pde-existing',
          toDataEntityPointId: 'dep_phy_pde-other',
          cardinality: 'MANY_TO_ONE',
          relationship: 'ASSOCIATION',
          description: '',
          tags: '',
          valid_from: null,
          valid_to: null,
          fk_columns: presentFk,
        },
      ],
    });

    const candidates = [
      makeCandidate({
        id: 'cand-trade-rescan',
        name: 'TRADE',
        candidate_type: 'physical_data_entities',
        data: {
          objectType: 'table',
          databaseName: 'different_db',
          constraints_metadata: CONSTRAINTS,
        },
      }),
      makeCandidate({
        id: 'cand-amount-rescan',
        name: 'amount',
        candidate_type: 'physical_data_attributes',
        parent_candidate_id: 'cand-trade-rescan',
        data: { dataType: 'numeric', ...ATTR_FIDELITY },
      }),
      makeCandidate({
        id: 'cand-rel-rescan',
        name: 'TRADE -> CUSTOMER',
        candidate_type: 'logical_data_entity_relationships',
        data: {
          sourceEntity: 'TRADE',
          targetEntity: 'CUSTOMER',
          cardinality: 'MANY_TO_ONE',
          relationshipType: 'ASSOCIATION',
          fk_columns: FK_COLUMNS,
        },
      }),
    ];
    const { putModels } = wireAxios(model, candidates);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    const saved = lastModel(putModels);
    const trade = saved.metaModel.entities.physical_data_entities.find(
      (e: any) => e.id === 'pde-existing',
    );
    expect(trade.constraints_metadata).toEqual(presentConstraints); // untouched
    expect(trade.database).toBe('orig_db'); // untouched

    const amount = saved.metaModel.entities.physical_data_attributes.find(
      (a: any) => a.id === 'pda-existing',
    );
    expect(amount.scale).toBe(5); // present value wins over the re-scan's 0
    // Missing slots ARE still filled additively alongside the present one.
    expect(amount.precision).toBe(19);

    const rels = saved.metaModel.relationships.logical_data_entity_relationships;
    expect(rels[0].fk_columns).toEqual(presentFk); // untouched
  });
});
