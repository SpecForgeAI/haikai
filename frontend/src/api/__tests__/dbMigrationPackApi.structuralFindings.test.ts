/**
 * dbMigrationPackApi — structural findings client (Spec 2026-08-04-2) +
 * migrationDeliveryPlanApi 409 structural_findings_open parsing.
 *
 * Pins the wire behaviours the components rely on:
 *   (a) the colon-bearing finding key (`no_primary_keys:all_tables`) is ALWAYS
 *       URL-encoded in the disposition path, for PUT and DELETE alike;
 *   (b) the PUT body carries disposition + note + kind + subject (snake-free
 *       field names — the AMS create path needs kind/subject);
 *   (c) DELETE tolerates the AMS 204 No Content answer (no JSON parse);
 *   (d) the plan-generate 409 `structural_findings_open` envelope becomes a
 *       typed StructuralFindingsOpenError whose message carries the finding
 *       list + the Schema-migration-tab wayfinding hint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clearDbMigrationPackStructuralFindingDisposition,
  listDbMigrationPackStructuralFindings,
  setDbMigrationPackStructuralFindingDisposition,
} from '../dbMigrationPackApi';
import {
  generateMigrationDeliveryPlan,
  StructuralFindingsOpenError,
} from '../migrationDeliveryPlanApi';

const PROJECT_ID = 'proj-1';
const PACK_ID = 'pack-1';
const FINDING = {
  key: 'no_primary_keys:all_tables',
  kind: 'no_primary_keys',
  subject: 'all_tables',
};
const ENCODED_KEY = 'no_primary_keys%3Aall_tables';

function stubFetch(response: {
  ok: boolean;
  status: number;
  statusText?: string;
  json?: unknown;
}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    statusText: response.statusText ?? '',
    json: async () => {
      if (response.json === undefined) throw new Error('no body');
      return response.json;
    },
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('structural findings client — key encoding + bodies', () => {
  it('GET hits the pack-scoped structural-findings route', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, json: { findings: [] } });
    await listDbMigrationPackStructuralFindings(PROJECT_ID, PACK_ID);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(
      `/api/v1/projects/${PROJECT_ID}/db-migration-packs/${PACK_ID}/structural-findings`,
    );
  });

  it('PUT URL-encodes the colon-bearing finding key and sends disposition + note + kind + subject', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: { finding_key: FINDING.key, disposition: 'accepted' },
    });

    await setDbMigrationPackStructuralFindingDisposition(
      PROJECT_ID,
      PACK_ID,
      FINDING,
      'accepted',
      'Verified against the source DDL.',
    );

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain(`/structural-findings/${ENCODED_KEY}/disposition`);
    expect(url).not.toContain(`/structural-findings/${FINDING.key}/`);
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body as string)).toEqual({
      disposition: 'accepted',
      note: 'Verified against the source DDL.',
      kind: 'no_primary_keys',
      subject: 'all_tables',
    });
  });

  it('PUT omits the note field entirely for fix_upstream (no note required)', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: { finding_key: FINDING.key, disposition: 'fix_upstream' },
    });
    await setDbMigrationPackStructuralFindingDisposition(
      PROJECT_ID,
      PACK_ID,
      FINDING,
      'fix_upstream',
    );
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.disposition).toBe('fix_upstream');
    expect('note' in body).toBe(false);
  });

  it('DELETE URL-encodes the key and tolerates 204 No Content', async () => {
    const fetchMock = stubFetch({ ok: true, status: 204 });
    await expect(
      clearDbMigrationPackStructuralFindingDisposition(
        PROJECT_ID,
        PACK_ID,
        FINDING.key,
      ),
    ).resolves.toBeUndefined();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain(`/structural-findings/${ENCODED_KEY}/disposition`);
    expect(options.method).toBe('DELETE');
  });

  it('PUT surfaces the AMS 400 {error} message (missing note for accepted)', async () => {
    stubFetch({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: { error: "disposition 'accepted' requires a non-empty note" },
    });
    await expect(
      setDbMigrationPackStructuralFindingDisposition(
        PROJECT_ID,
        PACK_ID,
        FINDING,
        'accepted',
      ),
    ).rejects.toThrow("disposition 'accepted' requires a non-empty note");
  });
});

describe('generateMigrationDeliveryPlan — 409 structural_findings_open', () => {
  const REQUEST = {
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-cur',
    targetArchitectureId: 'arch-tgt',
    wizardAnswers: {
      migrationIntent: ['like_for_like_replacement'],
      deliveryStreams: ['target_service_api_implementation'],
      migrationStyle: 'big_bang',
      dataAndCutoverAssumptions: {
        dataMigrationApproach: 'one_time_bulk',
        cutoverApproach: 'big_bang',
        rollbackRequired: false,
      },
      migrationTestPackExpectations: ['use_recommended_coverage'],
    },
  } as unknown as Parameters<typeof generateMigrationDeliveryPlan>[0];

  it('throws the typed error carrying the findings + the Schema migration tab hint', async () => {
    stubFetch({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: {
        error: {
          code: 409,
          reason: 'structural_findings_open',
          message:
            '2 structural finding(s) undispositioned or awaiting upstream fix',
          findings: [
            {
              key: 'no_primary_keys:all_tables',
              message: 'No primary keys captured.',
              disposition: null,
            },
            {
              key: 'no_indexes:all_tables',
              message: 'No indexes captured.',
              disposition: 'fix_upstream',
            },
          ],
        },
      },
    });

    const error = await generateMigrationDeliveryPlan(REQUEST).catch((e) => e);
    expect(error).toBeInstanceOf(StructuralFindingsOpenError);
    expect((error as StructuralFindingsOpenError).findings).toHaveLength(2);
    expect((error as Error).message).toContain('No primary keys captured.');
    expect((error as Error).message).toContain(
      'No indexes captured. (fix upstream pending)',
    );
    expect((error as Error).message).toContain('Schema migration tab');
  });

  it('a 409 WITHOUT the structural reason stays on the generic error path', async () => {
    stubFetch({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: { error: { code: 409, message: 'Some other conflict' } },
    });
    const error = await generateMigrationDeliveryPlan(REQUEST).catch((e) => e);
    expect(error).not.toBeInstanceOf(StructuralFindingsOpenError);
    expect((error as Error).message).toContain('Some other conflict');
  });
});
