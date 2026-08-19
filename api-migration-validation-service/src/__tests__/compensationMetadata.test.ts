/**
 * Compensation metadata resolution tests (Capture-State Discipline Spec 1):
 * PK from constraints_metadata.primary_key with is_primary_key fallback,
 * identity flags, ordinal-ordered columns, and fail-closed empty-PK entries.
 */

import {
  buildCompensationMetadataIndex,
  metadataForTable,
} from '../services/compensation/compensationMetadata';

const MODEL = {
  metaModel: {
    entities: {
      physical_data_entities: [
        {
          id: 'e-orders',
          name: 'orders',
          constraints_metadata: { primary_key: { name: 'orders_pkey', columns: ['id'] } },
        },
        {
          id: 'e-lines',
          name: 'order_lines',
          constraints_metadata: null, // PK resolved from attribute flags
        },
        {
          id: 'e-audit',
          name: 'audit_log',
          constraints_metadata: {}, // NO pk anywhere -> fail-closed empty pkColumns
        },
      ],
      physical_data_attributes: [
        { physical_entity_id: 'e-orders', name: 'id', is_identity: true, is_primary_key: true, source_type: 'int', ordinal: 1 },
        { physical_entity_id: 'e-orders', name: 'name', is_identity: false, source_type: 'varchar', ordinal: 2 },
        { physical_entity_id: 'e-lines', name: 'order_id', is_primary_key: true, source_type: 'int', ordinal: 1 },
        { physical_entity_id: 'e-lines', name: 'line_no', is_primary_key: true, source_type: 'int', ordinal: 2 },
        { physical_entity_id: 'e-lines', name: 'sku', is_primary_key: false, source_type: 'varchar', ordinal: 3 },
        { physical_entity_id: 'e-audit', name: 'message', source_type: 'text', ordinal: 1 },
      ],
    },
  },
};

describe('buildCompensationMetadataIndex', () => {
  const index = buildCompensationMetadataIndex(MODEL);

  it('takes the PK from constraints_metadata.primary_key when declared', () => {
    const meta = metadataForTable(index, 'orders');
    expect(meta?.pkColumns).toEqual(['id']);
    expect(meta?.columns.map((c) => c.name)).toEqual(['id', 'name']);
    expect(meta?.columns[0].isIdentity).toBe(true);
  });

  it('falls back to is_primary_key attribute flags (composite, ordinal order)', () => {
    const meta = metadataForTable(index, 'order_lines');
    expect(meta?.pkColumns).toEqual(['order_id', 'line_no']);
  });

  it('yields an EMPTY pkColumns for unkeyed tables (fail-closed downstream)', () => {
    const meta = metadataForTable(index, 'audit_log');
    expect(meta).not.toBeNull();
    expect(meta?.pkColumns).toEqual([]);
  });

  it('resolves case-insensitively and tolerates schema-qualified callers', () => {
    expect(metadataForTable(index, 'ORDERS')?.table).toBe('orders');
    expect(metadataForTable(index, 'dbo.orders')?.table).toBe('orders');
    expect(metadataForTable(index, 'not_modelled')).toBeNull();
  });
});

describe('buildIndexFromTableSpecs (auto-S0, scan-supplied metadata)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildIndexFromTableSpecs } = require('../services/compensation/compensationMetadata');

  it('builds the index from scan table specs without a committed model', () => {
    const index = buildIndexFromTableSpecs([
      {
        table: 'orders',
        pk_columns: ['id'],
        columns: [
          { name: 'id', source_type: 'int', is_identity: true },
          { name: 'name', source_type: 'varchar', is_identity: false },
        ],
      },
      { table: 'audit_log', pk_columns: [], columns: [{ name: 'message', source_type: 'text' }] },
    ]);
    expect(metadataForTable(index, 'orders')?.pkColumns).toEqual(['id']);
    expect(metadataForTable(index, 'orders')?.columns[0].isIdentity).toBe(true);
    // No PK -> fail-closed empty pkColumns (count-only downstream), never invented.
    expect(metadataForTable(index, 'audit_log')?.pkColumns).toEqual([]);
  });
});
