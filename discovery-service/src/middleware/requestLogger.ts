import { Request, Response, NextFunction } from 'express';

/**
 * Express middleware for structured JSON logging of discovery service requests.
 *
 * Emits structured JSON log entries for incoming requests to /discovery/ routes,
 * including method, path, statusCode, durationMs, and timestamp.
 * Uses the res.on('finish') callback pattern for response logging.
 *
 * Spec: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 6: Structured Logging, Diagnostics Endpoint, and Request Logger
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Only log requests to /discovery/ routes
  if (!req.path.startsWith('/discovery/')) {
    return next();
  }

  const startTime = Date.now();
  const method = req.method;
  const path = req.path;

  // Log incoming request as structured JSON
  console.log(JSON.stringify({
    type: 'request_start',
    method,
    path,
    timestamp: new Date(startTime).toISOString(),
  }));

  // Use res.on('finish') to log response status and duration as structured JSON
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
