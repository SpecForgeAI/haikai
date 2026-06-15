/**
 * Discovery Insights Service
 *
 * Extracts Q&A pairs from structured discovery conversations and persists them
 * so they can be injected as context into subsequent task conversations.
 *
 * File location: {projectFolder}/insights/discovery-insights.json
 * Keyed by taskId, each entry contains the task label, persona, timestamp,
 * and an array of { questions, answer } insight pairs.
 *
 * Extraction happens at save-artifact time for discovery tasks that use
 * structured questions. Injection happens at conversation start for all tasks.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Thread, ThreadMessage } from '../types/chatV2';
import { fetchProjectFolder } from './architectureModelClient';
import { getTaskRegistry } from './registryLoader';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InsightPair {
  questions: string[];
  answer: string;
}

export interface TaskInsights {
  taskLabel: string;
  persona: string;
  savedAt: string;
  insights: InsightPair[];
}

export interface DiscoveryInsightsFile {
  [taskId: string]: TaskInsights;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INSIGHTS_DIR = 'insights';
const INSIGHTS_FILENAME = 'discovery-insights.json';

// ---------------------------------------------------------------------------
// Extract Q&A pairs from thread messages
// ---------------------------------------------------------------------------

/**
 * Scans a thread's messages for structured Q&A pairs belonging to a given taskId.
 *
 * Pattern:
 *   assistant message with structuredResponse.questions (string[]) and matching taskId
 *   followed by the next user message (which is the answer)
 *
 * Only extracts pairs where the assistant message has a non-empty questions array
 * and is followed by a user message with non-empty content.
 */
export function extractInsightsFromThread(
  thread: Thread,
  taskId: string
): InsightPair[] {
  const insights: InsightPair[] = [];
  const messages = thread.messages;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Must be an assistant message for the target task
    if (msg.role !== 'assistant' || msg.taskId !== taskId) continue;

    // Must have structuredResponse with a questions array
    const sr = msg.structuredResponse as Record<string, unknown> | null;
    if (!sr || !Array.isArray(sr.questions) || sr.questions.length === 0) continue;

    // Find the next user message (skip system messages, completion chips, etc.)
    let answerMsg: ThreadMessage | null = null;
    for (let j = i + 1; j < messages.length; j++) {
      if (messages[j].role === 'user') {
        answerMsg = messages[j];
        break;
      }
      // If we hit another assistant message before a user message, stop looking
      if (messages[j].role === 'assistant') break;
    }

    if (!answerMsg || !answerMsg.content || answerMsg.content.trim() === '') continue;

    insights.push({
      questions: sr.questions.filter((q: unknown) => typeof q === 'string' && q.trim() !== ''),
      answer: answerMsg.content.trim(),
    });
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Resolve insights file path
// ---------------------------------------------------------------------------

async function resolveInsightsPath(projectId: string): Promise<string | null> {
  const projectFolder = await fetchProjectFolder(projectId);
  if (!projectFolder) {
    logger.warn('Cannot resolve insights path: fetchProjectFolder returned null', { projectId });
    return null;
  }
  return path.join(projectFolder, 'agent-os', INSIGHTS_DIR, INSIGHTS_FILENAME);
}

// ---------------------------------------------------------------------------
// Save insights for a task
// ---------------------------------------------------------------------------

/**
 * Saves extracted insights for a specific task into the discovery insights file.
 * Merges with any existing insights from other tasks (upsert by taskId).
 */
export async function saveDiscoveryInsights(
  projectId: string,
  taskId: string,
  taskLabel: string,
  persona: string,
  insights: InsightPair[]
): Promise<void> {
  if (insights.length === 0) {
    logger.debug('No insights to save, skipping', { projectId, taskId });
    return;
  }

  const filePath = await resolveInsightsPath(projectId);
  if (!filePath) return;

  // Load existing file (or start fresh)
  let existing: DiscoveryInsightsFile = {};
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    existing = JSON.parse(raw);
  } catch {
    // File doesn't exist yet or is invalid -- start fresh
  }

  // Upsert this task's insights
  existing[taskId] = {
    taskLabel,
    persona,
    savedAt: new Date().toISOString(),
    insights,
  };

  // Ensure directory exists
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Write atomically
  await fs.writeFile(filePath, JSON.stringify(existing, null, 2), 'utf-8');

  logger.info('Discovery insights saved', {
    projectId,
    taskId,
    insightCount: insights.length,
    filePath,
  });
}

// ---------------------------------------------------------------------------
// Load and format insights for context injection
// ---------------------------------------------------------------------------

/**
 * Loads all saved discovery insights for a project and formats them as a
 * markdown string suitable for injection into a system prompt.
 *
 * Returns null if no insights file exists or if it's empty.
 */
export async function loadFormattedInsights(
  projectId: string,
  excludeTaskId?: string
): Promise<string | null> {
  const filePath = await resolveInsightsPath(projectId);
  if (!filePath) return null;

  let data: DiscoveryInsightsFile;
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  const taskIds = Object.keys(data).filter(id => id !== excludeTaskId);
  if (taskIds.length === 0) return null;

  const sections: string[] = [];

  for (const taskId of taskIds) {
    const entry = data[taskId];
    if (!entry.insights || entry.insights.length === 0) continue;

    sections.push(`### ${entry.persona}: ${entry.taskLabel}`);

    for (const pair of entry.insights) {
      if (pair.questions.length > 0) {
        sections.push(`**Questions asked:**`);
        for (const q of pair.questions) {
          sections.push(`- ${q}`);
        }
      }
      sections.push(`**User's answer:** ${pair.answer}`);
      sections.push('');
    }
  }

  if (sections.length === 0) return null;

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// High-level: extract and save insights after artifact save
// ---------------------------------------------------------------------------

/**
 * Called after a successful save-artifact to extract and persist insights
 * from the conversation thread. Only processes discovery tasks that have
 * structured questions in their responseFormat.
 */
export async function extractAndSaveInsights(
  projectId: string,
  taskId: string,
  thread: Thread
): Promise<void> {
  // Look up the task definition to get label and persona
  const taskRegistry = getTaskRegistry();
  const taskDef = taskRegistry.get(taskId);
  if (!taskDef) {
    logger.debug('Task not found in registry, skipping insight extraction', { taskId });
    return;
  }

  // Only process discovery tasks with structured questions
  const rf = taskDef.responseFormat as Record<string, unknown> | null;
  if (!rf) {
    logger.debug('Task has no responseFormat, skipping insight extraction', { taskId });
    return;
  }

  const props = rf.properties as Record<string, unknown> | undefined;
  if (!props || !props.questions) {
    logger.debug('Task responseFormat has no questions property, skipping insight extraction', { taskId });
    return;
  }

  // Extract Q&A pairs
  const insights = extractInsightsFromThread(thread, taskId);

  if (insights.length === 0) {
    logger.debug('No Q&A pairs found in thread for insight extraction', { taskId });
    return;
  }

  // Save
  await saveDiscoveryInsights(
    projectId,
    taskId,
    taskDef.menuLabel || taskId,
    taskDef.personaId || 'unknown',
    insights
  );
}
