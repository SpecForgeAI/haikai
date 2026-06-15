/**
 * InfrastructureDiagramRenderer.tsx
 *
 * Spec 2026-05-05: Infrastructure Diagram V2 -- Auto-Layout & Cross-Domain Overlay
 * Task Group 2: Parallel renderer (mirrors `SequenceDiagramRenderer.tsx` and
 * `UserJourneyDiagramRenderer.tsx`). Bypasses `Canvas.tsx` entirely.
 *
 * Owns:
 *   - Layout invocation via `layoutInfrastructureDiagram` (pure helper, Group 1).
 *   - Header (Environment dropdown + 5 layer chips + 2 edge-overlay chips + Re-layout button).
 *   - Settings persistence to `diagram.settings.infrastructure` via `UPDATE_DIAGRAM`.
 *   - Component-local manual nudge state (`useState<Record<string, {x, y}>>`) -- session only.
 *   - SVG render of containers (rounded rects), leaves, virtual Service cards (cross-domain
 *     border), Data entity chips, cross-domain edges.
 *   - Selection dispatch into the existing spec 5 + spec 6 `SelectionInspector` arms (no
 *     inspector code changes; this renderer simply propagates selection upward via the
 *     existing entity-selection dispatch path).
 *
 * Does NOT:
 *   - Write `diagram.diagram_nodes` / `diagram.diagram_edges` (both stay `[]` for V2).
 *   - Re-run layout on filter-chip toggle (post-layout gating only).
 */

import React, { useMemo, useState, useCallback } from 'react';
import type { Diagram, MetaModel } from '../../types/model';
import {
  layoutInfrastructureDiagram,
  resolveInfrastructureFilters,
  type InfrastructureFilters,
  type LayoutNode,
  type LayoutEdge,
  type LayoutNodeKind,
} from '../../utils/infrastructureLayout';
import { entityColors } from '../../config/defaults';

// ============================================================================
// Settings Sub-Shape (narrowed at the boundary; not on `model.ts`)
// ============================================================================

export interface InfrastructureSettings {
  environment_id?: string;
  filters?: Partial<InfrastructureFilters>;
}

/**
 * Narrow the `unknown` value at `diagram.settings.infrastructure` into a typed sub-shape.
 * Permissive: returns an empty object if the slot is missing or malformed.
 */
function narrowInfrastructureSettings(value: unknown): InfrastructureSettings {
  if (!value || typeof value !== 'object') return {};
  const v = value as Record<string, unknown>;
  const out: InfrastructureSettings = {};
  if (typeof v.environment_id === 'string') out.environment_id = v.environment_id;
  if (v.filters && typeof v.filters === 'object') {
    const f = v.filters as Record<string, unknown>;
    const filters: Partial<InfrastructureFilters> = {};
    const keys: (keyof InfrastructureFilters)[] = [
      'compute',
      'data_stores',
      'load_balancers',
      'infrastructure_resources',
      'services',
      'service_to_lb_edges',
      'service_to_ir_edges',
    ];
    for (const k of keys) {
      const val = f[k];
      if (typeof val === 'boolean') filters[k] = val;
    }
    out.filters = filters;
  }
  return out;
}

// ============================================================================
// Selection Dispatch Type
// ============================================================================

/**
 * Selection event raised when a virtual node or edge is clicked.
 * Routes the click into the existing `SelectionInspector` arms via the parent's dispatch.
 *
 * - For concrete entity nodes: `{ kind: 'entity', entity_type, entity_id }`.
 *   The existing 12 spec 5 entity arms light up.
 * - For Service cards: `{ kind: 'entity', entity_type: 'SERVICE', entity_id: <service.id> }`.
 * - For Data entity chips: `{ kind: 'entity', entity_type: 'LOGICAL_DATA_ENTITY' | 'PHYSICAL_DATA_ENTITY' }`.
 * - For cross-domain edges: `{ kind: 'relationship', relationship_type, relationship_id }`.
 *   The existing spec 6 cross-domain inspector arms light up.
 */
export type InfrastructureSelectionEvent =
  | { kind: 'entity'; entity_type: string; entity_id: string }
  | { kind: 'relationship'; relationship_type: string; relationship_id: string };

// ============================================================================
// Props
// ============================================================================

export interface InfrastructureDiagramRendererProps {
  diagram: Diagram;
  metaModel: MetaModel;
  /** Reducer dispatch (typically `useArchitectureContext().dispatch`). */
  dispatch: (action: { type: 'UPDATE_DIAGRAM'; diagramId: string; updates: Partial<Diagram> }) => void;
  /** Optional: forward selection to a parent that owns the inspector wiring. */
  onSelect?: (event: InfrastructureSelectionEvent) => void;
}

// ============================================================================
// Layout / Visual Constants
// ============================================================================

const SVG_PADDING = 24;
const HEADER_TEXT_PADDING_X = 8;
const HEADER_TEXT_PADDING_Y = 18;
const NODE_FONT_SIZE = 12;
const NODE_SUBLABEL_FONT_SIZE = 10;
const CHIP_FONT_SIZE = 10;

const CONTAINER_KINDS: ReadonlySet<LayoutNodeKind> = new Set([
  'environment',
  'cloud_account',
  'location',
  'network',
  'subnet',
  'compute_cluster',
  'compute_resource',
  'load_balancer',
  'data_store',
  'regional_resources_shelf',
]);

const COMPUTE_RELATED_KINDS: ReadonlySet<LayoutNodeKind> = new Set(['compute_resource', 'compute_cluster']);
const DATA_STORE_KINDS: ReadonlySet<LayoutNodeKind> = new Set(['data_store']);
const LB_KINDS: ReadonlySet<LayoutNodeKind> = new Set(['load_balancer', 'listener']);
const IR_KINDS: ReadonlySet<LayoutNodeKind> = new Set(['infrastructure_resource', 'regional_resources_shelf']);
const SERVICE_KINDS: ReadonlySet<LayoutNodeKind> = new Set(['service_card']);

// Cross-domain Service card styling -- a SERVICE colour border on a soft tint.
const SERVICE_CARD_BG = '#F3E5F5';
const SERVICE_CARD_BORDER = '#7B1FA2';

// Data entity chip styling -- LOGICAL_DATA_ENTITY tint.
const DATA_CHIP_BG = '#FFF3E0';
const DATA_CHIP_BORDER = '#F57C00';

// ============================================================================
// Component
// ============================================================================

export function InfrastructureDiagramRenderer(
  props: InfrastructureDiagramRendererProps,
): JSX.Element {
  const { diagram, metaModel, dispatch, onSelect } = props;

  // ------------------------------------------------------------------
  // Settings narrow + default resolution
  // ------------------------------------------------------------------

  const settings: InfrastructureSettings = useMemo(
    () => narrowInfrastructureSettings(diagram.settings?.infrastructure),
    [diagram.settings],
  );

  const environments = metaModel.entities.environments;
  const sortedEnvs = useMemo(
    () => [...environments].sort((a, b) => a.name.localeCompare(b.name)),
    [environments],
  );

  const resolvedEnvironmentId: string | null = useMemo(() => {
    if (settings.environment_id && environments.find((e) => e.id === settings.environment_id)) {
      return settings.environment_id;
    }
    return sortedEnvs.length > 0 ? sortedEnvs[0].id : null;
  }, [settings.environment_id, environments, sortedEnvs]);

  const resolvedFilters = useMemo(
    () => resolveInfrastructureFilters(settings.filters),
    [settings.filters],
  );

  // ------------------------------------------------------------------
  // Component-local manual-nudge state (session-only).
  // ------------------------------------------------------------------

  const [manualNudges, setManualNudges] = useState<Record<string, { x: number; y: number }>>({});

  // ------------------------------------------------------------------
  // Empty-state: no Environments => render message and skip layout entirely.
  // ------------------------------------------------------------------

  if (sortedEnvs.length === 0) {
    return (
      <div data-testid="infrastructure-empty-state" style={{ padding: 24, color: '#555' }}>
        Create an Environment in the Tables UI to populate this diagram.
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Settings persistence helpers
  // ------------------------------------------------------------------

  const persistSettings = useCallback(
    (next: InfrastructureSettings) => {
      const merged = {
        ...(diagram.settings ?? {}),
        infrastructure: next,
      };
      dispatch({
        type: 'UPDATE_DIAGRAM',
        diagramId: diagram.id,
        updates: { settings: merged },
      });
    },
    [diagram.id, diagram.settings, dispatch],
  );

  const handleEnvChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newEnvId = e.target.value;
      setManualNudges({});
      persistSettings({
        environment_id: newEnvId,
        filters: settings.filters,
      });
    },
    [persistSettings, settings.filters],
  );

  const handleFilterToggle = useCallback(
    (key: keyof InfrastructureFilters) => {
      const current = resolvedFilters[key];
      const nextFilters: Partial<InfrastructureFilters> = {
        ...(settings.filters ?? {}),
        [key]: !current,
      };
      persistSettings({
        environment_id: resolvedEnvironmentId ?? undefined,
        filters: nextFilters,
      });
    },
    [persistSettings, resolvedFilters, resolvedEnvironmentId, settings.filters],
  );

  const handleRelayout = useCallback(() => {
    setManualNudges({});
  }, []);

  // ------------------------------------------------------------------
  // Compute layout (full tree, unfiltered).
  // ------------------------------------------------------------------

  const layout = useMemo(() => {
    if (!resolvedEnvironmentId) return null;
    return layoutInfrastructureDiagram(metaModel, resolvedEnvironmentId, resolvedFilters);
  }, [metaModel, resolvedEnvironmentId, resolvedFilters]);

  // ------------------------------------------------------------------
  // Apply filter-chip gating at render time.
  // ------------------------------------------------------------------

  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set<string>();
    if (!layout) return hidden;
    for (const n of layout.nodes) {
      const k = n.kind;
      let hide = false;
      if (!resolvedFilters.compute && COMPUTE_RELATED_KINDS.has(k)) hide = true;
      if (!resolvedFilters.data_stores && DATA_STORE_KINDS.has(k)) hide = true;
      if (!resolvedFilters.data_stores && k === 'data_entity_chip') hide = true;
      if (!resolvedFilters.load_balancers && LB_KINDS.has(k)) hide = true;
      if (!resolvedFilters.infrastructure_resources && IR_KINDS.has(k)) hide = true;
      if (!resolvedFilters.services && SERVICE_KINDS.has(k)) hide = true;
      if (hide) hidden.add(n.id);
    }
    // If a parent is hidden, mark its descendants hidden too.
    if (hidden.size > 0) {
      const mark = (id: string) => {
        const node = layout.nodes.find((nn) => nn.id === id);
        if (!node) return;
        for (const c of node.children) {
          if (!hidden.has(c.id)) {
            hidden.add(c.id);
            mark(c.id);
          }
        }
      };
      for (const id of Array.from(hidden)) mark(id);
    }
    return hidden;
  }, [layout, resolvedFilters]);

  // ------------------------------------------------------------------
  // Compute absolute positions (parent-relative -> global).
  // ------------------------------------------------------------------

  const absolutePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number; width: number; height: number }>();
    if (!layout || !layout.root) return map;
    function walk(node: LayoutNode, offX: number, offY: number) {
      const nudge = manualNudges[node.id];
      const ax = offX + node.x + (nudge ? nudge.x : 0);
      const ay = offY + node.y + (nudge ? nudge.y : 0);
      map.set(node.id, { x: ax, y: ay, width: node.width, height: node.height });
      for (const c of node.children) {
        walk(c, ax, ay);
      }
    }
    walk(layout.root, SVG_PADDING, SVG_PADDING);
    return map;
  }, [layout, manualNudges]);

  // ------------------------------------------------------------------
  // SVG bounding box
  // ------------------------------------------------------------------

  const svgWidth = useMemo(() => {
    if (!layout || !layout.root) return 800;
    return layout.root.width + SVG_PADDING * 2;
  }, [layout]);
  const svgHeight = useMemo(() => {
    if (!layout || !layout.root) return 400;
    return layout.root.height + SVG_PADDING * 2;
  }, [layout]);

  // ------------------------------------------------------------------
  // Selection dispatch
  // ------------------------------------------------------------------

  const dispatchEntitySelection = useCallback(
    (node: LayoutNode) => {
      if (!onSelect) return;
      if (node.entity_type && node.entity_id) {
        onSelect({ kind: 'entity', entity_type: node.entity_type, entity_id: node.entity_id });
      }
    },
    [onSelect],
  );

  const dispatchEdgeSelection = useCallback(
    (edge: LayoutEdge) => {
      if (!onSelect) return;
      if (edge.relationship_type && edge.relationship_id) {
        onSelect({
          kind: 'relationship',
          relationship_type: edge.relationship_type,
          relationship_id: edge.relationship_id,
        });
      }
    },
    [onSelect],
  );

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------

  const visibleNodes = useMemo(() => {
    if (!layout) return [];
    return layout.nodes.filter((n) => !hiddenNodeIds.has(n.id));
  }, [layout, hiddenNodeIds]);

  const visibleEdges = useMemo(() => {
    if (!layout) return [];
    return layout.edges.filter((e) => {
      if (e.kind === 'service_to_lb' && !resolvedFilters.service_to_lb_edges) return false;
      if (e.kind === 'service_to_ir' && !resolvedFilters.service_to_ir_edges) return false;
      if (hiddenNodeIds.has(e.source_node_id) || hiddenNodeIds.has(e.target_node_id)) return false;
      return true;
    });
  }, [layout, resolvedFilters, hiddenNodeIds]);

  function renderNode(node: LayoutNode): JSX.Element | null {
    const pos = absolutePositions.get(node.id);
    if (!pos) return null;
    const isContainer = node.isContainer || CONTAINER_KINDS.has(node.kind);
    const isCrossDomainCard = node.kind === 'service_card';
    const isChip = node.kind === 'data_entity_chip';

    let fill = '#FFFFFF';
    let stroke = '#999999';
    if (isCrossDomainCard) {
      fill = SERVICE_CARD_BG;
      stroke = SERVICE_CARD_BORDER;
    } else if (isChip) {
      fill = DATA_CHIP_BG;
      stroke = DATA_CHIP_BORDER;
    } else if (node.entity_type && entityColors[node.entity_type]) {
      const c = entityColors[node.entity_type];
      fill = c.background;
      stroke = c.border;
    } else if (node.kind === 'regional_resources_shelf') {
      fill = '#FAFAFA';
      stroke = '#9E9E9E';
    }

    const dasharray = node.isDashed ? '6,4' : undefined;

    return (
      <g
        key={node.id}
        data-node-id={node.id}
        data-node-kind={node.kind}
        onClick={(e) => {
          e.stopPropagation();
          dispatchEntitySelection(node);
        }}
        style={{ cursor: 'pointer' }}
      >
        <rect
          x={pos.x}
          y={pos.y}
          width={pos.width}
          height={pos.height}
          rx={isChip ? 8 : 4}
          ry={isChip ? 8 : 4}
          fill={fill}
          stroke={stroke}
          strokeWidth={isCrossDomainCard ? 2 : 1.2}
          strokeDasharray={dasharray}
        />
        {isContainer ? (
          <text
            x={pos.x + HEADER_TEXT_PADDING_X}
            y={pos.y + HEADER_TEXT_PADDING_Y}
            fontSize={NODE_FONT_SIZE}
            fontWeight="bold"
            fill="#222222"
          >
            {node.label}
            {node.sublabel ? (
              <tspan
                x={pos.x + HEADER_TEXT_PADDING_X}
                dy={NODE_SUBLABEL_FONT_SIZE + 4}
                fontSize={NODE_SUBLABEL_FONT_SIZE}
                fontWeight="normal"
                fill="#555555"
              >
                {node.sublabel}
              </tspan>
            ) : null}
          </text>
        ) : (
          <text
            x={pos.x + pos.width / 2}
            y={pos.y + pos.height / 2 + (isChip ? 3 : 4)}
            fontSize={isChip ? CHIP_FONT_SIZE : NODE_FONT_SIZE}
            textAnchor="middle"
            fill="#222222"
          >
            {node.label}
          </text>
        )}
      </g>
    );
  }

  function renderEdge(edge: LayoutEdge): JSX.Element | null {
    const src = absolutePositions.get(edge.source_node_id);
    const tgt = absolutePositions.get(edge.target_node_id);
    if (!src || !tgt) return null;
    const x1 = src.x + src.width / 2;
    const y1 = src.y + src.height / 2;
    const x2 = tgt.x + tgt.width / 2;
    const y2 = tgt.y + tgt.height / 2;
    const dasharray = edge.dashed ? '5,3' : undefined;
    return (
      <g
        key={edge.id}
        data-edge-id={edge.id}
        data-edge-kind={edge.kind}
        onClick={(e) => {
          e.stopPropagation();
          dispatchEdgeSelection(edge);
        }}
        style={{ cursor: 'pointer' }}
      >
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="#666666"
          strokeWidth={1.4}
          strokeDasharray={dasharray}
          markerEnd="url(#infrastructure-arrowhead)"
        />
        {edge.label ? (
          <text x={(x1 + x2) / 2 + 4} y={(y1 + y2) / 2 - 4} fontSize={10} fill="#555555">
            {edge.label}
          </text>
        ) : null}
      </g>
    );
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const chips: Array<{ key: keyof InfrastructureFilters; label: string }> = [
    { key: 'compute', label: 'Compute' },
    { key: 'data_stores', label: 'Data Stores' },
    { key: 'load_balancers', label: 'Load Balancers' },
    { key: 'infrastructure_resources', label: 'Infrastructure Resources' },
    { key: 'services', label: 'Services' },
  ];
  const edgeChips: Array<{ key: keyof InfrastructureFilters; label: string }> = [
    { key: 'service_to_lb_edges', label: 'S->LB edges' },
    { key: 'service_to_ir_edges', label: 'S->IR edges' },
  ];

  return (
    <div
      data-testid="infrastructure-diagram-renderer"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}
    >
      {/* Header bar */}
      <div
        data-testid="infrastructure-header-bar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid #ddd',
          background: '#FAFAFA',
        }}
      >
        <label style={{ fontSize: 12, fontWeight: 600 }}>
          Environment:&nbsp;
          <select
            data-testid="infrastructure-env-select"
            value={resolvedEnvironmentId ?? ''}
            onChange={handleEnvChange}
            style={{ fontSize: 12 }}
          >
            {sortedEnvs.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
        </label>
        {chips.map((c) => (
          <FilterChip
            key={c.key}
            label={c.label}
            chipKey={c.key}
            active={resolvedFilters[c.key]}
            onToggle={handleFilterToggle}
          />
        ))}
        <span style={{ width: 12 }} />
        {edgeChips.map((c) => (
          <FilterChip
            key={c.key}
            label={c.label}
            chipKey={c.key}
            active={resolvedFilters[c.key]}
            onToggle={handleFilterToggle}
          />
        ))}
        <button
          data-testid="infrastructure-relayout-btn"
          onClick={handleRelayout}
          style={{
            marginLeft: 'auto',
            padding: '4px 10px',
            fontSize: 12,
            background: '#FFFFFF',
            border: '1px solid #999',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Re-layout
        </button>
      </div>

      {/* SVG content */}
      <div style={{ flex: 1, overflow: 'auto', background: '#FFFFFF' }}>
        <svg
          data-testid="infrastructure-svg"
          width={svgWidth}
          height={svgHeight}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <marker
              id="infrastructure-arrowhead"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#666666" />
            </marker>
          </defs>
          {/* Containers first (so leaves render on top) */}
          {visibleNodes.filter((n) => n.isContainer).map((n) => renderNode(n))}
          {/* Leaf nodes */}
          {visibleNodes.filter((n) => !n.isContainer).map((n) => renderNode(n))}
          {/* Cross-domain edges last */}
          {visibleEdges.map((e) => renderEdge(e))}
        </svg>
      </div>
    </div>
  );
}

// ============================================================================
// Filter Chip
// ============================================================================

interface FilterChipProps {
  label: string;
  chipKey: keyof InfrastructureFilters;
  active: boolean;
  onToggle: (key: keyof InfrastructureFilters) => void;
}

function FilterChip({ label, chipKey, active, onToggle }: FilterChipProps): JSX.Element {
  return (
    <button
      type="button"
      data-testid={`infrastructure-chip-${chipKey}`}
      data-chip-key={chipKey}
      data-active={active ? 'true' : 'false'}
      onClick={() => onToggle(chipKey)}
      style={{
        padding: '4px 10px',
        fontSize: 12,
        borderRadius: 12,
        border: '1px solid ' + (active ? '#1976D2' : '#BDBDBD'),
        background: active ? '#E3F2FD' : '#F5F5F5',
        color: active ? '#0D47A1' : '#555555',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

export default InfrastructureDiagramRenderer;
