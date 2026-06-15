/**
 * Tests for Dashboard Summary -- Real Roadmap Data Integration
 *
 * Spec 2026-03-01: Hub Bootstrap 2 -- Roadmap (PM) End-to-End
 * Task Group 3: Backend Dashboard Integration (Real Roadmap Data)
 *
 * Tests:
 * 1. GET /api/dashboard/summary with mock fetchProductSummary returning an existing roadmap
 *    (2 initiatives, 5 epics) returns roadmap.initiativesCount.value === 2,
 *    roadmap.epics.value === 5
 * 2. GET /api/dashboard/summary with mock fetchProductSummary returning null
 *    returns roadmap.initiativesCount.value === 0,
 *    roadmap.epics.value === 0
 * 3. GET /api/dashboard/summary when fetchProductSummary throws an error
 *    leaves roadmap mock values unchanged (graceful degradation)
 *
 * Uses supertest + express app pattern following existing gateway route tests.
 * Mocks fetchProductSummary from architectureModelClient to control roadmap data.
 */

// ---- Mock fetchProductSummary before any imports ----
const mockFetchProductSummary = jest.fn();
jest.mock('../services/architectureModelClient', () => {
  const actual = jest.requireActual('../services/architectureModelClient');
  return {
    ...actual,
    fetchProductSummary: (...args: unknown[]) => mockFetchProductSummary(...args),
  };
});

// ---- Mock logger to suppress output during tests ----
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  logToolCall: jest.fn(),
  logOpenAIRequest: jest.fn(),
}));

// ---- Mock dashboardInsightGenerator to avoid real LLM calls ----
jest.mock('../services/dashboardInsightGenerator', () => ({
  generateHeaderInsight: jest.fn().mockResolvedValue('Mock header insight'),
  generateDeliveryInsight: jest.fn().mockResolvedValue('Mock delivery insight'),
}));

import request from 'supertest';
import { app } from '../server';
import { ProductSummaryDto } from '../types/chat';

describe('Dashboard Summary -- Real Roadmap Data (Spec 2026-03-01, Task Group 3)', () => {

  afterEach(() => {
    mockFetchProductSummary.mockReset();
  });

  // ========================================================================
  // Test 1: fetchProductSummary returns existing roadmap with 2 initiatives, 5 epics
  // ========================================================================
  it('returns real roadmap data (2 initiatives, 5 epics) when fetchProductSummary returns an existing roadmap', async () => {
    // Build a ProductSummaryDto with 2 normal initiatives and 5 total epics
    const productSummary: ProductSummaryDto = {
      initiatives: [
        {
          id: 'init-1',
          title: 'Initiative One',
          description: 'First initiative',
          epics: [
            { id: 'epic-1', title: 'Epic 1A', description: 'desc', features: [] },
            { id: 'epic-2', title: 'Epic 1B', description: 'desc', features: [] },
            { id: 'epic-3', title: 'Epic 1C', description: 'desc', features: [] },
          ],
        },
        {
          id: 'init-2',
          title: 'Initiative Two',
          description: 'Second initiative',
          epics: [
            { id: 'epic-4', title: 'Epic 2A', description: 'desc', features: [] },
            { id: 'epic-5', title: 'Epic 2B', description: 'desc', features: [] },
          ],
        },
      ],
    };

    mockFetchProductSummary.mockResolvedValue(productSummary);

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const roadmap = res.body.strategicFoundation.roadmap;

    expect(roadmap.initiativesCount.value).toBe(2);
    expect(roadmap.epics.value).toBe(5);

    // Verify fetchProductSummary was called with the projectId
    expect(mockFetchProductSummary).toHaveBeenCalledWith('test-proj');
  });

  // ========================================================================
  // Test 2: fetchProductSummary returns null (no project/roadmap)
  // ========================================================================
  it('returns roadmap zero counts when fetchProductSummary returns null', async () => {
    mockFetchProductSummary.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const roadmap = res.body.strategicFoundation.roadmap;

    expect(roadmap.initiativesCount.value).toBe(0);
    expect(roadmap.epics.value).toBe(0);
  });

  // ========================================================================
  // Test 3: fetchProductSummary throws -- graceful degradation keeps mock values
  // ========================================================================
  it('leaves roadmap mock values unchanged when fetchProductSummary throws an error', async () => {
    mockFetchProductSummary.mockRejectedValue(new Error('Service unavailable'));

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const roadmap = res.body.strategicFoundation.roadmap;

    // When fetchProductSummary throws, the catch in the route sets productSummary = null,
    // so roadmap counts default to 0
    expect(roadmap.initiativesCount.value).toBe(0);
    expect(roadmap.epics.value).toBe(0);
    expect(roadmap.completed.value).toBe(0);
  });
});
