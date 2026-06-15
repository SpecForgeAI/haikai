/**
 * MigrationDeliveryWorkstreamProgressStrip
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * Task Group 8 -- Dashboard shell + summary cards + workstream progress.
 *
 * Spec references: AC 6 (workstream progress section rolls up by workstream).
 *
 * Renders one row per workstream summary from `dashboard.workstreamSummaries`.
 * Columns:
 *   - Workstream label
 *   - Total stories
 *   - Saved to backlog
 *   - Specs generated
 *   - Implementation active
 *   - Evidence covered
 *   - Needs attention
 *
 * Wire-shape note: input DTO is mapped to camelCase at the API client boundary
 * (`migrationDeliveryDashboardApi.ts`, follow-up #10); this component reads
 * idiomatic camelCase fields throughout.
 */

import React from 'react';
import type { MigrationDeliveryWorkstreamSummaryDto } from '../../../api/migrationDeliveryDashboardApi';
import styles from './MigrationDeliveryDashboard.module.css';

export interface MigrationDeliveryWorkstreamProgressStripProps {
  workstreamSummaries: MigrationDeliveryWorkstreamSummaryDto[];
}

export const MigrationDeliveryWorkstreamProgressStrip: React.FC<
  MigrationDeliveryWorkstreamProgressStripProps
> = ({ workstreamSummaries }) => {
  return (
    <section
      className={styles.workstreamSection}
      data-testid="mdd-workstream-strip"
      aria-label="Workstream progress"
    >
      <h2 className={styles.sectionTitle}>Workstream progress</h2>
      {workstreamSummaries.length === 0 ? (
        <div
          className={styles.placeholder}
          data-testid="mdd-workstream-strip-empty"
        >
          No workstreams to display.
        </div>
      ) : (
        <div
          className={styles.workstreamTable}
          role="table"
          data-testid="mdd-workstream-table"
        >
          <div className={styles.workstreamRow} role="row">
            <div
              className={styles.workstreamHeaderCell}
              role="columnheader"
              data-testid="mdd-workstream-col-name"
            >
              Workstream
            </div>
            <div
              className={styles.workstreamHeaderCell}
              role="columnheader"
              data-testid="mdd-workstream-col-total"
            >
              Stories
            </div>
            <div
              className={styles.workstreamHeaderCell}
              role="columnheader"
              data-testid="mdd-workstream-col-saved"
            >
              Saved
            </div>
            <div
              className={styles.workstreamHeaderCell}
              role="columnheader"
              data-testid="mdd-workstream-col-specs"
            >
              Specs
            </div>
            <div
              className={styles.workstreamHeaderCell}
              role="columnheader"
              data-testid="mdd-workstream-col-impl"
            >
              Impl active
            </div>
            <div
              className={styles.workstreamHeaderCell}
              role="columnheader"
              data-testid="mdd-workstream-col-evidence"
            >
              Evidence
            </div>
            <div
              className={styles.workstreamHeaderCell}
              role="columnheader"
              data-testid="mdd-workstream-col-attention"
            >
              Needs attention
            </div>
          </div>
          {workstreamSummaries.map((ws) => (
            <div
              key={ws.workstream}
              className={styles.workstreamRow}
              role="row"
              data-testid={`mdd-workstream-row-${ws.workstream}`}
            >
              <div
                className={`${styles.workstreamCell} ${styles.workstreamLabel}`}
                role="cell"
                data-testid={`mdd-workstream-row-${ws.workstream}-name`}
              >
                {ws.workstream}
              </div>
              <div
                className={styles.workstreamCell}
                role="cell"
                data-testid={`mdd-workstream-row-${ws.workstream}-total`}
              >
                {ws.totalStoryCount}
              </div>
              <div
                className={styles.workstreamCell}
                role="cell"
                data-testid={`mdd-workstream-row-${ws.workstream}-saved`}
              >
                {ws.savedToBacklogCount}
              </div>
              <div
                className={styles.workstreamCell}
                role="cell"
                data-testid={`mdd-workstream-row-${ws.workstream}-specs`}
              >
                {ws.specGeneratedCount}
              </div>
              <div
                className={styles.workstreamCell}
                role="cell"
                data-testid={`mdd-workstream-row-${ws.workstream}-impl`}
              >
                {ws.implementationActiveCount}
              </div>
              <div
                className={styles.workstreamCell}
                role="cell"
                data-testid={`mdd-workstream-row-${ws.workstream}-evidence`}
              >
                {ws.evidenceCoveredCount}
              </div>
              <div
                className={styles.workstreamCell}
                role="cell"
                data-testid={`mdd-workstream-row-${ws.workstream}-attention`}
              >
                {ws.needsAttentionCount}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default MigrationDeliveryWorkstreamProgressStrip;
