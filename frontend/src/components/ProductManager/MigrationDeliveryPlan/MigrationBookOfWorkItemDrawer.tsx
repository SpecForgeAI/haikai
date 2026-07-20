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

import React, { useEffect, useState } from 'react';
import type {
  MigrationBookOfWorkItem,
} from '../../../api/migrationBookOfWorkApi';
import type { SpecGenerationRow } from '../../../api/specGenerationApi';
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
  /**
   * Live spec-generation PREFLIGHT verdict for this story (Phase 0,
   * 2026-07-20) — the generator's own input check, run without the LLM.
   * When present it renders the authoritative "Readiness check (live)"
   * section; the baked missingInputs stay as expansion-time provenance.
   */
  preflight?: {
    route: string;
    ready: boolean;
    missingInputs: Array<Record<string, unknown>>;
    note: string | null;
  } | null;
  /**
   * The story's latest spec-generation row (Phase 1a) — drives the
   * "Generated spec" section: view/copy, edit + save (manual edit), Mark
   * ready (manual), regenerate. Null/omitted = no spec attempted yet.
   */
  spec?: SpecGenerationRow | null;
  /** Regenerate this story's spec (confirmOverwrite on manual-edit protect). */
  onRegenerateSpec?: (workItemId: string, confirmOverwrite: boolean) => Promise<void>;
  /** Persist a user-authored spec edit (AMS manual-edit; audit preserved). */
  onSaveSpecEdit?: (specId: string, specText: string) => Promise<void>;
  /** Mark/unmark the story MANUAL-READY — story by story, never bulk. */
  onSetManualReady?: (specId: string, ready: boolean) => Promise<void>;
  /** Open the delete-story confirm (the parent owns the dialog). */
  onDeleteStory?: () => void;
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
> = ({
  item,
  dbMigrationPack,
  onDownloadDbMigrationPack,
  resolveRef,
  preflight,
  spec,
  onRegenerateSpec,
  onSaveSpecEdit,
  onSetManualReady,
  onDeleteStory,
}) => {
  // ----- Spec-section local state (Phase 1a) -----
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [specBusy, setSpecBusy] = useState(false);
  const [specError, setSpecError] = useState<string | null>(null);
  const [overwriteConfirm, setOverwriteConfirm] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reset transient spec state whenever the selected item changes.
  useEffect(() => {
    setEditing(false);
    setEditText('');
    setSpecBusy(false);
    setSpecError(null);
    setOverwriteConfirm(false);
    setCopied(false);
  }, [item?.id]);

  const runSpecAction = async (fn: () => Promise<void>) => {
    setSpecBusy(true);
    setSpecError(null);
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action failed.';
      if (message.includes('manual_edit_protected')) {
        // Regenerate over a manually-edited spec needs an explicit confirm.
        setOverwriteConfirm(true);
      } else {
        setSpecError(message);
      }
    } finally {
      setSpecBusy(false);
    }
  };

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
        {preflight && (
          <div className={styles.section} data-testid="item-drawer-preflight">
            <h3 className={styles.sectionTitle}>Readiness check (live)</h3>
            {preflight.ready ? (
              <p className={styles.bodyText} data-testid="item-drawer-preflight-ready">
                Ready {'✓'} — the generator has every input it needs
                (route: {preflight.route.replace(/_/g, ' ')}
                {preflight.note ? ` · ${preflight.note.replace(/_/g, ' ')}` : ''}).
              </p>
            ) : (
              <>
                <p className={styles.bodyText} data-testid="item-drawer-preflight-blocked">
                  Blocked — {preflight.missingInputs.length} missing input
                  {preflight.missingInputs.length === 1 ? '' : 's'} (route:{' '}
                  {preflight.route.replace(/_/g, ' ')}):
                </p>
                <ul className={styles.bulletList}>
                  {preflight.missingInputs.map((m, idx) => {
                    const label =
                      typeof m.reason === 'string'
                        ? m.reason
                        : typeof m.input === 'string'
                          ? m.input
                          : JSON.stringify(m);
                    return <li key={idx}>{label}</li>;
                  })}
                </ul>
              </>
            )}
          </div>
        )}

        {item.type === 'story' && spec && (
          <div className={styles.section} data-testid="item-drawer-spec">
            <h3 className={styles.sectionTitle}>Generated spec</h3>
            <div className={styles.badgeRow}>
              <span className={styles.badge} data-testid="item-drawer-spec-status">
                {spec.manualReady ? 'manual ✎ ready' : spec.status}
              </span>
              {spec.confidence && (
                <span className={styles.badge}>{spec.confidence}</span>
              )}
              {spec.manuallyEdited && (
                <span className={styles.badge} title="Spec text was manually edited">
                  edited
                </span>
              )}
            </div>

            {editing ? (
              <div data-testid="item-drawer-spec-editor">
                <textarea
                  className={styles.modalInput}
                  style={{ width: '100%', minHeight: 220, fontFamily: 'monospace' }}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  data-testid="item-drawer-spec-edit-textarea"
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    className={styles.selectButton}
                    disabled={specBusy}
                    onClick={() => setEditing(false)}
                    data-testid="item-drawer-spec-edit-cancel"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
                    disabled={specBusy || !spec.id || editText.trim().length === 0}
                    onClick={() =>
                      void runSpecAction(async () => {
                        await onSaveSpecEdit!(spec.id!, editText);
                        setEditing(false);
                      })
                    }
                    data-testid="item-drawer-spec-edit-save"
                  >
                    {specBusy ? 'Saving…' : 'Save spec'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <pre
                  className={styles.bodyText}
                  style={{
                    whiteSpace: 'pre-wrap',
                    maxHeight: 320,
                    overflowY: 'auto',
                    background: '#f6f8fa',
                    padding: 8,
                    borderRadius: 4,
                  }}
                  data-testid="item-drawer-spec-text"
                >
                  {spec.generatedSpecText ??
                    'No spec text yet — generate, or write one below.'}
                </pre>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={styles.selectButton}
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(spec.generatedSpecText ?? '')
                        .then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        });
                    }}
                    data-testid="item-drawer-spec-copy"
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  {onSaveSpecEdit && spec.id && (
                    <button
                      type="button"
                      className={styles.selectButton}
                      onClick={() => {
                        setEditText(spec.generatedSpecText ?? '');
                        setEditing(true);
                      }}
                      data-testid="item-drawer-spec-edit"
                    >
                      {spec.generatedSpecText ? 'Edit spec' : 'Write spec'}
                    </button>
                  )}
                  {onRegenerateSpec && spec.workItemId && (
                    <button
                      type="button"
                      className={styles.selectButton}
                      disabled={specBusy}
                      onClick={() =>
                        void runSpecAction(() =>
                          onRegenerateSpec(spec.workItemId!, false),
                        )
                      }
                      data-testid="item-drawer-spec-regenerate"
                    >
                      {specBusy ? 'Working…' : 'Regenerate'}
                    </button>
                  )}
                  {onSetManualReady && spec.id && (
                    <button
                      type="button"
                      className={styles.selectButton}
                      disabled={
                        specBusy ||
                        (!spec.manualReady &&
                          !(spec.generatedSpecText ?? '').trim())
                      }
                      title={
                        spec.manualReady
                          ? 'Withdraw the manual-ready acceptance'
                          : 'Accept this human-supplied spec as ready — story by story, never bulk'
                      }
                      onClick={() =>
                        void runSpecAction(() =>
                          onSetManualReady(spec.id!, !spec.manualReady),
                        )
                      }
                      data-testid="item-drawer-spec-manual-ready"
                    >
                      {spec.manualReady ? 'Unmark manual-ready' : 'Mark ready (manual)'}
                    </button>
                  )}
                </div>
              </>
            )}

            {overwriteConfirm && (
              <div
                className={styles.modalWarning}
                data-testid="item-drawer-spec-overwrite-confirm"
              >
                This spec was manually edited — regenerating replaces the
                edits.{' '}
                <button
                  type="button"
                  className={styles.selectButton}
                  disabled={specBusy}
                  onClick={() => {
                    setOverwriteConfirm(false);
                    void runSpecAction(() =>
                      onRegenerateSpec!(spec.workItemId!, true),
                    );
                  }}
                  data-testid="item-drawer-spec-overwrite-continue"
                >
                  Overwrite &amp; regenerate
                </button>{' '}
                <button
                  type="button"
                  className={styles.selectButton}
                  onClick={() => setOverwriteConfirm(false)}
                  data-testid="item-drawer-spec-overwrite-cancel"
                >
                  Keep edits
                </button>
              </div>
            )}

            {spec.warnings.length > 0 && (
              <>
                <h3 className={styles.sectionTitle}>Spec warnings</h3>
                <ul
                  className={styles.bulletList}
                  data-testid="item-drawer-spec-warnings"
                >
                  {spec.warnings.map((w, idx) => (
                    <li key={idx}>
                      {typeof w.message === 'string'
                        ? w.message
                        : typeof w.code === 'string'
                          ? w.code
                          : JSON.stringify(w)}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {spec.missingInputs.length > 0 && (
              <>
                <h3 className={styles.sectionTitle}>Spec missing inputs</h3>
                <ul
                  className={styles.bulletList}
                  data-testid="item-drawer-spec-missing-inputs"
                >
                  {spec.missingInputs.map((m, idx) => (
                    <li key={idx}>
                      {typeof m.reason === 'string'
                        ? m.reason
                        : typeof m.input === 'string'
                          ? m.input
                          : JSON.stringify(m)}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {specError && (
              <div
                className={styles.modalWarning}
                role="alert"
                data-testid="item-drawer-spec-error"
              >
                {specError}
              </div>
            )}
          </div>
        )}

        {item.type === 'story' && onDeleteStory && (
          <div className={styles.section} data-testid="item-drawer-delete-story">
            <button
              type="button"
              className={styles.selectButton}
              style={{ color: '#b91c1c', borderColor: '#b91c1c' }}
              onClick={onDeleteStory}
              title="Delete this story — only when the plan created something unwanted (a story with an unresolved problem should be fixed or given a manual spec instead)"
              data-testid="item-drawer-delete-story-button"
            >
              Delete story…
            </button>
          </div>
        )}

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
