/**
 * Sybase system-catalog exclusion (2026-08-07).
 *
 * The live failure: `dbo.sysquerymetrics` — an ASE system VIEW over
 * `sysqueryplans` — was harvested into the model, routed through the
 * translation queue, approved, and emitted as the pack's FINAL post-load
 * changeset. It can never build: ASE system catalogs are engine
 * infrastructure, not app schema. Four layers now own the difference:
 * the predicate module (curated exact-name list, no `sys*` prefix
 * heuristic), the IR builder (tables + translation queue), the translation
 * emission (stale persisted queue rows), and the pack-validation gate
 * (executable-SQL reference scan).
 */

// Mock the logger to silence the emission-exclusion warn.
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { buildSourceSchemaIr, GenerationInputs } from '../services/dbMigrationPack/inputs';
import { validatePackFiles } from '../services/dbMigrationPack/packValidation';
import {
  findSybaseSystemReferences,
  isSybaseSystemObject,
  isSybaseSystemObjectRef,
} from '../services/dbMigrationPack/sybaseSystemObjects';
import { selectApprovedTranslations } from '../services/dbMigrationPack/translationEmission';
import { TranslationRow } from '../services/dbMigrationPack/translations';

// ---------------------------------------------------------------------------
// Predicate module
// ---------------------------------------------------------------------------

describe('isSybaseSystemObject / isSybaseSystemObjectRef', () => {
  it('matches ASE catalogs case-insensitively (the live pair included)', () => {
    expect(isSybaseSystemObject('sysquerymetrics')).toBe(true);
    expect(isSybaseSystemObject('sysqueryplans')).toBe(true);
    expect(isSybaseSystemObject('SYSOBJECTS')).toBe(true);
    expect(isSybaseSystemObjectRef('dbo.sysquerymetrics')).toBe(true);
  });

  it('is a curated LIST, not a sys* prefix heuristic — app tables named sys_* survive', () => {
    expect(isSybaseSystemObject('sys_config')).toBe(false);
    expect(isSybaseSystemObject('system_audit')).toBe(false);
    expect(isSybaseSystemObject('sysfoo')).toBe(false);
    expect(isSybaseSystemObjectRef('dbo.sys_config')).toBe(false);
  });
});

describe('findSybaseSystemReferences', () => {
  it('finds catalogs referenced by executable SQL (the live translated-view shape)', () => {
    const sql =
      'CREATE VIEW "dbo"."sysquerymetrics" AS\n' +
      'SELECT * FROM dbo.sysqueryplans WHERE type = 1;\n';
    expect(findSybaseSystemReferences(sql)).toEqual(['sysquerymetrics', 'sysqueryplans']);
  });

  it('a suffixed identifier (sysquerymetrics_vw) is a DIFFERENT name — not matched', () => {
    const sql = 'CREATE VIEW "dbo"."sysquerymetrics_vw" AS SELECT 1;\n';
    expect(findSybaseSystemReferences(sql)).toEqual([]);
  });

  it('ignores comment lines — exclusion NOTES may mention a system object', () => {
    const sql =
      '-- EXCLUDED: dbo.sysquerymetrics is a Sybase system view (never migrated).\n' +
      'SELECT 1;\n';
    expect(findSybaseSystemReferences(sql)).toEqual([]);
  });

  it('does not false-positive on substrings of longer identifiers', () => {
    expect(findSybaseSystemReferences('SELECT * FROM my_sysobjects_archive;')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// IR builder exclusion
// ---------------------------------------------------------------------------

function minimalInputs(): GenerationInputs {
  return {
    model: {
      physicalDataEntities: [
        {
          id: 'e-orders',
          name: 'dbo.orders',
          physical_type: 'table',
          constraints_metadata: {
            primary_key: { name: 'pk_orders', columns: ['order_id'] },
            unique_constraints: [],
            check_constraints: [],
            indexes: [],
          },
        },
        // The harvested ASE system view + a harvested system TABLE.
        { id: 'e-sysqm', name: 'dbo.sysquerymetrics', physical_type: 'view' },
        { id: 'e-sysobj', name: 'dbo.sysobjects', physical_type: 'table' },
      ],
      physicalDataAttributes: [
        { id: 'a-o-1', name: 'order_id', physical_entity_id: 'e-orders', source_type: 'int', is_nullable: false, is_identity: true, ordinal: 1 },
        { id: 'a-s-1', name: 'qid', physical_entity_id: 'e-sysqm', source_type: 'int', is_nullable: true, ordinal: 1 },
      ],
      dataEntityPoints: [],
      dataEntityRelationships: [],
    },
    findings: [
      {
        id: 'f-view-sys',
        finding_type: 'view_definition',
        detail_json: { engineKey: 'sybase', schemaName: 'dbo', viewName: 'sysquerymetrics' },
      },
      {
        id: 'f-view-app',
        finding_type: 'view_definition',
        detail_json: { engineKey: 'sybase', schemaName: 'dbo', viewName: 'order_summary_vw' },
      },
    ],
    dbDecisions: [
      { decisionCode: 'db.engine', answerValue: 'PostgreSQL' },
    ],
    resolvedPackDecisions: [],
  };
}

describe('buildSourceSchemaIr excludes ASE system objects', () => {
  const ir = buildSourceSchemaIr(minimalInputs());

  it('system tables/views never enter ir.tables (and their columns drop with them)', () => {
    const names = ir.tables.map((t) => t.tableName);
    expect(names).toEqual(['orders']);
  });

  it('system view findings never enter the translation queue; app views still do', () => {
    expect(ir.untranslated).toEqual([
      { kind: 'view', objectRef: 'dbo.order_summary_vw', findingIds: ['f-view-app'] },
    ]);
  });

  it('every exclusion is RECORDED (visible accounting, not a silent drop)', () => {
    expect(ir.sybaseSystemExclusions).toEqual([
      { kind: 'table', objectRef: 'dbo.sysobjects' },
      { kind: 'view', objectRef: 'dbo.sysquerymetrics' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Translation emission — stale persisted queue rows
// ---------------------------------------------------------------------------

describe('selectApprovedTranslations refuses system objects regardless of review state', () => {
  function approvedRow(objectRef: string): TranslationRow {
    return {
      translation_key: `view--${objectRef}`,
      kind: 'view',
      object_ref: objectRef,
      disposition: 'translate',
      review_status: 'approved',
      draft_content: 'CREATE VIEW ...;',
    } as TranslationRow;
  }

  it('drops an APPROVED persisted translation of a system view (the live shape)', () => {
    const rows = [approvedRow('dbo.sysquerymetrics'), approvedRow('dbo.order_summary_vw')];
    const selected = selectApprovedTranslations(rows);
    expect(selected.map((r) => r.object_ref)).toEqual(['dbo.order_summary_vw']);
  });
});

// ---------------------------------------------------------------------------
// Validation-gate backstop
// ---------------------------------------------------------------------------

describe('validatePackFiles refuses executable references to ASE catalogs', () => {
  const master = {
    filePath: 'liquibase/db.changelog-master.xml',
    content:
      '<?xml version="1.0" encoding="UTF-8"?>\n<databaseChangeLog\n' +
      '    xmlns="http://www.liquibase.org/xml/ns/dbchangelog">\n</databaseChangeLog>\n',
  };

  it('refuses the live translated-system-view shape, naming the catalogs', () => {
    const translations = {
      filePath: 'liquibase/changesets/050-translations.sql',
      content:
        '--liquibase formatted sql logicalFilePath:liquibase/changesets/050-translations.sql\n' +
        '--changeset db-migration-pack:translation-view-dbo.sysquerymetrics context:post-load splitStatements:false\n' +
        'CREATE VIEW "dbo"."sysquerymetrics" AS SELECT * FROM "dbo"."sysqueryplans";\n',
    };
    const problems = validatePackFiles([master, translations]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Sybase system catalog object(s) sysquerymetrics, sysqueryplans');
    expect(problems[0]).toContain('can never exist on the Postgres target');
  });

  it('accepts a pack whose only system-object mentions are comments', () => {
    const clean = {
      filePath: 'liquibase/changesets/050-translations.sql',
      content:
        '--liquibase formatted sql logicalFilePath:liquibase/changesets/050-translations.sql\n' +
        '--changeset db-migration-pack:translation-view-dbo.order_summary_vw context:post-load splitStatements:false\n' +
        '-- NOTE: dbo.sysquerymetrics was EXCLUDED (Sybase system view).\n' +
        'CREATE VIEW "dbo"."order_summary_vw" AS SELECT 1;\n',
    };
    expect(validatePackFiles([master, clean])).toEqual([]);
  });
});
