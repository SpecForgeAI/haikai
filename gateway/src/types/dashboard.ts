/**
 * TypeScript type definitions for the Dashboard Summary endpoint.
 *
 * Defines the DashboardSummaryDto contract and all nested types
 * for the GET /api/dashboard/summary endpoint.
 *
 * All property names are camelCase -- this is the wire format end-to-end
 * with no casing transforms needed on the frontend.
 *
 * Spec 2026-02-18: Dashboard Increment 2 -- Define Dashboard Summary Contract + Backend Mock Endpoint
 * Updated: Dashboard Increment 3 -- Build Dashboard Layout + Cards
 * Updated: Dashboard UX Improvements -- Extended MetricCard types, TestStrategy, ImplementationMetrics
 */

// ============================================================================
// Scope Types
// ============================================================================

/**
 * Scope type for the dashboard summary request.
 * Determines which slice of data the dashboard represents.
 *
 * - "ENTIRE_PRODUCT": Product-wide metrics (larger totals)
 * - "NEXT_5_EPICS": Narrower scope of the next 5 epics (smaller totals)
 * - "QTR": Quarterly scope
 * - "CUSTOM": User-defined custom scope
 */
export type ScopeType = 'ENTIRE_PRODUCT' | 'NEXT_5_EPICS' | 'QTR' | 'CUSTOM';

// ============================================================================
// Header and Scope
// ============================================================================

/**
 * Dashboard header containing project identity, generation timestamp,
 * and high-level summary counts.
 */
export interface DashboardHeader {
  /** Project name (set to the projectId argument in mock mode) */
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

/**
 * Dashboard scope metadata describing the slice of data being summarized.
 */
export interface DashboardScope {
  /** The scope type */
  type: ScopeType;
  /** Human-readable label for the scope */
  label: string;
  /** Optional scope value (e.g., quarter identifier, custom filter) */
  scopeValue: string | null;
}

// ============================================================================
// Summary Insight
// ============================================================================

/**
 * AI-generated summary insight for a dashboard section.
 */
export interface SummaryInsight {
  /** Whether the AI insight is enabled */
  enabled: boolean;
  /** AI-generated insight message (null when disabled) */
  message: string | null;
}

// ============================================================================
// Metric Card
// ============================================================================

/**
 * A single metric card representing a measurable item on the dashboard.
 * Contains a label and a value that can be numeric, boolean, or string.
 */
export interface MetricCard {
  /** Human-readable label for the metric */
  label: string;
  /** Value of the metric (number, boolean, or string) */
  value: number | boolean | string;
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
 * High-level architecture metrics with overall score and sub-category breakdowns.
 */
export interface HighLevelArchitectureMetrics {
  /** Overall high-level architecture health */
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
 * Strategic Foundation section containing product definition,
 * high-level architecture, roadmap, standards, test strategy, and AI summary insight.
 */
export interface StrategicFoundationSection {
  /** Product definition metrics with mission and last updated */
  productDefinition: ProductDefinitionMetrics;
  /** High-level architecture metrics with sub-categories */
  highLevelArchitecture: HighLevelArchitectureMetrics;
  /** Roadmap metrics with counts */
  roadmap: RoadmapMetrics;
  /** Users & Interactions metrics (user roles, business activities, UI screens) */
  usersAndInteractions: UsersInteractionsMetrics;
  /** Standards metrics (org and product tech stack) */
  standards: StandardsMetrics;
  /** Test strategy metrics */
  testStrategy: TestStrategyMetrics;
  /** AI-generated summary insight */
  summaryInsight: SummaryInsight;
}

// ============================================================================
// Detailed Definition and Delivery Section
// ============================================================================

/**
 * Detailed architecture metrics with overall score and sub-category breakdowns.
 */
export interface DetailedArchitectureMetrics {
  /** Overall detailed architecture health */
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
 * Top-level Dashboard Summary DTO returned by GET /api/dashboard/summary.
 * Contains all sections needed to render the dashboard cards.
 */
export interface DashboardSummaryDto {
  /** Dashboard header with project name and generation timestamp */
  header: DashboardHeader;
  /** Strategic Foundation section (product definition, HLA, roadmap, standards, test strategy) */
  strategicFoundation: StrategicFoundationSection;
  /** Scope metadata describing the data slice */
  scope: DashboardScope;
  /** Detailed Definition and Delivery section (pre-coding, post-coding) */
  detailedDefinitionAndDelivery: DetailedDefinitionAndDeliverySection;
}
