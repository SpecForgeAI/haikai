/**
 * Tests for Dashboard Summary -- Real Architecture Data Integration
 *
 * Spec 2026-03-01: Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End
 * Task Group 3: Backend Dashboard Integration (Real Architecture Counts)
 *
 * Tests:
 * 1. GET /api/dashboard/summary with mock fetchMetaModelSummary returning a MetaModelSummaryDto
 *    with 3 services, 5 interfaces, 4 data_entities returns real highLevelArchitecture counts
 * 2. GET /api/dashboard/summary with mock fetchMetaModelSummary returning null
 *    returns highLevelArchitecture counts all at 0
 * 3. GET /api/dashboard/summary when fetchMetaModelSummary throws an error
 *    returns highLevelArchitecture counts all at 0 (graceful degradation, metaModel falls back to null)
 *
 * Uses supertest + express app pattern following existing gateway route tests.
 * Mocks fetchMetaModelSummary from architectureModelClient to control architecture data.
 */

// ---- Mock fetchMetaModelSummary (and fetchProductSummary) before any imports ----
const mockFetchMetaModelSummary = jest.fn();
const mockFetchProductSummary = jest.fn();
jest.mock('../services/architectureModelClient', () => {
  const { buildArchitectureModelClientMock } = jest.requireActual(
    '../testSetup/architectureModelClientMock'
  );
  return buildArchitectureModelClientMock({
    fetchMetaModelSummary: (...args: unknown[]) => mockFetchMetaModelSummary(...args),
    fetchProductSummary: (...args: unknown[]) => mockFetchProductSummary(...args),
  });
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
import { MetaModelSummaryDto } from '../types/chat';

describe('Dashboard Summary -- Real Architecture Data (Spec 2026-03-01, Task Group 3)', () => {

  afterEach(() => {
    mockFetchMetaModelSummary.mockReset();
    mockFetchProductSummary.mockReset();
  });

  // ========================================================================
  // Test 1: fetchMetaModelSummary returns a MetaModelSummaryDto with real counts
  // ========================================================================
  it('returns real highLevelArchitecture counts when fetchMetaModelSummary returns a MetaModelSummaryDto', async () => {
    // Build a MetaModelSummaryDto with 3 services, 5 interfaces, 4 data_entities
    const metaModel: MetaModelSummaryDto = {
      applications: [],
      business_users: [],
      process_activities: [],
      ui_screens: [],
      // dataStores card now reads data_store_count (services under Persistence Tier),
      // not data_entities.length
      data_store_count: 4,
      services: [
        { id: 'svc-1', name: 'Auth Service', entity_type: 'services' },
        { id: 'svc-2', name: 'Payment Service', entity_type: 'services' },
        { id: 'svc-3', name: 'Notification Service', entity_type: 'services' },
      ],
      interfaces: [
        { id: 'if-1', name: 'REST API', entity_type: 'interfaces' },
        { id: 'if-2', name: 'GraphQL API', entity_type: 'interfaces' },
        { id: 'if-3', name: 'Webhook', entity_type: 'interfaces' },
        { id: 'if-4', name: 'gRPC', entity_type: 'interfaces' },
        { id: 'if-5', name: 'Message Queue', entity_type: 'interfaces' },
      ],
      data_entities: [
        { id: 'de-1', name: 'User', entity_type: 'logicalDataEntities' },
        { id: 'de-2', name: 'Order', entity_type: 'logicalDataEntities' },
        { id: 'de-3', name: 'Product', entity_type: 'logicalDataEntities' },
        { id: 'de-4', name: 'Invoice', entity_type: 'logicalDataEntities' },
      ],
      relationships: [],
    };

    mockFetchMetaModelSummary.mockResolvedValue(metaModel);
    // Also mock fetchProductSummary to avoid unrelated network calls
    mockFetchProductSummary.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const hla = res.body.strategicFoundation.highLevelArchitecture;

    expect(hla.services.value).toBe(3);
    expect(hla.interfaces.value).toBe(5);
    expect(hla.dataStores.value).toBe(4);
    expect(hla.overall.value).toBe(12); // 3 + 5 + 4
    expect(hla.applications.value).toBe(0);

    // Verify fetchMetaModelSummary was called with the projectId and resolved architectureId
    expect(mockFetchMetaModelSummary).toHaveBeenCalledWith('test-proj', 'arch-default-1');
  });

  // ========================================================================
  // Test 2: fetchMetaModelSummary returns null (no baseline exists)
  // ========================================================================
  it('returns highLevelArchitecture counts all at 0 when fetchMetaModelSummary returns null', async () => {
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const hla = res.body.strategicFoundation.highLevelArchitecture;

    expect(hla.services.value).toBe(0);
    expect(hla.interfaces.value).toBe(0);
    expect(hla.dataStores.value).toBe(0);
    expect(hla.overall.value).toBe(0);
    expect(hla.applications.value).toBe(0);
  });

  // ========================================================================
  // Test 3: fetchMetaModelSummary throws -- graceful degradation
  //         When fetchMetaModelSummary throws, the route's catch handler
  //         sets metaModel to null, so all HLA values default to 0.
  // ========================================================================
  it('returns highLevelArchitecture counts all at 0 when fetchMetaModelSummary throws an error', async () => {
    mockFetchMetaModelSummary.mockRejectedValue(new Error('Service unavailable'));
    mockFetchProductSummary.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const hla = res.body.strategicFoundation.highLevelArchitecture;

    // When fetchMetaModelSummary throws, the catch in the route sets metaModel = null,
    // so all HLA values default to 0
    expect(hla.overall.value).toBe(0);
    expect(hla.applications.value).toBe(0);
    expect(hla.services.value).toBe(0);
    expect(hla.interfaces.value).toBe(0);
    expect(hla.dataStores.value).toBe(0);
  });
});
