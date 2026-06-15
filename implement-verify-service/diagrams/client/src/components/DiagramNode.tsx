/**
 * DiagramNode — custom ReactFlow node
 * Design: Dark IDE / Technical Blueprint
 * Left-border accent stripe, colour-coded by category, monospace port labels
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";

export type NodeCategory =
  | "frontend"
  | "gateway"
  | "core"
  | "db"
  | "external"
  | "extapi"
  | "agent"
  | "artifact"
  | "standards"
  | "phase"
  | "user"
  | "cicd"
  | "volume";

export interface DiagramNodeData {
  label: string;
  sublabel?: string;
  category?: NodeCategory;
  description?: string;
  port?: string;
  icon?: string;
  handles?: {
    top?: boolean;
    bottom?: boolean;
    left?: boolean;
    right?: boolean;
  };
  [key: string]: unknown;
}

export interface GroupLabelData {
  label: string;
  color?: string;
  category?: NodeCategory;
  [key: string]: unknown;
}

const CATEGORY_STYLES: Record<NodeCategory, { border: string; bg: string; text: string; badge: string }> = {
  frontend: {
    border: "#3b82f6",
    bg: "rgba(59,130,246,0.08)",
    text: "#93c5fd",
    badge: "rgba(59,130,246,0.2)",
  },
  gateway: {
    border: "#10b981",
    bg: "rgba(16,185,129,0.08)",
    text: "#6ee7b7",
    badge: "rgba(16,185,129,0.2)",
  },
  core: {
    border: "#8b5cf6",
    bg: "rgba(139,92,246,0.08)",
    text: "#c4b5fd",
    badge: "rgba(139,92,246,0.2)",
  },
  db: {
    border: "#f59e0b",
    bg: "rgba(245,158,11,0.08)",
    text: "#fcd34d",
    badge: "rgba(245,158,11,0.2)",
  },
  external: {
    border: "#64748b",
    bg: "rgba(100,116,139,0.08)",
    text: "#94a3b8",
    badge: "rgba(100,116,139,0.2)",
  },
  extapi: {
    border: "#ef4444",
    bg: "rgba(239,68,68,0.08)",
    text: "#fca5a5",
    badge: "rgba(239,68,68,0.2)",
  },
  agent: {
    border: "#38bdf8",
    bg: "rgba(56,189,248,0.08)",
    text: "#7dd3fc",
    badge: "rgba(56,189,248,0.2)",
  },
  artifact: {
    border: "#f59e0b",
    bg: "rgba(245,158,11,0.06)",
    text: "#fcd34d",
    badge: "rgba(245,158,11,0.15)",
  },
  standards: {
    border: "#22c55e",
    bg: "rgba(34,197,94,0.07)",
    text: "#86efac",
    badge: "rgba(34,197,94,0.15)",
  },
  phase: {
    border: "#475569",
    bg: "rgba(71,85,105,0.06)",
    text: "#94a3b8",
    badge: "rgba(71,85,105,0.15)",
  },
  user: {
    border: "#a78bfa",
    bg: "rgba(167,139,250,0.08)",
    text: "#c4b5fd",
    badge: "rgba(167,139,250,0.2)",
  },
  cicd: {
    border: "#fb923c",
    bg: "rgba(251,146,60,0.08)",
    text: "#fdba74",
    badge: "rgba(251,146,60,0.2)",
  },
  volume: {
    border: "#facc15",
    bg: "rgba(250,204,21,0.07)",
    text: "#fde68a",
    badge: "rgba(250,204,21,0.15)",
  },
};

export function DiagramNode({ data, selected }: NodeProps) {
  const d = data as DiagramNodeData;
  const style = CATEGORY_STYLES[d.category ?? "external"] ?? CATEGORY_STYLES.external;
  const handles = d.handles ?? { top: true, bottom: true, left: true, right: true };

  return (
    <div
      className="sf-node-enter"
      style={{
        minWidth: 160,
        maxWidth: 220,
        background: style.bg,
        borderTop: `1px solid ${selected ? style.border : "rgba(71,85,105,0.6)"}`,
        borderRight: `1px solid ${selected ? style.border : "rgba(71,85,105,0.6)"}`,
        borderBottom: `1px solid ${selected ? style.border : "rgba(71,85,105,0.6)"}`,
        borderLeft: `3px solid ${style.border}`,
        borderRadius: 8,
        padding: "10px 14px",
        boxShadow: selected
          ? `0 0 0 2px ${style.border}44, 0 4px 24px rgba(0,0,0,0.5)`
          : "0 2px 12px rgba(0,0,0,0.4)",
        transition: "box-shadow 0.2s, border-color 0.2s",
        position: "relative",
        cursor: "default",
      }}
    >
      {handles.top && <Handle type="target" position={Position.Top} style={{ background: "#334155", border: "2px solid #475569" }} />}
      {handles.bottom && <Handle type="source" position={Position.Bottom} style={{ background: "#334155", border: "2px solid #475569" }} />}
      {handles.left && <Handle type="target" position={Position.Left} style={{ background: "#334155", border: "2px solid #475569" }} />}
      {handles.right && <Handle type="source" position={Position.Right} style={{ background: "#334155", border: "2px solid #475569" }} />}

      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        {d.icon && (
          <span style={{ fontSize: 16, lineHeight: 1.2, flexShrink: 0 }}>{d.icon}</span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 600,
              fontSize: 12,
              color: style.text,
              lineHeight: 1.3,
              wordBreak: "break-word",
            }}
          >
            {d.label}
          </div>
          {d.sublabel && (
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: "#64748b",
                marginTop: 2,
                whiteSpace: "pre-wrap",
              }}
            >
              {d.sublabel}
            </div>
          )}
        </div>
      </div>

      {d.port && (
        <div
          style={{
            marginTop: 6,
            display: "inline-block",
            background: style.badge,
            color: style.text,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 4,
            border: `1px solid ${style.border}44`,
          }}
        >
          {d.port}
        </div>
      )}
    </div>
  );
}

/** Compact group label node for subgraph section headers */
export function GroupLabelNode({ data }: NodeProps) {
  const d = data as GroupLabelData;
  return (
    <div
      style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontWeight: 700,
        fontSize: 11,
        color: d.color ?? "#475569",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        pointerEvents: "none",
        userSelect: "none",
        background: "transparent",
        border: "none",
        padding: 0,
      }}
    >
      {d.label}
    </div>
  );
}
