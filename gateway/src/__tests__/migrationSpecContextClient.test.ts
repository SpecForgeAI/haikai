/**
 * Migration Spec Context client -- tests.
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 5: Gateway Focused-Context Client.
 *
 * Test inventory:
 *   1. `fetchMigrationSpecContext(...)` POSTs to
 *      `/api/projects/{projectId}/migration-spec-context` with the documented
 *      body shape; the AMS response is parsed into `MigrationSpecContextDto`
 *      with one populated block per requested context type.
 *   2. An AMS response carrying top-level `missingInputs[]` is surfaced via
 *      the DTO (not thrown as an error -- the gateway batch handler decides
 *      between `insufficient_context` and an LLM attempt).
 *   3. A 404 from AMS is surfaced as `MigrationSpecContextClientError`
 *      carrying the upstream status + body verbatim.
 *   4. A 500 from AMS is surfaced as `MigrationSpecContextClientError`
 *      carrying the upstream status + body verbatim.
 *   5. A 2xx response missing the required identity fields
 *      (projectId / bookOfWorkId / workItemId) triggers a typed error.
 */

// ---------------------------------------------------------------------------
// Mocks -- declared before importing units under test
// ---------------------------------------------------------------------------

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  fetchMigrationSpecContext,
  MigrationSpecContextClientError,
  MigrationSpecContextDto,
  FetchMigrationSpecContextInput,
} from '../services/migrationSpecContextClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (k: string) =>
        k.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => body,
    text: async () =>
      body === null || body === undefined ? '' : JSON.stringify(body),
  };
}

const SAMPLE_INPUT: FetchMigrationSpecContextInput = {
  projectId: 'proj-123',
  bookOfWorkId: 'book-456',
  bookItemId: 'book-item-789',
  workItemId: 'work-item-abc',
  currentArchitectureId: 'arch-current',
  targetArchitectureId: 'arch-target',
  contextTypes: ['service', 'api', 'data'],
  maxFindings: 50,
  maxEvidenceItems: 50,
  maxBaselineItems: 25,
};

function buildSampleDto(
  overrides: Partial<MigrationSpecContextDto> = {}
): MigrationSpecContextDto {
  return {
    projectId: SAMPLE_INPUT.projectId,
    bookOfWorkId: SAMPLE_INPUT.bookOfWorkId,
    workItemId: SAMPLE_INPUT.workItemId,
    bookItemId: SAMPLE_INPUT.bookItemId,
    currentArchitectureId: SAMPLE_INPUT.currentArchitectureId,
    targetArchitectureId: SAMPLE_INPUT.targetArchitectureId,
    generatedAt: '2026-05-19T12:00:00Z',
    service: {
      serviceId: 'svc-001',
      name: 'CustomerService',
      currentArchitectureRefs: ['app-cur-001'],
      targetArchitectureRefs: ['app-tgt-001'],
      relatedComponentIds: ['comp-001'],
    },
    api: {
      operationId: 'op-001',
      oasContractId: 'oas-001',
      behaviourBaselineIds: ['baseline-001'],
      mappingIds: ['mapping-001'],
    },
    data: {
      entityId: 'entity-001',
      schemaRefs: ['schema-001'],
      mappingIds: ['mapping-001'],
      reconciliationRefs: ['recon-001'],
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Test 1: POSTs documented body shape; parses into DTO
// ---------------------------------------------------------------------------

test('fetchMigrationSpecContext POSTs to /api/projects/{projectId}/migration-spec-context with the documented body shape and parses the DTO', async () => {
  const sampleDto = buildSampleDto();
  mockFetch.mockResolvedValueOnce(jsonResponse(200, sampleDto));

  const result = await fetchMigrationSpecContext(SAMPLE_INPUT);

  // 1.a verify URL
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0];
  expect(calledUrl).toBe(
    'http://localhost:8080/api/projects/proj-123/migration-spec-context'
  );

  // 1.b verify HTTP method + headers
  expect(calledInit.method).toBe('POST');
  expect(calledInit.headers['Content-Type']).toBe('application/json');
  expect(calledInit.headers.Accept).toBe('application/json');

  // 1.c verify request body
  const parsedBody = JSON.parse(calledInit.body);
  expect(parsedBody.bookOfWorkId).toBe(SAMPLE_INPUT.bookOfWorkId);
  expect(parsedBody.bookItemId).toBe(SAMPLE_INPUT.bookItemId);
  expect(parsedBody.workItemId).toBe(SAMPLE_INPUT.workItemId);
  expect(parsedBody.currentArchitectureId).toBe(
    SAMPLE_INPUT.currentArchitectureId
  );
  expect(parsedBody.targetArchitectureId).toBe(
    SAMPLE_INPUT.targetArchitectureId
  );
  expect(parsedBody.contextTypes).toEqual(['service', 'api', 'data']);
  expect(parsedBody.maxFindings).toBe(50);
  expect(parsedBody.maxEvidenceItems).toBe(50);
  expect(parsedBody.maxBaselineItems).toBe(25);

  // 1.d verify DTO parsed correctly with one populated block per requested type
  expect(result.projectId).toBe(SAMPLE_INPUT.projectId);
  expect(result.workItemId).toBe(SAMPLE_INPUT.workItemId);
  expect(result.bookOfWorkId).toBe(SAMPLE_INPUT.bookOfWorkId);
  expect(result.service).toBeDefined();
  expect(result.service?.serviceId).toBe('svc-001');
  expect(result.api).toBeDefined();
  expect(result.api?.operationId).toBe('op-001');
  expect(result.data).toBeDefined();
  expect(result.data?.entityId).toBe('entity-001');
});

// ---------------------------------------------------------------------------
// Test 2: missingInputs[] surfaced (NOT thrown)
// ---------------------------------------------------------------------------

test('response carrying top-level missingInputs[] is surfaced via the DTO (not thrown -- gateway decides)', async () => {
  const dtoWithBlockers = buildSampleDto({
    api: undefined,
    missingInputs: [
      {
        kind: 'mapping',
        id: 'mapping-missing-001',
        reason: 'no current-to-target mapping found for the GET /customers/{id} operation',
      },
      {
        kind: 'decision_task',
        id: 'decision-task-001',
        reason: 'unresolved SOAP namespace cutover strategy',
      },
    ],
  });
  mockFetch.mockResolvedValueOnce(jsonResponse(200, dtoWithBlockers));

  // MUST NOT throw -- gateway handler reads missingInputs[] and decides.
  const result = await fetchMigrationSpecContext(SAMPLE_INPUT);

  expect(Array.isArray(result.missingInputs)).toBe(true);
  expect(result.missingInputs).toHaveLength(2);
  expect(result.missingInputs?.[0].kind).toBe('mapping');
  expect(result.missingInputs?.[0].id).toBe('mapping-missing-001');
});

// ---------------------------------------------------------------------------
// Test 3: 404 from AMS -> MigrationSpecContextClientError
// ---------------------------------------------------------------------------

test('404 from AMS surfaces as MigrationSpecContextClientError carrying upstream status + body', async () => {
  const errorBody = {
    code: 'work_item_not_found',
    message: 'WorkItem work-item-abc does not exist in project proj-123',
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(404, errorBody));

  let caught: unknown;
  try {
    await fetchMigrationSpecContext(SAMPLE_INPUT);
    throw new Error('expected MigrationSpecContextClientError to be thrown');
  } catch (e) {
    caught = e;
  }

  expect(caught).toBeInstanceOf(MigrationSpecContextClientError);
  expect((caught as MigrationSpecContextClientError).status).toBe(404);
  expect((caught as MigrationSpecContextClientError).body).toEqual(errorBody);
});

// ---------------------------------------------------------------------------
// Test 4: 500 from AMS -> MigrationSpecContextClientError
// ---------------------------------------------------------------------------

test('500 from AMS surfaces as MigrationSpecContextClientError carrying upstream status + body', async () => {
  const errorBody = {
    code: 'internal_server_error',
    message: 'unexpected exception while assembling focused context payload',
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(500, errorBody));

  let caught: unknown;
  try {
    await fetchMigrationSpecContext(SAMPLE_INPUT);
    throw new Error('expected MigrationSpecContextClientError to be thrown');
  } catch (e) {
    caught = e;
  }

  expect(caught).toBeInstanceOf(MigrationSpecContextClientError);
  expect((caught as MigrationSpecContextClientError).status).toBe(500);
  expect((caught as MigrationSpecContextClientError).body).toEqual(errorBody);
});

// ---------------------------------------------------------------------------
// Test 5: 2xx response missing required identity fields -> typed error
// ---------------------------------------------------------------------------

test('2xx response missing required identity fields triggers a typed error', async () => {
  // Body is a JSON object but lacks projectId / bookOfWorkId / workItemId.
  const malformedBody = {
    service: { serviceId: 'svc-001' },
    api: { operationId: 'op-001' },
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, malformedBody));

  let caught: unknown;
  try {
    await fetchMigrationSpecContext(SAMPLE_INPUT);
    throw new Error('expected MigrationSpecContextClientError to be thrown');
  } catch (e) {
    caught = e;
  }

  expect(caught).toBeInstanceOf(MigrationSpecContextClientError);
  expect((caught as Error).message).toMatch(/missing required identity fields/);
});
