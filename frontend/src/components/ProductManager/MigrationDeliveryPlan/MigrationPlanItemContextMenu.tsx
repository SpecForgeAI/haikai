/**
 * MigrationPlanItemContextMenu (2026-09-11, start-from-work-item).
 *
 * Right-click menu on a plan-tree row. Offers the Stage-card actions for ONE
 * work item (initiative / epic / feature / story): start its not-yet-
 * implemented specs (implement + MR only, or implement + deploy), or resume a
 * halted run from its first failed spec. Every entry is greyed with the
 * server-computed reason when the item is not the NEXT one in plan order —
 * the gateway enforces the same rule on the start route, so the greying is a
 * courtesy, not the guard.
 */

import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import type { PlanOrderNodeDto } from '../../../api/migrationDeliveryDashboardApi';
import styles from './MigrationBookOfWork.module.css';

export interface MigrationPlanItemContextMenuProps {
  x: number;
  y: number;
  /** The right-clicked item's title (menu header). */
  title: string;
  /** The item's eligibility from the plan-order frontier; null while loading / unknown. */
  node: PlanOrderNodeDto | null;
  frontierLoaded: boolean;
  /** The book's latest run status (resume needs a halted run). */
  runStatus: string | null;
  busy: boolean;
  onClose: () => void;
  onStart: (completion: 'implement_mr' | 'deploy') => void;
  onResumeFailed: (salvage: boolean) => void;
}

export const MigrationPlanItemContextMenu: React.FC<MigrationPlanItemContextMenuProps> = ({
  x,
  y,
  title,
  node,
  frontierLoaded,
  runStatus,
  busy,
  onClose,
  onStart,
  onResumeFailed,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('contextmenu', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('contextmenu', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  const startable = !!node?.startable && !busy;
  const startReason = !frontierLoaded
    ? 'Loading plan order…'
    : !node
      ? 'No plan-order entry for this item.'
      : node.startable
        ? node.reasonText
        : node.reasonText;
  // Resume applies to a HALTED run with a failed spec beneath this item.
  const resumable = runStatus === 'halted' && (node?.failedCount ?? 0) > 0 && !busy;
  const resumeReason =
    runStatus !== 'halted'
      ? 'Resume needs a halted run.'
      : (node?.failedCount ?? 0) === 0
        ? 'No failed spec beneath this item.'
        : `Continues the halted run from its first failed spec (${node?.failedCount} failed here).`;

  const remaining = node ? node.leafCount - node.doneCount : 0;
  const summary = node
    ? node.leafCount === 0
      ? 'no implementable specs'
      : `${node.doneCount}/${node.leafCount} implemented` +
        (remaining > 0 ? `, ${remaining} to run` : '')
    : '';

  // Keep the menu on-screen.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.max(4, Math.min(x, vw - 340));
  const top = Math.max(4, Math.min(y, vh - 260));

  const entry = (
    testId: string,
    label: string,
    enabled: boolean,
    hint: string,
    onClick: () => void,
  ) => (
    <button
      type="button"
      role="menuitem"
      className={`${styles.itemMenuEntry} ${enabled ? '' : styles.itemMenuEntryDisabled}`}
      disabled={!enabled}
      aria-disabled={!enabled}
      title={hint}
      data-testid={testId}
      onClick={() => {
        if (enabled) onClick();
      }}
    >
      <span className={styles.itemMenuEntryLabel}>{label}</span>
      <span className={styles.itemMenuEntryHint}>{hint}</span>
    </button>
  );

  const menu = (
    <div
      ref={ref}
      className={styles.itemMenu}
      style={{ left, top }}
      role="menu"
      aria-label={`Actions for ${title}`}
      data-testid="plan-item-context-menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className={styles.itemMenuHeader} data-testid="plan-item-context-menu-header">
        <div className={styles.itemMenuTitle} title={title}>
          {title}
        </div>
        {summary && <div className={styles.itemMenuSummary}>{summary}</div>}
      </div>
      {entry(
        'plan-item-menu-start',
        '▶ Start (implement + MR)',
        startable,
        startReason,
        () => onStart('implement_mr'),
      )}
      {entry(
        'plan-item-menu-start-deploy',
        '▶ Start and deploy',
        startable,
        startable ? `${startReason} The final spec deploys and the plane reconciles.` : startReason,
        () => onStart('deploy'),
      )}
      {entry(
        'plan-item-menu-resume',
        '▶ Resume from first failed',
        resumable,
        resumeReason,
        () => onResumeFailed(false),
      )}
      {entry(
        'plan-item-menu-resume-salvage',
        '▶ Resume (salvage last spec)',
        resumable,
        resumable
          ? 'Commits + pushes the failed spec’s worktree as implemented, then resumes from the next.'
          : resumeReason,
        () => onResumeFailed(true),
      )}
    </div>
  );

  return ReactDOM.createPortal(menu, document.body);
};

export default MigrationPlanItemContextMenu;
