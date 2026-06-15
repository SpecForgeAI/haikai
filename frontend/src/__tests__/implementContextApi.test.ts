/**
 * Tests for implementContextApi.ts
 *
 * Spec 2026-01-09: Persist Implement Context per Work Item in Backend
 * Task Group 4: Testing and Verification
 *
 * Updated to match current API which sends structured selections
 * (entity_selections, diagram_selections, relationship fields).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchImplementContext, saveImplementContext } from '../api/implementContextApi';
import { createEmptyContextState } from '../utils/contextStorage';
import type { ContextState } from '../utils/contextStorage';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('implementContextApi', () => {
  const PROJECT_ID = 'test-project.json';
  const WORK_ITEM_ID = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchImplementContext', () => {
    it('returns empty context state for empty projectId', async () => {
      const result = await fetchImplementContext('', WORK_ITEM_ID);
      expect(result).toEqual(createEmptyContextState());
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns empty context state for empty workItemId', async () => {
      const result = await fetchImplementContext(PROJECT_ID, '');
      expect(result).toEqual(createEmptyContextState());
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fetches and maps context from backend', async () => {
      const backendResponse = {
        project_id: PROJECT_ID,
        work_item_id: WORK_ITEM_ID,
        selected_entity_ids: ['applications::app-1', 'services::svc-1'],
        selected_diagram_ids: ['diagram-1'],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => backendResponse,
      });

      const result = await fetchImplementContext(PROJECT_ID, WORK_ITEM_ID);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/projects/${encodeURIComponent(PROJECT_ID)}/work-items/${WORK_ITEM_ID}/implement-context`)
      );
      expect(result.version).toBe(1);
      expect(result.entity_refs).toHaveLength(2);
      expect(result.entity_refs[0].entity_type).toBe('applications');
      expect(result.entity_refs[0].entity_id).toBe('app-1');
      expect(result.diagram_refs).toHaveLength(1);
      expect(result.diagram_refs[0].diagram_id).toBe('diagram-1');
    });

    it('handles empty arrays from backend', async () => {
      const backendResponse = {
        project_id: PROJECT_ID,
        work_item_id: WORK_ITEM_ID,
        selected_entity_ids: [],
        selected_diagram_ids: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => backendResponse,
      });

      const result = await fetchImplementContext(PROJECT_ID, WORK_ITEM_ID);

      expect(result.entity_refs).toEqual([]);
      expect(result.diagram_refs).toEqual([]);
    });

    it('throws error on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(fetchImplementContext(PROJECT_ID, WORK_ITEM_ID))
        .rejects.toThrow('Failed to fetch implement context');
    });
  });

  describe('saveImplementContext', () => {
    it('throws error for empty projectId', async () => {
      const state = createEmptyContextState();
      await expect(saveImplementContext('', WORK_ITEM_ID, state))
        .rejects.toThrow('projectId and workItemId are required');
    });

    it('throws error for empty workItemId', async () => {
      const state = createEmptyContextState();
      await expect(saveImplementContext(PROJECT_ID, '', state))
        .rejects.toThrow('projectId and workItemId are required');
    });

    it('sends correct snake_case payload to backend', async () => {
      const state: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'App 1' },
        ],
        diagram_refs: [
          { kind: 'DIAGRAM', diagram_id: 'diagram-1', label: 'Diagram 1' },
        ],
      };

      const backendResponse = {
        project_id: PROJECT_ID,
        work_item_id: WORK_ITEM_ID,
        selected_entity_ids: ['applications::app-1'],
        selected_diagram_ids: ['diagram-1'],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => backendResponse,
      });

      await saveImplementContext(PROJECT_ID, WORK_ITEM_ID, state);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/implement-context'),
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      // Verify the request body includes both legacy IDs and structured selections
      const [, callOptions] = mockFetch.mock.calls[0];
      const body = JSON.parse(callOptions.body);
      expect(body.selected_entity_ids).toEqual(['applications::app-1']);
      expect(body.selected_diagram_ids).toEqual(['diagram-1']);
      // Structured selections are also included
      expect(body.selected_entity_selections).toEqual([
        { entity_type: 'applications', entity_id: 'app-1', bundle_type: 'entity_only', depth: null },
      ]);
      expect(body.selected_diagram_selections).toEqual([
        { diagram_id: 'diagram-1', bundle_type: 'diagram_only' },
      ]);
      // Relationship fields default to empty arrays
      expect(body.selected_relationship_ids).toEqual([]);
      expect(body.selected_relationship_selections).toEqual([]);
    });

    it('maps response back to ContextState', async () => {
      const state: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'App 1' },
        ],
        diagram_refs: [],
      };

      const backendResponse = {
        project_id: PROJECT_ID,
        work_item_id: WORK_ITEM_ID,
        selected_entity_ids: ['applications::app-1'],
        selected_diagram_ids: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => backendResponse,
      });

      const result = await saveImplementContext(PROJECT_ID, WORK_ITEM_ID, state);

      expect(result.version).toBe(1);
      expect(result.entity_refs).toHaveLength(1);
      expect(result.diagram_refs).toEqual([]);
    });

    it('throws error on non-ok response', async () => {
      const state = createEmptyContextState();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid data',
      });

      await expect(saveImplementContext(PROJECT_ID, WORK_ITEM_ID, state))
        .rejects.toThrow('Failed to save implement context');
    });
  });
});
