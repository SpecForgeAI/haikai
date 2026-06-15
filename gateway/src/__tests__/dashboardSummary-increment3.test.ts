/**
 * Tests for Dashboard Summary DTO -- Increment 3 Updates
 *
 * Validates the updated DTO shape and mock service changes:
 * - MetricCard has only label and value (no status)
 * - strategicFoundation.standards exists with orgTechStack/productTechStack
 * - detailedDefinitionAndDelivery has preCoding/postCoding sub-objects
 * - productDefinition contains missionExists, lastUpdatedLabel
 * - roadmap is RoadmapMetrics with initiativesCount, epics, completed
 * - header contains new fields: initiativesCount, epicsCount, activeEpicsCount, storiesInProgressCount, lastUpdatedLabel, mode
 *
 * Uses supertest + express app pattern following existing gateway route tests.
 *
 * Spec 2026-02-18: Dashboard Increment 3 -- Build Dashboard Layout + Cards
 */

// ---- Mock dashboardInsightGenerator to avoid real LLM calls ----
jest.mock('../services/dashboardInsightGenerator', () => ({
  generateHeaderInsight: jest.fn().mockResolvedValue('Mock header insight'),
  generateDeliveryInsight: jest.fn().mockResolvedValue('Mock delivery insight'),
}));

import request from 'supertest';
import { app } from '../server';

describe('Dashboard Summary -- Increment 3 DTO Updates', () => {

  // ---- Test 1: MetricCard has only label and value (no status) ----
  describe('MetricCard shape', () => {
    it('MetricCard objects have only label and value, no status field', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=test-proj')
        .expect(200);

      const body = res.body;

      // Check a strategic foundation metric card (HLA applications)
      const appCard = body.strategicFoundation.highLevelArchitecture.applications;
      expect(appCard).toHaveProperty('label');
      expect(appCard).toHaveProperty('value');
      expect(appCard).not.toHaveProperty('status');

      // Check a post-coding metric card (implementation.featuresInProgress)
      const implCard = body.detailedDefinitionAndDelivery.postCoding.implementation.featuresInProgress;
      expect(implCard).toHaveProperty('label');
      expect(implCard).toHaveProperty('value');
      expect(implCard).not.toHaveProperty('status');
    });
  });

  // ---- Test 2: strategicFoundation.standards exists with sub-fields ----
  describe('strategicFoundation.standards', () => {
    it('contains orgTechStack and productTechStack MetricCard sub-fields', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=test-proj')
        .expect(200);

      const standards = res.body.strategicFoundation.standards;
      expect(standards).toBeDefined();
      expect(standards).toHaveProperty('orgTechStack');
      expect(standards).toHaveProperty('productTechStack');
      expect(standards.orgTechStack).toHaveProperty('label');
      expect(standards.orgTechStack).toHaveProperty('value');
      expect(typeof standards.orgTechStack.value).toBe('string');
      expect(standards.productTechStack).toHaveProperty('label');
      expect(standards.productTechStack).toHaveProperty('value');
      expect(typeof standards.productTechStack.value).toBe('string');
    });
  });

  // ---- Test 3: detailedDefinitionAndDelivery has preCoding/postCoding sub-objects ----
  describe('detailedDefinitionAndDelivery structure', () => {
    it('has preCoding and postCoding sub-objects with correct nested fields', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=test-proj')
        .expect(200);

      const dd = res.body.detailedDefinitionAndDelivery;

      // preCoding sub-object
      expect(dd).toHaveProperty('preCoding');
      expect(dd.preCoding).toHaveProperty('backlog');
      expect(dd.preCoding).toHaveProperty('detailedArchitecture');
      expect(dd.preCoding).toHaveProperty('testingSuite');

      // Backlog sub-fields
      expect(dd.preCoding.backlog).toHaveProperty('epicsInScope');
      expect(dd.preCoding.backlog).toHaveProperty('featuresCount');
      expect(dd.preCoding.backlog).toHaveProperty('storiesCount');
      expect(dd.preCoding.backlog).toHaveProperty('storiesWithAcceptanceCriteriaCount');

      // TestingSuite sub-fields
      expect(dd.preCoding.testingSuite).toHaveProperty('endToEndTestCount');
      expect(dd.preCoding.testingSuite).toHaveProperty('functionalTestCount');

      // postCoding sub-object
      expect(dd).toHaveProperty('postCoding');
      expect(dd.postCoding).toHaveProperty('implementation');
      expect(dd.postCoding).toHaveProperty('verification');
      expect(dd.postCoding).toHaveProperty('summaryInsight');

      // Verification sub-fields
      expect(dd.postCoding.verification).toHaveProperty('storiesVerifiedCount');
      expect(dd.postCoding.verification).toHaveProperty('pendingReviewCount');
    });
  });

  // ---- Test 4: productDefinition contains missionExists, lastUpdatedLabel ----
  describe('strategicFoundation.productDefinition', () => {
    it('contains missionExists and lastUpdatedLabel MetricCard fields', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=test-proj')
        .expect(200);

      const pd = res.body.strategicFoundation.productDefinition;

      expect(pd).toHaveProperty('missionExists');
      expect(pd.missionExists).toHaveProperty('label');
      expect(pd.missionExists).toHaveProperty('value');

      expect(pd).toHaveProperty('lastUpdatedLabel');
      expect(pd.lastUpdatedLabel).toHaveProperty('label');
      expect(pd.lastUpdatedLabel).toHaveProperty('value');
    });
  });

  // ---- Test 5: roadmap is RoadmapMetrics with correct sub-fields ----
  describe('strategicFoundation.roadmap', () => {
    it('is a RoadmapMetrics object with initiativesCount, epics, completed', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=test-proj')
        .expect(200);

      const roadmap = res.body.strategicFoundation.roadmap;

      expect(roadmap).toHaveProperty('initiativesCount');
      expect(roadmap.initiativesCount).toHaveProperty('label');
      expect(roadmap.initiativesCount).toHaveProperty('value');

      expect(roadmap).toHaveProperty('epics');
      expect(roadmap.epics).toHaveProperty('label');
      expect(roadmap.epics).toHaveProperty('value');

      expect(roadmap).toHaveProperty('completed');
      expect(roadmap.completed).toHaveProperty('label');
      expect(roadmap.completed).toHaveProperty('value');
    });
  });

  // ---- Test 6: header contains new fields ----
  describe('header new fields', () => {
    it('contains initiativesCount, epicsCount, activeEpicsCount, storiesInProgressCount, lastUpdatedLabel, and mode', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary?projectId=test-proj')
        .expect(200);

      const header = res.body.header;

      expect(header).toHaveProperty('initiativesCount');
      expect(typeof header.initiativesCount).toBe('number');

      expect(header).toHaveProperty('epicsCount');
      expect(typeof header.epicsCount).toBe('number');

      expect(header).toHaveProperty('activeEpicsCount');
      expect(typeof header.activeEpicsCount).toBe('number');

      expect(header).toHaveProperty('storiesInProgressCount');
      expect(typeof header.storiesInProgressCount).toBe('number');

      expect(header).toHaveProperty('lastUpdatedLabel');
      expect(typeof header.lastUpdatedLabel).toBe('string');

      expect(header).toHaveProperty('mode');
      expect(header.mode).toBe('GREENFIELD');
    });
  });

});
