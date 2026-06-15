/**
 * Planner Message Sanitizer
 *
 * Sanitizes the Planner LLM's `message` field to ensure it is a short,
 * high-level progress update that does not duplicate structured content
 * from openQuestions, scope, acceptanceCriteria, or other JSON fields.
 *
 * Spec 2026-01-24: Planner Message Hygiene
 * Task Group 2: Message Sanitizer Service Implementation
 */

import type { OpenQuestion } from '../types/chat';

/**
 * Result of sanitizing a planner message.
 *
 * @property sanitized - Whether the message was modified
 * @property message - The sanitized (or original) message
 * @property reasons - List of violation reasons detected
 */
export interface SanitizationResult {
  sanitized: boolean;
  message: string;
  reasons: string[];
}

/**
 * Default character limit for planner messages.
 * Messages exceeding this limit will trigger sanitization.
 */
export const MESSAGE_LENGTH_LIMIT = 300;

/**
 * Replacement template when openQuestions exist.
 * {N} is replaced with the question count.
 */
export const TEMPLATE_WITH_QUESTIONS =
  "I've updated my understanding, scope, and acceptance criteria. I have {N} questions for you to answer.";

/**
 * Replacement template when no openQuestions exist.
 */
export const TEMPLATE_WITHOUT_QUESTIONS =
  "I've updated my understanding, scope, and acceptance criteria based on our discussion.";

// ============================================================================
// Pattern Detection Functions
// ============================================================================

/**
 * Detects bullet point lists in the message.
 * Matches lines starting with `-` or `*` followed by whitespace.
 *
 * @param message - The message to check
 * @returns True if bullet points are detected
 */
export function hasBulletPoints(message: string): boolean {
  // Regex: line starts with optional whitespace, then - or *, then whitespace
  const pattern = /^\s*[-*]\s/m;
  return pattern.test(message);
}

/**
 * Detects numbered lists in the message.
 * Matches lines starting with digits followed by `.` or `)` and whitespace.
 *
 * @param message - The message to check
 * @returns True if numbered lists are detected
 */
export function hasNumberedList(message: string): boolean {
  // Regex: line starts with optional whitespace, then digits, then . or ), then whitespace
  const pattern = /^\s*\d+[.)]\s/m;
  return pattern.test(message);
}

/**
 * Detects field labels with colons in the message.
 * Matches patterns like "Questions:", "Scope:", "Acceptance Criteria:", "Assumptions:".
 *
 * @param message - The message to check
 * @returns True if field labels are detected
 */
export function hasFieldLabels(message: string): boolean {
  // Case-insensitive match for common field labels followed by colon
  const labels = [
    'questions:',
    'scope:',
    'acceptance criteria:',
    'assumptions:',
    'open questions:',
    'in scope:',
    'out of scope:',
  ];
  const lowerMessage = message.toLowerCase();
  return labels.some(label => lowerMessage.includes(label));
}

/**
 * Detects section headers (without colons) in the message.
 * Matches standalone phrases like "Open Questions", "Assumptions", "Scope".
 *
 * @param message - The message to check
 * @returns True if section headers are detected
 */
export function hasSectionHeaders(message: string): boolean {
  // Case-insensitive match for section headers
  // Match as standalone words (not part of larger words)
  const headers = [
    /\bopen questions\b/i,
    /\bassumptions\b/i,
    /\bacceptance criteria\b/i,
    /\bin scope\b/i,
    /\bout of scope\b/i,
  ];
  return headers.some(pattern => pattern.test(message));
}

/**
 * Detects multiple newlines in the message (indicating multi-paragraph text).
 * Matches 2 or more newlines (possibly with whitespace between).
 *
 * @param message - The message to check
 * @returns True if multiple newlines are detected
 */
export function hasMultipleNewlines(message: string): boolean {
  // Detect two or more newline characters
  // This matches \n followed by anything then another \n
  const pattern = /\n.*\n/;
  return pattern.test(message);
}

/**
 * Checks if the message exceeds the character limit.
 *
 * @param message - The message to check
 * @param limit - Character limit (default: MESSAGE_LENGTH_LIMIT)
 * @returns True if message exceeds the limit
 */
export function exceedsLengthLimit(message: string, limit: number = MESSAGE_LENGTH_LIMIT): boolean {
  return message.length > limit;
}

/**
 * Checks if any openQuestions content appears as a substring in the message.
 * Uses case-insensitive matching.
 *
 * @param message - The message to check
 * @param openQuestions - Array of open questions
 * @returns Object with matched flag and list of matched question texts
 */
export function hasQuestionSubstring(
  message: string,
  openQuestions: OpenQuestion[]
): { matched: boolean; matchedQuestions: string[] } {
  if (!openQuestions || openQuestions.length === 0) {
    return { matched: false, matchedQuestions: [] };
  }

  const matchedQuestions: string[] = [];
  const lowerMessage = message.toLowerCase();

  for (const q of openQuestions) {
    // Skip very short questions (< 10 chars) to avoid false positives
    if (q.question.length < 10) {
      continue;
    }

    const lowerQuestion = q.question.toLowerCase();
    if (lowerMessage.includes(lowerQuestion)) {
      matchedQuestions.push(q.question);
    }
  }

  return {
    matched: matchedQuestions.length > 0,
    matchedQuestions,
  };
}

// ============================================================================
// Replacement Template Generation
// ============================================================================

/**
 * Generates the replacement message based on question count.
 *
 * @param questionCount - Number of open questions
 * @returns Replacement message string
 */
export function generateReplacementMessage(questionCount: number): string {
  if (questionCount > 0) {
    return TEMPLATE_WITH_QUESTIONS.replace('{N}', String(questionCount));
  }
  return TEMPLATE_WITHOUT_QUESTIONS;
}

// ============================================================================
// Main Sanitization Function
// ============================================================================

/**
 * Sanitizes a planner message by detecting violations and applying replacement.
 *
 * Detection patterns checked in order:
 * 1. Bullet point lists
 * 2. Numbered lists
 * 3. Field labels (with colons)
 * 4. Section headers (without colons)
 * 5. Multiple newlines
 * 6. Length exceeds 300 characters
 * 7. OpenQuestions content duplicated in message
 *
 * If any violation is detected, the message is replaced with a deterministic
 * template based on the question count.
 *
 * @param message - The original message from the LLM
 * @param openQuestions - Array of open questions from the response
 * @returns SanitizationResult with sanitized flag, message, and reasons
 */
export function sanitizePlannerMessage(
  message: string,
  openQuestions: OpenQuestion[]
): SanitizationResult {
  const reasons: string[] = [];

  // Check all detection patterns
  if (hasBulletPoints(message)) {
    reasons.push('bullet_points');
  }

  if (hasNumberedList(message)) {
    reasons.push('numbered_list');
  }

  if (hasFieldLabels(message)) {
    reasons.push('field_labels');
  }

  if (hasSectionHeaders(message)) {
    reasons.push('section_headers');
  }

  if (hasMultipleNewlines(message)) {
    reasons.push('multiple_newlines');
  }

  if (exceedsLengthLimit(message)) {
    reasons.push('exceeds_length_limit');
  }

  const questionMatch = hasQuestionSubstring(message, openQuestions);
  if (questionMatch.matched) {
    reasons.push('question_content_duplicated');
  }

  // If any violation detected, replace with template
  if (reasons.length > 0) {
    const replacementMessage = generateReplacementMessage(openQuestions.length);
    return {
      sanitized: true,
      message: replacementMessage,
      reasons,
    };
  }

  // No violations - return original message unchanged
  return {
    sanitized: false,
    message,
    reasons: [],
  };
}
