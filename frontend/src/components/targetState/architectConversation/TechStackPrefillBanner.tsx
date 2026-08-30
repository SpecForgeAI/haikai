/**
 * TechStackPrefillBanner
 *
 * Spec: 2026-05-25 Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write
 *       (Task Group 5)
 *
 * Top-of-transcript banner that surfaces the open-turn pre-fill outcome for
 * the Architect Conversation. Reads the `tech-stack-prefill-summary` turn
 * payload (Task Group 3 / gateway-side `TechStackPrefillSummaryTurn`) and
 * renders one of five variants:
 *
 *   - both-files-matched         X of 51 pre-filled from your tech standards
 *                                (organisation: <orgFile>, project: <projFile>)
 *   - organisation-only-matched  X of 51 pre-filled from your organisation tech standards
 *   - project-only-matched       X of 51 pre-filled from your project tech standards
 *   - no-standards-found         No tech standards found - all questions will be asked manually
 *   - failure                    Tech standards loaded but pre-fill could not run -
 *                                all questions will be asked manually
 *
 * Source-quote text MUST NOT appear here -- the spec's isolation rule (Q22)
 * keeps source quotes off the main transcript surface. The SummaryPanel review
 * pane is the only place a user sees per-row source quotes.
 *
 * The denominator is hardcoded to the static library entry count (51, per Q12)
 * but the turn payload also carries a `denominator` field so the rendered copy
 * stays in lock-step with whatever the gateway sends.
 */

import type { TechStackPrefillSummaryTurn } from '../../../api/architectConversationApi';
import styles from './ArchitectConversation.module.css';

export interface TechStackPrefillBannerProps {
  turn: TechStackPrefillSummaryTurn;
  /**
   * Called when the user clicks the "Review" link. The parent ties this to a
   * scroll / focus on the SummaryPanel so the user can audit the pre-filled
   * decisions and their source quotes.
   */
  onReviewClick?: () => void;
}

/** Extract just the trailing filename from an absolute path for display. */
function shortenPath(absolutePath: string | null): string {
  if (!absolutePath) return '';
  const normalised = absolutePath.replace(/\\/g, '/');
  const lastSlash = normalised.lastIndexOf('/');
  return lastSlash === -1 ? normalised : normalised.slice(lastSlash + 1);
}

export function TechStackPrefillBanner({
  turn,
  onReviewClick,
}: TechStackPrefillBannerProps) {
  const {
    bannerVariant,
    matchedCount,
    denominator,
    orgFilePath,
    projectFilePath,
  } = turn;

  let copy: React.ReactNode;
  let toneClass = '';

  switch (bannerVariant) {
    case 'both-files-matched': {
      const orgName = shortenPath(orgFilePath) || 'tech-stack.md';
      const projName = shortenPath(projectFilePath) || 'tech-stack.md';
      copy = (
        <>
          <strong>
            {matchedCount} of {denominator}
          </strong>{' '}
          questions pre-filled from your tech standards (organisation:{' '}
          <code>{orgName}</code>, project: <code>{projName}</code>).
        </>
      );
      break;
    }
    case 'organisation-only-matched':
      copy = (
        <>
          <strong>
            {matchedCount} of {denominator}
          </strong>{' '}
          questions pre-filled from your organisation tech standards.
        </>
      );
      break;
    case 'project-only-matched':
      copy = (
        <>
          <strong>
            {matchedCount} of {denominator}
          </strong>{' '}
          questions pre-filled from your project tech standards.
        </>
      );
      break;
    case 'no-standards-found':
      copy = (
        <>No tech standards found &mdash; all questions will be asked manually.</>
      );
      break;
    case 'failure':
      toneClass = styles.bannerError;
      copy = (
        <>
          Tech standards loaded but pre-fill could not run &mdash; all questions
          will be asked manually.
        </>
      );
      break;
    default: {
      // Exhaustiveness guard — TS will flag if a future spec extends the
      // variant union without updating this switch.
      const _exhaustive: never = bannerVariant;
      void _exhaustive;
      return null;
    }
  }

  const showReview =
    onReviewClick &&
    bannerVariant !== 'no-standards-found' &&
    bannerVariant !== 'failure' &&
    matchedCount > 0;

  return (
    // 2026-08-30 declutter: rendered as a SLIM one-line strip — same copy,
    // tone and Review action, without dominating the top of the panel.
    <div
      className={`${styles.banner} ${styles.bannerSlim} ${toneClass}`}
      role="status"
      data-testid="architect-conversation-tech-stack-prefill-banner"
      data-banner-variant={bannerVariant}
    >
      <span>{copy}</span>
      {showReview && (
        <button
          type="button"
          className={styles.linkButton}
          onClick={onReviewClick}
          data-testid="architect-conversation-tech-stack-prefill-review"
        >
          Review
        </button>
      )}
    </div>
  );
}
