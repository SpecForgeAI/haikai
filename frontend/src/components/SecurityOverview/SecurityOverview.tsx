/**
 * Security Overview (Security health dashboard, 2026-07-19; service-level
 * association second wave, Spec C of 3)
 *
 * The department health dashboard: the generated "Security Summary" diagram
 * (nested hierarchy boxes per the display-levels config + data-movement edges
 * rolled to the displayed level, persisted as a REAL diagram and editable in
 * the Diagrams area) overlaid with severity circles computed AT RENDER TIME
 * from the latest findings report via the nearest-displayed-ancestor rule --
 * a new upload or a display-config change updates every circle with zero
 * server round-trips.
 *
 * Interactivity: OUTERMOST boxes drag-to-move directly on this screen
 * (descendants ride along; positions persist through the normal diagram
 * save); adding/creating content stays in the Diagrams area. Regenerate opens
 * a chooser for the display levels (persisted on the diagram's settings) and
 * preserves surviving positions + user additions.
 *
 * Clicks deep-link into the Findings Register with the ancestor-aware scope
 * filter for the clicked box's level; the Not-matched pseudo-box (overlay
 * only, never persisted) filters to unmatched.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useActiveArchitectureId,
  useArchitecture,
  useArchitectureDispatch,
} from '../../contexts/ArchitectureContext';
import { useProject } from '../../contexts/ProjectContext';
import { normalizeDiagramType } from '../../types/diagramType';
import type { Diagram, DiagramNode } from '../../types/model';
import { ENTITY_TYPES } from '../../types/model';
import { saveModelToBackend } from '../../utils/saveUtils';
import {
  aggregateSecurityCountsToDisplayedEntities,
  generateSecuritySummaryDiagram,
} from '../../utils/securitySummaryDiagram';
import {
  ASSOCIATION_LEVELS,
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

/** Register filter param per clicked box's entity type (ancestor-aware server-side). */
const FILTER_PARAM_BY_ENTITY_TYPE: Record<string, string> = {
  [ENTITY_TYPES.APPLICATION]: 'application_id',
  [ENTITY_TYPES.APP_COMPONENT]: 'application_component_id',
  [ENTITY_TYPES.SERVICE]: 'service_id',
};

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
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenLevels, setRegenLevels] = useState<SecurityAssociationLevel[]>(
    DEFAULT_DISPLAY_LEVELS,
  );
  const [saving, setSaving] = useState(false);
  // Live drag state: node id -> {dx, dy} applied on top of persisted positions.
  const [dragOffset, setDragOffset] = useState<{ ids: Set<string>; dx: number; dy: number } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scale: number;
    nodeIds: Set<string>;
    moved: boolean;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

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
   * changeable via Regenerate without re-uploading.
   */
  const displayLevels: SecurityAssociationLevel[] = useMemo(() => {
    const raw = summaryDiagram?.settings?.security_display_levels;
    if (Array.isArray(raw)) {
      const known = LEVEL_ORDER.filter((l) => (raw as string[]).includes(l));
      if (known.length > 0) return known;
    }
    return DEFAULT_DISPLAY_LEVELS;
  }, [summaryDiagram]);

  const entityNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const app of metaModel.entities.applications) map.set(app.id, app.name);
    for (const comp of metaModel.entities.app_components) map.set(comp.id, comp.name);
    for (const service of metaModel.entities.services) map.set(service.id, service.name);
    return map;
  }, [metaModel]);

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
   * Generate or regenerate the persisted diagram (layout- and user-addition-
   * preserving), persisting the display-levels config into its settings.
   */
  const regenerateDiagram = useCallback(async (
    levelsOverride?: SecurityAssociationLevel[],
  ) => {
    if (!project?.id || !architectureId || !state.loadedFileName) return;
    setSaving(true);
    try {
      const effectiveLevels = levelsOverride ?? displayLevels;
      const generated = generateSecuritySummaryDiagram(
        metaModel, effectiveLevels, summaryDiagram);
      if (summaryDiagram) {
        dispatch({
          type: 'UPDATE_DIAGRAM',
          diagramId: summaryDiagram.id,
          updates: {
            diagram_nodes: generated.diagram_nodes,
            diagram_edges: generated.diagram_edges,
            settings: generated.settings,
          },
        });
      } else {
        dispatch({ type: 'ADD_DIAGRAM', payload: generated });
      }
      const updatedDiagrams: Diagram[] = summaryDiagram
        ? state.model.diagrams.map((d) =>
            d.id === summaryDiagram.id
              ? {
                  ...d,
                  diagram_nodes: generated.diagram_nodes,
                  diagram_edges: generated.diagram_edges,
                  settings: generated.settings,
                }
              : d,
          )
        : [...state.model.diagrams, generated];
      await saveModelToBackend(
        { ...state.model, diagrams: updatedDiagrams },
        state.loadedFileName,
        project.id,
        architectureId,
        dispatch,
      );
    } finally {
      setSaving(false);
    }
  }, [project?.id, architectureId, state.loadedFileName, state.model, metaModel,
      summaryDiagram, dispatch, displayLevels]);

  const handleWizardComplete = useCallback(
    (_summary: SecurityIngestSummary, config: SecurityWizardConfig) => {
      // A fresh upload becomes the new latest snapshot.
      setReportId(null);
      void refreshRollup();
      // The wizard's display choice regenerates the diagram (first upload
      // derives it; later uploads re-cut it to the confirmed config).
      void regenerateDiagram(config.displayLevels);
    },
    [refreshRollup, regenerateDiagram],
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
  // Diagram projection + circle aggregation
  // ------------------------------------------------------------------

  const nodes = useMemo(
    () => summaryDiagram?.diagram_nodes ?? [],
    [summaryDiagram],
  );
  const edges = summaryDiagram?.diagram_edges ?? [];
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  /** Depth in the containment tree (parents render before children). */
  const depthOf = useCallback((node: DiagramNode): number => {
    let depth = 0;
    let current: DiagramNode | undefined = node;
    while (current?.parent_node_id && depth < 10) {
      current = nodeById.get(current.parent_node_id);
      depth++;
    }
    return depth;
  }, [nodeById]);

  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => depthOf(a) - depthOf(b)),
    [nodes, depthOf],
  );

  /** All descendant node ids of one node (for whole-subtree dragging). */
  const subtreeIds = useCallback((rootId: string): Set<string> => {
    const out = new Set<string>([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const node of nodes) {
        if (node.parent_node_id && out.has(node.parent_node_id) && !out.has(node.id)) {
          out.add(node.id);
          grew = true;
        }
      }
    }
    return out;
  }, [nodes]);

  const displayedEntityIds = useMemo(
    () =>
      new Set(
        nodes
          .filter((n) => FILTER_PARAM_BY_ENTITY_TYPE[n.entity_type])
          .map((n) => n.entity_id),
      ),
    [nodes],
  );

  /** Nearest-displayed-ancestor aggregation of the rollup onto diagram boxes. */
  const countsByEntity = useMemo(() => {
    const entries = rollup?.entities?.length
      ? rollup.entities
      : (rollup?.applications ?? []).map((a) => ({
          level: 'application',
          entity_id: a.application_id,
          application_id: a.application_id,
          application_component_id: null,
          counts: a.counts,
        }));
    return aggregateSecurityCountsToDisplayedEntities(
      entries, displayLevels, displayedEntityIds);
  }, [rollup, displayLevels, displayedEntityIds]);

  // ------------------------------------------------------------------
  // Drag-to-move (outermost boxes; descendants ride along)
  // ------------------------------------------------------------------

  const beginDrag = (node: DiagramNode, e: React.PointerEvent) => {
    if (node.parent_node_id) return; // outermost boxes only
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const viewBoxWidth = svg.viewBox.baseVal?.width || rect.width;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scale: rect.width > 0 ? viewBoxWidth / rect.width : 1,
      nodeIds: subtreeIds(node.id),
      moved: false,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = (e.clientX - drag.startX) * drag.scale;
    const dy = (e.clientY - drag.startY) * drag.scale;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return; // click threshold
    drag.moved = true;
    setDragOffset({ ids: drag.nodeIds, dx, dy });
  };

  const endDrag = async () => {
    const drag = dragRef.current;
    dragRef.current = null;
    const offset = dragOffset;
    setDragOffset(null);
    if (!drag?.moved || !offset || !summaryDiagram) return;
    if (!project?.id || !architectureId || !state.loadedFileName) return;
    // Persist through the normal diagram save (same path the Diagrams area uses).
    const movedNodes = summaryDiagram.diagram_nodes.map((n) =>
      offset.ids.has(n.id)
        ? { ...n, pos_x: n.pos_x + offset.dx, pos_y: n.pos_y + offset.dy }
        : n,
    );
    dispatch({
      type: 'UPDATE_DIAGRAM',
      diagramId: summaryDiagram.id,
      updates: { diagram_nodes: movedNodes },
    });
    const updatedDiagrams = state.model.diagrams.map((d) =>
      d.id === summaryDiagram.id ? { ...d, diagram_nodes: movedNodes } : d,
    );
    await saveModelToBackend(
      { ...state.model, diagrams: updatedDiagrams },
      state.loadedFileName,
      project.id,
      architectureId,
      dispatch,
    );
  };

  const offsetFor = (node: DiagramNode): { x: number; y: number } =>
    dragOffset && dragOffset.ids.has(node.id)
      ? { x: node.pos_x + dragOffset.dx, y: node.pos_y + dragOffset.dy }
      : { x: node.pos_x, y: node.pos_y };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const bounds = nodes.reduce(
    (acc, n) => ({
      maxX: Math.max(acc.maxX, n.pos_x + n.width),
      maxY: Math.max(acc.maxY, n.pos_y + n.height),
    }),
    { maxX: 400, maxY: 200 },
  );
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
    const radius = 13;
    const gap = 5;
    const totalWidth = present.length * (radius * 2) + (present.length - 1) * gap;
    const startX = boxX + boxWidth / 2 - totalWidth / 2 + radius;
    const cy = boxY + boxHeight - radius - 7;
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

  const toggleRegenLevel = (level: SecurityAssociationLevel, checked: boolean) => {
    setRegenLevels((prev) => {
      const next = checked ? [...prev, level] : prev.filter((l) => l !== level);
      const ordered = LEVEL_ORDER.filter((l) => next.includes(l));
      return ordered.length > 0 ? ordered : prev;
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
                {rollup.association_level && (
                  <span> · linked at {rollup.association_level.replace('_', ' ')} level</span>
                )}
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
          <button
            type="button"
            disabled={!hasArchitecture || saving}
            onClick={() => {
              setRegenLevels(displayLevels);
              setRegenOpen(true);
            }}
          >
            {saving ? 'Saving…' : summaryDiagram ? 'Regenerate diagram…' : 'Generate diagram…'}
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
            ref={svgRef}
            width={svgWidth}
            height={svgHeight}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className={styles.canvas}
            onPointerMove={onDragMove}
            onPointerUp={() => void endDrag()}
            onPointerCancel={() => void endDrag()}
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
              const so = offsetFor(source);
              const to = offsetFor(target);
              return (
                <line
                  key={edge.id}
                  x1={so.x + source.width / 2}
                  y1={so.y + source.height / 2}
                  x2={to.x + target.width / 2}
                  y2={to.y + target.height / 2}
                  className={styles.edge}
                  markerEnd={
                    edge.relationship_type === 'DATA_MOVEMENT' ? 'url(#security-arrow)' : undefined
                  }
                />
              );
            })}
            {sortedNodes.map((node) => {
              const name = entityNameById.get(node.entity_id) ?? node.entity_id;
              const counts = countsByEntity.get(node.entity_id) ?? {};
              const filterParam = FILTER_PARAM_BY_ENTITY_TYPE[node.entity_type];
              const isContainer = nodes.some((n) => n.parent_node_id === node.id);
              const pos = offsetFor(node);
              return (
                <g
                  key={node.id}
                  className={styles.appBox}
                  onPointerDown={(e) => beginDrag(node, e)}
                  onClick={() => {
                    if (dragRef.current?.moved) return;
                    if (filterParam) goToRegister({ [filterParam]: node.entity_id });
                  }}
                >
                  <title>{`${name} — drag to move, click for findings`}</title>
                  <rect
                    x={pos.x}
                    y={pos.y}
                    width={node.width}
                    height={node.height}
                    rx={8}
                    className={isContainer ? styles.containerRect : styles.appRect}
                  />
                  <text
                    x={pos.x + node.width / 2}
                    y={pos.y + 21}
                    textAnchor="middle"
                    className={isContainer ? styles.containerLabel : styles.appLabel}
                  >
                    {name}
                  </text>
                  {renderCircles(counts, pos.x, pos.y, node.width, node.height)}
                </g>
              );
            })}
            {hasUnmatched && (
              <g
                className={styles.appBox}
                onClick={() => goToRegister({ match_status: 'unmatched' })}
              >
                <title>Findings not matched to any entity — click to review</title>
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

      {regenOpen && (
        <div className={styles.modalOverlay} onClick={() => setRegenOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3>{summaryDiagram ? 'Regenerate diagram' : 'Generate diagram'}</h3>
            <p className={styles.subtitle}>
              Choose which hierarchy levels the summary displays. Multiple levels render as
              nested boxes. Surviving box positions and anything you added in the Diagrams
              area are preserved.
            </p>
            {ASSOCIATION_LEVELS.map((option) => (
              <label key={option.value} className={styles.levelOption}>
                <input
                  type="checkbox"
                  checked={regenLevels.includes(option.value)}
                  onChange={(e) => toggleRegenLevel(option.value, e.target.checked)}
                />
                {option.label}
              </label>
            ))}
            <div className={styles.modalFooter}>
              <button type="button" onClick={() => setRegenOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={saving}
                onClick={() => {
                  setRegenOpen(false);
                  void regenerateDiagram(regenLevels);
                }}
              >
                {summaryDiagram ? 'Regenerate' : 'Generate'}
              </button>
            </div>
          </div>
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
                      {report.row_count_ingested ?? '?'} findings ·{' '}
                      {report.association_level.replace('_', ' ')} level
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
