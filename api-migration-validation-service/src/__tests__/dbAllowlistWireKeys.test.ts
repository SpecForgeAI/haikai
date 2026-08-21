/**
 * Session DB-allowlist wire-key tolerance (2026-08-21).
 *
 * The capture wizard persisted its table allowlist under the flat `allowlist`
 * key (and the schema under `schema`) while the DB tools read ONLY
 * `allowlistTables`/`allowlistSchemas` — so the session allowlist was ALWAYS
 * empty at the reader and `list_db_metadata` fail-closed to
 * schemaCount=0/tableCount=0 on every session (the live diagnosis: dozens of
 * scenarios skipped or retry-exhausted hunting for ids they could never
 * sample). Same wire-key bug class as `dbType` vs `type`.
 *
 * Pins: `effectiveDbAllowlist` (canonical keys win, legacy keys count,
 * schema field counts as the schema allowlist) and the tool actually
 * passing a legacy-keyed session's allowlist to the adapter.
 */

import { effectiveDbAllowlist, RedactedDbConfig } from '../types/captureSession';
import { listDbMetadataTool } from '../services/tools/list_db_metadata';

describe('effectiveDbAllowlist', () => {
  it('canonical keys win when present', () => {
    const config: RedactedDbConfig = {
      dbType: 'sybase',
      schema: 'dbo',
      allowlist: ['legacy_t'],
      allowlistTables: ['canonical_t'],
      allowlistSchemas: ['canonical_s'],
    };
    expect(effectiveDbAllowlist(config)).toEqual({
      schemas: ['canonical_s'],
      tables: ['canonical_t'],
    });
  });

  it('legacy `allowlist` + `schema` keys count (the wizard wire shape)', () => {
    const config: RedactedDbConfig = {
      dbType: 'sybase',
      schema: 'dbo',
      allowlist: ['hier_filter', 'hier_view'],
    };
    expect(effectiveDbAllowlist(config)).toEqual({
      schemas: ['dbo'],
      tables: ['hier_filter', 'hier_view'],
    });
  });

  it('genuinely empty config yields null/null (tools stay fail-closed)', () => {
    expect(effectiveDbAllowlist({ dbType: 'postgres' })).toEqual({
      schemas: null,
      tables: null,
    });
    expect(effectiveDbAllowlist(null)).toEqual({ schemas: null, tables: null });
    // Blank schema string is NOT an allowlist.
    expect(effectiveDbAllowlist({ dbType: 'postgres', schema: '  ' }).schemas).toBeNull();
  });
});

describe('list_db_metadata with a legacy-keyed session', () => {
  it('passes the legacy-derived allowlist to the adapter (no longer fail-closed empty)', async () => {
    const listCalls: unknown[] = [];
    const ctx = {
      dbAdapter: {
        listMetadata: async (allowlist: unknown) => {
          listCalls.push(allowlist);
          return [
            {
              schema: 'dbo',
              table: 'hier_filter',
              columns: [{ name: 'FilterId', dataType: 'int', isNullable: false }],
            },
          ];
        },
      },
      session: {
        dbConfigRedactedJson: {
          dbType: 'sybase',
          schema: 'dbo',
          allowlist: ['hier_filter'],
        },
      },
    };
    const result = (await listDbMetadataTool.handler({}, ctx as never)) as {
      schemaCount: number;
      tableCount: number;
    };
    expect(listCalls).toEqual([{ schemas: ['dbo'], tables: ['hier_filter'] }]);
    expect(result.schemaCount).toBe(1);
    expect(result.tableCount).toBe(1);
  });
});
