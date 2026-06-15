/**
 * Rate limiting middleware
 */

import rateLimit from 'express-rate-limit';
import { getConfig } from '../config';

/**
 * Creates a rate limiting middleware based on configuration.
 *
 * - Limits requests per IP based on RATE_LIMIT_RPM
 * - Allows burst requests up to RATE_LIMIT_BURST
 * - Returns 429 with retry-after header when limit exceeded
 *
 * @returns Configured rate limit middleware
 */
export function createRateLimitMiddleware() {
  const config = getConfig();

  // Window is 1 minute (60000ms)
  const windowMs = 60 * 1000;

  // Max requests = RPM + burst allowance
  const max = config.rateLimitRpm + config.rateLimitBurst;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: {
      error: {
        code: 429,
        message: 'Too many requests, please try again later',
      },
    },
    keyGenerator: (req) => {
      // Key by IP address
      return req.ip || req.socket.remoteAddress || 'unknown';
    },
  });
}

/**
 * Creates a rate limiting middleware with specific limits.
 * Useful for testing.
 *
 * @param maxRequests - Maximum requests per window
 * @param windowMs - Window duration in milliseconds
 * @returns Configured rate limit middleware
 */
export function createRateLimitMiddlewareWithLimits(
  maxRequests: number,
  windowMs: number = 60000
) {
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 429,
        message: 'Too many requests, please try again later',
      },
    },
    keyGenerator: (req) => {
      return req.ip || req.socket.remoteAddress || 'unknown';
    },
  });
}
