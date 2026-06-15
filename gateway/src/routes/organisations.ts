/**
 * Organisation Routes for the Gateway API
 *
 * Provides proxy routes for organisation endpoints, forwarding requests
 * to the architecture-model-service.
 *
 * Spec 2026-01-18: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs
 * Task Group 4: Gateway Layer - Gateway Proxy Routes
 */

import { Router, Request, Response, NextFunction } from 'express';
import axios, { AxiosError } from 'axios';
import { getConfig } from '../config';
import { logger } from '../services/logger';

export const organisationsRouter = Router();

/**
 * Helper to get the architecture-model-service base URL
 */
function getModelServiceUrl(): string {
  return getConfig().architectureModelServiceBaseUrl;
}

/**
 * Helper to forward error responses from the model service
 */
function handleProxyError(error: unknown, res: Response, requestId: string): void {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    if (axiosError.response) {
      // Forward the error response from model service
      const status = axiosError.response.status;
      const data = axiosError.response.data;
      logger.warn('Organisation proxy error response', {
        requestId,
        status,
        data,
      });
      res.status(status).json(data);
    } else {
      // Network or other error
      logger.error('Organisation proxy network error', {
        requestId,
        error: axiosError.message,
      });
      res.status(503).json({
        message: 'Architecture model service unavailable',
        error: axiosError.message,
      });
    }
  } else {
    logger.error('Organisation proxy unexpected error', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      message: 'Internal server error',
    });
  }
}

/**
 * GET /api/v1/organisations
 *
 * Lists all organisations ordered by name.
 * Proxies to architecture-model-service GET /api/v1/organisations
 */
organisationsRouter.get('/', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';

  logger.debug('GET /api/v1/organisations - Listing organisations', { requestId });

  try {
    const response = await axios.get(`${getModelServiceUrl()}/api/v1/organisations`, {
      timeout: 10000,
    });

    logger.info('GET /api/v1/organisations success', {
      requestId,
      count: Array.isArray(response.data) ? response.data.length : 'unknown',
    });

    res.json(response.data);
  } catch (error) {
    handleProxyError(error, res, requestId);
  }
});

/**
 * GET /api/v1/organisations/by-name/:name
 *
 * Gets an organisation by exact name.
 * Proxies to architecture-model-service GET /api/v1/organisations/by-name/{name}
 */
organisationsRouter.get('/by-name/:name', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { name } = req.params;

  logger.debug('GET /api/v1/organisations/by-name/:name - Getting organisation', {
    requestId,
    name,
  });

  try {
    // Encode the name for the URL path
    const encodedName = encodeURIComponent(name);
    const response = await axios.get(
      `${getModelServiceUrl()}/api/v1/organisations/by-name/${encodedName}`,
      {
        timeout: 10000,
      }
    );

    logger.info('GET /api/v1/organisations/by-name/:name success', {
      requestId,
      name,
    });

    res.json(response.data);
  } catch (error) {
    handleProxyError(error, res, requestId);
  }
});

/**
 * POST /api/v1/organisations
 *
 * Creates a new organisation.
 * Proxies to architecture-model-service POST /api/v1/organisations
 */
organisationsRouter.post('/', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';

  logger.debug('POST /api/v1/organisations - Creating organisation', {
    requestId,
    name: req.body?.name,
  });

  try {
    const response = await axios.post(
      `${getModelServiceUrl()}/api/v1/organisations`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    logger.info('POST /api/v1/organisations success', {
      requestId,
      organisationId: response.data?.id,
      name: response.data?.name,
    });

    res.status(response.status).json(response.data);
  } catch (error) {
    handleProxyError(error, res, requestId);
  }
});
