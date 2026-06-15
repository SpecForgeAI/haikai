/**
 * Diagram 01 — System Overview
 * Scope: standards-extractor service only
 * Source: src/api/__init__.py, docs/ARCHITECTURE.md
 */
import type { Node, Edge } from "@xyflow/react";
import type { DiagramNodeData } from "../components/DiagramNode";

export const nodes: Node<DiagramNodeData>[] = [
  // ── Client ──
  { id: "client", type: "diagramNode", position: { x: 520, y: 20 },
    data: { label: "API Client", sublabel: "Browser / CLI / CI runner", category: "user", icon: "🖥️", handles: { bottom: true } } },

  // ── Auth ──
  { id: "auth", type: "diagramNode", position: { x: 520, y: 120 },
    data: { label: "Bearer Auth", sublabel: "STANDARDS_API_KEY\nsrc/api_auth.py", category: "gateway", icon: "🔐", handles: { top: true, bottom: true } } },

  // ── FastAPI App ──
  { id: "api", type: "diagramNode", position: { x: 400, y: 240 },
    data: { label: "FastAPI Application", sublabel: "27 endpoints · 6 groups\nThreadPoolExecutor (4 workers)", category: "gateway", icon: "⚡", handles: { top: true, bottom: true, left: true, right: true } } },

  // ── 6 Endpoint Groups ──
  { id: "ep-std", type: "diagramNode", position: { x: 0, y: 400 },
    data: { label: "Standards Generation", sublabel: "global · product · metamodel", category: "core", icon: "📐", handles: { top: true, bottom: true } } },
  { id: "ep-specs", type: "diagramNode", position: { x: 180, y: 400 },
    data: { label: "Specifications", sublabel: "CRUD: list · get\nwrite · delete", category: "core", icon: "📋", handles: { top: true, bottom: true } } },
  { id: "ep-orch", type: "diagramNode", position: { x: 360, y: 400 },
    data: { label: "Orchestrations", sublabel: "v1 sync · v2 git-integrated\nbrain-only mode", category: "core", icon: "🔄", handles: { top: true, bottom: true } } },
  { id: "ep-chat", type: "diagramNode", position: { x: 540, y: 400 },
    data: { label: "Streaming Chat", sublabel: "shape-spec · plan-product\nstory-anchor · SSE", category: "agent", icon: "💬", handles: { top: true, bottom: true } } },
  { id: "ep-jobs", type: "diagramNode", position: { x: 720, y: 400 },
    data: { label: "Async Job Queue", sublabel: "create · poll · cancel\nSQLite-backed", category: "db", icon: "⏳", handles: { top: true, bottom: true } } },
  { id: "ep-struct", type: "diagramNode", position: { x: 900, y: 400 },
    data: { label: "Structural Analysis", sublabel: "analyze · raw · diagrams\nctags + tree-sitter", category: "standards", icon: "🔬", handles: { top: true, bottom: true } } },

  // ── Core Services ──
  { id: "op-exec", type: "diagramNode", position: { x: 0, y: 580 },
    data: { label: "OperationExecutor", sublabel: "Transport-agnostic dispatcher\npath safety validation", category: "core", icon: "⚙️", handles: { top: true, bottom: true } } },
  { id: "std-orch", type: "diagramNode", position: { x: 180, y: 580 },
    data: { label: "StandardsOrchestrator", sublabel: "FileScanner → FileAnalyzer\n→ Synthesizer → Reporter", category: "standards", icon: "🎼", handles: { top: true, bottom: true } } },
  { id: "agos-svc", type: "diagramNode", position: { x: 360, y: 580 },
    data: { label: "HaikaiService", sublabel: "Spec lifecycle CRUD\nAPICommandExecutor", category: "agent", icon: "🤖", handles: { top: true, bottom: true } } },
  { id: "agos-orch", type: "diagramNode", position: { x: 540, y: 580 },
    data: { label: "HaikaiOrchestrator", sublabel: "write-spec → create-tasks\n→ implement-tasks chain", category: "agent", icon: "🧩", handles: { top: true, bottom: true } } },
  { id: "chat-exec", type: "diagramNode", position: { x: 720, y: 580 },
    data: { label: "Chat Executors", sublabel: "ClaudeChatExecutor\nOAuthChatExecutor\nOpenAIChatExecutor", category: "agent", icon: "🗣️", handles: { top: true, bottom: true } } },
  { id: "ast-pipe", type: "diagramNode", position: { x: 900, y: 580 },
    data: { label: "AST Pipeline", sublabel: "CtagsProvider + TreeSitter\nProviderRegistry → FileStore", category: "standards", icon: "🌳", handles: { top: true, bottom: true } } },

  // ── Shared Infrastructure ──
  { id: "llm", type: "diagramNode", position: { x: 200, y: 760 },
    data: { label: "LLMClient", sublabel: "Anthropic · OpenAI · Azure · Custom\nno fallbacks · fail-fast", category: "gateway", icon: "🧠", handles: { top: true, bottom: true } } },
  { id: "job-queue", type: "diagramNode", position: { x: 500, y: 760 },
    data: { label: "JobQueue + Worker", sublabel: "SQLite jobs.db\nBackground worker process", category: "db", icon: "📦", handles: { top: true, bottom: true } } },
  { id: "workspace", type: "diagramNode", position: { x: 800, y: 760 },
    data: { label: "API Workspace", sublabel: "api_workspace/{company}/{project}\nspecs · standards · chat_logs", category: "db", icon: "🗂️", handles: { top: true, bottom: true } } },

  // ── External ──
  { id: "anthropic", type: "diagramNode", position: { x: 60, y: 920 },
    data: { label: "Anthropic API", sublabel: "claude-sonnet-4-6\nAPI key + OAuth (sk-ant-oat)", category: "extapi", icon: "🔴", handles: { top: true } } },
  { id: "openai", type: "diagramNode", position: { x: 280, y: 920 },
    data: { label: "OpenAI API", sublabel: "gpt-* / o* models", category: "extapi", icon: "🟢", handles: { top: true } } },
  { id: "github", type: "diagramNode", position: { x: 500, y: 920 },
    data: { label: "GitHub / GitLab / Bitbucket", sublabel: "Repo cloning · owner allowlist\ntoken scrubbing", category: "external", icon: "🐙", handles: { top: true } } },
  { id: "git-remote", type: "diagramNode", position: { x: 760, y: 920 },
    data: { label: "Git Remote", sublabel: "auto-branch · commit · push\nPR creation (v2 workflows)", category: "external", icon: "🌿", handles: { top: true } } },
];

export const edges: Edge[] = [
  { id: "e-c-a", source: "client", target: "auth", label: "Bearer token", style: { stroke: "#10b981" } },
  { id: "e-a-api", source: "auth", target: "api", style: { stroke: "#10b981" } },

  // API → endpoint groups
  { id: "e-api-std", source: "api", target: "ep-std", style: { stroke: "#8b5cf6" } },
  { id: "e-api-specs", source: "api", target: "ep-specs", style: { stroke: "#8b5cf6" } },
  { id: "e-api-orch", source: "api", target: "ep-orch", style: { stroke: "#8b5cf6" } },
  { id: "e-api-chat", source: "api", target: "ep-chat", style: { stroke: "#38bdf8" } },
  { id: "e-api-jobs", source: "api", target: "ep-jobs", style: { stroke: "#f59e0b" } },
  { id: "e-api-struct", source: "api", target: "ep-struct", style: { stroke: "#22c55e" } },

  // Endpoint groups → services
  { id: "e-std-opex", source: "ep-std", target: "op-exec", style: { stroke: "#22c55e" } },
  { id: "e-opex-sorch", source: "op-exec", target: "std-orch", style: { stroke: "#22c55e" } },
  { id: "e-specs-agos", source: "ep-specs", target: "agos-svc", style: { stroke: "#38bdf8" } },
  { id: "e-orch-agos", source: "ep-orch", target: "agos-orch", style: { stroke: "#38bdf8" } },
  { id: "e-chat-exec", source: "ep-chat", target: "chat-exec", style: { stroke: "#38bdf8" } },
  { id: "e-jobs-jq", source: "ep-jobs", target: "job-queue", style: { stroke: "#f59e0b" } },
  { id: "e-struct-ast", source: "ep-struct", target: "ast-pipe", style: { stroke: "#22c55e" } },

  // Services → LLM
  { id: "e-sorch-llm", source: "std-orch", target: "llm", style: { stroke: "#64748b" } },
  { id: "e-chat-llm", source: "chat-exec", target: "llm", style: { stroke: "#64748b" } },
  { id: "e-agos-llm", source: "agos-svc", target: "llm", style: { stroke: "#64748b" } },
  { id: "e-ast-llm", source: "ast-pipe", target: "llm", label: "complex files only", style: { stroke: "#64748b", strokeDasharray: "4 3" } },

  // Services → storage
  { id: "e-agos-ws", source: "agos-svc", target: "workspace", style: { stroke: "#f59e0b" } },
  { id: "e-ast-ws", source: "ast-pipe", target: "workspace", label: "structural store", style: { stroke: "#f59e0b" } },
  { id: "e-jq-ws", source: "job-queue", target: "workspace", label: "jobs.db", style: { stroke: "#f59e0b" } },

  // LLM → external APIs
  { id: "e-llm-ant", source: "llm", target: "anthropic", style: { stroke: "#ef4444" } },
  { id: "e-llm-oai", source: "llm", target: "openai", style: { stroke: "#ef4444" } },
  { id: "e-sorch-gh", source: "std-orch", target: "github", label: "clone repos", style: { stroke: "#64748b", strokeDasharray: "4 3" } },
  { id: "e-agos-git", source: "agos-orch", target: "git-remote", label: "branch · commit · PR", style: { stroke: "#64748b", strokeDasharray: "4 3" } },
];
