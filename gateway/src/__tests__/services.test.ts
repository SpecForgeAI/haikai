/**
 * Tests for core services
 */

import nock from 'nock';
import {
  getOrCreateSession,
  updateSession,
  getSession,
  clearAllSessions,
  runCleanup,
  sessionStore,
} from '../services/sessionStore';
import {
  isToolAllowed,
  validateToolArguments,
  executeTool,
} from '../services/toolExecutor';
import { buildSystemPrompt } from '../services/promptBuilder';
import { GatewaySession, ChatContext } from '../types';

// Mock config
jest.mock('../config', () => ({
  getConfig: () => ({
    mcpBaseUrl: 'http://localhost:8090',
    sessionTtlHours: 24,
    openaiApiKey: 'test-key',
    openaiModel: 'gpt-4o',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiTimeoutMs: 60000,
  }),
}));

// Mock logger
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
  logToolCall: jest.fn(),
  logOpenAIRequest: jest.fn(),
}));

describe('Services', () => {
  describe('SessionStore', () => {
    beforeEach(() => {
      clearAllSessions();
    });

    it('should create a new session', () => {
      const session = getOrCreateSession('test-session-1');

      expect(session).toBeDefined();
      expect(session.sessionId).toBe('test-session-1');
      expect(session.mcpSessionId).toBeDefined();
      expect(session.mcpSessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivity).toBeInstanceOf(Date);
    });

    it('should retrieve an existing session', () => {
      const session1 = getOrCreateSession('test-session-2');
      const session2 = getOrCreateSession('test-session-2');

      expect(session2.sessionId).toBe(session1.sessionId);
      expect(session2.mcpSessionId).toBe(session1.mcpSessionId);
    });

    it('should update session and refresh lastActivity', () => {
      const session = getOrCreateSession('test-session-3');
      const originalActivity = session.lastActivity;

      // Small delay to ensure lastActivity changes
      const updated = updateSession('test-session-3', {
        filename: 'test.json',
        interfaceId: 'INT-001',
      });

      expect(updated).toBeDefined();
      expect(updated!.filename).toBe('test.json');
      expect(updated!.interfaceId).toBe('INT-001');
      expect(updated!.lastActivity.getTime()).toBeGreaterThanOrEqual(originalActivity.getTime());
    });

    it('should expire old sessions on access', () => {
      // Create a session with old lastActivity directly in the store
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 25); // 25 hours ago (beyond 24h TTL)

      const expiredSession: GatewaySession = {
        sessionId: 'expired-session',
        mcpSessionId: 'mcp-expired',
        createdAt: oldDate,
        lastActivity: oldDate,
      };

      // Directly set the session in the store (bypassing updateSession which refreshes lastActivity)
      sessionStore.set('expired-session', expiredSession);

      // Now try to get it - should return null because it's expired
      const retrieved = getSession('expired-session');
      expect(retrieved).toBeNull(); // Session expired on access
    });
  });

  describe('ToolExecutor', () => {
    beforeEach(() => {
      nock.cleanAll();
    });

    afterAll(() => {
      nock.restore();
    });

    it('should allow known tools', () => {
      expect(isToolAllowed('list_interfaces')).toBe(true);
      expect(isToolAllowed('get_interface_oas_context')).toBe(true);
      expect(isToolAllowed('compute_oas_gaps')).toBe(true);
      expect(isToolAllowed('save_oas_spec')).toBe(true);
    });

    it('should reject unknown tools', () => {
      expect(isToolAllowed('unknown_tool')).toBe(false);
      expect(isToolAllowed('delete_file')).toBe(false);
      expect(isToolAllowed('exec')).toBe(false);
    });

    it('should validate tool arguments - valid', () => {
      const result = validateToolArguments('list_interfaces', {
        filename: 'architecture.json',
      });

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate tool arguments - missing required', () => {
      const result = validateToolArguments('list_interfaces', {});

      expect(result.valid).toBe(false);
      expect(result.error).toContain('filename');
    });

    it('should validate save_oas_spec format', () => {
      const validResult = validateToolArguments('save_oas_spec', {
        filename: 'test.json',
        interfaceId: 'INT-001',
        format: 'yaml',
        oasContents: 'openapi: 3.0.0',
      });
      expect(validResult.valid).toBe(true);

      const invalidResult = validateToolArguments('save_oas_spec', {
        filename: 'test.json',
        interfaceId: 'INT-001',
        format: 'xml',
        oasContents: 'openapi: 3.0.0',
      });
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.error).toContain('format');
    });

    it('should execute allowed tool via MCP', async () => {
      // Mock MCP endpoint
      nock('http://localhost:8090')
        .post('/mcp/tools/list_interfaces')
        .reply(200, {
          data: [
            { interfaceId: 'INT-001', interfaceName: 'Test Interface' },
          ],
        });

      const result = await executeTool(
        'list_interfaces',
        { filename: 'architecture.json' },
        'mcp-session-123',
        'req-123',
        'session-123'
      );

      expect(result.status).toBe(200);
      expect(result.result).toEqual([
        { interfaceId: 'INT-001', interfaceName: 'Test Interface' },
      ]);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle MCP errors gracefully', async () => {
      // Mock MCP endpoint returning error
      nock('http://localhost:8090')
        .post('/mcp/tools/list_interfaces')
        .reply(404, {
          error: { message: 'Interface not found' },
        });

      const result = await executeTool(
        'list_interfaces',
        { filename: 'nonexistent.json' },
        'mcp-session-123',
        'req-123',
        'session-123'
      );

      expect(result.status).toBe(404);
      expect(result.result).toHaveProperty('error');
    });
  });

  describe('PromptBuilder', () => {
    it('should build system prompt with context', () => {
      const session: GatewaySession = {
        sessionId: 'test-session',
        mcpSessionId: 'mcp-session',
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      const context: ChatContext = {
        filename: 'architecture.json',
        interfaceId: 'INT-001',
        preferredFormat: 'json',
      };

      const prompt = buildSystemPrompt(session, context);

      expect(prompt).toContain('architecture.json');
      expect(prompt).toContain('INT-001');
      expect(prompt).toContain('json');
      expect(prompt).toContain('OpenAPI specification assistant');
    });

    it('should use session values when context is missing', () => {
      const session: GatewaySession = {
        sessionId: 'test-session',
        mcpSessionId: 'mcp-session',
        filename: 'session-file.json',
        interfaceId: 'SESSION-INT',
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      const prompt = buildSystemPrompt(session);

      expect(prompt).toContain('session-file.json');
      expect(prompt).toContain('SESSION-INT');
      expect(prompt).toContain('yaml'); // Default format
    });

    it('should handle empty context gracefully', () => {
      const session: GatewaySession = {
        sessionId: 'test-session',
        mcpSessionId: 'mcp-session',
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      const prompt = buildSystemPrompt(session);

      expect(prompt).toContain('not provided');
      expect(prompt).toContain('yaml'); // Default format
    });
  });
});
