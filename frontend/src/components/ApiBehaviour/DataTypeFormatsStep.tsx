/**
 * DataTypeFormatsStep
 *
 * Spec: 2026-06-20 Capture data-type format defaults -- Task Group 6.
 *
 * The wizard's NEW Step 5 "Data-type formats" body. The operator reviews and
 * confirms a per-data-type format default (Col 4), pre-filled from real
 * code/contract evidence returned by the amvs
 * `data-type-defaults-preview` endpoint. Whatever sits in Col 4 when the
 * operator advances becomes the "try-this-first" nudge fed to the capture LLM.
 *
 * This is a presentational sub-component so the (large, high-clobber-risk)
 * wizard file only carries the step WIRING. It owns no fetch and no
 * persistence -- the parent fetches the preview, seeds the value map, persists
 * on advance, and passes the rows + current values + an onChange callback in.
 *
 * 4 columns (F2):
 *   Data Type | Code Format(s) | Contract Format(s) | Default Format
 *     - Cols 2/3 are READ-ONLY evidence.
 *     - Col 4 is an editable autocomplete (HTML `<datalist>` -- free text is
 *       accepted, NO validation) seeded from `default_format`. Its options are
 *       the union of the row's distinct code+contract formats plus a small
 *       per-category standards list.
 *     - An explicit "(no default)" choice records `null` for that category
 *       (a deliberate decision distinct from the seed and from an untouched
 *       row): the run gets NO operator nudge for that type.
 *
 * Per-row expandable transparency (Q9) lists the contributing fields
 * (name + location + raw code/contract format) that fed the row.
 */

import React, { useState } from 'react';
import type {
  DataTypeDefaultsPreviewRow,
  DataTypeDefaultsContributingField,
} from '../../api/apiBehaviourClient';

/**
 * The current Col-4 value map the operator is editing, keyed by category.
 *   - a non-null string => the operator default
 *   - `null`            => explicit "no default"
 *   - an ABSENT key     => untouched (the parent seeds every discovered row,
 *                          so in practice keys are present once seeded)
 */
export type DataTypeDefaultsValues = Record<string, string | null>;

export interface DataTypeFormatsStepProps {
  /** Classified rows from the preview -- ONE per discovered category. */
  rows: DataTypeDefaultsPreviewRow[];
  /** Current Col-4 values (category -> string | null). */
  values: DataTypeDefaultsValues;
  /**
   * Edit callback. `value === null` records the explicit "(no default)"
   * choice; a string (incl. "") records that string as the default.
   */
  onChange: (category: string, value: string | null) => void;
  /** The wizard's CSS-module styles object (CSS modules are file-scoped). */
  styles: Record<string, string>;
  /** True while the parent is (re)fetching the preview. */
  loading?: boolean;
}

/**
 * Small per-category standards list folded into the autocomplete options
 * (Q6). These are common, sensible formats for each bucket -- NOT validation
 * and NOT a forced choice; the operator may free-type anything else.
 */
const CATEGORY_STANDARDS: Record<string, string[]> = {
  date: ['yyyy-MM-dd', 'dd-MMM-yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy'],
  datetime: [
    "yyyy-MM-dd'T'HH:mm:ss",
    "yyyy-MM-dd'T'HH:mm:ssXXX",
    'yyyy-MM-dd HH:mm:ss',
  ],
  time: ['HH:mm:ss', 'HH:mm'],
  decimal: ['0.00', '#,##0.00'],
  numeric_id: ['integer'],
  string_id: ['string'],
  uuid: ['uuid'],
  boolean: ['true/false'],
  enum: [],
  string: [],
};

/** Sentinel for the explicit "(no default)" autocomplete choice. */
const NO_DEFAULT_LABEL = '(no default)';

/** Human label for a contributing field's location. */
function describeLocation(loc: string | null): string {
  return loc && loc.trim().length > 0 ? loc : 'unknown';
}

function ContributingFieldRow({
  field,
}: {
  field: DataTypeDefaultsContributingField;
}): React.ReactElement {
  const raw =
    field.code_format != null
      ? `code: ${field.code_format}`
      : field.contract_format != null
        ? `contract: ${field.contract_format}`
        : 'no format';
  return (
    <li>
      <strong>{field.name}</strong>{' '}
      <span>({describeLocation(field.location)})</span> — {raw}
    </li>
  );
}

function DataTypeRow({
  row,
  value,
  onChange,
  styles,
}: {
  row: DataTypeDefaultsPreviewRow;
  value: string | null | undefined;
  onChange: (category: string, value: string | null) => void;
  styles: Record<string, string>;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const isNoDefault = value === null;
  // The text input shows the chosen string (or empty when "(no default)"); the
  // explicit no-default state is surfaced separately so a deliberate "no
  // default" never looks like an accidental blank.
  const textValue = typeof value === 'string' ? value : '';

  const listId = `dtf-options-${row.category}`;
  // Autocomplete options: union of distinct code+contract formats + the small
  // per-category standards list (Q6). De-duplicated, blanks dropped.
  const options = Array.from(
    new Set(
      [
        ...row.code_formats,
        ...row.contract_formats,
        ...(CATEGORY_STANDARDS[row.category] ?? []),
      ].filter((o) => typeof o === 'string' && o.trim().length > 0),
    ),
  );

  const fmtList = (vals: string[]): React.ReactNode =>
    vals.length > 0 ? (
      vals.join(', ')
    ) : (
      <span className={styles.helperText}>—</span>
    );

  return (
    <div
      className={styles.operationItem}
      data-testid={`start-capture-session-wizard-data-type-row-${row.category}`}
      style={{ display: 'block' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.2fr 1.5fr 1.5fr 2fr',
          gap: '8px',
          alignItems: 'center',
        }}
      >
        <div>
          <strong>{row.category}</strong>
        </div>
        <div
          data-testid={`start-capture-session-wizard-data-type-code-${row.category}`}
        >
          {fmtList(row.code_formats)}
        </div>
        <div
          data-testid={`start-capture-session-wizard-data-type-contract-${row.category}`}
        >
          {fmtList(row.contract_formats)}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <input
            type="text"
            className={styles.input}
            list={listId}
            value={textValue}
            placeholder={NO_DEFAULT_LABEL}
            disabled={isNoDefault}
            onChange={(e) => onChange(row.category, e.target.value)}
            data-testid={`start-capture-session-wizard-data-type-default-${row.category}`}
            aria-label={`Default format for ${row.category}`}
          />
          <datalist id={listId}>
            {options.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>
          <label
            className={styles.helperText}
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <input
              type="checkbox"
              checked={isNoDefault}
              onChange={(e) =>
                onChange(
                  row.category,
                  e.target.checked ? null : (row.default_format ?? ''),
                )
              }
              data-testid={`start-capture-session-wizard-data-type-no-default-${row.category}`}
            />
            {NO_DEFAULT_LABEL}
          </label>
          {isNoDefault && (
            <span
              className={styles.helperText}
              data-testid={`start-capture-session-wizard-data-type-no-default-hint-${row.category}`}
            >
              (no default — the run gets no operator nudge for this type)
            </span>
          )}
        </div>
      </div>

      {row.contributing_fields.length > 0 && (
        <div style={{ marginTop: '6px' }}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            data-testid={`start-capture-session-wizard-data-type-evidence-toggle-${row.category}`}
          >
            {expanded ? 'Hide' : 'Show'} contributing fields (
            {row.contributing_fields.length})
          </button>
          {expanded && (
            <ul
              className={styles.helperText}
              data-testid={`start-capture-session-wizard-data-type-evidence-${row.category}`}
              style={{ marginTop: '4px' }}
            >
              {row.contributing_fields.map((f, i) => (
                <ContributingFieldRow key={`${f.name}-${i}`} field={f} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function DataTypeFormatsStep({
  rows,
  values,
  onChange,
  styles,
  loading,
}: DataTypeFormatsStepProps): React.ReactElement {
  return (
    <>
      <p className={styles.helperText}>
        Confirm a default format per data type discovered in this API. The
        capture run tries the right format <strong>first</strong> instead of
        guessing — a field's own code-evidence still wins, and you can pick{' '}
        <em>{NO_DEFAULT_LABEL}</em> for a type you would rather leave to the
        contract.
      </p>

      {loading ? (
        <p
          className={styles.helperText}
          data-testid="start-capture-session-wizard-data-type-loading"
        >
          Analysing discovered data types…
        </p>
      ) : (
        <div
          className={styles.operationList}
          data-testid="start-capture-session-wizard-data-type-table"
        >
          <div
            className={styles.summaryKey}
            style={{
              display: 'grid',
              gridTemplateColumns: '1.2fr 1.5fr 1.5fr 2fr',
              gap: '8px',
              padding: '0 0 4px',
            }}
          >
            <div>Data Type</div>
            <div>Code Format(s)</div>
            <div>Contract Format(s)</div>
            <div>Default Format</div>
          </div>
          {rows.map((row) => (
            <DataTypeRow
              key={row.category}
              row={row}
              value={values[row.category]}
              onChange={onChange}
              styles={styles}
            />
          ))}
        </div>
      )}
    </>
  );
}

export default DataTypeFormatsStep;
