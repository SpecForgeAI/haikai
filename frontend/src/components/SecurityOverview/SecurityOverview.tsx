/**
 * Security Overview (Security health dashboard, 2026-07-19, Spec 3 of 3)
 *
 * The department health dashboard: the generated "Security Summary" diagram
 * (application boxes + data-movement edges, persisted as a REAL diagram and
 * editable in the Diagrams area) overlaid with per-application severity
 * circles computed AT RENDER TIME from the latest findings report -- a new
 * upload updates every circle with zero diagram edits.
 *
 * Actions: Upload findings (the Spec-2 wizard; requires a defined
 * architecture), Generate/Regenerate diagram (regeneration preserves the
 * user's surviving box layout), Load previous… (compact history modal --
 * deliberately near-zero footprint on this crowded screen), Open in Diagrams.
 *
 * Clicks deep-link into the Findings Register with the scope filter applied:
 * application box -> ?application_id=…, the Not-matched pseudo-box ->
 * ?match_status=unmatched, the heading -> unfiltered.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useActiveArchitectureId,
  useArchitecture,
  useArchitectureDispatch,
} from '../../contexts/ArchitectureContext';
import { useProject } from '../../contexts/ProjectContext';
import { normalizeDiagramType } from '../../types/diagramType';
import type { Diagram } from '../../types/model';
import { saveModelToBackend } from '../../utils/saveUtils';
import { generateSecuritySummaryDiagram } from '../../utils/securitySummaryDiagram';
import {
  DEFAULT_DISPLAY_LEVELS,
  LEVEL_ORDER,
  SecurityAssociationLevel,
} from '../../utils/securityLevels';
import {
  SecurityFindingReport,
  SecurityIngestSummary,
  SecurityRollup,
  getSecurityRollup,
  listSecurityReports,
} from '../../api/securityFindingsApi';
import { SecurityUploadWizard, SecurityWizardConfig } from './SecurityUploadWizard';
import styles from './SecurityOverview.module.css';

/** Severity order + circle colours (the existing screen's info..critical palette). */
const SEVERITY_CIRCLES: { key: string; fill: string; label: string }[] = [
  { key: 'critical', fill: '#991b1b', label: 'Critical' },
  { key: 'high', fill: '#9a3412', label: 'High' },
  { key: 'medium', fill: '#854d0e', label: 'Medium' },
  { key: 'low', fill: '#166534', label: 'Low' },
  { key: 'info', fill: '#1e40af', label: 'Info' },
];

export function SecurityOverview() {
  const state = useArchitecture();
  const dispatch = useArchitectureDispatch();
  const project = useProject();
  const architectureId = useActiveArchitectureId();
  const navigate = useNavigate();

  const [rollup, setRollup] = useState<SecurityRollup | null>(null);
  const [rollupError, setRollupError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SecurityFindingReport[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const metaModel = state.model.metaModel;
  const applications = metaModel.entities.applications;
  const hasArchitecture = Boolean(project?.id && architectureId && applications.length > 0);

  const summaryDiagram = useMemo(
    () =>
      state.model.diagrams.find(
        (d) => normalizeDiagramType(d.diagram_type) === 'SECURITY_SUMMARY',
      ) ?? null,
    [state.model.diagrams],
  );

  /**
   * The display-levels config lives ON THE DIAGRAM (settings json) so it is
   * changeable via Regenerate without re-uploading; the wizard's chooser
   * updates it on completion.
   */
  const displayLevels: SecurityAssociationLevel[] = useMemo(() => {
    const raw = summaryDiagram?.settings?.security_display_levels;
    if (Array.isArray(raw)) {
      const known = LEVEL_ORDER.filter((l) => (raw as string[]).includes(l));
      if (known.length > 0) return known;
    }
    return DEFAULT_DISPLAY_LEVELS;
  }, [summaryDiagram]);
  const [pendingDisplayLevels, setPendingDisplayLevels] =
    useState<SecurityAssociationLevel[] | null>(null);

  const applicationNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const app of applications) map.set(app.id, app.name);
    return map;
  }, [applications]);

  const countsByApplication = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const entry of rollup?.applications ?? []) {
      map.set(entry.application_id, entry.counts);
    }
    return map;
  }, [rollup]);

  const refreshRollup = useCallback(async () => {
    if (!project?.id || !architectureId) return;
    try {
      setRollupError(null);
      setRollup(await getSecurityRollup(project.id, architectureId, reportId ?? undefined));
    } catch (err) {
      setRollup(null);
      setRollupError(err instanceof Error ? err.message : 'Failed to load severity counts');
    }
  }, [project?.id, architectureId, reportId]);

  useEffect(() => {
    void refreshRollup();
  }, [refreshRollup]);

  /**
   * Generate or regenerate the persisted diagram (layout-preserving), then
   * save. The display-levels config is persisted into the diagram's settings
   * ({@code security_display_levels}); {@code levelsOverride} carries a fresh
   * wizard choice.
   */
  const regenerateDiagram = useCallback(async (
    levelsOverride?: SecurityAssociationLevel[],
  ) => {
    if (!project?.id || !architectureId || !state.loadedFileName) return;
    setSaving(true);
    try {
      const effectiveLevels = levelsOverride ?? pendingDisplayLevels ?? displayLevels;
      const generated = generateSecuritySummaryDiagram(metaModel, summaryDiagram);
      const settings: Record<string, unknown> = {
        ...(summaryDiagram?.settings ?? generated.settings ?? {}),
        security_display_levels: effectiveLevels,
      };
      if (summaryDiagram) {
        dispatch({
          type: 'UPDATE_DIAGRAM',
          diagramId: summaryDiagram.id,
          updates: {
            diagram_nodes: generated.diagram_nodes,
            diagram_edges: generated.diagram_edges,
            settings,
          },
        });
      } else {
        dispatch({ type: 'ADD_DIAGRAM', payload: { ...generated, settings } });
      }
      const updatedDiagrams: Diagram[] = summaryDiagram
        ? state.model.diagrams.map((d) =>
            d.id === summaryDiagram.id
              ? {
                  ...d,
                  diagram_nodes: generated.diagram_nodes,
                  diagram_edges: generated.diagram_edges,
                  settings,
                }
              : d,
          )
        : [...state.model.diagrams, { ...generated, settings }];
      await saveModelToBackend(
        { ...state.model, diagrams: updatedDiagrams },
        state.loadedFileName,
        project.id,
        architectureId,
        dispatch,
      );
      setPendingDisplayLevels(null);
    } finally {
      setSaving(false);
    }
  }, [project?.id, architectureId, state.loadedFileName, state.model, metaModel,
      summaryDiagram, dispatch, displayLevels, pendingDisplayLevels]);

  const handleWizardComplete = useCallback(
    (_summary: SecurityIngestSummary, config: SecurityWizardConfig) => {
      // A fresh upload becomes the new latest snapshot.
      setReportId(null);
      void refreshRollup();
      // Persist the wizard's display choice on the diagram: immediately when
      // deriving the first diagram, on the next Regenerate otherwise.
      setPendingDisplayLevels(config.displayLevels);
      if (!summaryDiagram) void regenerateDiagram(config.displayLevels);
    },
    [refreshRollup, regenerateDiagram, summaryDiagram],
  );

  const openHistory = useCallback(async () => {
    if (!project?.id || !architectureId) return;
    try {
      setHistory(await listSecurityReports(project.id, architectureId));
      setHistoryOpen(true);
    } catch {
      setHistory([]);
      setHistoryOpen(true);
    }
  }, [project?.id, architectureId]);

  const goToRegister = (params: Record<string, string>) => {
    const search = new URLSearchParams(params);
    if (reportId) search.set('report_id', reportId);
    navigate(`../register?${search.toString()}`);
  };

  // ------------------------------------------------------------------
  // Diagram rendering (read-only SVG projection of the persisted diagram)
  // ------------------------------------------------------------------

  const nodes = summaryDiagram?.diagram_nodes ?? [];
  const edges = summaryDiagram?.diagram_edges ?? [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const bounds = nodes.reduce(
    (acc, n) => ({
      maxX: Math.max(acc.maxX, n.pos_x + n.width),
      maxY: Math.max(acc.maxY, n.pos_y + n.height),
    }),
    { maxX: 400, maxY: 200 },
  );
  // The Not-matched pseudo-box sits below the diagram content -- overlay-only,
  // never persisted into the diagram.
  const unmatchedCounts = rollup?.unmatched ?? {};
  const hasUnmatched = Object.values(unmatchedCounts).some((v) => v > 0);
  const unmatchedBox = { x: 60, y: bounds.maxY + 50, width: 220, height: 110 };
  const svgWidth = bounds.maxX + 80;
  const svgHeight = (hasUnmatched ? unmatchedBox.y + unmatchedBox.height : bounds.maxY) + 60;

  const renderCircles = (
    counts: Record<string, number>,
    boxX: number,
    boxY: number,
    boxWidth: number,
    boxHeight: number,
  ) => {
    const present = SEVERITY_CIRCLES.filter((s) => (counts[s.key] ?? 0) > 0);
    if (present.length === 0) return null;
    const radius = 14;
    const gap = 6;
    const totalWidth = present.length * (radius * 2) + (present.length - 1) * gap;
    const startX = boxX + boxWidth / 2 - totalWidth / 2 + radius;
    const cy = boxY + boxHeight - radius - 8;
    return present.map((severity, i) => {
      const cx = startX + i * (radius * 2 + gap);
      const count = counts[severity.key] ?? 0;
      return (
        <g key={severity.key}>
          <title>{`${severity.label}: ${count}`}</title>
          <circle cx={cx} cy={cy} r={radius} fill={severity.fill} />
          <text x={cx} y={cy + 4} textAnchor="middle" className={styles.circleText}>
            {count > 999 ? '1k+' : count}
          </text>
        </g>
      );
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div>
          <h2
            className={styles.title}
            onClick={() => goToRegister({})}
            title="Open the full Findings Register"
          >
            Security Overview
          </h2>
          <div className={styles.subtitle}>
            {rollup?.report_id ? (
              <>
                Findings as of {formatInstant(rollup.uploaded_at)}
                {reportId && <span className={styles.historicalBadge}>historical report</span>}
                {reportId && (
                  <button type="button" className={styles.linkButton} onClick={() => setReportId(null)}>
                    back to latest
                  </button>
                )}
              </>
            ) : (
              'No findings uploaded yet'
            )}
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => void openHistory()}>
            Load previous…
          </button>
          <button type="button" disabled={!hasArchitecture || saving} onClick={() => void regenerateDiagram()}>
            {saving ? 'Saving…' : summaryDiagram ? 'Regenerate diagram' : 'Generate diagram'}
          </button>
          <button
            type="button"
            disabled={!summaryDiagram || !project?.id || !architectureId}
            onClick={() =>
              navigate(`/projects/${project?.id}/architectures/${architectureId}/diagrams`)
            }
          >
            Open in Diagrams
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={!hasArchitecture}
            onClick={() => setWizardOpen(true)}
          >
            Upload findings
          </button>
        </div>
      </div>

      {!hasArchitecture && (
        <div className={styles.emptyState}>
          Define the department architecture (applications and data movements) in the
          Architecture area first — the Security Summary diagram is derived from it.
        </div>
      )}

      {rollupError && <div className={styles.error}>{rollupError}</div>}

      {hasArchitecture && !summaryDiagram && (
        <div className={styles.emptyState}>
          No Security Summary diagram yet. Generate it from the {applications.length}{' '}
          application(s) in the model, then upload findings to overlay severity counts.
        </div>
      )}

      {summaryDiagram && (
        <div className={styles.canvasScroll}>
          <svg
            width={svgWidth}
            height={svgHeight}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className={styles.canvas}
          >
            <defs>
              <marker
                id="security-arrow"
                markerWidth="10"
                markerHeight="8"
                refX="9"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L10,4 L0,8 z" fill="#8a94a6" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const source = nodeById.get(edge.source_node_id);
              const target = nodeById.get(edge.target_node_id);
              if (!source || !target) return null;
              return (
                <line
                  key={edge.id}
                  x1={source.pos_x + source.width / 2}
                  y1={source.pos_y + source.height / 2}
                  x2={target.pos_x + target.width / 2}
                  y2={target.pos_y + target.height / 2}
                  className={styles.edge}
                  markerEnd="url(#security-arrow)"
                />
              );
            })}
            {nodes.map((node) => {
              const name = applicationNameById.get(node.entity_id) ?? node.entity_id;
              const counts = countsByApplication.get(node.entity_id) ?? {};
              return (
                <g
                  key={node.id}
                  className={styles.appBox}
                  onClick={() => goToRegister({ application_id: node.entity_id })}
                >
                  <title>{`${name} — click for its findings`}</title>
                  <rect
                    x={node.pos_x}
                    y={node.pos_y}
                    width={node.width}
                    height={node.height}
                    rx={8}
                    className={styles.appRect}
                  />
                  <text
                    x={node.pos_x + node.width / 2}
                    y={node.pos_y + 24}
                    textAnchor="middle"
                    className={styles.appLabel}
                  >
                    {name}
                  </text>
                  {renderCircles(counts, node.pos_x, node.pos_y, node.width, node.height)}
                </g>
              );
            })}
            {hasUnmatched && (
              <g
                className={styles.appBox}
                onClick={() => goToRegister({ match_status: 'unmatched' })}
              >
                <title>Findings not matched to any application — click to review</title>
                <rect
                  x={unmatchedBox.x}
                  y={unmatchedBox.y}
                  width={unmatchedBox.width}
                  height={unmatchedBox.height}
                  rx={8}
                  className={styles.unmatchedRect}
                />
                <text
                  x={unmatchedBox.x + unmatchedBox.width / 2}
                  y={unmatchedBox.y + 24}
                  textAnchor="middle"
                  className={styles.appLabel}
                >
                  Not matched
                </text>
                {renderCircles(
                  unmatchedCounts,
                  unmatchedBox.x,
                  unmatchedBox.y,
                  unmatchedBox.width,
                  unmatchedBox.height,
                )}
              </g>
            )}
          </svg>
        </div>
      )}

      {historyOpen && (
        <div className={styles.modalOverlay} onClick={() => setHistoryOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3>Previous uploads</h3>
            {history.length === 0 && <p className={styles.subtitle}>No uploads yet.</p>}
            <ul className={styles.historyList}>
              {history.map((report) => (
                <li key={report.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setReportId(report.is_latest ? null : report.id);
                      setHistoryOpen(false);
                    }}
                  >
                    <span>{formatInstant(report.uploaded_at)}</span>
                    <span className={styles.historyMeta}>
                      {report.original_filenames.join(', ')} ·{' '}
                      {report.row_count_ingested ?? '?'} findings
                      {report.is_latest ? ' · latest' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.modalFooter}>
              <button type="button" onClick={() => setHistoryOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {project?.id && architectureId && (
        <SecurityUploadWizard
          isOpen={wizardOpen}
          onClose={() => setWizardOpen(false)}
          projectId={project.id}
          architectureId={architectureId}
          metaModel={metaModel}
          initialDisplayLevels={displayLevels}
          onComplete={handleWizardComplete}
        />
      )}
    </div>
  );
}

function formatInstant(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
