/**
 * Unique-key fallback (2026-08-29, Kiro replication). Estates routinely
 * enforce a table's key as a UNIQUE constraint / unique index rather than a
 * declared PRIMARY KEY; those tables became keyless → count-only in S0 →
 * unhealable → a halt on every mis-mined write. A DECLARED unique key is a
 * key, not inference. Preference: single identity (8) > clustered unique
 * index (4) > plain unique constraint/index (2); ties → fewest columns,
 * then lexical — deterministic every run.
 */

import { buildCompensationMetadataIndex } from '../services/compensation/compensationMetadata';

function model(entities: unknown[], attributes: unknown[] = []) {
  return {
    metaModel: {
      entities: {
        physical_data_entities: entities,
        physical_data_attributes: attributes,
      },
    },
  };
}

describe('deriveUniqueKeyColumns via buildCompensationMetadataIndex', () => {
  it('a clustered composite unique index becomes the key', () => {
    const index = buildCompensationMetadataIndex(
      model([
        {
          id: 'e1',
          name: 'screen_filter',
          constraints_metadata: {
            indexes: [
              { name: 'ux_sf', columns: ['FilterId', 'OwnerId'], is_unique: true, is_clustered: true },
            ],
          },
        },
      ]),
    );
    expect(index.byTable.get('screen_filter')?.pkColumns).toEqual(['FilterId', 'OwnerId']);
  });

  it('a single-identity unique index wins the preference score', () => {
    const index = buildCompensationMetadataIndex(
      model(
        [
          {
            id: 'e1',
            name: 'filter_tag',
            constraints_metadata: {
              indexes: [
                { name: 'ux_comp', columns: ['FilterId', 'TagName'], is_unique: true, is_clustered: true },
                { name: 'ux_id', columns: ['Id'], is_unique: true },
              ],
            },
          },
        ],
        [{ physical_entity_id: 'e1', name: 'Id', is_identity: true, source_type: 'int', ordinal: 1 }],
      ),
    );
    // Identity(8) beats clustered(4) even though the clustered one is listed first.
    expect(index.byTable.get('filter_tag')?.pkColumns).toEqual(['Id']);
  });

  it('a composite non-clustered UNIQUE CONSTRAINT becomes the key', () => {
    const index = buildCompensationMetadataIndex(
      model([
        {
          id: 'e1',
          name: 'view_registry',
          constraints_metadata: {
            unique_constraints: [{ name: 'uq_vr', columns: ['ViewId', 'Rev'] }],
          },
        },
      ]),
    );
    expect(index.byTable.get('view_registry')?.pkColumns).toEqual(['ViewId', 'Rev']);
  });

  it('ties break on fewest columns then lexical — deterministic', () => {
    const index = buildCompensationMetadataIndex(
      model([
        {
          id: 'e1',
          name: 'view_tag',
          constraints_metadata: {
            unique_constraints: [
              { name: 'uq_b', columns: ['B1', 'B2'] },
              { name: 'uq_a', columns: ['A1'] },
              { name: 'uq_z', columns: ['Z1'] },
            ],
          },
        },
      ]),
    );
    // Same score (2): fewest columns first, then lexical between A1 and Z1.
    expect(index.byTable.get('view_tag')?.pkColumns).toEqual(['A1']);
  });

  it('a NON-unique index is never a key (still keyless, fail-closed)', () => {
    const index = buildCompensationMetadataIndex(
      model([
        {
          id: 'e1',
          name: 'event_sink',
          constraints_metadata: {
            indexes: [{ name: 'ix_plain', columns: ['CreatedAt'], is_unique: false }],
          },
        },
      ]),
    );
    expect(index.byTable.get('event_sink')?.pkColumns).toEqual([]);
  });

  it('a declared PRIMARY KEY still wins over every unique index', () => {
    const index = buildCompensationMetadataIndex(
      model([
        {
          id: 'e1',
          name: 'org_registry',
          constraints_metadata: {
            primary_key: { name: 'pk', columns: ['OrgId'] },
            indexes: [{ name: 'ux_alt', columns: ['AltKey'], is_unique: true, is_clustered: true }],
          },
        },
      ]),
    );
    expect(index.byTable.get('org_registry')?.pkColumns).toEqual(['OrgId']);
  });
});
