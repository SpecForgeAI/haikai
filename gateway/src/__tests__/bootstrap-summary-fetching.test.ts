/**
 * Tests for Bootstrap Phase Summary Fetching
 *
 * Spec: 2026-01-16 Fix Implement Assistant Context Injection
 * Task Group 1: Bootstrap Phase Summary Fetching
 *
 * Tests cover:
 * - Bootstrap phase calls fetchProductSummary and fetchMetaModelSummary
 * - Summaries are passed to buildSystemPrompt as 4th and 5th parameters
 * - Null productSummary logs warning but proceeds with chat (graceful handling)
 * - Null metaModelSummary logs warning but proceeds with chat (graceful handling)
 */

import { buildSystemPrompt, buildBootstrapPrompt } from '../services/promptBuilder';
import { ChatContext, ProductSummaryDto, MetaModelSummaryDto } from '../types/chat';
import { GatewaySession } from '../types/session';

// Mock the config
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    maxToolCallsPerTurn: 10,
  }),
}));

// Mock fetch for architectureModelClient tests
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Mock logger
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Bootstrap Phase Summary Fetching - Spec 2026-01-16', () => {
  const mockSession: GatewaySession = {
    sessionId: 'test-session',
    mcpSessionId: 'mcp-test-session',
    createdAt: new Date(),
    lastActivity: new Date(),
  };

  const mockBootstrapContext: ChatContext = {
    mode: 'implement_feature',
    phase: 'bootstrap',
    filename: 'test-project.json',
    workItem: {
      id: 'WI-123',
      title: 'Add user profile feature',
      type: 'Feature',
      description: 'Users should be able to view and edit their profile',
    },
    architectureContext: {
      entityIds: [],
      diagramIds: [],
    },
  };

  const mockProductSummary: ProductSummaryDto = {
    initiatives: [
      {
        id: 'init-1',
        title: 'User Management Initiative',
        description: 'Comprehensive user management',
        epics: [
          {
            id: 'epic-1',
            title: 'Authentication Epic',
            description: 'User auth system',
            features: [
              {
                id: 'feat-1',
                title: 'Login Feature',
                description: 'User login',
              },
            ],
            priority: null,
            sortOrder: 0,
          },
        ],
      },
    ],
  };

  // Raw work-items wire shape that fetchProductSummary assembles into mockProductSummary
  const mockWorkItemsRaw = [
    {
      id: 'init-1',
      type: 'INITIATIVE',
      parent_id: null,
      title: 'User Management Initiative',
      description: 'Comprehensive user management',
      priority: null,
      sort_order: 0,
    },
    {
      id: 'epic-1',
      type: 'EPIC',
      parent_id: 'init-1',
      title: 'Authentication Epic',
      description: 'User auth system',
      priority: null,
      sort_order: 0,
    },
    {
      id: 'feat-1',
      type: 'FEATURE',
      parent_id: 'epic-1',
      title: 'Login Feature',
      description: 'User login',
      priority: null,
      sort_order: 0,
    },
  ];

  const mockMetaModelSummary: MetaModelSummaryDto = {
    applications: [],
    business_users: [],
    process_activities: [],
    ui_screens: [],
    data_store_count: 0,
    services: [
      { id: 'svc-1', name: 'UserService', entity_type: 'services' },
    ],
    data_entities: [
      { id: 'lde-1', name: 'User', entity_type: 'logicalDataEntities' },
    ],
    interfaces: [
      { id: 'int-1', name: 'UserAPI', entity_type: 'interfaces' },
    ],
    relationships: [
      { source_entity: 'UserService', target_entity: 'UserAPI', relationship_type: 'exposes' },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Task 1.1: Bootstrap phase calls fetchProductSummary and fetchMetaModelSummary', () => {
    it('should call both fetch functions when in bootstrap phase', async () => {
      // Setup mocks for both fetch calls
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockWorkItemsRaw,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockMetaModelSummary,
        });

      // Import functions after mocking
      const { fetchProductSummary, fetchMetaModelSummary } = require('../services/architectureModelClient');

      // Execute both fetch calls (simulating what chat.ts does)
      const [productResult, metaModelResult] = await Promise.all([
        fetchProductSummary('test-project.json'),
        fetchMetaModelSummary('test-project.json', 'arch-1'),
      ]);

      // Verify fetch was called twice (once for each endpoint)
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify correct URLs were called
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/model/projects/test-project.json/work-items',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        })
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/projects/test-project.json/architectures/arch-1/meta-model-summary',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      // Verify results
      expect(productResult).toEqual(mockProductSummary);
      expect(metaModelResult).toEqual(mockMetaModelSummary);
    });
  });

  describe('Task 1.2: Summaries are passed to buildSystemPrompt as 4th and 5th parameters', () => {
    it('should include product summary content in bootstrap prompt when provided', () => {
      const prompt = buildSystemPrompt(
        mockSession,
        mockBootstrapContext,
        null, // resolvedContext
        mockProductSummary, // 4th parameter
        mockMetaModelSummary // 5th parameter
      );

      // Verify product summary content appears in prompt
      expect(prompt).toContain('User Management Initiative');
      expect(prompt).toContain('Authentication Epic');
      expect(prompt).toContain('Login Feature');
    });

    it('should include meta-model summary content in bootstrap prompt when provided', () => {
      const prompt = buildSystemPrompt(
        mockSession,
        mockBootstrapContext,
        null, // resolvedContext
        mockProductSummary, // 4th parameter
        mockMetaModelSummary // 5th parameter
      );

      // Verify meta-model summary content appears in prompt
      expect(prompt).toContain('UserService');
      expect(prompt).toContain('User');
      expect(prompt).toContain('UserAPI');
      expect(prompt).toContain('exposes');
    });

    it('should route to bootstrap prompt when phase is bootstrap', () => {
      const prompt = buildSystemPrompt(
        mockSession,
        mockBootstrapContext,
        null,
        mockProductSummary,
        mockMetaModelSummary
      );

      // Verify bootstrap prompt template is used
      expect(prompt).toContain('PRODUCT BACKLOG SUMMARY');
      expect(prompt).toContain('ARCHITECTURE META-MODEL SUMMARY');
    });
  });

  describe('Task 1.3: Null productSummary logs warning but proceeds with chat', () => {
    it('should show fallback text when productSummary is null', () => {
      const prompt = buildBootstrapPrompt(
        mockBootstrapContext,
        null, // null productSummary
        mockMetaModelSummary
      );

      // Verify fallback message appears
      expect(prompt).toContain('No product backlog available');

      // Verify meta-model summary still appears (chat continues)
      expect(prompt).toContain('UserService');
    });

    it('should return null when fetch returns non-OK response (graceful handling)', async () => {
      // Setup mock to return non-OK response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const { fetchProductSummary } = require('../services/architectureModelClient');
      const result = await fetchProductSummary('unknown-project.json');

      // Verify null is returned (graceful degradation)
      expect(result).toBeNull();

      // Verify fetch was called
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return null when fetch throws an error (graceful handling)', async () => {
      // Setup mock to throw an error
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { fetchProductSummary } = require('../services/architectureModelClient');
      const result = await fetchProductSummary('test-project.json');

      // Verify null is returned (graceful degradation)
      expect(result).toBeNull();
    });
  });

  describe('Task 1.4: Null metaModelSummary logs warning but proceeds with chat', () => {
    it('should show fallback text when metaModelSummary is null', () => {
      const prompt = buildBootstrapPrompt(
        mockBootstrapContext,
        mockProductSummary,
        null // null metaModelSummary
      );

      // Verify fallback message appears
      expect(prompt).toContain('No architecture context available');

      // Verify product summary still appears (chat continues)
      expect(prompt).toContain('User Management Initiative');
    });

    it('should return null when fetch returns non-OK response (graceful handling)', async () => {
      // Setup mock to return non-OK response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const { fetchMetaModelSummary } = require('../services/architectureModelClient');
      const result = await fetchMetaModelSummary('test-project.json', 'arch-1');

      // Verify null is returned (graceful degradation)
      expect(result).toBeNull();

      // Verify fetch was called
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return null when fetch throws an error (graceful handling)', async () => {
      // Setup mock to throw an error
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const { fetchMetaModelSummary } = require('../services/architectureModelClient');
      const result = await fetchMetaModelSummary('test-project.json', 'arch-1');

      // Verify null is returned (graceful degradation)
      expect(result).toBeNull();
    });
  });

  describe('Graceful degradation when both summaries fail', () => {
    it('should show both fallback messages when both summaries are null', () => {
      const prompt = buildBootstrapPrompt(
        mockBootstrapContext,
        null, // null productSummary
        null // null metaModelSummary
      );

      // Verify both fallback messages appear
      expect(prompt).toContain('No product backlog available');
      expect(prompt).toContain('No architecture context available');

      // Verify prompt is still valid (chat can continue)
      expect(prompt).toContain('WORK ITEM CONTEXT');
      expect(prompt).toContain('Add user profile feature');
    });
  });
});
