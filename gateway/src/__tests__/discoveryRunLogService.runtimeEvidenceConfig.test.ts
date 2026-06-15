/**
 * Gateway log-files upload route + service: forward `runtimeEvidenceConfig`
 *
 * Spec 2026-05-11: Discovery Run Robustness -- Section 1
 * Task Group 4.1: 2 focused tests covering the gateway pass-through.
 *
 * Coverage:
 *   1. POST /…/log-files with `runtimeEvidenceConfig` in the multipart body
 *      forwards the field to AMS in the PATCH body alongside `logFiles` and
 *      `attemptedCount`.
 *   2. Backwards-compat: request WITHOUT `runtimeEvidenceConfig` results in a
 *      PATCH body to AMS that omits the field entirely.
 *
 * Mocking pattern (matches the existing discoveryRunLogService.test.ts):
 *   - jest.mock('fs/promises') with explicit factory.
 *   - architectureModelClient mocked using `jest.requireActual` spread so
 *     unrelated functions remain real.
 */

// ---- Mock fs/promises ----
const mockFsMkdir = jest.fn();
const mockFsWriteFile = jest.fn();
jest.mock('fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockFsMkdir(...args),
  writeFile: (...args: unknown[]) => mockFsWriteFile(...args),
}));

// ---- Mock architectureModelClient (preserve unrelated functions) ----
const mockFetchProjectFolder = jest.fn();
const mockPatchDiscoveryRunLogFileArtifacts = jest.fn();
jest.mock('../services/architectureModelClient', () => {
  const actual = jest.requireActual('../services/architectureModelClient');
  return {
    ...actual,
    fetchProjectFolder: (...args: unknown[]) => mockFetchProjectFolder(...args),
    patchDiscoveryRunLogFileArtifacts: (...args: unknown[]) =>
      mockPatchDiscoveryRunLogFileArtifacts(...args),
  };
});

// ---- Mock uuid so artifactId is deterministic ----
let uuidCounter = 0;
jest.mock('uuid', () => ({
  v4: () => `uuid-${++uuidCounter}`,
}));

// ---- Mock logger ----
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ---- Imports AFTER mocks ----
import request from 'supertest';
import express from 'express';
import { discoveryRouter } from '../routes/discovery';

describe('Gateway log-files upload: runtimeEvidenceConfig pass-through (Spec 2026-05-11 Section 1)', () => {
  beforeEach(() => {
    mockFsMkdir.mockReset();
    mockFsWriteFile.mockReset();
    mockFetchProjectFolder.mockReset();
    mockPatchDiscoveryRunLogFileArtifacts.mockReset();
    uuidCounter = 0;

    mockFetchProjectFolder.mockResolvedValue('/projects/proj-1');
    mockFsMkdir.mockResolvedValue(undefined);
    mockFsWriteFile.mockResolvedValue(undefined);
    mockPatchDiscoveryRunLogFileArtifacts.mockResolvedValue({
      logFiles: [],
      attemptedCount: 1,
    });
  });

  const buildApp = () => {
    const app = express();
    app.use('/api/v1/discovery', discoveryRouter);
    return app;
  };

  // -------------------------------------------------------------------------
  // 1. With runtimeEvidenceConfig in the multipart body -> forwarded to AMS.
  // -------------------------------------------------------------------------
  it('forwards `runtimeEvidenceConfig` to the AMS PATCH body alongside `logFiles` and `attemptedCount`', async () => {
    const app = buildApp();

    const response = await request(app)
      .post(
        '/api/v1/discovery/projects/proj-1/architectures/arch-1/runs/run-1/log-files',
      )
      .field('runtimeEvidenceConfig', JSON.stringify({ maxLogPathPrefixSegments: 3 }))
      .attach('logFiles', Buffer.from('hello'), {
        filename: 'access.log',
        contentType: 'text/plain',
      });

    expect(response.status).toBe(200);
    expect(mockPatchDiscoveryRunLogFileArtifacts).toHaveBeenCalledTimes(1);

    const [pProjectId, pArchId, pRunId, pBody] =
      mockPatchDiscoveryRunLogFileArtifacts.mock.calls[0];
    expect(pProjectId).toBe('proj-1');
    expect(pArchId).toBe('arch-1');
    expect(pRunId).toBe('run-1');
    // Existing keys still present.
    expect(pBody.attemptedCount).toBe(1);
    expect(Array.isArray(pBody.logFiles)).toBe(true);
    expect(pBody.logFiles).toHaveLength(1);
    // New key forwarded verbatim.
    expect(pBody.runtimeEvidenceConfig).toEqual({ maxLogPathPrefixSegments: 3 });
  });

  // -------------------------------------------------------------------------
  // 2. Backwards-compat: no runtimeEvidenceConfig field -> PATCH body omits it.
  // -------------------------------------------------------------------------
  it('omits `runtimeEvidenceConfig` from the AMS PATCH body when the multipart field is absent', async () => {
    const app = buildApp();

    const response = await request(app)
      .post(
        '/api/v1/discovery/projects/proj-1/architectures/arch-1/runs/run-1/log-files',
      )
      .attach('logFiles', Buffer.from('hello'), {
        filename: 'access.log',
        contentType: 'text/plain',
      });

    expect(response.status).toBe(200);
    expect(mockPatchDiscoveryRunLogFileArtifacts).toHaveBeenCalledTimes(1);

    const [, , , pBody] = mockPatchDiscoveryRunLogFileArtifacts.mock.calls[0];
    // Existing keys still present.
    expect(pBody.attemptedCount).toBe(1);
    expect(pBody.logFiles).toHaveLength(1);
    // The new key MUST be absent (so AMS leaves the existing snapshot value
    // unchanged on re-PATCH semantics).
    expect(Object.prototype.hasOwnProperty.call(pBody, 'runtimeEvidenceConfig')).toBe(
      false,
    );
  });
});
