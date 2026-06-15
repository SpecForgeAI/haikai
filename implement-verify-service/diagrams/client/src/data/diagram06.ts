/**
 * Diagram 06 — Structural Analysis Engine
 * Scope: AST pipeline internals — ctags, tree-sitter, diagram builders
 * Source: src/ast/pipeline.py, src/ast/diagram_builders.py, src/ast/provider.py
 */
import type { Node, Edge } from "@xyflow/react";
import type { DiagramNodeData } from "../components/DiagramNode";

export const nodes: Node<DiagramNodeData>[] = [
  // ── Input ──
  { id: "input", type: "diagramNode", position: { x: 400, y: 0 },
    data: { label: "Source Files", sublabel: "List[file_path]\nPython · TS · Java · Go · Rust · C# · C/C++", category: "user", icon: "📁", handles: { bottom: true } } },

  // ── Stage 1: ctags ──
  { id: "lbl-1", type: "groupLabel", position: { x: -20, y: 80 }, data: { label: "Stage 1 — Symbol Extraction (ctags)", color: "#f59e0b" } },
  { id: "ctags-prov", type: "diagramNode", position: { x: 400, y: 110 },
    data: { label: "CtagsProvider", sublabel: "universal-ctags subprocess\nSymbolInfo[] per file", category: "standards", icon: "🏷️", handles: { top: true, bottom: true } } },
  { id: "file-store", type: "diagramNode", position: { x: 700, y: 110 },
    data: { label: "FileStore", sublabel: "snapshot/{repo}/{sha}/\n_index.txt · _inheritance.txt\n_imports.txt · _calls.txt", category: "db", icon: "🗃️", handles: { top: true, bottom: true, left: true } } },

  // ── Stage 2: tree-sitter imports ──
  { id: "lbl-2", type: "groupLabel", position: { x: -20, y: 250 }, data: { label: "Stage 2 — Import Extraction (tree-sitter)", color: "#38bdf8" } },
  { id: "ts-prov", type: "diagramNode", position: { x: 200, y: 280 },
    data: { label: "TreeSitterProvider", sublabel: "Language-specific grammars\nImportInfo[] per file", category: "standards", icon: "🌳", handles: { top: true, bottom: true } } },
  { id: "prov-registry", type: "diagramNode", position: { x: 400, y: 280 },
    data: { label: "ProviderRegistry", sublabel: "Language → extractor mapping\nFallback: GenericExtractor", category: "core", icon: "📚", handles: { top: true, bottom: true, left: true } } },
  { id: "lang-extractors", type: "diagramNode", position: { x: 700, y: 280 },
    data: { label: "Language Extractors", sublabel: "Python · TypeScript · Java\nGo · Rust · C# · C/C++\nGeneric (ctags fallback)", category: "standards", icon: "🔬", handles: { top: true, bottom: true, left: true } } },

  // ── Stage 3: call resolution ──
  { id: "lbl-3", type: "groupLabel", position: { x: -20, y: 430 }, data: { label: "Stage 3 — Call Resolution (ImportFollower)", color: "#8b5cf6" } },
  { id: "import-follower", type: "diagramNode", position: { x: 200, y: 460 },
    data: { label: "ImportFollower", sublabel: "Reads _imports.txt (fresh)\nResolves cross-file calls\nCallInfo[] per file", category: "core", icon: "🔗", handles: { top: true, bottom: true } } },
  { id: "interaction-class", type: "diagramNode", position: { x: 500, y: 460 },
    data: { label: "InteractionClassifier", sublabel: "HTTP_SERVICE · DATABASE\nMESSAGE_QUEUE · FILE_SYSTEM\nCACHE · EXTERNAL_API", category: "core", icon: "🏷️", handles: { top: true, bottom: true } } },
  { id: "endpoint-disc", type: "diagramNode", position: { x: 800, y: 460 },
    data: { label: "EndpointDiscoverer", sublabel: "REST · WebSocket · MQ\ngRPC · Scheduled\nconfidence scoring", category: "core", icon: "🔌", handles: { top: true, bottom: true } } },

  // ── Stage 4: diagram generation ──
  { id: "lbl-4", type: "groupLabel", position: { x: -20, y: 620 }, data: { label: "Stage 4 — Diagram Generation", color: "#22c55e" } },
  { id: "diag-gen", type: "diagramNode", position: { x: 400, y: 650 },
    data: { label: "DiagramGenerator", sublabel: "Reads snapshot index files\nBuilds DiagramModel", category: "standards", icon: "📊", handles: { top: true, bottom: true } } },
  { id: "class-builder", type: "diagramNode", position: { x: 0, y: 800 },
    data: { label: "ClassDiagramBuilder", sublabel: "_index.txt + _inheritance.txt", category: "standards", icon: "🏗️", handles: { top: true } } },
  { id: "dep-builder", type: "diagramNode", position: { x: 180, y: 800 },
    data: { label: "DependencyGraphBuilder", sublabel: "_imports.txt", category: "standards", icon: "🕸️", handles: { top: true } } },
  { id: "seq-builder", type: "diagramNode", position: { x: 360, y: 800 },
    data: { label: "SequenceDiagramBuilder", sublabel: "_calls.txt (control flow)", category: "standards", icon: "🔄", handles: { top: true } } },
  { id: "df-builder", type: "diagramNode", position: { x: 540, y: 800 },
    data: { label: "DataFlowBuilder", sublabel: "_calls.txt + _imports.txt\n+ _index.txt", category: "standards", icon: "💧", handles: { top: true } } },
  { id: "comp-builder", type: "diagramNode", position: { x: 720, y: 800 },
    data: { label: "ComponentDiagramBuilder", sublabel: "_imports.txt\ngrouped by directory", category: "standards", icon: "📦", handles: { top: true } } },
  { id: "pkg-builder", type: "diagramNode", position: { x: 900, y: 800 },
    data: { label: "PackageStructureBuilder", sublabel: "_index.txt\ngrouped by path", category: "standards", icon: "🗂️", handles: { top: true } } },

  // ── Serialisers ──
  { id: "lbl-5", type: "groupLabel", position: { x: -20, y: 940 }, data: { label: "Output Serialisers", color: "#64748b" } },
  { id: "mermaid-ser", type: "diagramNode", position: { x: 100, y: 970 },
    data: { label: "MermaidSerialiser", sublabel: "classDiagram · sequenceDiagram\nflowchart · C4Context", category: "external", icon: "🧜", handles: { top: true } } },
  { id: "plantuml-ser", type: "diagramNode", position: { x: 340, y: 970 },
    data: { label: "PlantUMLSerialiser", sublabel: "@startuml / @enduml\nclass · sequence · component", category: "external", icon: "🌱", handles: { top: true } } },
  { id: "graphviz-ser", type: "diagramNode", position: { x: 580, y: 970 },
    data: { label: "GraphvizSerialiser", sublabel: "DOT language\ndigraph output", category: "external", icon: "🔵", handles: { top: true } } },
  { id: "metamodel-ser", type: "diagramNode", position: { x: 820, y: 970 },
    data: { label: "MetamodelSerialiser", sublabel: "JSON metamodel\nfor downstream systems", category: "external", icon: "🏛️", handles: { top: true } } },

  // ── LLM Fallback ──
  { id: "llm-fallback", type: "diagramNode", position: { x: 1100, y: 460 },
    data: { label: "LLM Fallback (v2)", sublabel: "Complex files only\nllm_fallback.py\nMultiFrameworkMerger", category: "gateway", icon: "🧠", handles: { top: true, bottom: true } } },
  { id: "fw-detector", type: "diagramNode", position: { x: 1100, y: 640 },
    data: { label: "FrameworkDetector v2", sublabel: "PlaybookExecutor\nMulti-framework merge\nKindMappingLoader", category: "core", icon: "🎯", handles: { top: true } } },
];

export const edges: Edge[] = [
  // Input → ctags
  { id: "e-in-ct", source: "input", target: "ctags-prov", style: { stroke: "#f59e0b" } },
  { id: "e-ct-fs", source: "ctags-prov", target: "file-store", label: "_index.txt\n_inheritance.txt", style: { stroke: "#f59e0b" } },

  // Stage 2
  { id: "e-ct-pr", source: "ctags-prov", target: "prov-registry", style: { stroke: "#38bdf8" } },
  { id: "e-pr-ts", source: "prov-registry", target: "ts-prov", style: { stroke: "#38bdf8" } },
  { id: "e-pr-le", source: "prov-registry", target: "lang-extractors", style: { stroke: "#38bdf8" } },
  { id: "e-ts-fs", source: "ts-prov", target: "file-store", label: "_imports.txt", style: { stroke: "#38bdf8" } },

  // Stage 3
  { id: "e-fs-if", source: "file-store", target: "import-follower", label: "reads _imports.txt", style: { stroke: "#8b5cf6" } },
  { id: "e-if-ic", source: "import-follower", target: "interaction-class", style: { stroke: "#8b5cf6" } },
  { id: "e-if-ed", source: "import-follower", target: "endpoint-disc", style: { stroke: "#8b5cf6" } },
  { id: "e-if-fs", source: "import-follower", target: "file-store", label: "_calls.txt", style: { stroke: "#8b5cf6" } },

  // LLM fallback path
  { id: "e-le-llm", source: "lang-extractors", target: "llm-fallback", label: "complex files", style: { stroke: "#ef4444", strokeDasharray: "4 3" } },
  { id: "e-llm-fw", source: "llm-fallback", target: "fw-detector", style: { stroke: "#ef4444" } },

  // Stage 4
  { id: "e-fs-dg", source: "file-store", target: "diag-gen", label: "snapshot index files", style: { stroke: "#22c55e" } },
  { id: "e-dg-cb", source: "diag-gen", target: "class-builder", style: { stroke: "#22c55e" } },
  { id: "e-dg-db", source: "diag-gen", target: "dep-builder", style: { stroke: "#22c55e" } },
  { id: "e-dg-sb", source: "diag-gen", target: "seq-builder", style: { stroke: "#22c55e" } },
  { id: "e-dg-dfb", source: "diag-gen", target: "df-builder", style: { stroke: "#22c55e" } },
  { id: "e-dg-compb", source: "diag-gen", target: "comp-builder", style: { stroke: "#22c55e" } },
  { id: "e-dg-pkgb", source: "diag-gen", target: "pkg-builder", style: { stroke: "#22c55e" } },

  // Serialisers
  { id: "e-cb-mm", source: "class-builder", target: "mermaid-ser", style: { stroke: "#64748b" } },
  { id: "e-sb-pu", source: "seq-builder", target: "plantuml-ser", style: { stroke: "#64748b" } },
  { id: "e-dfb-gv", source: "df-builder", target: "graphviz-ser", style: { stroke: "#64748b" } },
  { id: "e-cb-meta", source: "class-builder", target: "metamodel-ser", style: { stroke: "#64748b" } },
];
