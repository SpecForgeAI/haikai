/**
 * Diagram 02 — Standards Extraction Pipeline
 * Scope: StandardsOrchestrator internal flow
 * Source: src/standards_orchestrator.py, src/strategies/, src/file_analyzer.py
 */
import type { Node, Edge } from "@xyflow/react";
import type { DiagramNodeData } from "../components/DiagramNode";

export const nodes: Node<DiagramNodeData>[] = [
  // ── Inputs ──
  { id: "src-code", type: "diagramNode", position: { x: 0, y: 0 },
    data: { label: "Source Code", sublabel: "Local dirs · GitHub URLs\nGitLab · Bitbucket", category: "user", icon: "📁", handles: { bottom: true } } },
  { id: "tech-docs", type: "diagramNode", position: { x: 220, y: 0 },
    data: { label: "Technical Documents", sublabel: "PDF · DOCX · JSON · YAML\ntech_stack · coding_style", category: "user", icon: "📄", handles: { bottom: true } } },
  { id: "metamodel", type: "diagramNode", position: { x: 440, y: 0 },
    data: { label: "Metamodel", sublabel: "architecture.json\nMetamodelGateway fetch", category: "user", icon: "🏗️", handles: { bottom: true } } },
  { id: "global-std", type: "diagramNode", position: { x: 660, y: 0 },
    data: { label: "Global Standards", sublabel: "haikai/standards/global/\nbaseline for product mode", category: "artifact", icon: "🌐", handles: { bottom: true } } },

  // ── Stage 1: Ingestion ──
  { id: "lbl-1", type: "groupLabel", position: { x: -20, y: 100 }, data: { label: "Stage 1 — Ingestion", color: "#f59e0b" } },
  { id: "repo-fetch", type: "diagramNode", position: { x: 0, y: 130 },
    data: { label: "RepositoryFetcher", sublabel: "git clone (shallow)\nowner allowlist · token scrub", category: "core", icon: "⬇️", handles: { top: true, bottom: true } } },
  { id: "file-parser", type: "diagramNode", position: { x: 220, y: 130 },
    data: { label: "FileParser", sublabel: "PDF · DOCX · HTML · MD\nJSON · YAML · TOML · Gradle", category: "core", icon: "📖", handles: { top: true, bottom: true } } },
  { id: "file-scanner", type: "diagramNode", position: { x: 440, y: 130 },
    data: { label: "FileScanner", sublabel: "Categorise: backend · frontend\ntesting · global · dependency", category: "core", icon: "🔍", handles: { top: true, bottom: true } } },
  { id: "tech-doc-repo", type: "diagramNode", position: { x: 660, y: 130 },
    data: { label: "TechnicalDocRepository", sublabel: "Staging dir management\nDocument lifecycle", category: "core", icon: "🗃️", handles: { top: true, bottom: true } } },

  // ── Stage 2: Analysis ──
  { id: "lbl-2", type: "groupLabel", position: { x: -20, y: 280 }, data: { label: "Stage 2 — Analysis", color: "#8b5cf6" } },
  { id: "chunker", type: "diagramNode", position: { x: 0, y: 310 },
    data: { label: "ChunkerFactory", sublabel: "Generic · Markdown\nPackageJSON · Requirements", category: "core", icon: "✂️", handles: { top: true, bottom: true } } },
  { id: "early-exit", type: "diagramNode", position: { x: 200, y: 310 },
    data: { label: "EarlyExitDetector", sublabel: "Skip non-technical content\nCacheManager TTL", category: "core", icon: "🚦", handles: { top: true, bottom: true } } },
  { id: "file-analyzer", type: "diagramNode", position: { x: 400, y: 310 },
    data: { label: "FileAnalyzer", sublabel: "Per-file LLM analysis\nStrategy pattern dispatch", category: "standards", icon: "🔬", handles: { top: true, bottom: true, right: true } } },
  { id: "strategies", type: "diagramNode", position: { x: 640, y: 310 },
    data: { label: "Analysis Strategies", sublabel: "CodingStyle · Conventions\nErrorHandling · Validation\nCommenting · TechStack · AST", category: "standards", icon: "🎯", handles: { top: true, left: true, bottom: true } } },
  { id: "ast-strat", type: "diagramNode", position: { x: 640, y: 450 },
    data: { label: "AstAnalysisStrategy", sublabel: "ctags + tree-sitter\nStructural output → LLM\n(complex files only)", category: "standards", icon: "🌳", handles: { top: true, bottom: true } } },

  // ── Stage 3: Synthesis ──
  { id: "lbl-3", type: "groupLabel", position: { x: -20, y: 560 }, data: { label: "Stage 3 — Synthesis & Output", color: "#22c55e" } },
  { id: "synthesizer", type: "diagramNode", position: { x: 100, y: 590 },
    data: { label: "StandardsSynthesizer", sublabel: "Aggregate per-file results\nLLM synthesis pass", category: "standards", icon: "🎼", handles: { top: true, bottom: true } } },
  { id: "reporter", type: "diagramNode", position: { x: 360, y: 590 },
    data: { label: "ReportGenerator", sublabel: "Markdown + JSON reports\natomic write (os.replace)", category: "standards", icon: "📊", handles: { top: true, bottom: true } } },
  { id: "content-ext", type: "diagramNode", position: { x: 600, y: 590 },
    data: { label: "ContentExtractor", sublabel: "LLM-powered content\nextraction from docs", category: "standards", icon: "🧲", handles: { top: true, bottom: true } } },

  // ── Outputs ──
  { id: "out-global", type: "diagramNode", position: { x: 0, y: 760 },
    data: { label: "Global Standards", sublabel: "haikai/standards/global/\ntech-stack.md · REPORT.md", category: "artifact", icon: "🌐", handles: { top: true } } },
  { id: "out-product", type: "diagramNode", position: { x: 240, y: 760 },
    data: { label: "Product Standards", sublabel: "haikai/product/\ntech-stack.md", category: "artifact", icon: "📦", handles: { top: true } } },
  { id: "out-profiles", type: "diagramNode", position: { x: 480, y: 760 },
    data: { label: "Profiles Copy", sublabel: "haikai/profiles/default/\nstandards/global/tech-stack.md", category: "artifact", icon: "👤", handles: { top: true } } },

  // ── LLM ──
  { id: "llm", type: "diagramNode", position: { x: 880, y: 310 },
    data: { label: "LLMClient", sublabel: "Anthropic · OpenAI\nAzure · Custom", category: "gateway", icon: "🧠", handles: { left: true, top: true } } },
];

export const edges: Edge[] = [
  // Inputs → Stage 1
  { id: "e-src-rf", source: "src-code", target: "repo-fetch", style: { stroke: "#f59e0b" } },
  { id: "e-td-fp", source: "tech-docs", target: "file-parser", style: { stroke: "#f59e0b" } },
  { id: "e-mm-fs", source: "metamodel", target: "file-scanner", style: { stroke: "#f59e0b" } },
  { id: "e-gs-tdr", source: "global-std", target: "tech-doc-repo", style: { stroke: "#f59e0b" } },

  // Stage 1 → Stage 2
  { id: "e-rf-chunker", source: "repo-fetch", target: "chunker", style: { stroke: "#8b5cf6" } },
  { id: "e-fp-chunker", source: "file-parser", target: "chunker", style: { stroke: "#8b5cf6" } },
  { id: "e-fs-chunker", source: "file-scanner", target: "chunker", style: { stroke: "#8b5cf6" } },
  { id: "e-tdr-chunker", source: "tech-doc-repo", target: "chunker", style: { stroke: "#8b5cf6" } },

  // Stage 2 internal
  { id: "e-chunker-ee", source: "chunker", target: "early-exit", style: { stroke: "#8b5cf6" } },
  { id: "e-ee-fa", source: "early-exit", target: "file-analyzer", label: "non-trivial files", style: { stroke: "#8b5cf6" } },
  { id: "e-fa-strat", source: "file-analyzer", target: "strategies", style: { stroke: "#22c55e" } },
  { id: "e-strat-ast", source: "strategies", target: "ast-strat", label: "structural files", style: { stroke: "#22c55e" } },
  { id: "e-fa-llm", source: "file-analyzer", target: "llm", label: "prompts", style: { stroke: "#ef4444" } },
  { id: "e-strat-llm", source: "strategies", target: "llm", style: { stroke: "#ef4444" } },
  { id: "e-ast-llm", source: "ast-strat", target: "llm", label: "complex only", style: { stroke: "#ef4444", strokeDasharray: "4 3" } },

  // Stage 2 → Stage 3
  { id: "e-fa-synth", source: "file-analyzer", target: "synthesizer", style: { stroke: "#22c55e" } },
  { id: "e-synth-rep", source: "synthesizer", target: "reporter", style: { stroke: "#22c55e" } },
  { id: "e-fp-ce", source: "file-parser", target: "content-ext", style: { stroke: "#22c55e" } },
  { id: "e-ce-synth", source: "content-ext", target: "synthesizer", style: { stroke: "#22c55e" } },

  // Stage 3 → Outputs
  { id: "e-rep-og", source: "reporter", target: "out-global", style: { stroke: "#22c55e" } },
  { id: "e-rep-op", source: "reporter", target: "out-product", style: { stroke: "#22c55e" } },
  { id: "e-rep-prof", source: "reporter", target: "out-profiles", style: { stroke: "#22c55e" } },
];
