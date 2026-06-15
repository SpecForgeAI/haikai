/**
 * Tests for chatV2 `contextBinding` intercept in `derived-from-context` mode.
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) --
 * Task Group 6, Task 6.1.
 *
 * Test inventory (kept to <=8, focused on the task-specified properties):
 *
 *   1. Valid `interface` contextBinding -> resolveDerivedBinding called and
 *      thread.metadata is populated with {boundArchitectureId,
 *      boundArchitectureName, boundEntityType, boundEntityId}; the response
 *      carries no `bindingError` field.
 *   2. Archived-architecture contextBinding -> response carries 422 bindingError
 *      with code `archived_architecture` AND the thread metadata is NOT
 *      updated (binding refused).
 *   3. Unsupported entityType (e.g. 'service') contextBinding -> response
 *      carries 422 bindingError with code `unsupported_binding_type` AND
 *      thread metadata is NOT updated.
 *   4. Already-bound thread + new contextBinding for a different entity ->
 *      resolver is NOT called again (re-binding refused in V1) and the
 *      original boundArchitectureId is preserved.
 *   5. Already-bound thread (no new contextBinding emitted) -> Step 5h
 *      synthesises the architectureBinding from `Thread.metadata` and
 *      composeSystemPrompt is called with it (verified by inspecting the
 *      first system message of the LLM messages array, which must contain
 *      the `Architecture: <name> (id: <id>)` line).
 *
 * Mocking strategy:
 *   - Mock `derivedBindingResolver` so each test can drive the resolver
 *     outcome (success / DerivedBindingError variants) without hitting any
 *     upstream service.
 *   - Mock `architectureModelClient` (jest.requireActual spread) so
 *     `fetchProjectFolder` returns a per-test temp directory while leaving
 *     other helpers (e.g., listArchitectures) untouched. listArchitectures
 *     is not exercised in this suite (`derived-from-context` does NOT
 *     consult the URL-active architecture list), but the spread keeps the
 *     handler's other call sites working.
 *   - Mock `getLlmClient().sendChatRequest` so each test can drive the LLM
 *     reply; `architect--oas-spec` declares a strict responseFormat so the
 *     mocked content must be valid JSON to surface a `structuredResponse`
 *     for the Step 9c intercept to inspect.
 */

import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';

// ---- Set up config mock ----
const realConfigDir = path.resolve(__dirname, '..', 'config');
let testTmpDir: string;

jest.mock('../config', () => ({
  getConfig: () => ({
    registryBasePath: realConfigDir,
    threadPersistBasePath: testTmpDir,
    openaiApiKey: 'test-key',
    openaiModel: 'gpt-4o',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiTimeoutMs: 120000,
    logLevel: 'error',
    port: 8081,
    rateLimitRpm: 1000,
    rateLimitBurst: 100,
    allowedOrigins: ['http://localhost:5173'],
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

// ---- Mock architectureModelClient (jest.requireActual spread) ----
jest.mock('../services/architectureModelClient', () => {
  const actual = jest.requireActual('../services/architectureModelClient');
  return {
    ...actual,
    fetchProjectFolder: jest.fn(async () => testTmpDir),
  };
});

// ---- Mock logger ----
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ---- Mock derivedBindingResolver so tests can drive outcomes ----
const mockResolveDerivedBinding = jest.fn();
jest.mock('../services/derivedBindingResolver', () => {
  // Re-export the real DerivedBindingError class so the route's
  // `instanceof DerivedBindingError` branch still triggers when our mock
  // throws an instance of it.
  const actual = jest.requireActual('../services/derivedBindingResolver');
  return {
    ...actual,
    resolve: (...args: unknown[]) => mockResolveDerivedBinding(...args),
  };
});

// ---- Mock getLlmClient ----
const mockSendChatRequest = jest.fn();
jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({
    sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
  }),
}));

// ---- Imports (after mocks) ----
import express from 'express';
import request from 'supertest';
import { initializeRegistries } from '../services/registryLoader';
import { chatV2Router } from '../routes/chatV2';
import { DerivedBindingError } from '../services/derivedBindingResolver';
import { Thread } from '../types/chatV2';

function createTestApp(): express.Application {
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, _res, next) => {
    req.requestId = 'derived-binding-intercept-test-request-id';
    next();
  });
  app.use('/api/chat/v2', chatV2Router);
  return app;
}

/**
 * Build a valid LLM response for `architect--oas-spec` (whose responseFormat
 * requires phase, section, questions, summary). Optionally embed a
 * `contextBinding` block so the Step 9c intercept can pick it up.
 */
function buildOasSpecLlmResponse(
  contextBinding?: { entityType: string; entityId: string }
): string {
  return JSON.stringify({
    phase: 'questions',
    section: 'interface_selection',
    questions: ['Which interface should we spec?'],
    summary: 'Asking the user to confirm the interface.',
    ...(contextBinding ? { contextBinding } : {}),
  });
}

/**
 * Read the persisted thread JSON for a given threadKey from disk so tests
 * can assert what the chatV2 handler stored on `Thread.metadata`.
 */
async function readPanelThread(
  projectId: string,
  screen: string,
  entityId?: string
): Promise<Thread> {
  // Panel threads live at {tmp}/threads/panel/{screen}[/{entityId}]/thread.json
  // (project memory: projectId is NOT in the path).
  const segments = entityId ? [screen, entityId] : [screen];
  const filePath = path.join(testTmpDir, 'threads', 'panel', ...segments, 'thread.json');
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as Thread;
}

describe('ChatV2 derived-from-context contextBinding intercept (Spec #5 Group 6)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-derived-binding-intercept-'));
    await initializeRegistries();
    app = createTestApp();
  });

  afterAll(async () => {
    try {
      await fs.rm(testTmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    mockSendChatRequest.mockReset();
    mockResolveDerivedBinding.mockReset();
    // Project memory: projectId is NOT in the thread path, so all threads
    // of the same scope (panel/oas-spec/...) share storage. Wipe between
    // tests to prevent cross-test contamination.
    try {
      await fs.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory doesn't exist
    }
  });

  // Helper: build a valid `architect--oas-spec` ChatV2Request body.
  function oasSpecRequest(overrides: Record<string, unknown> = {}) {
    return {
      threadKey: {
        type: 'panel' as const,
        projectId: 'proj-derived-binding',
        screen: 'oas-spec',
        entityId: 'oas-1',
      },
      personaId: 'architect',
      taskId: 'architect--oas-spec',
      message: 'I want to spec the orders interface.',
      ...overrides,
    };
  }

  // ==========================================================================
  // Test 1: valid interface contextBinding -> resolver called + metadata updated
  // ==========================================================================
  it('persists boundArchitectureId/Name/EntityType/EntityId on Thread.metadata when the resolver succeeds', async () => {
    mockResolveDerivedBinding.mockResolvedValueOnce({
      architectureId: 'arch-uuid-target',
      architectureName: 'Target State',
      archived: false,
    });

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-1',
      content: buildOasSpecLlmResponse({
        entityType: 'interface',
        entityId: 'iface-uuid-orders',
      }),
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send(oasSpecRequest())
      .expect(200);

    // Resolver was called exactly once with the project + entity from the block.
    expect(mockResolveDerivedBinding).toHaveBeenCalledTimes(1);
    expect(mockResolveDerivedBinding).toHaveBeenCalledWith(
      'proj-derived-binding',
      'interface',
      'iface-uuid-orders'
    );

    // Response payload: no bindingError on success.
    expect(res.body.bindingError).toBeUndefined();

    // Thread.metadata persisted with the binding sub-shape.
    const thread = await readPanelThread('proj-derived-binding', 'oas-spec', 'oas-1');
    expect(thread.metadata).toBeDefined();
    expect(thread.metadata!.boundArchitectureId).toBe('arch-uuid-target');
    expect(thread.metadata!.boundArchitectureName).toBe('Target State');
    expect(thread.metadata!.boundEntityType).toBe('interface');
    expect(thread.metadata!.boundEntityId).toBe('iface-uuid-orders');
  });

  // ==========================================================================
  // Test 2: archived-architecture contextBinding -> 422 surfaced + metadata NOT updated
  // ==========================================================================
  it('surfaces a 422 bindingError with code "archived_architecture" and does NOT update Thread.metadata when the resolver refuses', async () => {
    mockResolveDerivedBinding.mockRejectedValueOnce(
      new DerivedBindingError(
        'archived_architecture',
        'Cannot bind to archived architecture: Legacy State'
      )
    );

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-2',
      content: buildOasSpecLlmResponse({
        entityType: 'interface',
        entityId: 'iface-uuid-archived',
      }),
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send(oasSpecRequest())
      .expect(200);

    // Resolver was called.
    expect(mockResolveDerivedBinding).toHaveBeenCalledTimes(1);

    // Response carries the 422 bindingError shape (HTTP 200 because the
    // chat turn itself succeeded; only the binding side effect failed).
    expect(res.body.bindingError).toBeDefined();
    expect(res.body.bindingError.status).toBe(422);
    expect(res.body.bindingError.code).toBe('archived_architecture');
    expect(res.body.bindingError.message).toContain('Cannot bind to archived architecture');

    // Thread.metadata was NOT populated with binding fields.
    const thread = await readPanelThread('proj-derived-binding', 'oas-spec', 'oas-1');
    expect(thread.metadata?.boundArchitectureId).toBeUndefined();
    expect(thread.metadata?.boundArchitectureName).toBeUndefined();
    expect(thread.metadata?.boundEntityType).toBeUndefined();
    expect(thread.metadata?.boundEntityId).toBeUndefined();
  });

  // ==========================================================================
  // Test 3: unsupported entityType contextBinding -> 422 surfaced + metadata NOT updated
  // ==========================================================================
  it('surfaces a 422 bindingError with code "unsupported_binding_type" for non-interface entityTypes and does NOT update Thread.metadata', async () => {
    mockResolveDerivedBinding.mockRejectedValueOnce(
      new DerivedBindingError(
        'unsupported_binding_type',
        "derived-from-context V1 only supports entityType 'interface' (received 'service')"
      )
    );

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-3',
      content: buildOasSpecLlmResponse({
        entityType: 'service',
        entityId: 'svc-uuid-payments',
      }),
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send(oasSpecRequest())
      .expect(200);

    expect(mockResolveDerivedBinding).toHaveBeenCalledTimes(1);

    expect(res.body.bindingError).toBeDefined();
    expect(res.body.bindingError.status).toBe(422);
    expect(res.body.bindingError.code).toBe('unsupported_binding_type');
    expect(res.body.bindingError.message).toContain("only supports entityType 'interface'");

    const thread = await readPanelThread('proj-derived-binding', 'oas-spec', 'oas-1');
    expect(thread.metadata?.boundArchitectureId).toBeUndefined();
  });

  // ==========================================================================
  // Test 4: re-binding NOT allowed in V1 -- second contextBinding ignored
  // ==========================================================================
  it('does NOT call the resolver again when the thread is already bound and the LLM emits a new contextBinding (re-binding refused in V1)', async () => {
    // ----- First turn: bind to interface A. -----
    mockResolveDerivedBinding.mockResolvedValueOnce({
      architectureId: 'arch-A',
      architectureName: 'Architecture A',
      archived: false,
    });
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-4a',
      content: buildOasSpecLlmResponse({
        entityType: 'interface',
        entityId: 'iface-A',
      }),
      isFinal: true,
    });
    await request(app)
      .post('/api/chat/v2')
      .send(oasSpecRequest({ message: 'Bind to A first.' }))
      .expect(200);

    expect(mockResolveDerivedBinding).toHaveBeenCalledTimes(1);

    // ----- Second turn: LLM emits a NEW contextBinding for interface B. -----
    // The handler must IGNORE it -- resolver must NOT be called again.
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-4b',
      content: buildOasSpecLlmResponse({
        entityType: 'interface',
        entityId: 'iface-B',
      }),
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send(oasSpecRequest({ message: 'Now switch to B.' }))
      .expect(200);

    // Resolver was NOT called a second time.
    expect(mockResolveDerivedBinding).toHaveBeenCalledTimes(1);

    // No bindingError surfaced (silent ignore).
    expect(res.body.bindingError).toBeUndefined();

    // Original binding preserved on Thread.metadata.
    const thread = await readPanelThread('proj-derived-binding', 'oas-spec', 'oas-1');
    expect(thread.metadata!.boundArchitectureId).toBe('arch-A');
    expect(thread.metadata!.boundArchitectureName).toBe('Architecture A');
    expect(thread.metadata!.boundEntityType).toBe('interface');
    expect(thread.metadata!.boundEntityId).toBe('iface-A');
  });

  // ==========================================================================
  // Test 5: follow-up turn for already-bound thread synthesises architectureBinding
  //          from Thread.metadata and composeSystemPrompt injects the line.
  // ==========================================================================
  it('synthesises the architectureBinding from Thread.metadata on follow-up turns and the system prompt contains the Architecture line', async () => {
    // ----- First turn: bind. -----
    mockResolveDerivedBinding.mockResolvedValueOnce({
      architectureId: 'arch-uuid-bound',
      architectureName: 'Bound Architecture',
      archived: false,
    });
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-5a',
      content: buildOasSpecLlmResponse({
        entityType: 'interface',
        entityId: 'iface-uuid-bound',
      }),
      isFinal: true,
    });
    await request(app)
      .post('/api/chat/v2')
      .send(oasSpecRequest({ message: 'Initial bind.' }))
      .expect(200);

    // ----- Second turn: NO contextBinding emitted. Step 5h must synthesise
    //                    the architectureBinding from thread.metadata so that
    //                    composeSystemPrompt injects the Architecture line. -----
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-5b',
      content: buildOasSpecLlmResponse(),
      isFinal: true,
    });

    await request(app)
      .post('/api/chat/v2')
      .send(oasSpecRequest({ message: 'Continue spec work.' }))
      .expect(200);

    // Inspect the messages array sent to the LLM on the SECOND call.
    expect(mockSendChatRequest).toHaveBeenCalledTimes(2);
    const secondCallMessages = mockSendChatRequest.mock.calls[1][0] as Array<{
      role: string;
      content: string;
    }>;
    const systemMessage = secondCallMessages.find(m => m.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toContain(
      'Architecture: Bound Architecture (id: arch-uuid-bound)'
    );

    // Resolver was only called on the first turn (no re-bind on turn 2).
    expect(mockResolveDerivedBinding).toHaveBeenCalledTimes(1);
  });
});
