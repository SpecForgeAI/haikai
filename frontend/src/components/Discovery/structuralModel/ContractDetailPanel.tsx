/**
 * ContractDetailPanel — the Structural Model tab's drill-in view for ONE SCL
 * contract (2026-08-18 SCL pipeline design, "UI placement" ruling).
 *
 * Fetches the FULL contract (body included) whenever `contractKey` changes and
 * renders it per kind:
 *
 *   - behaviour table → the gloss intent (when annotated) + an actual HTML
 *     table: # / kind / condition (code-styled `conditionVerbatim` + path:line
 *     cite) / outcome (terminal: verbatim + label; call: targetSymbol as a
 *     LINK navigating the browser to the target contract; absorb:
 *     exceptionType + thenVerbatim) / gloss (the annotation pass's
 *     `row_glosses`, falling back to the row's own `gloss`);
 *   - shape → representation + flag chips + fields table (name / kind with
 *     S-refs as links / nullable / wireName / sourceCarrier / notes);
 *   - boundary → operations table (name / verbatim SQL in a pre block /
 *     resultShape link).
 *
 * The "Explain" button calls the gateway explain route (plain LLM prose,
 * never persisted) with loading + error states.
 *
 * Contract navigation (call-links, S-ref links, resultShape links) goes
 * through `onNavigate(contractKey)` — the parent swaps the selected key and
 * this panel refetches.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  explainContract as defaultExplainContract,
  getContract as defaultGetContract,
  type SclBehaviourRow,
  type SclBehaviourTableBody,
  type SclBoundaryBody,
  type SclContract,
  type SclShapeBody,
} from '../../../api/sclCorpusApi';
import styles from './StructuralModelTab.module.css';

// Injectable api seam (tests mock the api module directly; the indirection
// keeps this panel consistent with the parent tab's deps posture).
export interface ContractDetailPanelDeps {
  getContract: typeof defaultGetContract;
  explainContract: typeof defaultExplainContract;
}

const defaultDeps: ContractDetailPanelDeps = {
  getContract: (...args) => defaultGetContract(...args),
  explainContract: (...args) => defaultExplainContract(...args),
};

export interface ContractDetailPanelProps {
  projectId: string;
  architectureId: string;
  scanId: string;
  contractKey: string;
  /** Navigate the browser to another contract (call-links / S-ref links). */
  onNavigate: (contractKey: string) => void;
  deps?: ContractDetailPanelDeps;
}

/** First SCL contract key embedded in a kind/resultShape string (e.g.
 * `ref:S-abc123def456` or `list<ref:S-...>`), or null. */
export function embeddedContractKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/[TSQF]-[0-9a-f]{6,}/);
  return match ? match[0] : null;
}

function citeText(ref: { path: string; line: number } | null | undefined): string | null {
  if (!ref) return null;
  return `${ref.path}:${ref.line}`;
}

export const ContractDetailPanel: React.FC<ContractDetailPanelProps> = ({
  projectId,
  architectureId,
  scanId,
  contractKey,
  onNavigate,
  deps = defaultDeps,
}) => {
  const [contract, setContract] = useState<SclContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContract(null);
    // A new contract means the previous explanation no longer applies.
    setExplanation(null);
    setExplainError(null);
    deps
      .getContract(projectId, architectureId, scanId, contractKey)
      .then((data) => {
        if (!cancelled) setContract(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load the contract');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deps, projectId, architectureId, scanId, contractKey]);

  const handleExplain = useCallback(async () => {
    setExplaining(true);
    setExplainError(null);
    try {
      const prose = await deps.explainContract(projectId, architectureId, scanId, contractKey);
      setExplanation(prose);
    } catch (err) {
      setExplainError(err instanceof Error ? err.message : 'Failed to explain the contract');
    } finally {
      setExplaining(false);
    }
  }, [deps, projectId, architectureId, scanId, contractKey]);

  const renderKeyLink = (value: string, testIdPrefix: string) => {
    const key = embeddedContractKey(value);
    if (!key) return <span className={styles.code}>{value}</span>;
    return (
      <button
        type="button"
        className={styles.linkButton}
        onClick={() => onNavigate(key)}
        data-testid={`${testIdPrefix}-${key}`}
      >
        {value}
      </button>
    );
  };

  const renderOutcome = (row: SclBehaviourRow) => {
    const outcome = row.outcome;
    if (!outcome) return null;
    if (outcome.type === 'terminal') {
      return (
        <>
          <span className={styles.code}>{outcome.verbatim}</span>
          <span className={styles.outcomeLabel}>{outcome.outcomeLabel}</span>
          {citeText(outcome.ref) && <span className={styles.cite}>{citeText(outcome.ref)}</span>}
        </>
      );
    }
    if (outcome.type === 'call') {
      if (outcome.targetKey) {
        return (
          <>
            <span>calls </span>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => onNavigate(outcome.targetKey as string)}
              data-testid={`call-link-${outcome.targetKey}`}
            >
              {outcome.targetSymbol}
            </button>
          </>
        );
      }
      return (
        <span>
          calls <span className={styles.code}>{outcome.targetSymbol}</span>{' '}
          <span className={styles.unreachableTag}>(unresolved)</span>
        </span>
      );
    }
    // absorb
    return (
      <>
        <span>
          absorbs <span className={styles.code}>{outcome.exceptionType}</span> →{' '}
          <span className={styles.code}>{outcome.thenVerbatim}</span>
        </span>
        <span className={styles.outcomeLabel}>{outcome.outcomeLabel}</span>
        {citeText(outcome.ref) && <span className={styles.cite}>{citeText(outcome.ref)}</span>}
      </>
    );
  };

  const renderBehaviourTable = (body: SclBehaviourTableBody, c: SclContract) => {
    const rowGlosses = c.gloss_json?.row_glosses ?? {};
    return (
      <>
        {c.gloss_json?.intent && (
          <p className={styles.intent} data-testid="contract-detail-intent">
            {c.gloss_json.intent}
          </p>
        )}
        <table className={styles.detailTable} data-testid="behaviour-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Kind</th>
              <th>Condition</th>
              <th>Outcome</th>
              <th>Gloss</th>
            </tr>
          </thead>
          <tbody>
            {(body.rows ?? []).map((row) => (
              <tr key={row.index} data-testid={`behaviour-row-${row.index}`}>
                <td>{row.index}</td>
                <td>{row.kind}</td>
                <td>
                  {row.conditionVerbatim !== null && row.conditionVerbatim !== undefined ? (
                    <>
                      <span className={styles.code}>{row.conditionVerbatim}</span>
                      {citeText(row.conditionRef) && (
                        <span className={styles.cite}>{citeText(row.conditionRef)}</span>
                      )}
                    </>
                  ) : (
                    <span className={styles.emptyMessage}>—</span>
                  )}
                </td>
                <td>{renderOutcome(row)}</td>
                <td className={styles.glossCell}>
                  {rowGlosses[String(row.index)] ?? row.gloss ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  };

  const renderShape = (body: SclShapeBody, c: SclContract) => (
    <>
      {c.gloss_json?.intent && (
        <p className={styles.intent} data-testid="contract-detail-intent">
          {c.gloss_json.intent}
        </p>
      )}
      <div>
        <span className={styles.detailMeta}>representation: {body.representation}</span>
      </div>
      {(body.flags ?? []).length > 0 && (
        <div data-testid="shape-flags">
          {body.flags.map((flag) => (
            <span key={flag} className={styles.flagChip}>
              {flag}
            </span>
          ))}
        </div>
      )}
      <table className={styles.detailTable} data-testid="shape-fields-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Nullable</th>
            <th>Wire name</th>
            <th>Source carrier</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {(body.fields ?? []).map((field) => (
            <tr key={field.name}>
              <td className={styles.code}>{field.name}</td>
              <td>{renderKeyLink(field.kind, 'shape-ref-link')}</td>
              <td>{field.nullable === null ? '?' : field.nullable ? 'yes' : 'no'}</td>
              <td>{field.wireName ?? ''}</td>
              <td className={styles.glossCell}>{field.sourceCarrier ?? ''}</td>
              <td className={styles.glossCell}>{(field.notes ?? []).join('; ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );

  const renderBoundary = (body: SclBoundaryBody) => (
    <table className={styles.detailTable} data-testid="boundary-operations-table">
      <thead>
        <tr>
          <th>Operation</th>
          <th>SQL</th>
          <th>Result shape</th>
        </tr>
      </thead>
      <tbody>
        {(body.operations ?? []).map((op) => (
          <tr key={op.name}>
            <td className={styles.code}>{op.name}</td>
            <td>
              {op.sqlVerbatim ? (
                <pre className={styles.sqlBlock}>{op.sqlVerbatim}</pre>
              ) : (
                <span className={styles.emptyMessage}>—</span>
              )}
              {citeText(op.ref) && <span className={styles.cite}>{citeText(op.ref)}</span>}
            </td>
            <td>{op.resultShape ? renderKeyLink(op.resultShape, 'result-shape-link') : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (loading) {
    return (
      <div className={styles.detailCard} data-testid="contract-detail-loading">
        Loading contract…
      </div>
    );
  }
  if (error) {
    return (
      <div className={styles.detailCard}>
        <p className={styles.errorBanner} data-testid="contract-detail-error">
          {error}
        </p>
      </div>
    );
  }
  if (!contract) return null;

  const body = contract.body_json;

  return (
    <div className={styles.detailCard} data-testid="contract-detail">
      <div className={styles.detailHeaderRow}>
        <h4 className={styles.detailSymbol}>{contract.source_symbol ?? contract.contract_key}</h4>
        <span className={styles.kindChip}>{contract.kind}</span>
        <span className={styles.detailMeta}>{contract.contract_key}</span>
      </div>
      <span className={styles.detailMeta}>{contract.source_path ?? ''}</span>

      {contract.kind === 'behaviour_table' && body && (
        renderBehaviourTable(body as SclBehaviourTableBody, contract)
      )}
      {contract.kind === 'shape' && body && renderShape(body as SclShapeBody, contract)}
      {contract.kind === 'boundary' && body && renderBoundary(body as SclBoundaryBody)}
      {!body && (
        <p className={styles.emptyMessage} data-testid="contract-detail-no-body">
          This contract has no stored body.
        </p>
      )}

      <button
        type="button"
        className={styles.explainButton}
        onClick={() => void handleExplain()}
        disabled={explaining}
        data-testid="explain-button"
      >
        {explaining ? 'Explaining…' : 'Explain'}
      </button>
      {explainError && (
        <p className={styles.errorBanner} data-testid="explain-error">
          {explainError}
        </p>
      )}
      {explanation !== null && !explainError && (
        <p className={styles.explanation} data-testid="explain-output">
          {explanation}
        </p>
      )}
    </div>
  );
};
