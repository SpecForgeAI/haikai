/**
 * Request validation middleware
 */

import { Request, Response, NextFunction } from 'express';
import { validateChatRequest, validateSessionId, isValidPreferredFormat } from '../types';
import { getConfig } from '../config';
import { createValidationError } from './errorHandler';

/**
 * Middleware to validate POST /api/chat requests.
 *
 * Validates:
 * - sessionId is non-empty string if provided (optional - handler generates if missing)
 * - message is non-empty and within MAX_MESSAGE_BYTES
 * - draftOas within MAX_OAS_BYTES if provided
 * - preferredFormat is 'yaml' or 'json' if provided
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Next middleware function
 */
export function validateChatRequestMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const config = getConfig();

  const result = validateChatRequest(
    req.body,
    config.maxMessageBytes,
    config.maxOasBytes
  );

  if (!result.valid) {
    const errorMessages = result.errors.map(e => `${e.field}: ${e.message}`).join('; ');
    return next(createValidationError(errorMessages));
  }

  next();
}

/**
 * Middleware to validate GET /api/chat/stream query parameters.
 *
 * Validates:
 * - sessionId is non-empty string if provided (optional - handler generates if missing)
 * - message is required and non-empty
 * - preferredFormat is 'yaml' or 'json' if provided
 *
 * Note: draftOas is NOT supported in streaming endpoint due to URL length limits.
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Next middleware function
 */
export function validateStreamRequestMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const config = getConfig();
  const errors: string[] = [];

  // Validate sessionId (optional - if provided, must be non-empty after trim)
  const sessionIdResult = validateSessionId(req.query.sessionId);
  if (!sessionIdResult.valid) {
    errors.push(...sessionIdResult.errors.map(e => `${e.field}: ${e.message}`));
  }

  // Validate message
  const message = req.query.message as string | undefined;
  if (!message || message.trim().length === 0) {
    errors.push('message: message is required and must be a non-empty string');
  } else {
    const messageBytes = Buffer.byteLength(message, 'utf8');
    if (messageBytes > config.maxMessageBytes) {
      errors.push(`message: message exceeds maximum size of ${config.maxMessageBytes} bytes`);
    }
  }

  // Validate preferredFormat if provided
  const preferredFormat = req.query.preferredFormat;
  if (preferredFormat !== undefined && !isValidPreferredFormat(preferredFormat)) {
    errors.push('preferredFormat: preferredFormat must be "yaml" or "json"');
  }

  if (errors.length > 0) {
    return next(createValidationError(errors.join('; ')));
  }

  next();
}

/**
 * Combined middleware factory for chat validation.
 * Returns the appropriate validator based on request method.
 */
export function createChatValidationMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'POST') {
      return validateChatRequestMiddleware(req, res, next);
    } else if (req.method === 'GET') {
      return validateStreamRequestMiddleware(req, res, next);
    }
    next();
  };
}
