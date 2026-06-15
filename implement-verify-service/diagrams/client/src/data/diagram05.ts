/**
 * Diagram 05 — Entity Relationship Diagram (ERD)
 * Scope: Data models, workspace schema, SQLite job store
 * Source: src/models.py, src/job_queue/job_models.py, src/haikai_crud_models.py,
 *         src/ast/models.py, src/chat/chat_models.py
 */
import type { Node, Edge } from "@xyflow/react";
import type { DiagramNodeData } from "../components/DiagramNode";

export const nodes: Node<DiagramNodeData>[] = [
  // ── API Request/Response Models ──
  { id: "lbl-api", type: "groupLabel", position: { x: -20, y: -30 }, data: { label: "API Request / Response Models", color: "#8b5cf6" } },
  { id: "base-req", type: "diagramNode", position: { x: 0, y: 0 },
    data: { label: "BaseRequest", sublabel: "mode: OperationMode\n[GET_METAMODEL\nGENERATE_PRODUCT_STANDARDS\nGENERATE_GLOBAL_STANDARDS]", category: "db", icon: "📋", handles: { bottom: true, right: true } } },
  { id: "global-req", type: "diagramNode", position: { x: 0, y: 220 },
    data: { label: "GenerateGlobalStandardsRequest", sublabel: "company: str\nsources: List[str]?\ntechnical_documents: Dict[str,List[str]]?\nrecursive: bool = True", category: "db", icon: "🌐", handles: { top: true, right: true } } },
  { id: "product-req", type: "diagramNode", position: { x: 280, y: 220 },
    data: { label: "GenerateProductStandardsRequest", sublabel: "company: str\nproject: str\nsources: List[str]?\nrecursive: bool = True", category: "db", icon: "📦", handles: { top: true, right: true } } },
  { id: "op-resp", type: "diagramNode", position: { x: 140, y: 440 },
    data: { label: "OperationResponse", sublabel: "success: bool\nmode: OperationMode\noutput_dir: Path\noutputs: List[Path]\nmessage: str\nerrors: List[str]?", category: "db", icon: "📤", handles: { top: true } } },

  // ── Job Queue Models ──
  { id: "lbl-jobs", type: "groupLabel", position: { x: 620, y: -30 }, data: { label: "Async Job Queue (SQLite)", color: "#f59e0b" } },
  { id: "job-record", type: "diagramNode", position: { x: 620, y: 0 },
    data: { label: "JobRecord", sublabel: "id: str (UUID)\nstatus: JobStatus\n[PENDING|RUNNING|COMPLETED\nFAILED|CANCELLED]\nrequest: dict\nresult: dict?\nerror: str?\ncreated_at: datetime\nstarted_at: datetime?\ncompleted_at: datetime?", category: "db", icon: "⏳", handles: { bottom: true, right: true } } },
  { id: "job-status", type: "diagramNode", position: { x: 620, y: 340 },
    data: { label: "JobStatusResponse", sublabel: "job_id: str\nstatus: JobStatus\nprogress: float?\nmessage: str?\nresult: OperationResponse?", category: "db", icon: "📊", handles: { top: true } } },

  // ── Spec / Task Models ──
  { id: "lbl-spec", type: "groupLabel", position: { x: 1040, y: -30 }, data: { label: "Specification Models (Filesystem-backed)", color: "#38bdf8" } },
  { id: "spec-summary", type: "diagramNode", position: { x: 1040, y: 0 },
    data: { label: "SpecSummary", sublabel: "id: str\ncompany: str\nproject: str\ntitle: str?\nstatus: str\n[draft|in_progress|completed]\ncreated_at: datetime?\nupdated_at: datetime?\nhas_spec: bool\nhas_tasks: bool\nhas_implementation: bool", category: "agent", icon: "📋", handles: { bottom: true } } },
  { id: "spec-detail", type: "diagramNode", position: { x: 1040, y: 320 },
    data: { label: "SpecDetail", sublabel: "extends SpecSummary\nfiles: Dict[str, str]\ncontent: Dict[str, str]\nmetadata: SpecMetadata?", category: "agent", icon: "📃", handles: { top: true, bottom: true } } },
  { id: "spec-metadata", type: "diagramNode", position: { x: 1040, y: 520 },
    data: { label: "SpecMetadata", sublabel: "description: str?\ntags: List[str]?", category: "agent", icon: "🏷️", handles: { top: true } } },

  // ── Orchestration Models ──
  { id: "lbl-orch", type: "groupLabel", position: { x: 0, y: 620 }, data: { label: "Orchestration Models", color: "#22c55e" } },
  { id: "orch-req", type: "diagramNode", position: { x: 0, y: 650 },
    data: { label: "OrchestrationRequest", sublabel: "spec_intents: List[SpecIntent]\noptions: OrchestrationOptions\ncompany: str\nproject: str", category: "core", icon: "🔄", handles: { bottom: true, right: true } } },
  { id: "spec-intent", type: "diagramNode", position: { x: 0, y: 840 },
    data: { label: "SpecIntent", sublabel: "spec_name: str (≥5 chars)\nsession_id: str?\ncontext_files: List[str]?", category: "core", icon: "🎯", handles: { top: true } } },
  { id: "orch-opts", type: "diagramNode", position: { x: 240, y: 840 },
    data: { label: "OrchestrationOptions", sublabel: "skip_git: bool = False\nbranch_prefix: str?\nauto_push: bool?", category: "core", icon: "⚙️", handles: { top: true } } },
  { id: "step-result", type: "diagramNode", position: { x: 520, y: 650 },
    data: { label: "StepResult", sublabel: "step: int\ncommand: str\nsuccess: bool\noutput: str\nerror: str?\nduration_seconds: float", category: "core", icon: "✅", handles: { bottom: true } } },
  { id: "orch-resp", type: "diagramNode", position: { x: 520, y: 840 },
    data: { label: "OrchestrationResponse", sublabel: "success: bool\nspec_name: str\nsteps: List[StepResult]\nbranch: str?\ncommit_sha: str?\npr_url: str?", category: "core", icon: "📤", handles: { top: true } } },

  // ── AST Structural Models ──
  { id: "lbl-ast", type: "groupLabel", position: { x: 820, y: 620 }, data: { label: "AST Structural Analysis Models", color: "#22c55e" } },
  { id: "struct-analysis", type: "diagramNode", position: { x: 820, y: 650 },
    data: { label: "StructuralAnalysis", sublabel: "file_path: str\nlanguage: str\nsymbols: List[SymbolInfo]\ninheritance: List[InheritanceInfo]\nimports: List[ImportInfo]\ncalls: List[CallInfo]\nendpoints: List[EndpointInfo]\ninteractions: List[InteractionInfo]\nprovider_used: str", category: "standards", icon: "🌳", handles: { bottom: true } } },
  { id: "symbol-info", type: "diagramNode", position: { x: 720, y: 900 },
    data: { label: "SymbolInfo", sublabel: "name · kind · file\nline · language\nparent_class?", category: "standards", icon: "🔤", handles: { top: true } } },
  { id: "endpoint-info", type: "diagramNode", position: { x: 940, y: 900 },
    data: { label: "EndpointInfo", sublabel: "type · path · operation\nhandler_class · handler_method\nprotocol · direction\nconfidence: float", category: "standards", icon: "🔌", handles: { top: true } } },

  // ── Chat Models ──
  { id: "lbl-chat", type: "groupLabel", position: { x: 1300, y: -30 }, data: { label: "Chat / Session Models", color: "#a78bfa" } },
  { id: "chat-msg-req", type: "diagramNode", position: { x: 1300, y: 0 },
    data: { label: "ChatMessageRequest", sublabel: "message: str\nsession_id: str?\ncompany: str\nproject: str\nspec_name: str?", category: "user", icon: "💬", handles: { bottom: true } } },
  { id: "msg-entry", type: "diagramNode", position: { x: 1300, y: 220 },
    data: { label: "MessageEntry", sublabel: "role: str [user|assistant]\ncontent: str\ntimestamp: datetime\nsession_id: str", category: "user", icon: "📨", handles: { top: true, bottom: true } } },
  { id: "chat-hist", type: "diagramNode", position: { x: 1300, y: 440 },
    data: { label: "ChatHistoryResponse", sublabel: "session_id: str\nmessages: List[MessageEntry]\ntotal: int", category: "user", icon: "📜", handles: { top: true } } },
];

export const edges: Edge[] = [
  // API model inheritance
  { id: "e-br-gr", source: "base-req", target: "global-req", label: "extends", style: { stroke: "#8b5cf6" } },
  { id: "e-br-pr", source: "base-req", target: "product-req", label: "extends", style: { stroke: "#8b5cf6" } },
  { id: "e-gr-or", source: "global-req", target: "op-resp", label: "→ produces", style: { stroke: "#8b5cf6", strokeDasharray: "4 3" } },
  { id: "e-pr-or", source: "product-req", target: "op-resp", label: "→ produces", style: { stroke: "#8b5cf6", strokeDasharray: "4 3" } },

  // Job queue
  { id: "e-jr-jsr", source: "job-record", target: "job-status", label: "→ serialised as", style: { stroke: "#f59e0b" } },
  { id: "e-jr-or", source: "job-record", target: "op-resp", label: "result embeds", style: { stroke: "#f59e0b", strokeDasharray: "4 3" } },

  // Spec models
  { id: "e-ss-sd", source: "spec-summary", target: "spec-detail", label: "extends", style: { stroke: "#38bdf8" } },
  { id: "e-sd-sm", source: "spec-detail", target: "spec-metadata", label: "has", style: { stroke: "#38bdf8" } },

  // Orchestration
  { id: "e-or-si", source: "orch-req", target: "spec-intent", label: "1..*", style: { stroke: "#22c55e" } },
  { id: "e-or-oo", source: "orch-req", target: "orch-opts", label: "1", style: { stroke: "#22c55e" } },
  { id: "e-sr-orp", source: "step-result", target: "orch-resp", label: "1..*", style: { stroke: "#22c55e" } },

  // AST
  { id: "e-sa-sym", source: "struct-analysis", target: "symbol-info", label: "1..*", style: { stroke: "#22c55e" } },
  { id: "e-sa-ep", source: "struct-analysis", target: "endpoint-info", label: "0..*", style: { stroke: "#22c55e" } },

  // Chat
  { id: "e-cmr-me", source: "chat-msg-req", target: "msg-entry", label: "→ stored as", style: { stroke: "#a78bfa", strokeDasharray: "4 3" } },
  { id: "e-me-chr", source: "msg-entry", target: "chat-hist", label: "1..*", style: { stroke: "#a78bfa" } },
];
