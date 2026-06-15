/**
 * LinkToJiraDialog
 *
 * Lets the user manually attach a Jira issue key (e.g. "RP-1") to a tool
 * work item so a subsequent Sync run knows it's already linked. Use case:
 * pre-create an empty Initiative in Jira, copy its key here, then run sync
 * with Tool as golden source to push the tool's data into that Jira issue.
 *
 * Saves only external_system + external_key; external_url is left to the
 * sync flow to populate (jira-service knows the right base URL).
 */

import { useEffect, useState } from 'react';
import { updateWorkItem } from '../../api/workItemsApi';
import type { WorkItem } from '../../types/workItems';
import styles from './SyncDialog.module.css';

const JIRA_KEY_REGEX = /^[A-Z][A-Z0-9_]*-\d+$/;

export interface LinkToJiraDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item: WorkItem;
  projectId: string;
  /** Called after a successful save so the host can refresh its tree state. */
  onSuccess: () => void;
}

export function LinkToJiraDialog({
  isOpen,
  onClose,
  item,
  projectId,
  onSuccess,
}: LinkToJiraDialogProps) {
  const [externalKey, setExternalKey] = useState(item.externalKey ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset state whenever the dialog re-opens or the item changes
  useEffect(() => {
    if (isOpen) {
      setExternalKey(item.externalKey ?? '');
      setError(null);
      setSaving(false);
    }
  }, [isOpen, item.id, item.externalKey]);

  if (!isOpen) return null;

  const isLinked = !!item.externalKey;

  /**
   * Build the partial update payload that preserves all of the item's existing
   * values (so no field gets accidentally wiped by the architecture-model-service
   * mapper), then overlays the requested external-link change.
   */
  function buildUpdatePayload(externalLink: { system: string; key: string }) {
    return {
      type: item.type,
      parentId: item.parentId ?? undefined,
      title: item.title,
      ...(item.description !== null ? { description: item.description } : {}),
      status: item.status,
      ...(item.priority !== null ? { priority: item.priority } : {}),
      ...(item.targetWindow !== null ? { targetWindow: item.targetWindow } : {}),
      externalSystem: externalLink.system,
      externalKey: externalLink.key,
    };
  }

  const handleSave = async () => {
    const trimmed = externalKey.trim();
    if (!trimmed) {
      setError('Jira key is required (e.g. KAN-5 or RP-1).');
      return;
    }
    if (!JIRA_KEY_REGEX.test(trimmed)) {
      setError('Invalid Jira key format. Expected something like KAN-5 or RP-1 (uppercase prefix, dash, number).');
      return;
    }
    if (trimmed === item.externalKey) {
      onClose();
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await updateWorkItem(projectId, item.id, buildUpdatePayload({ system: 'JIRA', key: trimmed }));
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleUnlink = async () => {
    if (!confirm(`Unlink ${item.externalKey} from "${item.title}"?\n\nThis will clear the Jira link from the tool work item. The Jira issue itself is not deleted.`)) {
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // Empty-string external_key is the backend sentinel for "unlink" —
      // clears external_system, external_key, and external_url atomically.
      await updateWorkItem(projectId, item.id, buildUpdatePayload({ system: '', key: '' }));
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" data-testid="link-to-jira-dialog">
      <div className={styles.dialog} style={{ width: 'min(520px, 90vw)' }}>
        <div className={styles.header}>
          <h2 className={styles.headerTitle}>
            {isLinked ? 'Edit Jira link' : 'Link to Jira'}
          </h2>
          <button className={styles.closeButton} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.body}>
          {error && <div className={styles.errorBanner}>{error}</div>}

          <div className={styles.field}>
            <div className={styles.fieldHelp}>
              Attach an existing Jira issue key to <strong>{item.title}</strong> ({item.type}).
              Use this when you've pre-created an empty Jira issue and want to mark
              the tool item as linked before syncing.
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="link-external-key">
              Jira issue key
            </label>
            <input
              id="link-external-key"
              type="text"
              className={styles.textInput}
              placeholder="e.g. RP-1"
              value={externalKey}
              onChange={(e) => setExternalKey(e.target.value.toUpperCase())}
              autoFocus
              disabled={saving}
              data-testid="link-external-key-input"
            />
            <div className={styles.fieldHelp}>
              Format: <code>PREFIX-N</code>. Example: <code>RP-1</code>, <code>KAN-12</code>.
              External URL will be populated automatically by the next sync run.
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button
            className={styles.buttonSecondary}
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          {isLinked && (
            <button
              className={styles.buttonSecondary}
              onClick={handleUnlink}
              disabled={saving}
              data-testid="link-unlink-button"
              style={{ marginRight: 'auto', color: '#b91c1c', borderColor: '#fecaca' }}
            >
              {saving ? 'Saving…' : 'Unlink'}
            </button>
          )}
          <button
            className={styles.buttonPrimary}
            onClick={handleSave}
            disabled={saving || !externalKey.trim()}
            data-testid="link-save-button"
          >
            {saving ? 'Saving…' : isLinked ? 'Update link' : 'Link'}
          </button>
        </div>
      </div>
    </div>
  );
}
