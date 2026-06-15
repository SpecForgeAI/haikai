/**
 * Shared Diagram Extraction Utilities
 *
 * Extracted from Canvas.tsx to allow reuse by both Canvas.tsx and the PDF export module.
 * These functions extract typed DTOs from native Diagram objects and provide type guards
 * for shape validation.
 *
 * Spec 2026-04-13: Save All Diagrams as PDF
 * Task Group 1, Task 1.3: Extract shared utility from Canvas.tsx
 */

import type { Diagram } from '../../types/model';
import type { UserJourneyDiagramDto } from '../../types/userJourneyDiagram';
import type { UserJourneyOverviewDiagramDto } from '../../types/userJourneyOverviewDiagram';

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for UserJourneyDiagramDto shape validation.
 * Checks that the value is a non-null object with lanes, steps, edges arrays
 * and a journey object.
 */
export function isUserJourneyDiagramDto(value: unknown): value is UserJourneyDiagramDto {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    Array.isArray(obj.lanes) &&
    Array.isArray(obj.steps) &&
    Array.isArray(obj.edges) &&
    obj.journey != null &&
    typeof obj.journey === 'object'
  );
}

/**
 * Type guard for UserJourneyOverviewDiagramDto shape validation.
 * Checks that the value is a non-null object with lanes, nodes, edges arrays
 * and an overview object.
 *
 * Spec 2026-04-07
 */
export function isUserJourneyOverviewDiagramDto(value: unknown): value is UserJourneyOverviewDiagramDto {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    Array.isArray(obj.lanes) &&
    Array.isArray(obj.nodes) &&
    Array.isArray(obj.edges) &&
    obj.overview != null &&
    typeof obj.overview === 'object'
  );
}

// ============================================================================
// Extraction Functions
// ============================================================================

/**
 * Extract UserJourneyDiagramDto from a native Diagram object.
 * The journey data may be stored in typedContent.content or settings.journeyDiagram.
 * Returns null if journey data is missing or malformed.
 *
 * Spec 2026-04-03
 */
export function extractUserJourneyDiagram(diagram: Diagram | null | undefined): UserJourneyDiagramDto | null {
  if (!diagram) return null;

  // Try typedContent first (primary storage for typed diagrams)
  if (diagram.typedContent?.content) {
    const content = diagram.typedContent.content as unknown;
    if (isUserJourneyDiagramDto(content)) {
      return content;
    }
  }

  // Try settings.journeyDiagram (alternative storage)
  if (diagram.settings?.journeyDiagram) {
    const content = diagram.settings.journeyDiagram as unknown;
    if (isUserJourneyDiagramDto(content)) {
      return content;
    }
  }

  return null;
}

/**
 * Extract UserJourneyOverviewDiagramDto from a native Diagram object.
 * The overview data may be stored in typedContent.content or settings.overviewDiagram.
 * Returns null if overview data is missing or malformed.
 *
 * Spec 2026-04-07
 */
export function extractUserJourneyOverviewDiagram(diagram: Diagram | null | undefined): UserJourneyOverviewDiagramDto | null {
  if (!diagram) return null;

  // Try typedContent first (primary storage for typed diagrams)
  if (diagram.typedContent?.content) {
    const content = diagram.typedContent.content as unknown;
    if (isUserJourneyOverviewDiagramDto(content)) {
      return content;
    }
  }

  // Try settings.overviewDiagram (alternative storage)
  if (diagram.settings?.overviewDiagram) {
    const content = diagram.settings.overviewDiagram as unknown;
    if (isUserJourneyOverviewDiagramDto(content)) {
      return content;
    }
  }

  return null;
}
