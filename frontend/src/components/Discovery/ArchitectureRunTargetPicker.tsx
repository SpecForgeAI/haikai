/**
 * ArchitectureRunTargetPicker
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 6
 *
 * Always-visible architecture picker rendered inside the Start Discovery
 * Run confirmation modal. The picker's chosen `architectureId` becomes
 * the source of truth for the run-start payload (NOT the URL active id),
 * because the run is bound to its picked architecture for life and the
 * user may legitimately pick a different architecture from the picker
 * than the one they are currently viewing.
 *
 * Behaviour:
 *   - Lists `architectures.filter(a => !a.archived)` from
 *     `useArchitectureContext()`, ordered oldest-first by `createdAt`
 *     (matching spec #1's Default-resolution order and spec #2's
 *     selector ordering rule).
 *   - Pre-selected with `useActiveArchitectureId()` via the parent's
 *     `value` prop (the parent modal seeds its local state from the
 *     hook).
 *   - Disabled when only one non-archived architecture exists -- the
 *     picker is still rendered for confirmation, but there is no choice
 *     to make.
 *   - Disabled when the parent passes `disabled={true}` (e.g. while a
 *     run-start request is in flight).
 *   - Renders a one-line confirmation copy beneath the select:
 *     `Run will be locked to this architecture for its entire lifetime.`
 *
 * Props:
 *   - `value`: currently picked architecture id (controlled by parent)
 *   - `onChange(id)`: invoked when the user picks a different row
 *   - `disabled?`: external disable (e.g. run-start in flight)
 */

import { useMemo } from 'react';
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
import styles from './ArchitectureRunTargetPicker.module.css';

export interface ArchitectureRunTargetPickerProps {
  /** Currently picked architecture id (controlled by parent modal). */
  value: string | null;
  /** Called with the architecture id when the user picks a different row. */
  onChange: (architectureId: string) => void;
  /** External disable (e.g. while a run-start request is in flight). */
  disabled?: boolean;
}

export function ArchitectureRunTargetPicker({
  value,
  onChange,
  disabled = false,
}: ArchitectureRunTargetPickerProps) {
  const ctx = useArchitectureContext();

  // Filter to non-archived; sort oldest-first by createdAt. The backend
  // already returns the list ordered ascending by created_at, but we sort
  // again defensively so the picker is correct even if the context is
  // mutated locally (e.g. via createArchitecture optimistic updates).
  const nonArchived = useMemo(() => {
    const list = (ctx.architectures ?? []).filter(a => !a.archived);
    return list.slice().sort((a, b) => {
      // ISO-8601 strings sort lexicographically -- safe for the createdAt
      // format used by the backend.
      const ac = a.createdAt ?? '';
      const bc = b.createdAt ?? '';
      if (ac < bc) return -1;
      if (ac > bc) return 1;
      return 0;
    });
  }, [ctx.architectures]);

  // Picker is disabled when only one architecture is available (no choice)
  // OR when the parent forces disable (e.g. run in flight).
  const isOnlyOne = nonArchived.length <= 1;
  const isDisabled = disabled || isOnlyOne;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value);
  };

  return (
    <div className={styles.picker} data-testid="architecture-run-target-picker">
      <label className={styles.label} htmlFor="architecture-run-target-picker-select">
        Target architecture
      </label>
      <select
        id="architecture-run-target-picker-select"
        className={styles.select}
        value={value ?? ''}
        onChange={handleChange}
        disabled={isDisabled}
        data-testid="architecture-run-target-picker-select"
      >
        {/* When there's no current value (e.g. still loading) we render a
            placeholder option so the controlled <select> does not warn
            about an unmatched value. */}
        {value === null && (
          <option value="" disabled>
            -
          </option>
        )}
        {nonArchived.map(arch => (
          <option
            key={arch.id}
            value={arch.id}
            data-testid={`architecture-run-target-picker-option-${arch.id}`}
          >
            {arch.name}
          </option>
        ))}
      </select>
      <div
        className={styles.confirmation}
        data-testid="architecture-run-target-picker-confirmation"
      >
        Run will be locked to this architecture for its entire lifetime.
      </div>
    </div>
  );
}

export default ArchitectureRunTargetPicker;
