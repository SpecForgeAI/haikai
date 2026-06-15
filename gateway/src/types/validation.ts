/**
 * Type validation utilities for request validation
 */

import { ChatRequest, ChatContext } from './chat';

/**
 * Validation error with specific details
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validates that a value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates the preferredFormat field
 */
export function isValidPreferredFormat(value: unknown): value is 'yaml' | 'json' | undefined {
  if (value === undefined || value === null) return true;
  return value === 'yaml' || value === 'json';
}

/**
 * Validates ChatContext fields
 */
export function validateChatContext(
  context: unknown,
  maxOasBytes: number
): ValidationResult {
  const errors: ValidationError[] = [];

  if (context === undefined || context === null) {
    return { valid: true, errors: [] };
  }

  if (typeof context !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'context', message: 'context must be an object' }]
    };
  }

  const ctx = context as Record<string, unknown>;

  // Validate preferredFormat if present
  if (ctx.preferredFormat !== undefined && !isValidPreferredFormat(ctx.preferredFormat)) {
    errors.push({
      field: 'context.preferredFormat',
      message: 'preferredFormat must be "yaml" or "json"'
    });
  }

  // Validate draftOas size if present
  if (ctx.draftOas !== undefined) {
    if (typeof ctx.draftOas !== 'string') {
      errors.push({
        field: 'context.draftOas',
        message: 'draftOas must be a string'
      });
    } else {
      const oasBytes = Buffer.byteLength(ctx.draftOas, 'utf8');
      if (oasBytes > maxOasBytes) {
        errors.push({
          field: 'context.draftOas',
          message: `draftOas exceeds maximum size of ${maxOasBytes} bytes (received ${oasBytes} bytes)`
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Checks if the request is a bootstrap phase request.
 *
 * Spec: Implement Assistant Stage 3 - Bootstrap Phase
 *
 * @param body - Request body
 * @returns true if this is a bootstrap phase request
 */
function isBootstrapPhase(body: Record<string, unknown>): boolean {
  const context = body.context as Record<string, unknown> | undefined;
  return context?.mode === 'implement_feature' && context?.phase === 'bootstrap';
}

/**
 * Validates a ChatRequest
 *
 * sessionId is optional - if not provided, the handler will generate one.
 * If sessionId IS provided, it must be a non-empty string after trim.
 *
 * Spec: Implement Assistant Stage 3 - Bootstrap Phase
 * For bootstrap phase (mode: 'implement_feature', phase: 'bootstrap'),
 * message is allowed to be empty as the request is auto-triggered on mount.
 */
export function validateChatRequest(
  body: unknown,
  maxMessageBytes: number,
  maxOasBytes: number
): ValidationResult {
  const errors: ValidationError[] = [];

  if (!body || typeof body !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'body', message: 'Request body must be an object' }]
    };
  }

  const req = body as Record<string, unknown>;

  // Validate sessionId (optional, but if provided must be non-empty string after trim)
  if (req.sessionId !== undefined && req.sessionId !== null) {
    if (typeof req.sessionId !== 'string' || req.sessionId.trim().length === 0) {
      errors.push({
        field: 'sessionId',
        message: 'sessionId must be a non-empty string if provided'
      });
    }
  }

  // Validate message (required, non-empty string, within size limit)
  // Exception: bootstrap phase allows empty message
  const isBootstrap = isBootstrapPhase(req);

  if (isBootstrap) {
    // For bootstrap, message can be empty or omitted
    if (req.message !== undefined && req.message !== null && req.message !== '') {
      // If message is provided, validate its size
      if (typeof req.message === 'string') {
        const messageBytes = Buffer.byteLength(req.message, 'utf8');
        if (messageBytes > maxMessageBytes) {
          errors.push({
            field: 'message',
            message: `message exceeds maximum size of ${maxMessageBytes} bytes (received ${messageBytes} bytes)`
          });
        }
      }
    }
    // Empty message is valid for bootstrap - no error
  } else {
    // Non-bootstrap: message is required
    if (!isNonEmptyString(req.message)) {
      errors.push({
        field: 'message',
        message: 'message is required and must be a non-empty string'
      });
    } else {
      const messageBytes = Buffer.byteLength(req.message as string, 'utf8');
      if (messageBytes > maxMessageBytes) {
        errors.push({
          field: 'message',
          message: `message exceeds maximum size of ${maxMessageBytes} bytes (received ${messageBytes} bytes)`
        });
      }
    }
  }

  // Validate context if present
  const contextResult = validateChatContext(req.context, maxOasBytes);
  errors.push(...contextResult.errors);

  return { valid: errors.length === 0, errors };
}

/**
 * Validates sessionId for streaming endpoint
 *
 * sessionId is optional - if not provided, the handler will generate one.
 * If sessionId IS provided, it must be a non-empty string after trim.
 */
export function validateSessionId(sessionId: unknown): ValidationResult {
  // If sessionId is not provided (undefined, null, or empty string), validation passes
  // The handler will generate a sessionId
  if (sessionId === undefined || sessionId === null || sessionId === '') {
    return { valid: true, errors: [] };
  }

  // If sessionId is provided, it must be a non-empty string after trim
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    return {
      valid: false,
      errors: [{ field: 'sessionId', message: 'sessionId must be a non-empty string if provided' }]
    };
  }

  return { valid: true, errors: [] };
}
