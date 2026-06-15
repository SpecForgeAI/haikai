import type { Request, Response, NextFunction } from 'express';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

// Mock sessionManager
jest.mock('../services/sessionManager');

// Mock temporaryArchitectureDiagramService
jest.mock('../services/temporaryArchitectureDiagramService');

describe('saveTemporaryArchitectureDiagram Route Handler', () => {
  // ============================================================================
  // Test 4: Route handler returns 400 when sessionId is missing or empty
  // ============================================================================
  describe('saveTemporaryArchitectureDiagram - missing sessionId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 when sessionId is missing', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the route handler
      const { saveTemporaryArchitectureDiagramRouter } = require('../routes/saveTemporaryArchitectureDiagramRoute');

      // Create mock request without sessionId
      const mockReq = {
        body: {
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          diagramJson: '{"id":"d1","name":"Test","diagram_kind":"ER","source_architecture_domain":"DATA","view_mode":"LOGICAL","version":1,"nodes":[],"edges":[]}',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveTemporaryArchitectureDiagramRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify 400 response
        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 400,
              message: expect.stringContaining('sessionId'),
            }),
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 5: Route handler returns 400 when projectId is not a valid UUID
  // ============================================================================
  describe('saveTemporaryArchitectureDiagram - invalid projectId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 when projectId is not a valid UUID', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the route handler
      const { saveTemporaryArchitectureDiagramRouter } = require('../routes/saveTemporaryArchitectureDiagramRoute');

      // Create mock request with invalid projectId
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'not-a-uuid',
          diagramJson: '{"id":"d1","name":"Test","diagram_kind":"ER","source_architecture_domain":"DATA","view_mode":"LOGICAL","version":1,"nodes":[],"edges":[]}',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveTemporaryArchitectureDiagramRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify 400 response
        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 400,
              message: expect.stringContaining('projectId'),
            }),
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 6: Route handler returns 502 when upstream archModelClient call fails
  // ============================================================================
  describe('saveTemporaryArchitectureDiagram - upstream failure (502)', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 502 when upstream archModelClient call fails', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      // Setup service mock to throw a 502 error
      const service = require('../services/temporaryArchitectureDiagramService');
      const upstreamError = new Error('Backend service unavailable');
      (upstreamError as any).statusCode = 502;
      service.saveTemporaryArchitectureDiagram = jest
        .fn()
        .mockRejectedValue(upstreamError);

      // Import the route handler
      const { saveTemporaryArchitectureDiagramRouter } = require('../routes/saveTemporaryArchitectureDiagramRoute');

      // Create mock request
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          diagramJson: '{"id":"d1","name":"Test","diagram_kind":"ER","source_architecture_domain":"DATA","view_mode":"LOGICAL","version":1,"nodes":[],"edges":[]}',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveTemporaryArchitectureDiagramRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify 502 response
        expect(statusMock).toHaveBeenCalledWith(502);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 502,
              message: expect.stringContaining('Backend service unavailable'),
            }),
          })
        );
        // Verify next was NOT called (handler responded directly)
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Gap-fill Test: Route handler returns 400 when diagramJson is empty string
  // ============================================================================
  describe('saveTemporaryArchitectureDiagram - empty diagramJson', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 when diagramJson is an empty string', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the route handler
      const { saveTemporaryArchitectureDiagramRouter } = require('../routes/saveTemporaryArchitectureDiagramRoute');

      // Create mock request with empty diagramJson
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          diagramJson: '',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveTemporaryArchitectureDiagramRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify 400 response
        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 400,
              message: expect.stringContaining('diagramJson'),
            }),
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Gap-fill Test: Full save flow through route -> service -> validator -> client
  // ============================================================================
  describe('saveTemporaryArchitectureDiagram - full save flow', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 200 with { id, status: "saved", createdAt } for a complete valid request', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      // Setup service mock to return a successful result
      const service = require('../services/temporaryArchitectureDiagramService');
      service.saveTemporaryArchitectureDiagram = jest.fn().mockResolvedValue({
        id: 'diagram-001',
        status: 'saved',
        createdAt: '2026-03-26T10:00:00Z',
      });

      // Import the route handler
      const { saveTemporaryArchitectureDiagramRouter } = require('../routes/saveTemporaryArchitectureDiagramRoute');

      const validDiagram = {
        id: 'diagram-001',
        name: 'Test ER Diagram',
        diagram_kind: 'ER',
        source_architecture_domain: 'DATA',
        view_mode: 'LOGICAL',
        version: 1,
        nodes: [],
        edges: [],
      };

      // Create mock request with all valid fields
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          diagramJson: JSON.stringify(validDiagram),
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveTemporaryArchitectureDiagramRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify session was created
        expect(sessionManager.getOrCreateSession).toHaveBeenCalledWith('session-123');

        // Verify service was called with correct arguments (the route
        // forwards an optional third architectureId arg, undefined when
        // the request does not supply one)
        expect(service.saveTemporaryArchitectureDiagram).toHaveBeenCalledWith(
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          JSON.stringify(validDiagram),
          undefined
        );

        // Verify successful response
        expect(jsonMock).toHaveBeenCalledWith({
          id: 'diagram-001',
          status: 'saved',
          createdAt: '2026-03-26T10:00:00Z',
        });

        // Verify no error handling was triggered
        expect(mockNext).not.toHaveBeenCalled();
        // status should NOT have been called (200 is the default when using res.json)
        expect(statusMock).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });
});
