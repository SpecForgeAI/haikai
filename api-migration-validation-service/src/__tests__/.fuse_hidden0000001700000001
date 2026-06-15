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
  it('falls back to a single happy_path when no context', () => {
    expect(defaultScenarioSet(makeOp('GET', '/owners'))).toEqual([
      { name: 'happy_path', type: 'happy_path' },
    ]);
  });

  it('falls back to a single happy_path when no seed set matches', () => {
    const ctx = makeContext({ scenarioSeeds: [] });
    expect(defaultScenarioSet(makeOp('GET', '/owners'), ctx)).toEqual([
      { name: 'happy_path', type: 'happy_path' },
    ]);
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
      { name: 'happy_path', type: 'happy_path' },
      { name: 'error_404', type: 'error' },
      { name: 'auth_missing_token', type: 'auth_variant' },
    ]);
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
