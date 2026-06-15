/**
 * Central export for all Gateway type definitions
 *
 * Spec 2026-03-02: Legacy Chat Removal and Cleanup (Increment 10)
 * - Removed ProductManagerResponse, ProductManagerValidationResult exports
 * - Removed SolutionArchitectResponse, SolutionArchitectValidationResult exports
 * - Removed RoadmapPmResponse, RoadmapPmValidationResult exports
 */

// Chat request/response types
export {
  ChatMode,
  ChatIntent,
  ChatPhase,
  ImplementChatPhase,
  WorkItemContext,
  ArchitectureContext,
  ChatContext,
  ChatRequest,
  ChatResponse,
  AssistantResponse,
  ChatArtifacts,
  SaveOasSpecSummaryDto,
  ToolTraceItem,
  SSETokenEvent,
  SSEToolCallStartedEvent,
  SSEToolCallFinishedEvent,
  SSEFinalEvent,
  SSEErrorEvent,
  SSEEventData,
  SSEEventType,
  // Resolved Implement Context types (Spec: Iteration 3)
  ResolvedEntitySummary,
  ResolvedDiagramSummary,
  ResolvedImplementContextDto,
  // Bootstrap Phase types (Spec: Iteration 3 Stage 3)
  FeatureSummary,
  EpicSummary,
  InitiativeSummary,
  ProductSummaryDto,
  MetaModelEntitySummary,
  MetaModelRelationshipSummary,
  MetaModelSummaryDto,
  BootstrapContext,
  // Handoff Plan types (Spec 2026-01-14: Stage 6a) - DEPRECATED
  HandoffIntent,
  HandoffPlanResponse,
  // Planner Response types (Spec 2026-01-22: Expanded Planner JSON Contract v1.1)
  PlannerSchemaVersion,
  PlannerResponse,
  ImplementationPlan,
  Increment,
  PlannerValidationResult,
  // Part-Sequencing types (Spec 2026-02-06: Implement-Part Sequencing Workflow)
  Part,
  PartStatus,
  JobStatus,
  // Open Question type (Spec 2026-01-23: Questions System v1)
  OpenQuestion,
  // Implementer Response types (Spec 2026-01-23: SA Handoff Per Increment)
  ImplementerSchemaVersion,
  ImplementerResponse,
  ImplementerValidationResult,
  // Test Planner Response types
  TestDefinition,
  TestPlannerResponse,
  // Expand-Resolve types (Spec 2026-01-16: Context Bundles Backend Expansion)
  EntityBundleSelection,
  DiagramBundleSelection,
  ExpandResolveRequestDto,
  ExpandResolveResponseDto,
  // Relationship types (Spec 2026-01-16: Context Bundles Auto-Include Relationships)
  RelationshipEndpoint,
  ResolvedRelationship,
  // Condensed Context DTO types (Spec 2026-01-16: Condensed Context DTOs for Planner LLM)
  AttributeInfo,
  EntityRelationshipInfo,
  EndpointInfo,
  ServiceDependencyInfo,
  EntityAndAttributesDto,
  InterfaceContractDto,
  ServiceSliceDto,
  DiagramSummaryDto,
  CondensedContextDto,
  // Displayed Message types (short-displayed-conversation.txt)
  DisplayedMessage,
} from './chat';

// Session types
export {
  GatewaySession,
  SessionUpdate,
  SessionStore,
  OpenAIMessage,
} from './session';

// Tool types
export {
  ToolName,
  ALLOWED_TOOL_NAMES,
  ToolParameterSchema,
  ToolFunctionDefinition,
  ToolDefinition,
  ToolCall,
  ToolResult,
  ListInterfacesParams,
  GetInterfaceOasContextParams,
  ComputeOasGapsParams,
  SaveOasSpecParams,
  SaveProductArtifactsParams,
  SaveArchitectureBaselineParams,
  SaveRoadmapStructureParams,
  SaveMarkdownArtifactParams,
  SaveUsersInteractionsParams,
  SaveBacklogItemsParams,
  SaveTemporaryArchitectureDiagramParams,
  SaveUserJourneysParams,
  SaveDiscoveryConfigParams,
  SaveProjectAnchorEntitiesParams,
  CreateProjectArtifactParams,
  ToolParams,
  TOOL_DEFINITIONS,
} from './tools';

// Validation utilities
export {
  ValidationError,
  ValidationResult,
  isNonEmptyString,
  isValidPreferredFormat,
  validateChatContext,
  validateChatRequest,
  validateSessionId,
} from './validation';

// Transcript types (Spec 2026-01-14: Stage 7 - Conversation Persistence)
// Extended with MessageEntry (Spec 2026-01-16: Conversation Persistence and Rehydration)
export {
  TranscriptRole,
  TranscriptPhase,
  TranscriptEntry,
  ConversationTranscript,
  MessageEntry,
  MessageEntryRole,
} from './transcript';

// Dashboard types (Spec 2026-02-18: Dashboard Increment 2, updated Increment 3)
export {
  DashboardSummaryDto,
  DashboardHeader,
  ScopeType,
  DashboardScope,
  SummaryInsight,
  MetricCard,
  StrategicFoundationSection,
  HighLevelArchitectureMetrics,
  DetailedDefinitionAndDeliverySection,
  DetailedArchitectureMetrics,
  StandardsMetrics,
  BacklogMetrics,
  TestingSuiteMetrics,
  VerificationMetrics,
  RoadmapMetrics,
  ProductDefinitionMetrics,
  PreCodingSection,
  PostCodingSection,
} from './dashboard';

// Chat V2 types (Spec 2026-02-28: Unified Conversation Engine v1 Backend)
export {
  HubThreadKey,
  FeatureThreadKey,
  PanelThreadKey,
  ThreadKey,
  threadKeyToString,
  parseThreadKey,
  ThreadMessage,
  Thread,
  PersonaDefinition,
  PhaseDefinition,
  TaskDefinition,
  ContextResolverConfig,
  ChatV2Request,
  ChatV2Response,
  isChatV2Request,
  isChatV2Response,
} from './chatV2';
