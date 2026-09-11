/**
 * Engine-portable SQL literal rendering for compensation statements
 * (Capture-State Discipline Spec 1).
 *
 * Values arrive exactly as the read adapters returned them (JSON scalars —
 * string / number / boolean / null; the Sybase sidecar wire deliberately
 * renders bigint/numeric and datetimes as STRINGS). Rendering is therefore
 * driven by the JS value type with a `sourceType` hint for numeric-as-string,
 * mirroring the type-aware keyset rendering the adapters already do
 * (2026-08-12): quoting a string-shaped numeric against a numeric column is
 * an engine type error on Sybase, so numeric-typed string values are emitted
 * RAW when they parse as plain numbers.
 *
 * Parameterised statements are NOT an option here — the Sybase sidecar's
 * /mutate endpoint (like /query) is literal-SQL only, and the same rendered
 * statement set must be reviewable/loggable verbatim. Strings are
 * quote-doubled; identifiers are guarded separately (`SAFE_IDENTIFIER` in the
 * runner).
 */

import type { CompensationEngine } from './types';

const NUMERIC_TYPE_FRAGMENTS = [
  'int',
  'numeric',
  'decimal',
  'float',
  'real',
  'double',
  'money',
  'bit',
];

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
/** SQL Server UTF-16 families: string literals render as N'…'. */
const NATIONAL_TYPE_FRAGMENTS = ['nchar', 'nvarchar', 'ntext', 'sysname', 'xml'];
/** Binary families: the `\x…` hex wire value renders as a 0x… literal on SQL Server. */
const BINARY_TYPE_FRAGMENTS = ['binary', 'varbinary', 'image', 'rowversion', 'timestamp'];
const HEX_WIRE = /^\\x([0-9a-fA-F]*)$/;

function hasFragment(sourceType: string | null | undefined, fragments: string[]): boolean {
  const t = (sourceType ?? '').toLowerCase();
  return fragments.some((f) => t.includes(f));
}

function isNumericType(sourceType: string | null | undefined): boolean {
  const t = (sourceType ?? '').toLowerCase();
  return NUMERIC_TYPE_FRAGMENTS.some((f) => t.includes(f));
}

/** Render ONE value as an engine literal. */
export function renderLiteral(
  value: unknown,
  engine: CompensationEngine,
  sourceType?: string | null,
): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'boolean') {
    // Sybase `bit` has no TRUE/FALSE keywords.
    return engine === 'postgres' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0';
  }
  if (typeof value === 'string') {
    if (isNumericType(sourceType) && PLAIN_NUMBER.test(value.trim())) {
      return value.trim();
    }
    if (engine === 'mssql') {
      const hex = hasFragment(sourceType, BINARY_TYPE_FRAGMENTS) ? HEX_WIRE.exec(value.trim()) : null;
      if (hex) return `0x${hex[1].toLowerCase()}`;
      const quoted = `'${value.replace(/'/g, "''")}'`;
      return hasFragment(sourceType, NATIONAL_TYPE_FRAGMENTS) ? `N${quoted}` : quoted;
    }
    return `'${value.replace(/'/g, "''")}'`;
  }
  // Objects/arrays should not appear in row reads; render defensively as a
  // JSON string literal rather than throwing mid-compensation.
  return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
}
