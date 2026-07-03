/**
 * Run Flow Graph — client-side fold + layout (spec 2026-07-02, D9).
 *
 * The renderer is GENERIC (I10): it folds `graph_*` events into a model and
 * lays out by node_kind/parent only — it knows graph concepts, never
 * verification business logic, and never parses workspace files or D6
 * frames. Mirrors the server's pure fold (flow_graph.fold_events).
 */
import type { Edge, Node } from "@xyflow/react";
import type { DiagramNodeData } from "@/components/DiagramNode";

export interface GraphEvent {
  seq: number;
  kind: string;
  run_id: string;
  event_time: string;
  payload: Record<string, any>;
}

export interface GraphModel {
  runId: string;
  seq: number;
  nodes: Map<string, any>;
  edges: Map<string, any>;
  states: Map<string, { state: string; detail: any; seq: number }>;
  evidence: Map<string, { counts_by_kind: Record<string, number>; latest_by_kind: Record<string, any> }>;
}

export function emptyModel(runId: string): GraphModel {
  return { runId, seq: 0, nodes: new Map(), edges: new Map(), states: new Map(), evidence: new Map() };
}

export function applySnapshot(snap: any): GraphModel {
  const m = emptyModel(snap.run?.run_id ?? "");
  m.seq = snap.seq ?? 0;
  for (const n of snap.nodes ?? []) m.nodes.set(n.node_id, n);
  for (const e of snap.edges ?? []) m.edges.set(e.edge_id, e);
  for (const [id, s] of Object.entries(snap.states ?? {})) m.states.set(id, s as any);
  for (const [id, ev] of Object.entries(snap.evidence_summary ?? {})) m.evidence.set(id, ev as any);
  return m;
}

/** Fold ONE ordered event into the model (mutates + returns it). Dynamic
 * structure (a repair appearing mid-run) is the same code path as the
 * initial skeleton — no special patch mode (I11). */
export function applyEvent(m: GraphModel, ev: GraphEvent): GraphModel {
  if (ev.seq <= m.seq && ev.kind !== "") return m;
  m.seq = Math.max(m.seq, ev.seq);
  const p = ev.payload ?? {};
  switch (ev.kind) {
    case "graph_node_declared":
      m.nodes.set(p.node_id, { ...p, declared_seq: ev.seq });
      break;
    case "graph_edge_declared":
      m.edges.set(p.edge_id, { ...p, declared_seq: ev.seq });
      break;
    case "graph_node_state_changed":
      m.states.set(p.node_id, { state: p.state, detail: p.detail, seq: ev.seq });
      break;
    case "graph_evidence_attached": {
      const s = m.evidence.get(p.node_id) ?? { counts_by_kind: {}, latest_by_kind: {} };
      s.counts_by_kind[p.evidence_kind] = (s.counts_by_kind[p.evidence_kind] ?? 0) + 1;
      s.latest_by_kind[p.evidence_kind] = { ref: p.ref, label: p.label, seq: ev.seq };
      m.evidence.set(p.node_id, s);
      break;
    }
    default:
      break; // forward-compatible: unknown kinds ignored
  }
  return m;
}

// ── presentation mapping ─────────────────────────────────────────────────────

const KIND_CATEGORY: Record<string, DiagramNodeData["category"] & string> = {
  run: "phase", command: "agent", group: "core", ci: "cicd",
  cell: "standards", gate: "gateway", repair: "external", attempt: "artifact",
};

const STATE_GLYPH: Record<string, string> = {
  pending: "○", ready: "◍", running: "◐", pass: "✓", fail: "✗",
  skipped: "⤼", timeout: "⏱", cancelled: "⊘", escalated: "⚠",
};

const EDGE_STYLE: Record<string, { stroke: string; dash?: string; animated?: boolean }> = {
  sequence: { stroke: "#64748b" },
  depends_on: { stroke: "#f59e0b" },
  spawns: { stroke: "#a78bfa", dash: "6 3" },
  repair_of: { stroke: "#ef4444", dash: "4 3" },
  binds: { stroke: "#38bdf8", dash: "2 3" },
  contains: { stroke: "#334155", dash: "1 4" },
};

const isAttempt = (id: string) => /\/repair\/attempt\/\d+$/.test(id);
const repairOf = (attemptId: string) => attemptId.replace(/\/attempt\/\d+$/, "");

/** Deterministic layered layout — no layout lib. Lane 1: run + command
 * chain. One band per group below: [group | ci+cells | gate+repair | attempts]. */
export function toFlow(
  m: GraphModel,
  opts: { expandedRepairs: Set<string> },
): { nodes: Node<DiagramNodeData>[]; edges: Edge[] } {
  const all = Array.from(m.nodes.values()).sort((a, b) => a.declared_seq - b.declared_seq);
  const stateOf = (id: string) => m.states.get(id)?.state ?? "pending";
  const glyph = (id: string) => STATE_GLYPH[stateOf(id)] ?? "○";

  // Repair badge: attempts collapse behind their repair node by default (D6).
  const attemptsByRepair = new Map<string, any[]>();
  for (const n of all) {
    if (n.node_kind === "attempt" && isAttempt(n.node_id)) {
      const r = repairOf(n.node_id);
      attemptsByRepair.set(r, [...(attemptsByRepair.get(r) ?? []), n]);
    }
  }

  const out: Node<DiagramNodeData>[] = [];
  const pos = new Map<string, { x: number; y: number }>();
  const groups = all.filter((n) => n.node_kind === "group");
  const bandY = (gi: number) => 240 + gi * 420;

  for (const n of all) {
    const id = n.node_id;
    let x = 0, y = 40;
    if (n.node_kind === "run") { x = 0; y = 40; }
    else if (n.node_kind === "command") {
      const step = Number(n.meta?.step ?? 1);
      x = 250 * step; y = 40;
    } else if (n.node_kind === "group") {
      x = 0; y = bandY(groups.findIndex((g) => g.node_id === id));
    } else {
      const gi = Math.max(0, groups.findIndex((g) => id.startsWith(g.node_id + "/")));
      const gy = bandY(gi);
      const siblings = (kind: string) =>
        all.filter((s) => s.node_kind === kind && s.node_id.startsWith(groups[gi]?.node_id + "/"));
      if (n.node_kind === "ci") {
        x = 330; y = gy - 60 + siblings("ci").findIndex((s) => s.node_id === id) * 105;
      } else if (n.node_kind === "cell") {
        const cis = siblings("ci").length;
        x = 330; y = gy - 60 + cis * 105 + siblings("cell").findIndex((s) => s.node_id === id) * 105;
      } else if (n.node_kind === "gate") { x = 680; y = gy; }
      else if (n.node_kind === "repair") { x = 680; y = gy + 130; }
      else if (n.node_kind === "attempt") {
        const r = repairOf(id);
        const list = attemptsByRepair.get(r) ?? [];
        x = 990; y = gy + 70 + list.findIndex((s) => s.node_id === id) * 100;
      }
    }
    pos.set(id, { x, y });

    if (n.node_kind === "attempt" && !opts.expandedRepairs.has(repairOf(id))) continue;

    let label = `${glyph(id)} ${n.label}`;
    let sublabel = stateOf(id);
    if (n.node_kind === "repair") {
      const atts = attemptsByRepair.get(id) ?? [];
      const latest = atts.length
        ? Math.max(...atts.map((a) => Number(a.node_id.split("/").pop())))
        : 0;
      label = `${glyph(id)} repair ⟳ ${latest}/3`;
      const latestState = atts.length
        ? stateOf(`${id}/attempt/${latest}`)
        : stateOf(id);
      sublabel = `attempt ${latest || "-"}: ${latestState} (click to expand)`;
    }
    const ev = m.evidence.get(id);
    if (ev && n.node_kind !== "repair") {
      const total = Object.values(ev.counts_by_kind).reduce((a, b) => a + b, 0);
      sublabel += ` · 📎${total}`;
    }
    out.push({
      id, type: "diagramNode", position: pos.get(id)!,
      data: { label, sublabel, category: (KIND_CATEGORY[n.node_kind] ?? "core") as any },
    });
  }

  const edges: Edge[] = [];
  for (const e of Array.from(m.edges.values())) {
    const hidden =
      (isAttempt(e.source) && !opts.expandedRepairs.has(repairOf(e.source))) ||
      (isAttempt(e.target) && !opts.expandedRepairs.has(repairOf(e.target)));
    if (hidden) continue;
    if (!pos.has(e.source) || !pos.has(e.target)) continue;
    const style = EDGE_STYLE[e.edge_kind] ?? EDGE_STYLE.sequence;
    edges.push({
      id: e.edge_id, source: e.source, target: e.target,
      label: e.edge_kind === "sequence" ? undefined : e.edge_kind,
      animated: stateOf(e.target) === "running",
      style: { stroke: style.stroke, strokeDasharray: style.dash },
      labelStyle: { fill: "#94a3b8", fontSize: 10, fontFamily: "JetBrains Mono, monospace" },
    });
  }
  return { nodes: out, edges };
}
