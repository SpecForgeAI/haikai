/**
 * LiveNode — the Live Run view's own React Flow node (Orchid Blueprint).
 * Deliberately separate from DiagramNode so the nine static diagrams keep
 * their original look; the live theme is owned entirely by live/theme.ts.
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CHROME, kindColor, stateColor, STATE_GLYPH, tint } from "./theme";

export interface LiveNodeData {
  label: string;
  sublabel?: string;
  kind: string;    // node_kind — picks the hue
  state: string;   // lifecycle — picks glyph + state color
  badge?: string;  // e.g. the repair attempt badge
  [key: string]: unknown;
}

export function LiveNode({ data, selected }: NodeProps & { data: LiveNodeData }) {
  const hue = kindColor(data.kind);
  const sc = stateColor(data.state);
  const glyph = STATE_GLYPH[data.state] ?? "○";
  return (
    <div
      style={{
        minWidth: 170,
        maxWidth: 230,
        borderRadius: 8,
        border: `1px solid ${selected ? CHROME.accentHi : tint(hue, 0.55)}`,
        borderLeft: `4px solid ${hue}`,
        background: `linear-gradient(135deg, ${tint(hue, 0.14)}, ${CHROME.panel})`,
        boxShadow: selected
          ? `0 0 0 1px ${CHROME.accentHi}, 0 4px 18px ${tint(hue, 0.35)}`
          : `0 2px 10px ${tint("#000000", 0.45)}`,
        padding: "7px 10px",
        fontFamily: "Space Grotesk, sans-serif",
      }}
    >
      <Handle type="target" position={Position.Left}
              style={{ background: tint(hue, 0.9), border: "none", width: 7, height: 7 }} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ color: sc, fontSize: 12,
                       animation: data.state === "running" ? "livepulse 1.4s ease-in-out infinite" : undefined }}>
          {glyph}
        </span>
        <span style={{ color: CHROME.text, fontSize: 12, fontWeight: 600 }}>
          {data.label}
        </span>
        {data.badge && (
          <span style={{
            marginLeft: "auto", fontSize: 10, color: CHROME.bg, background: hue,
            borderRadius: 999, padding: "1px 7px",
            fontFamily: "JetBrains Mono, monospace", fontWeight: 700,
          }}>
            {data.badge}
          </span>
        )}
      </div>
      {data.sublabel && (
        <div style={{
          marginTop: 3, fontSize: 9.5, color: sc,
          fontFamily: "JetBrains Mono, monospace", opacity: 0.95,
        }}>
          {data.sublabel}
        </div>
      )}
      <div style={{
        marginTop: 3, fontSize: 8.5, color: CHROME.textMuted,
        fontFamily: "JetBrains Mono, monospace", letterSpacing: 0.4,
        textTransform: "uppercase",
      }}>
        {data.kind}
      </div>
      <Handle type="source" position={Position.Right}
              style={{ background: tint(hue, 0.9), border: "none", width: 7, height: 7 }} />
    </div>
  );
}

/** one-time keyframes for the running pulse */
if (typeof document !== "undefined" && !document.getElementById("livepulse-kf")) {
  const style = document.createElement("style");
  style.id = "livepulse-kf";
  style.textContent =
    "@keyframes livepulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }";
  document.head.appendChild(style);
}
