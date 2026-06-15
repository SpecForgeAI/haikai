/**
 * Request ID middleware for request correlation
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Extend Express Request to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Middleware that generates a unique request ID for each request.
 * The ID is:
 * - Attached to req.requestId for use in handlers
 * - Added to response header X-Request-ID
 *
 * If the client provides X-Request-ID header, it will be used instead.
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Next middleware function
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Use client-provided ID or generate new one
  const requestId = (req.headers['x-request-id'] as string) || uuidv4();

  // Attach to request object
  req.requestId = requestId;

  // Add to response headers
  res.setHeader('X-Request-ID', requestId);

  next();
}
