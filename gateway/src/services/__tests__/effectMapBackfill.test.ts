/**
 * Effect-map backfill tests (2026-08-20).
 *
 * Pins: the SQL write-table parser (schema/bracket stripping, temp-table
 * exclusion, UPDATE-requires-SET), root matching (longest-fragment wins —
 * the `/lookup` vs `/lookupStarred` substring trap), the bounded call
 * walk, and the orchestration: deterministic derivations auto-apply via the
 * MCP seam with source 'corpus'; the remainder goes to the LLM whose
 * proposals pass the closed-vocabulary guard (rejects recorded, never
 * silently dropped); an LLM outage lands endpoints in `unproposed` loudly.
 */

jest.mock('../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    mcpBaseUrl: 'http://localhost:3001',
  }),
}));

import {
  collectBoundaryKeys,
  collectHttpRootTables,
  matchRootsForEndpoint,
  parseWriteTablesFromSql,
  runEffectMapBackfill,
  walkCallGraph,
} from '../effectMapBackfill';
import type { SclContractDto } from '../sclCorpusPlanner';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('parseWriteTablesFromSql', () => {
  it('extracts insert/update/delete/merge targets, stripping schema + brackets', () => {
    expect(parseWriteTablesFromSql('INSERT INTO dbo.orders (a) VALUES (1)')).toEqual(['orders']);
    expect(parseWriteTablesFromSql('update [dbo].[order_lines] set qty = 1')).toEqual([
      'order_lines',
    ]);
    expect(parseWriteTablesFromSql('DELETE FROM "audit"."order_audit" WHERE 1=1')).toEqual([
      'order_audit',
    ]);
    expect(parseWriteTablesFromSql('MERGE INTO orders o USING x ON ...')).toEqual(['orders']);
  });

  it('requires SET after UPDATE (never matches "update" prose) and skips temp tables', () => {
    expect(parseWriteTablesFromSql('SELECT update_count FROM t')).toEqual([]);
    expect(parseWriteTablesFromSql('INSERT INTO #tmp_stage SELECT 1')).toEqual([]);
    expect(parseWriteTablesFromSql(null)).toEqual([]);
  });

  it('dedupes case-insensitively across statements', () => {
    const sql = 'INSERT INTO Orders (a) VALUES (1); UPDATE ORDERS SET a = 2';
    expect(parseWriteTablesFromSql(sql)).toEqual(['Orders']);
  });

  it('parses the T-SQL optional-keyword forms (2026-08-26 mirror of the emitter fix)', () => {
    // Sybase INSERT without INTO / DELETE without FROM — the bare forms left
    // written tables READ-only in the model, so no bracket imaged them.
    expect(parseWriteTablesFromSql('insert filter_tag (filter_id, tag_name) values (?, ?)')).toEqual([
      'filter_tag',
    ]);
    expect(parseWriteTablesFromSql('delete filter_tag where tag_name = ?')).toEqual(['filter_tag']);
    // Routing between the delete forms is unchanged; a truncated-fragment
    // clause keyword is never a table.
    expect(parseWriteTablesFromSql('delete from filter_tag where x = 1')).toEqual(['filter_tag']);
    expect(parseWriteTablesFromSql('values (?) insert into')).toEqual([]);
  });
});

describe('matchRootsForEndpoint (longest-fragment discipline)', () => {
  const roots = [
    { key: 'T-a', symbol: 'R#lookup', method: 'POST', fragment: 'lookup' },
    { key: 'T-b', symbol: 'R#lookupStarred', method: 'POST', fragment: 'lookupStarred' },
    { key: 'T-c', symbol: 'R#del', method: 'DELETE', fragment: 'delete' },
  ];

  it('picks the longest matching fragment (the substring trap)', () => {
    const matched = matchRootsForEndpoint(
      { method: 'POST', path: '/filters/lookupStarred' },
      roots,
    );
    expect(matched.map((r) => r.key)).toEqual(['T-b']);
  });

  it('shorter endpoints only match their own fragment', () => {
    const matched = matchRootsForEndpoint({ method: 'POST', path: '/filters/lookup' }, roots);
    expect(matched.map((r) => r.key)).toEqual(['T-a']);
  });

  it('filters by HTTP method', () => {
    expect(matchRootsForEndpoint({ method: 'DELETE', path: '/filters/lookup' }, roots)).toEqual([]);
  });
});

describe('collectBoundaryKeys', () => {
  it('walks call rows transitively and is cycle-safe', () => {
    const bodies = new Map<string, { rows?: unknown[] }>([
      [
        'T-root',
        {
          rows: [
            { outcome: { type: 'call', targetKey: 'T-mid' } },
            { outcome: { type: 'terminal', verbatim: 'return x' } },
          ],
        },
      ],
      [
        'T-mid',
        {
          rows: [
            { outcome: { type: 'call', targetKey: 'Q-dao1' } },
            { outcome: { type: 'call', targetKey: 'T-root' } }, // cycle
            { outcome: { type: 'call', targetKey: null } }, // unresolved
          ],
        },
      ],
    ]);
    expect(collectBoundaryKeys('T-root', bodies as never)).toEqual(['Q-dao1']);
  });

  it('walkCallGraph records WHERE the chain broke (unresolved call sites)', () => {
    const bodies = new Map<string, { rows?: unknown[] }>([
      [
        'T-root',
        {
          rows: [
            {
              outcome: { type: 'call', targetKey: null, targetSymbol: 'WorkflowDao#save' },
            },
          ],
        },
      ],
    ]);
    const walk = walkCallGraph('T-root', bodies as never);
    expect(walk.boundaries).toEqual([]);
    expect(walk.brokenCalls).toHaveLength(1);
    expect(walk.brokenCalls[0]).toContain('WorkflowDao#save');
    expect(walk.brokenCalls[0]).toContain('unresolved');
  });
});

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function contract(partial: Partial<SclContractDto>): SclContractDto {
  return { contract_key: 'K', kind: 'behaviour_table', ...partial } as SclContractDto;
}

const MODEL = {
  metaModel: {
    entities: {
      endpoints: [
        { id: 'ep-1', operation_verb: 'POST', path_or_address: '/filters/lookup' },
        { id: 'ep-2', operation_verb: 'POST', path_or_address: '/filters/promote' },
        { id: 'ep-3', operation_verb: 'GET', path_or_address: '/filters/list' },
        { id: 'ep-4', operation_verb: 'DELETE', path_or_address: '/filters/delete' },
      ],
      physical_data_entities: [
        { id: 'phy-1', name: 'filters' },
        { id: 'phy-2', name: 'filter_audit' },
      ],
    },
    relationships: {
      endpoint_data_effects: [
        // ep-4 is already mapped -> never in the unmapped set.
        { endpoint_id: 'ep-4', access_mode: 'write', data_entity_point_id: 'dep_phy_phy-1' },
      ],
    },
  },
};

const CONTRACTS: SclContractDto[] = [
  contract({
    contract_key: 'T-lookup',
    kind: 'behaviour_table',
    source_symbol: 'FilterResource#lookup',
    body_json: {
      annotations: ['@POST', '@Path("lookup")'],
      rows: [{ outcome: { type: 'call', targetKey: 'Q-dao' } }],
    } as never,
  }),
  contract({
    contract_key: 'Q-dao',
    kind: 'boundary',
    source_symbol: 'FilterDao',
    body_json: {
      operations: [
        { sqlVerbatim: 'INSERT INTO filters (a) VALUES (?)' },
        { sqlVerbatim: 'UPDATE not_in_model SET x = 1' },
      ],
    } as never,
  }),
];

describe('runEffectMapBackfill', () => {
  it('derives + auto-applies corpus mappings, sends the remainder to the guarded LLM', async () => {
    const mcpCalls: unknown[] = [];
    const llmCalls: string[] = [];
    const result = await runEffectMapBackfill(
      { projectId: 'p1', architectureId: 'a1' },
      {
        fetchRawModel: async () => MODEL as never,
        fetchContracts: async () => CONTRACTS,
        mcpApply: async (_p, _a, effects) => {
          mcpCalls.push(effects);
          return { applied: effects.length, skipped: [] };
        },
        llm: async ({ userPrompt }) => {
          llmCalls.push(userPrompt);
          return {
            content: JSON.stringify({
              proposals: [
                {
                  method: 'POST',
                  path: '/filters/promote',
                  tables: ['filter_audit', 'made_up_table'],
                  rationale: 'promotion writes the audit trail',
                },
              ],
            }),
          };
        },
      },
    );

    // GET endpoint + already-mapped endpoint never enter the run.
    expect(result.unmapped_count).toBe(2);

    // ep-1 derived deterministically: root matched, walk reached the DAO,
    // 'filters' resolved in the model, 'not_in_model' recorded honestly.
    expect(result.derived).toHaveLength(1);
    expect(result.derived[0].endpoint_id).toBe('ep-1');
    expect(result.derived[0].tables).toEqual(['filters']);
    expect(result.derived[0].unknown_tables).toEqual(['not_in_model']);
    expect(result.derived[0].evidence).toContain('FilterResource#lookup');

    // Auto-applied with source 'corpus'.
    expect(mcpCalls).toHaveLength(1);
    expect((mcpCalls[0] as Array<{ source: string; endpoint_id: string }>)[0]).toMatchObject({
      endpoint_id: 'ep-1',
      table_name: 'filters',
      source: 'corpus',
    });
    expect(result.derived_apply?.applied).toBe(1);

    // ep-2 went to the LLM; the guard kept the committed table and recorded
    // the invented one.
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]).toContain('filter_audit'); // vocabulary present
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      endpoint_id: 'ep-2',
      tables: ['filter_audit'],
      guard_rejected: ['made_up_table'],
    });
    expect(result.unproposed).toHaveLength(0);

    // Diagnosis trace: ep-2 had NO matching root — the trace says so and
    // lists the same-verb fragments that WERE available.
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]).toMatchObject({
      endpoint_id: 'ep-2',
      stage: 'no_root_match',
    });
    expect(result.trace[0].same_verb_root_fragments).toContain('lookup');
  });

  it('an LLM outage lands the batch in unproposed with the reason (never silent)', async () => {
    const result = await runEffectMapBackfill(
      { projectId: 'p1', architectureId: 'a1' },
      {
        fetchRawModel: async () => MODEL as never,
        fetchContracts: async () => CONTRACTS,
        mcpApply: async (_p, _a, effects) => ({ applied: effects.length, skipped: [] }),
        llm: async () => {
          throw new Error('HTTP 429 shared cool-down');
        },
      },
    );
    expect(result.unproposed).toHaveLength(1);
    expect(result.unproposed[0].endpoint_id).toBe('ep-2');
    expect(result.unproposed[0].reason).toContain('429');
  });

  it('no corpus + no proposals = everything honest in unproposed; nothing applied', async () => {
    let mcpCalled = false;
    const result = await runEffectMapBackfill(
      { projectId: 'p1', architectureId: 'a1' },
      {
        fetchRawModel: async () => MODEL as never,
        fetchContracts: async () => null,
        mcpApply: async () => {
          mcpCalled = true;
          return { applied: 0, skipped: [] };
        },
        llm: async () => ({ content: JSON.stringify({ proposals: [] }) }),
      },
    );
    expect(result.derived).toHaveLength(0);
    expect(mcpCalled).toBe(false);
    expect(result.proposals).toHaveLength(0);
    expect(result.unproposed).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 2026-08-21 fixes: real-symbol dispatch keys + unresolved-reason clause
// ---------------------------------------------------------------------------

import { buildDispatchIndex, unresolvedReason } from '../effectMapBackfill';

describe('dispatch fixes (2026-08-21)', () => {
  const contractsWithRealSymbols: SclContractDto[] = [
    contract({
      contract_key: 'T-impl',
      kind: 'behaviour_table',
      source_symbol: 'com.example.factory.DbNodeLoader#load(LocalDate)',
      body_json: { signatureInputs: [{ name: 'd', typeRef: 'LocalDate' }], rows: [] } as never,
    }),
    contract({
      contract_key: 'Q-dao',
      kind: 'boundary',
      source_symbol: 'com.example.dao.NodeDao',
      body_json: { operations: [{ name: 'save', sqlVerbatim: 'UPDATE t SET x=1' }] } as never,
    }),
  ];

  it('buildDispatchIndex strips the parameter list from REAL symbols (paren fix)', () => {
    const index = buildDispatchIndex(contractsWithRealSymbols);
    expect(index.tablesByNameArity.get('load/1')).toEqual(['T-impl']);
    expect(index.tablesByName.get('load')).toEqual(['T-impl']);
    // The broken pre-fix key must NOT exist.
    expect(index.tablesByNameArity.has('load(LocalDate)/1')).toBe(false);
    expect(index.classFqnsInCorpus.has('com.example.factory.DbNodeLoader')).toBe(true);
    expect(index.classFqnsInCorpus.has('com.example.dao.NodeDao')).toBe(true);
  });

  it('unresolvedReason distinguishes absent classes from missing methods', () => {
    const index = buildDispatchIndex(contractsWithRealSymbols);
    expect(unresolvedReason('com.x.Gone#fetch(LocalDate)', index)).toContain(
      'NO corpus presence',
    );
    expect(
      unresolvedReason('com.example.factory.DbNodeLoader#fetch(LocalDate)', index),
    ).toContain('no method named fetch/1');
  });

  it('walkCallGraph broken-call lines carry the reason when an expansion index is supplied', () => {
    const bodies = new Map<string, { rows?: unknown[] }>([
      [
        'T-root',
        {
          rows: [
            {
              outcome: {
                type: 'call',
                targetKey: null,
                targetSymbol: 'com.x.Gone#fetch(LocalDate)',
              },
            },
          ],
        },
      ],
    ]);
    const index = buildDispatchIndex(contractsWithRealSymbols);
    const walk = walkCallGraph('T-root', bodies as never, 500, index);
    expect(walk.brokenCalls[0]).toContain('unresolved (target class has NO corpus presence');
  });
});

// ---------------------------------------------------------------------------
// 2026-08-21 round 2: preflight parity (read-mapped skip) + proven-read
// ---------------------------------------------------------------------------

describe('proven-read + read-mapped parity (2026-08-21)', () => {
  const READ_ONLY_CONTRACTS: SclContractDto[] = [
    contract({
      contract_key: 'T-lookup',
      kind: 'behaviour_table',
      source_symbol: 'FilterResource#lookup',
      body_json: {
        annotations: ['@POST', '@Path("lookup")'],
        rows: [{ outcome: { type: 'call', targetKey: 'Q-dao' } }],
      } as never,
    }),
    contract({
      contract_key: 'Q-dao',
      kind: 'boundary',
      source_symbol: 'FilterDao',
      body_json: {
        operations: [{ name: 'find', sqlVerbatim: 'SELECT a FROM filters WHERE x = ?' }],
      } as never,
    }),
  ];

  it('a COMPLETE read-only walk is proven-read: read edges applied, never sent to the LLM', async () => {
    const mcpCalls: unknown[][] = [];
    let llmCalled = false;
    const result = await runEffectMapBackfill(
      { projectId: 'p1', architectureId: 'a1' },
      {
        fetchRawModel: async () =>
          ({
            metaModel: {
              entities: {
                endpoints: [
                  { id: 'ep-1', operation_verb: 'POST', path_or_address: '/filters/lookup' },
                ],
                physical_data_entities: [{ id: 'phy-1', name: 'filters' }],
              },
              relationships: { endpoint_data_effects: [] },
            },
          }) as never,
        fetchContracts: async () => READ_ONLY_CONTRACTS,
        mcpApply: async (_p, _a, effects) => {
          mcpCalls.push(effects as unknown[]);
          return { applied: effects.length, skipped: [] };
        },
        llm: async () => {
          llmCalled = true;
          return { content: JSON.stringify({ proposals: [] }) };
        },
      },
    );

    expect(result.proven_read).toHaveLength(1);
    expect(result.proven_read[0]).toMatchObject({
      endpoint_id: 'ep-1',
      read_tables: ['filters'],
    });
    expect(result.summary.proven_read_count).toBe(1);
    expect(result.proven_read_apply?.applied).toBe(1);
    // The ONE mcp call is the proven-read apply, access_mode 'read'.
    expect(mcpCalls).toHaveLength(1);
    expect((mcpCalls[0][0] as { access_mode?: string }).access_mode).toBe('read');
    expect(llmCalled).toBe(false);
    expect(result.unproposed).toHaveLength(0);
    expect(result.trace).toHaveLength(0);
  });

  it('read-mapped endpoints are excluded up front (preflight parity) and counted', async () => {
    const result = await runEffectMapBackfill(
      { projectId: 'p1', architectureId: 'a1' },
      {
        fetchRawModel: async () =>
          ({
            metaModel: {
              entities: {
                endpoints: [
                  { id: 'ep-1', operation_verb: 'POST', path_or_address: '/filters/lookup' },
                ],
                physical_data_entities: [{ id: 'phy-1', name: 'filters' }],
              },
              relationships: {
                endpoint_data_effects: [
                  {
                    endpoint_id: 'ep-1',
                    access_mode: 'read',
                    data_entity_point_id: 'dep_phy_phy-1',
                  },
                ],
              },
            },
          }) as never,
        fetchContracts: async () => READ_ONLY_CONTRACTS,
        mcpApply: async (_p, _a, effects) => ({ applied: effects.length, skipped: [] }),
        llm: async () => ({ content: JSON.stringify({ proposals: [] }) }),
      },
    );
    expect(result.unmapped_count).toBe(0);
    expect(result.summary.read_mapped_count).toBe(1);
    expect(result.proven_read).toHaveLength(0);
  });

  it('boundary lines in the trace carry SQL-visibility stats', async () => {
    const NO_SQL_CONTRACTS: SclContractDto[] = [
      contract({
        contract_key: 'T-save',
        kind: 'behaviour_table',
        source_symbol: 'R#save',
        body_json: {
          annotations: ['@POST', '@Path("save")'],
          rows: [{ outcome: { type: 'call', targetKey: 'Q-blind' } }],
        } as never,
      }),
      contract({
        contract_key: 'Q-blind',
        kind: 'boundary',
        source_symbol: 'BlindDao',
        body_json: {
          operations: [{ name: 'run', sqlVerbatim: null }],
        } as never,
      }),
    ];
    const result = await runEffectMapBackfill(
      { projectId: 'p1', architectureId: 'a1' },
      {
        fetchRawModel: async () =>
          ({
            metaModel: {
              entities: {
                endpoints: [{ id: 'ep-1', operation_verb: 'POST', path_or_address: '/x/save' }],
                physical_data_entities: [{ id: 'phy-1', name: 'filters' }],
              },
              relationships: { endpoint_data_effects: [] },
            },
          }) as never,
        fetchContracts: async () => NO_SQL_CONTRACTS,
        mcpApply: async (_p, _a, effects) => ({ applied: effects.length, skipped: [] }),
        llm: async () => ({ content: JSON.stringify({ proposals: [] }) }),
      },
    );
    // No SQL anywhere -> NOT proven read; the stats say WHY.
    expect(result.proven_read).toHaveLength(0);
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0].boundaries_reached[0]).toBe(
      'BlindDao (ops 1, sql 0, reads 0, writes 0; blind ops: run)',
    );
  });
});

describe('class-aware dispatch ladder (2026-08-21 Item 4, gateway mirror)', () => {
  it('exact class map exists and blind name-only is reserved for ?-class symbols', () => {
    const index = buildDispatchIndex([
      contract({
        contract_key: 'T-a',
        kind: 'behaviour_table',
        source_symbol: 'com.a.OrgSaver#save(String)',
        body_json: { signatureInputs: [{ name: 'k', typeRef: 'String' }], rows: [] } as never,
      }),
    ]);
    expect(index.tablesByClassNameArity.get('com.a.OrgSaver#save/1')).toEqual(['T-a']);
    // Known class, wrong arity -> broken (reason names the miss), never a
    // blind name union.
    expect(unresolvedReason('com.a.OrgSaver#save(String,int)', index)).toContain(
      'no method named save/2',
    );
    // Unknown receiver -> the dedicated reason.
    expect(unresolvedReason('?#vanish(?)', index)).toContain(
      'receiver type could not be determined at scan time',
    );
  });
});
