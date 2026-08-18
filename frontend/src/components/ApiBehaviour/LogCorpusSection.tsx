/**
 * LogCorpusSection — the Application-log capture source (Capture-State
 * Discipline & Log-Replay program, Spec 6, 2026-08-18).
 *
 * Upload an application log -> the gateway proxies to the discovery-service
 * replay-corpus extractor (Spec 5) -> render the honest FUNNEL (lines ->
 * parsed -> matched -> useful with per-reason discards), the staging table of
 * USEFUL requests grouped by endpoint, the unmatched-endpoints diagnostic
 * (missed-endpoint evidence), and the
 * "[ ] Include application log generated in initial reconciliation"
 * checkbox with the useful-request count beside it (the operator decides
 * merge-vs-separate SEEING the volume).
 *
 * ZERO useful requests -> the source was ABANDONED server-side (nothing
 * persisted); the banner says so loudly and the parent blocks /start when
 * the log was the only source.
 *
 * State is LIFTED: the parent wizard owns the extract result + the include
 * flag (both feed /start); this component owns only the transient
 * upload/extract UI state.
 */

import React, { useCallback, useMemo } from 'react';
import { extractLogReplayCorpus } from '../../api/discoveryApi';
import {
  splitCorpusForPreFire,
  type LogCorpusExtractResponse,
} from './logCorpusRunSupport';
import styles from './LogCorpusSection.module.css';

export interface LogCorpusSectionProps {
  projectId: string;
  architectureId: string;
  corpusResult: LogCorpusExtractResponse | null;
  onCorpusResult: (result: LogCorpusExtractResponse | null) => void;
  includeInInitial: boolean;
  onIncludeInInitialChange: (value: boolean) => void;
  /**
   * The include-in-initial checkbox only makes sense at WIZARD time (the
   * append modal stages for round 2 / fires immediately instead). Default
   * true.
   */
  showIncludeCheckbox?: boolean;
}

export function LogCorpusSection({
  projectId,
  architectureId,
  corpusResult,
  onCorpusResult,
  includeInInitial,
  onIncludeInInitialChange,
  showIncludeCheckbox = true,
}: LogCorpusSectionProps): React.ReactElement {
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [extracting, setExtracting] = React.useState(false);
  const [extractError, setExtractError] = React.useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File | null) => {
      setExtractError(null);
      onCorpusResult(null);
      if (!file) {
        setFileName(null);
        return;
      }
      setFileName(file.name);
      setExtracting(true);
      try {
        const text = await file.text();
        const result = (await extractLogReplayCorpus(projectId, architectureId, {
          logContent: text,
          fileName: file.name,
        })) as LogCorpusExtractResponse;
        onCorpusResult(result);
      } catch (err) {
        setExtractError(err instanceof Error ? err.message : String(err));
      } finally {
        setExtracting(false);
      }
    },
    [projectId, architectureId, onCorpusResult],
  );

  const items = corpusResult?.items ?? [];
  const usefulCount = corpusResult?.funnel?.useful ?? 0;

  const groups = useMemo(() => {
    const byEndpoint = new Map<
      string,
      { method: string; template: string; requests: number; occurrences: number }
    >();
    for (const item of items) {
      const key = `${item.method} ${item.path_template}`;
      const group = byEndpoint.get(key) ?? {
        method: item.method,
        template: item.path_template,
        requests: 0,
        occurrences: 0,
      };
      group.requests += 1;
      group.occurrences += item.occurrence_count;
      byEndpoint.set(key, group);
    }
    return [...byEndpoint.values()].sort((a, b) =>
      `${a.method} ${a.template}`.localeCompare(`${b.method} ${b.template}`),
    );
  }, [items]);

  const { heldMutating } = useMemo(() => splitCorpusForPreFire(items), [items]);

  return (
    <div className={styles.section} data-testid="log-corpus-section">
      <div className={styles.fieldGroup}>
        <label className={styles.label}>Application log file</label>
        <p className={styles.helperText}>
          Access-log lines (URL grade) make every logged read replayable;
          structured logs with request bodies add the writes. Logged responses
          are never used as oracles.
        </p>
        <input
          type="file"
          onChange={(e) => void handleFile(e.target.files ? e.target.files[0] : null)}
          data-testid="log-corpus-file"
        />
        {fileName && <span className={styles.helperText}>{fileName}</span>}
        {extracting && <span className={styles.helperText}>Extracting…</span>}
      </div>

      {extractError && (
        <div className={styles.errorBanner} role="alert" data-testid="log-corpus-error">
          {extractError}
        </div>
      )}

      {corpusResult && corpusResult.abandoned && (
        <div
          className={styles.warnBanner}
          role="alert"
          data-testid="log-corpus-abandoned"
        >
          No useful requests were found in this log — the source is ABANDONED for
          reconciliation purposes. {corpusResult.message ?? ''}
        </div>
      )}

      {corpusResult && (
        <div className={styles.funnel} data-testid="log-corpus-funnel">
          <span>
            Funnel: {corpusResult.funnel.lines_total} lines →{' '}
            {corpusResult.funnel.observations_parsed} parsed →{' '}
            {corpusResult.funnel.matched_endpoint} matched an endpoint →{' '}
            {corpusResult.funnel.useful} useful ({corpusResult.funnel.deduplicated_into}{' '}
            after dedup)
          </span>
          <span className={styles.helperText}>
            Discarded: {corpusResult.funnel.discarded_no_matching_endpoint} unmatched
            endpoint, {corpusResult.funnel.discarded_no_request_body} write calls with no
            logged body. Format: {corpusResult.funnel.format_detected} (
            {corpusResult.funnel.parse_mode}).
          </span>
        </div>
      )}

      {corpusResult && corpusResult.funnel.unmatched_endpoints.length > 0 && (
        <div className={styles.gaps} data-testid="log-corpus-gaps">
          <span className={styles.label}>
            Logged calls the committed model does not know (
            {corpusResult.funnel.unmatched_endpoints.length}) — missed-endpoint
            evidence:
          </span>
          <ul>
            {corpusResult.funnel.unmatched_endpoints.slice(0, 12).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {groups.length > 0 && (
        <table className={styles.stagingTable} data-testid="log-corpus-staging">
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Distinct requests</th>
              <th>Logged occurrences</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={`${g.method} ${g.template}`}>
                <td>
                  {g.method} {g.template}
                </td>
                <td>{g.requests}</td>
                <td>{g.occurrences}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showIncludeCheckbox && corpusResult && !corpusResult.abandoned && (
        <label className={styles.includeRow} data-testid="log-corpus-include-initial">
          <input
            type="checkbox"
            checked={includeInInitial}
            onChange={(e) => onIncludeInInitialChange(e.target.checked)}
          />
          <span>
            Include application log generated in initial reconciliation (
            {usefulCount} useful request{usefulCount === 1 ? '' : 's'} — replayed on
            EVERY reconcile run). Unticked, the corpus stays staged for a separate
            reconciliation round 2.
          </span>
        </label>
      )}

      {includeInInitial && heldMutating.length > 0 && (
        <p className={styles.helperText} data-testid="log-corpus-held-mutating">
          {heldMutating.length} mutating log request
          {heldMutating.length === 1 ? '' : 's'} will NOT pre-fire (concrete sends run
          outside compensation brackets); the LLM captures those endpoints under the
          state discipline instead.
        </p>
      )}
    </div>
  );
}
