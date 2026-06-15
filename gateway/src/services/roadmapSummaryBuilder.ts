/**
 * Roadmap Summary Builder - Pure functions for roadmap pre-check logic
 *
 * Spec 2026-02-15: RM Increment 2 - Internal Roadmap Pre-check + Branching Logic
 * - buildRoadmapSummary(): Produces a condensed L1/L2-only text summary of Initiatives and Epics
 * - hasExistingRoadmap(): Checks whether a roadmap exists (including orphan EPICs)
 * - isFirstTurnRoadmapPm(): Detects first turn for roadmap_pm mode
 * - countRoadmapItems(): Counts initiatives and epics for summary text
 */

import { ProductSummaryDto, ChatContext } from '../types/chat';
import { GatewaySession } from '../types/session';

/**
 * Build a condensed text summary of Initiatives (L1) and Epics (L2) ONLY.
 * Excludes Features (L3) and Stories (L4).
 *
 * Format:
 * - {initiative title}: {initiative description}
 *   - {epic title}
 *   - {epic title}
 * Orphan Epics:
 *   - {epic title}
 *
 * If the assembled string exceeds maxChars, truncate to maxChars - 12 and append "...truncated".
 * Empty data returns empty string.
 *
 * @param productSummary - The product summary DTO containing initiatives and epics
 * @param maxChars - Maximum character limit for the summary (default: 2000)
 * @returns A condensed text summary string, or empty string if no data
 */
export function buildRoadmapSummary(productSummary: ProductSummaryDto, maxChars: number = 2000): string {
  if (!productSummary || !productSummary.initiatives || productSummary.initiatives.length === 0) {
    return '';
  }

  // Separate "normal" initiatives (non-empty title) from "orphan" (empty/missing title with non-empty epics)
  const normalInitiatives = productSummary.initiatives.filter(
    (init) => init.title && init.title.trim().length > 0
  );
  const orphanInitiatives = productSummary.initiatives.filter(
    (init) => (!init.title || init.title.trim().length === 0) && init.epics && init.epics.length > 0
  );

  // If no normal initiatives and no orphan epics, return empty string
  if (normalInitiatives.length === 0 && orphanInitiatives.length === 0) {
    return '';
  }

  const lines: string[] = [];

  // Normal initiatives: output "- {title}: {description}" then indent each epic as "  - {epicTitle}"
  for (const initiative of normalInitiatives) {
    const description = initiative.description ? `: ${initiative.description}` : '';
    lines.push(`- ${initiative.title}${description}`);

    if (initiative.epics && initiative.epics.length > 0) {
      for (const epic of initiative.epics) {
        lines.push(`  - ${epic.title}`);
      }
    }
  }

  // Orphan epics: output "Orphan Epics:" heading then list each epic title
  if (orphanInitiatives.length > 0) {
    lines.push('Orphan Epics:');
    for (const orphanInit of orphanInitiatives) {
      for (const epic of orphanInit.epics) {
        lines.push(`  - ${epic.title}`);
      }
    }
  }

  let result = lines.join('\n');

  // Truncation: if exceeds maxChars, truncate to maxChars - 12 and append "...truncated"
  if (result.length > maxChars) {
    result = result.substring(0, maxChars - 12) + '...truncated';
  }

  return result;
}

/**
 * Check whether a roadmap exists in the product summary.
 * Returns true when initiatives.length > 0 OR when orphan epics exist
 * (initiative with empty/missing title but non-empty epics array).
 *
 * @param productSummary - The product summary DTO to check
 * @returns true if a roadmap exists, false otherwise
 */
export function hasExistingRoadmap(productSummary: ProductSummaryDto): boolean {
  if (!productSummary || !productSummary.initiatives || productSummary.initiatives.length === 0) {
    return false;
  }

  // Check for normal initiatives (non-empty title)
  const hasNormalInitiatives = productSummary.initiatives.some(
    (init) => init.title && init.title.trim().length > 0
  );

  // Check for orphan epics (empty/missing title with non-empty epics)
  const hasOrphanEpics = productSummary.initiatives.some(
    (init) => (!init.title || init.title.trim().length === 0) && init.epics && init.epics.length > 0
  );

  return hasNormalInitiatives || hasOrphanEpics;
}

/**
 * Detect whether this is the first turn of a roadmap_pm conversation.
 * Returns true when context.mode is 'roadmap_pm' AND session has no prior conversation.
 *
 * @param session - The gateway session
 * @param context - Optional chat context containing the mode
 * @returns true if this is the first turn of a roadmap_pm session
 */
export function isFirstTurnRoadmapPm(session: GatewaySession, context?: ChatContext): boolean {
  if ((context?.mode as string) !== 'roadmap_pm') {
    return false;
  }

  return session.conversation === undefined || session.conversation.length === 0;
}

/**
 * Count roadmap items in the product summary.
 * Only "normal" initiatives (non-empty title) count for initiativeCount.
 * All epics across all initiatives (including orphan) count for epicCount.
 *
 * @param productSummary - The product summary DTO to count
 * @returns Object with initiativeCount and epicCount
 */
export function countRoadmapItems(productSummary: ProductSummaryDto): { initiativeCount: number; epicCount: number } {
  if (!productSummary || !productSummary.initiatives) {
    return { initiativeCount: 0, epicCount: 0 };
  }

  const initiativeCount = productSummary.initiatives.filter(
    (init) => init.title && init.title.trim().length > 0
  ).length;

  const epicCount = productSummary.initiatives.reduce(
    (total, init) => total + (init.epics ? init.epics.length : 0),
    0
  );

  return { initiativeCount, epicCount };
}
