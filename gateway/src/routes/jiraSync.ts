/**
 * Jira Sync Routes
 *
 * Phase B endpoint: POST /api/jira/sync/analyze — given a tool work item root
 * and a golden-source choice, returns a list of proposed sync actions for the
 * caller (UI) to display in a confirmation modal before any writes happen.
 *
 * Phase C (sync execute) will arrive on /api/jira/sync/execute.
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import {
  analyzeSyncScope,
  executeSyncActions,
  fetchProjectIssueTypes,
  type SyncAnalysisRequest,
  type SyncExecuteRequest,
} from '../services/jiraSyncService';
import { logger } from '../services/logger';

export const jiraSyncRouter = Router();

/**
 * POST /analyze
 *
 * Request body:
 *   - projectId: string (tool project UUID)
 *   - rootWorkItemId: string (tool work item UUID at the top of the sync subtree)
 *   - goldenSource: 'TOOL' | 'JIRA'
 *   - jiraProjectKey: string (e.g. "KAN")
 *
 * Response:
 *   200: SyncAnalysisResult { goldenSource, jiraProjectKey, rootWorkItemId, actions, warnings }
 *   400: Validation error
 *   502: Upstream jira-service error
 *   503: Jira service unavailable
 *   500: Internal error
 */
jiraSyncRouter.post('/analyze', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || uuidv4();

  const body = req.body ?? {};
  const { projectId, rootWorkItemId, goldenSource, jiraProjectKey, typeMapping } = body as Partial<SyncAnalysisRequest>;

  // ------------------------------------------------------------------
  // Validate
  // ------------------------------------------------------------------
  if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
    res.status(400).json({ message: 'projectId is required and must be a non-empty string', field: 'projectId' });
    return;
  }
  if (!rootWorkItemId || typeof rootWorkItemId !== 'string' || rootWorkItemId.trim() === '') {
    res.status(400).json({ message: 'rootWorkItemId is required and must be a non-empty string', field: 'rootWorkItemId' });
    return;
  }
  if (goldenSource !== 'TOOL' && goldenSource !== 'JIRA') {
    res.status(400).json({ message: "goldenSource must be 'TOOL' or 'JIRA'", field: 'goldenSource' });
    return;
  }
  if (!jiraProjectKey || typeof jiraProjectKey !== 'string' || jiraProjectKey.trim() === '') {
    res.status(400).json({ message: 'jiraProjectKey is required and must be a non-empty string', field: 'jiraProjectKey' });
    return;
  }

  logger.info('POST /api/jira/sync/analyze', {
    requestId,
    projectId,
    rootWorkItemId,
    goldenSource,
    jiraProjectKey,
  });

  try {
    const result = await analyzeSyncScope({
      projectId,
      rootWorkItemId,
      goldenSource,
      jiraProjectKey,
      typeMapping,
    });

    logger.info('POST /api/jira/sync/analyze success', {
      requestId,
      actionCount: result.actions.length,
      warningCount: result.warnings.length,
    });

    res.status(200).json(result);
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        const status = error.response.status;
        logger.warn('Jira sync analyze upstream error', {
          requestId,
          status,
          data: error.response.data,
        });
        res.status(status >= 500 ? 502 : status).json({
          message: 'Upstream service returned an error',
          upstream_status: status,
          details: error.response.data,
        });
      } else {
        logger.error('Jira sync analyze network error', { requestId, error: error.message });
        res.status(503).json({
          message: 'Upstream service unavailable',
          error: error.message,
        });
      }
      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    // Validation errors thrown by the service surface as 400 to the caller.
    if (message.startsWith('rootWorkItemId') || message.includes('not found') || message.includes('required') || message.startsWith('goldenSource')) {
      res.status(400).json({ message });
      return;
    }
    logger.error('Jira sync analyze internal error', { requestId, error: message });
    res.status(500).json({ message: 'Internal server error during Jira sync analysis', error: message });
  }
});

/**
 * POST /execute
 *
 * Applies the user-confirmed list of sync actions (filtered subset of an
 * earlier /analyze response). Best-effort: per-action results are returned;
 * no rollback on failure.
 *
 * Request body:
 *   - projectId: string
 *   - rootWorkItemId?: string (optional, for logging context)
 *   - goldenSource: 'TOOL' | 'JIRA'
 *   - jiraProjectKey: string
 *   - actions: SyncActionItem[] (the rows the user checked in the modal)
 *
 * Response 200: SyncExecuteResult { results, summary }
 */
/**
 * GET /projects/:projectKey/issue-types?anchorKey=...
 *
 * Returns the issue types in a Jira project (with hierarchyLevel) plus an
 * optional anchor issue's raw type name. Used by the dynamic-mapping sync flow
 * to compute auto-shift mapping at sync configuration time.
 */
jiraSyncRouter.get('/projects/:projectKey/issue-types', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || uuidv4();
  const projectKey = req.params.projectKey;
  const anchorKey = typeof req.query.anchorKey === 'string' ? req.query.anchorKey : undefined;

  if (!projectKey || projectKey.trim() === '') {
    res.status(400).json({ message: 'projectKey path parameter is required' });
    return;
  }

  logger.info('GET /api/jira/sync/projects/:key/issue-types', { requestId, projectKey, anchorKey });

  try {
    const result = await fetchProjectIssueTypes(projectKey, anchorKey);
    res.status(200).json(result);
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response) {
      res.status(error.response.status >= 500 ? 502 : error.response.status).json({
        message: 'Upstream error fetching project issue types',
        upstream_status: error.response.status,
        details: error.response.data,
      });
      return;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Project issue types fetch failed', { requestId, error: message });
    res.status(500).json({ message: 'Internal error fetching project issue types', error: message });
  }
});

jiraSyncRouter.post('/execute', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || uuidv4();
  const body = req.body ?? {};
  const { projectId, rootWorkItemId, goldenSource, jiraProjectKey, actions, typeMapping } = body as Partial<SyncExecuteRequest>;

  if (!projectId || typeof projectId !== 'string') {
    res.status(400).json({ message: 'projectId is required', field: 'projectId' });
    return;
  }
  if (goldenSource !== 'TOOL' && goldenSource !== 'JIRA') {
    res.status(400).json({ message: "goldenSource must be 'TOOL' or 'JIRA'", field: 'goldenSource' });
    return;
  }
  if (!jiraProjectKey || typeof jiraProjectKey !== 'string') {
    res.status(400).json({ message: 'jiraProjectKey is required', field: 'jiraProjectKey' });
    return;
  }
  if (!Array.isArray(actions)) {
    res.status(400).json({ message: 'actions must be an array', field: 'actions' });
    return;
  }

  logger.info('POST /api/jira/sync/execute', {
    requestId,
    projectId,
    rootWorkItemId,
    goldenSource,
    jiraProjectKey,
    actionCount: actions.length,
  });

  try {
    const result = await executeSyncActions({
      projectId,
      rootWorkItemId,
      goldenSource,
      jiraProjectKey,
      actions,
      typeMapping,
    });

    logger.info('POST /api/jira/sync/execute success', {
      requestId,
      summary: result.summary,
    });

    res.status(200).json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Jira sync execute internal error', { requestId, error: message });
    res.status(500).json({
      message: 'Internal server error during Jira sync execution',
      error: message,
    });
  }
});
