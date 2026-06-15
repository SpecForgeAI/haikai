import type { Node, Edge } from "@xyflow/react";
import type { DiagramNodeData } from "../components/DiagramNode";

/**
 * Diagram 07 — Async Verification Orchestration (polyrepo)
 *
 * Port of `diagrams/async_verification_orch.mmd`. Static-architecture mirror of
 * the React Flow visualization at
 *   haikai/specs/2026-05-20-async-verification-orchestration/flow-diagram.html
 *
 * Surface colour mapping (matches spec's A/B/X/Y model):
 *   [A] git hooks           — orange  → category "cicd"      (not used here yet)
 *   [B] orchestration hooks — purple  → category "core"
 *   [X] operator CLI        — blue    → category "frontend"
 *   [Y] agent slash commands— green   → category "standards"
 *       runtime / inbound-gateway   — grey    → category "external"
 *       AND gate (loop)     — amber   → category "db"
 *       repair engine       — red     → category "extapi"
 *
 * Gate ownership: the AND gate, the pass/fail branch, the repair dispatch,
 * and the DAG advance are evaluated by the agentic `verification-loop`, not
 * the deterministic runtime. The runtime's only async-ingest piece is the
 * **inbound-gateway** (stable webhook URL): it correlates a CI verdict and delivers
 * it to the loop as a message — it routes, the loop decides.
 *
 * Polyrepo baseline (per spec decisions D1–D5):
 *   - Two concrete repos shown as example: `backend` + `frontend`.
 *   - Implementer + commit nodes are per-repo.
 *   - `coordination.lock.yaml` is the artifact that pins cross-repo input
 *     state at orchestrate-start (D5 composes with it).
 *   - Verifier runners stay as 4 kinds; each is invoked per (repo, task-
 *     group) — sublabels reflect this.
 *   - State store keys are `(orchestration_id, task_group_id, repo,
 *     verifier)` per D2; AND gate fires `∀ repo × verifier` per D5.
 *   - Commit trailers (D1): orchestrate-id / task-group-id / repo.
 *   - Connector env-var keying (D3): {REPO_KEY}_{CONNECTOR}_TOKEN.
 */

export const nodes: Node<DiagramNodeData>[] = [
  // ─── [Y] AGENT SLASH COMMANDS — spec lifecycle (top row) ────────────────
  { id: "shape-spec", type: "diagramNode", position: { x: 40, y: 0 },
    data: { label: "/shape-spec", sublabel: "draft spec.md + requirements.md", category: "standards", icon: "📝", handles: { top: true, right: true } } },
  { id: "create-tasks", type: "diagramNode", position: { x: 540, y: 0 },
    data: { label: "/create-tasks", sublabel: "tasks.md — task groups carry [@repo:X] tags", category: "standards", icon: "📋", handles: { left: true, right: true } } },
  { id: "create-rubrics", type: "diagramNode", position: { x: 800, y: 0 },
    data: { label: "/create-rubrics (NEW)", sublabel: "rubrics/[task-group].md", category: "standards", icon: "📏", handles: { left: true, right: true } } },
  { id: "orchestrate", type: "diagramNode", position: { x: 1060, y: 0 },
    data: { label: "/orchestrate", sublabel: "compile orchestration.yml (DAG) + touched_repos(group)", category: "standards", icon: "🧭", handles: { left: true, bottom: true } } },

  // ─── [B] spec-frozen hook (between shape-spec and create-tasks) ─────────
  { id: "h-spec-frozen", type: "diagramNode", position: { x: 280, y: 0 },
    data: { label: "spec-frozen", sublabel: "hook #1", category: "core", icon: "🪝", handles: { left: true, right: true } } },

  // ─── [X] OPERATOR CLI ───────────────────────────────────────────────────
  { id: "run-cli", type: "diagramNode", position: { x: 1060, y: 130 },
    data: { label: "standards-extractor orchestrate run", sublabel: "async; returns job_id + touched_repos[]", category: "frontend", icon: "💻", handles: { top: true, left: true } } },

  // ─── RUNTIME — orchestrate engine (central column) ──────────────────────
  { id: "scheduler", type: "diagramNode", position: { x: 540, y: 260 },
    data: { label: "scheduler", sublabel: "picks task group from DAG", category: "external", icon: "🗓️", handles: { top: true, bottom: true, right: true } } },

  // ─── D8: discovery — runs at /projects/init, cached, git-invalidated ────
  { id: "discovery", type: "diagramNode", position: { x: 200, y: 130 },
    data: { label: "discovery (D8) @ init", sublabel: "runs once at /projects/init: hypothesis→probe→assess over pom.xml / build.gradle / .github/workflows → per-repo verifier commands. Cached, keyed by discovered_at_sha (reuses discovery_loop.py)", category: "standards", icon: "🔎", handles: { bottom: true, right: true } } },

  // ─── D8.1a: git change gate — fires BEFORE shape-spec (primary checkpoint) ─
  { id: "discovery-gate", type: "diagramNode", position: { x: 200, y: -130 },
    data: { label: "git change gate (D8.1a)", sublabel: "before /shape-spec: git diff --name-only <discovered_at_sha> HEAD -- build/CI/lint paths · empty → reuse cache (no LLM) · changed → re-discover. Primary checkpoint — shape-spec begins a new change", category: "cicd", icon: "🔁", handles: { bottom: true, right: true } } },

  // ─── POLYREPO: coordination.lock.yaml — input + discovery pinning ───────
  { id: "coord-lock", type: "diagramNode", position: { x: 880, y: 260 },
    data: { label: "coordination.lock.yaml", sublabel: "(D5) pins per-repo input SHAs + (D8.1) pinned discovered verifier manifest", category: "db", icon: "🔒", handles: { left: true, bottom: true, top: true } } },

  // ─── D7: per-repo verify config (static; human-set; gates cell creation) ─
  { id: "verify-config", type: "diagramNode", position: { x: 1180, y: 260 },
    data: { label: "verify config (per repo)", sublabel: "(D7) verify: true|false per repo/verifier — disabled → cells recorded `skipped`, excluded from AND gate", category: "standards", icon: "🎚️", handles: { left: true } } },

  // ─── POLYREPO: per-repo implementer fanout (was single node) ────────────
  { id: "impl-backend", type: "diagramNode", position: { x: 380, y: 390 },
    data: { label: "implementer[backend]", sublabel: "backend-specialist subagent", category: "external", icon: "🛠️", handles: { top: true, bottom: true } } },
  { id: "impl-frontend", type: "diagramNode", position: { x: 700, y: 390 },
    data: { label: "implementer[frontend]", sublabel: "frontend-specialist subagent", category: "external", icon: "🛠️", handles: { top: true, bottom: true } } },

  // ─── POLYREPO: per-repo commits (was single node) ───────────────────────
  // Trailers (D1): orchestrate-id / task-group-id / repo
  { id: "commit-backend", type: "diagramNode", position: { x: 380, y: 520 },
    data: { label: "commit[backend]", sublabel: "SHA + trailers: orchestrate-id, task-group-id, repo=backend", category: "external", icon: "📌", handles: { top: true, bottom: true } } },
  { id: "commit-frontend", type: "diagramNode", position: { x: 700, y: 520 },
    data: { label: "commit[frontend]", sublabel: "SHA + trailers: orchestrate-id, task-group-id, repo=frontend", category: "external", icon: "📌", handles: { top: true, bottom: true } } },

  // ─── [B] post-implement → pre-verify (purple, in runtime spine) ─────────
  // Both per-repo commits feed in.
  { id: "h-post-impl", type: "diagramNode", position: { x: 540, y: 650 },
    data: { label: "post-implement", sublabel: "hook #2 — payload includes per-repo SHAs", category: "core", icon: "🪝", handles: { top: true, bottom: true } } },
  { id: "h-pre-verify", type: "diagramNode", position: { x: 540, y: 780 },
    data: { label: "pre-verify", sublabel: "hook #3 — payload includes touched_repos", category: "core", icon: "🪝", handles: { top: true, bottom: true, left: true, right: true } } },

  // ─── RUNTIME — verifier fan-out (4 runner kinds, each invoked per repo) ─
  { id: "inline-runner", type: "diagramNode", position: { x: 40, y: 910 },
    data: { label: "inline-runner", sublabel: "× per (repo, task-group) — deterministic, shell tools vs diff", category: "external", icon: "⚡", handles: { top: true, bottom: true } } },
  { id: "ci-trigger", type: "diagramNode", position: { x: 320, y: 910 },
    data: { label: "CI trigger (implementer, D9)", sublabel: "implementer agent: git push / gh workflow run — no separate dispatch runner", category: "external", icon: "🚦", handles: { top: true, bottom: true, right: true } } },
  { id: "rubric-verifier", type: "diagramNode", position: { x: 800, y: 910 },
    data: { label: "rubric-verifier", sublabel: "× per (repo, task-group) — non-deterministic, scores diff vs rubric", category: "external", icon: "🎯", handles: { top: true, bottom: true } } },
  { id: "observe-runner", type: "diagramNode", position: { x: 1060, y: 910 },
    data: { label: "observe cell (async)", sublabel: "long-lived signal; verdict per (repo, task-group) lands via the inbound-gateway → delivered to the loop", category: "external", icon: "👁️", handles: { top: true, bottom: true, left: true, right: true } } },

  // ─── [X] thin connector adapter (D9) — CLI strings, not REST ────────────
  { id: "connectors", type: "diagramNode", position: { x: 320, y: 1040 },
    data: { label: "connector adapter (D9)", sublabel: "thin: trigger cmd + status/poll cmd + verdict_mapping; {REPO_KEY}_{CONN}_TOKEN (D3). NOT a REST client", category: "frontend", icon: "🔌", handles: { top: true, bottom: true, right: true } } },

  // ─── [X] CI webhook receiver (D9.1) — core FastAPI route in standards-extractor ─
  { id: "ci-webhook", type: "diagramNode", position: { x: 320, y: 1170 },
    data: { label: "inbound-gateway (D9.1)", sublabel: "POST /api/v2/inbound/{provider} — stable URL. Verify sig, dedup, correlate commit→D1 trailer→cell, map status, record, then DELIVER to the verification-loop. Decides nothing. Poll = fallback", category: "frontend", icon: "📥", handles: { top: true, right: true } } },

  // ─── [B] verdict-landed → state store → AND gate → gate-evaluated ───────
  { id: "h-verdict-landed", type: "diagramNode", position: { x: 540, y: 1170 },
    data: { label: "verdict-landed", sublabel: "hook #4 — fires per (repo, verifier) cell", category: "core", icon: "🪝", handles: { top: true, bottom: true } } },
  { id: "state-store", type: "diagramNode", position: { x: 540, y: 1300 },
    data: { label: "state store (jobs.db)", sublabel: "(D2) verdicts(orch_id, task_group_id, repo, verifier, status)", category: "external", icon: "🗄️", handles: { top: true, bottom: true, left: true } } },

  // ─── D6: built-in SSE progress stream (projection of state store; always on) ─
  { id: "sse-stream", type: "diagramNode", position: { x: 220, y: 1300 },
    data: { label: "SSE progress stream", sublabel: "(D6) GET /orchestrations/{job_id}/stream — 1 frame per event; cells_done/cells_total; resumable ?from_seq", category: "frontend", icon: "📡", handles: { right: true } } },

  { id: "and-gate", type: "diagramNode", position: { x: 540, y: 1430 },
    data: { label: "AND gate (verification-loop)", sublabel: "(D5) the loop folds the recorded verdicts: ∀ repo ∈ touched_repos · ∀ verifier · verdict = pass. Agentic, not a runtime trigger", category: "db", icon: "⚖️", handles: { top: true, bottom: true, right: true } } },
  { id: "h-gate-eval", type: "diagramNode", position: { x: 540, y: 1560 },
    data: { label: "gate-evaluated", sublabel: "hook #5", category: "core", icon: "🪝", handles: { top: true, bottom: true, left: true, right: true } } },

  // ─── PASS PATH (left branch) ────────────────────────────────────────────
  { id: "h-task-group-done", type: "diagramNode", position: { x: 40, y: 1690 },
    data: { label: "task-group-done", sublabel: "hook #8", category: "core", icon: "🪝", handles: { top: true, right: true, bottom: true } } },
  { id: "sched-advance", type: "diagramNode", position: { x: 40, y: 1820 },
    data: { label: "verification-loop advances", sublabel: "loop releases next group(s) in DAG on a passing gate", category: "external", icon: "➡️", handles: { top: true, right: true } } },

  // ─── FAIL PATH (right branch) — D4 repair classifier is repo-aware ──────
  { id: "h-pre-repair", type: "diagramNode", position: { x: 1060, y: 1690 },
    data: { label: "pre-repair", sublabel: "hook #6", category: "core", icon: "🪝", handles: { top: true, bottom: true, left: true } } },
  { id: "repair-engine", type: "diagramNode", position: { x: 1060, y: 1820 },
    data: { label: "repair-engine", sublabel: "(D4) dispatched by the loop on a failed cell; LLM classify w/ {repo, connector_kind}; fix-task scoped (task_group, repo); returns to loop", category: "extapi", icon: "🧯", handles: { top: true, bottom: true } } },
  { id: "h-post-repair", type: "diagramNode", position: { x: 1060, y: 1950 },
    data: { label: "post-repair", sublabel: "hook #7", category: "core", icon: "🪝", handles: { top: true, left: true } } },

  // ─── OBSERVER DRIFT (right of AND gate) ─────────────────────────────────
  { id: "h-observer-drift", type: "diagramNode", position: { x: 1320, y: 1300 },
    data: { label: "observer-drift", sublabel: "hook #9 — flip for one (repo, verifier) cell", category: "core", icon: "🪝", handles: { top: true, left: true } } },
];

export const edges: Edge[] = [
  // ─── SPEC LIFECYCLE ───────────────────────────────────────────────────
  { id: "e-shape-frozen", source: "shape-spec", target: "h-spec-frozen" },
  { id: "e-frozen-tasks", source: "h-spec-frozen", target: "create-tasks" },
  { id: "e-tasks-rubrics", source: "create-tasks", target: "create-rubrics" },
  { id: "e-rubrics-orch", source: "create-rubrics", target: "orchestrate" },
  { id: "e-orch-cli", source: "orchestrate", target: "run-cli" },

  // ─── EXECUTION ENTRY ──────────────────────────────────────────────────
  { id: "e-cli-sched", source: "run-cli", target: "scheduler", type: "smoothstep" },

  // ─── POLYREPO: scheduler → coord-lock → per-repo implementers ─────────
  { id: "e-sched-lock", source: "scheduler", target: "coord-lock", label: "pin inputs", type: "smoothstep",
    style: { stroke: "#f59e0b" } },
  // D7: verify config consulted alongside the lock (which cells to create)
  { id: "e-lock-verifycfg", source: "coord-lock", target: "verify-config", label: "consult verify config", type: "smoothstep",
    style: { stroke: "#3ddc84", strokeDasharray: "4 3" } },
  // D8.1a: git gate decides reuse-cache vs re-discover
  { id: "e-gate-discovery", source: "discovery-gate", target: "discovery", label: "changed → re-discover", type: "smoothstep",
    style: { stroke: "#ff8c1a", strokeDasharray: "4 3" } },
  // D8.1a: the gate gates entry into shape-spec (re-validate, then shape)
  { id: "e-gate-shape", source: "discovery-gate", target: "shape-spec", label: "re-validate, then shape", type: "smoothstep",
    style: { stroke: "#ff8c1a" } },
  // D8.1b: in-effect manifest pinned into the per-run lock
  { id: "e-discovery-lock", source: "discovery", target: "coord-lock", label: "(D8.1b) pin manifest into run lock", type: "smoothstep",
    style: { stroke: "#3ddc84", strokeDasharray: "4 3" } },
  { id: "e-lock-impl-backend", source: "coord-lock", target: "impl-backend", label: "touched_repos[0]=backend", type: "smoothstep",
    style: { stroke: "#f59e0b", strokeDasharray: "4 3" } },
  { id: "e-lock-impl-frontend", source: "coord-lock", target: "impl-frontend", label: "touched_repos[1]=frontend", type: "smoothstep",
    style: { stroke: "#f59e0b", strokeDasharray: "4 3" } },

  // ─── per-repo implementer → per-repo commit ───────────────────────────
  { id: "e-impl-commit-backend", source: "impl-backend", target: "commit-backend" },
  { id: "e-impl-commit-frontend", source: "impl-frontend", target: "commit-frontend" },

  // ─── both commits feed the post-impl hook ─────────────────────────────
  { id: "e-commit-backend-postimpl", source: "commit-backend", target: "h-post-impl", type: "smoothstep" },
  { id: "e-commit-frontend-postimpl", source: "commit-frontend", target: "h-post-impl", type: "smoothstep" },
  { id: "e-postimpl-preverify", source: "h-post-impl", target: "h-pre-verify" },

  // ─── VERIFIER FAN-OUT (per repo, but the runner kinds stay as 4) ──────
  { id: "e-preverify-inline", source: "h-pre-verify", target: "inline-runner", type: "smoothstep" },
  { id: "e-preverify-ci", source: "h-pre-verify", target: "ci-trigger", type: "smoothstep" },
  { id: "e-preverify-rubric", source: "h-pre-verify", target: "rubric-verifier", type: "smoothstep" },
  { id: "e-preverify-observe", source: "h-pre-verify", target: "observe-runner", type: "smoothstep" },

  // ─── CI: implementer trigger → connector adapter → webhook receiver (D9.1) ─
  { id: "e-ci-connectors", source: "ci-trigger", target: "connectors" },
  { id: "e-conn-webhook", source: "connectors", target: "ci-webhook", label: "CI runs → webhook (push)", type: "smoothstep",
    style: { stroke: "#4da6ff", strokeDasharray: "4 3" } },
  { id: "e-observe-webhook", source: "observe-runner", target: "ci-webhook", label: "quality/SCA push", type: "smoothstep",
    style: { stroke: "#4da6ff", strokeDasharray: "4 3" } },

  // ─── VERDICT-LANDED fires per (repo, verifier) cell ───────────────────
  { id: "e-inline-verdict", source: "inline-runner", target: "h-verdict-landed", type: "smoothstep" },
  { id: "e-webhook-verdict", source: "ci-webhook", target: "h-verdict-landed", label: "correlate + deliver to loop", type: "smoothstep" },
  { id: "e-rubric-verdict", source: "rubric-verifier", target: "h-verdict-landed", type: "smoothstep" },

  // ─── STATE STORE → AND GATE → GATE-EVALUATED ──────────────────────────
  { id: "e-verdict-store", source: "h-verdict-landed", target: "state-store" },
  // D6: SSE stream is a projection of the state store — every event → 1 frame
  { id: "e-store-sse", source: "state-store", target: "sse-stream", label: "project every event → SSE frame", type: "smoothstep",
    style: { stroke: "#4da6ff", strokeDasharray: "4 3" } },
  { id: "e-store-and", source: "state-store", target: "and-gate" },
  { id: "e-and-gateeval", source: "and-gate", target: "h-gate-eval" },

  // ─── PASS PATH ────────────────────────────────────────────────────────
  { id: "e-gateeval-done", source: "h-gate-eval", target: "h-task-group-done", label: "all (repo, verifier) pass", type: "smoothstep",
    style: { stroke: "#22c55e" } },
  { id: "e-done-advance", source: "h-task-group-done", target: "sched-advance" },
  { id: "e-advance-sched", source: "sched-advance", target: "scheduler", label: "next group", type: "smoothstep",
    style: { stroke: "#22c55e", strokeDasharray: "4 3" } },

  // ─── FAIL PATH — self-repair loop (D4 classifier is repo-aware) ───────
  { id: "e-gateeval-repair", source: "h-gate-eval", target: "h-pre-repair", label: "any (repo, verifier) fail", type: "smoothstep",
    style: { stroke: "#ef4444" } },
  { id: "e-prerepair-engine", source: "h-pre-repair", target: "repair-engine" },
  { id: "e-engine-postrepair", source: "repair-engine", target: "h-post-repair" },
  { id: "e-postrepair-impl-backend", source: "h-post-repair", target: "impl-backend", label: "loop back (capped) — if backend cell failed", type: "smoothstep",
    style: { stroke: "#ef4444", strokeDasharray: "4 3" } },
  { id: "e-postrepair-impl-frontend", source: "h-post-repair", target: "impl-frontend", label: "loop back (capped) — if frontend cell failed", type: "smoothstep",
    style: { stroke: "#ef4444", strokeDasharray: "4 3" } },

  // ─── OBSERVER DRIFT — late re-entry, per-cell ─────────────────────────
  { id: "e-observe-drift", source: "observe-runner", target: "h-observer-drift", label: "verdict flips (much later)", type: "smoothstep",
    style: { stroke: "#b366ff", strokeDasharray: "4 3" } },
  { id: "e-drift-and", source: "h-observer-drift", target: "and-gate", label: "reopens gate + compensating fix-task scoped (task_group, repo)", type: "smoothstep",
    style: { stroke: "#b366ff", strokeDasharray: "4 3" } },
];
