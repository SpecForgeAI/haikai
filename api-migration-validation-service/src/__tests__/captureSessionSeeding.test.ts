import {
  defaultScenarioSet,
  buildScenarioPrompt,
  operationSeedKey,
  seedsForOperation,
} from '../services/captureSessionOrchestrator';
import type { CaptureSession } from '../types/captureSession';
import type {
  OperationDto,
  MigrationDiscoveryContextDto,
} from '../services/archModelClient';
import type { ParsedOasInventory } from '../types/oas';
import { persistInventory } from '../routes/captureSessionActions';

function makeClient() {
  return {
    createOperation: jest.fn(async (_projectId: string, body: unknown) => ({
      id: 'written',
      ...(body as Record<string, unknown>),
    })),
  };
}

function makeSession(overrides: Record<string, unknown> = {}): CaptureSession {
  return {
    id: 'sess-1',
    projectId: 'proj-1',
    architectureId: 'arch-1',
    apiBaseUrl: 'http://localhost:8080',
    envName: 'test',
    status: 'active',
    mutating_calls_confirmed: false,
    ...overrides,
  } as unknown as CaptureSession;
}

function makeOp(method: string, path: string): OperationDto {
  return {
    id: `op-${method}-${path}`,
    operation_id: `${method} ${path}`,
    method,
    path,
    included: true,
  } as unknown as OperationDto;
}

function makeContext(
  overrides: Partial<MigrationDiscoveryContextDto> = {},
): MigrationDiscoveryContextDto {
  return {
    projectId: 'proj-1',
    currentArchitectureId: 'arch-1',
    generatedAt: '2026-05-30T00:00:00Z',
    ...overrides,
  } as MigrationDiscoveryContextDto;
}

describe('operationSeedKey', () => {
  it('builds "<METHOD> <path>" with upper-cased, trimmed parts', () => {
    expect(operationSeedKey('get', '/owners')).toBe('GET /owners');
    expect(operationSeedKey('  post ', ' /owners/{id} ')).toBe('POST /owners/{id}');
    expect(operationSeedKey(undefined, undefined)).toBe(' ');
  });
});

describe('seedsForOperation', () => {
  const ctx = makeContext({
    scenarioSeeds: [
      {
        operationKey: 'GET /owners',
        method: 'GET',
        path: '/owners',
        safeToExecute: true,
        seeds: [{ scenarioType: 'happy_path', scenarioName: 'happy_path' }],
      },
    ],
  });

  it('finds a matching seed set by operation key', () => {
    expect(seedsForOperation(ctx, 'GET', '/owners')?.operationKey).toBe('GET /owners');
  });

  it('returns undefined with no context or no match', () => {
    expect(seedsForOperation(undefined, 'GET', '/owners')).toBeUndefined();
    expect(seedsForOperation(ctx, 'POST', '/owners')).toBeUndefined();
  });
});

describe('defaultScenarioSet', () => {
  it('param-less endpoint (no params/body) yields a single happy_path', () => {
    const result = defaultScenarioSet(makeOp('GET', '/owners'));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: 'happy_path',
      type: 'happy_path',
      expectedStatus: 'success',
    });
  });

  it('param-less endpoint with an empty seed set still yields a single happy_path', () => {
    const ctx = makeContext({ scenarioSeeds: [] });
    const result = defaultScenarioSet(makeOp('GET', '/owners'), ctx);
    expect(result.map((s) => s.name)).toEqual(['happy_path']);
  });

  it('simple GET /{id} reaches a floor of 5 (happy + 404 + two 400s + boundary)', () => {
    const oasOp = {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    };
    const result = defaultScenarioSet(makeOp('GET', '/things/{id}'), undefined, oasOp);
    const names = result.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'happy_path',
        'not_found_id',
        'bad_request_id',
        'bad_request_id_type',
        'edge_id',
      ]),
    );
    expect(result.length).toBeGreaterThanOrEqual(5);
    // Two distinct intended 400s (format + wrong-type) on the id param.
    const clientErrors = result.filter((s) => s.expectedStatus === 'client_error').map((s) => s.name);
    expect(clientErrors).toEqual(expect.arrayContaining(['bad_request_id', 'bad_request_id_type']));
  });

  it('body-bearing endpoint with no params gets a malformed-body 400 (floor of 2)', () => {
    const oasOp = {
      requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
    };
    const result = defaultScenarioSet(makeOp('POST', '/things'), undefined, oasOp);
    const names = result.map((s) => s.name);
    expect(names).toContain('happy_path');
    expect(names).toContain('bad_request_body');
    expect(result.find((s) => s.name === 'bad_request_body')?.expectedStatus).toBe('client_error');
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('expands to one scenario per seed when a seed set matches', () => {
    const ctx = makeContext({
      scenarioSeeds: [
        {
          operationKey: 'POST /owners',
          method: 'POST',
          path: '/owners',
          safeToExecute: false,
          seeds: [
            { scenarioType: 'happy_path', scenarioName: 'happy_path' },
            { scenarioType: 'error', scenarioName: 'error_404' },
            { scenarioType: 'auth_variant', scenarioName: 'auth_missing_token' },
          ],
        },
      ],
    });
    expect(defaultScenarioSet(makeOp('POST', '/owners'), ctx)).toEqual([
      { name: 'happy_path', type: 'happy_path', expectedStatus: 'success' },
      { name: 'error_404', type: 'error', expectedStatus: 'not_found' },
      { name: 'auth_missing_token', type: 'auth_variant', expectedStatus: 'client_error' },
    ]);
  });

  it('scales coverage to the parameter space (path id, enum values, negatives)', () => {
    const oasOp = {
      parameters: [
        { name: 'id', in: 'path', required: true },
        { name: 'status', in: 'query', schema: { enum: ['ACTIVE', 'CLOSED'] } },
      ],
    };
    const result = defaultScenarioSet(makeOp('GET', '/things/{id}'), undefined, oasOp);
    const names = result.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'happy_path',
        'not_found_id',
        'enum_status_ACTIVE',
        'enum_status_CLOSED',
        'bad_request_id',
      ]),
    );
    // Expected-outcome intents drive Phase-2 canonical capture.
    expect(result.find((s) => s.name === 'not_found_id')?.expectedStatus).toBe('not_found');
    expect(result.find((s) => s.name === 'enum_status_ACTIVE')?.expectedStatus).toBe('success');
    expect(result.find((s) => s.name === 'bad_request_id')?.expectedStatus).toBe('client_error');
  });
});

describe('buildScenarioPrompt with scenarioSeed', () => {
  it('includes a scenarioSeed block with guidance when a seed is passed', () => {
    const messages = buildScenarioPrompt(
      makeSession(),
      'GET /owners',
      'happy_path',
      'GET',
      '/owners',
      undefined,
      {
        scenarioType: 'happy_path',
        scenarioName: 'happy_path',
        exampleRequest: { body: { name: 'x' } },
        preconditions: ['an Owner row must exist'],
        expectedStatus: 200,
        safeToExecute: true,
        provenance: 'access_mode',
      },
    );
    const userMsg = messages.find((m) => m.role === 'user');
    const payload = JSON.parse(userMsg!.content as string) as Record<string, unknown>;
    const seed = payload.scenarioSeed as Record<string, unknown>;
    expect(seed).toBeDefined();
    expect(seed.scenarioName).toBe('happy_path');
    expect(seed.expectedStatus).toBe(200);
    expect(typeof seed.guidance).toBe('string');
    expect(seed.guidance as string).toMatch(/REFINE/);
  });

  it('omits scenarioSeed when none passed', () => {
    const messages = buildScenarioPrompt(makeSession(), 'GET /owners', 'happy_path', 'GET', '/owners');
    const userMsg = messages.find((m) => m.role === 'user');
    const payload = JSON.parse(userMsg!.content as string) as Record<string, unknown>;
    expect(payload.scenarioSeed).toBeUndefined();
  });

  // Kiro #3: the MANDATORY instructions must tell the LLM that a path template
  // can have MULTIPLE segments and that EACH must be filled -- guarding against
  // collapsing e.g. /hierarchynodes/{cobDate}/{orgId} into a single /{id}.
  it('instructions warn about multi-segment path templates and filling each segment', () => {
    const messages = buildScenarioPrompt(makeSession(), 'GET /owners', 'happy_path', 'GET', '/owners');
    const userMsg = messages.find((m) => m.role === 'user');
    const payload = JSON.parse(userMsg!.content as string) as Record<string, unknown>;
    const instructions = payload.instructions as string;
    expect(typeof instructions).toBe('string');
    // Mentions multi-segment path templates explicitly.
    expect(instructions).toMatch(/MULTIPLE segments/);
    expect(instructions).toMatch(/path template/i);
    // Tells the LLM to fill EACH segment and never collapse to one id.
    expect(instructions).toMatch(/EACH segment/);
    expect(instructions).toMatch(/never collapse/i);
    expect(instructions).toMatch(/single id/i);
  });
});

describe('persistInventory safe_to_execute from seeds', () => {
  function inventoryFor(method: string, path: string): ParsedOasInventory {
    return {
      operations: [
        {
          operationId: `${method} ${path}`,
          method,
          path,
          summary: null,
          description: null,
          requestSchema: null,
          responseSchema: null,
          oasOperation: null,
        },
      ],
      title: null,
      version: null,
    } as unknown as ParsedOasInventory;
  }

  it('uses the seed-set safeToExecute (false) over the verb heuristic', async () => {
    const client = makeClient();
    const ctx = makeContext({
      scenarioSeeds: [
        {
          operationKey: 'POST /owners',
          method: 'POST',
          path: '/owners',
          safeToExecute: false,
          seeds: [{ scenarioType: 'happy_path', scenarioName: 'happy_path' }],
        },
      ],
    });
    await persistInventory(client as never, 'proj-1', makeSession() as never, inventoryFor('post', '/owners'), ctx);
    const body = client.createOperation.mock.calls[0][1] as Record<string, unknown>;
    expect(body.safe_to_execute).toBe(false);
    expect(body.included).toBe(false);
  });

  it('falls back to verb heuristic (GET -> safe) when no seed set', async () => {
    const client = makeClient();
    await persistInventory(client as never, 'proj-1', makeSession() as never, inventoryFor('get', '/owners'), undefined);
    const body = client.createOperation.mock.calls[0][1] as Record<string, unknown>;
    expect(body.safe_to_execute).toBe(true);
  });

  it('falls back to verb heuristic (POST -> unsafe) when no seed set', async () => {
    const client = makeClient();
    await persistInventory(client as never, 'proj-1', makeSession() as never, inventoryFor('post', '/owners'), undefined);
    const body = client.createOperation.mock.calls[0][1] as Record<string, unknown>;
    expect(body.safe_to_execute).toBe(false);
  });
});
