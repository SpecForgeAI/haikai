/**
 * DB-change consumer resolution + dialect plan/carriage integration
 * (Spec 2026-07-06-f — T-SQL Affinity & Consumer Revalidation).
 *
 * Pins:
 *   AFFECTED    — pack with 1 translated proc + 1 tsql-flagged endpoint +
 *                 1 clean endpoint → affected set = the two, not the third,
 *                 each with its reason(s).
 *   REVALIDATE  — the convenience run creates a replay+diff scoped to
 *                 EXACTLY the affected keys (mock verify asserts scope);
 *                 an empty affected set runs nothing.
 *   PLAN        — a dialect-affected endpoint is flagged `dialect_affected`
 *                 (splits out of its interface cluster into an individual
 *                 story via the existing flagged-endpoint machinery).
 *   CARRIAGE    — the spec text embeds the offending SQL + construct list +
 *                 suggested equivalents VERBATIM (guidance carried, never
 *                 invented).
 */

import {
  packObjectSetFromTranslations,
  resolveAffectedConsumers,
  revalidateDbConsumers,
  type ConsumerResolverReads,
  type ModelIndex,
} from '../services/dbChangeConsumerResolver';
import { flagEndpoint, type CodeEndpointRow, type CodeModelView } from '../services/migrationCodeStreamPlanner';
import { buildCodeSpecText } from '../services/migrationCodeSpecCarriage';
import type { EndpointDataEffectRow } from '../services/endpointDataEffectsClient';
import type { PackTranslationRow } from '../services/migrationDbPackPlanner';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MODEL_INDEX: ModelIndex = {
  endpointKeyById: new Map([
    ['ep-proc', 'POST /orders/{id}/update'],
    ['ep-tsql', 'GET /orders'],
    ['ep-clean', 'GET /customers'],
  ]),
  depIdByPhysicalName: new Map([
    ['sp_update_order', 'dep_phy_proc1'],
    ['orders', 'dep_phy_tab1'],
  ]),
  effects: [
    {
      id: 'e1',
      endpoint_id: 'ep-tsql',
      data_entity_point_id: 'dep_phy_tab1',
      path_metadata_json: { sql_dialect: 'tsql', query_text: 'SELECT TOP 5 * FROM orders' },
    },
    {
      id: 'e2',
      endpoint_id: 'ep-clean',
      data_entity_point_id: 'dep_phy_tab1',
      path_metadata_json: { sql_dialect: 'ansi' },
    },
  ] as EndpointDataEffectRow[],
};

function reads(overrides: Partial<ConsumerResolverReads> = {}): ConsumerResolverReads {
  return {
    fetchModelIndex: jest.fn(async () => MODEL_INDEX),
    fetchEffectsByDataEntityPointIds: jest.fn(async (_p, _a, depIds: string[]) =>
      depIds.includes('dep_phy_proc1')
        ? ([
            { id: 'e3', endpoint_id: 'ep-proc', data_entity_point_id: 'dep_phy_proc1' },
          ] as EndpointDataEffectRow[])
        : [],
    ),
    ...overrides,
  };
}

const TRANSLATIONS: PackTranslationRow[] = [
  {
    translation_key: 't1',
    object_ref: 'proc:dbo.sp_update_order',
    kind: 'procedure',
    disposition: 'translate',
    review_status: 'approved',
  },
  {
    translation_key: 't2',
    object_ref: 'view:v_ignore_me',
    kind: 'view',
    disposition: 'defer',
    review_status: 'unreviewed',
  },
];

// ---------------------------------------------------------------------------
// AFFECTED
// ---------------------------------------------------------------------------

test('AFFECTED: translated proc + tsql endpoint in; clean endpoint out; reasons carried', async () => {
  const packObjects = packObjectSetFromTranslations(TRANSLATIONS);
  expect(packObjects.translatedObjectNames).toEqual(['dbo.sp_update_order']);

  const affected = await resolveAffectedConsumers({
    projectId: 'proj-1',
    currentArchitectureId: 'arch-1',
    packObjects,
    reads: reads(),
  });
  expect(affected.affectedEndpointIds.sort()).toEqual(['ep-proc', 'ep-tsql']);
  expect(affected.affectedEndpointIds).not.toContain('ep-clean');
  expect(affected.reasonsByEndpointId.get('ep-proc')).toEqual(['translated_proc']);
  expect(affected.reasonsByEndpointId.get('ep-tsql')).toEqual(['tsql_dialect_sql']);
  expect(affected.affectedEndpointKeys.sort()).toEqual([
    'GET /orders',
    'POST /orders/{id}/update',
  ]);
});

test('AFFECTED: unreadable model yields an EMPTY set (logged), never a crash', async () => {
  const affected = await resolveAffectedConsumers({
    projectId: 'proj-1',
    currentArchitectureId: 'arch-1',
    packObjects: { translatedObjectNames: ['x'], alteredTableNames: [] },
    reads: reads({ fetchModelIndex: jest.fn(async () => null) }),
  });
  expect(affected.affectedEndpointIds).toEqual([]);
});

// ---------------------------------------------------------------------------
// REVALIDATE
// ---------------------------------------------------------------------------

test('REVALIDATE: the scoped verify receives EXACTLY the affected keys; empty set runs nothing', async () => {
  const verify = jest.fn(
    async (args: { endpointScope: string[] | null }) => {
      void args;
      return { clean: true } as never;
    },
  );
  const result = await revalidateDbConsumers(
    {
      projectId: 'proj-1',
      currentArchitectureId: 'arch-1',
      sourceBaselineId: 'src-b',
      targetBaseUrl: 'https://target.example.test',
      api: { type: 'bearer', bearerToken: 'in-memory' } as never,
      packObjects: packObjectSetFromTranslations(TRANSLATIONS),
    },
    { reads: reads(), verify },
  );
  expect(verify).toHaveBeenCalledTimes(1);
  const verifyArgs = verify.mock.calls[0][0];
  expect((verifyArgs.endpointScope ?? []).slice().sort()).toEqual([
    'GET /orders',
    'POST /orders/{id}/update',
  ]);
  expect(result.verdict).toEqual({ clean: true });

  const emptyVerify = jest.fn();
  const empty = await revalidateDbConsumers(
    {
      projectId: 'proj-1',
      currentArchitectureId: 'arch-1',
      sourceBaselineId: 'src-b',
      targetBaseUrl: 'https://target.example.test',
      api: { type: 'none' } as never,
      packObjects: { translatedObjectNames: [], alteredTableNames: [] },
    },
    {
      reads: reads({
        fetchModelIndex: jest.fn(async () => ({
          ...MODEL_INDEX,
          effects: [],
        })),
      }),
      verify: emptyVerify as never,
    },
  );
  expect(emptyVerify).not.toHaveBeenCalled();
  expect(empty.verdict).toBeNull();
});

// ---------------------------------------------------------------------------
// PLAN — dialect_affected flag splits the endpoint out
// ---------------------------------------------------------------------------

test('PLAN: dialect-affected endpoint gains the dialect_affected flag; others do not', () => {
  const row: CodeEndpointRow = {
    id: 'ep-tsql',
    name: 'GET /orders',
    interfaceId: 'if-1',
    interfaceName: 'Orders',
    interfaceType: 'REST_API',
    endpointType: 'REST',
    protocol: 'http',
    verb: 'GET',
    path: '/orders',
    direction: 'inbound',
    hasProtocolMetadata: false,
  };
  const view: CodeModelView = {
    endpoints: [row],
    baselineByEndpointId: new Map([['ep-tsql', 'baseline-1']]),
    findingIdsByEndpointId: new Map(),
    dialectAffectedEndpointIds: new Set(['ep-tsql']),
  };
  expect(flagEndpoint(row, view, 'rest')).toEqual(['dialect_affected']);

  const cleanView: CodeModelView = { ...view, dialectAffectedEndpointIds: new Set() };
  expect(flagEndpoint(row, cleanView, 'rest')).toEqual([]);
});

// ---------------------------------------------------------------------------
// CARRIAGE — rewrite guidance embedded verbatim
// ---------------------------------------------------------------------------

test('CARRIAGE: spec text embeds the SQL + construct list + suggested equivalents verbatim', () => {
  const text = buildCodeSpecText({
    story: {
      workItemId: 'w-1',
      title: 'Reimplement GET /orders (dialect_affected)',
      tags: ['provenance:plan-deterministic'],
      apiEndpointIds: ['ep-tsql'],
    } as never,
    facts: {
      endpoints: [
        {
          id: 'ep-tsql',
          name: 'GET /orders',
          verb: 'GET',
          path: '/orders',
          endpointType: 'REST',
          protocol: 'http',
          interfaceName: 'Orders',
          requestContract: null,
          responseContract: null,
          protocolMetadata: null,
        },
      ],
      dataEffects: [
        {
          endpointId: 'ep-tsql',
          accessMode: 'read',
          dataEntityPointId: 'dep_phy_tab1',
          pathMetadata: {
            sql_dialect: 'tsql',
            query_text: 'SELECT TOP 5 getdate() FROM orders (NOLOCK)',
            non_portable_constructs: [
              {
                construct: 'getdate',
                matched_text: 'getdate',
                position: 13,
                suggested_equivalent: 'now()',
                note: 'T-SQL getdate() -> Postgres now() / CURRENT_TIMESTAMP',
              },
              {
                construct: 'NOLOCK',
                matched_text: 'NOLOCK',
                position: 36,
                suggested_equivalent: null,
                note: 'NOLOCK is a no-op need under Postgres MVCC — remove the hint',
              },
            ],
          },
        },
      ],
      behaviours: [],
    },
    behaviours: [],
    omissions: [],
  });

  expect(text).toContain('T-SQL dialect rewrite guidance');
  expect(text).toContain('SELECT TOP 5 getdate() FROM orders (NOLOCK)');
  expect(text).toContain('`getdate` → `now()`');
  expect(text).toContain('NO exact PostgreSQL equivalent');
  expect(text).toContain('T-SQL getdate() -> Postgres now() / CURRENT_TIMESTAMP');
});
