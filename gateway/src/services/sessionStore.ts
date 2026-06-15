/**
 * In-memory session store for Gateway sessions
 */

import { v4 as uuidv4 } from 'uuid';
import { GatewaySession, SessionUpdate, SessionStore } from '../types';
import { getConfig } from '../config';
import { logger } from './logger';

/**
 * In-memory implementation of SessionStore.
 *
 * Features:
 * - Stores sessions in a Map for O(1) access
 * - Automatic expiration based on SESSION_TTL_HOURS
 * - Periodic cleanup of expired sessions
 * - Generates internal mcpSessionId for MCP calls
 */
class InMemorySessionStore implements SessionStore {
  private sessions: Map<string, GatewaySession> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Get a session by ID
   * @param sessionId - The session ID to look up
   * @returns The session or null if not found/expired
   */
  get(sessionId: string): GatewaySession | null {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check if session has expired
    if (this.isExpired(session)) {
      this.sessions.delete(sessionId);
      logger.debug('Session expired and removed', { sessionId });
      return null;
    }

    return session;
  }

  /**
   * Create or update a session
   * @param sessionId - The session ID
   * @param session - The session data
   */
  set(sessionId: string, session: GatewaySession): void {
    this.sessions.set(sessionId, session);
  }

  /**
   * Delete a session
   * @param sessionId - The session ID to delete
   * @returns true if session was deleted, false if not found
   */
  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Clean up expired sessions
   * @returns Number of sessions cleaned up
   */
  cleanup(): number {
    const before = this.sessions.size;
    const now = new Date();
    const config = getConfig();
    const ttlMs = config.sessionTtlHours * 60 * 60 * 1000;

    for (const [sessionId, session] of this.sessions.entries()) {
      const age = now.getTime() - session.lastActivity.getTime();
      if (age > ttlMs) {
        this.sessions.delete(sessionId);
      }
    }

    const cleaned = before - this.sessions.size;
    if (cleaned > 0) {
      logger.info('Session cleanup completed', {
        event: 'session_cleanup',
        cleanedCount: cleaned,
        remainingCount: this.sessions.size,
      });
    }

    return cleaned;
  }

  /**
   * Check if a session has expired
   */
  private isExpired(session: GatewaySession): boolean {
    const config = getConfig();
    const ttlMs = config.sessionTtlHours * 60 * 60 * 1000;
    const age = Date.now() - session.lastActivity.getTime();
    return age > ttlMs;
  }

  /**
   * Start periodic cleanup interval
   * @param intervalMinutes - Cleanup interval in minutes
   */
  startCleanupInterval(intervalMinutes: number = 5): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, intervalMinutes * 60 * 1000);

    // Don't prevent Node from exiting
    this.cleanupInterval.unref();
  }

  /**
   * Stop periodic cleanup
   */
  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get total session count (for monitoring)
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Clear all sessions (for testing)
   */
  clear(): void {
    this.sessions.clear();
  }
}

// Singleton instance
const sessionStore = new InMemorySessionStore();

/**
 * Get or create a session.
 * If the session doesn't exist, creates a new one with generated mcpSessionId.
 *
 * @param sessionId - Frontend session ID
 * @returns The existing or newly created session
 */
export function getOrCreateSession(sessionId: string): GatewaySession {
  let session = sessionStore.get(sessionId);

  if (!session) {
    session = {
      sessionId,
      mcpSessionId: uuidv4(),
      conversation: [], // Initialize with empty conversation array
      createdAt: new Date(),
      lastActivity: new Date(),
    };
    sessionStore.set(sessionId, session);
    logger.debug('New session created', { sessionId, mcpSessionId: session.mcpSessionId });
  }

  return session;
}

/**
 * Update session with partial data and refresh lastActivity
 *
 * @param sessionId - Session ID to update
 * @param updates - Partial session updates
 * @returns Updated session or null if not found
 */
export function updateSession(
  sessionId: string,
  updates: SessionUpdate
): GatewaySession | null {
  const session = sessionStore.get(sessionId);

  if (!session) {
    return null;
  }

  const updatedSession: GatewaySession = {
    ...session,
    ...updates,
    lastActivity: new Date(),
  };

  sessionStore.set(sessionId, updatedSession);
  return updatedSession;
}

/**
 * Get an existing session
 *
 * @param sessionId - Session ID to retrieve
 * @returns Session or null if not found
 */
export function getSession(sessionId: string): GatewaySession | null {
  return sessionStore.get(sessionId);
}

/**
 * Delete a session
 *
 * @param sessionId - Session ID to delete
 * @returns true if deleted, false if not found
 */
export function deleteSession(sessionId: string): boolean {
  return sessionStore.delete(sessionId);
}

/**
 * Start the session cleanup interval
 *
 * @param intervalMinutes - Cleanup interval in minutes
 */
export function startCleanupInterval(intervalMinutes: number = 5): void {
  sessionStore.startCleanupInterval(intervalMinutes);
}

/**
 * Stop the session cleanup interval
 */
export function stopCleanupInterval(): void {
  sessionStore.stopCleanupInterval();
}

/**
 * Get session count (for monitoring)
 */
export function getSessionCount(): number {
  return sessionStore.getSessionCount();
}

/**
 * Clear all sessions (for testing)
 */
export function clearAllSessions(): void {
  sessionStore.clear();
}

/**
 * Run cleanup manually
 */
export function runCleanup(): number {
  return sessionStore.cleanup();
}

// Export the store instance for direct access if needed
export { sessionStore };
