/**
 * Home — SpecForge Standards-Extractor Architecture Diagrams
 * Design: Dark IDE / Technical Blueprint
 * Layout: Fixed left sidebar + full-viewport ReactFlow canvas
 * Typography: Space Grotesk (headings) + JetBrains Mono (labels) + Inter (body)
 */
import { useState } from "react";
import { DiagramCanvas } from "@/components/DiagramCanvas";

import { nodes as n1, edges as e1 } from "@/data/diagram01";
import { nodes as n2, edges as e2 } from "@/data/diagram02";
import { nodes as n3, edges as e3 } from "@/data/diagram03";
import { nodes as n4, edges as e4 } from "@/data/diagram04";
import { nodes as n5, edges as e5 } from "@/data/diagram05";
import { nodes as n6, edges as e6 } from "@/data/diagram06";
import { nodes as n7, edges as e7 } from "@/data/diagram07";
import { nodes as n8, edges as e8 } from "@/data/diagram08";
import { nodes as n9, edges as e9 } from "@/data/diagram09";

const DIAGRAMS = [
  {
    id: "01",
    title: "System Overview",
    description: "FastAPI service, all route groups, core modules, and external integrations",
    icon: "🏛️",
    nodes: n1,
    edges: e1,
  },
  {
    id: "02",
    title: "Standards Extraction Pipeline",
    description: "3-stage LLM extraction: Core & Tech Stack → APIs & DBs → Patterns & Security",
    icon: "⚗️",
    nodes: n2,
    edges: e2,
  },
  {
    id: "03",
    title: "Haikai Workflow",
    description: "Shape-spec chat → HaikaiOrchestrator 4-step chain → Git integration",
    icon: "🤖",
    nodes: n3,
    edges: e3,
  },
  {
    id: "04",
    title: "UML Class Hierarchy",
    description: "Strategy pattern, AST extractor hierarchy, LLM client factory, data models",
    icon: "📐",
    nodes: n4,
    edges: e4,
  },
  {
    id: "05",
    title: "ERD — Data Models",
    description: "All Pydantic models: requests, responses, jobs, specs, orchestration, AST, chat",
    icon: "🗃️",
    nodes: n5,
    edges: e5,
  },
  {
    id: "06",
    title: "Structural Analysis Engine",
    description: "AST pipeline: ctags → tree-sitter → ImportFollower → diagram builders → serialisers",
    icon: "🌳",
    nodes: n6,
    edges: e6,
  },
  {
    id: "07",
    title: "Async Verification Orchestration",
    description: "Spec-frozen → DAG run → 4-verifier AND gate · self-repair · observer-drift",
    icon: "🛡️",
    nodes: n7,
    edges: e7,
  },
  {
    id: "08",
    title: "API Sequence",
    description: "Full async job lifecycle: submit → queue → execute → poll → result",
    icon: "🔁",
    nodes: n8,
    edges: e8,
  },
  {
    id: "09",
    title: "Data Flow",
    description: "End-to-end data movement from HTTP request through strategies to output files",
    icon: "💧",
    nodes: n9,
    edges: e9,
  },
];

const LEGEND = [
  { label: "User / Client", color: "#3b82f6" },
  { label: "Gateway", color: "#10b981" },
  { label: "Core Service", color: "#8b5cf6" },
  { label: "Standards", color: "#22c55e" },
  { label: "Database / Store", color: "#f59e0b" },
  { label: "Ext. API / LLM", color: "#ef4444" },
  { label: "Agent / Chat", color: "#38bdf8" },
  { label: "Artifact", color: "#fb923c" },
  { label: "External", color: "#64748b" },
  { label: "CI/CD", color: "#fb923c" },
];

export default function Home() {
  const [activeId, setActiveId] = useState("01");
  const active = DIAGRAMS.find((d) => d.id === activeId)!;
  const activeIndex = DIAGRAMS.findIndex((d) => d.id === activeId);

  // Arrow key navigation between diagrams
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      const next = DIAGRAMS[(activeIndex + 1) % DIAGRAMS.length];
      setActiveId(next.id);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      const prev = DIAGRAMS[(activeIndex - 1 + DIAGRAMS.length) % DIAGRAMS.length];
      setActiveId(prev.id);
    }
  };

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        background: "#0a0d14",
        fontFamily: "'Inter', sans-serif",
        outline: "none",
      }}
    >
      {/* ── Sidebar ── */}
      <aside
        style={{
          width: 268,
          flexShrink: 0,
          background: "#0d1117",
          borderRight: "1px solid #1e2433",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Logo / header */}
        <div
          style={{
            padding: "20px 20px 16px",
            borderBottom: "1px solid #1e2433",
          }}
        >
          <div
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: 16,
              color: "#e2e8f0",
              letterSpacing: "-0.01em",
            }}
          >
            SpecForge
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              color: "#3b82f6",
              marginTop: 2,
              letterSpacing: "0.06em",
            }}
          >
            STANDARDS-EXTRACTOR · ARCHITECTURE
          </div>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {DIAGRAMS.map((d) => {
            const isActive = d.id === activeId;
            return (
              <button
                key={d.id}
                onClick={() => setActiveId(d.id)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "10px 20px",
                  background: isActive ? "rgba(59,130,246,0.08)" : "transparent",
                  borderLeft: isActive ? "3px solid #3b82f6" : "3px solid transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.15s, border-color 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.03)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                <span style={{ fontSize: 16, lineHeight: 1.4, flexShrink: 0 }}>{d.icon}</span>
                <div>
                  <div
                    style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontWeight: isActive ? 600 : 500,
                      fontSize: 12,
                      color: isActive ? "#e2e8f0" : "#94a3b8",
                      lineHeight: 1.3,
                    }}
                  >
                    {d.id} · {d.title}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "#475569",
                      marginTop: 2,
                      lineHeight: 1.4,
                    }}
                  >
                    {d.description}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Legend */}
        <div
          style={{
            padding: "12px 20px 16px",
            borderTop: "1px solid #1e2433",
          }}
        >
          <div
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 600,
              fontSize: 10,
              color: "#475569",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
            }}
          >
            Legend
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 8px" }}>
            {LEGEND.map((l) => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: l.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 10, color: "#64748b" }}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* ── Main canvas area ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <div
          style={{
            height: 52,
            flexShrink: 0,
            background: "#0d1117",
            borderBottom: "1px solid #1e2433",
            display: "flex",
            alignItems: "center",
            padding: "0 24px",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 20 }}>{active.icon}</span>
          <div>
            <div
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700,
                fontSize: 15,
                color: "#e2e8f0",
                letterSpacing: "-0.01em",
              }}
            >
              {active.title}
            </div>
            <div style={{ fontSize: 11, color: "#475569" }}>{active.description}</div>
          </div>

          {/* Diagram counter badge */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: "#3b82f6",
                background: "rgba(59,130,246,0.1)",
                border: "1px solid rgba(59,130,246,0.2)",
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              {active.id} / {DIAGRAMS.length.toString().padStart(2, "0")}
            </span>
            <span style={{ fontSize: 10, color: "#334155" }}>
              {active.nodes.length} nodes · {active.edges.length} edges
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: "#334155",
                marginLeft: 8,
              }}
            >
              ↑↓ to switch · scroll to zoom · drag to pan
            </span>
          </div>
        </div>

        {/* ReactFlow canvas — key forces full remount on diagram switch */}
        <div style={{ flex: 1, position: "relative" }}>
          <DiagramCanvas
            key={activeId}
            nodes={active.nodes}
            edges={active.edges}
          />
        </div>
      </div>
    </div>
  );
}
