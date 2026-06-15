/**
 * Proposed Definition Extractor
 *
 * Spec 2026-01-18: Planner to Implementor Handoff via Orchestrations API
 * Task Group 3: Proposed Definition Extraction and Transformation
 *
 * Provides deterministic extraction and transformation of the final proposed
 * feature definition from Planner chat messages into shape-spec format.
 *
 * Marker Formats:
 * - Part 4 Marker: "--- Part 4: Proposed Final Feature Definition ---"
 * - PROPOSED Marker: "PROPOSED -" (with em-dash character U+2014)
 *
 * Note: The PROPOSED marker uses an em-dash character, which may appear
 * as a regular hyphen in some editors. Both formats are supported.
 */

import { ChatMessage } from '../api/chatApi';

// ============================================================================
// Constants
// ============================================================================

/**
 * Marker indicating the start of Part 4 in the Planner output.
 */
const PART_4_MARKER = '--- Part 4: Proposed Final Feature Definition ---';

/**
 * Marker indicating the start of the PROPOSED block.
 * Supports both em-dash (U+2014) and regular hyphen.
 */
const PROPOSED_MARKER_EM_DASH = 'PROPOSED \u2014';
const PROPOSED_MARKER_HYPHEN = 'PROPOSED -';

// ============================================================================
// Types
// ============================================================================

/**
 * Extracted proposed definition with metadata.
 */
export interface ExtractedProposedDefinition {
  /** The raw proposed content after the PROPOSED marker */
  rawContent: string;
  /** The message ID from which it was extracted */
  sourceMessageId: string;
}

/**
 * Shape-spec payload structure.
 * All fields are optional as the input may not contain all sections.
 */
export interface ShapeSpecPayload {
  title: string;
  context?: string;
  goal?: string;
  scope?: string;
  requirements?: string[];
  acceptance_criteria?: string[];
  non_goals?: string[];
}

// ============================================================================
// Extraction Functions
// ============================================================================

/**
 * Extracts the proposed definition from the most recent assistant message
 * containing the Part 4 marker.
 *
 * Spec 2026-01-18: Task 3.2 - Create extraction utility module
 *
 * Search logic:
 * 1. Find the most recent assistant message containing Part 4 marker
 * 2. Within that message, extract text after "PROPOSED -" marker
 * 3. Return null if markers not found
 *
 * This is deterministic logic with no LLM inference.
 *
 * @param messages - Array of chat messages from the conversation
 * @returns The extracted proposed content, or null if not found
 */
export function extractProposedDefinition(messages: ChatMessage[]): string | null {
  if (!messages || messages.length === 0) {
    return null;
  }

  // Search from most recent to oldest for assistant messages containing Part 4 marker
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    // Only search assistant messages
    if (message.role !== 'assistant') {
      continue;
    }

    // Check if this message contains the Part 4 marker
    if (!message.content.includes(PART_4_MARKER)) {
      continue;
    }

    // Found a message with Part 4 marker, now extract the PROPOSED content
    const proposedContent = extractProposedContent(message.content);
    if (proposedContent) {
      return proposedContent;
    }
  }

  // No message found with both Part 4 and PROPOSED markers
  return null;
}

/**
 * Extracts the proposed definition with metadata about its source.
 *
 * @param messages - Array of chat messages from the conversation
 * @returns Object with extracted content and source message ID, or null if not found
 */
export function extractProposedDefinitionWithMetadata(
  messages: ChatMessage[]
): ExtractedProposedDefinition | null {
  if (!messages || messages.length === 0) {
    return null;
  }

  // Search from most recent to oldest for assistant messages containing Part 4 marker
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    // Only search assistant messages
    if (message.role !== 'assistant') {
      continue;
    }

    // Check if this message contains the Part 4 marker
    if (!message.content.includes(PART_4_MARKER)) {
      continue;
    }

    // Found a message with Part 4 marker, now extract the PROPOSED content
    const proposedContent = extractProposedContent(message.content);
    if (proposedContent) {
      return {
        rawContent: proposedContent,
        sourceMessageId: message.id,
      };
    }
  }

  return null;
}

/**
 * Extracts the content after the PROPOSED marker from a message.
 *
 * @param content - The message content to search
 * @returns The extracted content after the PROPOSED marker, or null if not found
 */
function extractProposedContent(content: string): string | null {
  // Try em-dash first, then regular hyphen
  let proposedIndex = content.indexOf(PROPOSED_MARKER_EM_DASH);
  let markerLength = PROPOSED_MARKER_EM_DASH.length;

  if (proposedIndex === -1) {
    proposedIndex = content.indexOf(PROPOSED_MARKER_HYPHEN);
    markerLength = PROPOSED_MARKER_HYPHEN.length;
  }

  if (proposedIndex === -1) {
    return null;
  }

  // Extract everything after the PROPOSED marker
  const afterMarker = content.substring(proposedIndex + markerLength).trim();

  if (!afterMarker) {
    return null;
  }

  return afterMarker;
}

// ============================================================================
// Transformation Functions
// ============================================================================

/**
 * Transforms the extracted PROPOSED content into a shape-spec format string.
 *
 * Spec 2026-01-18: Task 3.3 - Implement shape-spec transformation
 *
 * Output format:
 * - Starts with "title: ..."
 * - Includes sections: context, goal, scope, requirements, acceptance_criteria, non_goals
 * - Output is declarative and execution-ready
 * - No conversational framing or planner commentary
 * - Does NOT include "/agent-os:shape-spec" prefix
 *
 * @param proposed - The raw proposed content from extraction
 * @returns A shape-spec formatted string suitable for spec_intents array
 */
export function transformToShapeSpec(proposed: string): string {
  if (!proposed || proposed.trim() === '') {
    return '';
  }

  // Parse the proposed content to extract structured fields
  const parsed = parseProposedContent(proposed);

  // Build the shape-spec YAML-like format
  const lines: string[] = [];

  // Title is required and must come first
  lines.push(`title: ${parsed.title}`);

  // Add optional sections if they have content
  if (parsed.context) {
    lines.push(`context: ${parsed.context}`);
  }

  if (parsed.goal) {
    lines.push(`goal: ${parsed.goal}`);
  }

  if (parsed.scope) {
    lines.push(`scope: ${parsed.scope}`);
  }

  if (parsed.requirements && parsed.requirements.length > 0) {
    lines.push('requirements:');
    for (const req of parsed.requirements) {
      lines.push(`  - ${req}`);
    }
  }

  if (parsed.acceptance_criteria && parsed.acceptance_criteria.length > 0) {
    lines.push('acceptance_criteria:');
    for (const criterion of parsed.acceptance_criteria) {
      lines.push(`  - ${criterion}`);
    }
  }

  if (parsed.non_goals && parsed.non_goals.length > 0) {
    lines.push('non_goals:');
    for (const nonGoal of parsed.non_goals) {
      lines.push(`  - ${nonGoal}`);
    }
  }

  return lines.join('\n');
}

/**
 * Parses the proposed content to extract structured fields.
 *
 * This function attempts to intelligently parse the free-form PROPOSED content
 * into structured fields. It handles various formats that the Planner may use.
 *
 * @param proposed - The raw proposed content
 * @returns Structured ShapeSpecPayload object
 */
function parseProposedContent(proposed: string): ShapeSpecPayload {
  const lines = proposed.split('\n').map((line) => line.trim());

  // Initialize with defaults
  const result: ShapeSpecPayload = {
    title: '',
    context: undefined,
    goal: undefined,
    scope: undefined,
    requirements: [],
    acceptance_criteria: [],
    non_goals: [],
  };

  // Try to extract title from first non-empty line or "Title:" field
  let currentSection: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line) {
      continue;
    }

    // Check for section headers
    const sectionMatch = detectSectionHeader(line);
    if (sectionMatch) {
      currentSection = sectionMatch.section;
      // If the header line also contains content, process it
      if (sectionMatch.content) {
        addContentToSection(result, currentSection, sectionMatch.content);
      }
      continue;
    }

    // Handle list items (lines starting with - or *)
    const listItemMatch = line.match(/^[-*]\s*(.+)$/);
    if (listItemMatch && currentSection) {
      addContentToSection(result, currentSection, listItemMatch[1]);
      continue;
    }

    // Handle numbered list items
    const numberedItemMatch = line.match(/^\d+[.)]\s*(.+)$/);
    if (numberedItemMatch && currentSection) {
      addContentToSection(result, currentSection, numberedItemMatch[1]);
      continue;
    }

    // If no title yet, use the first meaningful line as title
    if (!result.title && !currentSection) {
      // Clean up the line - remove common prefixes like "Feature:" or "Title:"
      let cleanedTitle = line.replace(/^(Feature|Title)[:\s]+/i, '').trim();
      // Remove markdown bold markers
      cleanedTitle = cleanedTitle.replace(/\*\*/g, '');
      result.title = cleanedTitle;
      continue;
    }

    // If we have a current section, add content to it
    if (currentSection) {
      addContentToSection(result, currentSection, line);
    }
  }

  // If still no title, use a default based on the first line
  if (!result.title && lines.length > 0) {
    result.title = lines.find((l) => l.length > 0) || 'Untitled Feature';
  }

  return result;
}

/**
 * Detects if a line is a section header and returns the section name.
 */
function detectSectionHeader(line: string): { section: string; content?: string } | null {
  const lowerLine = line.toLowerCase();

  // Common section patterns
  const patterns: { pattern: RegExp; section: string }[] = [
    { pattern: /^#+\s*title[:\s]*(.*)$/i, section: 'title' },
    { pattern: /^title[:\s]+(.*)$/i, section: 'title' },
    { pattern: /^#+\s*context[:\s]*(.*)$/i, section: 'context' },
    { pattern: /^context[:\s]+(.*)$/i, section: 'context' },
    { pattern: /^#+\s*goal[:\s]*(.*)$/i, section: 'goal' },
    { pattern: /^goal[:\s]+(.*)$/i, section: 'goal' },
    { pattern: /^#+\s*scope[:\s]*(.*)$/i, section: 'scope' },
    { pattern: /^scope[:\s]+(.*)$/i, section: 'scope' },
    { pattern: /^#+\s*requirements?[:\s]*(.*)$/i, section: 'requirements' },
    { pattern: /^requirements?[:\s]*$/i, section: 'requirements' },
    { pattern: /^#+\s*acceptance[_\s]?criteria[:\s]*(.*)$/i, section: 'acceptance_criteria' },
    { pattern: /^acceptance[_\s]?criteria[:\s]*$/i, section: 'acceptance_criteria' },
    { pattern: /^#+\s*non[_\s-]?goals?[:\s]*(.*)$/i, section: 'non_goals' },
    { pattern: /^non[_\s-]?goals?[:\s]*$/i, section: 'non_goals' },
    { pattern: /^#+\s*out[_\s]?of[_\s]?scope[:\s]*(.*)$/i, section: 'non_goals' },
    { pattern: /^out[_\s]?of[_\s]?scope[:\s]*$/i, section: 'non_goals' },
  ];

  for (const { pattern, section } of patterns) {
    const match = line.match(pattern);
    if (match) {
      const content = match[1]?.trim();
      return { section, content: content || undefined };
    }
  }

  // Check for markdown headers that might indicate sections
  if (lowerLine.startsWith('##') || lowerLine.startsWith('**')) {
    const cleaned = line.replace(/^[#*]+\s*/, '').replace(/\*+$/, '').trim();
    if (cleaned.toLowerCase().includes('context')) return { section: 'context' };
    if (cleaned.toLowerCase().includes('goal')) return { section: 'goal' };
    if (cleaned.toLowerCase().includes('scope') && !cleaned.toLowerCase().includes('out of')) return { section: 'scope' };
    if (cleaned.toLowerCase().includes('requirement')) return { section: 'requirements' };
    if (cleaned.toLowerCase().includes('acceptance') || cleaned.toLowerCase().includes('criteria')) return { section: 'acceptance_criteria' };
    if (cleaned.toLowerCase().includes('non-goal') || cleaned.toLowerCase().includes('out of scope')) return { section: 'non_goals' };
  }

  return null;
}

/**
 * Adds content to the appropriate section of the result.
 */
function addContentToSection(result: ShapeSpecPayload, section: string, content: string): void {
  const trimmed = content.trim();
  if (!trimmed) return;

  switch (section) {
    case 'title':
      result.title = trimmed;
      break;
    case 'context':
      result.context = result.context ? `${result.context} ${trimmed}` : trimmed;
      break;
    case 'goal':
      result.goal = result.goal ? `${result.goal} ${trimmed}` : trimmed;
      break;
    case 'scope':
      result.scope = result.scope ? `${result.scope} ${trimmed}` : trimmed;
      break;
    case 'requirements':
      result.requirements = result.requirements || [];
      result.requirements.push(trimmed);
      break;
    case 'acceptance_criteria':
      result.acceptance_criteria = result.acceptance_criteria || [];
      result.acceptance_criteria.push(trimmed);
      break;
    case 'non_goals':
      result.non_goals = result.non_goals || [];
      result.non_goals.push(trimmed);
      break;
  }
}

// ============================================================================
// Combined Functions
// ============================================================================

/**
 * Extracts the proposed definition from messages and transforms it to shape-spec format.
 *
 * This is a convenience function that combines extraction and transformation.
 *
 * @param messages - Array of chat messages from the conversation
 * @returns The shape-spec formatted string, or null if extraction failed
 */
export function extractAndTransformToShapeSpec(messages: ChatMessage[]): string | null {
  const proposed = extractProposedDefinition(messages);
  if (!proposed) {
    return null;
  }

  const shapeSpec = transformToShapeSpec(proposed);
  return shapeSpec || null;
}
