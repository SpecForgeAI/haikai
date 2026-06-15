/**
 * Quarter Utility Functions for Time-Based Architecture Views
 * Provides quarter comparison, visibility checks, and navigation helpers
 */

import type { AnyEntity, AnyRelationship, TemporalDiagramElement } from '../types/model';

/**
 * Parse a quarter string into year and quarter number
 * @param quarter - Quarter string in format "YYYY-Qn" (e.g., "2026-Q2" or "2026-q2")
 * @returns Object with year and quarter number, or null if invalid
 */
function parseQuarter(quarter: string): { year: number; quarter: number } | null {
  const match = quarter.match(/^(\d{4})-[Qq]([1-4])$/);
  if (!match) {
    console.warn('Invalid quarter format:', quarter);
    return null;
  }

  const year = parseInt(match[1], 10);
  const quarterNum = parseInt(match[2], 10);

  return { year, quarter: quarterNum };
}

/**
 * Compare two quarter strings chronologically
 * @param q1 - First quarter string (e.g., "2026-Q1")
 * @param q2 - Second quarter string (e.g., "2026-Q2")
 * @returns -1 if q1 < q2, 0 if equal, 1 if q1 > q2
 * @throws Error if either quarter string is invalid
 */
export function compareQuarters(q1: string, q2: string): number {
  const parsed1 = parseQuarter(q1);
  const parsed2 = parseQuarter(q2);

  if (!parsed1) {
    throw new Error(`Invalid quarter format: ${q1}. Expected format: YYYY-Qn`);
  }
  if (!parsed2) {
    throw new Error(`Invalid quarter format: ${q2}. Expected format: YYYY-Qn`);
  }

  // Compare years first
  if (parsed1.year < parsed2.year) return -1;
  if (parsed1.year > parsed2.year) return 1;

  // Years are equal, compare quarters
  if (parsed1.quarter < parsed2.quarter) return -1;
  if (parsed1.quarter > parsed2.quarter) return 1;

  return 0;
}

/**
 * Check if an entity is visible in a given period
 * Visibility rule: (valid_from is null OR valid_from <= V) AND (valid_to is null OR valid_to > V)
 * Null/undefined validity fields mean "timeless" (always visible)
 *
 * @param entity - Entity with optional valid_from and valid_to fields
 * @param viewQuarter - Quarter to check visibility for (e.g., "2026-Q4")
 * @returns True if entity is visible in the given period
 */
export function isEntityVisibleInPeriod(
  entity: AnyEntity,
  viewQuarter: string
): boolean {
  // Cast to access potential valid_from/valid_to fields
  const temporalEntity = entity as { valid_from?: string; valid_to?: string };

  const { valid_from, valid_to } = temporalEntity;

  // Timeless objects (no temporal fields) are always visible
  if (!valid_from && !valid_to) {
    return true;
  }

  // Check valid_from constraint (inclusive start)
  if (valid_from !== undefined && valid_from !== null) {
    try {
      if (compareQuarters(valid_from, viewQuarter) > 0) {
        // Entity starts after viewQuarter - not visible
        return false;
      }
    } catch {
      // Invalid valid_from format - treat as timeless
      console.warn(`Invalid valid_from format: ${valid_from}`);
    }
  }

  // Check valid_to constraint (exclusive end)
  if (valid_to !== undefined && valid_to !== null) {
    try {
      if (compareQuarters(valid_to, viewQuarter) <= 0) {
        // Entity ends at or before viewQuarter - not visible
        return false;
      }
    } catch {
      // Invalid valid_to format - treat as timeless
      console.warn(`Invalid valid_to format: ${valid_to}`);
    }
  }

  // Entity is visible (both constraints passed or are null)
  return true;
}

/**
 * Check if a relationship is visible in a given period
 * Uses the same visibility rule as entities
 *
 * @param relationship - Relationship with optional valid_from and valid_to fields
 * @param viewQuarter - Quarter to check visibility for (e.g., "2026-Q4")
 * @returns True if relationship is visible in the given period
 */
export function isRelationshipVisibleInPeriod(
  relationship: AnyRelationship,
  viewQuarter: string
): boolean {
  // Cast to access potential valid_from/valid_to fields
  const temporalRelationship = relationship as { valid_from?: string; valid_to?: string };

  const { valid_from, valid_to } = temporalRelationship;

  // Timeless objects (no temporal fields) are always visible
  if (!valid_from && !valid_to) {
    return true;
  }

  // Check valid_from constraint (inclusive start)
  if (valid_from !== undefined && valid_from !== null) {
    try {
      if (compareQuarters(valid_from, viewQuarter) > 0) {
        // Relationship starts after viewQuarter - not visible
        return false;
      }
    } catch {
      // Invalid valid_from format - treat as timeless
      console.warn(`Invalid valid_from format: ${valid_from}`);
    }
  }

  // Check valid_to constraint (exclusive end)
  if (valid_to !== undefined && valid_to !== null) {
    try {
      if (compareQuarters(valid_to, viewQuarter) <= 0) {
        // Relationship ends at or before viewQuarter - not visible
        return false;
      }
    } catch {
      // Invalid valid_to format - treat as timeless
      console.warn(`Invalid valid_to format: ${valid_to}`);
    }
  }

  // Relationship is visible (both constraints passed or are null)
  return true;
}

/**
 * Check if a diagram element (node, edge, decoration) is visible in a given period
 * Visibility rule: (valid_from is null OR valid_from <= V) AND (valid_to is null OR valid_to > V)
 * Null/undefined validity fields mean "timeless" (always visible)
 *
 * This function is used for diagram-level temporality, filtering nodes, edges, and
 * decorations based on their own valid_from/valid_to fields (separate from entity validity).
 *
 * @param element - Element with optional valid_from and valid_to fields (DiagramNode, DiagramEdge, Decoration)
 * @param viewQuarter - Quarter to check visibility for (e.g., "2026-Q4")
 * @returns True if the diagram element is visible in the given period
 */
export function isDiagramElementVisibleInPeriod(
  element: TemporalDiagramElement,
  viewQuarter: string
): boolean {
  const { valid_from, valid_to } = element;

  // Timeless elements (no temporal fields) are always visible
  // This ensures backward compatibility - elements without temporal fields are always shown
  if (!valid_from && !valid_to) {
    return true;
  }

  // Check valid_from constraint (inclusive start)
  // Element is visible if valid_from <= viewQuarter
  if (valid_from !== undefined && valid_from !== null) {
    try {
      if (compareQuarters(valid_from, viewQuarter) > 0) {
        // Element starts after viewQuarter - not visible
        return false;
      }
    } catch {
      // Invalid valid_from format - treat as timeless (visible)
      console.warn(`Invalid valid_from format in diagram element: ${valid_from}`);
    }
  }

  // Check valid_to constraint (exclusive end)
  // Element is visible if valid_to > viewQuarter
  if (valid_to !== undefined && valid_to !== null) {
    try {
      if (compareQuarters(valid_to, viewQuarter) <= 0) {
        // Element ends at or before viewQuarter - not visible
        return false;
      }
    } catch {
      // Invalid valid_to format - treat as timeless (visible)
      console.warn(`Invalid valid_to format in diagram element: ${valid_to}`);
    }
  }

  // Element is visible (both constraints passed or are null)
  return true;
}

/**
 * Add or subtract quarters from a given quarter
 * @param quarter - Starting quarter (e.g., "2026-Q1")
 * @param delta - Number of quarters to add (positive) or subtract (negative)
 * @returns New quarter string after adding delta
 */
export function addQuarters(quarter: string, delta: number): string {
  const parsed = parseQuarter(quarter);
  if (!parsed) {
    throw new Error(`Invalid quarter format: ${quarter}. Expected format: YYYY-Qn`);
  }

  let { year, quarter: q } = parsed;

  // Convert to total quarters since year 0
  let totalQuarters = year * 4 + (q - 1);

  // Add delta
  totalQuarters += delta;

  // Convert back to year and quarter
  const newYear = Math.floor(totalQuarters / 4);
  const newQuarter = (totalQuarters % 4) + 1;

  return `${newYear}-Q${newQuarter}`;
}

/**
 * Get the previous quarter (one quarter before)
 * @param quarter - Current quarter (e.g., "2026-Q2")
 * @returns Previous quarter string (e.g., "2026-Q1")
 */
export function getPreviousQuarter(quarter: string): string {
  return addQuarters(quarter, -1);
}

/**
 * Get the next quarter (one quarter after)
 * @param quarter - Current quarter (e.g., "2026-Q2")
 * @returns Next quarter string (e.g., "2026-Q3")
 */
export function getNextQuarter(quarter: string): string {
  return addQuarters(quarter, 1);
}

/**
 * Convert a quarter to the nearest half-year quarter (Q2 for H1, Q4 for H2)
 * @param quarter - Quarter string (e.g., "2026-Q3")
 * @returns Quarter string representing end of half (Q2 or Q4)
 */
export function quarterToHalf(quarter: string): string {
  const parsed = parseQuarter(quarter);
  if (!parsed) {
    throw new Error(`Invalid quarter format: ${quarter}. Expected format: YYYY-Qn`);
  }

  const { year, quarter: q } = parsed;

  // Q1, Q2 -> Q2 (end of H1)
  // Q3, Q4 -> Q4 (end of H2)
  const halfQuarter = q <= 2 ? 2 : 4;

  return `${year}-Q${halfQuarter}`;
}

/**
 * Convert a quarter to year-end quarter (always Q4)
 * @param quarter - Quarter string (e.g., "2026-Q3")
 * @returns Quarter string representing end of year (Q4)
 */
export function quarterToYear(quarter: string): string {
  const parsed = parseQuarter(quarter);
  if (!parsed) {
    throw new Error(`Invalid quarter format: ${quarter}. Expected format: YYYY-Qn`);
  }

  const { year } = parsed;

  return `${year}-Q4`;
}

/**
 * Get the default view quarter for new diagrams
 * Returns "2026-Q4" as a sensible default
 * @returns Default quarter string
 */
export function getDefaultViewQuarter(): string {
  return '2026-Q4';
}

/**
 * Format a quarter string for display based on period type
 * @param quarter - Quarter string (e.g., "2026-Q3")
 * @param periodType - "Quarter", "Half", or "Year"
 * @returns Formatted label (e.g., "End of Q3 2026", "End of H2 2026", "End of 2026")
 */
export function formatPeriodLabel(quarter: string, periodType: string): string {
  const parsed = parseQuarter(quarter);
  if (!parsed) {
    return quarter; // Return as-is if invalid
  }

  const { year, quarter: q } = parsed;

  switch (periodType) {
    case 'Quarter':
      return `End of Q${q} ${year}`;

    case 'Half': {
      // Determine which half based on quarter
      const half = q <= 2 ? 1 : 2;
      return `End of H${half} ${year}`;
    }

    case 'Year':
      return `End of ${year}`;

    default:
      return `End of Q${q} ${year}`;
  }
}
