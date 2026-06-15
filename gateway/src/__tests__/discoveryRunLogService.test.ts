/**
 * Tests for the Discovery Run Log Service + the new gateway upload route.
 *
 * Spec 2026-05-10 Runtime Log Input at Discovery Run Start -- Task Group 2
 *
 * Coverage (5 focused tests):
 *  1. Sanitisation strips path separators / control chars / collapses whitespace
 *     and preserves the original extension (pure unit test).
 *  2. Collision suffixing within one batch produces ' (2)', ' (3)' before the
 *     extension (pure unit test).
 *  3. Happy path: two valid files are written to disk + AMS PATCH called with
 *     the correct LogFileMeta[] shape (writeLogFilesAndPatchRun-level).
 *  4. Disk-write failure throws DiskWriteError and AMS PATCH is NOT called.
 *  5. Route-level: AMS PATCH failure (ArchitectureModelHttpError) surfaces
 *     the upstream status to the caller. Run was already created; the route
 *     does not roll it back.
 *
 * Mocking pattern (per project memory):
 *  - jest.mock('fs/promises') with explicit factory.
 *  - architectureModelClient mocked using `jest.requireActual` spread so
 *    unrelated functions remain real (only fetchProjectFolder + the new
 *    PATCH client function are stubbed).
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

// ---- Mock uuid so artifactId is deterministic in assertions ----
let uuidCounter = 0;
jest.mock('uuid', () => ({
  v4: () => `uuid-${++uuidCounter}`,
}));

// ---- Mock logger to silence noise ----
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
import {
  sanitiseFileName,
  resolveCollisionSuffix,
  writeLogFilesAndPatchRun,
  DiskWriteError,
} from '../services/discoveryRunLogService';
import { discoveryRouter } from '../routes/discovery';
import { ArchitectureModelHttpError } from '../services/architectureModelClient';

describe('discoveryRunLogService + gateway upload route (Spec 2026-05-10)', () => {
  beforeEach(() => {
    mockFsMkdir.mockReset();
    mockFsWriteFile.mockReset();
    mockFetchProjectFolder.mockReset();
    mockPatchDiscoveryRunLogFileArtifacts.mockReset();
    uuidCounter = 0;
  });

  // =========================================================================
  // Test 1: Sanitisation rules
  // =========================================================================
  describe('sanitiseFileName', () => {
    it('strips path separators / control chars and collapses whitespace, preserving the extension', () => {
      // Path separators stripped, control char (0x01) stripped, whitespace
      // run collapsed to a single underscore, '.log' extension preserved.
      const result = sanitiseFileName('foo/bar\\baz\x01  qux.log');

      expect(result).toBe('foobarbaz_qux.log');
      expect(result!.endsWith('.log')).toBe(true);
    });

    it('returns null when sanitisation produces an empty base', () => {
      // Only path separators and control chars + whitespace -> nothing left.
      expect(sanitiseFileName('//\\\\\x00 \x1F')).toBeNull();
    });
  });

  // =========================================================================
  // Test 2: Collision suffixing
  // =========================================================================
  describe('resolveCollisionSuffix', () => {
    it('suffixes second and third occurrences with " (2)" and " (3)" before the extension', () => {
      const used = new Set<string>();

      const first = resolveCollisionSuffix('access.log', used);
      used.add(first);
      const second = resolveCollisionSuffix('access.log', used);
      used.add(second);
      const third = resolveCollisionSuffix('access.log', used);
      used.add(third);

      expect(first).toBe('access.log');
      expect(second).toBe('access (2).log');
      expect(third).toBe('access (3).log');
    });
  });

  // =========================================================================
  // Test 3: Happy path -- two files written + AMS PATCH called with correct shape
  // =========================================================================
  describe('writeLogFilesAndPatchRun -- happy path', () => {
    it('writes both files to disk and PATCHes AMS with a LogFileMeta[] of the expected shape', async () => {
      mockFetchProjectFolder.mockResolvedValue('/projects/proj-1');
      mockFsMkdir.mockResolvedValue(undefined);
      mockFsWriteFile.mockResolvedValue(undefined);
      mockPatchDiscoveryRunLogFileArtifacts.mockResolvedValue({
        logFiles: [],
        attemptedCount: 2,
      });

      const result = await writeLogFilesAndPatchRun({
        projectId: 'proj-1',
        architectureId: 'arch-1',
        runId: 'run-1',
        files: [
          {
            originalname: 'access.log',
            size: 12,
            mimetype: 'text/plain',
            buffer: Buffer.from('hello world\n'),
          },
          {
            originalname: 'app.jsonl',
            size: 5,
            mimetype: 'application/x-ndjson',
            buffer: Buffer.from('{}\n'),
          },
        ],
        attemptedCount: 2,
      });

      // Disk: mkdir for the logs dir + one writeFile per file.
      expect(mockFsMkdir).toHaveBeenCalledTimes(1);
      const [mkdirPath, mkdirOpts] = mockFsMkdir.mock.calls[0];
      expect(String(mkdirPath).replace(/\\/g, '/')).toBe(
        '/projects/proj-1/discovery-runs/run-1/logs'
      );
      expect(mkdirOpts).toEqual({ recursive: true });

      expect(mockFsWriteFile).toHaveBeenCalledTimes(2);
      const writtenPaths = mockFsWriteFile.mock.calls.map((c) =>
        String(c[0]).replace(/\\/g, '/')
      );
      expect(writtenPaths).toEqual([
        '/projects/proj-1/discovery-runs/run-1/logs/access.log',
        '/projects/proj-1/discovery-runs/run-1/logs/app.jsonl',
      ]);

      // PATCH: called once with the correct shape.
      expect(mockPatchDiscoveryRunLogFileArtifacts).toHaveBeenCalledTimes(1);
      const [pProjectId, pArchId, pRunId, pBody] =
        mockPatchDiscoveryRunLogFileArtifacts.mock.calls[0];
      expect(pProjectId).toBe('proj-1');
      expect(pArchId).toBe('arch-1');
      expect(pRunId).toBe('run-1');
      expect(pBody.attemptedCount).toBe(2);
      expect(pBody.logFiles).toHaveLength(2);

      const meta0 = pBody.logFiles[0];
      expect(meta0.artifactId).toBe('uuid-1');
      expect(meta0.originalFileName).toBe('access.log');
      expect(meta0.sizeBytes).toBe(12);
      expect(meta0.fileExtension).toBe('.log');
      expect(meta0.contentType).toBe('text/plain');
      expect(typeof meta0.uploadedAtIso).toBe('string');
      expect(meta0.relativePath).toBe('discovery-runs/run-1/logs/access.log');

      const meta1 = pBody.logFiles[1];
      expect(meta1.artifactId).toBe('uuid-2');
      expect(meta1.originalFileName).toBe('app.jsonl');
      expect(meta1.fileExtension).toBe('.jsonl');
      expect(meta1.relativePath).toBe('discovery-runs/run-1/logs/app.jsonl');

      // Service result mirrors the inputs.
      expect(result.successfulCount).toBe(2);
      expect(result.attemptedCount).toBe(2);
      expect(result.logFiles).toHaveLength(2);
    });
  });

  // =========================================================================
  // Test 4: Disk write failure -> DiskWriteError + PATCH NOT called
  // =========================================================================
  describe('writeLogFilesAndPatchRun -- disk write failure', () => {
    it('throws DiskWriteError and does NOT call the AMS PATCH when fs.writeFile fails', async () => {
      mockFetchProjectFolder.mockResolvedValue('/projects/proj-1');
      mockFsMkdir.mockResolvedValue(undefined);
      mockFsWriteFile.mockRejectedValueOnce(new Error('EACCES: permission denied'));

      await expect(
        writeLogFilesAndPatchRun({
          projectId: 'proj-1',
          architectureId: 'arch-1',
          runId: 'run-1',
          files: [
            {
              originalname: 'broken.log',
              size: 4,
              mimetype: 'text/plain',
              buffer: Buffer.from('oops'),
            },
          ],
          attemptedCount: 1,
        })
      ).rejects.toBeInstanceOf(DiskWriteError);

      expect(mockPatchDiscoveryRunLogFileArtifacts).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test 5: Route-level -- AMS PATCH failure surfaces upstream status (run already created, NOT rolled back)
  // =========================================================================
  describe('POST /projects/:projectId/architectures/:architectureId/runs/:runId/log-files', () => {
    it('surfaces AMS PATCH failure status to the caller (run is NOT rolled back)', async () => {
      mockFetchProjectFolder.mockResolvedValue('/projects/proj-1');
      mockFsMkdir.mockResolvedValue(undefined);
      mockFsWriteFile.mockResolvedValue(undefined);
      mockPatchDiscoveryRunLogFileArtifacts.mockRejectedValueOnce(
        new ArchitectureModelHttpError(404, { message: 'discovery_run not found' })
      );

      const app = express();
      app.use('/api/v1/discovery', discoveryRouter);

      const response = await request(app)
        .post(
          '/api/v1/discovery/projects/proj-1/architectures/arch-1/runs/run-1/log-files'
        )
        .attach('logFiles', Buffer.from('hello'), {
          filename: 'sample.log',
          contentType: 'text/plain',
        });

      // Upstream 404 forwarded verbatim.
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe(404);
      expect(response.body.error.upstream).toEqual({ message: 'discovery_run not found' });

      // Disk write completed -- file WAS written. The run is not rolled back;
      // the gateway only forwards the upstream status.
      expect(mockFsWriteFile).toHaveBeenCalledTimes(1);
      expect(mockPatchDiscoveryRunLogFileArtifacts).toHaveBeenCalledTimes(1);
    });
  });
});
