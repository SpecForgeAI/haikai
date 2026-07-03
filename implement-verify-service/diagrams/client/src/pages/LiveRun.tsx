/**
 * LiveRun — Run Flow Graph live mode (spec 2026-07-02, D9).
 * Theme: Orchid Blueprint purple/lilac pack — LIGHT by default, dark via
 * the toggle (persisted). live/theme.ts owns EVERY color in both modes.
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
import { LiveNode } from "@/live/LiveNode";
import { LiveThemeContext, loadThemeMode, saveThemeMode } from "@/live/LiveThemeContext";
import { applyEvent, applySnapshot, emptyModel, toFlow, type GraphModel } from "@/live/foldGraph";
import { THEMES, kindColor, stateColor, tint } from "@/live/theme";

const nodeTypes = { liveNode: LiveNode as any };

function useQuery() {
  const p = new URLSearchParams(window.location.search);
  return { run: p.get("run") ?? "", key: p.get("key") ?? "" };
}

const mono: React.CSSProperties = { fontFamily: "JetBrains Mono, monospace" };

export default function LiveRun() {
  const q = useQuery();
  const [mode, setMode] = useState<keyof typeof THEMES>(loadThemeMode);
  const t = THEMES[mode];
  const [runs, setRuns] = useState<any[]>([]);
  const [runId, setRunId] = useState<string>(q.run);
  const [model, setModel] = useState<GraphModel>(() => emptyModel(q.run));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("idle");
  const abortRef = useRef<AbortController | null>(null);

  const headers = useMemo(() => ({ Authorization: `Bearer ${q.key}` }), [q.key]);

  const toggleMode = () => {
    const next = mode === "light" ? "dark" : "light";
    setMode(next);
    saveThemeMode(next);
  };

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
    () => toFlow(model, { expandedRepairs: expanded, theme: t }),
    [model, expanded, t],
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
    <LiveThemeContext.Provider value={t}>
      <div style={{ display: "flex", height: "100vh", background: t.chrome.bg, color: t.chrome.text }}>
        <aside style={{ width: 280, borderRight: `1px solid ${t.chrome.panelBorder}`,
                        background: t.chrome.panel, padding: 16, overflowY: "auto", ...mono }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 18,
                         color: t.chrome.accentHi }}>Live Run</h1>
            <button onClick={toggleMode} title={`switch to ${mode === "light" ? "dark" : "light"} mode`}
              style={{
                border: `1px solid ${t.chrome.panelBorder}`, background: t.chrome.bg,
                color: t.chrome.text, borderRadius: 999, padding: "3px 10px",
                fontSize: 12, cursor: "pointer", ...mono,
              }}>
              {mode === "light" ? "☾ dark" : "☀ light"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: t.chrome.textMuted, margin: "6px 0 12px" }}>{status}</div>
          {runs.map((r) => (
            <button key={r.run_id}
              onClick={() => { setRunId(r.run_id); setModel(emptyModel(r.run_id)); setSelected(null); }}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 10px",
                marginBottom: 6, borderRadius: 6, fontSize: 12, cursor: "pointer", ...mono,
                border: `1px solid ${r.run_id === runId ? t.chrome.accent : t.chrome.panelBorder}`,
                background: r.run_id === runId ? tint(t.chrome.accent, 0.1) : t.chrome.bg,
                color: r.run_id === runId ? t.chrome.accentHi : t.chrome.text,
              }}>
              {r.run_id}
              <div style={{ fontSize: 10, color: t.chrome.textMuted }}>{r.events} events</div>
            </button>
          ))}
          {selected && (
            <div style={{ marginTop: 16, borderTop: `1px solid ${t.chrome.panelBorder}`, paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: t.chrome.accent, wordBreak: "break-all" }}>{selected}</div>
              <div style={{ fontSize: 12, margin: "6px 0" }}>
                state:{" "}
                <b style={{ color: stateColor(t, selState?.state ?? "pending") }}>
                  {selState?.state ?? "pending"}
                </b>
              </div>
              {selState?.detail && Object.keys(selState.detail).length > 0 && (
                <pre style={{ fontSize: 10, color: t.chrome.textMuted, whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(selState.detail, null, 1)}
                </pre>
              )}
              {evidence ? (
                <div style={{ fontSize: 11 }}>
                  <div style={{ color: t.chrome.textMuted, margin: "8px 0 4px" }}>evidence</div>
                  {Object.entries(evidence.counts_by_kind).map(([k, c]) => (
                    <div key={k} style={{ marginBottom: 4 }}>
                      <span style={{ color: kindColor(t, "repair") }}>{k}</span> ×{c as number}
                      <div style={{ color: t.chrome.textMuted, fontSize: 10, wordBreak: "break-all" }}>
                        {evidence.latest_by_kind[k]?.label} — {evidence.latest_by_kind[k]?.ref}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: t.chrome.textMuted }}>no evidence attached</div>
              )}
            </div>
          )}
        </aside>
        <main className="live-run"
              style={{ flex: 1,
                       ["--lr-panel" as any]: t.chrome.panel,
                       ["--lr-border" as any]: t.chrome.panelBorder,
                       ["--lr-muted" as any]: t.chrome.textMuted,
                       ["--lr-text" as any]: t.chrome.text,
                       ["--lr-shadow" as any]: t.chrome.shadow }}>
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodeClick={onNodeClick} fitView proOptions={{ hideAttribution: true }}
            colorMode={mode}
            style={{ background: t.chrome.bg }}>
            {/* bgColor is load-bearing: the app shell's ThemeProvider keeps a
                global `dark` class on <html>, so the transparent pane would
                otherwise show the near-black body through the canvas. */}
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.2}
                        color={t.chrome.canvasDot} bgColor={t.chrome.bg} />
            <Controls style={{ background: t.chrome.panel, borderRadius: 8 }} />
            <MiniMap pannable zoomable
                     style={{ background: t.chrome.panel }}
                     maskColor={tint(t.chrome.bg, 0.75)}
                     nodeColor={(n: any) => tint(kindColor(t, n?.data?.kind ?? "run"), 0.85)} />
          </ReactFlow>
        </main>
      </div>
    </LiveThemeContext.Provider>
  );
}
