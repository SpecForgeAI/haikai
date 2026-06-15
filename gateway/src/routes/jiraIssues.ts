/**
 * Jira Issues Routes for the Gateway API
 *
 * Provides proxy routes for Jira issue endpoints, forwarding requests
 * to the jira-service.
 *
 * Spec 2026-02-05: Jira Service (Spring Boot) -- GET /jira/issues
 * Task Group 6: Gateway Proxy Route, Config, and Wiring
 */

import { Router, Request, Response } from 'express';
import axios, { AxiosError } from 'axios';
import { getConfig } from '../config';
import { logger } from '../services/logger';

export const jiraIssuesRouter = Router();

/**
 * Helper to get the jira-service base URL
 */
function getJiraServiceUrl(): string {
  return getConfig().jiraServiceBaseUrl;
}

/**
 * Helper to forward error responses from the jira-service
 */
function handleProxyError(error: unknown, res: Response, requestId: string): void {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    if (axiosError.response) {
      // Forward the error response from jira-service
      const status = axiosError.response.status;
      const data = axiosError.response.data;
      logger.warn('Jira issues proxy error response', {
        requestId,
        status,
        data,
      });
      res.status(status).json(data);
    } else {
      // Network or other error
      logger.error('Jira issues proxy network error', {
        requestId,
        error: axiosError.message,
      });
      res.status(503).json({
        message: 'Jira service unavailable',
        error: axiosError.message,
      });
    }
  } else {
    logger.error('Jira issues proxy unexpected error', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      message: 'Internal server error',
    });
  }
}

/**
 * GET /api/v1/jira/issues
 *
 * Proxies to jira-service GET /jira/issues with all query parameters forwarded.
 * Returns a JSON array of WorkItemDto objects.
 */
jiraIssuesRouter.get('/issues', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';

  logger.debug('GET /api/v1/jira/issues - Fetching Jira issues', {
    requestId,
    query: req.query,
  });

  try {
    const response = await axios.get(`${getJiraServiceUrl()}/jira/issues`, {
      params: req.query,
      timeout: 30000,
    });

    logger.info('GET /api/v1/jira/issues success', {
      requestId,
      count: Array.isArray(response.data) ? response.data.length : 'unknown',
    });

    res.json(response.data);
  } catch (error) {
    handleProxyError(error, res, requestId);
  }
});
