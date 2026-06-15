/**
 * Dashboard Summary DTO Types
 *
 * Frontend mirror of gateway dashboard types (camelCase wire format, no mapping needed).
 * These types are consumed by the dashboardApi client and will be imported by
 * Dashboard UI components in Increment 3.
 *
 * Spec 2026-02-18: Dashboard Increment 2 -- Define Dashboard Summary Contract + Backend Mock Endpoint
 * Updated: Dashboard Increment 3 -- Build Dashboard Layout + Cards
 * Updated: Dashboard UX Improvements -- Extended MetricCard types, TestStrategy, ImplementationMetrics
 */

// ============================================================================
// Scope Types
// ============================================================================

/**
 * Scope type for dashboard summary queries.
 * Determines the breadth of metrics returned.
 */
export type ScopeType = 'ENTIRE_PRODUCT' | 'NEXT_5_EPICS' | 'QTR' | 'CUSTOM';

/**
 * Dashboard scope metadata included in every summary response.
 */
export interface DashboardScope {
  /** The scope type that was applied */
  type: ScopeType;
  /** Human-readable label for the scope (e.g., "Entire Product", "Next 5 Epics") */
  label: string;
  /** Optional scope value for QTR/CUSTOM scopes (e.g., "Q1 2026") */
  scopeValue: string | null;
}

// ============================================================================
// Header
// ============================================================================

/**
 * Dashboard header with project metadata and high-level summary counts.
 */
export interface DashboardHeader {
  /** Project name (matches the projectId used in the request) */
  projectName: string;
  /** ISO-8601 timestamp of when the summary was generated */
  generatedAt: string;
  /** Total number of initiatives in the project */
  initiativesCount: number;
  /** Total number of epics in the project */
  epicsCount: number;
  /** Number of currently active epics */
  activeEpicsCount: number;
  /** Number of stories currently in progress */
  storiesInProgressCount: number;
  /** Human-readable label for the last update time */
  lastUpdatedLabel: string;
  /** Project mode (e.g., "GREENFIELD") */
  mode: string;
  /** AI-generated header insight about overall project health (~70 words), null if LLM unavailable */
  headerInsight: string | null;
}

// ============================================================================
// Metric and Insight Types
// ============================================================================

/**
 * A single metric card with label and value (number, boolean, or string).
 */
export interface MetricCard {
  /** Human-readable label for this metric */
  label: string;
  /** Value for this metric (number, boolean, or string) */
  value: number | boolean | string;
}

/**
 * Summary insight for a dashboard section.
 */
export interface SummaryInsight {
  /** Whether the insight is enabled */
  enabled: boolean;
  /** Insight message text (null when disabled) */
  message: string | null;
}

// ============================================================================
// New Metric Interfaces (Increment 3)
// ============================================================================

/**
 * Standards metrics with org and product tech stack status.
 */
export interface StandardsMetrics {
  /** Org tech stack metric */
  orgTechStack: MetricCard;
  /** Product tech stack metric */
  productTechStack: MetricCard;
}

/**
 * Backlog metrics with epic, feature, and story counts.
 */
export interface BacklogMetrics {
  /** Number of epics in scope */
  epicsInScope: MetricCard;
  /** Number of features */
  featuresCount: MetricCard;
  /** Number of stories */
  storiesCount: MetricCard;
  /** Number of stories with acceptance criteria */
  storiesWithAcceptanceCriteriaCount: MetricCard;
}

/**
 * Testing suite metrics with test type counts.
 */
export interface TestingSuiteMetrics {
  /** Number of end-to-end tests */
  endToEndTestCount: MetricCard;
  /** Number of functional tests */
  functionalTestCount: MetricCard;
}

/**
 * Verification metrics with verified and pending review counts.
 */
export interface VerificationMetrics {
  /** Number of stories verified */
  storiesVerifiedCount: MetricCard;
  /** Number of stories pending review */
  pendingReviewCount: MetricCard;
}

/**
 * Roadmap metrics with initiative and epic counts.
 */
export interface RoadmapMetrics {
  /** Number of initiatives */
  initiativesCount: MetricCard;
  /** Number of epics */
  epics: MetricCard;
  /** Number of completed epics */
  completed: MetricCard;
}

/**
 * Product definition metrics with mission and last updated info.
 */
export interface ProductDefinitionMetrics {
  /** Whether a mission statement exists */
  missionExists: MetricCard;
  /** Human-readable label for the last update */
  lastUpdatedLabel: MetricCard;
}

/**
 * Implementation metrics with feature and story progress.
 */
export interface ImplementationMetrics {
  /** Number of features currently in progress */
  featuresInProgress: MetricCard;
  /** Number of stories currently in progress */
  storiesInProgress: MetricCard;
  /** Number of stories completed */
  storiesComplete: MetricCard;
}

/**
 * Test strategy metrics with existence and last updated info.
 */
export interface TestStrategyMetrics {
  /** Whether a test strategy exists */
  exists: MetricCard;
  /** Last updated date of the test strategy */
  lastUpdated: MetricCard;
}

/**
 * Users & Interactions metrics with user roles, business activities, and UI screens.
 */
export interface UsersInteractionsMetrics {
  /** Count of business users / user roles */
  userRoles: MetricCard;
  /** Count of process activities / business activities */
  businessActivities: MetricCard;
  /** Count of UI screens (or "No UI" if zero) */
  uiScreens: MetricCard;
}

// ============================================================================
// Strategic Foundation Section
// ============================================================================

/**
 * High-level architecture metrics within the Strategic Foundation section.
 */
export interface HighLevelArchitectureMetrics {
  /** Overall architecture health metric */
  overall: MetricCard;
  /** Applications metric */
  applications: MetricCard;
  /** Services metric */
  services: MetricCard;
  /** Interfaces metric */
  interfaces: MetricCard;
  /** Data stores metric */
  dataStores: MetricCard;
}

/**
 * Strategic Foundation section containing product definition, architecture,
 * roadmap, standards, test strategy, and summary insight metrics.
 */
export interface StrategicFoundationSection {
  /** Product definition metrics with mission and last updated */
  productDefinition: ProductDefinitionMetrics;
  /** High-level architecture metrics breakdown */
  highLevelArchitecture: HighLevelArchitectureMetrics;
  /** Roadmap metrics with counts */
  roadmap: RoadmapMetrics;
  /** Users & Interactions metrics (user roles, business activities, UI screens) */
  usersAndInteractions: UsersInteractionsMetrics;
  /** Standards metrics (org and product tech stack) */
  standards: StandardsMetrics;
  /** Test strategy metrics */
  testStrategy: TestStrategyMetrics;
  /** Summary insight for this section */
  summaryInsight: SummaryInsight;
}

// ============================================================================
// Detailed Definition and Delivery Section
// ============================================================================

/**
 * Detailed architecture metrics within the Definition and Delivery section.
 */
export interface DetailedArchitectureMetrics {
  /** Overall detailed architecture health metric */
  overall: MetricCard;
  /** Process activities metric */
  processActivities: MetricCard;
  /** Interface endpoints metric */
  interfaceEndpoints: MetricCard;
  /** Logical data entities metric */
  logicalDataEntities: MetricCard;
  /** Physical data entities metric */
  physicalDataEntities: MetricCard;
}

/**
 * Pre-coding section containing backlog, detailed architecture, and testing suite metrics.
 */
export interface PreCodingSection {
  /** Backlog metrics */
  backlog: BacklogMetrics;
  /** Detailed architecture metrics with sub-categories */
  detailedArchitecture: DetailedArchitectureMetrics;
  /** Testing suite metrics */
  testingSuite: TestingSuiteMetrics;
}

/**
 * Post-coding section containing implementation, verification, and summary insight.
 */
export interface PostCodingSection {
  /** Implementation metrics */
  implementation: ImplementationMetrics;
  /** Verification metrics */
  verification: VerificationMetrics;
  /** AI-generated summary insight */
  summaryInsight: SummaryInsight;
}

/**
 * Detailed Definition and Delivery section containing pre-coding and post-coding sub-sections.
 */
export interface DetailedDefinitionAndDeliverySection {
  /** Pre-coding sub-section (backlog, detailed architecture, testing suite) */
  preCoding: PreCodingSection;
  /** Post-coding sub-section (implementation, verification, summary insight) */
  postCoding: PostCodingSection;
}

// ============================================================================
// Top-Level DTO
// ============================================================================

/**
 * Top-level dashboard summary response DTO.
 * Contains all sections needed to render the dashboard.
 */
export interface DashboardSummaryDto {
  /** Project header with metadata */
  header: DashboardHeader;
  /** Strategic Foundation section metrics */
  strategicFoundation: StrategicFoundationSection;
  /** Scope metadata for the summary */
  scope: DashboardScope;
  /** Detailed Definition and Delivery section metrics */
  detailedDefinitionAndDelivery: DetailedDefinitionAndDeliverySection;
}
