/**
 * BehaviourSemanticsConfigStep
 *
 * Spec: 2026-06-23 Semantics-aware API Behaviour Baseline coverage -- Task
 * Group 5 (capture-wizard config step).
 *
 * The wizard's NEW "Response semantics" step body. The operator confirms or
 * overrides, PER API, how this legacy API's responses map to outcome buckets so
 * "covered" reflects its real (often non-REST) contract: which body markers mean
 * "missing resource" vs "bad input", whether the API returns 5xx for invalid
 * input, and (optionally) a small status->bucket override list.
 *
 * Modeled on {@link DataTypeFormatsStep}: presentational ONLY. The parent owns
 * fetch / seed / persist (it PATCHes `behaviour_semantics_config_json` via
 * `updateCaptureSession`); this step owns no I/O. It takes the current
 * `ResponseSemanticsConfig | null` plus an `onChange(next)` and emits the next
 * config on every edit.
 *
 * Defaults vs sentinel vs untouched (mirrors the date-format "(no default)"
 * three-state idea, here flipped to "(use built-in defaults)"):
 *   - UNTOUCHED  -- `value === null` (empty/absent config) === the built-in
 *                   default vocabulary. The marker lists render the DEFAULT_*
 *                   markers as the visible seed.
 *   - EDITED     -- the operator added/removed a marker, ticked the 5xx box, or
 *                   added a status override: a concrete `ResponseSemanticsConfig`
 *                   is emitted.
 *   - EXPLICITLY DEFAULT -- the operator ticked "(use built-in defaults)": the
 *                   config records the `USE_BUILT_IN_DEFAULTS` sentinel on the
 *                   marker fields, a deliberate round-trippable choice distinct
 *                   from untouched (both resolve to the same vocabulary amvs).
 *
 * The marker editors reuse the editable-list UX precedent: a free-text add input
 * (no validation) with a `<datalist>` of the built-in defaults, plus per-row
 * remove. The config TYPE + default markers come from the local hand-mirror
 * {@link ./behaviourSemanticsConfig} (the frontend must NOT import from amvs).
 */

import React, { useState } from 'react';
import {
  DEFAULT_NOT_FOUND_MARKERS,
  DEFAULT_BAD_REQUEST_MARKERS,
  USE_BUILT_IN_DEFAULTS,
  type BehaviourBucket,
  type MarkerOverride,
  type ResponseSemanticsConfig,
  type UseBuiltInDefaults,
} from './behaviourSemanticsConfig';

export interface BehaviourSemanticsConfigStepProps {
  /**
   * The current config the operator is editing. `null` === untouched === the
   * built-in default vocabulary (the valid empty state).
   */
  value: ResponseSemanticsConfig | null;
  /** Edit callback. Emits the next config (or `null` to reset to untouched). */
  onChange: (next: ResponseSemanticsConfig | null) => void;
  /** The wizard's CSS-module styles object (CSS modules are file-scoped). */
  styles: Record<string, string>;
}

/** The selectable buckets for a status->bucket override row. */
const BUCKET_OPTIONS: BehaviourBucket[] = [
  'success',
  'not_found',
  'client_error',
  'auth',
];

/** True when a marker field is the explicit "(use built-in defaults)" sentinel. */
function isSentinel(
  field: MarkerOverride | UseBuiltInDefaults | undefined,
): field is UseBuiltInDefaults {
  return field === USE_BUILT_IN_DEFAULTS;
}

/**
 * Resolve the VISIBLE marker list for a field:
 *   - a `replace` override shows its own markers;
 *   - an `extend` override shows defaults + its markers;
 *   - the sentinel OR an absent field shows the built-in defaults (the seed).
 */
function visibleMarkers(
  field: MarkerOverride | UseBuiltInDefaults | undefined,
  defaults: readonly string[],
): string[] {
  if (field === undefined || isSentinel(field)) return [...defaults];
  if (field.mode === 'replace') return [...field.markers];
  return [...defaults, ...field.markers];
}

/**
 * Build the next marker field after the operator edited the VISIBLE list. We
 * persist a `replace` override of the exact visible list so what the operator
 * sees is what is stored -- simplest mental model, and round-trips cleanly. When
 * the edited list is byte-identical to the defaults we drop back to `undefined`
 * (untouched) so an unchanged list does not masquerade as an override.
 */
function fieldFromVisible(
  nextVisible: string[],
  defaults: readonly string[],
): MarkerOverride | undefined {
  const sameAsDefaults =
    nextVisible.length === defaults.length &&
    nextVisible.every((m, i) => m === defaults[i]);
  if (sameAsDefaults) return undefined;
  return { mode: 'replace', markers: nextVisible };
}

/**
 * One editable marker list (free-text add + per-row remove + a datalist of the
 * built-in defaults). `idBase` namespaces the input + datalist + testids.
 */
function MarkerListEditor({
  idBase,
  label,
  markers,
  defaults,
  disabled,
  onChangeMarkers,
  styles,
}: {
  idBase: string;
  label: string;
  markers: string[];
  defaults: readonly string[];
  disabled: boolean;
  onChangeMarkers: (next: string[]) => void;
  styles: Record<string, string>;
}): React.ReactElement {
  const [draft, setDraft] = useState('');
  const listId = `${idBase}-options`;

  const addDraft = () => {
    const v = draft.trim();
    if (v.length === 0 || markers.includes(v)) {
      setDraft('');
      return;
    }
    onChangeMarkers([...markers, v]);
    setDraft('');
  };

  return (
    <div
      className={styles.fieldGroup}
      data-testid={`${idBase}-group`}
    >
      <label className={styles.label}>{label}</label>
      <div
        className={styles.operationList}
        data-testid={`${idBase}-list`}
      >
        {markers.length === 0 && (
          <span className={styles.helperText} data-testid={`${idBase}-empty`}>
            (no markers — this category falls back to HTTP status class only)
          </span>
        )}
        {markers.map((m) => (
          <div
            key={m}
            className={styles.operationItem}
            data-testid={`${idBase}-item-${m}`}
          >
            <code>{m}</code>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={disabled}
              onClick={() => onChangeMarkers(markers.filter((x) => x !== m))}
              data-testid={`${idBase}-remove-${m}`}
              aria-label={`Remove marker ${m}`}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        <input
          type="text"
          className={styles.input}
          list={listId}
          value={draft}
          disabled={disabled}
          placeholder="Add a marker (free text, e.g. not_found)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addDraft();
            }
          }}
          data-testid={`${idBase}-add-input`}
          aria-label={`Add a marker to ${label}`}
        />
        <datalist id={listId}>
          {defaults.map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={disabled || draft.trim().length === 0}
          onClick={addDraft}
          data-testid={`${idBase}-add-button`}
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function BehaviourSemanticsConfigStep({
  value,
  onChange,
  styles,
}: BehaviourSemanticsConfigStepProps): React.ReactElement {
  const config = value ?? {};

  // The "(use built-in defaults)" sentinel is recorded on BOTH marker fields
  // together -- it is a single deliberate "this whole config is the built-in
  // vocabulary" choice. It is ON only when both fields hold the sentinel.
  const isExplicitDefault =
    isSentinel(config.notFoundMarkers) && isSentinel(config.badRequestMarkers);

  const notFound = visibleMarkers(config.notFoundMarkers, DEFAULT_NOT_FOUND_MARKERS);
  const badRequest = visibleMarkers(
    config.badRequestMarkers,
    DEFAULT_BAD_REQUEST_MARKERS,
  );

  const statusOverrides: Array<[number, BehaviourBucket | UseBuiltInDefaults]> =
    config.statusBucketOverride
      ? Object.entries(config.statusBucketOverride).map(([k, v]) => [Number(k), v])
      : [];

  const [statusDraft, setStatusDraft] = useState('');

  /** Emit the next config, collapsing a wholly-empty config back to `null`. */
  const emit = (next: ResponseSemanticsConfig) => {
    const empty =
      next.notFoundMarkers === undefined &&
      next.badRequestMarkers === undefined &&
      (next.statusBucketOverride === undefined ||
        Object.keys(next.statusBucketOverride).length === 0) &&
      !next.fiveXxIsBadInput;
    onChange(empty ? null : next);
  };

  const setNotFoundMarkers = (nextVisible: string[]) => {
    emit({
      ...config,
      notFoundMarkers: fieldFromVisible(nextVisible, DEFAULT_NOT_FOUND_MARKERS),
    });
  };

  const setBadRequestMarkers = (nextVisible: string[]) => {
    emit({
      ...config,
      badRequestMarkers: fieldFromVisible(nextVisible, DEFAULT_BAD_REQUEST_MARKERS),
    });
  };

  const toggleFiveXx = (checked: boolean) => {
    emit({ ...config, fiveXxIsBadInput: checked });
  };

  const toggleExplicitDefault = (checked: boolean) => {
    if (checked) {
      // Record the sentinel on both marker fields; clear any concrete overrides
      // so the choice reads cleanly as "use the built-in vocabulary".
      onChange({
        notFoundMarkers: USE_BUILT_IN_DEFAULTS,
        badRequestMarkers: USE_BUILT_IN_DEFAULTS,
      });
    } else {
      // Back to untouched (also the built-in vocabulary, but NOT the explicit
      // sentinel) so the operator can start editing markers again.
      onChange(null);
    }
  };

  const addStatusOverride = () => {
    const code = Number(statusDraft.trim());
    if (!Number.isFinite(code) || code <= 0) {
      setStatusDraft('');
      return;
    }
    emit({
      ...config,
      notFoundMarkers: isExplicitDefault ? undefined : config.notFoundMarkers,
      badRequestMarkers: isExplicitDefault ? undefined : config.badRequestMarkers,
      statusBucketOverride: {
        ...(config.statusBucketOverride ?? {}),
        [code]: 'success',
      },
    });
    setStatusDraft('');
  };

  const setStatusBucket = (
    code: number,
    bucket: BehaviourBucket | UseBuiltInDefaults,
  ) => {
    emit({
      ...config,
      statusBucketOverride: {
        ...(config.statusBucketOverride ?? {}),
        [code]: bucket,
      },
    });
  };

  const removeStatusOverride = (code: number) => {
    const next = { ...(config.statusBucketOverride ?? {}) };
    delete next[code];
    emit({ ...config, statusBucketOverride: next });
  };

  return (
    <>
      <p className={styles.helperText}>
        Confirm how this API&apos;s responses map to outcomes so &quot;covered&quot;
        reflects its real contract. These are <strong>editable defaults</strong>:
        leave them as-is to use the built-in vocabulary, or tell the tool how this
        legacy API actually behaves (e.g. it returns 200 for a missing resource,
        or 5xx for invalid input). This is configuration only — it changes how
        captures are <em>classified</em>, never which responses are recorded.
      </p>

      <label
        className={styles.helperText}
        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
      >
        <input
          type="checkbox"
          checked={isExplicitDefault}
          onChange={(e) => toggleExplicitDefault(e.target.checked)}
          data-testid="behaviour-semantics-use-defaults"
        />
        {USE_BUILT_IN_DEFAULTS}
      </label>
      {isExplicitDefault && (
        <span
          className={styles.helperText}
          data-testid="behaviour-semantics-use-defaults-hint"
        >
          Recorded as a deliberate choice to use the built-in vocabulary (distinct
          from an untouched config). Uncheck to customise the markers.
        </span>
      )}

      <MarkerListEditor
        idBase="behaviour-semantics-not-found"
        label="not_found markers (body text that means a missing resource)"
        markers={notFound}
        defaults={DEFAULT_NOT_FOUND_MARKERS}
        disabled={isExplicitDefault}
        onChangeMarkers={setNotFoundMarkers}
        styles={styles}
      />

      <MarkerListEditor
        idBase="behaviour-semantics-bad-request"
        label="bad_request markers (body text that means bad input / validation failure)"
        markers={badRequest}
        defaults={DEFAULT_BAD_REQUEST_MARKERS}
        disabled={isExplicitDefault}
        onChangeMarkers={setBadRequestMarkers}
        styles={styles}
      />

      <label
        className={styles.label}
        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
      >
        <input
          type="checkbox"
          checked={config.fiveXxIsBadInput === true}
          onChange={(e) => toggleFiveXx(e.target.checked)}
          data-testid="behaviour-semantics-five-xx"
        />
        This API returns 5xx for invalid input
      </label>
      <span className={styles.helperText}>
        When unchecked (the safe default), an unrecognised 5xx is treated as a
        possible crash — a non-scoring observation, never silently &quot;covered&quot;.
      </span>

      <div
        className={styles.fieldGroup}
        data-testid="behaviour-semantics-status-overrides"
      >
        <label className={styles.label}>
          Status → bucket overrides (optional)
        </label>
        <span className={styles.helperText}>
          Force a specific HTTP status to a bucket when this API uses it
          unconventionally. Highest precedence; leave empty to rely on markers +
          status class.
        </span>
        <div className={styles.operationList}>
          {statusOverrides.length === 0 && (
            <span
              className={styles.helperText}
              data-testid="behaviour-semantics-status-overrides-empty"
            >
              (no status overrides)
            </span>
          )}
          {statusOverrides.map(([code, bucket]) => (
            <div
              key={code}
              className={styles.operationItem}
              data-testid={`behaviour-semantics-status-override-${code}`}
            >
              <strong>{code}</strong>
              <select
                className={styles.select}
                value={bucket}
                onChange={(e) =>
                  setStatusBucket(
                    code,
                    e.target.value as BehaviourBucket | UseBuiltInDefaults,
                  )
                }
                data-testid={`behaviour-semantics-status-override-bucket-${code}`}
                aria-label={`Bucket for status ${code}`}
              >
                {BUCKET_OPTIONS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
                <option value={USE_BUILT_IN_DEFAULTS}>{USE_BUILT_IN_DEFAULTS}</option>
              </select>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => removeStatusOverride(code)}
                data-testid={`behaviour-semantics-status-override-remove-${code}`}
                aria-label={`Remove status override ${code}`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <input
            type="number"
            className={styles.input}
            value={statusDraft}
            placeholder="HTTP status (e.g. 200)"
            onChange={(e) => setStatusDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addStatusOverride();
              }
            }}
            data-testid="behaviour-semantics-status-override-add-input"
            aria-label="Add a status override"
          />
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={statusDraft.trim().length === 0}
            onClick={addStatusOverride}
            data-testid="behaviour-semantics-status-override-add-button"
          >
            Add status
          </button>
        </div>
      </div>
    </>
  );
}

export default BehaviourSemanticsConfigStep;
