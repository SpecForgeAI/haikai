/**
 * Tests for the gateway derived-binding resolver and the
 * lookupInterfaceArchitecture client helper.
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) --
 * Task Group 2, Task 2.1.
 *
 * Test inventory (kept to <=8, focused on the task-specified properties):
 *
 *   1. lookupInterfaceArchitecture happy path -- hits
 *      `GET /api/projects/{projectId}/interfaces/{interfaceId}/architecture-binding`
 *      and parses the {architectureId, architectureName, archived} payload.
 *   2. lookupInterfaceArchitecture 404 -- throws
 *      InterfaceArchitectureLookupError with status === 404 so callers can
 *      branch on "interface not found".
 *   3. derivedBindingResolver.resolve happy path -- entityType: 'interface'
 *      returns the architecture binding from the lookup helper.
 *   4. derivedBindingResolver.resolve 'unsupported_binding_type' -- any
 *      entityType other than 'interface' throws DerivedBindingError with
 *      code `'unsupported_binding_type'` (V1 is interfaces-only).
 *   5. derivedBindingResolver.resolve 'archived_architecture' -- when the
 *      resolved interface lives in an archived architecture, throws
 *      DerivedBindingError with code `'archived_architecture'` and the
 *      architecture name in the message.
 *
 * Mocking strategy:
 *   - Tests #1-2 mock global fetch directly (client-helper boundary).
 *   - Tests #3-5 mock `architectureModelClient` with `jest.requireActual`
 *     spread so unmocked exports keep working (per project memory).
 */

// ---- Mock the gateway config so the tests don't depend on env vars ----
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

// ---- Mock the logger to suppress output during tests ----
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ---- Mock global fetch for client-helper tests ----
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  jest.resetModules();
});

// ============================================================================
// Tests #1-2: lookupInterfaceArchitecture (client-helper boundary)
// ============================================================================

describe('lookupInterfaceArchitecture (Spec #5 Group 2)', () => {
  test('hits the project-scoped binding endpoint and parses the response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        architectureId: 'arch-uuid-123',
        architectureName: 'Target State',
        archived: false,
      }),
    });

    const { lookupInterfaceArchitecture } = await import(
      '../services/architectureModelClient'
    );

    const result = await lookupInterfaceArchitecture(
      'proj-abc',
      'iface-xyz'
    );

    // URL shape -- project-scoped, no architectureId path segment (the
    // caller doesn't yet know it; the lookup is what resolves it).
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      'http://localhost:8080/api/projects/proj-abc/interfaces/iface-xyz/architecture-binding'
    );
    // GET method.
    const options = mockFetch.mock.calls[0][1] as RequestInit;
    expect(options.method).toBe('GET');

    // Response parsing -- shape matches InterfaceArchitectureBindingResponse.
    expect(result).toEqual({
      architectureId: 'arch-uuid-123',
      architectureName: 'Target State',
      archived: false,
    });
  });

  test('throws InterfaceArchitectureLookupError with status 404 when interface is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => 'application/json' },
      json: async () => ({ error: 'interface not found' }),
    });

    const {
      lookupInterfaceArchitecture,
      InterfaceArchitectureLookupError,
    } = await import('../services/architectureModelClient');

    await expect(
      lookupInterfaceArchitecture('proj-abc', 'iface-missing')
    ).rejects.toBeInstanceOf(InterfaceArchitectureLookupError);

    // Re-run the call (each test has its own setup) and assert the status
    // field on the thrown error.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => 'application/json' },
      json: async () => ({ error: 'interface not found' }),
    });
    try {
      await lookupInterfaceArchitecture('proj-abc', 'iface-missing');
      throw new Error('expected lookup to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InterfaceArchitectureLookupError);
      expect((err as InstanceType<typeof InterfaceArchitectureLookupError>).status).toBe(404);
    }
  });
});

// ============================================================================
// Tests #3-5: derivedBindingResolver.resolve (resolver boundary)
//
// We mock architectureModelClient with jest.requireActual spread so unmocked
// exports (e.g. InterfaceArchitectureLookupError class) keep working at
// runtime even when the module is partially mocked.
// ============================================================================

describe('derivedBindingResolver.resolve (Spec #5 Group 2)', () => {
  test('happy path: entityType "interface" returns the architecture binding', async () => {
    jest.doMock('../services/architectureModelClient', () => {
      const actual = jest.requireActual('../services/architectureModelClient');
      return {
        ...actual,
        lookupInterfaceArchitecture: jest.fn(async () => ({
          architectureId: 'arch-uuid-happy',
          architectureName: 'Target State',
          archived: false,
        })),
      };
    });

    const { resolve } = await import('../services/derivedBindingResolver');

    const result = await resolve('proj-abc', 'interface', 'iface-xyz');

    expect(result).toEqual({
      architectureId: 'arch-uuid-happy',
      architectureName: 'Target State',
      archived: false,
    });

    // The lookup helper should have been called with (projectId, entityId).
    const { lookupInterfaceArchitecture } = await import(
      '../services/architectureModelClient'
    );
    expect(lookupInterfaceArchitecture).toHaveBeenCalledWith(
      'proj-abc',
      'iface-xyz'
    );
  });

  test('returns code "unsupported_binding_type" for non-interface entityType (e.g. "service")', async () => {
    // No need to mock the client -- resolve() rejects before the lookup
    // helper is reached for unsupported types. We still spread requireActual
    // so the import resolves cleanly.
    jest.doMock('../services/architectureModelClient', () => {
      const actual = jest.requireActual('../services/architectureModelClient');
      return {
        ...actual,
        lookupInterfaceArchitecture: jest.fn(async () => {
          throw new Error('lookup should not be called for unsupported type');
        }),
      };
    });

    const { resolve, DerivedBindingError } = await import(
      '../services/derivedBindingResolver'
    );

    let caught: unknown;
    try {
      await resolve('proj-abc', 'service', 'svc-uuid-1');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DerivedBindingError);
    expect((caught as InstanceType<typeof DerivedBindingError>).code).toBe(
      'unsupported_binding_type'
    );

    // The lookup helper must NOT have been called for unsupported types.
    const { lookupInterfaceArchitecture } = await import(
      '../services/architectureModelClient'
    );
    expect(lookupInterfaceArchitecture).not.toHaveBeenCalled();
  });

  test('returns code "archived_architecture" when the interface\'s architecture is archived', async () => {
    jest.doMock('../services/architectureModelClient', () => {
      const actual = jest.requireActual('../services/architectureModelClient');
      return {
        ...actual,
        lookupInterfaceArchitecture: jest.fn(async () => ({
          architectureId: 'arch-uuid-archived',
          architectureName: 'Old State (archived)',
          archived: true,
        })),
      };
    });

    const { resolve, DerivedBindingError } = await import(
      '../services/derivedBindingResolver'
    );

    let caught: unknown;
    try {
      await resolve('proj-abc', 'interface', 'iface-in-archived-arch');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DerivedBindingError);
    const typedError = caught as InstanceType<typeof DerivedBindingError>;
    expect(typedError.code).toBe('archived_architecture');
    // Message must identify the architecture by name so the LLM (and
    // ultimately the user) can act on it.
    expect(typedError.message).toContain('Old State (archived)');
  });
});

// Make this file a module so top-level declarations (mockFetch) do not
// collide with other global-script test files (TS2451).
export {};
