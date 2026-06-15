/**
 * Work Items Type Definitions
 *
 * Spec 2026-01-03: Product Backlog Tree View (Stage 4)
 * Type definitions for Work Items (Initiatives, Epics, Features, Stories)
 * and tree structures for hierarchical display.
 *
 * Extended in Spec 2026-01-17: Fix Feature Edit 400 Error
 * Added type field to WorkItemUpdatePayload
 *
 * Extended in Spec 2026-01-18: Fix Feature Edit 400 Error - Preserve Parent
 * Added parentId field to WorkItemUpdatePayload
 */

/**
 * Work Item types - supports the standard hierarchy plus extensibility.
 * Conventional hierarchy: INITIATIVE > EPIC > FEATURE > STORY > (TASK | BUG | TEST)
 * The string fallback allows for custom types without type errors.
 */
export type WorkItemType = 'INITIATIVE' | 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG' | 'TEST' | string;

/**
 * Work Item interface
 * Represents a single work item in the product backlog
 */
export interface WorkItem {
  /** Unique identifier */
  id: string;
  /** Project this work item belongs to */
  projectId: string;
  /** Type of work item (INITIATIVE, EPIC, FEATURE, STORY) */
  type: WorkItemType;
  /** Parent work item ID (null for root items) */
  parentId: string | null;
  /** Title/name of the work item */
  title: string;
  /** Description of the work item */
  description: string | null;
  /** Current status (e.g., 'NEW', 'IN_PROGRESS', 'DONE') */
  status: string;
  /** Sort order within siblings (lower = earlier) */
  sortOrder: number;
  /** Priority (nullable, lower = higher priority) */
  priority: number | null;
  /** Target delivery window (e.g., '2026-Q2') */
  targetWindow: string | null;
  /** Arbitrary tags/metadata */
  tags: Record<string, unknown> | null;
  /** External system name for integrations (e.g., 'JIRA') */
  externalSystem: string | null;
  /** External system key (e.g., 'PROJ-123') */
  externalKey: string | null;
  /** External system browse URL (e.g., 'https://acme.atlassian.net/browse/PROJ-123') */
  externalUrl: string | null;
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp when last updated */
  updatedAt: string;
  /**
   * Implementation git outcome (Spec 2026-06-12): feature branch the
   * implementation job pushed to. Optional/nullable — absent until an
   * implementation job has completed for this work item.
   */
  implementationBranch?: string | null;
  /** Implementation git outcome (Spec 2026-06-12): pull request URL */
  implementationPrUrl?: string | null;
  /** Implementation git outcome (Spec 2026-06-12): job logs URL */
  implementationLogsUrl?: string | null;
}

/**
 * Work Item Tree Node interface
 * Represents a node in the hierarchical tree structure
 * Wraps a WorkItem with tree-specific metadata
 */
export interface WorkItemTreeNode {
  /** The underlying work item */
  item: WorkItem;
  /** Child nodes in the hierarchy */
  children: WorkItemTreeNode[];
  /** Depth in the tree (0 = root) */
  depth: number;
  /** Whether this node is expanded in the UI */
  isExpanded: boolean;
}

/**
 * Work Item Tree Result interface
 * Return type for the tree builder function
 * Contains the tree structure and lookup maps for efficient access
 */
export interface WorkItemTreeResult {
  /** Root nodes of the tree (items with no parent or orphans) */
  roots: WorkItemTreeNode[];
  /** Map of item ID to WorkItem for O(1) lookups */
  byId: Map<string, WorkItem>;
  /** Map of parent ID to children for hierarchy traversal */
  childrenByParent: Map<string | null, WorkItem[]>;
}

/**
 * Status options for work items
 * Spec 2026-01-03: Product Backlog CRUD (Stage 4 - Increment 3)
 *
 * Flow: PLANNED -> IN_PROGRESS -> DEV_COMPLETE -> COMPLETED (or CANCELLED at any point).
 * DEV_COMPLETE means code/work has been written but Definition of Done sign-off
 * (verification + PM acceptance) hasn't happened yet.
 */
export const STATUS_OPTIONS = ['PLANNED', 'IN_PROGRESS', 'DEV_COMPLETE', 'COMPLETED', 'CANCELLED'] as const;
export type WorkItemStatus = typeof STATUS_OPTIONS[number];

/**
 * Form data interface for create/edit modals
 * Used for form state management in WorkItemCreateModal and WorkItemEditModal
 */
export interface WorkItemFormData {
  /** Title/name of the work item (required) */
  title: string;
  /** Description of the work item */
  description: string;
  /** Current status */
  status: string;
  /** Priority (nullable, lower = higher priority) */
  priority: number | null;
  /** Target delivery window (e.g., '2026-Q2') */
  targetWindow: string | null;
}

/**
 * Payload interface for creating a new work item
 * Sent to POST /api/model/projects/{projectId}/work-items
 */
export interface WorkItemCreatePayload {
  /** Type of work item (FEATURE or STORY) */
  type: WorkItemType;
  /** Parent work item ID */
  parentId: string;
  /** Title/name of the work item (required) */
  title: string;
  /** Description of the work item */
  description?: string;
  /** Current status */
  status?: string;
  /** Priority (nullable) */
  priority?: number;
  /** Target delivery window */
  targetWindow?: string;
  /** Sort order within siblings */
  sortOrder: number;
}

/**
 * Payload interface for updating an existing work item
 * Sent to PUT /api/model/projects/{projectId}/work-items/{id}
 *
 * Spec 2026-01-17: Fix Feature Edit 400 Error
 * Added `type` field to satisfy backend validation requirements.
 * The type field must match the existing work item's type (no type changes allowed).
 *
 * Spec 2026-01-18: Fix Feature Edit 400 Error - Preserve Parent
 * Added optional `parentId` field to preserve parent relationship on updates.
 * When provided, the parent relationship is maintained in the backend.
 */
export interface WorkItemUpdatePayload {
  /** Type of work item (required by backend validation) */
  type?: WorkItemType;
  /** Parent work item ID (optional, preserves existing parent when sent) */
  parentId?: string;
  /** Title/name of the work item */
  title?: string;
  /** Description of the work item */
  description?: string;
  /** Current status */
  status?: string;
  /** Priority (nullable) */
  priority?: number;
  /** Target delivery window */
  targetWindow?: string;
  /** External system name (e.g. 'JIRA') — used by the Link-to-Jira flow */
  externalSystem?: string;
  /** External system key (e.g. 'KAN-5') — used by the Link-to-Jira flow */
  externalKey?: string;
  /**
   * Arbitrary tags/metadata pass-through (Spec 2026-06-12). The backend PUT
   * overwrites tags with the request value, so callers performing partial
   * updates should echo the current tags to avoid wiping them.
   */
  tags?: Record<string, unknown>;
  /** Implementation git outcome (Spec 2026-06-12): feature branch — null-guarded on the backend (absent = unchanged) */
  implementationBranch?: string;
  /** Implementation git outcome (Spec 2026-06-12): pull request URL — null-guarded on the backend (absent = unchanged) */
  implementationPrUrl?: string;
  /** Implementation git outcome (Spec 2026-06-12): logs URL — null-guarded on the backend (absent = unchanged) */
  implementationLogsUrl?: string;
}
