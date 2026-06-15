/**
 * Tests for Dashboard Summary -- Real Data Assembly
 *
 * Spec 2026-03-06: Dashboard Real Data - Task Group 2
 *
 * Tests:
 * 1. Dashboard route returns valid DashboardSummaryDto shape with all cards populated
 * 2. When stats endpoint returns null, all stats-derived fields default to 0
 * 3. Default scope fallback is ENTIRE_PRODUCT (not NEXT_5_EPICS)
 * 4. Invalid scope defaults to ENTIRE_PRODUCT
 * 5. Graceful degradation when all data sources fail
 * 6. Stats data used correctly for header and card assembly
 *
 * Task Group 4 gap-filling tests (7-13):
 * 7. Partial stats: only EPIC counts present, STORY/FEATURE fields default to 0
 * 8. Null metaModel with valid stats: architecture counts = 0, stats cards populated
 * 9. Detailed architecture entity_type filtering with multiple data entities
 * 10. Missing projectId returns 400
 * 11. Empty type_counts object: stats present but type_counts is {}
 * 12. Roadmap completed uses EPIC.COMPLETED from stats even with no productSummary
 * 13. Post-coding summaryInsight message includes real count values
 *
 * Uses supertest + express app pattern following existing gateway route tests.
 * Mocks architectureModelClient functions to control data sources.
 */

// ---- Mock architectureModelClient before any imports ----
const mockFetchProjectFolder = jest.fn();
const mockFetchProductSummary = jest.fn();
const mockFetchMetaModelSummary = jest.fn();
const mockFetchWorkItemStats = jest.fn();
jest.mock('../services/architectureModelClient', () => {
  const { buildArchitectureModelClientMock } = jest.requireActual(
    '../testSetup/architectureModelClientMock'
  );
  return buildArchitectureModelClientMock({
    fetchProjectFolder: (...args: unknown[]) => mockFetchProjectFolder(...args),
    fetchProductSummary: (...args: unknown[]) => mockFetchProductSummary(...args),
    fetchMetaModelSummary: (...args: unknown[]) => mockFetchMetaModelSummary(...args),
    fetchWorkItemStats: (...args: unknown[]) => mockFetchWorkItemStats(...args),
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

describe('Dashboard Summary -- Real Data Assembly (Spec 2026-03-06, Task Group 2)', () => {

  afterEach(() => {
    mockFetchProjectFolder.mockReset();
    mockFetchProductSummary.mockReset();
    mockFetchMetaModelSummary.mockReset();
    mockFetchWorkItemStats.mockReset();
  });

  // ========================================================================
  // Test 1: Dashboard route returns valid DashboardSummaryDto shape
  // ========================================================================
  it('returns a valid DashboardSummaryDto shape with all cards populated from real data sources', async () => {
    // Provide realistic mock data
    mockFetchProjectFolder.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue({
      initiatives: [
        {
          id: 'init-1',
          title: 'Initiative One',
          description: 'First',
          epics: [
            { id: 'e1', title: 'Epic 1', description: '', features: [] },
            { id: 'e2', title: 'Epic 2', description: '', features: [] },
          ],
        },
      ],
    });
    mockFetchMetaModelSummary.mockResolvedValue({
      services: [{ id: 's1', name: 'Svc A', entity_type: 'services' }],
      data_entities: [
        { id: 'de1', name: 'DE1', entity_type: 'logicalDataEntities' },
        { id: 'de2', name: 'DE2', entity_type: 'physicalDataEntities' },
      ],
      interfaces: [{ id: 'i1', name: 'API A', entity_type: 'interfaces' }],
      relationships: [],
      // The HLA dataStores card reads the dedicated data_store_count field
      // (not data_entities.length).
      data_store_count: 2,
    });
    mockFetchWorkItemStats.mockResolvedValue({
      type_counts: {
        EPIC: { PLANNED: 3, IN_PROGRESS: 2, COMPLETED: 1 },
        FEATURE: { PLANNED: 5, IN_PROGRESS: 3 },
        STORY: { PLANNED: 10, IN_PROGRESS: 7, COMPLETED: 4 },
      },
      stories_with_ac_count: 15,
    });

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const body = res.body;

    // Assert top-level keys
    expect(body).toHaveProperty('header');
    expect(body).toHaveProperty('strategicFoundation');
    expect(body).toHaveProperty('scope');
    expect(body).toHaveProperty('detailedDefinitionAndDelivery');

    // Header uses real stats
    expect(body.header.projectName).toBe('test-proj');
    expect(body.header.epicsCount).toBe(6); // 3 + 2 + 1
    expect(body.header.activeEpicsCount).toBe(2);
    expect(body.header.storiesInProgressCount).toBe(7);
    expect(body.header.initiativesCount).toBe(1);
    expect(body.header.mode).toBe('GREENFIELD');
    expect(body.header.lastUpdatedLabel).toBe('Just now');

    // Strategic Foundation cards
    expect(body.strategicFoundation.productDefinition.missionExists).toHaveProperty('label');
    expect(body.strategicFoundation.productDefinition.lastUpdatedLabel).toHaveProperty('label');
    expect(body.strategicFoundation.roadmap.initiativesCount.value).toBe(1);
    expect(body.strategicFoundation.roadmap.epics.value).toBe(2);
    expect(body.strategicFoundation.roadmap.completed.value).toBe(1); // EPIC.COMPLETED
    expect(body.strategicFoundation.standards.orgTechStack).toHaveProperty('label');
    expect(body.strategicFoundation.standards.productTechStack).toHaveProperty('label');
    expect(body.strategicFoundation.testStrategy.exists).toHaveProperty('label');
    expect(body.strategicFoundation.testStrategy.lastUpdated).toHaveProperty('label');
    expect(body.strategicFoundation.summaryInsight.enabled).toBe(true);
    expect(body.strategicFoundation.summaryInsight.message).toBe('Mock header insight');

    // HLA from metaModel
    expect(body.strategicFoundation.highLevelArchitecture.services.value).toBe(1);
    expect(body.strategicFoundation.highLevelArchitecture.interfaces.value).toBe(1);
    expect(body.strategicFoundation.highLevelArchitecture.dataStores.value).toBe(2);
    expect(body.strategicFoundation.highLevelArchitecture.overall.value).toBe(4); // 1 + 1 + 2
    expect(body.strategicFoundation.highLevelArchitecture.applications.value).toBe(0);

    // Detailed Architecture from metaModel
    const da = body.detailedDefinitionAndDelivery.preCoding.detailedArchitecture;
    expect(da.interfaceEndpoints.value).toBe(1);
    expect(da.logicalDataEntities.value).toBe(1);
    expect(da.physicalDataEntities.value).toBe(1);
    expect(da.processActivities.value).toBe(0);
    expect(da.overall.value).toBe(3); // interfaceEndpoints(1) + logical(1) + physical(1) + processActivities(0)

    // Backlog from stats
    const backlog = body.detailedDefinitionAndDelivery.preCoding.backlog;
    expect(backlog.epicsInScope.value).toBe(6);
    expect(backlog.featuresCount.value).toBe(8);
    expect(backlog.storiesCount.value).toBe(21);
    expect(backlog.storiesWithAcceptanceCriteriaCount.value).toBe(15);

    // Testing Suite hardcoded to 0
    const ts = body.detailedDefinitionAndDelivery.preCoding.testingSuite;
    expect(ts.endToEndTestCount.value).toBe(0);
    expect(ts.functionalTestCount.value).toBe(0);

    // Implementation from stats
    const impl = body.detailedDefinitionAndDelivery.postCoding.implementation;
    expect(impl.featuresInProgress.value).toBe(3);
    expect(impl.storiesInProgress.value).toBe(7);
    expect(impl.storiesComplete.value).toBe(4);

    // Verification hardcoded to 0
    const verif = body.detailedDefinitionAndDelivery.postCoding.verification;
    expect(verif.storiesVerifiedCount.value).toBe(0);
    expect(verif.pendingReviewCount.value).toBe(0);

    // Post-coding summaryInsight is enabled (mocked)
    expect(body.detailedDefinitionAndDelivery.postCoding.summaryInsight.enabled).toBe(true);
    expect(body.detailedDefinitionAndDelivery.postCoding.summaryInsight.message).toBe('Mock delivery insight');
  });

  // ========================================================================
  // Test 2: When stats endpoint returns null, all stats-derived fields default to 0
  // ========================================================================
  it('defaults all stats-derived fields to 0 when fetchWorkItemStats returns null', async () => {
    mockFetchProjectFolder.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchWorkItemStats.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const body = res.body;

    // Header stats should be 0
    expect(body.header.epicsCount).toBe(0);
    expect(body.header.activeEpicsCount).toBe(0);
    expect(body.header.storiesInProgressCount).toBe(0);
    expect(body.header.initiativesCount).toBe(0);

    // Roadmap should be 0
    expect(body.strategicFoundation.roadmap.initiativesCount.value).toBe(0);
    expect(body.strategicFoundation.roadmap.epics.value).toBe(0);
    expect(body.strategicFoundation.roadmap.completed.value).toBe(0);

    // Backlog should be 0
    const backlog = body.detailedDefinitionAndDelivery.preCoding.backlog;
    expect(backlog.epicsInScope.value).toBe(0);
    expect(backlog.featuresCount.value).toBe(0);
    expect(backlog.storiesCount.value).toBe(0);
    expect(backlog.storiesWithAcceptanceCriteriaCount.value).toBe(0);

    // Implementation should be 0
    const impl = body.detailedDefinitionAndDelivery.postCoding.implementation;
    expect(impl.featuresInProgress.value).toBe(0);
    expect(impl.storiesInProgress.value).toBe(0);
    expect(impl.storiesComplete.value).toBe(0);

    // HLA should be 0
    expect(body.strategicFoundation.highLevelArchitecture.overall.value).toBe(0);
    expect(body.strategicFoundation.highLevelArchitecture.services.value).toBe(0);
    expect(body.strategicFoundation.highLevelArchitecture.interfaces.value).toBe(0);
    expect(body.strategicFoundation.highLevelArchitecture.dataStores.value).toBe(0);
  });

  // ========================================================================
  // Test 3: Default scope fallback is ENTIRE_PRODUCT
  // ========================================================================
  it('defaults scope to ENTIRE_PRODUCT when no scope query param is provided', async () => {
    mockFetchProjectFolder.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchWorkItemStats.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    expect(res.body.scope.type).toBe('ENTIRE_PRODUCT');
    expect(res.body.scope.label).toBe('Entire Product');
  });

  // ========================================================================
  // Test 4: Invalid scope defaults to ENTIRE_PRODUCT
  // ========================================================================
  it('defaults to ENTIRE_PRODUCT when an invalid scope is provided', async () => {
    mockFetchProjectFolder.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchWorkItemStats.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj&scope=INVALID_VALUE')
      .expect(200);

    expect(res.body.scope.type).toBe('ENTIRE_PRODUCT');
    expect(res.body.scope.label).toBe('Entire Product');
  });

  // ========================================================================
  // Test 5: Graceful degradation when all data sources fail (throw errors)
  // ========================================================================
  it('returns valid DTO with zero values when all data sources throw errors', async () => {
    mockFetchProjectFolder.mockRejectedValue(new Error('Connection refused'));
    mockFetchProductSummary.mockRejectedValue(new Error('Connection refused'));
    mockFetchMetaModelSummary.mockRejectedValue(new Error('Connection refused'));
    mockFetchWorkItemStats.mockRejectedValue(new Error('Connection refused'));

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const body = res.body;

    // Should still return valid shape with zero/default values
    expect(body).toHaveProperty('header');
    expect(body).toHaveProperty('strategicFoundation');
    expect(body).toHaveProperty('scope');
    expect(body).toHaveProperty('detailedDefinitionAndDelivery');

    // Stats-derived values should all be 0
    expect(body.header.epicsCount).toBe(0);
    expect(body.header.activeEpicsCount).toBe(0);
    expect(body.header.storiesInProgressCount).toBe(0);
    expect(body.header.initiativesCount).toBe(0);

    // Architecture values should be 0
    expect(body.strategicFoundation.highLevelArchitecture.overall.value).toBe(0);
  });

  // ========================================================================
  // Test 6: Stats data used correctly for header and card assembly
  // ========================================================================
  it('uses stats data correctly for header and card assembly', async () => {
    mockFetchProjectFolder.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchWorkItemStats.mockResolvedValue({
      type_counts: {
        EPIC: { PLANNED: 1, IN_PROGRESS: 2 },
        STORY: { IN_PROGRESS: 5, COMPLETED: 3 },
      },
      stories_with_ac_count: 8,
    });

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const body = res.body;

    // Header stats
    expect(body.header.epicsCount).toBe(3); // 1 + 2
    expect(body.header.activeEpicsCount).toBe(2);
    expect(body.header.storiesInProgressCount).toBe(5);

    // Backlog
    const backlog = body.detailedDefinitionAndDelivery.preCoding.backlog;
    expect(backlog.epicsInScope.value).toBe(3);
    expect(backlog.featuresCount.value).toBe(0); // No FEATURE in type_counts
    expect(backlog.storiesCount.value).toBe(8); // 5 + 3
    expect(backlog.storiesWithAcceptanceCriteriaCount.value).toBe(8);

    // Implementation
    const impl = body.detailedDefinitionAndDelivery.postCoding.implementation;
    expect(impl.featuresInProgress.value).toBe(0); // No FEATURE counts
    expect(impl.storiesInProgress.value).toBe(5);
    expect(impl.storiesComplete.value).toBe(3);
  });
});

// ============================================================================
// Task Group 4: Gap-Filling Tests (Spec 2026-03-06, Cross-Layer Verification)
// ============================================================================

describe('Dashboard Summary -- Gap-Filling Tests (Spec 2026-03-06, Task Group 4)', () => {

  afterEach(() => {
    mockFetchProjectFolder.mockReset();
    mockFetchProductSummary.mockReset();
    mockFetchMetaModelSummary.mockReset();
    mockFetchWorkItemStats.mockReset();
  });

  // ========================================================================
  // Test 7: Partial stats -- only EPIC counts, no STORY or FEATURE counts
  // Gap: Verifies STORY/FEATURE-derived fields default to 0 when those
  //      types are missing from type_counts, while EPIC fields still work.
  // ========================================================================
  it('defaults STORY and FEATURE fields to 0 when stats only contains EPIC counts', async () => {
    mockFetchProjectFolder.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchWorkItemStats.mockResolvedValue({
      type_counts: {
        EPIC: { PLANNED: 4, IN_PROGRESS: 1, COMPLETED: 2 },
      },
      stories_with_ac_count: 0,
    });

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const body = res.body;

    // EPIC-derived fields should be populated
    expect(body.header.epicsCount).toBe(7); // 4 + 1 + 2
    expect(body.header.activeEpicsCount).toBe(1);

    // STORY-derived fields should default to 0
    expect(body.header.storiesInProgressCount).toBe(0);
    const backlog = body.detailedDefinitionAndDelivery.preCoding.backlog;
    expect(backlog.storiesCount.value).toBe(0);
    expect(backlog.storiesWithAcceptanceCriteriaCount.value).toBe(0);

    // FEATURE-derived fields should default to 0
    expect(backlog.featuresCount.value).toBe(0);
    const impl = body.detailedDefinitionAndDelivery.postCoding.implementation;
    expect(impl.featuresInProgress.value).toBe(0);
    expect(impl.storiesInProgress.value).toBe(0);
    expect(impl.storiesComplete.value).toBe(0);

    // EPIC backlog should still work
    expect(backlog.epicsInScope.value).toBe(7);
  });

  // ========================================================================
  // Test 8: Null metaModel with valid stats -- architecture counts = 0,
  //         stats cards populated correctly.
  // Gap: Previous tests either had both null or both populated; this
  //      isolates metaModel=null while stats has real data.
  // ========================================================================
  it('returns architecture counts as 0 when metaModel is null but stats cards are populated', async () => {
    mockFetchProjectFolder.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchWorkItemStats.mockResolvedValue({
      type_counts: {
        EPIC: { IN_PROGRESS: 3 },
        FEATURE: { IN_PROGRESS: 2, COMPLETED: 1 },
        STORY: { PLANNED: 6, IN_PROGRESS: 4, COMPLETED: 2 },
      },
      stories_with_ac_count: 10,
    });

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const body = res.body;

    // HLA should all be 0 (metaModel is null)
    expect(body.strategicFoundation.highLevelArchitecture.services.value).toBe(0);
    expect(body.strategicFoundation.highLevelArchitecture.interfaces.value).toBe(0);
    expect(body.strategicFoundation.highLevelArchitecture.dataStores.value).toBe(0);
    expect(body.strategicFoundation.highLevelArchitecture.overall.value).toBe(0);
    expect(body.strategicFoundation.highLevelArchitecture.applications.value).toBe(0);

    // Detailed architecture should all be 0 (metaModel is null)
    const da = body.detailedDefinitionAndDelivery.preCoding.detailedArchitecture;
    expect(da.interfaceEndpoints.value).toBe(0);
    expect(da.logicalDataEntities.value).toBe(0);
    expect(da.physicalDataEntities.value).toBe(0);
    expect(da.processActivities.value).toBe(0);
    expect(da.overall.value).toBe(0);

    // Stats cards should still be populated correctly
    expect(body.header.epicsCount).toBe(3);
    expect(body.header.activeEpicsCount).toBe(3);
    expect(body.header.storiesInProgressCount).toBe(4);

    const backlog = body.detailedDefinitionAndDelivery.preCoding.backlog;
    expect(backlog.epicsInScope.value).toBe(3);
    expect(backlog.featuresCount.value).toBe(3); // 2 + 1
    expect(backlog.storiesCount.value).toBe(12); // 6 + 4 + 2
    expect(backlog.storiesWithAcceptanceCriteriaCount.value).toBe(10);

    const impl = body.detailedDefinitionAndDelivery.postCoding.implementation;
    expect(impl.featuresInProgress.value).toBe(2);
    expect(impl.storiesInProgress.value).toBe(4);
    expect(impl.storiesComplete.value).toBe(2);
  });

  // ========================================================================
  // Test 9: Detailed architecture entity_type filtering with multiple
  //         data entities of mixed types.
  // Gap: Test 1 only has one logical + one physical. This verifies correct
  //      filtering counts with multiple entities of each type.
  // ========================================================================
  it('correctly filters logicalDataEntities and physicalDataEntities by entity_type', async () => {
    mockFetchProjectFolder.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);
    mockFetchWorkItemStats.mockResolvedValue(null);
    mockFetchMetaModelSummary.mockResolvedValue({
      services: [
        { id: 's1', name: 'Svc A', entity_type: 'services' },
        { id: 's2', name: 'Svc B', entity_type: 'services' },
      ],
      data_entities: [
        { id: 'lde1', name: 'Logical 1', entity_type: 'logicalDataEntities' },
        { id: 'lde2', name: 'Logical 2', entity_type: 'logicalDataEntities' },
        { id: 'lde3', name: 'Logical 3', entity_type: 'logicalDataEntities' },
        { id: 'pde1', name: 'Physical 1', entity_type: 'physicalDataEntities' },
        { id: 'pde2', name: 'Physical 2', entity_type: 'physicalDataEntities' },
      ],
      interfaces: [
        { id: 'i1', name: 'API A', entity_type: 'interfaces' },
        { id: 'i2', name: 'API B', entity_type: 'interfaces' },
        { id: 'i3', name: 'API C', entity_type: 'interfaces' },
      ],
      relationships: [],
      // The HLA dataStores card reads the dedicated data_store_count field
      // (not data_entities.length).
      data_store_count: 5,
    });

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const body = res.body;

    // HLA counts (dataStores comes from data_store_count)
    expect(body.strategicFoundation.highLevelArchitecture.services.value).toBe(2);
    expect(body.strategicFoundation.highLevelArchitecture.interfaces.value).toBe(3);
    expect(body.strategicFoundation.highLevelArchitecture.dataStores.value).toBe(5); // data_store_count
    expect(body.strategicFoundation.highLevelArchitecture.overall.value).toBe(10); // 2 + 3 + 5

    // Detailed architecture counts (filtered by entity_type)
    const da = body.detailedDefinitionAndDelivery.preCoding.detailedArchitecture;
    expect(da.interfaceEndpoints.value).toBe(3);
    expect(da.logicalDataEntities.value).toBe(3);
    expect(da.physicalDataEntities.value).toBe(2);
    expect(da.processActivities.value).toBe(0);
    expect(da.overall.value).toBe(8); // 3 + 3 + 2 + 0
  });

  // ========================================================================
  // Test 10: Missing projectId returns 400.
  // Gap: Input validation was never tested.
  // ========================================================================
  it('returns 400 when projectId query parameter is missing', async () => {
    const res = await request(app)
      .get('/api/dashboard/summary')
      .expect(400);

    expect(res.body.error).toBe('projectId is required');
  });

  // ========================================================================
  // Test 11: Stats present but type_counts is empty {}.
  // Gap: Verifies behavior when stats endpoint returns valid response
  //      but with no actual work items (empty type_counts).
  // ========================================================================
  it('defaults all count fields to 0 when stats has empty type_counts', async () => {
    mockFetchProjectFolder.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchWorkItemStats.mockResolvedValue({
      type_counts: {},
      stories_with_ac_count: 0,
    });

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const body = res.body;

    // All count fields should be 0
    expect(body.header.epicsCount).toBe(0);
    expect(body.header.activeEpicsCount).toBe(0);
    expect(body.header.storiesInProgressCount).toBe(0);

    const backlog = body.detailedDefinitionAndDelivery.preCoding.backlog;
    expect(backlog.epicsInScope.value).toBe(0);
    expect(backlog.featuresCount.value).toBe(0);
    expect(backlog.storiesCount.value).toBe(0);
    expect(backlog.storiesWithAcceptanceCriteriaCount.value).toBe(0);

    const impl = body.detailedDefinitionAndDelivery.postCoding.implementation;
    expect(impl.featuresInProgress.value).toBe(0);
    expect(impl.storiesInProgress.value).toBe(0);
    expect(impl.storiesComplete.value).toBe(0);

    // Roadmap completed from stats should also be 0
    expect(body.strategicFoundation.roadmap.completed.value).toBe(0);
  });

  // ========================================================================
  // Test 12: Roadmap completed uses EPIC.COMPLETED from stats even
  //          when productSummary is null.
  // Gap: Verifies the cross-layer integration where roadmap.completed
  //      is sourced from the stats endpoint (not from productSummary).
  // ========================================================================
  it('populates roadmap completed from stats EPIC.COMPLETED even when productSummary is null', async () => {
    mockFetchProjectFolder.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchWorkItemStats.mockResolvedValue({
      type_counts: {
        EPIC: { PLANNED: 2, IN_PROGRESS: 3, COMPLETED: 5 },
      },
      stories_with_ac_count: 0,
    });

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const body = res.body;

    // Roadmap initiative and epic counts should be 0 (no productSummary)
    expect(body.strategicFoundation.roadmap.initiativesCount.value).toBe(0);
    expect(body.strategicFoundation.roadmap.epics.value).toBe(0);

    // But completed should come from stats EPIC.COMPLETED
    expect(body.strategicFoundation.roadmap.completed.value).toBe(5);
  });

  // ========================================================================
  // Test 13: Post-coding summaryInsight message includes real count values.
  // Gap: Previous tests only checked that summaryInsight.message is a string.
  //      This verifies the mocked delivery insight is returned correctly.
  // ========================================================================
  it('includes mocked delivery insight message in post-coding summaryInsight', async () => {
    mockFetchProjectFolder.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchWorkItemStats.mockResolvedValue({
      type_counts: {
        FEATURE: { IN_PROGRESS: 2 },
        STORY: { IN_PROGRESS: 9, COMPLETED: 6 },
      },
      stories_with_ac_count: 5,
    });

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    const body = res.body;
    const insight = body.detailedDefinitionAndDelivery.postCoding.summaryInsight;

    expect(insight.enabled).toBe(true);
    expect(typeof insight.message).toBe('string');

    // The message comes from the mocked generateDeliveryInsight
    expect(insight.message).toBe('Mock delivery insight');
  });
});
