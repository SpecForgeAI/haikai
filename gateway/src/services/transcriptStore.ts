/**
 * In-memory transcript store for conversation persistence.
 *
 * Spec 2026-01-14: Implement Assistant Stage 7 - Full Conversation and Execution Persistence to Disk
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * - Added split plan storage and update methods
 * - Added per-part status updates
 * - Added per-part transcript entry appending
 *
 * Provides storage for ConversationTranscript buffers during implement_feature conversations.
 * Follows the same patterns as sessionStore.ts for consistency.
 */

import {
  ConversationTranscript,
  TranscriptEntry,
  TranscriptRole,
  TranscriptPhase,
  SplitPlan,
} from '../types/transcript';
import { PartStatus } from '../types/chat';
import { getConfig } from '../config';
import { logger } from './logger';

/**
 * In-memory implementation of transcript buffer storage.
 *
 * Features:
 * - Stores transcripts in a Map for O(1) access
 * - Automatic expiration based on SESSION_TTL_HOURS
 * - Periodic cleanup of expired transcripts
 * - Generates timestamps in ISO-8601 format
 * - Split plan state management (Spec 2026-02-06)
 */
class InMemoryTranscriptStore {
  private transcripts: Map<string, ConversationTranscript> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Get a transcript by session ID.
   * @param sessionId - The session ID to look up
   * @returns The transcript or null if not found/expired
   */
  get(sessionId: string): ConversationTranscript | null {
    const transcript = this.transcripts.get(sessionId);

    if (!transcript) {
      return null;
    }

    // Check if transcript has expired
    if (this.isExpired(transcript)) {
      this.transcripts.delete(sessionId);
      logger.debug('Transcript expired and removed', { sessionId });
      return null;
    }

    return transcript;
  }

  /**
   * Get an existing transcript or create a new one.
   * @param sessionId - The session ID
   * @returns Existing or newly created transcript
   */
  getOrCreate(sessionId: string): ConversationTranscript {
    let transcript = this.get(sessionId);

    if (!transcript) {
      transcript = {
        sessionId,
        entries: [],
        createdAt: new Date().toISOString(),
      };
      this.transcripts.set(sessionId, transcript);
      logger.debug('New transcript buffer created', { sessionId });
    }

    return transcript;
  }

  /**
   * Append an entry to a transcript.
   * Creates the transcript if it doesn't exist.
   * @param sessionId - The session ID
   * @param entry - The transcript entry to append
   */
  appendEntry(sessionId: string, entry: TranscriptEntry): void {
    const transcript = this.getOrCreate(sessionId);
    transcript.entries.push(entry);
    logger.debug('Transcript entry appended', {
      sessionId,
      role: entry.role,
      phase: entry.phase,
      entryCount: transcript.entries.length,
    });
  }

  /**
   * Delete a transcript.
   * @param sessionId - The session ID to delete
   * @returns true if transcript was deleted, false if not found
   */
  delete(sessionId: string): boolean {
    const deleted = this.transcripts.delete(sessionId);
    if (deleted) {
      logger.debug('Transcript deleted', { sessionId });
    }
    return deleted;
  }

  /**
   * Clean up expired transcripts.
   * @returns Number of transcripts cleaned up
   */
  cleanup(): number {
    const before = this.transcripts.size;
    const now = new Date();
    const config = getConfig();
    const ttlMs = config.sessionTtlHours * 60 * 60 * 1000;

    for (const [sessionId, transcript] of this.transcripts.entries()) {
      const createdAt = new Date(transcript.createdAt);
      const age = now.getTime() - createdAt.getTime();
      if (age > ttlMs) {
        this.transcripts.delete(sessionId);
      }
    }

    const cleaned = before - this.transcripts.size;
    if (cleaned > 0) {
      logger.info('Transcript cleanup completed', {
        event: 'transcript_cleanup',
        cleanedCount: cleaned,
        remainingCount: this.transcripts.size,
      });
    }

    return cleaned;
  }

  /**
   * Check if a transcript has expired.
   */
  private isExpired(transcript: ConversationTranscript): boolean {
    const config = getConfig();
    const ttlMs = config.sessionTtlHours * 60 * 60 * 1000;
    const createdAt = new Date(transcript.createdAt);
    const age = Date.now() - createdAt.getTime();
    return age > ttlMs;
  }

  /**
   * Start periodic cleanup interval.
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
   * Stop periodic cleanup.
   */
  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get total transcript count (for monitoring).
   */
  getTranscriptCount(): number {
    return this.transcripts.size;
  }

  /**
   * Clear all transcripts (for testing).
   */
  clear(): void {
    this.transcripts.clear();
  }

  // ==========================================================================
  // Split Plan Methods
  // Spec 2026-02-06: Implement-Part Sequencing Workflow
  // ==========================================================================

  /**
   * Update or set the split plan for a session.
   * Creates the transcript if it doesn't exist.
   *
   * @param sessionId - The session ID
   * @param splitPlan - The split plan state to store
   *
   * Spec 2026-02-06: Implement-Part Sequencing Workflow
   */
  updateSplitPlan(sessionId: string, splitPlan: SplitPlan): void {
    const transcript = this.getOrCreate(sessionId);
    transcript.splitPlan = splitPlan;
    logger.debug('Split plan updated', {
      sessionId,
      partsCount: splitPlan.parts.length,
    });
  }

  /**
   * Get the split plan for a session.
   *
   * @param sessionId - The session ID
   * @returns The split plan or null if not found/not set
   *
   * Spec 2026-02-06: Implement-Part Sequencing Workflow
   */
  getSplitPlan(sessionId: string): SplitPlan | null {
    const transcript = this.get(sessionId);
    if (!transcript || !transcript.splitPlan) {
      return null;
    }
    return transcript.splitPlan;
  }

  /**
   * Update the status of a specific part.
   *
   * @param sessionId - The session ID
   * @param partIndex - The 1-based part index
   * @param status - The new status to set
   *
   * Spec 2026-02-06: Implement-Part Sequencing Workflow
   */
  updatePartStatus(sessionId: string, partIndex: number, status: PartStatus): void {
    const transcript = this.get(sessionId);
    if (!transcript || !transcript.splitPlan) {
      logger.warn('Cannot update part status - no split plan found', {
        sessionId,
        partIndex,
        status,
      });
      return;
    }

    transcript.splitPlan.partStatuses[partIndex] = status;
    logger.debug('Part status updated', {
      sessionId,
      partIndex,
      status,
    });
  }

  /**
   * Update the job ID for a specific part.
   *
   * @param sessionId - The session ID
   * @param partIndex - The 1-based part index
   * @param jobId - The job ID to set
   *
   * Spec 2026-02-06: Implement-Part Sequencing Workflow
   */
  updatePartJobId(sessionId: string, partIndex: number, jobId: string): void {
    const transcript = this.get(sessionId);
    if (!transcript || !transcript.splitPlan) {
      logger.warn('Cannot update part job ID - no split plan found', {
        sessionId,
        partIndex,
        jobId,
      });
      return;
    }

    transcript.splitPlan.partJobIds[partIndex] = jobId;
    logger.debug('Part job ID updated', {
      sessionId,
      partIndex,
      jobId,
    });
  }

  /**
   * Update timestamps for a specific part.
   *
   * @param sessionId - The session ID
   * @param partIndex - The 1-based part index
   * @param field - The timestamp field to update ('startedAt' or 'completedAt')
   * @param timestamp - The ISO-8601 timestamp value
   *
   * Spec 2026-02-06: Implement-Part Sequencing Workflow
   */
  updatePartTimestamp(
    sessionId: string,
    partIndex: number,
    field: 'startedAt' | 'completedAt',
    timestamp: string
  ): void {
    const transcript = this.get(sessionId);
    if (!transcript || !transcript.splitPlan) {
      logger.warn('Cannot update part timestamp - no split plan found', {
        sessionId,
        partIndex,
        field,
      });
      return;
    }

    if (!transcript.splitPlan.partTimestamps[partIndex]) {
      transcript.splitPlan.partTimestamps[partIndex] = {};
    }
    transcript.splitPlan.partTimestamps[partIndex][field] = timestamp;
    logger.debug('Part timestamp updated', {
      sessionId,
      partIndex,
      field,
      timestamp,
    });
  }

  /**
   * Append an entry to a specific part's transcript.
   *
   * @param sessionId - The session ID
   * @param partIndex - The 1-based part index
   * @param entry - The transcript entry to append
   *
   * Spec 2026-02-06: Implement-Part Sequencing Workflow
   */
  appendPartTranscriptEntry(sessionId: string, partIndex: number, entry: TranscriptEntry): void {
    const transcript = this.get(sessionId);
    if (!transcript || !transcript.splitPlan) {
      logger.warn('Cannot append part transcript entry - no split plan found', {
        sessionId,
        partIndex,
      });
      return;
    }

    if (!transcript.splitPlan.partTranscripts[partIndex]) {
      transcript.splitPlan.partTranscripts[partIndex] = [];
    }
    transcript.splitPlan.partTranscripts[partIndex].push(entry);
    logger.debug('Part transcript entry appended', {
      sessionId,
      partIndex,
      role: entry.role,
      entryCount: transcript.splitPlan.partTranscripts[partIndex].length,
    });
  }
}

// Singleton instance
const transcriptStore = new InMemoryTranscriptStore();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Initialize a new transcript buffer for a session.
 * @param sessionId - Session ID to initialize
 * @returns The newly created transcript
 */
export function initializeTranscript(sessionId: string): ConversationTranscript {
  return transcriptStore.getOrCreate(sessionId);
}

/**
 * Get an existing transcript.
 * @param sessionId - Session ID to retrieve
 * @returns Transcript or null if not found
 */
export function getTranscript(sessionId: string): ConversationTranscript | null {
  return transcriptStore.get(sessionId);
}

/**
 * Append an entry to a transcript.
 * Creates the transcript if it doesn't exist.
 * @param sessionId - Session ID
 * @param role - Entry role (SYSTEM, USER, ASSISTANT, etc.)
 * @param phase - Conversation phase (bootstrap, refine, handoff)
 * @param content - Entry content
 */
export function appendTranscriptEntry(
  sessionId: string,
  role: TranscriptRole,
  phase: TranscriptPhase,
  content: string
): void {
  const entry: TranscriptEntry = {
    timestamp: new Date().toISOString(),
    phase,
    role,
    content,
  };
  transcriptStore.appendEntry(sessionId, entry);
}

/**
 * Delete a transcript.
 * @param sessionId - Session ID to delete
 * @returns true if deleted, false if not found
 */
export function deleteTranscript(sessionId: string): boolean {
  return transcriptStore.delete(sessionId);
}

/**
 * Start the transcript cleanup interval.
 * @param intervalMinutes - Cleanup interval in minutes
 */
export function startTranscriptCleanupInterval(intervalMinutes: number = 5): void {
  transcriptStore.startCleanupInterval(intervalMinutes);
}

/**
 * Stop the transcript cleanup interval.
 */
export function stopTranscriptCleanupInterval(): void {
  transcriptStore.stopCleanupInterval();
}

/**
 * Get transcript count (for monitoring).
 */
export function getTranscriptCount(): number {
  return transcriptStore.getTranscriptCount();
}

/**
 * Clear all transcripts (for testing).
 */
export function clearAllTranscripts(): void {
  transcriptStore.clear();
}

/**
 * Run cleanup manually.
 */
export function runTranscriptCleanup(): number {
  return transcriptStore.cleanup();
}

// ============================================================================
// Split Plan Helper Functions
// Spec 2026-02-06: Implement-Part Sequencing Workflow
// ============================================================================

/**
 * Update or set the split plan for a session.
 *
 * @param sessionId - Session ID
 * @param splitPlan - The split plan state to store
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 */
export function updateSplitPlan(sessionId: string, splitPlan: SplitPlan): void {
  transcriptStore.updateSplitPlan(sessionId, splitPlan);
}

/**
 * Get the split plan for a session.
 *
 * @param sessionId - Session ID
 * @returns The split plan or null if not found/not set
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 */
export function getSplitPlan(sessionId: string): SplitPlan | null {
  return transcriptStore.getSplitPlan(sessionId);
}

/**
 * Update the status of a specific part.
 *
 * @param sessionId - Session ID
 * @param partIndex - The 1-based part index
 * @param status - The new status to set
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 */
export function updatePartStatus(sessionId: string, partIndex: number, status: PartStatus): void {
  transcriptStore.updatePartStatus(sessionId, partIndex, status);
}

/**
 * Update the job ID for a specific part.
 *
 * @param sessionId - Session ID
 * @param partIndex - The 1-based part index
 * @param jobId - The job ID to set
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 */
export function updatePartJobId(sessionId: string, partIndex: number, jobId: string): void {
  transcriptStore.updatePartJobId(sessionId, partIndex, jobId);
}

/**
 * Update timestamps for a specific part.
 *
 * @param sessionId - Session ID
 * @param partIndex - The 1-based part index
 * @param field - The timestamp field to update ('startedAt' or 'completedAt')
 * @param timestamp - The ISO-8601 timestamp value
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 */
export function updatePartTimestamp(
  sessionId: string,
  partIndex: number,
  field: 'startedAt' | 'completedAt',
  timestamp: string
): void {
  transcriptStore.updatePartTimestamp(sessionId, partIndex, field, timestamp);
}

/**
 * Append an entry to a specific part's transcript.
 *
 * @param sessionId - Session ID
 * @param partIndex - The 1-based part index
 * @param entry - The transcript entry to append
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 */
export function appendPartTranscriptEntry(
  sessionId: string,
  partIndex: number,
  entry: TranscriptEntry
): void {
  transcriptStore.appendPartTranscriptEntry(sessionId, partIndex, entry);
}

// Export the store instance for direct access if needed
export { transcriptStore };
