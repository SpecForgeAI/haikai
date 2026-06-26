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
 *
 * Spec 2026-06-26 Book-of-Work Scaffold + Reference Names (Task Group 4):
 * an optional `resolveRef(type, id)` lookup is injected by the parent so the
 * architecture-reference and discovery-finding-reference chips can render as
 * human-readable `name (id)` / `title (id)` instead of raw UUIDs. The drawer
 * stays presentational -- the lookup is injected, never fetched here -- and
 * always falls back to the raw id on a miss (never blank). Only those two
 * reference lists opt in; evidence / API-baseline / mapping / source-context
 * chips render verbatim.
 */

import React from 'react';
import type {
  MigrationBookOfWorkItem,
} from '../../../api/migrationBookOfWorkApi';
import styles from './MigrationBookOfWork.module.css';

/**
 * Render-time reference resolver injected by the parent. Returns a
 * human-readable label (`"name (id)"` / `"title (id)"`) for a known id, or
 * the raw id on a miss (never blank). Kept optional so the drawer remains a
 * standalone presentational component.
 */
export type ResolveRefFn = (
  type: 'architecture' | 'discoveryFinding',
  id: string,
) => string;

export interface MigrationBookOfWorkItemDrawerProps {
  item: MigrationBookOfWorkItem | null;
  /**
   * The DB migration pack attached to this item (when the item is the
   * user-chosen DB epic), or null/undefined when no pack is attached.
   */
  dbMigrationPack?: { packId: string; workItemId: string | null } | null;
  /** Download action for the attached pack's on-demand zip. */
  onDownloadDbMigrationPack?: (packId: string) => void;
  /**
   * Optional reference-name resolver. When supplied, the architecture and
   * discovery-finding reference chips render `resolveRef(type, value)` (raw
   * id on miss). Other reference lists ignore it and render verbatim.
   */
  resolveRef?: ResolveRefFn;
}

function RefChipList({
  label,
  values,
  testId,
  resolveRef,
  resolveType,
}: {
  label: string;
  values: string[];
  testId: string;
  /**
   * When both `resolveRef` and `resolveType` are supplied, each chip renders
   * `resolveRef(resolveType, value) ?? value` (raw id on miss, never blank).
   * Omitted on the verbatim reference lists.
   */
  resolveRef?: ResolveRefFn;
  resolveType?: 'architecture' | 'discoveryFinding';
}): React.ReactElement | null {
  if (!values || values.length === 0) return null;
  return (
    <div className={styles.section} data-testid={testId}>
      <h3 className={styles.sectionTitle}>{label}</h3>
      <div>
        {values.map((v) => {
          const display =
            resolveRef && resolveType
              ? resolveRef(resolveType, v) ?? v
              : v;
          return (
            <span key={v} className={styles.refChip} title={display}>
              {display}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export const MigrationBookOfWorkItemDrawer: React.FC<
  MigrationBookOfWorkItemDrawerProps
> = ({ item, dbMigrationPack, onDownloadDbMigrationPack, resolveRef }) => {
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
          resolveRef={resolveRef}
          resolveType="architecture"
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
          resolveRef={resolveRef}
          resolveType="discoveryFinding"
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
