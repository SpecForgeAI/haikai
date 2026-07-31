/**
 * Schema-apply runner (WS2 DB-plane execution chain, 2026-07-31).
 *
 * Plan building from the master changelog + formatted-SQL changesets, phase
 * context filtering, apply-order preservation, idempotent skip via the
 * haikai_schema_apply_log tracking table, and stop-at-first-failure with the
 * failing changeset identified.
 */
import {
  parseFormattedSql,
  parseMasterIncludes,
} from '../services/schemaApply/formattedSql';
import {
  buildApplyPlan,
  runSchemaApply,
  SchemaApplyFile,
} from '../services/schemaApply/schemaApplyRunner';

const MASTER = `<?xml version="1.0" encoding="UTF-8"?>
<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog">
  <!-- Structural phase: run with contexts=structural. -->
  <include file="changesets/000-schemas.sql" relativeToChangelogFile="true"/>
  <include file="changesets/010-tables/dbo.orders.sql" relativeToChangelogFile="true"/>
  <include file="changesets/020-foreign-keys.sql" relativeToChangelogFile="true"/>
</databaseChangeLog>
`;

const SCHEMAS_SQL = `--liquibase formatted sql logicalFilePath:liquibase/changesets/000-schemas.sql
--changeset db-migration-pack:schemas context:structural splitStatements:false
CREATE SCHEMA IF NOT EXISTS "dbo";
`;

const ORDERS_SQL = `--liquibase formatted sql logicalFilePath:liquibase/changesets/010-tables/dbo.orders.sql
--changeset db-migration-pack:table-dbo.orders context:structural splitStatements:false
CREATE TABLE "dbo"."Orders" (
    "OrderId" integer NOT NULL
);
`;

const FKS_SQL = `--liquibase formatted sql logicalFilePath:liquibase/changesets/020-foreign-keys.sql
--changeset db-migration-pack:foreign-keys context:post-load splitStatements:false
-- Phase 3 of 5: FKs apply once after the bulk load.
ALTER TABLE "dbo"."Orders" ADD CONSTRAINT fk_x FOREIGN KEY ("OrderId") REFERENCES "dbo"."O2" ("Id");
`;

function packFiles(): SchemaApplyFile[] {
  return [
    { path: 'liquibase/db.changelog-master.xml', content: MASTER },
    { path: 'liquibase/changesets/000-schemas.sql', content: SCHEMAS_SQL },
    { path: 'liquibase/changesets/010-tables/dbo.orders.sql', content: ORDERS_SQL },
    { path: 'liquibase/changesets/020-foreign-keys.sql', content: FKS_SQL },
  ];
}

describe('formattedSql parsing', () => {
  it('parses master includes in order, resolved against the master dir', () => {
    expect(parseMasterIncludes(MASTER, 'liquibase/db.changelog-master.xml')).toEqual([
      'liquibase/changesets/000-schemas.sql',
      'liquibase/changesets/010-tables/dbo.orders.sql',
      'liquibase/changesets/020-foreign-keys.sql',
    ]);
  });

  it('parses changeset headers (id, author, context) and bodies', () => {
    const [cs] = parseFormattedSql('changesets/000-schemas.sql', SCHEMAS_SQL);
    expect(cs.id).toBe('schemas');
    expect(cs.author).toBe('db-migration-pack');
    expect(cs.context).toBe('structural');
    expect(cs.body).toContain('CREATE SCHEMA IF NOT EXISTS "dbo";');
  });

  it('splits multiple changesets in one file', () => {
    const twoInOne =
      SCHEMAS_SQL + '--changeset db-migration-pack:extra context:post-load\nSELECT 1;\n';
    const parsed = parseFormattedSql('f.sql', twoInOne);
    expect(parsed.map((c) => c.id)).toEqual(['schemas', 'extra']);
    expect(parsed[1].context).toBe('post-load');
  });
});

describe('buildApplyPlan', () => {
  it('keeps master order and filters by context', () => {
    const structural = buildApplyPlan(packFiles(), ['structural']);
    expect(structural.issues).toEqual([]);
    expect(structural.plan.map((c) => c.id)).toEqual(['schemas', 'table-dbo.orders']);

    const postLoad = buildApplyPlan(packFiles(), ['post-load']);
    expect(postLoad.plan.map((c) => c.id)).toEqual(['foreign-keys']);
  });

  it('a context-less changeset matches any requested phase', () => {
    const files = packFiles();
    files[1] = {
      path: files[1].path,
      content: files[1].content.replace(' context:structural', ''),
    };
    const postLoad = buildApplyPlan(files, ['post-load']);
    expect(postLoad.plan.map((c) => c.id)).toEqual(['schemas', 'foreign-keys']);
  });

  it('reports an unresolved include as an issue', () => {
    const files = packFiles().filter((f) => !f.path.endsWith('020-foreign-keys.sql'));
    const { issues } = buildApplyPlan(files, ['structural']);
    expect(issues.some((i) => i.includes('020-foreign-keys.sql'))).toBe(true);
  });

  it('reports a missing master changelog', () => {
    const { plan, issues } = buildApplyPlan(
      [{ path: 'changesets/x.sql', content: SCHEMAS_SQL }],
      ['structural']
    );
    expect(plan).toEqual([]);
    expect(issues[0]).toContain('db.changelog-master.xml');
  });
});

describe('runSchemaApply', () => {
  class FakeExec {
    executed: string[] = [];
    alreadyApplied: string[] = [];
    failOnSqlContaining: string | null = null;

    async query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }> {
      if (this.failOnSqlContaining && sql.includes(this.failOnSqlContaining)) {
        this.executed.push(sql);
        throw new Error(`relation "dbo.O2" does not exist`);
      }
      this.executed.push(sql);
      if (sql.startsWith('SELECT changeset_id')) {
        return { rows: this.alreadyApplied.map((id) => ({ changeset_id: id })) };
      }
      return { rows: [] };
    }
  }

  it('applies in order and records each id in the log table', async () => {
    const exec = new FakeExec();
    const { plan } = buildApplyPlan(packFiles(), ['structural', 'post-load']);

    const result = await runSchemaApply(plan, exec);

    expect(result.failed).toBeNull();
    expect(result.applied).toEqual(['schemas', 'table-dbo.orders', 'foreign-keys']);
    const inserts = exec.executed.filter((s) => s.startsWith('INSERT INTO haikai_schema_apply_log'));
    expect(inserts).toHaveLength(3);
    // Bodies execute inside BEGIN/COMMIT pairs.
    expect(exec.executed.filter((s) => s === 'BEGIN')).toHaveLength(3);
    expect(exec.executed.filter((s) => s === 'COMMIT')).toHaveLength(3);
  });

  it('skips changesets already in the log (idempotent re-run)', async () => {
    const exec = new FakeExec();
    exec.alreadyApplied = ['schemas', 'table-dbo.orders'];
    const { plan } = buildApplyPlan(packFiles(), ['structural', 'post-load']);

    const result = await runSchemaApply(plan, exec);

    expect(result.skipped).toEqual(['schemas', 'table-dbo.orders']);
    expect(result.applied).toEqual(['foreign-keys']);
  });

  it('stops at the first failure and names the changeset', async () => {
    const exec = new FakeExec();
    exec.failOnSqlContaining = 'ADD CONSTRAINT fk_x';
    const { plan } = buildApplyPlan(packFiles(), ['structural', 'post-load']);

    const result = await runSchemaApply(plan, exec);

    expect(result.applied).toEqual(['schemas', 'table-dbo.orders']);
    expect(result.failed?.id).toBe('foreign-keys');
    expect(result.failed?.error).toContain('does not exist');
    expect(exec.executed).toContain('ROLLBACK');
  });
});
