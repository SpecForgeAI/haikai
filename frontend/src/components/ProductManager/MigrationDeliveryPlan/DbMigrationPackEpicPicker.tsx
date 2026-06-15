/**
 * DbMigrationPackEpicPicker
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Group 6 (Task 6.7 epic attachment).
 *
 * One-time picker that lists the project's book-of-work EPICS (loaded from
 * the migration delivery plan drafts — NO naming-convention magic, the user
 * chooses which epic is the DB epic) and PATCHes the chosen item id onto the
 * pack's `work_item_id`. Once attached, the pack view shows the epic chip
 * and `MigrationBookOfWorkItemDrawer` shows the pack chip with a download
 * action on that epic.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  attachDbMigrationPackWorkItem,
  type DbMigrationPackDto,
} from '../../../api/dbMigrationPackApi';
import {
  listMigrationBookOfWorks,
  type MigrationBookOfWorkDraft,
} from '../../../api/migrationBookOfWorkApi';
import styles from './DbMigrationPack.module.css';

export interface DbMigrationPackEpicPickerProps {
  projectId: string;
  packId: string;
  /** Fired with the PATCHed pack row after a successful attach. */
  onAttached: (pack: DbMigrationPackDto) => void;
}

interface EpicOption {
  itemId: string;
  label: string;
}

function collectEpics(drafts: MigrationBookOfWorkDraft[]): EpicOption[] {
  const out: EpicOption[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    for (const item of draft.bookOfWork?.items ?? []) {
      if (item.type !== 'epic' || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push({
        itemId: item.id,
        label: draft.title ? `${item.title} (${draft.title})` : item.title,
      });
    }
  }
  return out;
}

export const DbMigrationPackEpicPicker: React.FC<DbMigrationPackEpicPickerProps> = ({
  projectId,
  packId,
  onAttached,
}) => {
  const [drafts, setDrafts] = useState<MigrationBookOfWorkDraft[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listMigrationBookOfWorks(projectId)
      .then((rows) => {
        if (!cancelled) setDrafts(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Failed to load book-of-work epics',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const epics = useMemo(() => collectEpics(drafts), [drafts]);

  const handleAttach = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setAttachError(null);
    try {
      const pack = await attachDbMigrationPackWorkItem(projectId, packId, selected);
      onAttached(pack);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Failed to attach epic');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.inlineResolve} data-testid="db-pack-epic-picker">
      <select
        className={styles.filterSelect}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={busy}
        data-testid="db-pack-epic-picker-select"
      >
        <option value="">Choose the DB epic…</option>
        {epics.map((e) => (
          <option key={e.itemId} value={e.itemId}>
            {e.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={styles.actionButton}
        onClick={() => void handleAttach()}
        disabled={!selected || busy}
        data-testid="db-pack-epic-picker-attach"
      >
        {busy ? 'Attaching…' : 'Attach epic'}
      </button>
      {loadError && (
        <span className={styles.modalHint} data-testid="db-pack-epic-picker-load-error">
          {loadError}
        </span>
      )}
      {attachError && (
        <span
          className={styles.errorBanner}
          data-testid="db-pack-epic-picker-attach-error"
        >
          {attachError}
        </span>
      )}
    </div>
  );
};

export default DbMigrationPackEpicPicker;
