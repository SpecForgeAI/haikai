/**
 * MigrationDeliveryActiveBatchBanner
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 7.3
 *
 * Renders a "Batch in progress (pass N of 2)" banner at the top of the
 * dashboard whenever the gateway concurrency lock is held. The lock
 * signal is communicated to the frontend via the structured 409 envelope
 * the gateway emits on a second concurrent batch attempt
 * (`WorkstreamLockedError`, Task Group 5.7).
 *
 * The banner stays presentational; the dashboard owns whether to render
 * it (e.g. after a 409 was seen, OR while a Generate-all dialog submit is
 * in flight and the dashboard knows about it).
 */

import React from 'react';
import styles from './MigrationDeliveryDashboard.module.css';

export interface MigrationDeliveryActiveBatchBannerProps {
  /** 1 or 2 -- the pass the lock is currently holding. */
  activePass: number;
  /** Optional workstream id for diagnostics. */
  workstreamId?: string;
}

export const MigrationDeliveryActiveBatchBanner: React.FC<
  MigrationDeliveryActiveBatchBannerProps
> = ({ activePass, workstreamId }) => {
  return (
    <div
      className={styles.batchInProgressBanner}
      role="status"
      data-testid="mdd-active-batch-banner"
    >
      <span data-testid="mdd-active-batch-banner-text">
        {`Batch in progress (pass ${activePass} of 2)`}
        {workstreamId ? ` -- workstream ${workstreamId}` : ''}
      </span>
    </div>
  );
};

export default MigrationDeliveryActiveBatchBanner;
