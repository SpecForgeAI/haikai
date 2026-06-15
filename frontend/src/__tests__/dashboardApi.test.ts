/**
 * Tests for Dashboard API client
 *
 * Spec 2026-02-18: Dashboard Increment 2 -- Define Dashboard Summary Contract + Backend Mock Endpoint
 * Updated: Dashboard Increment 3 -- Build Dashboard Layout + Cards
 * Task Group 2: Frontend Types and API Client
 *
 * Tests:
 * 1. getDashboardSummary('test-proj') calls fetch with correct URL including projectId query param and no scope param when scope is omitted
 * 2. getDashboardSummary('test-proj', 'ENTIRE_PRODUCT') appends &scope=ENTIRE_PRODUCT to the URL
 * 3. getDashboardSummary returns parsed JSON typed as DashboardSummaryDto on success (200 response)
 * 4. getDashboardSummary throws an Error containing the status code on non-ok response
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('dashboardApi', () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  /**
   * Sample DashboardSummaryDto response matching the camelCase wire format.
   * Updated for Increment 3 DTO shape (no status on MetricCard, preCoding/postCoding structure).
   */
  const sampleSummaryDto = {
    header: {
      projectName: 'test-proj',
      generatedAt: '2026-02-18T12:00:00.000Z',
      initiativesCount: 2,
      epicsCount: 5,
      activeEpicsCount: 2,
      storiesInProgressCount: 6,
      lastUpdatedLabel: 'Just now',
      mode: 'GREENFIELD',
      headerInsight: '',
    },
    strategicFoundation: {
      productDefinition: {
        missionExists: { label: 'Mission Exists', value: true },
        lastUpdatedLabel: { label: 'Last Updated', value: '01/03/2026' },
      },
      highLevelArchitecture: {
        overall: { label: 'Overall', value: 12 },
        applications: { label: 'Applications', value: 5 },
        services: { label: 'Services', value: 3 },
        interfaces: { label: 'Interfaces', value: 4 },
        dataStores: { label: 'Data Stores', value: 2 },
      },
      roadmap: {
        initiativesCount: { label: 'Initiatives', value: 2 },
        epics: { label: 'Epics', value: 5 },
        completed: { label: 'Completed', value: 1 },
      },
      usersAndInteractions: {
        userRoles: { label: 'User Roles', value: 0 },
        businessActivities: { label: 'Business Activities', value: 0 },
        uiScreens: { label: 'UI Screens', value: 'No UI' },
      },
      standards: {
        orgTechStack: { label: 'Org Tech Stack', value: 'Generated' },
        productTechStack: { label: 'Product Tech Stack', value: 'Generated' },
      },
      testStrategy: {
        exists: { label: 'Exists', value: true },
        lastUpdated: { label: 'Last Updated', value: '08/03/2026' },
      },
      summaryInsight: { enabled: false, message: null },
    },
    scope: {
      type: 'NEXT_5_EPICS',
      label: 'Next 5 Epics',
      scopeValue: null,
    },
    detailedDefinitionAndDelivery: {
      preCoding: {
        backlog: {
          epicsInScope: { label: 'Epics In Scope', value: 5 },
          featuresCount: { label: 'Features', value: 10 },
          storiesCount: { label: 'Stories', value: 22 },
          storiesWithAcceptanceCriteriaCount: { label: 'Stories with AC', value: 14 },
        },
        detailedArchitecture: {
          overall: { label: 'Overall', value: 8 },
          processActivities: { label: 'Process Activities', value: 3 },
          interfaceEndpoints: { label: 'Interface Endpoints', value: 4 },
          logicalDataEntities: { label: 'Logical Data Entities', value: 2 },
          physicalDataEntities: { label: 'Physical Data Entities', value: 1 },
        },
        testingSuite: {
          endToEndTestCount: { label: 'E2E Tests', value: 3 },
          functionalTestCount: { label: 'Functional Tests', value: 8 },
        },
      },
      postCoding: {
        implementation: {
          featuresInProgress: { label: 'Features in Progress', value: 2 },
          storiesInProgress: { label: 'Stories in Progress', value: 7 },
          storiesComplete: { label: 'Stories Complete', value: 5 },
        },
        verification: {
          storiesVerifiedCount: { label: 'Stories Verified', value: 3 },
          pendingReviewCount: { label: 'Stories Pending Review', value: 2 },
        },
        summaryInsight: { enabled: false, message: null },
      },
    },
  };

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetModules();
  });

  describe('getDashboardSummary', () => {
    it('calls fetch with correct URL including projectId and no scope param when scope is omitted', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleSummaryDto,
      });

      const { getDashboardSummary } = await import('../api/dashboardApi');
      await getDashboardSummary('test-proj');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain('/api/dashboard/summary?projectId=test-proj');
      expect(url).not.toContain('scope=');
      expect(options.method).toBe('GET');
    });

    it('appends &scope=ENTIRE_PRODUCT to the URL when scope is provided', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleSummaryDto,
      });

      const { getDashboardSummary } = await import('../api/dashboardApi');
      await getDashboardSummary('test-proj', 'ENTIRE_PRODUCT');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('/api/dashboard/summary?projectId=test-proj');
      expect(url).toContain('&scope=ENTIRE_PRODUCT');
    });

    it('returns parsed JSON typed as DashboardSummaryDto on success', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleSummaryDto,
      });

      const { getDashboardSummary } = await import('../api/dashboardApi');
      const result = await getDashboardSummary('test-proj');

      expect(result).toEqual(sampleSummaryDto);
      expect(result.header.projectName).toBe('test-proj');
      expect(result.strategicFoundation.summaryInsight.enabled).toBe(false);
      expect(result.scope.type).toBe('NEXT_5_EPICS');
      expect(result.detailedDefinitionAndDelivery.preCoding.backlog.epicsInScope.label).toBe('Epics In Scope');
    });

    it('throws an Error containing the status code on non-ok response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const { getDashboardSummary } = await import('../api/dashboardApi');

      await expect(getDashboardSummary('test-proj')).rejects.toThrow('500');
    });
  });
});
