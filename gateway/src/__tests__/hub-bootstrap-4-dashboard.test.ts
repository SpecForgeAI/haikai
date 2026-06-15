/**
 * Tests for Dashboard Summary -- TECH-STACK.MD and TEST-STRATEGY.MD Exists Checks
 *
 * Spec 2026-03-01: Hub Bootstrap 4 -- SA Tech Stack + TE Test Strategy End-to-End
 * Task Group 4: Backend Dashboard Integration (R14)
 *
 * Tests:
 * 1. When TECH-STACK.MD exists on disk, strategicFoundation.standards.orgTechStack.value is 'Generated';
 *    when missing, it is 'Not Generated'
 * 2. When TEST-STRATEGY.MD exists on disk, strategicFoundation.testStrategy.exists.value is true;
 *    when missing, it is false
 * 3. Both checks use two-path fallback (TECH-STACK.MD then tech-stack.md;
 *    TEST-STRATEGY.MD then test-strategy.md) and do not throw on missing files
 *
 * Uses supertest + express app pattern following existing gateway route tests.
 * Mocks fs.access to control file existence and mocks fetchMetaModelSummary / fetchProductSummary
 * to avoid unrelated network calls.
 */

// ---- Mock dashboardInsightGenerator to avoid real LLM calls ----
jest.mock('../services/dashboardInsightGenerator', () => ({
  generateHeaderInsight: jest.fn().mockResolvedValue('Mock header insight'),
  generateDeliveryInsight: jest.fn().mockResolvedValue('Mock delivery insight'),
}));

// ---- Mock fetchMetaModelSummary and fetchProductSummary before any imports ----
const mockFetchMetaModelSummary = jest.fn();
const mockFetchProductSummary = jest.fn();
jest.mock('../services/architectureModelClient', () => {
  const actual = jest.requireActual('../services/architectureModelClient');
  return {
    ...actual,
    fetchMetaModelSummary: (...args: unknown[]) => mockFetchMetaModelSummary(...args),
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

// ---- Mock fs/promises to control file existence ----
const realFsPromises = jest.requireActual('fs/promises');
const mockFsAccess = jest.fn();
jest.mock('fs/promises', () => ({
  ...realFsPromises,
  access: (...args: unknown[]) => mockFsAccess(...args),
}));

import request from 'supertest';
import { app } from '../server';

describe('Dashboard Summary -- TECH-STACK.MD and TEST-STRATEGY.MD Exists Checks (Spec 2026-03-01, Task Group 4)', () => {

  afterEach(() => {
    mockFetchMetaModelSummary.mockReset();
    mockFetchProductSummary.mockReset();
    mockFsAccess.mockReset();
  });

  // ========================================================================
  // Test 1: TECH-STACK.MD exists -> orgTechStack.value is 'Generated';
  //         TECH-STACK.MD missing -> orgTechStack.value is 'Not Generated'
  // ========================================================================
  it('returns orgTechStack.value Generated when TECH-STACK.MD exists, Not Generated when missing', async () => {
    // Arrange: both service calls return null to avoid side effects
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);

    // --- Sub-case A: TECH-STACK.MD exists ---
    // fs.access succeeds for MISSION.MD (so mission check passes) and TECH-STACK.MD
    mockFsAccess.mockImplementation((filePath: string) => {
      if (filePath.includes('TECH-STACK.MD') || filePath.includes('tech-stack.md')) {
        return Promise.resolve();
      }
      if (filePath.includes('MISSION.MD') || filePath.includes('mission.md')) {
        return Promise.resolve();
      }
      if (filePath.includes('TEST-STRATEGY.MD') || filePath.includes('test-strategy.md')) {
        return Promise.resolve();
      }
      return Promise.resolve();
    });

    const resExists = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    expect(resExists.body.strategicFoundation.standards.orgTechStack.value).toBe('Generated');
    expect(resExists.body.strategicFoundation.standards.orgTechStack.label).toBe('Org Tech Stack');

    // --- Sub-case B: TECH-STACK.MD does NOT exist ---
    mockFsAccess.mockReset();
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);

    mockFsAccess.mockImplementation((filePath: string) => {
      if (filePath.includes('TECH-STACK.MD') || filePath.includes('tech-stack.md')) {
        const err: NodeJS.ErrnoException = new Error('ENOENT');
        err.code = 'ENOENT';
        return Promise.reject(err);
      }
      // Let other access calls succeed
      return Promise.resolve();
    });

    const resMissing = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    expect(resMissing.body.strategicFoundation.standards.orgTechStack.value).toBe('Not Generated');
    expect(resMissing.body.strategicFoundation.standards.orgTechStack.label).toBe('Org Tech Stack');
  });

  // ========================================================================
  // Test 2: TEST-STRATEGY.MD exists -> testStrategy.exists.value is true;
  //         TEST-STRATEGY.MD missing -> testStrategy.exists.value is false
  // ========================================================================
  it('returns testStrategy.exists.value true when TEST-STRATEGY.MD exists, false when missing', async () => {
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);

    // --- Sub-case A: TEST-STRATEGY.MD exists ---
    mockFsAccess.mockImplementation((filePath: string) => {
      if (filePath.includes('TEST-STRATEGY.MD') || filePath.includes('test-strategy.md')) {
        return Promise.resolve();
      }
      if (filePath.includes('MISSION.MD') || filePath.includes('mission.md')) {
        return Promise.resolve();
      }
      if (filePath.includes('TECH-STACK.MD') || filePath.includes('tech-stack.md')) {
        return Promise.resolve();
      }
      return Promise.resolve();
    });

    const resExists = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    expect(resExists.body.strategicFoundation.testStrategy.exists.value).toBe(true);
    expect(resExists.body.strategicFoundation.testStrategy.exists.label).toBe('Exists');

    // --- Sub-case B: TEST-STRATEGY.MD does NOT exist ---
    mockFsAccess.mockReset();
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);

    mockFsAccess.mockImplementation((filePath: string) => {
      if (filePath.includes('TEST-STRATEGY.MD') || filePath.includes('test-strategy.md')) {
        const err: NodeJS.ErrnoException = new Error('ENOENT');
        err.code = 'ENOENT';
        return Promise.reject(err);
      }
      return Promise.resolve();
    });

    const resMissing = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    expect(resMissing.body.strategicFoundation.testStrategy.exists.value).toBe(false);
    expect(resMissing.body.strategicFoundation.testStrategy.exists.label).toBe('Exists');
  });

  // ========================================================================
  // Test 3: Two-path fallback works and does not throw on missing files
  // ========================================================================
  it('uses two-path fallback for both files and does not throw on missing', async () => {
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);

    // Simulate: uppercase filenames fail, lowercase filenames succeed
    // This verifies the fallback path is actually used
    const accessedPaths: string[] = [];
    mockFsAccess.mockImplementation((filePath: string) => {
      accessedPaths.push(filePath);

      // MISSION.MD -- let it succeed on uppercase
      if (filePath.includes('MISSION.MD')) {
        return Promise.resolve();
      }

      // TECH-STACK.MD uppercase fails, lowercase succeeds
      if (filePath.includes('TECH-STACK.MD')) {
        const err: NodeJS.ErrnoException = new Error('ENOENT');
        err.code = 'ENOENT';
        return Promise.reject(err);
      }
      if (filePath.includes('tech-stack.md')) {
        return Promise.resolve(); // fallback succeeds
      }

      // TEST-STRATEGY.MD uppercase fails, lowercase succeeds
      if (filePath.includes('TEST-STRATEGY.MD')) {
        const err: NodeJS.ErrnoException = new Error('ENOENT');
        err.code = 'ENOENT';
        return Promise.reject(err);
      }
      if (filePath.includes('test-strategy.md')) {
        return Promise.resolve(); // fallback succeeds
      }

      return Promise.resolve();
    });

    const res = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    // Both should be found via lowercase fallback
    expect(res.body.strategicFoundation.standards.orgTechStack.value).toBe('Generated');
    expect(res.body.strategicFoundation.standards.orgTechStack.label).toBe('Org Tech Stack');
    expect(res.body.strategicFoundation.testStrategy.exists.value).toBe(true);
    expect(res.body.strategicFoundation.testStrategy.exists.label).toBe('Exists');

    // Verify that both uppercase and lowercase paths were attempted
    const techStackUpperAttempted = accessedPaths.some(p => p.includes('TECH-STACK.MD'));
    const techStackLowerAttempted = accessedPaths.some(p => p.includes('tech-stack.md'));
    const testStrategyUpperAttempted = accessedPaths.some(p => p.includes('TEST-STRATEGY.MD'));
    const testStrategyLowerAttempted = accessedPaths.some(p => p.includes('test-strategy.md'));

    expect(techStackUpperAttempted).toBe(true);
    expect(techStackLowerAttempted).toBe(true);
    expect(testStrategyUpperAttempted).toBe(true);
    expect(testStrategyLowerAttempted).toBe(true);

    // Also verify endpoint does not throw -- we already got 200 above,
    // but let's also test both completely missing (no throw)
    mockFsAccess.mockReset();
    mockFetchMetaModelSummary.mockResolvedValue(null);
    mockFetchProductSummary.mockResolvedValue(null);

    mockFsAccess.mockImplementation((filePath: string) => {
      // MISSION.MD succeeds
      if (filePath.includes('MISSION.MD')) {
        return Promise.resolve();
      }
      // Everything else fails
      const err: NodeJS.ErrnoException = new Error('ENOENT');
      err.code = 'ENOENT';
      return Promise.reject(err);
    });

    const resBothMissing = await request(app)
      .get('/api/dashboard/summary?projectId=test-proj')
      .expect(200);

    // Both should report not generated / false without throwing
    expect(resBothMissing.body.strategicFoundation.standards.orgTechStack.value).toBe('Not Generated');
    expect(resBothMissing.body.strategicFoundation.testStrategy.exists.value).toBe(false);
  });
});
