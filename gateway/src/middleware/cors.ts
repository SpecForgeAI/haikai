/**
 * CORS middleware configuration
 */

import cors from 'cors';
import { getConfig } from '../config';

/**
 * Creates a configured CORS middleware based on environment settings.
 * Only allows origins specified in ALLOWED_ORIGINS config.
 *
 * @returns Configured CORS middleware
 */
export function createCorsMiddleware() {
  const config = getConfig();

  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) {
        callback(null, true);
        return;
      }

      // Check if origin is in the allowed list
      if (config.allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
    maxAge: 86400, // 24 hours
  });
}

/**
 * Creates a CORS middleware with a specific list of allowed origins.
 * Useful for testing.
 *
 * @param allowedOrigins - List of allowed origins
 * @returns Configured CORS middleware
 */
export function createCorsMiddlewareWithOrigins(allowedOrigins: string[]) {
  return cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
    maxAge: 86400,
  });
}
