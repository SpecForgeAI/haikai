/**
 * Tests for chatApi kind parameter handling
 *
 * Spec 2026-02-12: Generalize Conversation Persistence to Support Kind
 * Task Group 3: Frontend API Functions and Component Call Sites
 *
 * Tests:
 * 1. getImplementConversation with kind="product" appends &kind=product to the URL
 * 2. getImplementConversation without kind does NOT include kind in the URL
 * 3. putImplementConversation with kind: "product" includes kind in the serialized JSON body
 * 4. putImplementState with kind: "implement" includes kind in the serialized JSON body
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('chatApi kind parameter handling', () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ exists: true, messages: [], state: null, success: true }),
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetModules();
  });

  describe('getImplementConversation', () => {
    it('appends &kind=product to the URL when kind="product" is provided', async () => {
      const { getImplementConversation } = await import('../chatApi');

      await getImplementConversation('proj-1', 'feat-1', '/path/to/project', 'My Feature', 'product');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('&kind=product');
    });

    it('does NOT include kind in the URL when kind is omitted', async () => {
      const { getImplementConversation } = await import('../chatApi');

      await getImplementConversation('proj-1', 'feat-1', '/path/to/project', 'My Feature');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expect(url).not.toContain('kind=');
    });
  });

  describe('putImplementConversation', () => {
    it('includes kind in the serialized JSON body when kind: "product" is provided', async () => {
      const { putImplementConversation } = await import('../chatApi');

      await putImplementConversation({
        projectId: 'proj-1',
        featureId: 'feat-1',
        projectParentFolder: '/path/to/project',
        featureTitle: 'My Feature',
        messages: [],
        kind: 'product',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      const requestBody = JSON.parse(options.body);
      expect(requestBody.kind).toBe('product');
    });
  });

  describe('putImplementState', () => {
    it('includes kind in the serialized JSON body when kind: "implement" is provided', async () => {
      const { putImplementState } = await import('../chatApi');

      const minimalState = {
        schemaVersion: 1 as const,
        sessionId: null,
        latestPlannerResponse: null,
        answers: {},
        questionStatuses: {},
        streamedQuestions: [],
        streamedAnswers: {},
        latestFolder: null,
        incrementStatuses: {},
        activeIncrementId: null,
        prefetchedSpecs: {},
        partStatuses: {},
        activePartIndex: null,
        currentJobId: null,
        partTranscripts: {},
        hasBootstrapped: false,
        hasPlan: false,
        hasTriggeredOrchestration: false,
        inputDraft: '',
        messages: [],
      };

      await putImplementState({
        projectId: 'proj-1',
        featureId: 'feat-1',
        projectParentFolder: '/path/to/project',
        featureTitle: 'My Feature',
        state: minimalState,
        kind: 'implement',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      const requestBody = JSON.parse(options.body);
      expect(requestBody.kind).toBe('implement');
    });
  });
});
