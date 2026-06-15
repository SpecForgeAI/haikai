/**
 * MigrationDeliverySummaryCards
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * Task Group 8 -- Dashboard shell + summary cards + workstream progress.
 *
 * Spec references: AC 3 (summary cards show backlog-save, spec-generation,
 * implementation, and evidence counts).
 *
 * Renders 5 summary cards across the top of the dashboard:
 *   1. Backlog saved             -- from `dashboard.backlogSaveSummary`
 *   2. Shape-specs generated     -- from `dashboard.specGenerationSummary`
 *   3. Specs needing attention   -- from `dashboard.summary.needsAttentionCount`
 *   4. Implementation active     -- from `dashboard.implementationSummary`
 *   5. Evidence coverage         -- from `dashboard.evidenceSummary`
 *
 * Visual treatment intentionally mirrors `MigrationDeliveryPlanProgressSummary`
 * count-badge layout. The card values are pre-computed by this component; the
 * parent dashboard only passes the four sibling summary DTOs verbatim.
 *
 * Wire-shape note: input DTOs are mapped to camelCase at the API client
 * boundary (`migrationDeliveryDashboardApi.ts`, follow-up #10). Earlier
 * revisions leaked the snake_case wire shape into the UI; the boundary
 * mapper now keeps all UI code idiomatic camelCase.
 */

import React from 'react';
import type {
  MigrationDeliverySummaryDto,
  MigrationDeliverySpecGenerationSummaryDto,
  MigrationDeliveryBacklogSaveSummaryDto,
  MigrationDeliveryImplementationSummaryDto,
  MigrationDeliveryEvidenceSummaryDto,
} from '../../../api/migrationDeliveryDashboardApi';
import type { FindingsCoverageResult } from '../../../utils/findingsCoverage';
import styles from './MigrationDeliveryDashboard.module.css';

export interface MigrationDeliverySummaryCardsProps {
  summary: MigrationDeliverySummaryDto;
  specGenerationSummary: MigrationDeliverySpecGenerationSummaryDto;
  backlogSaveSummary: MigrationDeliveryBacklogSaveSummaryDto;
  implementationSummary: MigrationDeliveryImplementationSummaryDto;
  evidenceSummary: MigrationDeliveryEvidenceSummaryDto;
  /**
   * Deterministic findings coverage computed on read from the draft's
   * create-time snapshot (Spec 2026-06-11, Task Group 4.5). `null` /
   * absent (legacy draft, fail-softed snapshot, or draft fetch failure)
   * omits the "Findings addressed" line entirely (D8 -- hide, don't
   * approximate; no knowingly-broken number left behind).
   */
  findingsCoverage?: FindingsCoverageResult | null;
}

export const MigrationDeliverySummaryCards: React.FC<
  MigrationDeliverySummaryCardsProps
> = ({
  summary,
  specGenerationSummary,
  backlogSaveSummary,
  implementationSummary,
  evidenceSummary,
  findingsCoverage = null,
}) => {
  const totalStories = summary.totalStoryCount;
  const savedCount = backlogSaveSummary.savedCount;
  const notSavedCount = backlogSaveSummary.notSavedToBacklogCount;

  const generatedCount = specGenerationSummary.generatedCount;
  const generatedWithWarningsCount =
    specGenerationSummary.generatedWithWarningsCount;
  const insufficientCount = specGenerationSummary.insufficientContextCount;
  const failedCount = specGenerationSummary.failedCount;
  const blockedCount = specGenerationSummary.skippedBlockedCount;
  const notAttemptedCount = specGenerationSummary.notAttemptedCount;

  const needsAttention = summary.needsAttentionCount;

  const implActive = implementationSummary.activeCount;
  const implInProgress = implementationSummary.inProgressCount;
  const implCompleted = implementationSummary.completedCount;
  const implBlocked = implementationSummary.blockedCount;

  const evidenceAnyCoverage = evidenceSummary.anyCoverageCount;
  const evidenceReferences = evidenceSummary.evidenceReferenceCount;
  const findingsRefs = evidenceSummary.discoveryFindingReferenceCount;
  const baselineRefs = evidenceSummary.apiBaselineReferenceCount;
  const mappingRefs = evidenceSummary.mappingReferenceCount;
  const architectureRefs = evidenceSummary.architectureReferenceCount;

  return (
    <section
      className={styles.summaryRow}
      data-testid="mdd-summary-cards"
      aria-label="Migration Delivery Dashboard summary"
    >
      {/* Card 1: Backlog saved */}
      <div
        className={styles.summaryCard}
        data-testid="mdd-summary-card-backlog"
      >
        <h3 className={styles.summaryCardTitle}>Backlog saved</h3>
        <span
          className={styles.summaryCardValue}
          data-testid="mdd-summary-card-backlog-value"
        >
          {savedCount}
          <span style={{ fontSize: 14, color: '#607d8b', fontWeight: 400 }}>
            {' / '}
            {totalStories}
          </span>
        </span>
        <div className={styles.summaryCardBreakdown}>
          <span className={styles.summaryCardBreakdownItem}>
            Saved: {savedCount}
          </span>
          <span className={styles.summaryCardBreakdownItem}>
            Not saved: {notSavedCount}
          </span>
        </div>
      </div>

      {/* Card 2: Shape-specs generated */}
      <div
        className={styles.summaryCard}
        data-testid="mdd-summary-card-specs"
      >
        <h3 className={styles.summaryCardTitle}>Shape-specs generated</h3>
        <span
          className={styles.summaryCardValue}
          data-testid="mdd-summary-card-specs-value"
        >
          {generatedCount + generatedWithWarningsCount}
        </span>
        <div className={styles.summaryCardBreakdown}>
          <span className={styles.summaryCardBreakdownItem}>
            Generated: {generatedCount}
          </span>
          <span className={styles.summaryCardBreakdownItem}>
            With warnings: {generatedWithWarningsCount}
          </span>
          <span className={styles.summaryCardBreakdownItem}>
            Insufficient: {insufficientCount}
          </span>
          <span className={styles.summaryCardBreakdownItem}>
            Failed: {failedCount}
          </span>
          <span className={styles.summaryCardBreakdownItem}>
            Blocked: {blockedCount}
          </span>
          <span className={styles.summaryCardBreakdownItem}>
            Not attempted: {notAttemptedCount}
          </span>
        </div>
      </div>

      {/* Card 3: Needs attention */}
      <div
        className={styles.summaryCard}
        data-testid="mdd-summary-card-needs-attention"
      >
        <h3 className={styles.summaryCardTitle}>Specs needing attention</h3>
        <span
          className={styles.summaryCardValue}
          data-testid="mdd-summary-card-needs-attention-value"
        >
          {needsAttention}
        </span>
        <div className={styles.summaryCardBreakdown}>
          <span className={styles.summaryCardBreakdownItem}>
            Failed: {failedCount}
          </span>
          <span className={styles.summaryCardBreakdownItem}>
            Insufficient: {insufficientCount}
          </span>
        </div>
      </div>

      {/* Card 4: Implementation workspaces active */}
      <div
        className={styles.summaryCard}
        data-testid="mdd-summary-card-implementation"
      >
        <h3 className={styles.summaryCardTitle}>Implementation active</h3>
        <span
          className={styles.summaryCardValue}
          data-testid="mdd-summary-card-implementation-value"
        >
          {implActive}
        </span>
        <div className={styles.summaryCardBreakdown}>
          <span className={styles.summaryCardBreakdownItem}>
            In progress: {implInProgress}
          </span>
          <span className={styles.summaryCardBreakdownItem}>
            Completed: {implCompleted}
          </span>
          <span className={styles.summaryCardBreakdownItem}>
            Blocked: {implBlocked}
          </span>
        </div>
      </div>

      {/* Card 5: Evidence coverage */}
      <div
        className={styles.summaryCard}
        data-testid="mdd-summary-card-evidence"
      >
        <h3 className={styles.summaryCardTitle}>Evidence coverage</h3>
        <span
          className={styles.summaryCardValue}
          data-testid="mdd-summary-card-evidence-value"
        >
          {evidenceAnyCoverage}
        </span>
        <div className={styles.summaryCardBreakdown}>
          <span className={styles.summaryCardBreakdownItem}>
            Evidence refs: {evidenceReferences}
          </span>
          <span className={styles.summaryCardBreakdownItem}>
            Findings: {findingsRefs}
          </span>
          {findingsCoverage && (
            <span
              className={styles.summaryCardBreakdownItem}
              data-testid="mdd-summary-card-evidence-findings-addressed"
            >
              Findings addressed: {findingsCoverage.addressedCount} /{' '}
              {findingsCoverage.total}
            </span>
          )}
          <span className={styles.summaryCardBreakdownItem}>
            Baselines: {baselineRefs}
          </span>
          <span className={styles.summaryCardBreakdownItem}>
            Mappings: {mappingRefs}
          </span>
          <span className={styles.summaryCardBreakdownItem}>
            Architectures: {architectureRefs}
          </span>
        </div>
      </div>
    </section>
  );
};

export default MigrationDeliverySummaryCards;
