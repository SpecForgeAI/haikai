/**
 * Diagram 08 — API Sequence (Request Lifecycle)
 * Scope: Sequence of calls for a full standards generation request
 * Source: src/api/routes/standards.py, src/standards_orchestrator.py,
 *         src/operation_executor.py, src/job_queue/
 */
import type { Node, Edge } from "@xyflow/react";
import type { DiagramNodeData } from "../components/DiagramNode";

// Vertical swim-lane sequence diagram using ReactFlow
// Participants are columns; steps are rows

const LANE_Y_START = 120;
const STEP_H = 90;
const LANE_X: Record<string, number> = {
  client: 0,
  router: 200,
  jobqueue: 400,
  executor: 600,
  orchestrator: 800,
  strategy: 1000,
  llm: 1200,
  filestore: 1400,
};

function step(id: string, lane: string, row: number, label: string, sublabel: string, category: DiagramNodeData["category"]): Node<DiagramNodeData> {
  return {
    id,
    type: "diagramNode",
    position: { x: LANE_X[lane], y: LANE_Y_START + row * STEP_H },
    data: { label, sublabel, category, handles: { top: true, bottom: true, left: true, right: true } },
  };
}

export const nodes: Node<DiagramNodeData>[] = [
  // ── Participant headers ──
  { id: "h-client", type: "diagramNode", position: { x: LANE_X.client, y: 0 },
    data: { label: "Client", category: "user", icon: "🖥️", handles: { bottom: true } } },
  { id: "h-router", type: "diagramNode", position: { x: LANE_X.router, y: 0 },
    data: { label: "FastAPI Router", sublabel: ":8005", category: "core", icon: "🚀", handles: { bottom: true } } },
  { id: "h-jobqueue", type: "diagramNode", position: { x: LANE_X.jobqueue, y: 0 },
    data: { label: "AsyncJobQueue", sublabel: "SQLite", category: "db", icon: "⏳", handles: { bottom: true } } },
  { id: "h-executor", type: "diagramNode", position: { x: LANE_X.executor, y: 0 },
    data: { label: "OperationExecutor", category: "core", icon: "⚙️", handles: { bottom: true } } },
  { id: "h-orchestrator", type: "diagramNode", position: { x: LANE_X.orchestrator, y: 0 },
    data: { label: "StandardsOrchestrator", category: "core", icon: "🎛️", handles: { bottom: true } } },
  { id: "h-strategy", type: "diagramNode", position: { x: LANE_X.strategy, y: 0 },
    data: { label: "AnalysisStrategies", sublabel: "×7 strategies", category: "standards", icon: "📐", handles: { bottom: true } } },
  { id: "h-llm", type: "diagramNode", position: { x: LANE_X.llm, y: 0 },
    data: { label: "LLMClient", sublabel: "Anthropic/OpenAI", category: "extapi", icon: "🧠", handles: { bottom: true } } },
  { id: "h-filestore", type: "diagramNode", position: { x: LANE_X.filestore, y: 0 },
    data: { label: "FileStore / Workspace", category: "db", icon: "💾", handles: { bottom: true } } },

  // ── Sequence steps ──
  step("s1", "client", 0, "POST /api/v1/standards", "GenerateProductStandardsRequest\nJSON body", "user"),
  step("s2", "router", 0, "Validate request", "Pydantic model validation\nmode = GENERATE_PRODUCT_STANDARDS", "core"),
  step("s3", "router", 1, "Submit job", "job_id = UUID\nstatus = PENDING", "core"),
  step("s4", "jobqueue", 1, "Enqueue job", "SQLite INSERT\nThreadPoolExecutor.submit()", "db"),
  step("s5", "client", 1, "202 Accepted", "{ job_id, status: PENDING }", "user"),
  step("s6", "client", 2, "GET /api/v1/jobs/{id}", "Poll for status", "user"),
  step("s7", "jobqueue", 2, "Worker picks up job", "status → RUNNING\nstarted_at = now()", "db"),
  step("s8", "executor", 2, "dispatch(mode)", "Route to correct handler\nby OperationMode enum", "core"),
  step("s9", "executor", 3, "clone_or_fetch_repo()", "git clone sources[]\ninto workspace volume", "core"),
  step("s10", "filestore", 3, "Store source files", "workspace/{company}/{project}/", "db"),
  step("s11", "orchestrator", 3, "build_context()", "Read source files\nBuild prompt context", "core"),
  step("s12", "orchestrator", 4, "run_strategies()", "Fan-out to all 7 strategies\nconcurrently", "core"),
  step("s13", "strategy", 4, "get_prompts()", "Return strategy-specific\nprompts + context", "standards"),
  step("s14", "llm", 4, "complete(prompt)", "API call to LLM\nstream=False", "extapi"),
  step("s15", "llm", 5, "Return LLM response", "Raw text / JSON\nstandards content", "extapi"),
  step("s16", "strategy", 5, "parse_response()", "Extract structured\nstandards from LLM output", "standards"),
  step("s17", "orchestrator", 5, "merge_results()", "Combine all strategy outputs\nDeduplicate · validate", "core"),
  step("s18", "filestore", 5, "Write standards files", "global_standards.md\nproduct_standards.md\ncoding_style.md …", "db"),
  step("s19", "executor", 6, "Build OperationResponse", "success=True\noutputs=[Path…]", "core"),
  step("s20", "jobqueue", 6, "status → COMPLETED", "result = OperationResponse\ncompleted_at = now()", "db"),
  step("s21", "client", 6, "GET /api/v1/jobs/{id}", "Final poll", "user"),
  step("s22", "jobqueue", 7, "Return JobStatusResponse", "status=COMPLETED\nresult = OperationResponse", "db"),
  step("s23", "client", 7, "200 OK — done", "OperationResponse\noutputs: List[Path]", "user"),
];

export const edges: Edge[] = [
  // Step 1-2: client → router
  { id: "e-s1-s2", source: "s1", target: "s2", label: "POST request", style: { stroke: "#38bdf8" } },
  // Step 2-3: router validates → submits
  { id: "e-s2-s3", source: "s2", target: "s3", style: { stroke: "#38bdf8" } },
  // Step 3-4: router → job queue
  { id: "e-s3-s4", source: "s3", target: "s4", label: "enqueue", style: { stroke: "#f59e0b" } },
  // Step 4-5: 202 back to client
  { id: "e-s4-s5", source: "s4", target: "s5", label: "202 Accepted", style: { stroke: "#38bdf8" } },
  // Step 5-6: client polls
  { id: "e-s5-s6", source: "s5", target: "s6", label: "poll", style: { stroke: "#64748b", strokeDasharray: "4 3" } },
  // Step 6-7: worker picks up
  { id: "e-s6-s7", source: "s6", target: "s7", label: "GET /jobs/{id}", style: { stroke: "#f59e0b" } },
  // Step 7-8: job queue → executor
  { id: "e-s7-s8", source: "s7", target: "s8", label: "dispatch", style: { stroke: "#8b5cf6" } },
  // Step 8-9: executor clones repo
  { id: "e-s8-s9", source: "s8", target: "s9", style: { stroke: "#8b5cf6" } },
  // Step 9-10: files stored
  { id: "e-s9-s10", source: "s9", target: "s10", label: "write files", style: { stroke: "#64748b" } },
  // Step 10-11: orchestrator reads context
  { id: "e-s10-s11", source: "s10", target: "s11", label: "read source", style: { stroke: "#8b5cf6" } },
  // Step 11-12: run strategies
  { id: "e-s11-s12", source: "s11", target: "s12", style: { stroke: "#8b5cf6" } },
  // Step 12-13: strategies get prompts
  { id: "e-s12-s13", source: "s12", target: "s13", style: { stroke: "#f59e0b" } },
  // Step 13-14: call LLM
  { id: "e-s13-s14", source: "s13", target: "s14", label: "LLM call", style: { stroke: "#ef4444" } },
  // Step 14-15: LLM responds
  { id: "e-s14-s15", source: "s14", target: "s15", label: "response", style: { stroke: "#ef4444" } },
  // Step 15-16: parse
  { id: "e-s15-s16", source: "s15", target: "s16", style: { stroke: "#f59e0b" } },
  // Step 16-17: merge
  { id: "e-s16-s17", source: "s16", target: "s17", label: "structured output", style: { stroke: "#22c55e" } },
  // Step 17-18: write files
  { id: "e-s17-s18", source: "s17", target: "s18", label: "write standards", style: { stroke: "#22c55e" } },
  // Step 18-19: build response
  { id: "e-s18-s19", source: "s18", target: "s19", label: "paths", style: { stroke: "#22c55e" } },
  // Step 19-20: job completed
  { id: "e-s19-s20", source: "s19", target: "s20", label: "COMPLETED", style: { stroke: "#f59e0b" } },
  // Step 20-21: client polls again
  { id: "e-s20-s21", source: "s20", target: "s21", label: "status update", style: { stroke: "#64748b", strokeDasharray: "4 3" } },
  // Step 21-22: final status
  { id: "e-s21-s22", source: "s21", target: "s22", label: "GET /jobs/{id}", style: { stroke: "#f59e0b" } },
  // Step 22-23: done
  { id: "e-s22-s23", source: "s22", target: "s23", label: "200 OK", style: { stroke: "#38bdf8" } },
];
