/**
 * End-to-End Integration Tests for Context Injection
 *
 * Spec: 2026-01-16 Fix Implement Assistant Context Injection
 * Task Group 3: End-to-End Verification
 *
 * Tests cover:
 * - Bootstrap greeting includes product backlog acknowledgment when data exists
 * - Bootstrap greeting includes architecture context acknowledgment when data exists
 * - Highlighted entities resolve to names when user sends message with highlighted context
 */

import { buildSystemPrompt, buildBootstrapPrompt, buildImplementPlannerPrompt } from '../services/promptBuilder';
import { ChatContext, ProductSummaryDto, MetaModelSummaryDto, ResolvedImplementContextDto } from '../types/chat';
import { GatewaySession } from '../types/session';

describe('Context Injection End-to-End - Spec 2026-01-16', () => {
  const mockSession: GatewaySession = {
    sessionId: 'e2e-test-session',
    mcpSessionId: 'mcp-e2e-test-session',
    createdAt: new Date(),
    lastActivity: new Date(),
  };

  describe('Task 3.1: Bootstrap greeting includes product backlog acknowledgment when data exists', () => {
    it('should include product backlog content in bootstrap prompt when productSummary provided', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'bootstrap',
        filename: 'test-project.json',
        workItem: {
          id: 'WI-E2E-1',
          title: 'User Profile Feature',
          type: 'Feature',
          description: 'Allow users to view and edit profiles',
        },
      };

      const productSummary: ProductSummaryDto = {
        initiatives: [
          {
            id: 'init-1',
            title: 'User Experience Initiative',
            description: 'Improving user experience',
            epics: [
              {
                id: 'epic-1',
                title: 'Profile Management Epic',
                description: 'All profile-related features',
                features: [
                  { id: 'feat-1', title: 'View Profile', description: 'View user profile' },
                  { id: 'feat-2', title: 'Edit Profile', description: 'Edit user profile' },
                ],
              },
            ],
          },
        ],
      };

      const prompt = buildSystemPrompt(mockSession, context, null, productSummary, null);

      // Verify product backlog content is included (not fallback message)
      expect(prompt).not.toContain('No product backlog available');
      expect(prompt).toContain('User Experience Initiative');
      expect(prompt).toContain('Profile Management Epic');
      expect(prompt).toContain('View Profile');
      expect(prompt).toContain('Edit Profile');
    });

    it('should show fallback message when productSummary is null', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'bootstrap',
        filename: 'test-project.json',
        workItem: {
          id: 'WI-E2E-2',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildSystemPrompt(mockSession, context, null, null, null);

      expect(prompt).toContain('No product backlog available');
    });

    it('should show fallback message when productSummary has empty initiatives', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'bootstrap',
        filename: 'test-project.json',
        workItem: {
          id: 'WI-E2E-3',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const emptyProductSummary: ProductSummaryDto = {
        initiatives: [],
      };

      const prompt = buildSystemPrompt(mockSession, context, null, emptyProductSummary, null);

      expect(prompt).toContain('No product backlog available');
    });
  });

  describe('Task 3.1: Bootstrap greeting includes architecture context acknowledgment when data exists', () => {
    it('should include architecture context in bootstrap prompt when metaModelSummary provided', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'bootstrap',
        filename: 'test-project.json',
        workItem: {
          id: 'WI-E2E-4',
          title: 'API Integration Feature',
          type: 'Feature',
          description: 'Integrate with external API',
        },
      };

      const metaModelSummary: MetaModelSummaryDto = {
      applications: [],
      business_users: [],
      process_activities: [],
      ui_screens: [],
      data_store_count: 0,
        services: [
          { id: 'svc-1', name: 'OrderService', entity_type: 'services' },
          { id: 'svc-2', name: 'PaymentService', entity_type: 'services' },
        ],
        data_entities: [
          { id: 'lde-1', name: 'Order', entity_type: 'logicalDataEntities' },
          { id: 'pde-1', name: 'orders_table', entity_type: 'physicalDataEntities' },
        ],
        interfaces: [
          { id: 'ifc-1', name: 'OrderAPI', entity_type: 'interfaces' },
        ],
        relationships: [
          { source_entity: 'OrderService', target_entity: 'orders_table', relationship_type: 'reads_from' },
        ],
      };

      const prompt = buildSystemPrompt(mockSession, context, null, null, metaModelSummary);

      // Verify architecture context is included (not fallback message)
      expect(prompt).not.toContain('No architecture context available');
      expect(prompt).toContain('OrderService');
      expect(prompt).toContain('PaymentService');
      expect(prompt).toContain('Order');
      expect(prompt).toContain('orders_table');
      expect(prompt).toContain('OrderAPI');
      expect(prompt).toContain('reads_from');
    });

    it('should show fallback message when metaModelSummary is null', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'bootstrap',
        filename: 'test-project.json',
        workItem: {
          id: 'WI-E2E-5',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildSystemPrompt(mockSession, context, null, null, null);

      expect(prompt).toContain('No architecture context available');
    });

    it('should show fallback message when metaModelSummary has all empty arrays', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'bootstrap',
        filename: 'test-project.json',
        workItem: {
          id: 'WI-E2E-6',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const emptyMetaModelSummary: MetaModelSummaryDto = {
      applications: [],
      business_users: [],
      process_activities: [],
      ui_screens: [],
      data_store_count: 0,
        services: [],
        data_entities: [],
        interfaces: [],
        relationships: [],
      };

      const prompt = buildSystemPrompt(mockSession, context, null, null, emptyMetaModelSummary);

      expect(prompt).toContain('No architecture context available');
    });
  });

  describe('Task 3.1: Highlighted entities resolve to names when user sends message with highlighted context', () => {
    it('should include resolved entity names in refine phase prompt', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        filename: 'test-project.json',
        workItem: {
          id: 'WI-E2E-7',
          title: 'Database Integration',
          type: 'Feature',
          description: 'Integrate with database tables',
        },
        architectureContext: {
          entityIds: ['physicalDataEntities::pde-customers', 'services::svc-customer-api'],
          diagramIds: ['diagram-data-model'],
        },
      };

      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'pde-customers',
            name: 'Customers Table',
            entity_type: 'physicalDataEntities',
            category: 'data',
            relevant_fields: {
              tableName: 'customers',
              primaryKey: 'customer_id',
              columns: 'name, email, created_at',
            },
          },
          {
            id: 'svc-customer-api',
            name: 'Customer API Service',
            entity_type: 'services',
            category: 'application',
            relevant_fields: {
              serviceType: 'REST',
              endpoints: '/customers, /customers/{id}',
            },
          },
        ],
        resolved_diagrams: [
          {
            id: 'diagram-data-model',
            name: 'Customer Data Model',
            diagram_type: 'ERD',
            referenced_entity_ids: ['pde-customers'],
            referenced_entity_names: ['Customers Table'],
          },
        ],
      };

      const prompt = buildSystemPrompt(mockSession, context, resolvedContext, null, null);

      // Verify resolved entity names appear in prompt
      expect(prompt).toContain('Customers Table');
      expect(prompt).toContain('Customer API Service');
      expect(prompt).toContain('Customer Data Model');

      // Verify relevant fields are included
      expect(prompt).toContain('tableName');
      expect(prompt).toContain('customers');
      expect(prompt).toContain('customer_id');
    });

    it('should show fallback when resolvedContext is null in refine phase', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        filename: 'test-project.json',
        workItem: {
          id: 'WI-E2E-8',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildSystemPrompt(mockSession, context, null, null, null);

      expect(prompt).toContain('No resolved context available');
    });

    it('should show fallback when resolvedContext has empty arrays', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        filename: 'test-project.json',
        workItem: {
          id: 'WI-E2E-9',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const emptyResolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [],
        resolved_diagrams: [],
      };

      const prompt = buildSystemPrompt(mockSession, context, emptyResolvedContext, null, null);

      expect(prompt).toContain('No resolved entities or diagrams');
    });
  });

  describe('Comprehensive E2E flow: Bootstrap with summaries followed by refine with highlighted context', () => {
    it('should properly chain bootstrap and refine phases with different context sources', () => {
      const workItem = {
        id: 'WI-E2E-FLOW',
        title: 'Complete Feature Implementation',
        type: 'Feature',
        description: 'A comprehensive feature requiring multiple architecture entities',
      };

      // Step 1: Bootstrap phase with product and meta-model summaries
      const bootstrapContext: ChatContext = {
        mode: 'implement_feature',
        phase: 'bootstrap',
        filename: 'flow-test-project.json',
        workItem,
      };

      const productSummary: ProductSummaryDto = {
        initiatives: [{
          id: 'init-flow',
          title: 'Flow Test Initiative',
          description: 'Testing the complete flow',
          epics: [{
            id: 'epic-flow',
            title: 'Flow Test Epic',
            description: 'Epic for flow testing',
            features: [{ id: 'feat-flow', title: 'Flow Feature', description: 'Feature in flow' }],
          }],
        }],
      };

      const metaModelSummary: MetaModelSummaryDto = {
      applications: [],
      business_users: [],
      process_activities: [],
      ui_screens: [],
      data_store_count: 0,
        services: [{ id: 'svc-flow', name: 'FlowService', entity_type: 'services' }],
        data_entities: [{ id: 'de-flow', name: 'FlowEntity', entity_type: 'logicalDataEntities' }],
        interfaces: [],
        relationships: [],
      };

      const bootstrapPrompt = buildSystemPrompt(
        mockSession,
        bootstrapContext,
        null,
        productSummary,
        metaModelSummary
      );

      // Verify bootstrap includes both summaries
      expect(bootstrapPrompt).toContain('Flow Test Initiative');
      expect(bootstrapPrompt).toContain('FlowService');
      expect(bootstrapPrompt).toContain('FlowEntity');

      // Step 2: Refine phase with highlighted entities (resolved context)
      const refineContext: ChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        filename: 'flow-test-project.json',
        workItem,
        architectureContext: {
          entityIds: ['services::svc-flow', 'logicalDataEntities::de-flow'],
          diagramIds: [],
        },
      };

      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-flow',
            name: 'FlowService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: { port: '8080' },
          },
          {
            id: 'de-flow',
            name: 'FlowEntity',
            entity_type: 'logicalDataEntities',
            category: 'data',
            relevant_fields: { attributes: 'id, name, status' },
          },
        ],
        resolved_diagrams: [],
      };

      const refinePrompt = buildSystemPrompt(
        mockSession,
        refineContext,
        resolvedContext,
        null, // product summary not used in refine
        null  // meta-model summary not used in refine
      );

      // Verify refine includes resolved context
      expect(refinePrompt).toContain('FlowService');
      expect(refinePrompt).toContain('FlowEntity');
      expect(refinePrompt).toContain('port');
      expect(refinePrompt).toContain('8080');
      expect(refinePrompt).toContain('attributes');
    });
  });

  describe('Edge case: Both summaries and resolved context provided', () => {
    it('should use resolved context in refine phase even if summaries provided', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'refine', // refine phase uses resolved context, not summaries
        filename: 'test-project.json',
        workItem: {
          id: 'WI-EDGE',
          title: 'Edge Case Feature',
          type: 'Feature',
          description: 'Testing edge case',
        },
      };

      const productSummary: ProductSummaryDto = {
        initiatives: [{ id: 'init', title: 'Summary Initiative', description: 'From summary', epics: [] }],
      };

      const metaModelSummary: MetaModelSummaryDto = {
      applications: [],
      business_users: [],
      process_activities: [],
      ui_screens: [],
      data_store_count: 0,
        services: [{ id: 'svc-summary', name: 'SummaryService', entity_type: 'services' }],
        data_entities: [],
        interfaces: [],
        relationships: [],
      };

      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-resolved',
            name: 'ResolvedService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: {},
          },
        ],
        resolved_diagrams: [],
      };

      // In refine phase, buildSystemPrompt uses the planner template which shows resolved context
      const prompt = buildSystemPrompt(mockSession, context, resolvedContext, productSummary, metaModelSummary);

      // Should contain resolved context (from refine phase template)
      expect(prompt).toContain('ResolvedService');
      expect(prompt).toContain('Resolved Context Details');

      // Should NOT contain product summary content (that's for bootstrap phase)
      expect(prompt).not.toContain('Summary Initiative');
      expect(prompt).not.toContain('PRODUCT BACKLOG SUMMARY');
    });

    it('should use summaries in bootstrap phase even if resolved context provided', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'bootstrap', // bootstrap phase uses summaries, not resolved context
        filename: 'test-project.json',
        workItem: {
          id: 'WI-EDGE-2',
          title: 'Edge Case Feature 2',
          type: 'Feature',
          description: 'Testing edge case 2',
        },
      };

      const productSummary: ProductSummaryDto = {
        initiatives: [{ id: 'init', title: 'Summary Initiative', description: 'From summary', epics: [] }],
      };

      const metaModelSummary: MetaModelSummaryDto = {
      applications: [],
      business_users: [],
      process_activities: [],
      ui_screens: [],
      data_store_count: 0,
        services: [{ id: 'svc-summary', name: 'SummaryService', entity_type: 'services' }],
        data_entities: [],
        interfaces: [],
        relationships: [],
      };

      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          { id: 'svc-resolved', name: 'ResolvedService', entity_type: 'services', category: 'application', relevant_fields: {} },
        ],
        resolved_diagrams: [],
      };

      // In bootstrap phase, buildSystemPrompt uses the bootstrap template which shows summaries
      const prompt = buildSystemPrompt(mockSession, context, resolvedContext, productSummary, metaModelSummary);

      // Should contain product/meta-model summaries
      expect(prompt).toContain('Summary Initiative');
      expect(prompt).toContain('SummaryService');
      expect(prompt).toContain('PRODUCT BACKLOG SUMMARY');
      expect(prompt).toContain('ARCHITECTURE META-MODEL SUMMARY');

      // Bootstrap template does not include Resolved Context Details section
      expect(prompt).not.toContain('Resolved Context Details');
    });
  });
});
