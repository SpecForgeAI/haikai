/**
 * Tests for the deterministic DB migration pack generation core (Group 2).
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack — Task 2.1.
 *
 * Covers EXACTLY the six spec'd concerns:
 *   (a) type-mapping table v1 — representative deterministic mappings + the
 *       Sybase `timestamp` needs_decision (never a guess);
 *   (b) findings merge — collation hazard -> `collation` needs_decision,
 *       `getdate()` -> `now()` rewrite, sequence high-water seeds the
 *       sequences-seed changeset with the margin, value-unavailable
 *       high-water -> needs_decision;
 *   (c) coverage assertion — every table/column in exactly one bucket with
 *       provenance; an artificially unaccounted object FAILS the run;
 *   (d) checksum stability — two generations over identical inputs are
 *       byte-identical with the same input_snapshot_hash;
 *   (e) a non-Sybase->Postgres combination is rejected;
 *   (f) procs/triggers/views/scheduled jobs land in the manifest as
 *       requires_translation_spec_2 / manual-recreation, never as changesets.
 *
 * Group 7 (Test Review & Gap Analysis) adds three strategic end-to-end tests
 * at the bottom: the generate -> resolve -> regenerate cycle, the coverage
 * guarantee over a realistic mixed model, and the coverage-violation path
 * proving NOTHING is persisted on failure.
 *
 * All AMS/model fetches are injected through the handler's dependency seam —
 * no network anywhere.
 */

import {
  assertCoverage,
  buildDbMigrationPackArtifacts,
  buildSourceSchemaIr,
  computeInputSnapshotHash,
  CoverageAssertionError,
  generateDbMigrationPack,
  GenerationInputs,
  UnsupportedEnginePairError,
  UpsertPackBody,
} from '../services/dbMigrationPackHandler';
import {
  RawDiscoveryFinding,
  RawResolvedPackDecision,
} from '../services/dbMigrationPack/inputs';

// ---------------------------------------------------------------------------
// Fixture: a small committed physical model + the findings that carry the
// facts the committed model cannot (collation / defaults / high-water marks).
// ---------------------------------------------------------------------------

function makeInputs(overrides?: {
  dbEngineAnswer?: string;
  extraFindings?: RawDiscoveryFinding[];
}): GenerationInputs {
  return {
    model: {
      physicalDataEntities: [
        {
          id: 'e-customers',
          name: 'dbo.customers',
          physical_type: 'table',
          constraints_metadata: {
            primary_key: { name: 'pk_customers', columns: ['customer_id'] },
            unique_constraints: [{ name: 'uq_customers_email', columns: ['email'] }],
            check_constraints: [],
            indexes: [
              {
                name: 'ix_customers_last_name',
                columns: ['last_name'],
                is_unique: false,
                is_clustered: true,
                column_directions: ['ASC'],
              },
            ],
          },
        },
        {
          id: 'e-orders',
          name: 'dbo.orders',
          physical_type: 'table',
          constraints_metadata: {
            primary_key: { name: 'pk_orders', columns: ['order_id'] },
            unique_constraints: [],
            check_constraints: [{ name: 'ck_orders_amount', expression: 'amount >= 0' }],
            indexes: [],
          },
        },
      ],
      physicalDataAttributes: [
        // dbo.customers
        { id: 'a-c-1', name: 'customer_id', physical_entity_id: 'e-customers', source_type: 'int', is_nullable: false, is_identity: true, ordinal: 1 },
        { id: 'a-c-2', name: 'last_name', physical_entity_id: 'e-customers', source_type: 'varchar(50)', is_nullable: false, ordinal: 2 },
        { id: 'a-c-3', name: 'email', physical_entity_id: 'e-customers', source_type: 'varchar(100)', is_nullable: true, ordinal: 3 },
        { id: 'a-c-4', name: 'balance', physical_entity_id: 'e-customers', source_type: 'money', is_nullable: false, ordinal: 4 },
        { id: 'a-c-5', name: 'active', physical_entity_id: 'e-customers', source_type: 'bit', is_nullable: false, ordinal: 5 },
        { id: 'a-c-6', name: 'created_at', physical_entity_id: 'e-customers', source_type: 'datetime', is_nullable: false, column_default: 'getdate()', ordinal: 6 },
        { id: 'a-c-7', name: 'rowver', physical_entity_id: 'e-customers', source_type: 'timestamp', is_nullable: true, ordinal: 7 },
        // dbo.orders
        { id: 'a-o-1', name: 'order_id', physical_entity_id: 'e-orders', source_type: 'int', is_nullable: false, is_identity: true, ordinal: 1 },
        { id: 'a-o-2', name: 'customer_id', physical_entity_id: 'e-orders', source_type: 'int', is_nullable: false, ordinal: 2 },
        { id: 'a-o-3', name: 'amount', physical_entity_id: 'e-orders', source_type: 'numeric', precision: 10, scale: 2, is_nullable: false, ordinal: 3 },
        { id: 'a-o-4', name: 'updated_at', physical_entity_id: 'e-orders', source_type: 'datetime', is_nullable: false, ordinal: 4 },
      ],
      dataEntityPoints: [
        { id: 'p-c', physical_entity_id: 'e-customers' },
        { id: 'p-o', physical_entity_id: 'e-orders' },
      ],
      dataEntityRelationships: [
        {
          id: 'rel-1',
          fromDataEntityPointId: 'p-o',
          toDataEntityPointId: 'p-c',
          fk_columns: {
            join_columns: ['customer_id'],
            referenced_columns: ['customer_id'],
            on_delete: 'SET NULL',
            on_update: 'NO ACTION',
          },
        },
      ],
    },
    findings: [
      {
        id: 'f-coll',
        finding_type: 'collation_case_sensitivity_hazard',
        detail_json: {
          engineKey: 'sybase',
          schemaName: 'dbo',
          tableName: 'customers',
          columnName: 'last_name',
          collation: 'SQL_Latin1_General_CP1_CI_AS',
        },
      },
      {
        id: 'f-npd',
        finding_type: 'non_portable_default',
        detail_json: {
          engineKey: 'sybase',
          schemaName: 'dbo',
          tableName: 'customers',
          columnName: 'created_at',
          columnDefault: 'getdate()',
          detectedToken: 'getdate',
          portabilityNote: 'T-SQL getdate() -> Postgres now() / CURRENT_TIMESTAMP',
        },
      },
      {
        id: 'f-seq-customers',
        finding_type: 'sequence_cutover_hazard',
        detail_json: {
          engineKey: 'sybase',
          schemaName: 'dbo',
          sequenceName: 'customers_customer_id',
          currentValue: '5000',
          currentValueAvailable: true,
          ownedByTable: 'customers',
          ownedByColumn: 'customer_id',
        },
      },
      {
        id: 'f-seq-orders',
        finding_type: 'sequence_cutover_hazard',
        detail_json: {
          engineKey: 'sybase',
          schemaName: 'dbo',
          sequenceName: 'orders_order_id',
          currentValue: null,
          currentValueAvailable: false,
          ownedByTable: 'orders',
          ownedByColumn: 'order_id',
        },
      },
      ...(overrides?.extraFindings ?? []),
    ],
    dbDecisions: [
      { decisionCode: 'db.engine', answerValue: overrides?.dbEngineAnswer ?? 'PostgreSQL' },
      { decisionCode: 'db.migrations', answerValue: 'Liquibase' },
    ],
    resolvedPackDecisions: [],
  };
}

function fileByPath(files: Array<{ filePath: string; content: string }>, path: string): string {
  const f = files.find((x) => x.filePath === path);
  if (!f) {
    throw new Error(`expected file ${path} not generated; got ${files.map((x) => x.filePath).join(', ')}`);
  }
  return f.content;
}

describe('dbMigrationPack generation core (Group 2)', () => {
  // (a) -----------------------------------------------------------------
  it('applies the v1 type-mapping table deterministically and flags Sybase timestamp as a type_mapping decision, never a guess', () => {
    const ir = buildSourceSchemaIr(makeInputs());
    const artifacts = buildDbMigrationPackArtifacts(ir);

    const customers = fileByPath(artifacts.files, 'liquibase/changesets/010-tables/dbo.customers.sql');
    const orders = fileByPath(artifacts.files, 'liquibase/changesets/010-tables/dbo.orders.sql');

    expect(customers).toContain('"balance" numeric(19,4) NOT NULL');
    expect(customers).toContain('"created_at" timestamptz NOT NULL');
    expect(customers).toContain('"active" boolean NOT NULL');
    expect(customers).toContain('"last_name" varchar(50) NOT NULL');
    expect(customers).toContain('"customer_id" integer GENERATED ALWAYS AS IDENTITY NOT NULL');
    expect(orders).toContain('"amount" numeric(10,2) NOT NULL');

    // Sybase timestamp (rowversion): NO emitted type anywhere — omitted +
    // flagged with concrete options.
    expect(customers).not.toMatch(/rowver\s+(bytea|timestamptz|timestamp)/);
    expect(customers).toContain("NEEDS DECISION (type_mapping): column dbo.customers.rowver");
    const decision = artifacts.decisions.find(
      (d) => d.decisionKey === 'type_mapping--dbo.customers.rowver'
    );
    expect(decision).toBeDefined();
    expect(decision!.category).toBe('type_mapping');
    expect(decision!.options).toEqual(['map_to_bytea', 'drop_column', 'application_managed']);

    // Checksum-stable changeset id + logicalFilePath as functions of identity.
    expect(customers).toContain('--changeset db-migration-pack:table-dbo.customers');
    expect(customers).toContain(
      'logicalFilePath:liquibase/changesets/010-tables/dbo.customers.sql'
    );
  });

  // (b) -----------------------------------------------------------------
  it('merges findings into the IR: collation decision, getdate()->now() rewrite, high-water seeding with margin, unavailable high-water decision', () => {
    const ir = buildSourceSchemaIr(makeInputs());
    const artifacts = buildDbMigrationPackArtifacts(ir); // default margin 1000

    // Collation hazard -> a `collation` decision with the three options.
    const collation = artifacts.decisions.find(
      (d) => d.decisionKey === 'collation--dbo.customers.last_name'
    );
    expect(collation).toBeDefined();
    expect(collation!.category).toBe('collation');
    expect(collation!.options).toEqual([
      'citext',
      'expression_indexes_app_discipline',
      'accept_case_sensitive_change',
    ]);

    // Non-portable default with a safe equivalent -> deterministic rewrite.
    const customers = fileByPath(artifacts.files, 'liquibase/changesets/010-tables/dbo.customers.sql');
    expect(customers).toContain('"created_at" timestamptz NOT NULL DEFAULT now()');
    expect(customers).not.toContain('getdate');

    // Captured high-water (5000) + margin (1000) -> RESTART WITH 6000.
    const seed = fileByPath(artifacts.files, 'liquibase/changesets/040-sequences-seed.sql');
    expect(seed).toContain(
      'ALTER TABLE "dbo"."customers" ALTER COLUMN "customer_id" RESTART WITH 6000;'
    );

    // Value-unavailable high-water -> needs_decision, NEVER a silent restart-at-1.
    const seedDecision = artifacts.decisions.find(
      (d) => d.decisionKey === 'sequence_seed--dbo.orders.order_id'
    );
    expect(seedDecision).toBeDefined();
    expect(seedDecision!.options).toEqual([
      'provide_restart_value',
      'derive_from_table_max_at_cutover',
    ]);
    expect(seed).not.toMatch(/orders ALTER COLUMN order_id RESTART/);
    expect(seed).toContain('NEEDS DECISION (sequence_seed--dbo.orders.order_id)');
  });

  // (c) -----------------------------------------------------------------
  it('accounts for every table and column in exactly one coverage bucket with provenance, and FAILS the run on an unaccounted object', () => {
    const ir = buildSourceSchemaIr(makeInputs());
    const artifacts = buildDbMigrationPackArtifacts(ir);

    // 2 tables + 11 columns = 13 objects, each in exactly one bucket.
    expect(artifacts.coverage).toHaveLength(13);
    expect(
      artifacts.counts.translated + artifacts.counts.skipped + artifacts.counts.flagged
    ).toBe(13);
    for (const entry of artifacts.coverage) {
      expect(['translated', 'skipped', 'flagged']).toContain(entry.disposition);
      expect(entry.provenance.entityId).toBeTruthy();
      if (entry.disposition === 'skipped') expect(entry.reason).toBeTruthy();
      if (entry.disposition === 'flagged') expect(entry.decisionKeys!.length).toBeGreaterThan(0);
    }
    // The flagged rowver column carries its decision key + attribute provenance.
    const rowver = artifacts.coverage.find((c) => c.objectRef === 'dbo.customers.rowver');
    expect(rowver!.disposition).toBe('flagged');
    expect(rowver!.decisionKeys).toContain('type_mapping--dbo.customers.rowver');
    expect(rowver!.provenance.attributeId).toBe('a-c-7');

    // An artificially unaccounted object FAILS the run — never passes silently.
    const doctored = artifacts.coverage.filter((c) => c.objectRef !== 'dbo.orders.amount');
    expect(() => assertCoverage(ir, doctored)).toThrow(CoverageAssertionError);
    expect(() => assertCoverage(ir, doctored)).toThrow(/dbo\.orders\.amount/);
  });

  // (d) -----------------------------------------------------------------
  it('produces byte-identical files and the same input_snapshot_hash across two generations over identical inputs', async () => {
    const persisted: UpsertPackBody[] = [];
    const deps = {
      // Spec-2 translation hook stubbed: this suite covers the Spec-1 pipeline.
      translationHook: async () => null,
      fetchModel: async () => makeInputs().model,
      fetchFindings: async () => makeInputs().findings,
      fetchDbDecisions: async () => makeInputs().dbDecisions,
      fetchResolvedPackDecisions: async () => [],
      persistPack: async (_projectId: string, body: UpsertPackBody) => {
        persisted.push(body);
        return { id: 'pack-1', project_id: 'proj-1', architecture_id: 'arch-1', status: 'generated', input_snapshot_hash: body.input_snapshot_hash, translated_count: body.translated_count, skipped_count: body.skipped_count, flagged_count: body.flagged_count, seed_margin: body.seed_margin };
      },
    };

    const first = await generateDbMigrationPack(
      { projectId: 'proj-1', architectureId: 'arch-1' },
      deps
    );
    const second = await generateDbMigrationPack(
      { projectId: 'proj-1', architectureId: 'arch-1' },
      deps
    );

    expect(first.inputSnapshotHash).toBe(second.inputSnapshotHash);
    expect(first.inputSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(persisted).toHaveLength(2);
    // Byte-identical: every file path + content + sort order matches exactly.
    expect(persisted[1].files).toEqual(persisted[0].files);
    expect(persisted[1].input_snapshot_hash).toBe(persisted[0].input_snapshot_hash);
    // And the hash is reproducible from the raw inputs directly.
    expect(computeInputSnapshotHash(makeInputs())).toBe(first.inputSnapshotHash);
    // Persist shape sanity: status generated, snake_case files + decisions.
    expect(persisted[0].status).toBe('generated');
    expect(persisted[0].files.some((f) => f.file_kind === 'liquibase_master')).toBe(true);
    expect(
      persisted[0].decisions.some((d) => d.decision_key === 'type_mapping--dbo.customers.rowver')
    ).toBe(true);
  });

  // (e) -----------------------------------------------------------------
  it('rejects any source/target combination other than Sybase ASE -> PostgreSQL', () => {
    expect(() => buildSourceSchemaIr(makeInputs({ dbEngineAnswer: 'MySQL' }))).toThrow(
      UnsupportedEnginePairError
    );
    expect(() => buildSourceSchemaIr(makeInputs({ dbEngineAnswer: 'MySQL' }))).toThrow(
      /Sybase ASE -> PostgreSQL is the only supported combination/
    );
    // Missing db.engine decision is equally a rejection (mandatory input).
    const noEngine = makeInputs();
    noEngine.dbDecisions = noEngine.dbDecisions.filter((d) => d.decisionCode !== 'db.engine');
    expect(() => buildSourceSchemaIr(noEngine)).toThrow(UnsupportedEnginePairError);
  });

  // (f) -----------------------------------------------------------------
  it('lists procs/triggers/views as requires_translation_spec_2 and scheduled jobs as manual recreation — with finding provenance, never as changesets', () => {
    const inputs = makeInputs({
      extraFindings: [
        {
          id: 'f-proc',
          finding_type: 'stored_procedure_logic',
          detail_json: { engineKey: 'sybase', schemaName: 'dbo', procedureName: 'usp_recalc_balances' },
        },
        {
          id: 'f-trig',
          finding_type: 'trigger_logic',
          detail_json: { engineKey: 'sybase', schemaName: 'dbo', triggerName: 'trg_orders_audit' },
        },
        {
          id: 'f-view',
          finding_type: 'view_definition',
          detail_json: { engineKey: 'sybase', schemaName: 'dbo', viewName: 'v_order_totals' },
        },
        {
          id: 'f-job',
          finding_type: 'db_resident_scheduled_job',
          detail_json: { engineKey: 'sybase', schemaName: 'dbo', jobName: 'nightly_purge' },
        },
      ],
    });
    const artifacts = buildDbMigrationPackArtifacts(buildSourceSchemaIr(inputs));

    const rt = artifacts.manifest.requires_translation_spec_2;
    expect(rt).toContainEqual({
      kind: 'stored_procedure',
      object_ref: 'dbo.usp_recalc_balances',
      finding_ids: ['f-proc'],
    });
    expect(rt).toContainEqual({
      kind: 'trigger',
      object_ref: 'dbo.trg_orders_audit',
      finding_ids: ['f-trig'],
    });
    expect(rt).toContainEqual({
      kind: 'view',
      object_ref: 'dbo.v_order_totals',
      finding_ids: ['f-view'],
    });
    expect(artifacts.manifest.manual_recreation).toContainEqual({
      kind: 'scheduled_job',
      object_ref: 'dbo.nightly_purge',
      finding_ids: ['f-job'],
    });

    // NEVER emitted as changesets.
    const changesetContent = artifacts.files
      .filter((f) => f.fileKind === 'liquibase_changeset' || f.fileKind === 'liquibase_master')
      .map((f) => f.content)
      .join('\n');
    expect(changesetContent).not.toContain('usp_recalc_balances');
    expect(changesetContent).not.toContain('trg_orders_audit');
    expect(changesetContent).not.toContain('v_order_totals');
    expect(changesetContent).not.toContain('nightly_purge');
  });

  // FK + clustered-index emission ride along with (a)/(b) fixtures --------
  it('emits FK actions verbatim post-load, FK-topological structural order, and clustered indexes as btree with an explicit CLUSTER note', () => {
    const artifacts = buildDbMigrationPackArtifacts(buildSourceSchemaIr(makeInputs()));

    // Parents before children in the master changelog include order.
    const master = fileByPath(artifacts.files, 'liquibase/db.changelog-master.xml');
    expect(master.indexOf('dbo.customers.sql')).toBeLessThan(master.indexOf('dbo.orders.sql'));

    const fks = fileByPath(artifacts.files, 'liquibase/changesets/020-foreign-keys.sql');
    expect(fks).toContain(
      'ALTER TABLE "dbo"."orders" ADD CONSTRAINT "fk_orders__customers__customer_id" ' +
        'FOREIGN KEY ("customer_id") REFERENCES "dbo"."customers" ("customer_id") ' +
        'ON DELETE SET NULL ON UPDATE NO ACTION;'
    );

    const indexes = fileByPath(artifacts.files, 'liquibase/changesets/030-indexes.sql');
    expect(indexes).toContain('CREATE INDEX "ix_customers_last_name" ON "dbo"."customers" ("last_name" ASC);');
    expect(indexes).toContain('-- CLUSTER: source index ix_customers_last_name was CLUSTERED on Sybase');
    expect(artifacts.manifest.cluster_notes.join(' ')).toContain('ix_customers_last_name');

    // The expected-schema diff baseline is present in the manifest.
    expect(artifacts.manifest.expected_schema.tables).toContainEqual({
      schemaName: 'dbo',
      tableName: 'orders',
    });

    // The DECLARED target-DB binding (Residual 2): the plan creates the target
    // database, so the plan states its coordinates — local defaults, never
    // secrets.
    expect(artifacts.manifest.target_db).toMatchObject({
      engine: 'postgresql',
      host: 'localhost',
      port: 5432,
      database: 'haikai_target',
      schema: 'public',
      username: 'postgres',
    });
    expect(JSON.stringify(artifacts.manifest.target_db)).not.toMatch(/password/i);
    expect(
      artifacts.manifest.expected_schema.keysAndIndexes.some(
        (k) => k.kind === 'foreign_key' && k.onDelete === 'SET NULL'
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 7 — strategic end-to-end gap tests (Task 7.3)
// ---------------------------------------------------------------------------

describe('dbMigrationPack Group 7 — generate -> resolve -> regenerate cycle', () => {
  it('feeds resolved decisions back into regeneration: the DDL changes, resolved keys are not re-raised, coverage moves flagged -> translated, and the snapshot hash changes', async () => {
    const persisted: UpsertPackBody[] = [];
    let resolved: RawResolvedPackDecision[] = [];
    const deps = {
      // Spec-2 translation hook stubbed: this suite covers the Spec-1 pipeline.
      translationHook: async () => null,
      fetchModel: async () => makeInputs().model,
      fetchFindings: async () => makeInputs().findings,
      fetchDbDecisions: async () => makeInputs().dbDecisions,
      fetchResolvedPackDecisions: async () => resolved,
      persistPack: async (_projectId: string, body: UpsertPackBody) => {
        persisted.push(body);
        return {
          id: 'pack-1',
          project_id: 'proj-1',
          architecture_id: 'arch-1',
          status: 'generated',
          input_snapshot_hash: body.input_snapshot_hash,
          translated_count: body.translated_count,
          skipped_count: body.skipped_count,
          flagged_count: body.flagged_count,
          seed_margin: body.seed_margin,
        };
      },
    };

    // First generation: three open decisions block full translation.
    const first = await generateDbMigrationPack(
      { projectId: 'proj-1', architectureId: 'arch-1' },
      deps
    );
    expect(first.counts).toEqual({ translated: 10, skipped: 0, flagged: 3 });
    expect(persisted[0].decisions.map((d) => d.decision_key).sort()).toEqual([
      'collation--dbo.customers.last_name',
      'sequence_seed--dbo.orders.order_id',
      'type_mapping--dbo.customers.rowver',
    ]);
    const firstCustomers = persisted[0].files.find(
      (f) => f.file_path === 'liquibase/changesets/010-tables/dbo.customers.sql'
    )!;
    expect(firstCustomers.content).toContain('NEEDS DECISION');

    // Resolve all three (AMS re-links these rows by decision_key on the
    // regenerate upsert — proven AMS-side; here we prove the generator
    // CONSUMES the resolutions and does not re-raise them).
    resolved = [
      {
        decision_key: 'type_mapping--dbo.customers.rowver',
        resolution_json: { option: 'map_to_bytea' },
        status: 'resolved',
      },
      {
        decision_key: 'collation--dbo.customers.last_name',
        resolution_json: { option: 'citext' },
        status: 'resolved',
      },
      {
        decision_key: 'sequence_seed--dbo.orders.order_id',
        resolution_json: { option: 'provide_restart_value', restart_with: '90001' },
        status: 'resolved',
      },
    ];
    const second = await generateDbMigrationPack(
      { projectId: 'proj-1', architectureId: 'arch-1' },
      deps
    );

    // The resolutions CHANGED the regenerated DDL.
    const customersFile = persisted[1].files.find(
      (f) => f.file_path === 'liquibase/changesets/010-tables/dbo.customers.sql'
    )!;
    expect(customersFile.content).toContain('"rowver" bytea');
    expect(customersFile.content).toContain('"last_name" citext NOT NULL');
    expect(customersFile.content).not.toContain('NEEDS DECISION');
    const seedFile = persisted[1].files.find(
      (f) => f.file_path === 'liquibase/changesets/040-sequences-seed.sql'
    )!;
    expect(seedFile.content).toContain(
      'ALTER TABLE "dbo"."orders" ALTER COLUMN "order_id" RESTART WITH 90001;'
    );
    expect(seedFile.content).not.toContain('NEEDS DECISION');

    // Resolved keys are NOT re-raised as new open decisions.
    expect(persisted[1].decisions).toHaveLength(0);

    // Coverage moved flagged -> translated; the snapshot hash changed because
    // resolved pack decisions are a mandatory generation input.
    expect(second.counts).toEqual({ translated: 13, skipped: 0, flagged: 0 });
    expect(second.inputSnapshotHash).not.toBe(first.inputSnapshotHash);
  });
});

describe('dbMigrationPack Group 7 — coverage guarantee on a realistic mixed model', () => {
  it('accounts for translated + skipped + flagged + requires_translation_spec_2 objects in ONE run', () => {
    const inputs = makeInputs({
      extraFindings: [
        {
          id: 'f-proc',
          finding_type: 'stored_procedure_logic',
          detail_json: { engineKey: 'sybase', schemaName: 'dbo', procedureName: 'usp_recalc_balances' },
        },
      ],
    });
    // A committed VIEW entity — skipped, requires translation (spec 2).
    inputs.model.physicalDataEntities.push({
      id: 'e-vsum',
      name: 'dbo.v_customer_summary',
      physical_type: 'view',
      constraints_metadata: {},
    });
    inputs.model.physicalDataAttributes.push({
      id: 'a-v-1',
      name: 'total_balance',
      physical_entity_id: 'e-vsum',
      source_type: 'money',
      is_nullable: true,
      ordinal: 1,
    });
    // One resolved decision producing an EXPLICIT skip (drop_column).
    inputs.resolvedPackDecisions = [
      {
        decision_key: 'type_mapping--dbo.customers.rowver',
        resolution_json: { option: 'drop_column' },
        status: 'resolved',
      },
    ];

    const artifacts = buildDbMigrationPackArtifacts(buildSourceSchemaIr(inputs));

    // 15 objects (2 tables + 11 columns + 1 view + 1 view column), each in
    // exactly one bucket — the in-build assertion already passed (no throw).
    expect(artifacts.coverage).toHaveLength(15);
    expect(artifacts.counts).toEqual({ translated: 10, skipped: 3, flagged: 2 });

    const byRef = (ref: string) => artifacts.coverage.find((c) => c.objectRef === ref)!;
    expect(byRef('dbo.customers.rowver').disposition).toBe('skipped');
    expect(byRef('dbo.customers.rowver').reason).toContain('type_mapping--dbo.customers.rowver');
    expect(byRef('dbo.v_customer_summary').disposition).toBe('skipped');
    expect(byRef('dbo.v_customer_summary.total_balance').disposition).toBe('skipped');
    expect(byRef('dbo.customers.last_name').disposition).toBe('flagged');
    expect(byRef('dbo.orders.order_id').disposition).toBe('flagged');
    expect(byRef('dbo.orders.amount').disposition).toBe('translated');

    // The manifest agrees with the ledger and carries BOTH untranslated kinds.
    expect(artifacts.manifest.coverage.translated_count).toBe(10);
    expect(artifacts.manifest.coverage.skipped_count).toBe(3);
    expect(artifacts.manifest.coverage.flagged_count).toBe(2);
    expect(artifacts.manifest.requires_translation_spec_2).toContainEqual({
      kind: 'view',
      object_ref: 'dbo.v_customer_summary',
      finding_ids: [],
    });
    expect(artifacts.manifest.requires_translation_spec_2).toContainEqual({
      kind: 'stored_procedure',
      object_ref: 'dbo.usp_recalc_balances',
      finding_ids: ['f-proc'],
    });

    // Skipped objects never reach a changeset: the view has none, and the
    // dropped column appears only as an explicit SKIPPED note.
    const master = fileByPath(artifacts.files, 'liquibase/db.changelog-master.xml');
    expect(master).not.toContain('v_customer_summary');
    const customers = fileByPath(artifacts.files, 'liquibase/changesets/010-tables/dbo.customers.sql');
    expect(customers).not.toMatch(/rowver\s+(bytea|varbinary|timestamp)/);
    expect(customers).toContain('-- SKIPPED column dbo.customers.rowver');
  });
});

describe('dbMigrationPack Group 7 — coverage violation fails the pipeline before persistence', () => {
  it('throws CoverageAssertionError on a synthetic duplicated object and persists NOTHING', async () => {
    const inputs = makeInputs();
    // Synthetic ledger corruption: a duplicate attribute name produces TWO
    // coverage entries for dbo.orders.amount — the assertion must fail the
    // ENTIRE run, and stage 6 (persist) must never be reached.
    inputs.model.physicalDataAttributes.push({
      id: 'a-o-3-dup',
      name: 'amount',
      physical_entity_id: 'e-orders',
      source_type: 'numeric',
      precision: 10,
      scale: 2,
      is_nullable: false,
      ordinal: 9,
    });
    const persistPack = jest.fn();
    const deps = {
      // Spec-2 translation hook stubbed: this suite covers the Spec-1 pipeline.
      translationHook: async () => null,
      fetchModel: async () => inputs.model,
      fetchFindings: async () => inputs.findings,
      fetchDbDecisions: async () => inputs.dbDecisions,
      fetchResolvedPackDecisions: async () => [],
      persistPack,
    };
    await expect(
      generateDbMigrationPack({ projectId: 'proj-1', architectureId: 'arch-1' }, deps)
    ).rejects.toThrow(CoverageAssertionError);
    expect(persistPack).not.toHaveBeenCalled();
  });
});
