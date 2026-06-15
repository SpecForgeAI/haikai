/**
 * Tests for DB Structural Fidelity frontend ripple (Group A).
 *
 * Spec: DB Structural Fidelity for Discovery (Sybase + Postgres) - 2026-05-29
 * Task Group 3 (3.1): model.ts typings + meta-model grid UI + XLSX column maps.
 *
 * The new Group A fields are snake_case and match the AMS DTOs exactly
 * (PhysicalDataAttributeDto / PhysicalDataEntityDto /
 * LogicalDataEntityRelationshipDto):
 *   - physical_data_attributes:  source_type, scale, precision, column_default,
 *                                ordinal, is_identity
 *   - physical_data_entities:    constraints_metadata (JSONB)
 *   - logical_data_entity_relationships: fk_columns (JSONB)
 *
 * These tests cover:
 *   (a) the new physical-attribute fields render as columns in the meta-model grid;
 *   (b) the constraint/index JSONB and the FK JSONB surface as a read-only summary;
 *   (c) XLSX ingestion maps the new attribute columns and tolerates their absence,
 *       and the nested JSONB columns are explicitly scoped out of XLSX;
 *   (d) model.ts typings carry the new optional snake_case fields.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { gridConfigs } from '../config/gridConfigs';
import type {
  PhysicalDataAttribute,
  PhysicalDataEntity,
  LogicalDataEntityRelationship,
} from '../types/model';

// ---------------------------------------------------------------------------
// GridCell context mocks (GridCell consumes ArchitectureContext + AppConfig).
// ---------------------------------------------------------------------------
vi.mock('../contexts/ArchitectureContext', () => ({
  useArchitectureDispatch: vi.fn(() => vi.fn()),
}));

vi.mock('../contexts/AppConfigContext', () => ({
  useAppConfig: vi.fn(() => ({
    uiCharacteristicsUiCapabilityKeys: [],
    uiCharacteristicsInteractionComplexityKeys: [],
    uiCharacteristicsTechnicalShapeKeys: [],
  })),
}));

vi.mock('../utils/validation', () => ({
  getCellValidationError: vi.fn(() => null),
}));

import { GridCell, summarizeStructuralJson } from '../components/Grid/GridCell';
import type { GridColumnConfig } from '../types/config';
import type { AnyEntity, ArchitectureModel, EntityType } from '../types/model';

// ===========================================================================
// (a) physical_data_attributes grid columns
// ===========================================================================
describe('physical_data_attributes grid surfaces structural-fidelity fields', () => {
  const config = gridConfigs.physical_data_attributes;
  const fieldsByName = new Map(config.map((c) => [c.field, c]));

  it.each([
    ['source_type', 'text'],
    ['scale', 'text'],
    ['precision', 'text'],
    ['column_default', 'text'],
    ['ordinal', 'text'],
    ['is_identity', 'boolean'],
  ])('exposes %s column with %s cellType (read-only display)', (field, cellType) => {
    const col = fieldsByName.get(field);
    expect(col).toBeDefined();
    expect(col!.cellType).toBe(cellType);
    // Additive/optional - never required (existing models won't carry it).
    expect(col!.required).toBe(false);
  });

  it('names the default column "column_default" (NOT the reserved word "default")', () => {
    expect(fieldsByName.has('column_default')).toBe(true);
    expect(fieldsByName.has('default')).toBe(false);
  });
});

// ===========================================================================
// (b) constraint/index JSONB + FK JSONB surface as a read-only summary
// ===========================================================================
describe('physical_data_entities + relationship JSONB surface as read-only summary', () => {
  it('configures constraints_metadata as a json_summary column on physical_data_entities', () => {
    const col = gridConfigs.physical_data_entities.find(
      (c) => c.field === 'constraints_metadata'
    );
    expect(col).toBeDefined();
    expect(col!.cellType).toBe('json_summary');
  });

  it('configures fk_columns as a json_summary column on logical_data_entity_relationships', () => {
    const col = gridConfigs.logical_data_entity_relationships.find(
      (c) => c.field === 'fk_columns'
    );
    expect(col).toBeDefined();
    expect(col!.cellType).toBe('json_summary');
  });

  it('summarizes constraints_metadata into a compact PK / unique / check / index string', () => {
    const summary = summarizeStructuralJson(
      {
        primary_key: { name: 'pk_orders', columns: ['id'] },
        unique_constraints: [{ name: 'uq_orders_ref', columns: ['ref'] }],
        check_constraints: [{ name: 'ck_qty', expression: 'qty > 0' }],
        indexes: [
          { name: 'ix_orders_cust', columns: ['cust_id'], is_unique: false },
          { name: 'ix_orders_ref', columns: ['ref'], is_unique: true },
        ],
      },
      'constraints_metadata'
    );
    expect(summary).toBe('PK(id) | 1 unique | 1 check | 2 indexes');
  });

  it('summarizes fk_columns into a "join -> referenced" string', () => {
    const summary = summarizeStructuralJson(
      { join_columns: ['customer_id'], referenced_columns: ['id'] },
      'fk_columns'
    );
    expect(summary).toBe('customer_id -> id');
  });

  it('renders a constraints_metadata json_summary cell with summary text + full JSON on hover', () => {
    const constraints: PhysicalDataEntity['constraints_metadata'] = {
      primary_key: { name: 'pk_orders', columns: ['id'] },
      indexes: [{ name: 'ix_ref', columns: ['ref'], is_unique: true }],
    };
    const entity = {
      id: 'pe-1',
      name: 'orders',
      description: '',
      physical_type: 'Table',
      database: 'sales',
      tags: '',
      constraints_metadata: constraints,
    } as unknown as AnyEntity;

    const column = gridConfigs.physical_data_entities.find(
      (c) => c.field === 'constraints_metadata'
    ) as GridColumnConfig;

    render(
      <table>
        <tbody>
          <tr>
            <td>
              <GridCell
                entity={entity}
                column={column}
                entityType={'physical_data_entities' as EntityType}
                model={{} as ArchitectureModel}
                errors={[]}
                onChange={vi.fn()}
              />
            </td>
          </tr>
        </tbody>
      </table>
    );

    const cell = screen.getByTestId('json-summary-cell');
    expect(cell).toHaveTextContent('PK(id) | 1 index');
    // Full verbatim JSON is available on hover (read-only, lossless).
    expect(cell).toHaveAttribute('title', JSON.stringify(constraints, null, 2));
  });
});

// ===========================================================================
// (c) XLSX ingestion: scalar attribute columns map (+ tolerate absence);
//     JSONB columns explicitly scoped out.
// ===========================================================================
describe('XLSX column maps for physical attributes/entities', () => {
  // XLSX import/export is driven entirely by gridConfigs (displayName <-> field).
  // Adding the scalar fields to the config wires them into both directions; the
  // json_summary cellType is the marker the XLSX path uses to scope a column out.
  it('includes the new scalar attribute fields in the physical_data_attributes XLSX columns', () => {
    const displayNames = gridConfigs.physical_data_attributes.map((c) => c.displayName);
    expect(displayNames).toEqual(
      expect.arrayContaining([
        'Source Type',
        'Scale',
        'Precision',
        'Default',
        'Ordinal',
        'Identity',
      ])
    );
  });

  it('tolerates absence of the new attribute columns (all optional/non-required)', () => {
    // Back-compat: an older spreadsheet without these columns must still import.
    // No field among the new ones is required, so a row missing them is valid.
    const newFields = ['source_type', 'scale', 'precision', 'column_default', 'ordinal', 'is_identity'];
    const required = gridConfigs.physical_data_attributes
      .filter((c) => c.required)
      .map((c) => c.field);
    for (const f of newFields) {
      expect(required).not.toContain(f);
    }
  });

  it('scopes the nested JSONB columns OUT of XLSX (json_summary cellType marker)', () => {
    // constraints_metadata / fk_columns are nested objects that do not fit the
    // flat XLSX cell model; they are populated only by the discovery DB scan.
    // The XLSX export/import path keys off cellType === 'json_summary'.
    const entityJsonCol = gridConfigs.physical_data_entities.find(
      (c) => c.field === 'constraints_metadata'
    );
    const relJsonCol = gridConfigs.logical_data_entity_relationships.find(
      (c) => c.field === 'fk_columns'
    );
    expect(entityJsonCol!.cellType).toBe('json_summary');
    expect(relJsonCol!.cellType).toBe('json_summary');
  });
});

// ===========================================================================
// (d) model.ts typings carry the new optional snake_case fields
// ===========================================================================
describe('model.ts typings carry the new snake_case structural-fidelity fields', () => {
  it('PhysicalDataAttribute accepts the structural-fidelity fields (snake_case, optional)', () => {
    const attr: PhysicalDataAttribute = {
      id: 'pa-1',
      name: 'amount',
      description: '',
      physical_entity_id: 'pe-1',
      data_type: 'NUMERIC',
      is_primary_key: false,
      is_nullable: true,
      tags: '',
      source_type: 'numeric(10,2)',
      scale: 2,
      precision: 10,
      column_default: '0',
      ordinal: 3,
      is_identity: false,
    };
    expect(attr.source_type).toBe('numeric(10,2)');
    expect(attr.scale).toBe(2);
    expect(attr.precision).toBe(10);
    expect(attr.column_default).toBe('0');
    expect(attr.ordinal).toBe(3);
    expect(attr.is_identity).toBe(false);
  });

  it('PhysicalDataAttribute is valid WITHOUT the new fields (back-compat)', () => {
    const legacy: PhysicalDataAttribute = {
      id: 'pa-2',
      name: 'name',
      description: '',
      physical_entity_id: 'pe-1',
      data_type: 'VARCHAR',
      is_primary_key: false,
      is_nullable: true,
      tags: '',
    };
    expect(legacy.source_type).toBeUndefined();
  });

  it('PhysicalDataEntity accepts constraints_metadata and LogicalDataEntityRelationship accepts fk_columns', () => {
    const entity: PhysicalDataEntity = {
      id: 'pe-1',
      name: 'orders',
      description: '',
      physical_type: 'Table',
      database: 'sales',
      tags: '',
      constraints_metadata: {
        primary_key: { name: 'pk_orders', columns: ['id'] },
        unique_constraints: [{ name: 'uq_ref', columns: ['ref'] }],
        check_constraints: [{ name: 'ck_qty', expression: 'qty > 0' }],
        indexes: [{ name: 'ix_cust', columns: ['cust_id'], is_unique: false }],
      },
    };
    const rel: LogicalDataEntityRelationship = {
      id: 'rel-1',
      description: '',
      tags: '',
      fromDataEntityPointId: 'dep_phy_pe-1',
      toDataEntityPointId: 'dep_phy_pe-2',
      fk_columns: { join_columns: ['customer_id'], referenced_columns: ['id'] },
    };
    expect(entity.constraints_metadata?.primary_key?.columns).toEqual(['id']);
    expect(rel.fk_columns?.join_columns).toEqual(['customer_id']);
  });
});
