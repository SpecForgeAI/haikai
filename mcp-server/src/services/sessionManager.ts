import { Session, InterfaceSummaryDto } from '../types';
import { MCP_SESSION_TTL_MINUTES } from '../config';

/**
 * In-memory session storage
 */
const sessions: Map<string, Session> = new Map();

/**
 * Cleanup interval reference (for testing cleanup)
 */
let cleanupIntervalId: NodeJS.Timeout | null = null;

/**
 * Gets an existing session or creates a new one if it doesn't exist.
 * Updates lastActivity timestamp on every access.
 *
 * @param sessionId - The session identifier
 * @returns The session object
 */
export function getOrCreateSession(sessionId: string): Session {
  let session = sessions.get(sessionId);

  if (!session) {
    session = {
      sessionId,
      lastActivity: new Date(),
    };
    sessions.set(sessionId, session);
  } else {
    // Update last activity on access
    session.lastActivity = new Date();
  }

  return session;
}

/**
 * Updates an existing session with partial data.
 * Creates the session if it doesn't exist.
 *
 * @param sessionId - The session identifier
 * @param updates - Partial session data to update
 * @returns The updated session object
 */
export function updateSession(
  sessionId: string,
  updates: Partial<Omit<Session, 'sessionId' | 'lastActivity'>>
): Session {
  const session = getOrCreateSession(sessionId);

  if (updates.filename !== undefined) {
    session.filename = updates.filename;
  }
  if (updates.lastListedInterfaces !== undefined) {
    session.lastListedInterfaces = updates.lastListedInterfaces;
  }
  if (updates.lastSelectedInterfaceId !== undefined) {
    session.lastSelectedInterfaceId = updates.lastSelectedInterfaceId;
  }
  if (updates.productName !== undefined) {
    session.productName = updates.productName;
  }

  session.lastActivity = new Date();
  return session;
}

/**
 * Removes sessions that have exceeded the TTL.
 *
 * @returns The number of sessions removed
 */
export function cleanupExpiredSessions(): number {
  const now = new Date();
  const ttlMs = MCP_SESSION_TTL_MINUTES * 60 * 1000;
  let removedCount = 0;

  for (const [sessionId, session] of sessions.entries()) {
    const age = now.getTime() - session.lastActivity.getTime();
    if (age > ttlMs) {
      sessions.delete(sessionId);
      removedCount++;
    }
  }

  return removedCount;
}

/**
 * Gets a session by ID without updating lastActivity.
 * Used primarily for testing.
 *
 * @param sessionId - The session identifier
 * @returns The session or undefined if not found
 */
export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

/**
 * Clears all sessions.
 * Used primarily for testing.
 */
export function clearAllSessions(): void {
  sessions.clear();
}

/**
 * Gets the current session count.
 * Used primarily for testing.
 *
 * @returns The number of active sessions
 */
export function getSessionCount(): number {
  return sessions.size;
}

/**
 * Starts the automatic session cleanup interval.
 * Runs every 5 minutes by default.
 *
 * @param intervalMinutes - Interval in minutes (default: 5)
 */
export function startCleanupInterval(intervalMinutes: number = 5): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  cleanupIntervalId = setInterval(() => {
    const removed = cleanupExpiredSessions();
    if (removed > 0) {
      console.log(`[SessionManager] Cleaned up ${removed} expired session(s)`);
    }
  }, intervalMs);

  // Ensure the interval doesn't prevent Node.js from exiting
  cleanupIntervalId.unref();
}

/**
 * Stops the automatic session cleanup interval.
 * Used primarily for testing.
 */
export function stopCleanupInterval(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}
