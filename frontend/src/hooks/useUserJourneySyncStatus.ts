/**
 * useUserJourneySyncStatus.ts
 *
 * Spec: User Journey One-Way Sync from Meta-Model
 * Task Group 4: Sync Status Banner and Auto-Check
 *
 * Custom hook for automatic sync status checking when viewing saved
 * USER_JOURNEY v2 diagrams. Auto-checks on mount and diagramId change.
 * Returns sync status, loading state, and a refresh callback.
 *
 * Skips API call for v1 diagrams (no sync block) by returning null status.
 */

import { useState, useEffect, useCallback } from 'react';
import type { TypedContentEnvelope, UserJourneyContent } from '../types/typedContent';
import {
  fetchUserJourneySyncStatus,
  refreshUserJourneyFromModel,
} from '../api/userJourneyDiagramApi';
import type { Diagram } from '../types/model';

export interface UseUserJourneySyncStatusResult {
  /** Current sync status or null for v1/non-UJ diagrams */
  syncStatus: 'IN_SYNC' | 'STALE' | 'BROKEN_SOURCE' | 'UNLINKED' | 'LOADING' | 'ERROR' | null;
  /** Reason for staleness */
  staleReason: string | null;
  /** Whether a sync check or refresh is in progress */
  isLoading: boolean;
  /** Error from the last operation */
  error: string | null;
  /** Trigger a refresh from model, returns the updated diagram if successful */
  refresh: () => Promise<Diagram | null>;
}

/**
 * Determines whether a diagram's typedContent represents a v2 USER_JOURNEY
 * with sync metadata.
 */
function isV2UserJourney(typedContent: TypedContentEnvelope | undefined | null): boolean {
  if (!typedContent) return false;
  if (typedContent.type !== 'USER_JOURNEY') return false;
  if (typedContent.version < 2) return false;

  const content = typedContent.content as UserJourneyContent | undefined;
  if (!content) return false;

  // v2 diagrams have a sync block in the content
  return content.sync !== undefined && content.sync !== null;
}

/**
 * Custom hook for managing USER_JOURNEY diagram sync status.
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
 *   architectureId is now required for the underlying Bucket A endpoints.
 *   The hook returns null/no-op when architectureId is undefined, matching the
 *   existing "wait for projectId" behaviour.
 *
 * @param projectId - The project UUID
 * @param architectureId - The architecture UUID -- REQUIRED, no fallback
 * @param diagramId - The diagram ID (or null/undefined if no diagram selected)
 * @param typedContent - The diagram's typedContent envelope
 * @returns Sync status state and refresh callback
 */
export function useUserJourneySyncStatus(
  projectId: string | undefined,
  architectureId: string | undefined,
  diagramId: string | undefined,
  typedContent: TypedContentEnvelope | undefined | null
): UseUserJourneySyncStatusResult {
  const [syncStatus, setSyncStatus] = useState<UseUserJourneySyncStatusResult['syncStatus']>(null);
  const [staleReason, setStaleReason] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-check sync status on mount and when diagramId changes
  useEffect(() => {
    if (!projectId || !architectureId || !diagramId || !isV2UserJourney(typedContent)) {
      setSyncStatus(null);
      setStaleReason(null);
      setError(null);
      return;
    }

    let cancelled = false;

    async function checkStatus() {
      setIsLoading(true);
      setSyncStatus('LOADING');
      setError(null);

      try {
        const response = await fetchUserJourneySyncStatus(projectId!, architectureId!, diagramId!);

        if (!cancelled) {
          setSyncStatus(response.sync_status as UseUserJourneySyncStatusResult['syncStatus']);
          setStaleReason(response.stale_reason);
        }
      } catch (err) {
        if (!cancelled) {
          setSyncStatus('ERROR');
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    checkStatus();

    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId, diagramId, typedContent]);

  // Refresh callback
  const refresh = useCallback(async (): Promise<Diagram | null> => {
    if (!projectId || !architectureId || !diagramId) return null;

    setIsLoading(true);
    setError(null);

    try {
      const updatedDiagram = await refreshUserJourneyFromModel(projectId, architectureId, diagramId);
      setSyncStatus('IN_SYNC');
      setStaleReason(null);
      return updatedDiagram;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [projectId, architectureId, diagramId]);

  return {
    syncStatus,
    staleReason,
    isLoading,
    error,
    refresh,
  };
}
