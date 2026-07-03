/**
 * LiveRun — Run Flow Graph live mode (spec 2026-07-02, D9).
 *
 * select run → fetch snapshot → render → fold SSE graph events → live
 * updates. fetch+getReader (NOT EventSource: the API wants a bearer
 * header). Repair attempts collapse behind a badge (D6); click a repair
 * node to expand; click any node for its evidence summary (D14).
 *
 * Query params: ?run=<orchestrate_id>&key=<bearer>  (api proxied via vite)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { DiagramNode, GroupLabelNode } from "@/components/DiagramNode";
import { applyEvent, applySnapshot, emptyModel, toFlow, type GraphModel } from "@/live/foldGraph";

const nodeTypes = {
  diagramNode: DiagramNode as any,
  groupLabel: GroupLabelNode as any,
};

function useQuery() {
  const p = new URLSearchParams(window.location.search);
  return { run: p.get("run") ?? "", key: p.get("key") ?? "" };
}

export default function LiveRun() {
  const q = useQuery();
  const [runs, setRuns] = useState<any[]>([]);
  const [runId, setRunId] = useState<string>(q.run);
  const [model, setModel] = useState<GraphModel>(() => emptyModel(q.run));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("idle");
  const abortRef = useRef<AbortController | null>(null);

  const headers = useMemo(() => ({ Authorization: `Bearer ${q.key}` }), [q.key]);

  useEffect(() => {
    fetch("/api/v2/runs", { headers })
      .then((r) => r.json())
      .then((d) => setRuns(d.runs ?? []))
      .catch(() => setStatus("run list failed"));
  }, [headers]);

  useEffect(() => {
    if (!runId) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    let live = true;

    (async () => {
      setStatus("loading snapshot…");
      const snap = await (await fetch(`/api/v2/runs/${runId}/graph`, { headers, signal: ac.signal })).json();
      if (!live) return;
      let m = applySnapshot(snap);
      setModel({ ...m });
      setStatus(`live · seq ${m.seq}`);

      // SSE via fetch+getReader (bearer header; EventSource can't).
      const resp = await fetch(
        `/api/v2/runs/${runId}/graph?stream=true&from_seq=${m.seq}`,
        { headers, signal: ac.signal },
      );
      const reader = resp.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !live) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          m = applyEvent(m, JSON.parse(dataLine.slice(6)));
          setModel({ ...m, nodes: m.nodes, edges: m.edges, states: m.states, evidence: m.evidence });
          setStatus(`live · seq ${m.seq}`);
        }
      }
    })().catch((e) => {
      if ((e as any)?.name !== "AbortError") setStatus(`stream error: ${e}`);
    });

    return () => { live = false; ac.abort(); };
  }, [runId, headers]);

  const { nodes, edges } = useMemo(
    () => toFlow(model, { expandedRepairs: expanded }),
    [model, expanded],
  );

  const onNodeClick = useCallback((_: any, node: any) => {
    if (node.id.endsWith("/repair")) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.has(node.id) ? next.delete(node.id) : next.add(node.id);
        return next;
      });
    }
    setSelected(node.id);
  }, []);

  const evidence = selected ? model.evidence.get(selected) : null;
  const selState = selected ? model.states.get(selected) : null;

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0b1020", color: "#e2e8f0" }}>
      <aside style={{ width: 280, borderRight: "1px solid #1e293b", padding: 16, overflowY: "auto", fontFamily: "JetBrains Mono, monospace" }}>
        <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 18, marginBottom: 4 }}>Live Run</h1>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>{status}</div>
        {runs.map((r) => (
          <button key={r.run_id}
            onClick={() => { setRunId(r.run_id); setModel(emptyModel(r.run_id)); setSelected(null); }}
            style={{
              display: "block", width: "100%", textAlign: "left", padding: "8px 10px",
              marginBottom: 6, borderRadius: 6, fontSize: 12, cursor: "pointer",
              border: "1px solid " + (r.run_id === runId ? "#38bdf8" : "#1e293b"),
              background: r.run_id === runId ? "#0c2233" : "#0f172a", color: "#e2e8f0",
            }}>
            {r.run_id}
            <div style={{ fontSize: 10, color: "#64748b" }}>{r.events} events</div>
          </button>
        ))}
        {selected && (
          <div style={{ marginTop: 16, borderTop: "1px solid #1e293b", paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: "#38bdf8", wordBreak: "break-all" }}>{selected}</div>
            <div style={{ fontSize: 12, margin: "6px 0" }}>
              state: <b>{selState?.state ?? "pending"}</b>
            </div>
            {selState?.detail && Object.keys(selState.detail).length > 0 && (
              <pre style={{ fontSize: 10, color: "#94a3b8", whiteSpace: "pre-wrap" }}>
                {JSON.stringify(selState.detail, null, 1)}
              </pre>
            )}
            {evidence ? (
              <div style={{ fontSize: 11 }}>
                <div style={{ color: "#64748b", margin: "8px 0 4px" }}>evidence</div>
                {Object.entries(evidence.counts_by_kind).map(([k, c]) => (
                  <div key={k} style={{ marginBottom: 4 }}>
                    <span style={{ color: "#a78bfa" }}>{k}</span> ×{c as number}
                    <div style={{ color: "#64748b", fontSize: 10, wordBreak: "break-all" }}>
                      {evidence.latest_by_kind[k]?.label} — {evidence.latest_by_kind[k]?.ref}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "#64748b" }}>no evidence attached</div>
            )}
          </div>
        )}
      </aside>
      <main style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodeClick={onNodeClick} fitView proOptions={{ hideAttribution: true }}>
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1e293b" />
          <Controls />
          <MiniMap pannable zoomable style={{ background: "#0f172a" }} />
        </ReactFlow>
      </main>
    </div>
  );
}
