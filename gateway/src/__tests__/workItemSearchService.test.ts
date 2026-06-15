/**
 * Tests for workItemSearchService
 *
 * Spec 2026-03-04: What's Next v1-C -- Work Item Picker
 * Task Group 10: Gateway tests for the work item search service.
 *
 * Tests the searchWorkItems function which calls the architecture-model-service
 * search endpoint, resolves scope via product summary, ranks results, and
 * returns up to 5 items.
 */

// ---- Mock global fetch ----
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// ---- Mock architectureModelClient ----
const mockFetchProductSummary = jest.fn();
jest.mock('../services/architectureModelClient', () => ({
  fetchProductSummary: (...args: unknown[]) => mockFetchProductSummary(...args),
}));

// ---- Mock config ----
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

// ---- Mock logger ----
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { searchWorkItems } from '../services/workItemSearchService';

/**
 * Helper: create a raw work item DTO as returned from the search endpoint.
 */
function makeWorkItemDto(overrides: Partial<{
  id: string;
  project_id: string;
  type: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: string;
  sort_order: number;
}> = {}) {
  return {
    id: overrides.id || 'item-1',
    project_id: overrides.project_id || 'proj-1',
    type: overrides.type || 'FEATURE',
    parent_id: overrides.parent_id !== undefined ? overrides.parent_id : 'epic-1',
    title: overrides.title || 'Default Feature',
    description: overrides.description !== undefined ? overrides.description : 'A description',
    status: overrides.status || 'PLANNED',
    sort_order: overrides.sort_order || 1,
    priority: null as string | null,
    target_window: null as string | null,
    tags: null as string | null,
    external_system: null as string | null,
    external_key: null as string | null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

type WorkItemDtoShape = ReturnType<typeof makeWorkItemDto>;

/**
 * Helper: create a product summary with N epics across one initiative.
 */
function makeProductSummary(epicCount: number) {
  const epics: Array<{
    id: string;
    title: string;
    description: string;
    features: Array<{ id: string; title: string; description: string }>;
  }> = [];
  for (let i = 1; i <= epicCount; i++) {
    epics.push({
      id: `epic-${i}`,
      title: `Epic ${i}`,
      description: `Description for Epic ${i}`,
      features: [
        { id: `feat-${i}-1`, title: `Feature ${i}.1`, description: 'desc' },
        { id: `feat-${i}-2`, title: `Feature ${i}.2`, description: 'desc' },
      ],
    });
  }
  return {
    initiatives: [{
      id: 'init-1',
      title: 'Initiative 1',
      description: 'Main initiative',
      epics,
    }],
  };
}

describe('workItemSearchService (Spec 2026-03-04, v1-C Task Group 10)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetchProductSummary.mockReset();
  });

  // ========================================================================
  // Test 1: Returns empty array when fetch fails
  // ========================================================================
  it('returns empty array when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const results = await searchWorkItems('proj-1', 'login');

    expect(results).toEqual([]);
  });

  // ========================================================================
  // Test 2: Returns mapped results without scope
  // ========================================================================
  it('returns mapped results with inScope false when no scopeType provided', async () => {
    const rawItems = [
      makeWorkItemDto({ id: 'f1', title: 'Login Page', type: 'FEATURE', parent_id: 'epic-1' }),
      makeWorkItemDto({ id: 'f2', title: 'Login API', type: 'FEATURE', parent_id: 'epic-2' }),
      makeWorkItemDto({ id: 's1', title: 'Login Validation', type: 'STORY', parent_id: 'feat-1-1' }),
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => rawItems,
    });

    const results = await searchWorkItems('proj-1', 'login');

    expect(results).toHaveLength(3);
    // All items should have inScope: false since no scopeType was provided
    for (const r of results) {
      expect(r.inScope).toBe(false);
    }
    // Verify mapping
    expect(results[0].id).toBe('f1');
    expect(results[0].title).toBe('Login Page');
    expect(results[0].type).toBe('FEATURE');
    expect(results[0].status).toBe('PLANNED');
  });

  // ========================================================================
  // Test 3: Returns ranked results with NEXT_5_EPICS scope
  // ========================================================================
  it('returns ranked results with in-scope items first when NEXT_5_EPICS scope used', async () => {
    // Items: one belongs to epic-1 (in scope), one to epic-6 (out of scope), one to epic-3 (in scope)
    const rawItems = [
      makeWorkItemDto({ id: 'f-out', title: 'Out of scope feature', type: 'FEATURE', parent_id: 'epic-6' }),
      makeWorkItemDto({ id: 'f-in-1', title: 'In scope feature 1', type: 'FEATURE', parent_id: 'epic-1' }),
      makeWorkItemDto({ id: 'f-in-2', title: 'In scope feature 2', type: 'FEATURE', parent_id: 'epic-3' }),
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => rawItems,
    });

    // 6 epics: only the first 5 are in scope for NEXT_5_EPICS
    mockFetchProductSummary.mockResolvedValue(makeProductSummary(6));

    const results = await searchWorkItems('proj-1', 'feature', 'NEXT_5_EPICS');

    expect(results).toHaveLength(3);
    // In-scope items should come first
    expect(results[0].inScope).toBe(true);
    expect(results[1].inScope).toBe(true);
    // Out-of-scope item last
    expect(results[2].inScope).toBe(false);
    expect(results[2].id).toBe('f-out');
  });

  // ========================================================================
  // Test 4: Boosts IN_PROGRESS items within buckets
  // ========================================================================
  it('boosts IN_PROGRESS items to the top within their scope bucket', async () => {
    const rawItems = [
      makeWorkItemDto({ id: 'f1', title: 'Planned Feature', type: 'FEATURE', parent_id: 'epic-1', status: 'PLANNED' }),
      makeWorkItemDto({ id: 'f2', title: 'Active Feature', type: 'FEATURE', parent_id: 'epic-1', status: 'IN_PROGRESS' }),
      makeWorkItemDto({ id: 'f3', title: 'Another Planned', type: 'FEATURE', parent_id: 'epic-1', status: 'PLANNED' }),
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => rawItems,
    });

    mockFetchProductSummary.mockResolvedValue(makeProductSummary(5));

    const results = await searchWorkItems('proj-1', 'feature', 'NEXT_5_EPICS');

    expect(results).toHaveLength(3);
    // IN_PROGRESS should be first
    expect(results[0].id).toBe('f2');
    expect(results[0].status).toBe('IN_PROGRESS');
  });

  // ========================================================================
  // Test 5: Truncates to 5 results
  // ========================================================================
  it('truncates results to 5 items maximum', async () => {
    const rawItems: WorkItemDtoShape[] = [];
    for (let i = 1; i <= 8; i++) {
      rawItems.push(makeWorkItemDto({
        id: `f${i}`,
        title: `Feature ${i}`,
        type: 'FEATURE',
        parent_id: 'epic-1',
      }));
    }

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => rawItems,
    });

    const results = await searchWorkItems('proj-1', 'feature');

    expect(results).toHaveLength(5);
  });

  // ========================================================================
  // Test 6: Returns empty array when search returns empty
  // ========================================================================
  it('returns empty array when search endpoint returns empty array', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [] as WorkItemDtoShape[],
    });

    const results = await searchWorkItems('proj-1', 'nonexistent');

    expect(results).toEqual([]);
  });
});
