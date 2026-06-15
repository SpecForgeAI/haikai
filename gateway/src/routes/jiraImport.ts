/**
 * Jira Import Route Handler for Roadmap Skeleton
 *
 * Provides the POST /import endpoint for importing Jira Initiatives and Epics
 * into the architecture-model-service as canonical work items.
 *
 * Spec 2026-02-15: RM Increment 4 -- Jira Import for Roadmap Skeleton (Initiatives + Epics)
 * Task Group 3: Import Route Handler + Config
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { importJiraRoadmap } from '../services/jiraImportService';
import { logger } from '../services/logger';

export const jiraImportRouter = Router();

/**
 * POST /import
 *
 * Imports a Jira roadmap skeleton (Initiatives and Epics) into the tool.
 *
 * Request body:
 *   - projectId: string (required, non-empty)
 *   - jql: string (required, non-empty)
 *   - jiraProjectKey: string (required, non-empty)
 *   - maxResults: number (optional, defaults to 200)
 *
 * Response:
 *   200: JiraImportResult { createdInitiatives, updatedInitiatives, createdEpics, updatedEpics, warnings }
 *   400: Validation error { message, field }
 *   502: Upstream jira-service error
 *   503: Jira service unavailable
 *   500: Internal server error
 */
jiraImportRouter.post('/import', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || uuidv4();

  logger.info('POST /api/roadmap/jira/import - Starting Jira roadmap import', {
    requestId,
  });

  // ------------------------------------------------------------------
  // Validate request body
  // ------------------------------------------------------------------
  const { projectId, jql, jiraProjectKey, maxResults } = req.body;

  if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
    logger.warn('Validation failed: projectId is required', { requestId });
    res.status(400).json({
      message: 'projectId is required and must be a non-empty string',
      field: 'projectId',
    });
    return;
  }

  if (!jql || typeof jql !== 'string' || jql.trim() === '') {
    logger.warn('Validation failed: jql is required', { requestId });
    res.status(400).json({
      message: 'jql is required and must be a non-empty string',
      field: 'jql',
    });
    return;
  }

  if (!jiraProjectKey || typeof jiraProjectKey !== 'string' || jiraProjectKey.trim() === '') {
    logger.warn('Validation failed: jiraProjectKey is required', { requestId });
    res.status(400).json({
      message: 'jiraProjectKey is required and must be a non-empty string',
      field: 'jiraProjectKey',
    });
    return;
  }

  // Default maxResults to 200 if not provided
  const effectiveMaxResults = typeof maxResults === 'number' && maxResults > 0 ? maxResults : 200;

  logger.info('Jira import request validated', {
    requestId,
    projectId,
    jql,
    jiraProjectKey,
    maxResults: effectiveMaxResults,
  });

  // ------------------------------------------------------------------
  // Call the import service
  // ------------------------------------------------------------------
  try {
    const result = await importJiraRoadmap({
      projectId,
      jql,
      jiraProjectKey,
      maxResults: effectiveMaxResults,
    });

    logger.info('POST /api/roadmap/jira/import - Import completed successfully', {
      requestId,
      createdInitiatives: result.createdInitiatives,
      updatedInitiatives: result.updatedInitiatives,
      createdEpics: result.createdEpics,
      updatedEpics: result.updatedEpics,
      warningCount: result.warnings.length,
    });

    res.status(200).json(result);
  } catch (error: unknown) {
    // Handle jira-service upstream errors (axios errors)
    if (axios.isAxiosError(error)) {
      if (error.response) {
        // Forward the error response from jira-service
        const status = error.response.status;
        const data = error.response.data;
        logger.warn('Jira import upstream error response', {
          requestId,
          status,
          data,
        });
        res.status(status >= 500 ? 502 : status).json({
          message: 'Jira service returned an error',
          upstream_status: status,
          details: data,
        });
      } else {
        // Network or other connection error
        logger.error('Jira import upstream network error', {
          requestId,
          error: error.message,
        });
        res.status(503).json({
          message: 'Jira service unavailable',
          error: error.message,
        });
      }
    } else {
      // Internal or architecture-model-service errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Jira import internal error', {
        requestId,
        error: errorMessage,
      });
      res.status(500).json({
        message: 'Internal server error during Jira import',
        error: errorMessage,
      });
    }
  }
});
