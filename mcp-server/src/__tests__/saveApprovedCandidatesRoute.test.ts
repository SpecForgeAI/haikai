import type { Request, Response, NextFunction } from 'express';

/**
 * Tests for the save_approved_candidates MCP tool endpoint.
 *
 * Validates the multi-architecture migration (2026-05-11):
 * - architectureId MUST be present in the request body (UUID v4)
 * - the route forwards architectureId into the underlying save-back orchestration
 *   so the model PUT lands on the correct (project, architecture) pair
 * - missing / invalid architectureId fails loudly with HTTP 400
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

// Mock sessionManager
jest.mock('../services/sessionManager');

// Mock candidateSaveBackService
jest.mock('../services/candidateSaveBackService');

const PROJECT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const ARCH_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
const RUN_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

function getHandler() {
  const { saveApprovedCandidatesRouter } = require('../routes/saveApprovedCandidatesRoute');
  const routeLayer = saveApprovedCandidatesRouter.stack.find(
    (layer: any) => layer.route?.path === '/'
  );
  const handler = routeLayer?.route?.stack[0]?.handle;
  if (!handler) {
    throw new Error('Route handler not found');
  }
  return handler;
}

function setupAxiosMock() {
  const axios = require('axios');
  axios.create = jest.fn().mockReturnValue({
    get: jest.fn(),
    put: jest.fn(),
    post: jest.fn(),
  });
}

function setupSessionMock() {
  const sessionManager = require('../services/sessionManager');
  sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
    sessionId: 'session-123',
    lastActivity: new Date(),
  });
}

describe('save_approved_candidates Route Handler', () => {
  // ============================================================================
  // Test 1: Valid request with architectureId returns 200 and forwards arch
  // ============================================================================
  describe('valid request forwards architectureId to the service', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns HTTP 200 and calls saveDiscoveryCandidatesToModel with (projectId, architectureId, runId, "manual")', async () => {
      setupAxiosMock();
      setupSessionMock();

      const candidateSaveBackService = require('../services/candidateSaveBackService');
      const mockResponse = {
        projectId: PROJECT_ID,
        runId: RUN_ID,
        entitiesCreated: 5,
        entitiesSkipped: 2,
        candidatesCommitted: 7,
      };
      candidateSaveBackService.saveDiscoveryCandidatesToModel = jest
        .fn()
        .mockResolvedValue(mockResponse);

      const handler = getHandler();

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: PROJECT_ID,
          architectureId: ARCH_ID,
          runId: RUN_ID,
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      await handler(mockReq as Request, mockRes as Response, mockNext);

      // architectureId is forwarded as the second positional arg, mode is always
      // 'manual', and the dry-run flag resolves to a real commit (true) when the
      // request omits `commit` (Spec 2026-06-20 skipped-candidate-visibility-bulk-fill).
      expect(candidateSaveBackService.saveDiscoveryCandidatesToModel).toHaveBeenCalledWith(
        PROJECT_ID,
        ARCH_ID,
        RUN_ID,
        'manual',
        true
      );

      expect(jsonMock).toHaveBeenCalledWith(mockResponse);
      expect(statusMock).not.toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Test 2: Missing architectureId returns 400
  // ============================================================================
  describe('missing architectureId fails loudly with 400', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when architectureId is omitted from the body', async () => {
      setupAxiosMock();
      setupSessionMock();

      const candidateSaveBackService = require('../services/candidateSaveBackService');
      candidateSaveBackService.saveDiscoveryCandidatesToModel = jest.fn();

      const handler = getHandler();

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: PROJECT_ID,
          // architectureId intentionally omitted
          runId: RUN_ID,
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      await handler(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 400,
            message: expect.stringContaining('architectureId'),
          }),
        })
      );

      // The service must not be invoked when validation fails.
      expect(candidateSaveBackService.saveDiscoveryCandidatesToModel).not.toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Test 3: Invalid (non-UUID) architectureId returns 400
  // ============================================================================
  describe('invalid architectureId fails loudly with 400', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 when architectureId is not a valid UUID', async () => {
      setupAxiosMock();
      setupSessionMock();

      const candidateSaveBackService = require('../services/candidateSaveBackService');
      candidateSaveBackService.saveDiscoveryCandidatesToModel = jest.fn();

      const handler = getHandler();

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: PROJECT_ID,
          architectureId: 'not-a-uuid',
          runId: RUN_ID,
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      await handler(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 400,
            message: expect.stringContaining('architectureId'),
          }),
        })
      );

      expect(candidateSaveBackService.saveDiscoveryCandidatesToModel).not.toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Test 4: Empty-string architectureId returns 400
  // ============================================================================
  describe('empty-string architectureId fails loudly with 400', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 when architectureId is the empty string', async () => {
      setupAxiosMock();
      setupSessionMock();

      const candidateSaveBackService = require('../services/candidateSaveBackService');
      candidateSaveBackService.saveDiscoveryCandidatesToModel = jest.fn();

      const handler = getHandler();

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: PROJECT_ID,
          architectureId: '',
          runId: RUN_ID,
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      await handler(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 400,
            message: expect.stringContaining('architectureId'),
          }),
        })
      );

      expect(candidateSaveBackService.saveDiscoveryCandidatesToModel).not.toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Test 5: Upstream failure (502) returns 502
  // ============================================================================
  describe('upstream service failure surfaces as 502', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 502 when the service throws a 502 upstream error', async () => {
      setupAxiosMock();
      setupSessionMock();

      const candidateSaveBackService = require('../services/candidateSaveBackService');
      const upstreamError = new Error('Upstream architecture-model-service failed');
      (upstreamError as any).statusCode = 502;
      candidateSaveBackService.saveDiscoveryCandidatesToModel = jest
        .fn()
        .mockRejectedValue(upstreamError);

      const handler = getHandler();

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: PROJECT_ID,
          architectureId: ARCH_ID,
          runId: RUN_ID,
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      await handler(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(502);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 502,
            message: expect.stringContaining('Upstream architecture-model-service failed'),
          }),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Test 6: commit=false in the body threads a DRY-RUN (commit=false) to the
  // service so the gateway preview flag actually reaches save-back.
  // Spec 2026-06-20 skipped-candidate-visibility-bulk-fill (TG8 review gap).
  // ============================================================================
  describe('commit=false threads a dry-run through to the service', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls saveDiscoveryCandidatesToModel with commit=false when the body has { commit: false }', async () => {
      setupAxiosMock();
      setupSessionMock();

      const candidateSaveBackService = require('../services/candidateSaveBackService');
      candidateSaveBackService.saveDiscoveryCandidatesToModel = jest
        .fn()
        .mockResolvedValue({
          projectId: PROJECT_ID,
          runId: RUN_ID,
          entitiesCreated: 0,
          entitiesSkipped: 1,
          candidatesCommitted: 0,
          reasons: [],
        });

      const handler = getHandler();

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: PROJECT_ID,
          architectureId: ARCH_ID,
          runId: RUN_ID,
          commit: false,
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = { json: jsonMock, status: statusMock } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      await handler(mockReq as Request, mockRes as Response, mockNext);

      // The 5th positional arg (commit) is false -> the service runs in dry-run
      // (projection-only) mode. The route maps commit !== false, so an explicit
      // false reaches the service as false.
      expect(candidateSaveBackService.saveDiscoveryCandidatesToModel).toHaveBeenCalledWith(
        PROJECT_ID,
        ARCH_ID,
        RUN_ID,
        'manual',
        false
      );
      expect(statusMock).not.toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Test 7: an explicit { commit: true } also commits (the flag is honoured both
  // ways, not only defaulted).
  // ============================================================================
  describe('commit=true threads a real commit through to the service', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls saveDiscoveryCandidatesToModel with commit=true when the body has { commit: true }', async () => {
      setupAxiosMock();
      setupSessionMock();

      const candidateSaveBackService = require('../services/candidateSaveBackService');
      candidateSaveBackService.saveDiscoveryCandidatesToModel = jest
        .fn()
        .mockResolvedValue({
          projectId: PROJECT_ID,
          runId: RUN_ID,
          entitiesCreated: 1,
          entitiesSkipped: 0,
          candidatesCommitted: 1,
        });

      const handler = getHandler();

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: PROJECT_ID,
          architectureId: ARCH_ID,
          runId: RUN_ID,
          commit: true,
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = { json: jsonMock, status: statusMock } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      await handler(mockReq as Request, mockRes as Response, mockNext);

      expect(candidateSaveBackService.saveDiscoveryCandidatesToModel).toHaveBeenCalledWith(
        PROJECT_ID,
        ARCH_ID,
        RUN_ID,
        'manual',
        true
      );
      expect(statusMock).not.toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
