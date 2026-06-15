/**
 * Diagram 04 — UML Class Hierarchy
 * Scope: Core class relationships in standards-extractor
 * Source: src/strategies/, src/ast/extractors/, src/ast/models.py, src/llm_client*.py
 */
import type { Node, Edge } from "@xyflow/react";
import type { DiagramNodeData } from "../components/DiagramNode";

export const nodes: Node<DiagramNodeData>[] = [
  // ── Strategy Pattern ──
  { id: "lbl-strat", type: "groupLabel", position: { x: -20, y: -30 }, data: { label: "Strategy Pattern — Analysis", color: "#8b5cf6" } },
  { id: "analysis-strategy", type: "diagramNode", position: { x: 400, y: 0 },
    data: { label: "AnalysisStrategy", sublabel: "«abstract»\nget_prompts()\nget_metadata()", category: "core", icon: "📐", handles: { bottom: true } } },
  { id: "coding-style", type: "diagramNode", position: { x: 0, y: 160 },
    data: { label: "CodingStyleStrategy", sublabel: "extends AnalysisStrategy", category: "standards", icon: "🎨", handles: { top: true } } },
  { id: "conventions", type: "diagramNode", position: { x: 160, y: 160 },
    data: { label: "ConventionsStrategy", sublabel: "extends AnalysisStrategy", category: "standards", icon: "📏", handles: { top: true } } },
  { id: "error-handling", type: "diagramNode", position: { x: 320, y: 160 },
    data: { label: "ErrorHandlingStrategy", sublabel: "extends AnalysisStrategy", category: "standards", icon: "🚨", handles: { top: true } } },
  { id: "validation", type: "diagramNode", position: { x: 480, y: 160 },
    data: { label: "ValidationStrategy", sublabel: "extends AnalysisStrategy", category: "standards", icon: "✅", handles: { top: true } } },
  { id: "commenting", type: "diagramNode", position: { x: 640, y: 160 },
    data: { label: "CommentingStrategy", sublabel: "extends AnalysisStrategy", category: "standards", icon: "💬", handles: { top: true } } },
  { id: "tech-stack-strat", type: "diagramNode", position: { x: 800, y: 160 },
    data: { label: "TechStackSynthesisStrategy", sublabel: "extends AnalysisStrategy", category: "standards", icon: "🔧", handles: { top: true } } },
  { id: "ast-strat", type: "diagramNode", position: { x: 960, y: 160 },
    data: { label: "AstAnalysisStrategy", sublabel: "extends AnalysisStrategy\nuses StructuralAnalysis", category: "standards", icon: "🌳", handles: { top: true, bottom: true } } },

  // ── AST Extractor Hierarchy ──
  { id: "lbl-ast", type: "groupLabel", position: { x: 0, y: 340 }, data: { label: "AST Extractor Hierarchy", color: "#22c55e" } },
  { id: "base-extractor", type: "diagramNode", position: { x: 400, y: 370 },
    data: { label: "BaseExtractor", sublabel: "«abstract»\nextract_symbols()\nextract_imports()\nextract_calls()", category: "standards", icon: "🔬", handles: { top: true, bottom: true } } },
  { id: "python-ext", type: "diagramNode", position: { x: 0, y: 520 },
    data: { label: "PythonExtractor", sublabel: "tree-sitter-python", category: "standards", icon: "🐍", handles: { top: true } } },
  { id: "ts-ext", type: "diagramNode", position: { x: 160, y: 520 },
    data: { label: "TypeScriptExtractor", sublabel: "tree-sitter-typescript", category: "standards", icon: "🟦", handles: { top: true } } },
  { id: "java-ext", type: "diagramNode", position: { x: 320, y: 520 },
    data: { label: "JavaExtractor", sublabel: "tree-sitter-java", category: "standards", icon: "☕", handles: { top: true } } },
  { id: "go-ext", type: "diagramNode", position: { x: 480, y: 520 },
    data: { label: "GoExtractor", sublabel: "tree-sitter-go", category: "standards", icon: "🐹", handles: { top: true } } },
  { id: "rust-ext", type: "diagramNode", position: { x: 640, y: 520 },
    data: { label: "RustExtractor", sublabel: "tree-sitter-rust", category: "standards", icon: "🦀", handles: { top: true } } },
  { id: "csharp-ext", type: "diagramNode", position: { x: 800, y: 520 },
    data: { label: "CSharpExtractor", sublabel: "tree-sitter-c-sharp", category: "standards", icon: "🟣", handles: { top: true } } },
  { id: "generic-ext", type: "diagramNode", position: { x: 960, y: 520 },
    data: { label: "GenericExtractor", sublabel: "ctags fallback", category: "standards", icon: "🔧", handles: { top: true } } },

  // ── LLM Client Hierarchy ──
  { id: "lbl-llm", type: "groupLabel", position: { x: 0, y: 680 }, data: { label: "LLM Client Factory", color: "#ef4444" } },
  { id: "llm-base", type: "diagramNode", position: { x: 400, y: 710 },
    data: { label: "LLMClient", sublabel: "«abstract»\ncomplete()\nstream()\nmax_tokens", category: "gateway", icon: "🧠", handles: { top: true, bottom: true } } },
  { id: "anthropic-client", type: "diagramNode", position: { x: 160, y: 860 },
    data: { label: "AnthropicClient", sublabel: "claude-sonnet-4-6\nAnthropic SDK", category: "extapi", icon: "🔴", handles: { top: true } } },
  { id: "openai-client", type: "diagramNode", position: { x: 360, y: 860 },
    data: { label: "OpenAIClient", sublabel: "gpt-* / o* models\nOpenAI SDK", category: "extapi", icon: "🟢", handles: { top: true } } },
  { id: "azure-client", type: "diagramNode", position: { x: 560, y: 860 },
    data: { label: "AzureOpenAIClient", sublabel: "Azure deployment\napi_version required", category: "extapi", icon: "🔵", handles: { top: true } } },
  { id: "custom-client", type: "diagramNode", position: { x: 760, y: 860 },
    data: { label: "CustomLLMClient", sublabel: "OpenAI-compatible\nbase_url override", category: "extapi", icon: "⚙️", handles: { top: true } } },

  // ── Data Models ──
  { id: "lbl-models", type: "groupLabel", position: { x: 1160, y: -30 }, data: { label: "Core Data Models", color: "#f59e0b" } },
  { id: "base-req", type: "diagramNode", position: { x: 1160, y: 0 },
    data: { label: "BaseRequest", sublabel: "mode: OperationMode\nuse_enum_values=True", category: "db", icon: "📋", handles: { bottom: true } } },
  { id: "global-req", type: "diagramNode", position: { x: 1060, y: 160 },
    data: { label: "GenerateGlobalStandardsRequest", sublabel: "company · sources\ntechnical_documents", category: "db", icon: "🌐", handles: { top: true } } },
  { id: "product-req", type: "diagramNode", position: { x: 1260, y: 160 },
    data: { label: "GenerateProductStandardsRequest", sublabel: "company · project\nsources · recursive", category: "db", icon: "📦", handles: { top: true } } },
  { id: "op-resp", type: "diagramNode", position: { x: 1160, y: 320 },
    data: { label: "OperationResponse", sublabel: "success · mode\noutput_dir · outputs[]\nworkspace-relative paths", category: "db", icon: "📤", handles: { top: true } } },
];

export const edges: Edge[] = [
  // Strategy inheritance
  { id: "e-as-cs", source: "analysis-strategy", target: "coding-style", label: "extends", style: { stroke: "#8b5cf6" } },
  { id: "e-as-cv", source: "analysis-strategy", target: "conventions", label: "extends", style: { stroke: "#8b5cf6" } },
  { id: "e-as-eh", source: "analysis-strategy", target: "error-handling", label: "extends", style: { stroke: "#8b5cf6" } },
  { id: "e-as-vl", source: "analysis-strategy", target: "validation", label: "extends", style: { stroke: "#8b5cf6" } },
  { id: "e-as-cm", source: "analysis-strategy", target: "commenting", label: "extends", style: { stroke: "#8b5cf6" } },
  { id: "e-as-ts", source: "analysis-strategy", target: "tech-stack-strat", label: "extends", style: { stroke: "#8b5cf6" } },
  { id: "e-as-ast", source: "analysis-strategy", target: "ast-strat", label: "extends", style: { stroke: "#8b5cf6" } },

  // AST extractor inheritance
  { id: "e-be-py", source: "base-extractor", target: "python-ext", label: "extends", style: { stroke: "#22c55e" } },
  { id: "e-be-ts", source: "base-extractor", target: "ts-ext", label: "extends", style: { stroke: "#22c55e" } },
  { id: "e-be-java", source: "base-extractor", target: "java-ext", label: "extends", style: { stroke: "#22c55e" } },
  { id: "e-be-go", source: "base-extractor", target: "go-ext", label: "extends", style: { stroke: "#22c55e" } },
  { id: "e-be-rust", source: "base-extractor", target: "rust-ext", label: "extends", style: { stroke: "#22c55e" } },
  { id: "e-be-cs", source: "base-extractor", target: "csharp-ext", label: "extends", style: { stroke: "#22c55e" } },
  { id: "e-be-gen", source: "base-extractor", target: "generic-ext", label: "extends", style: { stroke: "#22c55e" } },
  { id: "e-ast-be", source: "ast-strat", target: "base-extractor", label: "uses", style: { stroke: "#64748b", strokeDasharray: "4 3" } },

  // LLM client inheritance
  { id: "e-llm-ant", source: "llm-base", target: "anthropic-client", label: "extends", style: { stroke: "#ef4444" } },
  { id: "e-llm-oai", source: "llm-base", target: "openai-client", label: "extends", style: { stroke: "#ef4444" } },
  { id: "e-llm-az", source: "llm-base", target: "azure-client", label: "extends", style: { stroke: "#ef4444" } },
  { id: "e-llm-cu", source: "llm-base", target: "custom-client", label: "extends", style: { stroke: "#ef4444" } },

  // Request model inheritance
  { id: "e-br-gr", source: "base-req", target: "global-req", label: "extends", style: { stroke: "#f59e0b" } },
  { id: "e-br-pr", source: "base-req", target: "product-req", label: "extends", style: { stroke: "#f59e0b" } },
  { id: "e-gr-or", source: "global-req", target: "op-resp", label: "→ produces", style: { stroke: "#f59e0b", strokeDasharray: "4 3" } },
];
