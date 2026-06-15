/**
 * CapturedDecisionChip
 *
 * Spec: 2026-05-26 Compare View Decoration with Decision Codes -- Task Group 2.
 *
 * Read-only chip surfacing a captured architect decision in the Compare View.
 * Click toggles a small floating popover showing:
 *
 *   - `answerSummary` (bold, top).
 *   - `answerValue` (full body).
 *   - `standardsLookupRef` (small link/badge if non-null).
 *   - "View in conversation" button (only when `conversationThreadId !== null`)
 *     that fires the `onOpenInConversation(decision.decisionId)` callback.
 *
 * Popover dismissal (Q8 - all three): click-outside + ESC + click-chip-again.
 *
 * Defense-in-depth: renders nothing if `decision.supersededById !== null`.
 * The caller (workspace) is the primary filter; the chip is belt-and-braces.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CapturedDecisionDto } from '../../api/architectConversationApi';
import styles from './TargetArchitectureWorkspace.module.css';

export interface CapturedDecisionChipProps {
  decision: CapturedDecisionDto;
  onOpenInConversation?: (decisionId: string) => void;
}

export function CapturedDecisionChip({
  decision,
  onOpenInConversation,
}: CapturedDecisionChipProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  // Toggle popover open/close on chip click. Handles the click-chip-again
  // dismissal case naturally.
  const toggleOpen = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  // Click-outside + ESC dismissal. Effect mounts the listeners only while
  // the popover is open, so we add zero global handlers in the resting state.
  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      if (event.target instanceof Node && wrapper.contains(event.target)) {
        // Click was inside the chip or popover -- do not dismiss.
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Defense-in-depth: caller filters superseded rows; render nothing if
  // somehow one slips through (Q11 test 3).
  if (decision.supersededById !== null) {
    return null;
  }

  const hasConversationLink = decision.conversationThreadId !== null;

  return (
    <span
      ref={wrapperRef}
      className={styles.capturedDecisionChipWrapper}
      data-testid={`captured-decision-chip-wrapper-${decision.decisionId}`}
    >
      <button
        type="button"
        className={styles.capturedDecisionChip}
        onClick={toggleOpen}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid={`captured-decision-chip-${decision.decisionId}`}
        title={decision.decisionCode}
      >
        {decision.decisionCode}
      </button>
      {open && (
        <div
          className={styles.capturedDecisionPopover}
          role="dialog"
          aria-label={`Decision ${decision.decisionCode}`}
          data-testid={`captured-decision-popover-${decision.decisionId}`}
        >
          {decision.answerSummary && (
            <div
              className={styles.capturedDecisionPopoverSummary}
              data-testid={`captured-decision-popover-summary-${decision.decisionId}`}
            >
              {decision.answerSummary}
            </div>
          )}
          <div
            className={styles.capturedDecisionPopoverValue}
            data-testid={`captured-decision-popover-value-${decision.decisionId}`}
          >
            {decision.answerValue}
          </div>
          {decision.standardsLookupRef && (
            <div
              className={styles.capturedDecisionPopoverStandards}
              data-testid={`captured-decision-popover-standards-${decision.decisionId}`}
            >
              {decision.standardsLookupRef}
            </div>
          )}
          {hasConversationLink && onOpenInConversation && (
            <button
              type="button"
              className={styles.capturedDecisionPopoverLink}
              onClick={() => {
                onOpenInConversation(decision.decisionId);
                close();
              }}
              data-testid={`captured-decision-popover-open-in-conversation-${decision.decisionId}`}
            >
              View in conversation
            </button>
          )}
        </div>
      )}
    </span>
  );
}

export default CapturedDecisionChip;
