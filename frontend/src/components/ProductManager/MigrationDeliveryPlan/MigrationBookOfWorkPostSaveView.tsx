/**
 * MigrationBookOfWorkPostSaveView
 *
 * Spec 2026-05-17 PM Migration Delivery Plan -- Task Group 12.
 *
 * Displays the post-save outcome after the AMS save-to-backlog call
 * returns: created counts (initiatives / epics / features / stories) +
 * any per-item failure callouts (with `error_message` from AMS) +
 * a navigation link to the backlog / roadmap views. Saved items in the
 * tree are marked separately (the parent updates `saveStateById` from
 * the response payload).
 */

import React from 'react';
import type {
  MigrationBookOfWorkItem,
  SaveToBacklogResponse,
} from '../../../api/migrationBookOfWorkApi';
import styles from './MigrationBookOfWork.module.css';

export interface MigrationBookOfWorkPostSaveViewProps {
  response: SaveToBacklogResponse;
  /** Optional callback to navigate to the backlog / roadmap view. */
  onOpenBacklog?: () => void;
}

function tallyByType(
  items: MigrationBookOfWorkItem[],
): { initiative: number; epic: number; feature: number; story: number } {
  const out = { initiative: 0, epic: 0, feature: 0, story: 0 };
  for (const i of items) {
    if (i.saveState === 'saved') {
      out[i.type] = (out[i.type] ?? 0) + 1;
    }
  }
  return out;
}

export const MigrationBookOfWorkPostSaveView: React.FC<
  MigrationBookOfWorkPostSaveViewProps
> = ({ response, onOpenBacklog }) => {
  const items = response.bookOfWork?.items ?? [];
  const tally = tallyByType(items);
  const failed = items.filter((i) => i.saveState === 'failed');

  return (
    <div data-testid="post-save-view">
      <div className={styles.postSaveBanner}>
        <strong>Save complete.</strong> Status:{' '}
        <code>{response.status}</code>. Saved {response.savedCount} item
        {response.savedCount === 1 ? '' : 's'}
        {response.failedCount > 0 && `, ${response.failedCount} failed`}
        {response.skippedCount > 0 &&
          `, ${response.skippedCount} skipped (already saved)`}
        .
      </div>

      <div className={styles.postSaveBanner} data-testid="post-save-counts">
        Created: {tally.initiative} initiative
        {tally.initiative === 1 ? '' : 's'}, {tally.epic} epic
        {tally.epic === 1 ? '' : 's'}, {tally.feature} feature
        {tally.feature === 1 ? '' : 's'}, {tally.story} stor
        {tally.story === 1 ? 'y' : 'ies'}.
        {onOpenBacklog && (
          <>
            {' '}
            <span
              className={styles.postSaveLink}
              role="link"
              tabIndex={0}
              onClick={onOpenBacklog}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenBacklog();
                }
              }}
              data-testid="post-save-open-backlog"
            >
              Open backlog / roadmap
            </span>
          </>
        )}
      </div>

      {failed.length > 0 && (
        <div
          className={styles.postSaveFailures}
          data-testid="post-save-failures"
        >
          <strong>Failed items:</strong>
          <ul className={styles.bulletList}>
            {failed.map((f) => (
              <li key={f.id} data-testid={`post-save-failure-${f.id}`}>
                <strong>{f.title}</strong>
                {f.errorMessage ? `: ${f.errorMessage}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default MigrationBookOfWorkPostSaveView;
