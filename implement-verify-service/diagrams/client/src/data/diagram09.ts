/**
 * Diagram 09 — Data Flow
 * Scope: End-to-end data movement through standards-extractor
 * Source: src/api/routes/, src/standards_orchestrator.py, src/operation_executor.py
 *
 * (was diagram07 on main; renumbered to 09 during merge to make
 *  room for the branch's Async Verification Orchestration at slot 07.)
 */
import type { Node, Edge } from "@xyflow/react";
import type { DiagramNodeData } from "../components/DiagramNode";

export const nodes: Node<DiagramNodeData>[] = [
  // ── External inputs ──
  { id: "client", type: "diagramNode", position: { x: 400, y: 0 },
    data: { label: "API Client", sublabel: "HTTP request\nJSON body", category: "user", icon: "🖥️", handles: { bottom: true } } },
  { id: "github-src", type: "diagramNode", position: { x: 800, y: 0 },
    data: { label: "GitHub / Source Repo", sublabel: "Remote repository\ncode files", category: "external", icon: "🐙", handles: { bottom: true } } },

  // ── API Layer ──
  { id: "lbl-api", type: "groupLabel", position: { x: -20, y: 80 }, data: { label: "API Layer — FastAPI (:8005)", color: "#38bdf8" } },
  { id: "router", type: "diagramNode", position: { x: 400, y: 110 },
    data: { label: "FastAPI Router", sublabel: "/api/v1/standards\n/api/v1/shape-spec\n/api/v2/orchestrations\n/api/v1/specs\n/api/v1/jobs\n/api/v1/structural", category: "core", icon: "🚀", handles: { top: true, bottom: true } } },

  // ── Routing decision ──
  { id: "sync-path", type: "diagramNode", position: { x: 200, y: 280 },
    data: { label: "Sync Path", sublabel: "Direct execution\nBlocking response", category: "gateway", icon: "⚡", handles: { top: true, bottom: true } } },
  { id: "async-path", type: "diagramNode", position: { x: 600, y: 280 },
    data: { label: "Async Path", sublabel: "Job submitted\nPoll /jobs/{id}", category: "gateway", icon: "🔄", handles: { top: true, bottom: true } } },

  // ── Async job queue ──
  { id: "job-queue", type: "diagramNode", position: { x: 600, y: 420 },
    data: { label: "AsyncJobQueue", sublabel: "SQLite store\nThreadPoolExecutor\nmax_workers configurable", category: "db", icon: "⏳", handles: { top: true, bottom: true } } },

  // ── Core execution ──
  { id: "lbl-exec", type: "groupLabel", position: { x: -20, y: 560 }, data: { label: "Core Execution Layer", color: "#8b5cf6" } },
  { id: "op-executor", type: "diagramNode", position: { x: 200, y: 590 },
    data: { label: "OperationExecutor", sublabel: "Dispatches by mode\nGET_METAMODEL\nGENERATE_GLOBAL_STANDARDS\nGENERATE_PRODUCT_STANDARDS", category: "core", icon: "⚙️", handles: { top: true, bottom: true } } },
  { id: "std-orch", type: "diagramNode", position: { x: 600, y: 590 },
    data: { label: "StandardsOrchestrator", sublabel: "Coordinates all strategies\nBuilds analysis context\nMerges outputs", category: "core", icon: "🎛️", handles: { top: true, bottom: true } } },

  // ── Workspace ──
  { id: "workspace", type: "diagramNode", position: { x: 1000, y: 280 },
    data: { label: "Local Workspace", sublabel: "Cloned repo files\nstandards_workspace volume", category: "db", icon: "💾", handles: { top: true, bottom: true, left: true } } },

  // ── Strategy fan-out ──
  { id: "lbl-strat", type: "groupLabel", position: { x: -20, y: 760 }, data: { label: "Strategy Fan-out", color: "#f59e0b" } },
  { id: "strat-coding", type: "diagramNode", position: { x: 0, y: 790 },
    data: { label: "CodingStyleStrategy", sublabel: "LLM prompt + code context", category: "standards", icon: "🎨", handles: { top: true, bottom: true } } },
  { id: "strat-conv", type: "diagramNode", position: { x: 180, y: 790 },
    data: { label: "ConventionsStrategy", sublabel: "LLM prompt + code context", category: "standards", icon: "📏", handles: { top: true, bottom: true } } },
  { id: "strat-err", type: "diagramNode", position: { x: 360, y: 790 },
    data: { label: "ErrorHandlingStrategy", sublabel: "LLM prompt + code context", category: "standards", icon: "🚨", handles: { top: true, bottom: true } } },
  { id: "strat-ast", type: "diagramNode", position: { x: 540, y: 790 },
    data: { label: "AstAnalysisStrategy", sublabel: "tree-sitter + ctags", category: "standards", icon: "🌳", handles: { top: true, bottom: true } } },
  { id: "strat-tech", type: "diagramNode", position: { x: 720, y: 790 },
    data: { label: "TechStackStrategy", sublabel: "LLM prompt + code context", category: "standards", icon: "🔧", handles: { top: true, bottom: true } } },

  // ── LLM ──
  { id: "llm", type: "diagramNode", position: { x: 400, y: 960 },
    data: { label: "LLMClient", sublabel: "Anthropic · OpenAI · Azure\nCustom OpenAI-compatible", category: "extapi", icon: "🧠", handles: { top: true, bottom: true } } },

  // ── Output assembly ──
  { id: "lbl-out", type: "groupLabel", position: { x: -20, y: 1100 }, data: { label: "Output Assembly", color: "#22c55e" } },
  { id: "merger", type: "diagramNode", position: { x: 200, y: 1130 },
    data: { label: "ResultMerger", sublabel: "Combines all strategy outputs\nDeduplicates · validates", category: "core", icon: "🔀", handles: { top: true, bottom: true } } },
  { id: "file-writer", type: "diagramNode", position: { x: 500, y: 1130 },
    data: { label: "FileWriter", sublabel: "Writes .md standards files\nto output_dir", category: "artifact", icon: "📝", handles: { top: true, bottom: true } } },
  { id: "op-resp", type: "diagramNode", position: { x: 350, y: 1280 },
    data: { label: "OperationResponse", sublabel: "success · output_dir\noutputs: List[Path]\nmessage · errors", category: "db", icon: "📤", handles: { top: true, bottom: true } } },
  { id: "client-resp", type: "diagramNode", position: { x: 350, y: 1420 },
    data: { label: "HTTP Response / SSE Stream", sublabel: "JSON or Server-Sent Events", category: "user", icon: "📡", handles: { top: true } } },
];

export const edges: Edge[] = [
  // Client → router
  { id: "e-cl-rt", source: "client", target: "router", style: { stroke: "#38bdf8" } },
  // GitHub → workspace
  { id: "e-gh-ws", source: "github-src", target: "workspace", label: "git clone", style: { stroke: "#64748b" } },
  // Router → sync/async
  { id: "e-rt-sy", source: "router", target: "sync-path", label: "sync mode", style: { stroke: "#38bdf8" } },
  { id: "e-rt-as", source: "router", target: "async-path", label: "async mode", style: { stroke: "#38bdf8" } },
  // Async → job queue
  { id: "e-as-jq", source: "async-path", target: "job-queue", style: { stroke: "#f59e0b" } },
  // Both paths → executor
  { id: "e-sy-oe", source: "sync-path", target: "op-executor", style: { stroke: "#8b5cf6" } },
  { id: "e-jq-oe", source: "job-queue", target: "op-executor", label: "worker thread", style: { stroke: "#f59e0b" } },
  // Executor → orchestrator
  { id: "e-oe-so", source: "op-executor", target: "std-orch", style: { stroke: "#8b5cf6" } },
  // Workspace feeds orchestrator
  { id: "e-ws-so", source: "workspace", target: "std-orch", label: "source files", style: { stroke: "#64748b", strokeDasharray: "4 3" } },
  // Orchestrator → strategies
  { id: "e-so-sc", source: "std-orch", target: "strat-coding", style: { stroke: "#f59e0b" } },
  { id: "e-so-sv", source: "std-orch", target: "strat-conv", style: { stroke: "#f59e0b" } },
  { id: "e-so-se", source: "std-orch", target: "strat-err", style: { stroke: "#f59e0b" } },
  { id: "e-so-sa", source: "std-orch", target: "strat-ast", style: { stroke: "#f59e0b" } },
  { id: "e-so-st", source: "std-orch", target: "strat-tech", style: { stroke: "#f59e0b" } },
  // Strategies → LLM
  { id: "e-sc-llm", source: "strat-coding", target: "llm", style: { stroke: "#ef4444" } },
  { id: "e-sv-llm", source: "strat-conv", target: "llm", style: { stroke: "#ef4444" } },
  { id: "e-se-llm", source: "strat-err", target: "llm", style: { stroke: "#ef4444" } },
  { id: "e-st-llm", source: "strat-tech", target: "llm", style: { stroke: "#ef4444" } },
  // Strategies → merger
  { id: "e-sc-mr", source: "strat-coding", target: "merger", style: { stroke: "#22c55e" } },
  { id: "e-sa-mr", source: "strat-ast", target: "merger", style: { stroke: "#22c55e" } },
  { id: "e-llm-mr", source: "llm", target: "merger", label: "LLM responses", style: { stroke: "#22c55e" } },
  // Output assembly
  { id: "e-mr-fw", source: "merger", target: "file-writer", style: { stroke: "#22c55e" } },
  { id: "e-fw-or", source: "file-writer", target: "op-resp", style: { stroke: "#22c55e" } },
  { id: "e-or-cr", source: "op-resp", target: "client-resp", style: { stroke: "#38bdf8" } },
];
