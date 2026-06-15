/**
 * ExceptionSubDialog
 *
 * Spec: 2026-05-24 Target State Architect-Persona Conversation -- Commit 5, Surface 5
 *
 * Per Q11, the entity picker is filtered by the decision code's
 * `allowedExceptionScopes`. The picker sources its rows from the existing
 * target-architecture read endpoints (see `getElementsInventory`).
 *
 * Defence-in-depth per Q12: the dialog rejects any `scope_ref_type` value
 * outside the closed set. The gateway also validates server-side; this is a
 * UI-level check so a malformed allowedExceptionScopes config never reaches
 * the writer.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ALLOWED_SCOPE_REF_TYPES,
  type ScopeRefType,
} from '../../../api/architectConversationApi';
import {
  getElementsInventory,
  type ElementInventoryResponse,
} from '../../../api/architecturesApi';
import styles from './ArchitectConversation.module.css';

export interface ExceptionSubDialogProps {
  projectId: string;
  targetArchitectureId: string;
  decisionCode: string;
  /** The closed-set scope kinds this decision allows -- drives the picker filter. */
  allowedExceptionScopes: readonly ScopeRefType[];
  /**
   * Four-Spec Hardening Pass (2026-05-25), Item 4 (Q12 option a): when the
   * tab's runtime scope-map fetch failed, the sub-dialog still OPENS but
   * the picker is rendered DISABLED with the message
   * "no exception scopes available -- try again later" so the user can
   * read context and cancel out cleanly rather than hitting a blocked or
   * empty modal. Defaults to false.
   */
  scopesUnavailable?: boolean;
  onSubmit: (args: {
    scope: { kind: 'element'; refType: ScopeRefType; refId: string };
    answerValue: string;
  }) => Promise<void> | void;
  onCancel: () => void;
}

interface PickerRow {
  refType: ScopeRefType;
  refId: string;
  name: string;
}

/**
 * Map the loose backend entityType strings (e.g. `application_component`,
 * `physical_data_entity`, `interface`, `endpoint`, ...) to the Q12 closed
 * scope_ref_type set. Returns null when the entity type is not pickable.
 *
 * Keep this narrow: we ONLY surface entities whose entityType maps cleanly to
 * a member of the Q12 set. Anything else is filtered out.
 */
function entityTypeToScopeRefType(entityType: string): ScopeRefType | null {
  const lower = entityType.toLowerCase();
  if (lower === 'service' || lower === 'services') return 'service';
  if (lower === 'interface' || lower === 'interfaces') return 'interface';
  if (lower === 'endpoint' || lower === 'endpoints') return 'endpoint';
  if (lower === 'physical_data_entity') return 'physical_data_entity';
  if (lower === 'physical_data_attribute') return 'physical_data_attribute';
  if (lower === 'method' || lower === 'methods') return 'method';
  if (lower === 'class' || lower === 'classes') return 'class';
  return null;
}

function flattenInventoryToPickerRows(
  inventory: ElementInventoryResponse | null,
): PickerRow[] {
  if (!inventory) return [];
  const out: PickerRow[] = [];
  for (const domain of inventory.domains) {
    for (const type of domain.types) {
      const refType = entityTypeToScopeRefType(type.entityType ?? type.name);
      if (!refType) continue;
      for (const inst of type.instances) {
        out.push({ refType, refId: inst.id, name: inst.name });
      }
    }
  }
  return out;
}

export function ExceptionSubDialog({
  projectId,
  targetArchitectureId,
  decisionCode,
  allowedExceptionScopes,
  scopesUnavailable = false,
  onSubmit,
  onCancel,
}: ExceptionSubDialogProps) {
  const [inventory, setInventory] = useState<ElementInventoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PickerRow | null>(null);
  const [answerValue, setAnswerValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const data = await getElementsInventory(projectId, targetArchitectureId);
        if (cancelled) return;
        setInventory(data);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to load entity picker';
        setError(msg);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, targetArchitectureId]);

  // Per Q12 defence-in-depth: drop anything that escapes the closed set.
  const filteredAllowedScopes = useMemo(
    () =>
      allowedExceptionScopes.filter((s): s is ScopeRefType =>
        ALLOWED_SCOPE_REF_TYPES.includes(s),
      ),
    [allowedExceptionScopes],
  );

  const pickerRows = useMemo(() => {
    const all = flattenInventoryToPickerRows(inventory);
    return all.filter((r) => filteredAllowedScopes.includes(r.refType));
  }, [inventory, filteredAllowedScopes]);

  const handleSubmit = async () => {
    if (!selected) return;
    if (!ALLOWED_SCOPE_REF_TYPES.includes(selected.refType)) {
      setError(
        `Scope ref type '${selected.refType}' is not in the closed Q12 set.`,
      );
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        scope: { kind: 'element', refType: selected.refType, refId: selected.refId },
        answerValue: answerValue.trim(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to pin exception';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      data-testid="architect-conversation-exception-sub-dialog"
    >
      <div className={styles.modal}>
        <h3>Set exception for {decisionCode}</h3>
        <p style={{ fontSize: '0.85rem', color: '#57606a', margin: 0 }}>
          Pick an element to pin a per-element exception. Allowed kinds:{' '}
          {filteredAllowedScopes.join(', ') || '(none)'}.
        </p>

        {loading && <p>Loading entity picker...</p>}

        {error && (
          <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
            {error}
          </div>
        )}

        {!loading && !error && scopesUnavailable && (
          <p
            style={{ fontSize: '0.85rem', color: '#57606a', margin: 0 }}
            data-testid="architect-conversation-exception-scopes-unavailable"
            role="alert"
          >
            no exception scopes available -- try again later
          </p>
        )}

        {!loading && !error && !scopesUnavailable && (
          <>
            <div
              className={styles.entityList}
              data-testid="architect-conversation-exception-entity-list"
            >
              {pickerRows.length === 0 ? (
                <p
                  style={{ fontSize: '0.85rem', color: '#57606a', margin: 0 }}
                  data-testid="architect-conversation-exception-entity-list-empty"
                >
                  No matching elements found in this target architecture.
                </p>
              ) : (
                pickerRows.map((row) => (
                  <div
                    key={`${row.refType}:${row.refId}`}
                    className={
                      selected &&
                      selected.refType === row.refType &&
                      selected.refId === row.refId
                        ? `${styles.entityRow} ${styles.entityRowSelected}`
                        : styles.entityRow
                    }
                    onClick={() => setSelected(row)}
                    data-testid={`architect-conversation-exception-entity-row-${row.refId}`}
                    data-ref-type={row.refType}
                    role="button"
                    tabIndex={0}
                  >
                    <strong>{row.name}</strong>
                    <span style={{ color: '#57606a', marginLeft: '0.5rem' }}>
                      ({row.refType})
                    </span>
                  </div>
                ))
              )}
            </div>

            <label
              style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}
            >
              <span style={{ fontSize: '0.85rem' }}>
                Exception answer value
              </span>
              <input
                type="text"
                className={styles.inputField}
                value={answerValue}
                onChange={(e) => setAnswerValue(e.target.value)}
                placeholder="e.g. Spring Classic 5"
                data-testid="architect-conversation-exception-answer-input"
              />
            </label>
          </>
        )}

        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onCancel}
            data-testid="architect-conversation-exception-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={
              scopesUnavailable || !selected || !answerValue.trim() || submitting
            }
            onClick={() => void handleSubmit()}
            data-testid="architect-conversation-exception-submit"
          >
            {submitting ? 'Submitting...' : 'Pin exception'}
          </button>
        </div>
      </div>
    </div>
  );
}
