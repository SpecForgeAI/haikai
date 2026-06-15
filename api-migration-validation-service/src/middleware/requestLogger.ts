import { Request, Response, NextFunction } from 'express';

/**
 * Express middleware for structured JSON logging of api-migration-validation
 * service requests.
 *
 * Mirrors `discovery-service/src/middleware/requestLogger.ts` -- only logs
 * requests scoped to the `/api-migration-validation/` mount path so unrelated
 * health/metrics noise stays out of the structured stream.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Only log requests to /api-migration-validation/ routes
  if (!req.path.startsWith('/api-migration-validation/')) {
    return next();
  }

  const startTime = Date.now();
  const method = req.method;
  const path = req.path;

  console.log(JSON.stringify({
    type: 'request_start',
    method,
    path,
    timestamp: new Date(startTime).toISOString(),
  }));

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const statusCode = res.statusCode;

    console.log(JSON.stringify({
      type: 'request_complete',
      method,
      path,
      statusCode,
      durationMs,
      timestamp: new Date().toISOString(),
    }));
  });

  next();
}
