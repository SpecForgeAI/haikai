/**
 * Security Upload Wizard (Security health dashboard, 2026-07-19, Spec 2 of 3)
 *
 * The four-step upload wizard launched from the Security Overview screen:
 *
 *   1. Files    -- multi-file selection (GitLab vulnerability CSV/XLSX
 *                  exports); each file is parsed independently at the gateway
 *                  and appended into ONE report.
 *   2. Level    -- confirm the association level the file's linking column
 *                  binds to (application wired in v1; service / application
 *                  component reserved).
 *   3. Columns  -- the column matcher: generic attributes on the left, the
 *                  file's columns on the right. Pre-selected from the gateway
 *                  proposal overlaid with the project's last confirmed mapping
 *                  (prefill); required attributes (linking id, severity) are
 *                  pinned; the long tail sits behind "Add attribute".
 *   4. Values   -- the interactive value matcher: every DISTINCT linking value
 *                  auto-resolved against the model's applications (id / name /
 *                  abbreviation, then taught aliases); unresolved values get a
 *                  picker; leaving values unmatched is allowed (they feed the
 *                  Not-matched bucket). Confirmed manual picks are taught back
 *                  as project aliases so the next upload auto-resolves them.
 *
 * The wizard is stateless server-side: the File objects stay here and are
 * re-posted on the final ingest with the confirmed answers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MetaModel } from '../../types/model';
import {
  SecurityFindingsApiError,
  SecurityGenericAttribute,
  SecurityIngestSummary,
  SecurityLinkingResolution,
  SecurityParsePreview,
  getSecurityPrefill,
  ingestSecurityUpload,
  listSecurityAliases,
  parseSecurityUpload,
  upsertSecurityAliases,
} from '../../api/securityFindingsApi';
import {
  ASSOCIATION_LEVELS,
  DEFAULT_DISPLAY_LEVELS,
  LEVEL_ORDER,
  LevelEntityOption,
  SecurityAssociationLevel,
  buildLevelMatchIndex,
  entityOptionsForLevel,
  resolveAgainstIndex,
} from '../../utils/securityLevels';
import styles from './SecurityUploadWizard.module.css';

const NOT_MAPPED = '';

type WizardStep = 'files' | 'level' | 'columns' | 'values' | 'summary';

const STEP_ORDER: WizardStep[] = ['files', 'level', 'columns', 'values', 'summary'];
const STEP_LABELS: Record<WizardStep, string> = {
  files: 'Files',
  level: 'Association level',
  columns: 'Column mapping',
  values: 'Value matching',
  summary: 'Done',
};

/** How one distinct linking value is currently resolved. */
interface ValueResolution {
  entityId: string | null;
  /** exact = id/name/abbrev/repo-URL match; alias = taught memory; manual = user pick. */
  source: 'exact' | 'alias' | 'manual' | null;
}

/** The wizard's per-upload configuration handed back on completion. */
export interface SecurityWizardConfig {
  associationLevel: SecurityAssociationLevel;
  displayLevels: SecurityAssociationLevel[];
}

interface SecurityUploadWizardProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  architectureId: string;
  metaModel: MetaModel;
  /** Prefill for the display-levels chooser (from the existing diagram's settings). */
  initialDisplayLevels?: SecurityAssociationLevel[];
  /** Called with the ingest summary + the confirmed config after a successful upload. */
  onComplete: (summary: SecurityIngestSummary, config: SecurityWizardConfig) => void;
}

export function SecurityUploadWizard({
  isOpen,
  onClose,
  projectId,
  architectureId,
  metaModel,
  initialDisplayLevels,
  onComplete,
}: SecurityUploadWizardProps) {
  const [step, setStep] = useState<WizardStep>('files');
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<SecurityParsePreview | null>(null);
  const [prefillMapping, setPrefillMapping] = useState<Record<string, string> | null>(null);
  const [level, setLevel] = useState<SecurityAssociationLevel>('application');
  const [displayLevels, setDisplayLevels] = useState<SecurityAssociationLevel[]>(
    initialDisplayLevels && initialDisplayLevels.length > 0
      ? initialDisplayLevels
      : DEFAULT_DISPLAY_LEVELS,
  );
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [visibleAttrs, setVisibleAttrs] = useState<Set<string>>(new Set());
  const [distinctValues, setDistinctValues] = useState<{ value: string; count: number }[]>([]);
  const [resolutions, setResolutions] = useState<Map<string, ValueResolution>>(new Map());
  const [summary, setSummary] = useState<SecurityIngestSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const entityOptions: LevelEntityOption[] = useMemo(
    () => entityOptionsForLevel(metaModel, level),
    [metaModel, level],
  );

  const entityOptionById = useMemo(() => {
    const map = new Map<string, LevelEntityOption>();
    for (const option of entityOptions) map.set(option.id, option);
    return map;
  }, [entityOptions]);

  // Reset + load the project memory (prefill mapping/level) each time the
  // wizard opens. Aliases are fetched level-aware when entering the value
  // matcher (the level may change in step 2).
  useEffect(() => {
    if (!isOpen) return;
    setStep('files');
    setFiles([]);
    setPreview(null);
    setMapping({});
    setDistinctValues([]);
    setResolutions(new Map());
    setSummary(null);
    setError(null);
    setDisplayLevels(
      initialDisplayLevels && initialDisplayLevels.length > 0
        ? initialDisplayLevels
        : DEFAULT_DISPLAY_LEVELS,
    );
    void (async () => {
      try {
        const prefill = await getSecurityPrefill(projectId);
        if (prefill?.association_level
            && LEVEL_ORDER.includes(prefill.association_level as SecurityAssociationLevel)) {
          setLevel(prefill.association_level as SecurityAssociationLevel);
        }
        setPrefillMapping(prefill?.column_mapping ?? null);
      } catch {
        // Memory is a convenience -- absence never blocks the wizard.
        setPrefillMapping(null);
      }
    })();
  }, [isOpen, projectId, initialDisplayLevels]);

  const genericAttributes: SecurityGenericAttribute[] = preview?.generic_attributes ?? [];

  /** The header currently mapped as the linking column (may differ from the proposal). */
  const linkingHeader = useMemo(
    () => Object.entries(mapping).find(([, attr]) => attr === 'linking_value')?.[0] ?? null,
    [mapping],
  );

  const requiredMapped =
    linkingHeader !== null && Object.values(mapping).includes('severity');

  // ------------------------------------------------------------------
  // Step transitions
  // ------------------------------------------------------------------

  const runParse = useCallback(
    async (selectedFiles: File[], linkingColumn?: string) => {
      const parsed = await parseSecurityUpload(
        projectId,
        architectureId,
        selectedFiles,
        linkingColumn,
      );
      setPreview(parsed);
      return parsed;
    },
    [projectId, architectureId],
  );

  const handleFilesNext = async () => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const parsed = await runParse(files);
      // Initial mapping: gateway proposal overlaid with the project's last
      // confirmed mapping (only where the header actually exists in this file).
      const initial: Record<string, string> = { ...parsed.proposed_mapping };
      if (prefillMapping) {
        const headerSet = new Set(parsed.headers);
        for (const [header, attr] of Object.entries(prefillMapping)) {
          if (headerSet.has(header)) initial[header] = attr;
        }
      }
      setMapping(initial);
      const mappedAttrs = new Set(Object.values(initial));
      setVisibleAttrs(
        new Set(
          parsed.generic_attributes
            .filter((a) => a.required || a.defaultVisible || mappedAttrs.has(a.name))
            .map((a) => a.name),
        ),
      );
      setStep('level');
    } catch (err) {
      setError(errorText(err, 'Failed to parse the selected file(s)'));
    } finally {
      setBusy(false);
    }
  };

  const handleColumnsNext = async () => {
    if (!requiredMapped || !linkingHeader || !preview) return;
    setBusy(true);
    setError(null);
    try {
      // Recompute distinct values when the user re-mapped the linking column.
      const parsed =
        linkingHeader === preview.linking_column
          ? preview
          : await runParse(files, linkingHeader);
      setDistinctValues(parsed.distinct_linking_values);
      // Level-aware auto-resolution: exact match (id / name / abbreviation /
      // normalized repo URL for services) first, then the level's taught
      // aliases. Alias absence never blocks.
      let aliasByValue = new Map<string, string>();
      try {
        const taught = await listSecurityAliases(projectId, level);
        aliasByValue = new Map(taught.map((a) => [a.alias_value.toLowerCase(), a.entity_id]));
      } catch {
        // fall through -- exact matching still works
      }
      const index = buildLevelMatchIndex(metaModel, level);
      const next = new Map<string, ValueResolution>();
      for (const { value } of parsed.distinct_linking_values) {
        const exact = resolveAgainstIndex(index, level, value);
        if (exact) {
          next.set(value, { entityId: exact, source: 'exact' });
          continue;
        }
        const aliasTarget = aliasByValue.get(value.toLowerCase());
        if (aliasTarget && entityOptionById.has(aliasTarget)) {
          next.set(value, { entityId: aliasTarget, source: 'alias' });
          continue;
        }
        next.set(value, { entityId: null, source: null });
      }
      setResolutions(next);
      setStep('values');
    } catch (err) {
      setError(errorText(err, 'Failed to extract linking values'));
    } finally {
      setBusy(false);
    }
  };

  const handleFinish = async () => {
    setBusy(true);
    setError(null);
    try {
      // Teach manual picks back as LEVEL-SCOPED project aliases (living
      // memory: the next upload auto-resolves them). Exact/alias resolutions
      // need no teaching.
      const toTeach = Array.from(resolutions.entries())
        .filter(([, r]) => r.source === 'manual' && r.entityId)
        .map(([value, r]) => ({
          alias_value: value,
          entity_id: r.entityId as string,
          entity_name: entityOptionById.get(r.entityId as string)?.name ?? null,
        }));
      if (toTeach.length > 0) {
        await upsertSecurityAliases(projectId, level, toTeach);
      }
      const wireResolutions: SecurityLinkingResolution[] = Array.from(
        resolutions.entries(),
      ).map(([value, r]) => ({
        linking_value: value,
        entity_id: r.entityId,
        match_status: r.entityId === null ? 'unmatched' : r.source === 'manual' ? 'manual' : 'auto',
      }));
      const result = await ingestSecurityUpload(
        projectId,
        architectureId,
        files,
        mapping,
        level,
        wireResolutions,
      );
      setSummary(result);
      setStep('summary');
      onComplete(result, { associationLevel: level, displayLevels });
    } catch (err) {
      setError(errorText(err, 'Upload failed'));
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------

  if (!isOpen) return null;

  const matchedCount = Array.from(resolutions.values()).filter(
    (r) => r.entityId !== null,
  ).length;

  const attributeRows = genericAttributes.filter((a) => visibleAttrs.has(a.name));
  const hiddenAttributes = genericAttributes.filter((a) => !visibleAttrs.has(a.name));

  const setAttributeHeader = (attribute: string, header: string) => {
    setMapping((prev) => {
      const next: Record<string, string> = {};
      // Drop the attribute's old header and any competing claim on the new header.
      for (const [h, attr] of Object.entries(prev)) {
        if (attr === attribute) continue;
        if (h === header) continue;
        next[h] = attr;
      }
      if (header !== NOT_MAPPED) next[header] = attribute;
      return next;
    });
  };

  const headerForAttribute = (attribute: string): string =>
    Object.entries(mapping).find(([, attr]) => attr === attribute)?.[0] ?? NOT_MAPPED;

  return (
    <div className={styles.overlay} onClick={busy ? undefined : onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Upload security findings</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={styles.stepBar}>
          {STEP_ORDER.map((s, i) => (
            <div
              key={s}
              className={`${styles.stepChip} ${s === step ? styles.stepActive : ''} ${
                STEP_ORDER.indexOf(step) > i ? styles.stepDone : ''
              }`}
            >
              {i + 1}. {STEP_LABELS[s]}
            </div>
          ))}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.body}>
          {step === 'files' && (
            <div>
              <p className={styles.hint}>
                Select one or more scanner export files (CSV or XLSX). Multiple files are
                appended and processed as one report.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".csv,.xlsx,.xlsm"
                onChange={(e) => {
                  const chosen = Array.from(e.target.files ?? []);
                  if (chosen.length > 0) {
                    setFiles((prev) => {
                      const names = new Set(prev.map((f) => f.name));
                      return [...prev, ...chosen.filter((f) => !names.has(f.name))];
                    });
                  }
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              />
              {files.length > 0 && (
                <ul className={styles.fileList}>
                  {files.map((file) => (
                    <li key={file.name}>
                      <span>{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((f) => f !== file))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {step === 'level' && (
            <div>
              <p className={styles.hint}>
                Which level of the application hierarchy does this file&apos;s linking column
                refer to? Severity counts attach at this level and roll up to whatever the
                summary diagram displays.
              </p>
              {ASSOCIATION_LEVELS.map((option) => (
                <label key={option.value} className={styles.levelOption}>
                  <input
                    type="radio"
                    name="association-level"
                    checked={level === option.value}
                    onChange={() => {
                      setLevel(option.value);
                      setResolutions(new Map());
                    }}
                  />
                  {option.label}
                </label>
              ))}
              <p className={styles.hint} style={{ marginTop: 16 }}>
                Which levels should the summary diagram display? Multiple levels render as
                nested boxes; this is saved on the diagram and changeable later via
                Regenerate.
              </p>
              {ASSOCIATION_LEVELS.map((option) => (
                <label key={`display-${option.value}`} className={styles.levelOption}>
                  <input
                    type="checkbox"
                    checked={displayLevels.includes(option.value)}
                    onChange={(e) => {
                      setDisplayLevels((prev) => {
                        const next = e.target.checked
                          ? [...prev, option.value]
                          : prev.filter((l) => l !== option.value);
                        // At least one level stays displayed; keep chain order.
                        const ordered = LEVEL_ORDER.filter((l) => next.includes(l));
                        return ordered.length > 0 ? ordered : prev;
                      });
                    }}
                  />
                  Show {option.label.toLowerCase()} boxes
                </label>
              ))}
            </div>
          )}

          {step === 'columns' && preview && (
            <div>
              <p className={styles.hint}>
                Match the tool&apos;s attributes (left) to your file&apos;s columns (right).
                Pre-selected from the file shape and your last confirmed mapping.
              </p>
              <table className={styles.matcherTable}>
                <thead>
                  <tr>
                    <th>Tool attribute</th>
                    <th>File column</th>
                  </tr>
                </thead>
                <tbody>
                  {attributeRows.map((attr) => (
                    <tr key={attr.name}>
                      <td>
                        {attr.label}
                        {attr.required && <span className={styles.required}> *</span>}
                      </td>
                      <td>
                        <select
                          value={headerForAttribute(attr.name)}
                          onChange={(e) => setAttributeHeader(attr.name, e.target.value)}
                        >
                          <option value={NOT_MAPPED}>— not mapped —</option>
                          {preview.headers.map((header) => (
                            <option key={header} value={header}>
                              {header}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hiddenAttributes.length > 0 && (
                <select
                  className={styles.addAttribute}
                  value=""
                  onChange={(e) => {
                    const name = e.target.value;
                    if (name) setVisibleAttrs((prev) => new Set(prev).add(name));
                  }}
                >
                  <option value="">Add attribute…</option>
                  {hiddenAttributes.map((attr) => (
                    <option key={attr.name} value={attr.name}>
                      {attr.label}
                    </option>
                  ))}
                </select>
              )}
              {!requiredMapped && (
                <div className={styles.hint}>
                  Linking id and Severity must be mapped to continue.
                </div>
              )}
            </div>
          )}

          {step === 'values' && (
            <div>
              <p className={styles.hint}>
                {matchedCount} of {distinctValues.length} distinct linking values matched.
                Unmatched values are kept and shown in the &quot;Not matched&quot; bucket on
                the summary diagram. Manual picks are remembered for future uploads.
              </p>
              <table className={styles.matcherTable}>
                <thead>
                  <tr>
                    <th>Value in file</th>
                    <th>Rows</th>
                    <th>{ASSOCIATION_LEVELS.find((l) => l.value === level)?.label}</th>
                    <th>How</th>
                  </tr>
                </thead>
                <tbody>
                  {distinctValues.map(({ value, count }) => {
                    const resolution = resolutions.get(value) ?? {
                      entityId: null,
                      source: null,
                    };
                    return (
                      <tr key={value}>
                        <td className={styles.valueCell}>{value}</td>
                        <td>{count}</td>
                        <td>
                          <select
                            value={resolution.entityId ?? ''}
                            onChange={(e) => {
                              const entityId = e.target.value || null;
                              setResolutions((prev) => {
                                const next = new Map(prev);
                                next.set(value, {
                                  entityId,
                                  source: entityId ? 'manual' : null,
                                });
                                return next;
                              });
                            }}
                          >
                            <option value="">— leave unmatched —</option>
                            {entityOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}
                                {option.contextLabel ? ` — ${option.contextLabel}` : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <span
                            className={`${styles.badge} ${
                              resolution.entityId
                                ? styles.badgeMatched
                                : styles.badgeUnmatched
                            }`}
                          >
                            {resolution.entityId
                              ? resolution.source === 'exact'
                                ? 'exact'
                                : resolution.source === 'alias'
                                  ? 'remembered'
                                  : 'manual'
                              : 'unmatched'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {step === 'summary' && summary && (
            <div className={styles.summary}>
              <h3>Upload complete</h3>
              <ul>
                <li>
                  Files: <strong>{summary.original_filenames.join(', ')}</strong>
                </li>
                <li>
                  Findings ingested: <strong>{summary.row_count_ingested}</strong> (
                  {summary.row_count_dropped} dropped)
                </li>
                <li>
                  Matched to applications: <strong>{summary.matched_count}</strong> /{' '}
                  {summary.matched_count + summary.unmatched_count}
                </li>
                <li>
                  Distinct CVEs: <strong>{summary.distinct_cves}</strong> · Distinct CWEs:{' '}
                  <strong>{summary.distinct_cwes}</strong>
                </li>
              </ul>
              <p className={styles.hint}>
                CVE details are being enriched from public sources in the background; the
                register works immediately either way.
              </p>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {step !== 'files' && step !== 'summary' && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setStep(STEP_ORDER[Math.max(0, STEP_ORDER.indexOf(step) - 1)])
              }
            >
              Back
            </button>
          )}
          <div className={styles.footerSpacer} />
          {step === 'files' && (
            <button
              type="button"
              className={styles.primary}
              disabled={files.length === 0 || busy}
              onClick={() => void handleFilesNext()}
            >
              {busy ? 'Parsing…' : 'Next'}
            </button>
          )}
          {step === 'level' && (
            <button
              type="button"
              className={styles.primary}
              onClick={() => setStep('columns')}
            >
              Next
            </button>
          )}
          {step === 'columns' && (
            <button
              type="button"
              className={styles.primary}
              disabled={!requiredMapped || busy}
              onClick={() => void handleColumnsNext()}
            >
              {busy ? 'Working…' : 'Next'}
            </button>
          )}
          {step === 'values' && (
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => void handleFinish()}
            >
              {busy ? 'Uploading…' : 'Finish upload'}
            </button>
          )}
          {step === 'summary' && (
            <button type="button" className={styles.primary} onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof SecurityFindingsApiError) return `${fallback}: ${err.message}`;
  if (err instanceof Error) return `${fallback}: ${err.message}`;
  return fallback;
}
