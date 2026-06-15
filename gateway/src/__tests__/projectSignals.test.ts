/**
 * Tests for ProjectSignals snapshot builder
 *
 * Spec 2026-03-04: Assistant "What's Next" v1
 * Task Group 2 (Task 2.1): Write 4-6 focused tests for ProjectSignals
 *
 * Tests the buildProjectSignals function which computes real-time
 * project state signals from filesystem and HTTP data sources.
 */

// ---- Mock fs.access from node:fs/promises ----
const mockFsAccess = jest.fn();
jest.mock('fs/promises', () => ({
  access: (...args: unknown[]) => mockFsAccess(...args),
}));

// ---- Mock architectureModelClient ----
const mockFetchProjectFolder = jest.fn();
const mockFetchMetaModelSummary = jest.fn();
const mockFetchProductSummary = jest.fn();
jest.mock('../services/architectureModelClient', () => {
  const { buildArchitectureModelClientMock } = jest.requireActual(
    '../testSetup/architectureModelClientMock'
  );
  return buildArchitectureModelClientMock({
    fetchProjectFolder: (...args: unknown[]) => mockFetchProjectFolder(...args),
    fetchMetaModelSummary: (...args: unknown[]) => mockFetchMetaModelSummary(...args),
    fetchProductSummary: (...args: unknown[]) => mockFetchProductSummary(...args),
  });
});

// ---- Mock roadmapSummaryBuilder ----
const mockHasExistingRoadmap = jest.fn();
const mockCountRoadmapItems = jest.fn();
jest.mock('../services/roadmapSummaryBuilder', () => ({
  hasExistingRoadmap: (...args: unknown[]) => mockHasExistingRoadmap(...args),
  countRoadmapItems: (...args: unknown[]) => mockCountRoadmapItems(...args),
}));

// ---- Import after mocks ----
import { buildProjectSignals } from '../services/projectSignals';

describe('buildProjectSignals (Spec 2026-03-04, Task Group 2)', () => {
  beforeEach(() => {
    mockFetchProjectFolder.mockReset();
    mockFetchProjectFolder.mockResolvedValue('/fake/base/path');
    mockFsAccess.mockReset();
    mockFetchMetaModelSummary.mockReset();
    mockFetchProductSummary.mockReset();
    mockHasExistingRoadmap.mockReset();
    mockCountRoadmapItems.mockReset();
  });

  // ========================================================================
  // Test 1: All signals true -- all files exist, roadmap exists, architecture baseline exists
  // ========================================================================
  it('returns all booleans true and epicCount from countRoadmapItems when all data sources succeed', async () => {
    // All file checks succeed (uppercase paths found)
    mockFsAccess.mockResolvedValue(undefined);

    // Meta-model has meaningful entities
    mockFetchMetaModelSummary.mockResolvedValue({
      services: [{ id: '1', name: 'Auth Service' }],
      data_entities: [{ id: '2', name: 'User' }],
      interfaces: [{ id: '3', name: 'REST API' }],
      relationships: [],
      business_users: [{ id: '4', name: 'Admin' }],
      process_activities: [],
      ui_screens: [],
    });

    // Product summary has roadmap
    const mockProductSummary = { initiatives: [{ title: 'Init 1', epics: [{ title: 'Epic 1' }] }] };
    mockFetchProductSummary.mockResolvedValue(mockProductSummary);
    mockHasExistingRoadmap.mockReturnValue(true);
    mockCountRoadmapItems.mockReturnValue({ initiativeCount: 1, epicCount: 3 });

    const signals = await buildProjectSignals('test-project');

    expect(signals.missionExists).toBe(true);
    expect(signals.techStandardsExists).toBe(true);
    expect(signals.testStrategyExists).toBe(true);
    expect(signals.roadmapExists).toBe(true);
    expect(signals.architectureBaselineExists).toBe(true);
    expect(signals.usersAndInteractionsExists).toBe(true);
    expect(signals.epicCount).toBe(3);
  });

  // ========================================================================
  // Test 2: All signals false -- no files, no roadmap, no architecture
  // ========================================================================
  it('returns all booleans false and epicCount 0 when no data sources succeed', async () => {
    // All file checks fail
    mockFsAccess.mockRejectedValue(new Error('ENOENT'));

    // Meta-model returns null (empty)
    mockFetchMetaModelSummary.mockResolvedValue(null);

    // Product summary returns null
    mockFetchProductSummary.mockResolvedValue(null);

    const signals = await buildProjectSignals('test-project');

    expect(signals.missionExists).toBe(false);
    expect(signals.techStandardsExists).toBe(false);
    expect(signals.testStrategyExists).toBe(false);
    expect(signals.roadmapExists).toBe(false);
    expect(signals.architectureBaselineExists).toBe(false);
    expect(signals.usersAndInteractionsExists).toBe(false);
    expect(signals.epicCount).toBe(0);
  });

  // ========================================================================
  // Test 3: Uppercase/lowercase fallback -- MISSION.MD exists (uppercase),
  //          tech-stack.md exists (lowercase fallback)
  // ========================================================================
  it('finds mission via uppercase and tech-stack via lowercase fallback', async () => {
    // MISSION.MD (uppercase) exists -- accept calls to uppercase mission path
    // TECH-STACK.MD (uppercase) fails, tech-stack.md (lowercase) succeeds
    // TEST-STRATEGY.MD fails for both
    mockFsAccess.mockImplementation((filePath: string) => {
      const normalized = filePath.replace(/\\/g, '/');
      if (normalized.endsWith('MISSION.MD')) return Promise.resolve(undefined);
      if (normalized.endsWith('TECH-STACK.MD')) return Promise.reject(new Error('ENOENT'));
      if (normalized.endsWith('tech-stack.md')) return Promise.resolve(undefined);
      // All others fail
      return Promise.reject(new Error('ENOENT'));
    });

    mockFetchMetaModelSummary.mockResolvedValue({ services: [], data_entities: [], interfaces: [], relationships: [] });
    mockFetchProductSummary.mockResolvedValue(null);

    const signals = await buildProjectSignals('test-project');

    expect(signals.missionExists).toBe(true);
    expect(signals.techStandardsExists).toBe(true);
    expect(signals.testStrategyExists).toBe(false);
  });

  // ========================================================================
  // Test 4: fetchMetaModelSummary throws -- architectureBaselineExists defaults to false
  // ========================================================================
  it('defaults architectureBaselineExists to false when fetchMetaModelSummary throws', async () => {
    mockFsAccess.mockRejectedValue(new Error('ENOENT'));
    mockFetchMetaModelSummary.mockRejectedValue(new Error('Service unavailable'));
    mockFetchProductSummary.mockResolvedValue(null);

    const signals = await buildProjectSignals('test-project');

    expect(signals.architectureBaselineExists).toBe(false);
  });

  // ========================================================================
  // Test 5: fetchProductSummary throws -- roadmapExists and epicCount default
  // ========================================================================
  it('defaults roadmapExists to false and epicCount to 0 when fetchProductSummary throws', async () => {
    mockFsAccess.mockRejectedValue(new Error('ENOENT'));
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchProductSummary.mockRejectedValue(new Error('Service unavailable'));

    const signals = await buildProjectSignals('test-project');

    expect(signals.roadmapExists).toBe(false);
    expect(signals.epicCount).toBe(0);
  });

  // ========================================================================
  // Test 6: Story-level signals always 0 regardless of inputs
  // ========================================================================
  it('always returns 0 for all story-level signals', async () => {
    // Even with all data sources succeeding
    mockFsAccess.mockResolvedValue(undefined);
    mockFetchMetaModelSummary.mockResolvedValue({
      services: [{ id: '1', name: 'Svc' }],
      data_entities: [],
      interfaces: [],
      relationships: [],
    });
    const mockProductSummary = { initiatives: [{ title: 'Init', epics: [] }] };
    mockFetchProductSummary.mockResolvedValue(mockProductSummary);
    mockHasExistingRoadmap.mockReturnValue(true);
    mockCountRoadmapItems.mockReturnValue({ initiativeCount: 1, epicCount: 5 });

    const signals = await buildProjectSignals('test-project');

    expect(signals.storyCount).toBe(0);
    expect(signals.storiesWithAC).toBe(0);
    expect(signals.storiesInProgress).toBe(0);
    expect(signals.storiesDone).toBe(0);
    expect(signals.storiesVerified).toBe(0);
  });
});
