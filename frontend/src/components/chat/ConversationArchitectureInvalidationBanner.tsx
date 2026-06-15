/**
 * ConversationArchitectureInvalidationBanner
 *
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 9
 *
 * Warning banner mounted in the chat panel for `bound-by-system-prompt` and
 * `derived-from-context` mode tasks. Compares the conversation's bound
 * `architectureId` (from `Thread.metadata.boundArchitectureId`, threaded in
 * via the `boundArchitectureId` prop by the chat panel) against
 * `useActiveArchitectureId()` (the URL-active architecture). When they
 * diverge -- because the user switched architecture mid-conversation via
 * spec #2's selector -- the banner renders so the user understands their
 * save inputs are blocked and how to recover.
 *
 * Returns null when the active architecture matches the bound architecture
 * (no divergence, no banner). The chat panel (Group 10) keeps the component
 * mounted unconditionally; the banner self-suppresses based on context.
 *
 * Two recovery actions are offered:
 *   - "Swap back to <bound-name>" -- calls
 *     `useArchitectureContext().setActiveArchitecture(boundArchitectureId)`,
 *     which (per spec #2 Group 2) navigates to the canonical URL with
 *     `:architectureId` substituted in. The URL change propagates back through
 *     `useActiveArchitectureId()` and the banner self-unmounts on the next
 *     render.
 *   - "Abandon conversation" -- calls the parent-supplied `onAbandon` callback.
 *     The chat panel decides what abandon means (typically clearing thread
 *     state or routing away) -- the banner just signals the intent.
 *
 * Visual language: warning colour variant of the architecture pill styling
 * from `frontend/src/components/TopBar/ArchitectureSelector.module.css`. The
 * bound + active architecture names are rendered as inline strong elements
 * so they read as the load-bearing tokens in the message.
 */

import { useCallback } from 'react';
import {
  useActiveArchitectureId,
  useArchitectureContext,
} from '../../contexts/ArchitectureContext';
import styles from './ConversationArchitectureInvalidationBanner.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ConversationArchitectureInvalidationBannerProps {
  /**
   * The architecture id the conversation is bound to. Sourced from
   * `Thread.metadata.boundArchitectureId` and threaded in by the chat panel
   * (Group 10 wiring). Required -- callers should not mount the banner for
   * threads that are not bound (e.g. clarify-at-save tasks or pre-spec
   * legacy threads).
   */
  boundArchitectureId: string;
  /**
   * The human-readable name of the bound architecture, sourced from
   * `Thread.metadata.boundArchitectureName`. Surfaced in the banner copy
   * and the swap-back button label so the user immediately recognises
   * which architecture the conversation belongs to.
   */
  boundArchitectureName: string;
  /**
   * Called when the user clicks "Abandon conversation". The chat panel
   * decides what abandon means (typically clearing thread state). The
   * banner does not assume any specific cleanup behaviour -- it just
   * signals the user's intent.
   */
  onAbandon: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConversationArchitectureInvalidationBanner({
  boundArchitectureId,
  boundArchitectureName,
  onAbandon,
}: ConversationArchitectureInvalidationBannerProps) {
  const activeArchitectureId = useActiveArchitectureId();
  const { architectures, setActiveArchitecture } = useArchitectureContext();

  const handleSwapBack = useCallback(() => {
    setActiveArchitecture(boundArchitectureId);
  }, [setActiveArchitecture, boundArchitectureId]);

  // Self-suppress when the active architecture matches the bound architecture.
  // The chat panel (Group 10) mounts this banner unconditionally for
  // bound/derived modes; this guard handles the no-divergence case so the
  // panel does not need to duplicate the comparison logic.
  if (activeArchitectureId === boundArchitectureId) {
    return null;
  }

  // Resolve the active architecture's display name so the banner's copy
  // includes both names. Falls back to the id if the architectures list does
  // not include the active id (e.g. a stale URL pointing at a now-deleted
  // architecture, or the list still loading).
  const activeArchitecture = architectures.find(
    (a) => a.id === activeArchitectureId
  );
  const activeArchitectureName =
    activeArchitecture?.name ?? activeArchitectureId ?? 'unknown';

  return (
    <div
      className={styles.banner}
      role="alert"
      data-testid="conv-arch-invalidation-banner"
    >
      <div
        className={styles.message}
        data-testid="conv-arch-invalidation-banner-message"
      >
        This conversation is bound to architecture{' '}
        <strong className={styles.archName}>{boundArchitectureName}</strong>{' '}
        but you&apos;re currently viewing{' '}
        <strong className={styles.archName}>{activeArchitectureName}</strong>.
        Switch back to continue, or abandon this conversation.
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={handleSwapBack}
          data-testid="conv-arch-invalidation-banner-swap-back"
        >
          Swap back to {boundArchitectureName}
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onAbandon}
          data-testid="conv-arch-invalidation-banner-abandon"
        >
          Abandon conversation
        </button>
      </div>
    </div>
  );
}

export default ConversationArchitectureInvalidationBanner;
