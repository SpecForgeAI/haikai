/**
 * Design: Technical Blueprint / Engineering Schematic
 * Full-screen React Flow diagram — Mono vs Poly repo pipeline
 */
import FlowDiagram from "@/components/FlowDiagram";

export default function Home() {
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0f1117",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 24px",
          borderBottom: "1px solid #1e2130",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#3b82f6",
            boxShadow: "0 0 8px #3b82f6",
          }}
        />
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            color: "#e2e8f0",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.04em",
          }}
        >
          standards-extractor
        </span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            color: "#6b7280",
            fontSize: 11,
          }}
        >
          /
        </span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            color: "#9ca3af",
            fontSize: 11,
          }}
        >
          spec/multi-repo-product-orchestration
        </span>
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            color: "#4b5563",
            fontSize: 10,
            letterSpacing: "0.08em",
          }}
        >
          Mono vs Poly Repo — Pipeline Flow
        </div>
      </div>

      {/* Flow canvas */}
      <div style={{ flex: 1, position: "relative" }}>
        <FlowDiagram />
      </div>
    </div>
  );
}
