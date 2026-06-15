/**
 * Work Item Tree Builder Utilities
 *
 * Spec 2026-01-03: Product Backlog Tree View (Stage 4)
 * Task Group 2: Tree model builder utilities for hierarchical work item display.
 *
 * Pure functions for building tree structures from flat work item arrays.
 */

import type { WorkItem, WorkItemTreeNode, WorkItemTreeResult } from '../types/workItems';

/**
 * Compare function for sorting work items.
 * Sort order: sortOrder asc -> createdAt asc -> id asc (fallback chain)
 *
 * @param a - First work item to compare
 * @param b - Second work item to compare
 * @returns Negative if a < b, positive if a > b, 0 if equal
 */
function compareWorkItems(a: WorkItem, b: WorkItem): number {
  // Primary: sortOrder ascending
  if (a.sortOrder !== b.sortOrder) {
    return a.sortOrder - b.sortOrder;
  }

  // Secondary: createdAt ascending (string comparison works for ISO dates)
  if (a.createdAt !== b.createdAt) {
    return a.createdAt.localeCompare(b.createdAt);
  }

  // Tertiary: id ascending (fallback for deterministic ordering)
  return a.id.localeCompare(b.id);
}

/**
 * Build lookup maps from flat work item array.
 *
 * @param items - Array of work items
 * @returns Object containing byId map and childrenByParent map
 */
function buildMaps(items: WorkItem[]): {
  byId: Map<string, WorkItem>;
  childrenByParent: Map<string | null, WorkItem[]>;
} {
  const byId = new Map<string, WorkItem>();
  const childrenByParent = new Map<string | null, WorkItem[]>();

  // First pass: build byId map
  for (const item of items) {
    byId.set(item.id, item);
  }

  // Second pass: group children by parent
  for (const item of items) {
    const parentKey = item.parentId;
    const existing = childrenByParent.get(parentKey) || [];
    existing.push(item);
    childrenByParent.set(parentKey, existing);
  }

  // Sort children within each group
  for (const children of childrenByParent.values()) {
    children.sort(compareWorkItems);
  }

  return { byId, childrenByParent };
}

/**
 * Recursively build tree nodes from parent ID.
 *
 * @param parentId - Parent ID to build children for (null for roots)
 * @param depth - Current depth in the tree
 * @param childrenByParent - Map of parent ID to children
 * @returns Array of tree nodes for the given parent
 */
function buildNodes(
  parentId: string | null,
  depth: number,
  childrenByParent: Map<string | null, WorkItem[]>
): WorkItemTreeNode[] {
  const children = childrenByParent.get(parentId) || [];

  return children.map((item) => {
    // Default expansion: INITIATIVE nodes expanded, others collapsed
    const isExpanded = item.type === 'INITIATIVE';

    return {
      item,
      children: buildNodes(item.id, depth + 1, childrenByParent),
      depth,
      isExpanded,
    };
  });
}

/**
 * Build a hierarchical tree structure from a flat array of work items.
 *
 * Features:
 * - Builds byId Map for O(1) lookups
 * - Builds childrenByParent Map for grouping
 * - Identifies roots (null parentId or orphans with missing parent)
 * - Recursively builds WorkItemTreeNode objects
 * - Sets depth and default isExpanded (true for INITIATIVE, false otherwise)
 * - Sorts siblings by: sortOrder asc, createdAt asc, id asc
 *
 * @param items - Flat array of work items
 * @returns WorkItemTreeResult with roots, byId, and childrenByParent
 */
export function buildWorkItemTree(items: WorkItem[]): WorkItemTreeResult {
  const { byId, childrenByParent } = buildMaps(items);

  // Find root items:
  // 1. Items with null parentId
  // 2. Items with parentId that doesn't exist in byId (orphans)
  const rootItems: WorkItem[] = [];

  for (const item of items) {
    const isNullParent = item.parentId === null;
    const isMissingParent = item.parentId !== null && !byId.has(item.parentId);

    if (isNullParent || isMissingParent) {
      rootItems.push(item);
    }
  }

  // Sort root items
  rootItems.sort(compareWorkItems);

  // Build tree nodes for roots
  const roots: WorkItemTreeNode[] = rootItems.map((item) => {
    const isExpanded = item.type === 'INITIATIVE';

    return {
      item,
      children: buildNodes(item.id, 1, childrenByParent),
      depth: 0,
      isExpanded,
    };
  });

  return {
    roots,
    byId,
    childrenByParent,
  };
}

/**
 * Derive the parent chain for a work item.
 * Returns array of ancestors from root to immediate parent (not including the item itself).
 *
 * Features:
 * - Walks parentId chain until null or missing parent
 * - Circular reference protection (stops if seen IDs detected)
 * - Returns empty array for root items
 *
 * @param itemId - ID of the work item to get parent chain for
 * @param byId - Map of item ID to WorkItem for lookups
 * @returns Array of WorkItem from root ancestor to immediate parent
 */
export function deriveParentChain(
  itemId: string,
  byId: Map<string, WorkItem>
): WorkItem[] {
  const chain: WorkItem[] = [];
  const seen = new Set<string>();

  // Get the starting item
  const startItem = byId.get(itemId);
  if (!startItem) {
    return chain;
  }

  // Walk up the parent chain
  let currentId = startItem.parentId;

  while (currentId !== null) {
    // Circular reference protection
    if (seen.has(currentId)) {
      break;
    }
    seen.add(currentId);

    const parent = byId.get(currentId);
    if (!parent) {
      // Parent doesn't exist (orphan case)
      break;
    }

    // Add to beginning of chain (we're walking up, so prepend)
    chain.unshift(parent);

    // Move to next parent
    currentId = parent.parentId;
  }

  return chain;
}
