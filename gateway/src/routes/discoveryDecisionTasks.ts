/**
 * Discovery DecisionTask Resolution Route
 *
 * Provides the LLM-powered resolution endpoint for discovery DecisionTasks.
 * The discovery-service sends batches of pending DecisionTasks to this endpoint,
 * which resolves each one by constructing a prompt from the task's inputData,
 * calling the LLM, and parsing the structured JSON response.
 *
 * Spec 2026-04-05: Phase 1b Linker and DecisionTask Engine
 * Task Group 8: Gateway Resolution Route and Registration
 *
 * Extended for Phase 1c Clustering and Cluster Adjudication
 * (Spec 2026-04-05, Task Group 9)
 *
 * Extended for Phase 1d Candidate Generation
 * (Spec 2026-04-05, Task Group 9)
 *
 * Endpoint:
 *   POST /resolve-decision-tasks
 *
 * Mounted at /api/v1/discovery in server.ts, serving:
 *   POST /api/v1/discovery/resolve-decision-tasks
 */

import { Router, Request, Response } from 'express';
import { getLlmClient } from '../services/llmClient';
import { logger } from '../services/logger';
import { DecisionTaskTypeString, loadPromptTemplate, interpolateTemplate, buildMessagesForTask } from './discoveryDecisionTaskPrompts';

export const discoveryDecisionTasksRouter = Router();

// ============================================================================
// Types
// ============================================================================

interface DecisionTaskInput {
  id: string;
  runId: string;
  taskType: DecisionTaskTypeString;
  status: string;
  inputData: Record<string, unknown>;
  outputData?: Record<string, unknown> | null;
  createdAt?: string;
  resolvedAt?: string | null;
}

interface ResolveDecisionTasksRequest {
  projectId: string;
  runId: string;
  tasks: DecisionTaskInput[];
}

interface TaskResolutionResult {
  taskId: string;
  status: 'resolved' | 'failed';
  outputData: Record<string, unknown> | null;
  error: string | null;
}

// ============================================================================
// JSON Parsing Utility
// ============================================================================

/**
 * Parse a JSON string from LLM output, handling both raw JSON and
 * markdown-fenced JSON (e.g., ```json ... ```).
 *
 * @param raw - The raw string response from the LLM
 * @returns Parsed JSON object
 * @throws Error if the string is not valid JSON after stripping fences
 */
export function parseLlmJsonResponse(raw: string): Record<string, unknown> {
  let cleaned = raw.trim();

  // Strip markdown JSON fences if present
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  return JSON.parse(cleaned);
}

// ============================================================================
// POST /resolve-decision-tasks
// ============================================================================

/**
 * POST /resolve-decision-tasks
 *
 * Resolves a batch of pending DecisionTasks via LLM.
 * Tasks are processed sequentially -- no parallelism.
 * Individual task failures do not abort processing of remaining tasks.
 *
 * Request body: { projectId: string, runId: string, tasks: DecisionTask[] }
 * Response body: { results: Array<{ taskId, status, outputData, error }> }
 */
discoveryDecisionTasksRouter.post('/resolve-decision-tasks', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';

  try {
    const body = req.body as ResolveDecisionTasksRequest;

    // Validate request body
    if (!body.projectId || typeof body.projectId !== 'string') {
      return res.status(400).json({
        error: { code: 400, message: 'projectId is required and must be a string' },
      });
    }

    if (!body.runId || typeof body.runId !== 'string') {
      return res.status(400).json({
        error: { code: 400, message: 'runId is required and must be a string' },
      });
    }

    if (!body.tasks || !Array.isArray(body.tasks)) {
      return res.status(400).json({
        error: { code: 400, message: 'tasks is required and must be an array' },
      });
    }

    logger.info('Processing DecisionTask resolution request', {
      requestId,
      projectId: body.projectId,
      runId: body.runId,
      taskCount: body.tasks.length,
    });

    const results: TaskResolutionResult[] = [];
    const llmClient = getLlmClient();

    // Process tasks sequentially -- no parallelism
    for (const task of body.tasks) {
      logger.info('Resolving DecisionTask', {
        requestId,
        taskId: task.id,
        taskType: task.taskType,
      });

      try {
        // Load the prompt template for this task type
        const template = await loadPromptTemplate(task.taskType);

        // Interpolate task input data into the template
        const interpolated = interpolateTemplate(template, task.taskType, task.inputData);

        // Build the messages array for the LLM call
        const messages = buildMessagesForTask(interpolated, task.taskType, task.inputData);

        // Call the LLM (no tools — decision tasks only need text/JSON responses)
        const llmResponse = await llmClient.sendChatRequest(
          messages,
          requestId,
          `decision-task-${task.id}`,
          // temperature 0 → deterministic decision output (oracle reproducibility).
          { tools: [], temperature: 0 },
        );

        // Parse the LLM response as JSON
        const outputData = parseLlmJsonResponse(llmResponse.content || '{}');

        results.push({
          taskId: task.id,
          status: 'resolved',
          outputData,
          error: null,
        });

        logger.info('DecisionTask resolved successfully', {
          requestId,
          taskId: task.id,
          taskType: task.taskType,
        });
      } catch (taskError) {
        const errorMessage = taskError instanceof Error ? taskError.message : 'Unknown error';

        logger.error('DecisionTask resolution failed', {
          requestId,
          taskId: task.id,
          taskType: task.taskType,
          error: errorMessage,
        });

        results.push({
          taskId: task.id,
          status: 'failed',
          outputData: null,
          error: errorMessage,
        });
      }
    }

    logger.info('DecisionTask resolution request completed', {
      requestId,
      totalTasks: body.tasks.length,
      resolved: results.filter(r => r.status === 'resolved').length,
      failed: results.filter(r => r.status === 'failed').length,
    });

    return res.json({ results });
  } catch (error) {
    logger.error('DecisionTask resolution endpoint error', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});
