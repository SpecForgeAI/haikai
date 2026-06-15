/**
 * Part Payload Composition Utility
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Task Group 4: Frontend Part State Machine
 * Task 4.3: Create composePartPayload utility function
 *
 * Composes a structured payload for shape-spec streaming per implementation part.
 * Each part gets an independent session with session_mode="new".
 *
 * Output format with delimiters:
 * ```
 * PART n/X: <title>
 * ---
 * PART_INTENT:
 * <intent text>
 * ---
 * FEATURE_CONTEXT_JSON:
 * ```json
 * <JSON context>
 * ```
 * ```
 */

import type { Part } from '../types/part';

/**
 * Feature context for composing part payloads.
 * Contains the core context needed for the shape-spec service.
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 */
export interface FeatureContext {
  /** Product Owner's understanding of the feature */
  featureUnderstanding: string;
  /** Scope definition */
  scope: {
    /** Items explicitly included in scope */
    in: string[];
    /** Items explicitly excluded from scope */
    out: string[];
  };
  /** Testable success conditions */
  acceptanceCriteria: string[];
  /** Assumptions made by the planner */
  assumptions: string[];
}

/**
 * Compose a shape-spec payload for a single implementation part.
 *
 * Creates a structured message with:
 * - PART n/X header with part title
 * - PART_INTENT section with the part's intent and dependencies
 * - FEATURE_CONTEXT_JSON section with core feature context
 *
 * @param part - The Part to compose payload for
 * @param featureContext - Core feature context (featureUnderstanding, scope, acceptanceCriteria, assumptions)
 * @param totalParts - Total number of parts in the implementation plan
 * @returns Composed payload string for shape-spec streaming
 *
 * @example
 * const payload = composePartPayload(part, context, 3);
 * // Returns:
 * // PART 1/3: Database Schema Setup
 * // ---
 * // PART_INTENT:
 * // Create the database schema for user authentication...
 * //
 * // Dependencies:
 * // - None
 * // ---
 * // FEATURE_CONTEXT_JSON:
 * // ```json
 * // { "featureUnderstanding": "...", ... }
 * // ```
 */
export function composePartPayload(
  part: Part,
  featureContext: FeatureContext,
  totalParts: number
): string {
  // Build the PART header
  const partHeader = `PART ${part.partIndex}/${totalParts}: ${part.title}`;

  // Build the PART_INTENT section
  let partIntentSection = `PART_INTENT:\n${part.intent}`;

  // Add dependencies if present
  if (part.dependencies && part.dependencies.length > 0) {
    const dependencyList = part.dependencies.map((dep) => `- ${dep}`).join('\n');
    partIntentSection += `\n\nDependencies:\n${dependencyList}`;
  } else {
    partIntentSection += `\n\nDependencies:\n- None`;
  }

  // Build the FEATURE_CONTEXT_JSON section
  const contextJson = JSON.stringify(featureContext, null, 2);
  const featureContextSection = `FEATURE_CONTEXT_JSON:\n\`\`\`json\n${contextJson}\n\`\`\``;

  // Compose the full payload with delimiters
  const payload = [
    partHeader,
    '---',
    partIntentSection,
    '---',
    featureContextSection,
  ].join('\n');

  return payload;
}
