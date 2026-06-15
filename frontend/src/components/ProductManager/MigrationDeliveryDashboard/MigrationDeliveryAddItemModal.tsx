/**
 * MigrationDeliveryAddItemModal
 *
 * Spec: 2026-06-14 Net-new backlog items + provenance (D5) -- Task Group 4
 * (D4: add-item surface; D6: form fields). Extended 2026-06-14 Non-Reconciling
 * Work at Reconcile Time (D6) -- Task Group 5: the optional `net_new_operations`
 * field for net_new + api items.
 *
 * The Migration Delivery Dashboard's "Add work item" form. ONE first-class way
 * to add a MANUAL work item to a SAVED book of work BEFORE Migrate:
 *
 *   - genuinely-new `net_new` work (a new job, a new feature) -- additive,
 *     deliberately outside the like-for-like envelope, OR
 *   - undiscoverable `carry_over` work (OS cron, vacuum/index schedules, ops
 *     runbooks no parser finds) -- like-for-like, but discovery could not see
 *     it so a human must add it.
 *
 * Fields (reusing the `WorkItemCreateModal` form patterns -- title-required
 * validation, field layout, Ctrl+Enter submit, overlay/Escape close):
 *   - `provenance` (carry_over | net_new)
 *   - `kind` flavour (api | operational) -- tunes ONLY the generated-spec
 *     prompt flavour downstream (api -> endpoint orientation; operational ->
 *     operational-effect-test orientation); the spec is ALWAYS grounded on the
 *     description for a manual add.
 *   - `title` (required)
 *   - `description` -- the PRIMARY describe->generate input: the human's intent
 *     IS the context that grounds the generated spec (it replaces the
 *     discovered-context resolver). A short helper line makes this explicit.
 *   - (D6) `net_new_operations` -- shown ONLY for net_new + api: the explicit,
 *     human-owned `<METHOD> <path>` list (one per line, e.g. `POST /accounts`)
 *     that is the AUTHORITATIVE reconcile-time match source. At reconcile time
 *     a `target_only` diff whose operation uniquely matches one of these is
 *     auto-recognised as an Expected net_new endpoint rather than a false break.
 *
 * On submit the modal calls
 * `onSubmit({ provenance, kind, title, description, netNewOperations })` (the
 * operations array present + non-empty ONLY for net_new + api) and the parent
 * (the dashboard) drives the gateway add-item route + the dashboard refresh; the
 * modal surfaces the in-flight / error state passed back via props so a failed
 * add keeps the form open with the entered values.
 *
 * Mounted as an inline overlay dialog matching the dashboard's existing
 * carry-over review overlay (fixed full-screen scrim + centred card), so it does
 * not depend on the Product Backlog modal's own CSS module.
 */

import React, { useCallback, useEffect, useState } from 'react';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Public types
// ============================================================================

export type AddItemProvenance = 'carry_over' | 'net_new';
export type AddItemKind = 'api' | 'operational';

export interface AddItemFormValues {
  provenance: AddItemProvenance;
  kind: AddItemKind;
  title: string;
  description: string;
  /**
   * (D6) The explicit `<METHOD> <path>` operation list (parsed from one-per-line
   * input; trimmed, blanks dropped). Present + non-empty ONLY for net_new + api
   * items -- absent/empty otherwise (matching the gateway/AMS stamp gate).
   */
  netNewOperations?: string[];
}

export interface MigrationDeliveryAddItemModalProps {
  /** Invoked with the captured field values on a valid submit. */
  onSubmit: (values: AddItemFormValues) => void;
  /** Close the modal without submitting. */
  onClose: () => void;
  /** When true, the form is mid-submit (buttons disabled, "Adding..." label). */
  submitting?: boolean;
  /** A submit error surfaced from the parent; keeps the form open. */
  error?: string | null;
}

/** Internal form state (the raw newline-delimited operations text). */
interface AddItemFormState {
  provenance: AddItemProvenance;
  kind: AddItemKind;
  title: string;
  description: string;
  netNewOperationsText: string;
}

const DEFAULT_VALUES: AddItemFormState = {
  provenance: 'net_new',
  kind: 'api',
  title: '',
  description: '',
  netNewOperationsText: '',
};

/** Parse the one-per-line operations text into a trimmed, blank-free array. */
function parseNetNewOperations(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export const MigrationDeliveryAddItemModal: React.FC<
  MigrationDeliveryAddItemModalProps
> = ({ onSubmit, onClose, submitting = false, error = null }) => {
  const [values, setValues] = useState<AddItemFormState>({ ...DEFAULT_VALUES });
  const [titleError, setTitleError] = useState<string | null>(null);

  // Reset on first mount (the parent mounts/unmounts the modal per open).
  useEffect(() => {
    setValues({ ...DEFAULT_VALUES });
    setTitleError(null);
  }, []);

  const setField = useCallback(
    <K extends keyof AddItemFormState>(key: K, value: AddItemFormState[K]) => {
      setValues((prev) => ({ ...prev, [key]: value }));
      if (key === 'title') setTitleError(null);
    },
    [],
  );

  // The net_new_operations field is meaningful ONLY for a net_new + api add --
  // exactly the gateway/AMS stamp gate.
  const showNetNewOperations =
    values.provenance === 'net_new' && values.kind === 'api';

  const handleSubmit = useCallback(() => {
    if (!values.title.trim()) {
      setTitleError('Title is required');
      return;
    }
    const operations =
      values.provenance === 'net_new' && values.kind === 'api'
        ? parseNetNewOperations(values.netNewOperationsText)
        : [];
    onSubmit({
      provenance: values.provenance,
      kind: values.kind,
      title: values.title.trim(),
      description: values.description.trim(),
      // Only thread the field when there is something to send (net_new + api
      // with at least one operation); omit it otherwise so a carry_over /
      // operational / empty add carries no noise.
      ...(operations.length > 0 ? { netNewOperations: operations } : {}),
    });
  }, [values, onSubmit]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !submitting) onClose();
    },
    [onClose, submitting],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      } else if (e.key === 'Enter' && e.ctrlKey) {
        handleSubmit();
      }
    },
    [onClose, submitting, handleSubmit],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add work item"
      data-testid="mdd-add-item-modal"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 999,
        overflowY: 'auto',
        padding: '5vh 0',
      }}
    >
      <div
        style={{
          background: '#fff',
          padding: 24,
          borderRadius: 8,
          width: 560,
          maxWidth: '95vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h3 style={{ margin: 0 }}>Add work item</h3>
          <button
            type="button"
            className={styles.headerNavLink}
            onClick={onClose}
            disabled={submitting}
            data-testid="mdd-add-item-close"
          >
            Close
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 13, color: '#607d8b' }}>
          Add genuinely-new (<code>net_new</code>) work or undiscoverable
          like-for-like (<code>carry_over</code>) work to this book of work
          before Migrate. The description is the primary input: it grounds the
          generated implementation-ready spec.
        </p>

        {/* Provenance */}
        <div className={styles.filterField}>
          <label className={styles.filterFieldLabel} htmlFor="mdd-add-item-provenance">
            Provenance
          </label>
          <select
            id="mdd-add-item-provenance"
            className={styles.filterSelect}
            value={values.provenance}
            onChange={(e) =>
              setField('provenance', e.target.value as AddItemProvenance)
            }
            data-testid="mdd-add-item-provenance"
          >
            <option value="net_new">net_new (additive / new work)</option>
            <option value="carry_over">
              carry_over (undiscoverable like-for-like)
            </option>
          </select>
        </div>

        {/* Kind flavour */}
        <div className={styles.filterField}>
          <label className={styles.filterFieldLabel} htmlFor="mdd-add-item-kind">
            Kind
          </label>
          <select
            id="mdd-add-item-kind"
            className={styles.filterSelect}
            value={values.kind}
            onChange={(e) => setField('kind', e.target.value as AddItemKind)}
            data-testid="mdd-add-item-kind"
          >
            <option value="api">API (endpoint behaviour)</option>
            <option value="operational">
              Operational (non-API effect / job)
            </option>
          </select>
        </div>

        {/* Title (required) */}
        <div className={styles.filterField}>
          <label className={styles.filterFieldLabel} htmlFor="mdd-add-item-title">
            Title*
          </label>
          <input
            id="mdd-add-item-title"
            type="text"
            className={styles.filterSelect}
            value={values.title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder="e.g. Add a nightly portfolio-revaluation job"
            data-testid="mdd-add-item-title"
            autoFocus
          />
          {titleError && (
            <span
              style={{ fontSize: 12, color: '#b71c1c' }}
              data-testid="mdd-add-item-title-error"
            >
              {titleError}
            </span>
          )}
        </div>

        {/* Description (the describe->generate input) */}
        <div className={styles.filterField}>
          <label
            className={styles.filterFieldLabel}
            htmlFor="mdd-add-item-description"
          >
            Description (grounds the generated spec)
          </label>
          <textarea
            id="mdd-add-item-description"
            className={styles.filterSelect}
            style={{ minHeight: 96, resize: 'vertical' }}
            value={values.description}
            onChange={(e) => setField('description', e.target.value)}
            placeholder="Describe the behaviour / effect this work delivers. The generated spec is grounded on this."
            data-testid="mdd-add-item-description"
          />
        </div>

        {/* (D6) net_new operations -- net_new + api only. The AUTHORITATIVE
            reconcile-time match source: a target_only diff whose <METHOD> <path>
            uniquely matches one of these is auto-recognised as Expected net_new
            rather than surfacing as a false break. */}
        {showNetNewOperations && (
          <div className={styles.filterField}>
            <label
              className={styles.filterFieldLabel}
              htmlFor="mdd-add-item-net-new-operations"
            >
              New endpoints (one <code>METHOD /path</code> per line)
            </label>
            <textarea
              id="mdd-add-item-net-new-operations"
              className={styles.filterSelect}
              style={{ minHeight: 64, resize: 'vertical', fontFamily: 'monospace' }}
              value={values.netNewOperationsText}
              onChange={(e) => setField('netNewOperationsText', e.target.value)}
              placeholder={'POST /accounts\nGET /accounts/{id}'}
              data-testid="mdd-add-item-net-new-operations"
            />
            <span style={{ fontSize: 12, color: '#607d8b' }}>
              At reconcile time these are matched against the migrated target so a
              deliberately-added endpoint is recognised as expected, not a break.
            </span>
          </div>
        )}

        {error && (
          <div
            style={{ fontSize: 13, color: '#b71c1c' }}
            role="alert"
            data-testid="mdd-add-item-error"
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button
            type="button"
            className={styles.headerNavLink}
            onClick={onClose}
            disabled={submitting}
            data-testid="mdd-add-item-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.bulkButton}
            onClick={handleSubmit}
            disabled={submitting || !values.title.trim()}
            data-testid="mdd-add-item-submit"
          >
            {submitting ? 'Adding…' : 'Add & generate spec'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MigrationDeliveryAddItemModal;
