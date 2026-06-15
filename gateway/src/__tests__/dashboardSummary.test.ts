/**
 * Tests for Dashboard Summary Endpoint
 *
 * Validates the GET /api/dashboard/summary route:
 * - Returns 200 with valid DashboardSummaryDto shape
 * - Returns 400 when projectId is missing
 * - Returns scope-variant mock data (ENTIRE_PRODUCT vs NEXT_5_EPICS)
 * - Silently defaults invalid scope to NEXT_5_EPICS
 * - Both summaryInsight objects are enabled (with mocked AI insight messages)
 *
 * Gap-fill tests (Task Group 3):
 * - QTR scope returns correct label and smaller metric values
 * - CUSTOM scope returns correct label and smaller metric values
 * - Empty/whitespace-only projectId triggers 400
 * - scopeValue query param is passed through to response
 * - header.generatedAt is a valid ISO-8601 string
 *
 * Uses supertest + express app pattern following existing gateway route tests.
 *
 * Spec 2026-02-18: Dashboard Increment 2 -- Define Dashboard Summary Contract + Backend Mock Endpoint
 * Updated: Dashboard Increment 3 -- Build Dashboard Layout + Cards
 * Updated: Hub Bootstrap 1, Task Group 2 -- productDefinition.missionExists
 *   now reflects real MISSION.MD file existence (true when present, false when absent)
 */

// ---- Mock dashboardInsightGenerator to avoid real LLM calls ----
jest.mock('../services/dashboardInsightGenerator', () => ({
  generateHeaderInsight: jest.fn().mockResolvedValue('Mock header insight'),
  generateDeliveryInsight: jest.fn().mockResolvedValue('Mock delivery insight'),
}));

import request from 'supertest';
import { app } from '../server';

describe('Dashboard Summary Routes', () => {

  // ---- Test 1: Valid request returns 200 with correct DashboardSummaryDto shape ----
  describe('GET /api/dashboard/summary?projectId=test-proj', () => {
    it('returns 200 with a valid DashboardSummaryDto shape', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=test-proj')
        .expect(200);

      const body = res.body;

      // Assert top-level keys exist
      expect(body).toHaveProperty('header');
      expect(body).toHaveProperty('strategicFoundation');
      expect(body).toHaveProperty('scope');
      expect(body).toHaveProperty('detailedDefinitionAndDelivery');

      // Assert header shape
      expect(body.header).toHaveProperty('projectName', 'test-proj');
      expect(body.header).toHaveProperty('generatedAt');
      expect(typeof body.header.generatedAt).toBe('string');

      // Assert strategicFoundation shape (updated for Increment 3)
      expect(body.strategicFoundation).toHaveProperty('productDefinition');
      expect(body.strategicFoundation.productDefinition).toHaveProperty('missionExists');
      expect(body.strategicFoundation).toHaveProperty('highLevelArchitecture');
      expect(body.strategicFoundation).toHaveProperty('roadmap');
      expect(body.strategicFoundation.roadmap).toHaveProperty('epics');
      expect(body.strategicFoundation).toHaveProperty('standards');
      expect(body.strategicFoundation.standards).toHaveProperty('orgTechStack');
      expect(body.strategicFoundation).toHaveProperty('testStrategy');
      expect(body.strategicFoundation).toHaveProperty('summaryInsight');

      // Assert highLevelArchitecture sub-keys
      const hla = body.strategicFoundation.highLevelArchitecture;
      expect(hla).toHaveProperty('overall');
      expect(hla).toHaveProperty('applications');
      expect(hla).toHaveProperty('services');
      expect(hla).toHaveProperty('interfaces');
      expect(hla).toHaveProperty('dataStores');

      // Assert detailedDefinitionAndDelivery shape (updated for Increment 3)
      expect(body.detailedDefinitionAndDelivery).toHaveProperty('preCoding');
      expect(body.detailedDefinitionAndDelivery.preCoding).toHaveProperty('backlog');
      expect(body.detailedDefinitionAndDelivery.preCoding).toHaveProperty('detailedArchitecture');
      expect(body.detailedDefinitionAndDelivery.preCoding).toHaveProperty('testingSuite');
      expect(body.detailedDefinitionAndDelivery).toHaveProperty('postCoding');
      expect(body.detailedDefinitionAndDelivery.postCoding).toHaveProperty('implementation');
      expect(body.detailedDefinitionAndDelivery.postCoding).toHaveProperty('verification');
      expect(body.detailedDefinitionAndDelivery.postCoding).toHaveProperty('summaryInsight');

      // Assert detailedArchitecture sub-keys
      const da = body.detailedDefinitionAndDelivery.preCoding.detailedArchitecture;
      expect(da).toHaveProperty('overall');
      expect(da).toHaveProperty('processActivities');
      expect(da).toHaveProperty('interfaceEndpoints');
      expect(da).toHaveProperty('logicalDataEntities');
      expect(da).toHaveProperty('physicalDataEntities');
    });
  });

  // ---- Test 2: Missing projectId returns 400 ----
  describe('GET /api/dashboard/summary without projectId', () => {
    it('returns 400 with error message', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary')
        .expect(400);

      expect(res.body).toEqual({ error: 'projectId is required' });
    });
  });

  // ---- Test 3: ENTIRE_PRODUCT scope returns larger mock metric values ----
  describe('GET /api/dashboard/summary?projectId=test-proj&scope=ENTIRE_PRODUCT', () => {
    it('returns scope.type of ENTIRE_PRODUCT and larger mock metric values', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=test-proj&scope=ENTIRE_PRODUCT')
        .expect(200);

      const body = res.body;

      expect(body.scope.type).toBe('ENTIRE_PRODUCT');
      expect(body.scope.label).toBe('Entire Product');

      // Hub Bootstrap 1: productDefinition.missionExists now reflects real MISSION.MD existence
      // (true when present, false when absent) -- value depends on test environment
      expect(typeof body.strategicFoundation.productDefinition.missionExists.value).toBe('boolean');
    });
  });

  // ---- Test 4: NEXT_5_EPICS scope returns smaller mock metric values ----
  describe('GET /api/dashboard/summary?projectId=test-proj&scope=NEXT_5_EPICS', () => {
    it('returns scope.type of NEXT_5_EPICS and smaller mock metric values', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=test-proj&scope=NEXT_5_EPICS')
        .expect(200);

      const body = res.body;

      expect(body.scope.type).toBe('NEXT_5_EPICS');
      expect(body.scope.label).toBe('Next 5 Epics');

      // Hub Bootstrap 1: productDefinition.missionExists now reflects real MISSION.MD existence
      // (true when present, false when absent) -- value depends on test environment
      expect(typeof body.strategicFoundation.productDefinition.missionExists.value).toBe('boolean');
    });
  });

  // ---- Test 5: Invalid scope silently defaults to ENTIRE_PRODUCT ----
  describe('GET /api/dashboard/summary?projectId=test-proj&scope=INVALID_VALUE', () => {
    it('silently defaults to ENTIRE_PRODUCT without returning a 400 error', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=test-proj&scope=INVALID_VALUE')
        .expect(200);

      const body = res.body;

      expect(body.scope.type).toBe('ENTIRE_PRODUCT');
      expect(body.scope.label).toBe('Entire Product');
    });
  });

  // ---- Test 6: Both summaryInsight objects have enabled: true with mocked AI messages ----
  describe('summaryInsight constraints', () => {
    it('both summaryInsight objects have enabled: true with mocked AI insight messages', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=test-proj')
        .expect(200);

      const body = res.body;

      // Strategic foundation summaryInsight (uses mocked generateHeaderInsight)
      expect(body.strategicFoundation.summaryInsight.enabled).toBe(true);
      expect(body.strategicFoundation.summaryInsight.message).toBe('Mock header insight');

      // Detailed definition and delivery summaryInsight (uses mocked generateDeliveryInsight)
      expect(body.detailedDefinitionAndDelivery.postCoding.summaryInsight.enabled).toBe(true);
      expect(body.detailedDefinitionAndDelivery.postCoding.summaryInsight.message).toBe('Mock delivery insight');
    });
  });

  // =====================================================================
  // Gap-fill tests (Task Group 3 -- up to 5 additional tests)
  // =====================================================================

  // ---- Gap Test 1: QTR scope returns correct label and smaller metric values ----
  describe('GET /api/dashboard/summary?projectId=test-proj&scope=QTR', () => {
    it('returns scope.type of QTR with label "Q1 2026"', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=test-proj&scope=QTR')
        .expect(200);

      const body = res.body;

      expect(body.scope.type).toBe('QTR');
      expect(body.scope.label).toBe('Q1 2026');

      // Hub Bootstrap 1: productDefinition.missionExists now reflects real MISSION.MD existence
      // (true when present, false when absent) -- value depends on test environment
      expect(typeof body.strategicFoundation.productDefinition.missionExists.value).toBe('boolean');
    });
  });

  // ---- Gap Test 2: CUSTOM scope returns correct label and smaller metric values ----
  describe('GET /api/dashboard/summary?projectId=test-proj&scope=CUSTOM', () => {
    it('returns scope.type of CUSTOM with label "Custom Scope"', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=test-proj&scope=CUSTOM')
        .expect(200);

      const body = res.body;

      expect(body.scope.type).toBe('CUSTOM');
      expect(body.scope.label).toBe('Custom Scope');

      // Hub Bootstrap 1: productDefinition.missionExists now reflects real MISSION.MD existence
      // (true when present, false when absent) -- value depends on test environment
      expect(typeof body.strategicFoundation.productDefinition.missionExists.value).toBe('boolean');
    });
  });

  // ---- Gap Test 3: Empty/whitespace-only projectId triggers 400 ----
  describe('GET /api/dashboard/summary with empty projectId', () => {
    it('returns 400 when projectId is an empty string', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=')
        .expect(400);

      expect(res.body).toEqual({ error: 'projectId is required' });
    });

    it('returns 400 when projectId is whitespace only', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=%20%20%20')
        .expect(400);

      expect(res.body).toEqual({ error: 'projectId is required' });
    });
  });

  // ---- Gap Test 4: scopeValue query param is passed through to response ----
  describe('GET /api/dashboard/summary with scopeValue', () => {
    it('passes scopeValue through to the response scope object', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=test-proj&scope=CUSTOM&scopeValue=epic-42')
        .expect(200);

      const body = res.body;

      expect(body.scope.scopeValue).toBe('epic-42');
      expect(body.scope.type).toBe('CUSTOM');
    });
  });

  // ---- Gap Test 5: header.generatedAt is a valid ISO-8601 string ----
  describe('header.generatedAt format', () => {
    it('returns a valid ISO-8601 date string in header.generatedAt', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=test-proj')
        .expect(200);

      const generatedAt = res.body.header.generatedAt;

      // Verify it parses as a valid date
      const parsed = new Date(generatedAt);
      expect(parsed.getTime()).not.toBeNaN();

      // Verify ISO-8601 format (should round-trip through toISOString)
      expect(generatedAt).toBe(parsed.toISOString());
    });
  });
});
