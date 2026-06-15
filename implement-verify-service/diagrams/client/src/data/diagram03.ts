/**
 * Diagram 03 — Haikai Workflow
 * Scope: HaikaiOrchestrator + ChatExecutor chain
 * Source: src/haikai_orchestrator.py, src/api/routes/chat.py, src/api/routes/orchestration.py
 */
import type { Node, Edge } from "@xyflow/react";
import type { DiagramNodeData } from "../components/DiagramNode";

export const nodes: Node<DiagramNodeData>[] = [
  // ── Client ──
  { id: "client", type: "diagramNode", position: { x: 360, y: 0 },
    data: { label: "API Client", sublabel: "POST /api/v1/shape-spec/stream\nPOST /api/v2/orchestrations", category: "user", icon: "🖥️", handles: { bottom: true } } },

  // ── Pre-condition ──
  { id: "spec-folder", type: "diagramNode", position: { x: 100, y: 120 },
    data: { label: "Spec Folder Check", sublabel: "requirements.md MUST exist\nOrchestrator never creates stubs", category: "gateway", icon: "📁", handles: { top: true, bottom: true } } },
  { id: "session-store", type: "diagramNode", position: { x: 600, y: 120 },
    data: { label: "SessionStore", sublabel: "create_active_session()\nUUID → workspace mapping", category: "db", icon: "🔑", handles: { top: true, bottom: true } } },

  // ── Phase A: Shape-Spec (Chat) ──
  { id: "lbl-a", type: "groupLabel", position: { x: -20, y: 220 }, data: { label: "Phase A — Shape-Spec (Conversational)", color: "#38bdf8" } },
  { id: "chat-ep", type: "diagramNode", position: { x: 100, y: 250 },
    data: { label: "POST /shape-spec/stream", sublabel: "SSE streaming endpoint\nChatMessageRequest", category: "agent", icon: "💬", handles: { top: true, bottom: true } } },
  { id: "chat-exec-factory", type: "diagramNode", position: { x: 100, y: 370 },
    data: { label: "ChatExecutorFactory", sublabel: "BackendRegistry dispatch\nClaude · OAuth · OpenAI", category: "core", icon: "🏭", handles: { top: true, bottom: true } } },
  { id: "claude-exec", type: "diagramNode", position: { x: 0, y: 490 },
    data: { label: "ClaudeChatExecutor", sublabel: "claude CLI subprocess\n--session-id resume", category: "agent", icon: "🤖", handles: { top: true, bottom: true } } },
  { id: "oauth-exec", type: "diagramNode", position: { x: 200, y: 490 },
    data: { label: "OAuthChatExecutor", sublabel: "Anthropic OAuth token\nsk-ant-oat-*", category: "agent", icon: "🔐", handles: { top: true, bottom: true } } },
  { id: "shape-out", type: "diagramNode", position: { x: 100, y: 610 },
    data: { label: "requirements.md", sublabel: "Spec folder + context files\nhaikai/specs/{spec_name}/", category: "artifact", icon: "📝", handles: { top: true, bottom: true } } },

  // ── Phase B: Orchestration ──
  { id: "lbl-b", type: "groupLabel", position: { x: 420, y: 220 }, data: { label: "Phase B — Automated Orchestration", color: "#8b5cf6" } },
  { id: "orch-ep", type: "diagramNode", position: { x: 600, y: 250 },
    data: { label: "POST /api/v2/orchestrations", sublabel: "OrchestrationRequest\nspec_intents[] · options", category: "core", icon: "🔄", handles: { top: true, bottom: true } } },
  { id: "orch-class", type: "diagramNode", position: { x: 600, y: 370 },
    data: { label: "HaikaiOrchestrator", sublabel: "4-step command chain\nper-spec loop", category: "core", icon: "🧩", handles: { top: true, bottom: true } } },

  // ── 4 Commands ──
  { id: "cmd1", type: "diagramNode", position: { x: 420, y: 510 },
    data: { label: "Step 1: /write-spec", sublabel: "Generate spec.md from\nrequirements.md", category: "agent", icon: "✍️", handles: { top: true, bottom: true } } },
  { id: "cmd2", type: "diagramNode", position: { x: 600, y: 510 },
    data: { label: "Step 2: /create-tasks", sublabel: "Generate tasks.md\nfrom spec.md", category: "agent", icon: "📋", handles: { top: true, bottom: true } } },
  { id: "cmd3", type: "diagramNode", position: { x: 780, y: 510 },
    data: { label: "Step 3: /implement-tasks", sublabel: "Execute all tasks\nCode generation", category: "agent", icon: "⚙️", handles: { top: true, bottom: true } } },
  { id: "cmd4", type: "diagramNode", position: { x: 600, y: 630 },
    data: { label: "Step 4: /git-commit-preparation", sublabel: "non_fatal=True\nPrepare for git commit", category: "agent", icon: "🌿", handles: { top: true, bottom: true } } },

  // ── Git Workflow ──
  { id: "lbl-c", type: "groupLabel", position: { x: 420, y: 740 }, data: { label: "Phase C — Git Integration (v2 only)", color: "#fb923c" } },
  { id: "git-wf", type: "diagramNode", position: { x: 600, y: 770 },
    data: { label: "apply_git_workflow()", sublabel: "create-branch → commit\n→ push → PR", category: "cicd", icon: "🔀", handles: { top: true, bottom: true } } },
  { id: "git-mgr", type: "diagramNode", position: { x: 600, y: 890 },
    data: { label: "GitManager", sublabel: "GitHub · GitLab · Bitbucket\nauto_push · auto_pr config", category: "external", icon: "🐙", handles: { top: true, bottom: true } } },

  // ── Outputs ──
  { id: "out-spec", type: "diagramNode", position: { x: 420, y: 890 },
    data: { label: "spec.md + tasks.md", sublabel: "haikai/specs/{name}/", category: "artifact", icon: "📃", handles: { top: true } } },
  { id: "out-impl", type: "diagramNode", position: { x: 780, y: 890 },
    data: { label: "Implementation Package", sublabel: "ImplementationPackage\nfiles[] · instructions", category: "artifact", icon: "📦", handles: { top: true } } },

  // ── LLM ──
  { id: "llm", type: "diagramNode", position: { x: 1020, y: 490 },
    data: { label: "LLMClient / Claude CLI", sublabel: "All chat executors route\nthrough LLM backend", category: "gateway", icon: "🧠", handles: { left: true } } },
];

export const edges: Edge[] = [
  { id: "e-c-sf", source: "client", target: "spec-folder", style: { stroke: "#38bdf8" } },
  { id: "e-c-ss", source: "client", target: "session-store", style: { stroke: "#38bdf8" } },
  { id: "e-c-ce", source: "client", target: "chat-ep", style: { stroke: "#38bdf8" } },
  { id: "e-c-oe", source: "client", target: "orch-ep", style: { stroke: "#8b5cf6" } },

  // Phase A
  { id: "e-ce-cef", source: "chat-ep", target: "chat-exec-factory", style: { stroke: "#38bdf8" } },
  { id: "e-cef-cl", source: "chat-exec-factory", target: "claude-exec", style: { stroke: "#38bdf8" } },
  { id: "e-cef-oa", source: "chat-exec-factory", target: "oauth-exec", style: { stroke: "#38bdf8" } },
  { id: "e-cl-so", source: "claude-exec", target: "shape-out", style: { stroke: "#38bdf8" } },
  { id: "e-oa-so", source: "oauth-exec", target: "shape-out", style: { stroke: "#38bdf8" } },
  { id: "e-cl-llm", source: "claude-exec", target: "llm", style: { stroke: "#ef4444" } },
  { id: "e-oa-llm", source: "oauth-exec", target: "llm", style: { stroke: "#ef4444" } },

  // Phase B
  { id: "e-oe-oc", source: "orch-ep", target: "orch-class", style: { stroke: "#8b5cf6" } },
  { id: "e-ss-oc", source: "session-store", target: "orch-class", style: { stroke: "#8b5cf6" } },
  { id: "e-oc-c1", source: "orch-class", target: "cmd1", style: { stroke: "#8b5cf6" } },
  { id: "e-c1-c2", source: "cmd1", target: "cmd2", style: { stroke: "#8b5cf6" } },
  { id: "e-c2-c3", source: "cmd2", target: "cmd3", style: { stroke: "#8b5cf6" } },
  { id: "e-c3-c4", source: "cmd3", target: "cmd4", style: { stroke: "#8b5cf6" } },
  { id: "e-c1-llm", source: "cmd1", target: "llm", style: { stroke: "#ef4444" } },
  { id: "e-c2-llm", source: "cmd2", target: "llm", style: { stroke: "#ef4444" } },
  { id: "e-c3-llm", source: "cmd3", target: "llm", style: { stroke: "#ef4444" } },

  // Phase C
  { id: "e-c4-gw", source: "cmd4", target: "git-wf", style: { stroke: "#fb923c" } },
  { id: "e-gw-gm", source: "git-wf", target: "git-mgr", style: { stroke: "#fb923c" } },

  // Outputs
  { id: "e-c2-os", source: "cmd2", target: "out-spec", style: { stroke: "#22c55e" } },
  { id: "e-c3-oi", source: "cmd3", target: "out-impl", style: { stroke: "#22c55e" } },

  // Shape-spec feeds orchestration
  { id: "e-so-oc", source: "shape-out", target: "orch-class", label: "pre-condition", style: { stroke: "#64748b", strokeDasharray: "4 3" } },
];
