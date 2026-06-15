/**
 * Holistic Integration/E2E TEST Work Items (Spec 2026-06-14, Spec 2 of 4) --
 * Task Group 5: strategic END-TO-END seam coverage.
 *
 * The Group 1/2 handler tests (`holisticTestDefinitions.test.ts`) inject ALL of
 * the handler's DI seams (`loadNode` / `loadSpecRows` / `readTestStrategy` /
 * `callLlm` / `createTestItem` / `persistSpecRow` / `putImplementState`), and
 * the Group 2 route test (`migrationDeliveryDefineIntegrationTestsRoute.test.ts`)
 * mocks the whole handler. As a result the handler's PRODUCTION default seams
 * are never exercised: nothing asserts that `defaultLoadNode` parses a real
 * `book_of_work_json` DTO, nor that `defaultCreateTestItem` emits the exact AMS
 * `append-test-item` wire payload, nor that `defaultPersistSpecRow` POSTs the
 * snake_case spec row, nor that the route wires through to the REAL handler.
 *
 * This suite closes those seams by running `runHolisticTestDefinitions` (and the
 * route) with NO `deps` overrides -- the only things stubbed are:
 *   - `global.fetch` (the AMS HTTP surface), and
 *   - `getLlmClient` (`jest.mock('../services/llmClient')`), so the live-LLM
 *     guard is honoured and no real model is reached.
 * The implement-state write lands on a real OS temp directory so the on-disk
 * `implementation-state.json` contract is verified end to end.
 *
 * Each test targets a distinct uncovered end-to-end seam (the AMS append payload
 * shape `{parent_book_item_id, parent_work_item_id, title, description,
 * sequence_order} -> {work_item_id, book_item_id}` is the highest-value one).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BASE_URL = 'http://ams.test:8080';

jest.mock('../config', () => ({
  getConfig: () => ({ architectureModelServiceBaseUrl: BASE_URL }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// architectureModelClient is the default `resolveProjectFolder` seam. Mock
// fetchProjectFolder via the shared helper so it resolves the temp folder.
const mockFetchProjectFolder = jest.fn<Promise<string | null>, [string]>();
jest.mock('../services/architectureModelClient', () => {
  const { buildArchitectureModelClientMock } = jest.requireActual(
    '../testSetup/architectureModelClientMock',
  );
  return buildArchitectureModelClientMock({
    fetchProjectFolder: (...args: unknown[]) => mockFetchProjectFolder(...(args as [string])),
  });
});

// getLlmClient is required lazily inside defaultCallLlm; intercept the module so
// the live-LLM guard is honoured and the holistic plan is fully controlled.
const mockSendChatRequest = jest.fn();
jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({ sendChatRequest: mockSendChatRequest }),
}));

import { runHolisticTestDefinitions } from '../services/holisticTestDefinitionHandler';
import { SPEC_TEXT_REQUIRED_PREFIX } from '../services/specGenerationResponseValidator';
import { deriveFolderName } from '../services/transcriptWriter';
import { migrationDeliveryDashboardRouter } from '../routes/migrationDeliveryDashboard';
import express from 'express';
import request from 'supertest';

const PROJECT_ID = 'proj-e2e-1';
const BOOK_ID = 'book-e2e-1';

const originalFetch = global.fetch;
let tmpRoot: string;

// ---------------------------------------------------------------------------
// AMS HTTP test double (global.fetch). Recognises the three AMS URLs the
// default seams call: GET the book of work, GET its spec-generations, POST
// append-test-item, POST spec-generations/batch.
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

interface AmsState {
  bookOfWorkJson: { items: Array<Record<string, unknown>> };
  specGenerations: Array<Record<string, unknown>>;
  /** Sequence used to mint TEST work_item / book_item ids on append. */
  appendSeq: number;
}

function jsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function installAmsFetch(state: AmsState): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchMock = jest.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });

    const bookPath = `/migration-books-of-work/${BOOK_ID}`;

    if (method === 'GET' && url.endsWith(bookPath)) {
      return jsonResponse(200, {
        project_id: PROJECT_ID,
        book_of_work_json: state.bookOfWorkJson,
      });
    }
    if (method === 'GET' && url.endsWith(`${bookPath}/spec-generations`)) {
      return jsonResponse(200, state.specGenerations);
    }
    if (method === 'POST' && url.endsWith(`${bookPath}/items/append-test-item`)) {
      state.appendSeq += 1;
      const workItemId = `wi-test-${state.appendSeq}`;
      const bookItemId = `T${state.appendSeq}`;
      // Mirror the AMS write-back: append a stamped blob item.
      state.bookOfWorkJson.items.push({
        id: bookItemId,
        parentId: body.parent_book_item_id,
        type: 'TEST',
        title: body.title,
        sequenceOrder: body.sequence_order,
        workItemId,
      });
      return jsonResponse(200, { work_item_id: workItemId, book_item_id: bookItemId });
    }
    if (method === 'POST' && url.endsWith(`${bookPath}/spec-generations/batch`)) {
      const rows = Array.isArray(body) ? body : [];
      return jsonResponse(200, {
        persistedCount: rows.length,
        resultsCouldNotPersist: 0,
        perStoryResults: rows.map((r: Record<string, unknown>, i: number) => ({
          ...r,
          id: `spec-${i + 1}`,
        })),
      });
    }
    return jsonResponse(404, { error: `unexpected url ${method} ${url}` });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return { calls };
}

function holisticPlanResponse(
  tests: Array<{ title: string; description: string; type: string }>,
) {
  return {
    content: JSON.stringify({
      schemaVersion: '1.0',
      message: 'holistic review',
      testPlan: tests,
      openQuestions: [],
    }),
  };
}

/** A `book_of_work_json` items[] entry. */
function blobItem(over: Record<string, unknown>): Record<string, unknown> {
  return { description: null, ...over };
}

function specGenRow(workItemId: string, status: string): Record<string, unknown> {
  return {
    project_id: PROJECT_ID,
    work_item_id: workItemId,
    book_of_work_id: BOOK_ID,
    status,
    generated_spec_text: `${SPEC_TEXT_REQUIRED_PREFIX} ${workItemId}\n\nbody`,
  };
}

function appendCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((c) => c.method === 'POST' && c.url.endsWith('/items/append-test-item'));
}
function batchCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((c) => c.method === 'POST' && c.url.endsWith('/spec-generations/batch'));
}

beforeEach(() => {
  jest.clearAllMocks();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'holistic-e2e-'));
  mockFetchProjectFolder.mockResolvedValue(tmpRoot);
});

afterEach(() => {
  global.fetch = originalFetch;
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* best-effort temp cleanup */
  }
});

// ---------------------------------------------------------------------------
// Seam 1 -- FEATURE-level end-to-end through the PRODUCTION default seams.
// ---------------------------------------------------------------------------

describe('Group 5 -- FEATURE-level holistic run through real default seams', () => {
  it('parses book_of_work_json, POSTs the exact append-test-item payload, persists the spec row, and writes implement-state.json on disk', async () => {
    const state: AmsState = {
      bookOfWorkJson: {
        items: [
          blobItem({ id: 'F1', type: 'feature', title: 'Customer Onboarding', workItemId: 'wi-F1' }),
          blobItem({ id: 'S1', parentId: 'F1', type: 'story', title: 'Capture details', sequenceOrder: 1, workItemId: 'wi-S1' }),
          blobItem({ id: 'S2', parentId: 'F1', type: 'story', title: 'Verify identity', sequenceOrder: 2, workItemId: 'wi-S2' }),
        ],
      },
      specGenerations: [
        specGenRow('wi-S1', 'generated'),
        specGenRow('wi-S2', 'generated_with_warnings'),
      ],
      appendSeq: 0,
    };
    const { calls } = installAmsFetch(state);
    mockSendChatRequest.mockResolvedValueOnce(
      holisticPlanResponse([
        { title: 'Onboarding journey E2E', description: 'spans capture + verify', type: 'e2e' },
      ]),
    );

    // No deps overrides: every default seam runs for real.
    const result = await runHolisticTestDefinitions({
      projectId: PROJECT_ID,
      bookOfWorkId: BOOK_ID,
      nodeBookItemId: 'F1',
    });

    expect(result.level).toBe('feature');
    expect(result.specCompleteChildCount).toBe(2);
    expect(result.createdTestItems).toHaveLength(1);

    // --- The AMS append-test-item wire payload is the central uncovered seam. ---
    const appends = appendCalls(calls);
    expect(appends).toHaveLength(1);
    expect(appends[0].url).toBe(
      `${BASE_URL}/api/projects/${PROJECT_ID}/migration-books-of-work/${BOOK_ID}/items/append-test-item`,
    );
    expect(appends[0].body).toEqual({
      parent_book_item_id: 'F1',
      parent_work_item_id: 'wi-F1',
      title: 'Onboarding journey E2E',
      description: expect.stringContaining('spans capture + verify'),
      // max child sequenceOrder (2) + 1.
      sequence_order: 3,
    });
    // The response `{work_item_id, book_item_id}` was coerced onto the summary.
    const created = result.createdTestItems[0];
    expect(created.workItemId).toBe('wi-test-1');
    expect(created.bookItemId).toBe('T1');
    expect(created.sequenceOrder).toBe(3);

    // --- The spec row POST is snake_case, keyed on the TEST work_item_id. ---
    const batches = batchCalls(calls);
    expect(batches).toHaveLength(1);
    const rows = batches[0].body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].work_item_id).toBe('wi-test-1');
    expect(String(rows[0].generated_spec_text)).toMatch(
      new RegExp(`^${SPEC_TEXT_REQUIRED_PREFIX.replace(/[/]/g, '\\$&')}`),
    );
    expect(rows[0].structured_tests_json).toEqual([
      { title: 'Onboarding journey E2E', description: 'spans capture + verify', type: 'e2e' },
    ]);
    expect(created.specPersisted).toBe(true);

    // --- implement-state.json written to the real temp dir with the right state. ---
    expect(created.implementStateWritten).toBe(true);
    const folderName = deriveFolderName('Onboarding journey E2E', 'wi-test-1');
    const statePath = path.join(
      tmpRoot,
      'conversations',
      'implement',
      folderName,
      'implementation-state.json',
    );
    expect(fs.existsSync(statePath)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    expect(persisted.hasTestPlan).toBe(true);
    expect(persisted.latestPlannerResponse.plannerReadyForSpec).toBe(true);
    expect(persisted.latestPlannerResponse.scope.in).toContain('write these integration/E2E tests');
    expect(persisted.latestTestPlannerResponse.testPlan).toEqual([
      { title: 'Onboarding journey E2E', description: 'spans capture + verify', type: 'e2e' },
    ]);
  });

  it('multiple defs -> one append-test-item POST per test with sequence_order incrementing after the last child', async () => {
    const state: AmsState = {
      bookOfWorkJson: {
        items: [
          blobItem({ id: 'F1', type: 'feature', title: 'Billing', workItemId: 'wi-F1' }),
          blobItem({ id: 'S1', parentId: 'F1', type: 'story', title: 'Invoice', sequenceOrder: 1, workItemId: 'wi-S1' }),
          blobItem({ id: 'S2', parentId: 'F1', type: 'story', title: 'Pay', sequenceOrder: 2, workItemId: 'wi-S2' }),
        ],
      },
      specGenerations: [specGenRow('wi-S1', 'generated'), specGenRow('wi-S2', 'generated')],
      appendSeq: 0,
    };
    const { calls } = installAmsFetch(state);
    mockSendChatRequest.mockResolvedValueOnce(
      holisticPlanResponse([
        { title: 'contract integration', description: 'S1<->S2 contract', type: 'integration' },
        { title: 'billing E2E', description: 'invoice to payment', type: 'e2e' },
      ]),
    );

    const result = await runHolisticTestDefinitions({
      projectId: PROJECT_ID,
      bookOfWorkId: BOOK_ID,
      nodeBookItemId: 'F1',
    });

    const appends = appendCalls(calls);
    expect(appends).toHaveLength(2);
    expect(appends.map((c) => (c.body as { sequence_order: number }).sequence_order)).toEqual([3, 4]);
    expect(result.createdTestItems.map((c) => c.sequenceOrder)).toEqual([3, 4]);
    // Each batch POST is keyed on the matching minted TEST work_item_id.
    const batches = batchCalls(calls);
    expect(batches).toHaveLength(2);
    expect((batches[0].body as Array<Record<string, unknown>>)[0].work_item_id).toBe('wi-test-1');
    expect((batches[1].body as Array<Record<string, unknown>>)[0].work_item_id).toBe('wi-test-2');
  });
});

// ---------------------------------------------------------------------------
// Seam 2 -- EPIC-level end-to-end through the PRODUCTION default seams.
// ---------------------------------------------------------------------------

describe('Group 5 -- EPIC-level holistic run through real default seams', () => {
  it('defaultLoadNode derives epic level + feature children; TEST sibling parents to the epic after its features', async () => {
    const state: AmsState = {
      bookOfWorkJson: {
        items: [
          blobItem({ id: 'E1', type: 'epic', title: 'Billing Domain', workItemId: 'wi-E1' }),
          blobItem({ id: 'FA', parentId: 'E1', type: 'feature', title: 'Feature A', sequenceOrder: 1, workItemId: 'wi-FA' }),
          blobItem({ id: 'FB', parentId: 'E1', type: 'feature', title: 'Feature B', sequenceOrder: 2, workItemId: 'wi-FB' }),
        ],
      },
      specGenerations: [specGenRow('wi-FA', 'generated'), specGenRow('wi-FB', 'generated')],
      appendSeq: 0,
    };
    const { calls } = installAmsFetch(state);
    let capturedSystemPrompt = '';
    mockSendChatRequest.mockImplementationOnce(async (messages: Array<{ role: string; content: string }>) => {
      capturedSystemPrompt = messages.find((m) => m.role === 'system')?.content ?? '';
      return holisticPlanResponse([
        { title: 'epic E2E journey', description: 'spans Feature A + B', type: 'e2e' },
      ]);
    });

    const result = await runHolisticTestDefinitions({
      projectId: PROJECT_ID,
      bookOfWorkId: BOOK_ID,
      nodeBookItemId: 'E1',
    });

    expect(result.level).toBe('epic');
    // The generalized prompt ran at EPIC level over the FEATURES' specs.
    expect(capturedSystemPrompt).toContain('## EPIC CONTEXT');
    expect(capturedSystemPrompt).toContain('### Feature 1: Feature A');
    expect(capturedSystemPrompt).toContain('### Feature 2: Feature B');

    const appends = appendCalls(calls);
    expect(appends).toHaveLength(1);
    expect(appends[0].body).toMatchObject({
      parent_book_item_id: 'E1',
      parent_work_item_id: 'wi-E1',
      sequence_order: 3,
    });
  });
});

// ---------------------------------------------------------------------------
// Seam 3 -- ALLOW-WITH-WARNING through the real defaultLoadSpecRows partition.
// ---------------------------------------------------------------------------

describe('Group 5 -- ALLOW-WITH-WARNING through real default seams', () => {
  it('reviews only the spec-complete child, lists the insufficient/not-generated children, and still creates the TEST item', async () => {
    const state: AmsState = {
      bookOfWorkJson: {
        items: [
          blobItem({ id: 'F1', type: 'feature', title: 'Onboarding', workItemId: 'wi-F1' }),
          blobItem({ id: 'S1', parentId: 'F1', type: 'story', title: 'Ready story', sequenceOrder: 1, workItemId: 'wi-S1' }),
          blobItem({ id: 'S2', parentId: 'F1', type: 'story', title: 'Blocked story', sequenceOrder: 2, workItemId: 'wi-S2' }),
          blobItem({ id: 'S3', parentId: 'F1', type: 'story', title: 'Unsaved story', sequenceOrder: 3, workItemId: null }),
        ],
      },
      specGenerations: [
        specGenRow('wi-S1', 'generated'),
        specGenRow('wi-S2', 'insufficient_context'),
      ],
      appendSeq: 0,
    };
    const { calls } = installAmsFetch(state);
    mockSendChatRequest.mockResolvedValueOnce(
      holisticPlanResponse([
        { title: 'cross-cut integration', description: 'covers S1 paths', type: 'integration' },
      ]),
    );

    const result = await runHolisticTestDefinitions({
      projectId: PROJECT_ID,
      bookOfWorkId: BOOK_ID,
      nodeBookItemId: 'F1',
    });

    expect(result.specCompleteChildCount).toBe(1);
    const reasons = result.skippedChildren.reduce<Record<string, string>>((acc, s) => {
      acc[s.bookItemId] = s.reason;
      return acc;
    }, {});
    expect(reasons.S2).toBe('insufficient_context');
    expect(reasons.S3).toBe('not_generated');

    // It never blocked: the TEST item was still created via the real append seam.
    expect(appendCalls(calls)).toHaveLength(1);
    expect(result.createdTestItems).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Seam 4 -- EMPTY-PLAN no-op through the real default seams.
// ---------------------------------------------------------------------------

describe('Group 5 -- EMPTY-PLAN no-op through real default seams', () => {
  it('creates ZERO work_items / blob items / spec rows / implement-state when the plan is empty', async () => {
    const state: AmsState = {
      bookOfWorkJson: {
        items: [
          blobItem({ id: 'F1', type: 'feature', title: 'Onboarding', workItemId: 'wi-F1' }),
          blobItem({ id: 'S1', parentId: 'F1', type: 'story', title: 'Only story', sequenceOrder: 1, workItemId: 'wi-S1' }),
        ],
      },
      specGenerations: [specGenRow('wi-S1', 'generated')],
      appendSeq: 0,
    };
    const { calls } = installAmsFetch(state);
    mockSendChatRequest.mockResolvedValueOnce(holisticPlanResponse([]));

    const result = await runHolisticTestDefinitions({
      projectId: PROJECT_ID,
      bookOfWorkId: BOOK_ID,
      nodeBookItemId: 'F1',
    });

    expect(result.emptyPlan).toBe(true);
    expect(result.createdTestItems).toHaveLength(0);
    // No write-side AMS calls happened at all.
    expect(appendCalls(calls)).toHaveLength(0);
    expect(batchCalls(calls)).toHaveLength(0);
    // No blob item was appended (still just the feature + its one story).
    expect(state.bookOfWorkJson.items).toHaveLength(2);
    // No implement-state file was written under the temp root.
    const convDir = path.join(tmpRoot, 'conversations');
    expect(fs.existsSync(convDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Seam 5 -- the route wires through to the REAL handler defaults (not a mock).
// ---------------------------------------------------------------------------

describe('Group 5 -- POST define-integration-tests drives the real handler end-to-end', () => {
  function createTestApp() {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use((req, _res, next) => {
      (req as unknown as { requestId: string }).requestId = 'holistic-e2e-route';
      next();
    });
    app.use('/api', migrationDeliveryDashboardRouter);
    return app;
  }

  it('the node-scoped route runs the real holistic handler, hits AMS append-test-item, and returns the created TEST item (200)', async () => {
    const state: AmsState = {
      bookOfWorkJson: {
        items: [
          blobItem({ id: 'F1', type: 'feature', title: 'Onboarding', workItemId: 'wi-F1' }),
          blobItem({ id: 'S1', parentId: 'F1', type: 'story', title: 'Story one', sequenceOrder: 1, workItemId: 'wi-S1' }),
        ],
      },
      specGenerations: [specGenRow('wi-S1', 'generated')],
      appendSeq: 0,
    };
    const { calls } = installAmsFetch(state);
    mockSendChatRequest.mockResolvedValueOnce(
      holisticPlanResponse([
        { title: 'route-driven integration', description: 'exercises the seam', type: 'integration' },
      ]),
    );

    const res = await request(createTestApp())
      .post(`/api/projects/${PROJECT_ID}/migration-books-of-work/${BOOK_ID}/items/F1/define-integration-tests`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.level).toBe('feature');
    expect(res.body.createdTestItems).toHaveLength(1);
    expect(res.body.createdTestItems[0].workItemId).toBe('wi-test-1');
    // Proves the route invoked the REAL default seams (not a stubbed handler):
    // the AMS append-test-item call actually fired.
    expect(appendCalls(calls)).toHaveLength(1);
    expect(appendCalls(calls)[0].body).toMatchObject({
      parent_book_item_id: 'F1',
      sequence_order: 2,
    });
  });
});
