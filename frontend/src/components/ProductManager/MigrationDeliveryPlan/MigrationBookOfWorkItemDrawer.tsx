/**
 * MigrationBookOfWorkItemDrawer
 *
 * Spec 2026-05-17 PM Migration Delivery Plan -- Task Group 11.
 *
 * Right-side detail drawer for a selected `book_of_work_json` item. Shows:
 *   - Title + type
 *   - Description + acceptance criteria
 *   - Workstream chip
 *   - Confidence + readiness chips
 *   - Readiness reasons (bulleted)
 *   - Missing inputs (bulleted)
 *   - Recommended next action
 *   - "Why this exists" traceability summary (verbatim from the draft JSON)
 *   - Reference lists: evidence / architecture / API baseline / discovery
 *     finding / mapping / source-context refs as compact chips
 *
 * Pure presentational; the parent owns selection and the underlying item
 * list.
 *
 * Spec 2026-06-11 Source-Grade DB Schema + Data Migration Pack (Task 6.7):
 * when the rendered item is the book-of-work epic a DB migration pack is
 * attached to (`db_migration_packs.work_item_id`), the drawer shows a pack
 * chip with a download action. The parent supplies the attachment lookup +
 * the download handler; the drawer stays presentational.
 */

import React from 'react';
import type {
  MigrationBookOfWorkItem,
} from '../../../api/migrationBookOfWorkApi';
import styles from './MigrationBookOfWork.module.css';

export interface MigrationBookOfWorkItemDrawerProps {
  item: MigrationBookOfWorkItem | null;
  /**
   * The DB migration pack attached to this item (when the item is the
   * user-chosen DB epic), or null/undefined when no pack is attached.
   */
  dbMigrationPack?: { packId: string; workItemId: string | null } | null;
  /** Download action for the attached pack's on-demand zip. */
  onDownloadDbMigrationPack?: (packId: string) => void;
}

function RefChipList({
  label,
  values,
  testId,
}: {
  label: string;
  values: string[];
  testId: string;
}): React.ReactElement | null {
  if (!values || values.length === 0) return null;
  return (
    <div className={styles.section} data-testid={testId}>
      <h3 className={styles.sectionTitle}>{label}</h3>
      <div>
        {values.map((v) => (
          <span key={v} className={styles.refChip} title={v}>
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

export const MigrationBookOfWorkItemDrawer: React.FC<
  MigrationBookOfWorkItemDrawerProps
> = ({ item, dbMigrationPack, onDownloadDbMigrationPack }) => {
  if (!item) {
    return (
      <div className={styles.drawerEmpty} data-testid="item-drawer-empty">
        Select an item from the tree to view its details.
      </div>
    );
  }

  return (
    <div data-testid={`item-drawer-${item.id}`}>
      <div className={styles.drawerHeader}>
        <h2 className={styles.drawerTitle} data-testid="item-drawer-title">
          {item.title}
        </h2>
        <div className={styles.badgeRow} style={{ marginTop: 8 }}>
          <span className={styles.badge} data-testid="item-drawer-type">
            {item.type}
          </span>
          <span
            className={styles.badge}
            data-testid="item-drawer-workstream"
          >
            {item.workstream}
          </span>
          <span
            className={styles.badge}
            data-testid="item-drawer-confidence"
          >
            confidence: {item.confidence}
          </span>
          <span
            className={styles.badge}
            data-testid="item-drawer-readiness"
          >
            readiness: {item.readiness}
          </span>
        </div>
      </div>

      <div className={styles.drawerBody}>
        {dbMigrationPack && dbMigrationPack.workItemId === item.id && (
          <div
            className={styles.section}
            data-testid="item-drawer-db-migration-pack"
          >
            <h3 className={styles.sectionTitle}>DB migration pack</h3>
            <span
              className={styles.refChip}
              data-testid="item-drawer-db-migration-pack-chip"
              title={`DB migration pack ${dbMigrationPack.packId}`}
            >
              Schema migration pack attached
            </span>{' '}
            <button
              type="button"
              className={styles.filterClearButton}
              onClick={() =>
                onDownloadDbMigrationPack?.(dbMigrationPack.packId)
              }
              data-testid="item-drawer-db-migration-pack-download"
            >
              Download pack
            </button>
          </div>
        )}

        {item.description && (
          <div className={styles.section} data-testid="item-drawer-description">
            <h3 className={styles.sectionTitle}>Description</h3>
            <p className={styles.bodyText}>{item.description}</p>
          </div>
        )}

        {item.acceptanceCriteria && item.acceptanceCriteria.length > 0 && (
          <div
            className={styles.section}
            data-testid="item-drawer-acceptance-criteria"
          >
            <h3 className={styles.sectionTitle}>Acceptance Criteria</h3>
            <ul className={styles.bulletList}>
              {item.acceptanceCriteria.map((ac, idx) => (
                <li key={idx}>{ac}</li>
              ))}
            </ul>
          </div>
        )}

        {item.readinessReasons && item.readinessReasons.length > 0 && (
          <div
            className={styles.section}
            data-testid="item-drawer-readiness-reasons"
          >
            <h3 className={styles.sectionTitle}>Readiness reasons</h3>
            <ul className={styles.bulletList}>
              {item.readinessReasons.map((r, idx) => (
                <li key={idx}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {item.missingInputs && item.missingInputs.length > 0 && (
          <div
            className={styles.section}
            data-testid="item-drawer-missing-inputs"
          >
            <h3 className={styles.sectionTitle}>Missing inputs</h3>
            <ul className={styles.bulletList}>
              {item.missingInputs.map((m, idx) => (
                <li key={idx}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        {item.recommendedNextAction && (
          <div
            className={styles.section}
            data-testid="item-drawer-recommended-next-action"
          >
            <h3 className={styles.sectionTitle}>Recommended next action</h3>
            <p className={styles.bodyText}>{item.recommendedNextAction}</p>
          </div>
        )}

        {item.traceabilitySummary && (
          <div
            className={styles.section}
            data-testid="item-drawer-traceability-summary"
          >
            <h3 className={styles.sectionTitle}>Why this exists</h3>
            <p className={styles.bodyText}>{item.traceabilitySummary}</p>
          </div>
        )}

        <RefChipList
          label="Evidence references"
          values={item.evidenceReferences ?? []}
          testId="item-drawer-evidence-references"
        />
        <RefChipList
          label="Architecture references"
          values={item.architectureReferences ?? []}
          testId="item-drawer-architecture-references"
        />
        <RefChipList
          label="API baseline references"
          values={item.apiBaselineReferences ?? []}
          testId="item-drawer-api-baseline-references"
        />
        <RefChipList
          label="Discovery finding references"
          values={item.discoveryFindingReferences ?? []}
          testId="item-drawer-discovery-finding-references"
        />
        <RefChipList
          label="Mapping references"
          values={item.mappingReferences ?? []}
          testId="item-drawer-mapping-references"
        />
        <RefChipList
          label="Source-context refs"
          values={item.sourceContextRefs ?? []}
          testId="item-drawer-source-context-refs"
        />

        {item.errorMessage && (
          <div
            className={styles.section}
            data-testid="item-drawer-error-message"
          >
            <h3 className={styles.sectionTitle}>Save error</h3>
            <p className={styles.bodyText} style={{ color: '#991b1b' }}>
              {item.errorMessage}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MigrationBookOfWorkItemDrawer;
