/**
 * Design: Technical Blueprint / Engineering Schematic
 * - Dark slate base, dot-grid background, JetBrains Mono
 * - Left panel: scenario selector with CRUD walkthroughs
 * - Right panel: React Flow diagram showing the selected scenario's state
 * - Blue = mono, Amber = poly, Green = CRUD, Red = constraint/error
 */

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  BackgroundVariant,
  Handle,
  Position,
  type NodeProps,
  MarkerType,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw, ChevronRight, AlertCircle, CheckCircle2, X } from "lucide-react";

// ─── Node explanation data ────────────────────────────────────────────────────
const NODE_EXPLAIN: Record<string, { title: string; file: string; sections: { heading: string; body: string }[] }> = {
  init: {
    title: "POST /projects/init",
    file: "src/api/routes/projects.py",
    sections: [
      {
        heading: "What it does",
        body: "The entry point for creating a new project. It accepts a company name, a project name, and a KV map of folder names to repo URLs. It validates the payload, creates the workspace directory structure, writes coordination.yaml, and initialises one GitManager per repo entry.",
      },
      {
        heading: "Mono vs Poly",
        body: "Mono: the KV map has one entry. Poly: the KV map has N entries. The route does not branch — it loops over whatever is in the map. The same code path runs for both.",
      },
      {
        heading: "Validation at this point",
        body: "Both uniqueness constraints are enforced here before any filesystem operation: folder names must be unique within the map, and repo URLs must be unique within the map. If either constraint fails, the entire init is rejected and nothing is written to disk.",
      },
      {
        heading: "What it returns",
        body: "The product workspace root path and a list of per-repo results, each carrying the folder alias, the resolved directory path, and the init mode (brownfield or greenfield). This response is the caller's confirmation that all repos are ready.",
      },
    ],
  },
  kv: {
    title: "KV Map — folder → repo URL",
    file: "src/git/models.py (ProjectInitRequest)",
    sections: [
      {
        heading: "The data structure",
        body: "A key-value map where each key is a folder name (alias) and each value is a git remote URL. This is the core declaration that drives everything: workspace layout, GitManager instantiation, coordination.yaml content, and PR routing.",
      },
      {
        heading: "Key constraints",
        body: "Folder name must be unique within the project — it becomes a sub-directory on disk. Two folders with the same name would collide. Repo URL must be unique within the project — two GitManagers pointing at the same remote would produce duplicate PRs and undefined commit behaviour.",
      },
      {
        heading: "Mono vs Poly",
        body: "Mono: one KV entry. Poly: N KV entries. The map is the only place where the distinction exists. Everything downstream just iterates over the list.",
      },
      {
        heading: "Mutability",
        body: "After init, the map is mutable via the CRUD endpoints. POST adds entries, PUT updates a repo URL for an existing folder, DELETE removes an entry. Every mutation updates coordination.yaml and re-initialises the affected GitManager.",
      },
    ],
  },
  coord: {
    title: "coordination.yaml",
    file: "workspace/{company}/{project}/coordination.yaml",
    sections: [
      {
        heading: "What it is",
        body: "A plain YAML file written at project init time and updated on every CRUD mutation. It is the single source of truth for which repos belong to this product. It lives at the product workspace root — one level above all the repo sub-directories.",
      },
      {
        heading: "What it contains",
        body: "A list of folder → repo URL mappings. Each entry has a folder name (the alias used as the sub-directory on disk) and a git remote URL. That is all. No stack metadata, no dependency declarations, no generated content.",
      },
      {
        heading: "Mono vs Poly",
        body: "Mono: one entry in the list. Poly: N entries. Same file format in both cases. The system never reads a 'mode' flag — it infers mono vs poly purely from the length of the list.",
      },
      {
        heading: "Who writes it",
        body: "The system writes it from the KV map payload at init time. Every CRUD operation (POST, PUT, DELETE) on /repo-mappings triggers an update to this file. It is human-readable and version-controllable alongside the spec files.",
      },
      {
        heading: "Why it exists",
        body: "The orchestrator needs to know the product topology before it starts any pipeline step. Without this file, the LLM session cannot be mounted at the right scope and the GitManagers cannot be initialised. It is the anchor that makes everything else possible.",
      },
    ],
  },
  orch: {
    title: "HaikaiOrchestrator",
    file: "src/haikai_orchestrator.py",
    sections: [
      {
        heading: "What it does",
        body: "Runs the full pipeline for a spec: shape-spec, write-spec, create-tasks, implement-tasks. It is the component that drives the Claude LLM session and coordinates all pipeline steps in sequence.",
      },
      {
        heading: "project_dir — the key change for polyrepo",
        body: "Today project_dir points at the single repo root. For polyrepo, it points at the product workspace root — the parent directory that contains all repo sub-directories. This single change is what gives the LLM visibility across all repos simultaneously.",
      },
      {
        heading: "How the LLM session is scoped",
        body: "The Claude session is started with cwd set to project_dir. Each repo sub-directory is added via --add-dir. For mono, one directory is added. For poly, N directories are added. The LLM sees the full product tree in both cases without any branching in the orchestrator logic.",
      },
      {
        heading: "Mono vs Poly",
        body: "The orchestrator itself is unchanged. The only difference is what project_dir resolves to and how many --add-dir mounts are passed to the Claude session. One mount for mono, N mounts for poly.",
      },
    ],
  },
  pipeline: {
    title: "Pipeline — shape → write → create → implement",
    file: "workflows/ + src/haikai_orchestrator.py",
    sections: [
      {
        heading: "shape-spec",
        body: "Analyses the product codebase and produces a structured spec. For polyrepo, it searches across all repo sub-directories. The output is a spec file that describes what needs to change across the product — not per repo.",
      },
      {
        heading: "write-spec",
        body: "Expands the spec into detailed implementation notes. For polyrepo, existing code references are grouped by repo alias (folder name). A nearest-neighbour step identifies which repo each change belongs to, producing a paths_touched list per repo.",
      },
      {
        heading: "create-tasks",
        body: "Breaks the spec into a tasks.md file. For polyrepo, task groups carry a repo annotation (e.g. [@repo:backend]) so the implement step knows which GitManager to use for each group. Cross-repo dependencies are also declared here.",
      },
      {
        heading: "implement-tasks",
        body: "Executes each task group. For mono, one apply_git_workflow call produces one PR. For poly, N apply_git_workflow calls produce N PRs — one per repo. The helper itself is unchanged; it is just called N times with different GitManagers.",
      },
    ],
  },
  pr: {
    title: "Pull Request",
    file: "src/api/git_workflow.py — apply_git_workflow",
    sections: [
      {
        heading: "What it is",
        body: "The final output of a spec run. For each repo in the product, one PR is opened on the feature branch created by the GitManager for that repo.",
      },
      {
        heading: "Mono vs Poly",
        body: "Mono: one PR on one repo. Poly: N PRs, one per repo alias. Each PR is independent — it carries only the changes that belong to its repo, as determined by the task group annotations in create-tasks.",
      },
      {
        heading: "How it is created",
        body: "apply_git_workflow takes a GitManager and a spec ID. It uses the GitManager to push the feature branch, then calls the git provider API (GitHub, Bitbucket, GitLab) to open the PR. For poly, this function is called once per GitManager in sequence.",
      },
    ],
  },
  gm: {
    title: "GitManager × N",
    file: "src/git/git_manager.py",
    sections: [
      {
        heading: "What it is",
        body: "A class that owns all git operations for a single repository directory. It is initialised with a project_dir (a filesystem path) and provider credentials. Everything it does — cloning, branching, committing, pushing — is scoped to that one directory.",
      },
      {
        heading: "What it does at init time",
        body: "When init_project(repo_url) is called, it checks whether the remote repo already has content. If it does (brownfield), it clones into project_dir. If the remote is empty (greenfield), it scaffolds a new repo and pushes. It then saves a config file so subsequent operations know the remote URL.",
      },
      {
        heading: "What it does at commit time",
        body: "It creates a feature branch, stages all changed files, writes a commit, and pushes the branch. It then hands off to apply_git_workflow to open the PR. It does not know about other repos — it only sees its own project_dir.",
      },
      {
        heading: "Mono vs Poly",
        body: "Mono: one GitManager instance, one project_dir, one PR. Poly: N GitManager instances, each with its own project_dir (one per folder alias from coordination.yaml). The class itself is unchanged — multiplicity comes from instantiating it N times, not from changing its internals.",
      },
      {
        heading: "The × N part",
        body: "The init route loops over the KV map entries and calls GitManager(product_root / alias) for each one. For a three-repo poly project, three independent GitManagers are created. At commit time, apply_git_workflow is called once per GitManager, producing one PR per repo.",
      },
    ],
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────
type RepoEntry = { folder: string; url: string };
type CRUDStep = {
  op: "GET" | "POST" | "PUT" | "DELETE" | "INIT";
  description: string;
  before?: RepoEntry[];
  after: RepoEntry[];
  highlight?: string; // folder name to highlight
  error?: string;
  note?: string;
  /**
   * For rejected POSTs: the entry the user *attempted* to add, which never made
   * it into `after`. Rendered as a red stub below the live mapping so the
   * reader can see *what* was rejected, not just that something was.
   */
  rejected?: RepoEntry;
};
type Scenario = {
  id: string;
  title: string;
  subtitle: string;
  tag: "mono" | "poly" | "transition" | "error";
  steps: CRUDStep[];
};

// ─── Scenarios ────────────────────────────────────────────────────────────────
const SCENARIOS: Scenario[] = [
  {
    id: "mono-init",
    title: "Mono Repo — Initial Setup",
    subtitle: "Single repo project from day one",
    tag: "mono",
    steps: [
      {
        op: "INIT",
        description: "User calls project init with a single folder → repo entry. System writes coordination.yaml, clones one repo, creates one GitManager.",
        after: [{ folder: "app", url: "git@github.com/acme/my-app" }],
        highlight: "app",
        note: "Mono is poly with N=1. Same code path, same data model.",
      },
      {
        op: "GET",
        description: "Fetch current mappings. Returns a list with one entry.",
        after: [{ folder: "app", url: "git@github.com/acme/my-app" }],
        note: "One entry confirms this is a mono project.",
      },
    ],
  },
  {
    id: "mono-to-poly",
    title: "Mono → Poly Migration",
    subtitle: "Splitting a monolith into frontend + backend repos",
    tag: "transition",
    steps: [
      {
        op: "INIT",
        description: "Project starts as mono — one folder mapped to the monolith repo.",
        after: [{ folder: "app", url: "git@github.com/acme/monolith" }],
        highlight: "app",
      },
      {
        op: "POST",
        description: "Team extracts the backend into its own repo. Add a new entry: backend → new repo URL. Both folder name and repo URL are validated for uniqueness before the entry is accepted.",
        before: [{ folder: "app", url: "git@github.com/acme/monolith" }],
        after: [
          { folder: "app", url: "git@github.com/acme/monolith" },
          { folder: "backend", url: "git@github.com/acme/backend" },
        ],
        highlight: "backend",
        note: "System creates workspace/product/backend/, clones the repo, initialises a new GitManager, and updates coordination.yaml.",
      },
      {
        op: "POST",
        description: "Frontend is also extracted. Add a third entry: frontend → frontend repo.",
        before: [
          { folder: "app", url: "git@github.com/acme/monolith" },
          { folder: "backend", url: "git@github.com/acme/backend" },
        ],
        after: [
          { folder: "app", url: "git@github.com/acme/monolith" },
          { folder: "backend", url: "git@github.com/acme/backend" },
          { folder: "frontend", url: "git@github.com/acme/frontend" },
        ],
        highlight: "frontend",
      },
      {
        op: "DELETE",
        description: "Monolith repo is retired. Remove the original 'app' entry. Minimum-one-entry constraint is satisfied because two entries remain.",
        before: [
          { folder: "app", url: "git@github.com/acme/monolith" },
          { folder: "backend", url: "git@github.com/acme/backend" },
          { folder: "frontend", url: "git@github.com/acme/frontend" },
        ],
        after: [
          { folder: "backend", url: "git@github.com/acme/backend" },
          { folder: "frontend", url: "git@github.com/acme/frontend" },
        ],
        highlight: "app",
        note: "Project is now fully poly. Pipeline now produces 2 PRs per spec run.",
      },
    ],
  },
  {
    id: "poly-add",
    title: "Poly — Adding a Shared Library Repo",
    subtitle: "Extending an existing poly project with a new repo",
    tag: "poly",
    steps: [
      {
        op: "GET",
        description: "Existing poly project with two repos. Fetch current state before making changes.",
        after: [
          { folder: "backend", url: "git@github.com/acme/backend" },
          { folder: "frontend", url: "git@github.com/acme/frontend" },
        ],
      },
      {
        op: "POST",
        description: "Team extracts shared utilities into a dedicated library repo. Add a third entry: shared → library repo URL.",
        before: [
          { folder: "backend", url: "git@github.com/acme/backend" },
          { folder: "frontend", url: "git@github.com/acme/frontend" },
        ],
        after: [
          { folder: "backend", url: "git@github.com/acme/backend" },
          { folder: "frontend", url: "git@github.com/acme/frontend" },
          { folder: "shared", url: "git@github.com/acme/shared-lib" },
        ],
        highlight: "shared",
        note: "Orchestrator now mounts three sub-directories. Next spec run produces 3 PRs.",
      },
    ],
  },
  {
    id: "poly-remap",
    title: "Poly — Remapping a Repo URL",
    subtitle: "Repo migrated to a new remote (e.g. org rename)",
    tag: "poly",
    steps: [
      {
        op: "GET",
        description: "Fetch current mappings before the remap.",
        after: [
          { folder: "backend", url: "git@github.com/acme/backend" },
          { folder: "frontend", url: "git@github.com/acme/frontend" },
        ],
      },
      {
        op: "PUT",
        description: "Organisation renamed from 'acme' to 'acme-corp'. Update the backend repo URL. Folder name (key) is immutable — only the URL (value) changes.",
        before: [
          { folder: "backend", url: "git@github.com/acme/backend" },
          { folder: "frontend", url: "git@github.com/acme/frontend" },
        ],
        after: [
          { folder: "backend", url: "git@github.com/acme-corp/backend" },
          { folder: "frontend", url: "git@github.com/acme/frontend" },
        ],
        highlight: "backend",
        note: "GitManager for 'backend' is re-initialised with the new remote. coordination.yaml is updated. No workspace directory rename needed — the folder name is unchanged.",
      },
      {
        op: "PUT",
        description: "Update the frontend URL to match the org rename as well.",
        before: [
          { folder: "backend", url: "git@github.com/acme-corp/backend" },
          { folder: "frontend", url: "git@github.com/acme/frontend" },
        ],
        after: [
          { folder: "backend", url: "git@github.com/acme-corp/backend" },
          { folder: "frontend", url: "git@github.com/acme-corp/frontend" },
        ],
        highlight: "frontend",
      },
    ],
  },
  {
    id: "constraint-violations",
    title: "Constraint Violations",
    subtitle: "What the system rejects and why",
    tag: "error",
    steps: [
      {
        op: "GET",
        description: "Starting state: two-repo poly project.",
        after: [
          { folder: "backend", url: "git@github.com/acme/backend" },
          { folder: "frontend", url: "git@github.com/acme/frontend" },
        ],
      },
      {
        op: "POST",
        description: "Attempt to add a new entry using a folder name that already exists.",
        before: [
          { folder: "backend", url: "git@github.com/acme/backend" },
          { folder: "frontend", url: "git@github.com/acme/frontend" },
        ],
        after: [
          { folder: "backend", url: "git@github.com/acme/backend" },
          { folder: "frontend", url: "git@github.com/acme/frontend" },
        ],
        highlight: "backend",
        error: "Rejected — folder name 'backend' already exists. Folder names must be unique within the project.",
      },
      {
        op: "POST",
        description: "Attempt to add a new entry pointing to a repo URL that is already mapped.",
        before: [
          { folder: "backend", url: "git@github.com/acme/backend" },
          { folder: "frontend", url: "git@github.com/acme/frontend" },
        ],
        after: [
          { folder: "backend", url: "git@github.com/acme/backend" },
          { folder: "frontend", url: "git@github.com/acme/frontend" },
        ],
        rejected: { folder: "shared", url: "git@github.com/acme/backend" },
        error: "Rejected — repo URL 'git@github.com/acme/backend' is already mapped to folder 'backend'. Repo URLs must be unique within the project.",
      },
      {
        op: "DELETE",
        description: "Attempt to delete the last remaining entry on a mono project.",
        before: [{ folder: "app", url: "git@github.com/acme/my-app" }],
        after: [{ folder: "app", url: "git@github.com/acme/my-app" }],
        highlight: "app",
        error: "Rejected — a project must retain at least one repo mapping. Cannot delete the last entry.",
      },
    ],
  },
];

// ─── Colours ──────────────────────────────────────────────────────────────────
const TAG_COLORS = {
  mono:       { bg: "#1a2540", border: "#3b82f6", text: "#bfdbfe" },
  poly:       { bg: "#2a1f0e", border: "#f59e0b", text: "#fde68a" },
  transition: { bg: "#1a1a2e", border: "#8b5cf6", text: "#ddd6fe" },
  error:      { bg: "#2b0e0e", border: "#ef4444", text: "#fca5a5" },
};

const OP_COLORS: Record<string, string> = {
  INIT: "#10b981", GET: "#3b82f6", POST: "#10b981", PUT: "#f59e0b", DELETE: "#ef4444",
};

// ─── Flow nodes for the diagram ───────────────────────────────────────────────
type FlowVariant = "shared" | "mono" | "poly" | "crud" | "error";
const FC: Record<FlowVariant, { border: string; bg: string; text: string }> = {
  shared: { border: "#6b7280", bg: "#1e2130", text: "#e2e8f0" },
  mono:   { border: "#3b82f6", bg: "#1a2540", text: "#bfdbfe" },
  poly:   { border: "#f59e0b", bg: "#2a1f0e", text: "#fde68a" },
  crud:   { border: "#10b981", bg: "#0d2b22", text: "#6ee7b7" },
  error:  { border: "#ef4444", bg: "#2b0e0e", text: "#fca5a5" },
};

function FlowNode({ data }: NodeProps) {
  const d = data as { label: string; sub?: string; variant: FlowVariant; dim?: boolean; nodeId?: string; onExplain?: (id: string) => void };
  const c = FC[d.variant];
  return (
    <div
      onClick={() => d.nodeId && d.onExplain && d.onExplain(d.nodeId)}
      style={{
        background: c.bg, border: `1.5px solid ${c.border}`, borderRadius: 7,
        padding: "8px 14px", minWidth: 160, opacity: d.dim ? 0.35 : 1,
        fontFamily: "'JetBrains Mono', monospace", transition: "opacity 0.3s, filter 0.15s",
        cursor: d.nodeId && NODE_EXPLAIN[d.nodeId] ? "pointer" : "default",
      }}
      onMouseEnter={e => { if (d.nodeId && NODE_EXPLAIN[d.nodeId]) (e.currentTarget as HTMLDivElement).style.filter = "brightness(1.3)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.filter = "brightness(1)"; }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div style={{ color: c.text, fontSize: 11, fontWeight: 600 }}>{d.label}</div>
      {d.sub && <div style={{ color: c.border, fontSize: 9, marginTop: 3, opacity: 0.8 }}>{d.sub}</div>}
      {d.nodeId && NODE_EXPLAIN[d.nodeId] && (
        <div style={{ color: c.border, fontSize: 8, marginTop: 4, opacity: 0.5 }}>click to explain</div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

function ExplainPanel({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const d = NODE_EXPLAIN[nodeId];
  if (!d) return null;
  return (
    <div style={{
      position: "absolute", top: 52, right: 16, width: 340, zIndex: 20,
      background: "#0d1117", border: "1px solid #374151", borderRadius: 10,
      padding: 18, boxShadow: "0 8px 32px #00000099",
      fontFamily: "'JetBrains Mono', monospace", overflowY: "auto", maxHeight: "calc(100% - 80px)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <div style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 700 }}>{d.title}</div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", padding: 2 }}>
          <X size={14} />
        </button>
      </div>
      <div style={{ color: "#6b7280", fontSize: 9, marginBottom: 14 }}>{d.file}</div>
      {d.sections.map(s => (
        <div key={s.heading} style={{ marginBottom: 14 }}>
          <div style={{ color: "#10b981", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 5 }}>
            {s.heading.toUpperCase()}
          </div>
          <div style={{ color: "#d1d5db", fontSize: 11, lineHeight: 1.7 }}>{s.body}</div>
        </div>
      ))}
    </div>
  );
}

function RepoMapNode({ data }: NodeProps) {
  const d = data as { entries: RepoEntry[]; highlight?: string; isError?: boolean; rejected?: RepoEntry; nodeId?: string; onExplain?: (id: string) => void };
  return (
    <div
      onClick={() => d.nodeId && d.onExplain && d.onExplain(d.nodeId)}
      style={{
        background: "#111827", border: `1.5px solid ${d.isError ? "#ef4444" : "#10b981"}`,
        borderRadius: 8, padding: "10px 14px", minWidth: 280,
        fontFamily: "'JetBrains Mono', monospace",
        cursor: d.nodeId ? "pointer" : "default",
        transition: "filter 0.15s",
      }}
      onMouseEnter={e => { if (d.nodeId) (e.currentTarget as HTMLDivElement).style.filter = "brightness(1.25)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.filter = "brightness(1)"; }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div style={{ color: "#6ee7b7", fontSize: 10, fontWeight: 700, marginBottom: 8 }}>
        coordination.yaml — repo mappings
      </div>
      {d.entries.map(e => (
        <div key={e.folder} style={{
          display: "flex", gap: 8, marginBottom: 5, padding: "4px 8px",
          background: d.highlight === e.folder ? (d.isError ? "#3b0000" : "#064e3b") : "#1f2937",
          borderRadius: 4, border: d.highlight === e.folder ? `1px solid ${d.isError ? "#ef4444" : "#10b981"}` : "1px solid transparent",
        }}>
          <span style={{ color: "#34d399", fontSize: 10, minWidth: 70 }}>{e.folder}/</span>
          <span style={{ color: "#6b7280", fontSize: 10 }}>→</span>
          <span style={{ color: "#9ca3af", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.url}</span>
        </div>
      ))}
      {d.rejected && (
        <div style={{
          display: "flex", gap: 8, marginTop: 6, padding: "4px 8px",
          background: "#3b0000", borderRadius: 4, border: "1px dashed #ef4444",
          opacity: 0.85,
        }}>
          <span style={{ color: "#ef4444", fontSize: 10, minWidth: 12 }}>✕</span>
          <span style={{ color: "#fca5a5", fontSize: 10, minWidth: 60, textDecoration: "line-through" }}>{d.rejected.folder}/</span>
          <span style={{ color: "#6b7280", fontSize: 10 }}>→</span>
          <span style={{ color: "#fca5a5", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "line-through" }}>{d.rejected.url}</span>
        </div>
      )}
      {d.nodeId && (
        <div style={{ color: "#10b981", fontSize: 8, marginTop: 6, opacity: 0.5 }}>click to explain</div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { flow: FlowNode, repoMap: RepoMapNode };

function buildFlowNodes(step: CRUDStep, scenarioTag: string, onExplain: (id: string) => void): { nodes: Node[]; edges: Edge[] } {
  const isPoly = step.after.length > 1;
  const isError = !!step.error;
  const variant: FlowVariant = isError ? "error" : isPoly ? "poly" : "mono";
  const arrowColor = isError ? "#ef4444" : isPoly ? "#f59e0b" : "#3b82f6";

  const nodes: Node[] = [
    {
      id: "init", type: "flow", position: { x: 80, y: 10 },
      data: { label: "POST /projects/init", sub: "or CRUD mutation", variant: "shared", nodeId: "init", onExplain },
    },
    {
      id: "kv", type: "repoMap", position: { x: 20, y: 100 },
      data: { entries: step.after, highlight: step.highlight, isError, rejected: step.rejected, nodeId: "kv", onExplain },
    },
    {
      id: "coord", type: "flow", position: { x: 80, y: 260 },
      data: { label: "coordination.yaml", sub: `${step.after.length} entr${step.after.length === 1 ? "y" : "ies"}`, variant: isError ? "error" : "shared", nodeId: "coord", onExplain },
    },
    {
      id: "gm", type: "flow", position: { x: 80, y: 350 },
      data: { label: `GitManager × ${isError ? "unchanged" : step.after.length}`, sub: "one per folder entry", variant: isError ? "error" : "shared", nodeId: "gm", onExplain },
    },
    {
      id: "orch", type: "flow", position: { x: 80, y: 440 },
      data: { label: "HaikaiOrchestrator", sub: "mounts product root", variant: "shared", nodeId: "orch", onExplain },
    },
    {
      id: "pipeline", type: "flow", position: { x: 80, y: 530 },
      data: { label: "Pipeline (unchanged)", sub: "shape → write → create → implement", variant: "shared", nodeId: "pipeline", onExplain },
    },
  ];

  // PR fan-out nodes
  if (!isError) {
    step.after.forEach((e, i) => {
      const total = step.after.length;
      const spread = total === 1 ? 0 : (i - (total - 1) / 2) * 160;
      nodes.push({
        id: `pr-${i}`, type: "flow", position: { x: 80 + spread, y: 640 },
        data: { label: `PR: ${e.folder}`, sub: e.url.split("/").slice(-1)[0], variant, nodeId: "pr", onExplain },
      });
    });
  }

  const edges: Edge[] = [
    { id: "e1", source: "init", target: "kv", markerEnd: { type: MarkerType.ArrowClosed, color: arrowColor }, style: { stroke: arrowColor, strokeWidth: 1.5 } },
    { id: "e2", source: "kv", target: "coord", markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" }, style: { stroke: "#6b7280", strokeWidth: 1.5 } },
    { id: "e3", source: "coord", target: "gm", markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" }, style: { stroke: "#6b7280", strokeWidth: 1.5 } },
    { id: "e4", source: "gm", target: "orch", markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" }, style: { stroke: "#6b7280", strokeWidth: 1.5 } },
    { id: "e5", source: "orch", target: "pipeline", markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" }, style: { stroke: "#6b7280", strokeWidth: 1.5 } },
  ];

  if (!isError) {
    step.after.forEach((_, i) => {
      edges.push({
        id: `epr-${i}`, source: "pipeline", target: `pr-${i}`,
        animated: isPoly,
        markerEnd: { type: MarkerType.ArrowClosed, color: arrowColor },
        style: { stroke: arrowColor, strokeWidth: 1.5, strokeDasharray: isPoly ? "5 3" : undefined },
      });
    });
  }

  return { nodes, edges };
}

// ─── Scenario sidebar ─────────────────────────────────────────────────────────
function ScenarioSidebar({
  scenarios, selected, onSelect,
}: { scenarios: Scenario[]; selected: string; onSelect: (id: string) => void }) {
  return (
    <div style={{
      width: 220, flexShrink: 0, background: "#0a0e1a", borderRight: "1px solid #1f2937",
      overflowY: "auto", fontFamily: "'JetBrains Mono', monospace",
    }}>
      <div style={{ padding: "14px 14px 8px", color: "#6b7280", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em" }}>
        SCENARIOS
      </div>
      {scenarios.map(s => {
        const tc = TAG_COLORS[s.tag];
        const isSelected = s.id === selected;
        return (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            style={{
              padding: "10px 14px", cursor: "pointer",
              background: isSelected ? "#111827" : "transparent",
              borderLeft: isSelected ? `3px solid ${tc.border}` : "3px solid transparent",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "#0f1623"; }}
            onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: tc.border, flexShrink: 0 }} />
              <span style={{ color: isSelected ? tc.text : "#d1d5db", fontSize: 11, fontWeight: 600, lineHeight: 1.3 }}>
                {s.title}
              </span>
            </div>
            <div style={{ color: "#6b7280", fontSize: 9, paddingLeft: 12 }}>{s.subtitle}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Step detail ──────────────────────────────────────────────────────────────
function StepPanel({
  scenario, stepIndex, onStepSelect,
}: { scenario: Scenario; stepIndex: number; onStepSelect: (i: number) => void }) {
  return (
    <div style={{
      width: 280, flexShrink: 0, background: "#0d1117", borderRight: "1px solid #1f2937",
      overflowY: "auto", fontFamily: "'JetBrains Mono', monospace",
    }}>
      <div style={{ padding: "14px 14px 8px", color: "#6b7280", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em" }}>
        CRUD STEPS — {scenario.title.toUpperCase()}
      </div>
      {scenario.steps.map((step, i) => {
        const isSelected = i === stepIndex;
        const opColor = OP_COLORS[step.op] ?? "#6b7280";
        return (
          <div
            key={i}
            onClick={() => onStepSelect(i)}
            style={{
              padding: "10px 14px", cursor: "pointer",
              background: isSelected ? "#111827" : "transparent",
              borderLeft: isSelected ? `3px solid ${opColor}` : "3px solid transparent",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "#0f1623"; }}
            onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <span style={{
                background: opColor + "22", color: opColor, fontSize: 9, fontWeight: 700,
                padding: "2px 6px", borderRadius: 3, border: `1px solid ${opColor}44`,
              }}>
                {step.op}
              </span>
              <span style={{ color: "#6b7280", fontSize: 9 }}>Step {i + 1}</span>
            </div>
            <div style={{ color: isSelected ? "#e2e8f0" : "#9ca3af", fontSize: 10, lineHeight: 1.5 }}>
              {step.description}
            </div>
            {step.error && (
              <div style={{ display: "flex", gap: 5, alignItems: "flex-start", marginTop: 6, color: "#ef4444", fontSize: 9 }}>
                <AlertCircle size={10} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{step.error}</span>
              </div>
            )}
            {step.note && !step.error && (
              <div style={{ display: "flex", gap: 5, alignItems: "flex-start", marginTop: 6, color: "#10b981", fontSize: 9 }}>
                <CheckCircle2 size={10} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{step.note}</span>
              </div>
            )}
            {/* Mapping diff */}
            {step.before && (
              <div style={{ marginTop: 8 }}>
                <div style={{ color: "#6b7280", fontSize: 8, marginBottom: 3 }}>BEFORE → AFTER</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {step.after.map(e => {
                    const wasPresent = step.before?.some(b => b.folder === e.folder && b.url === e.url);
                    const isNew = !step.before?.some(b => b.folder === e.folder);
                    const isChanged = step.before?.some(b => b.folder === e.folder && b.url !== e.url);
                    return (
                      <div key={e.folder} style={{
                        display: "flex", gap: 6, padding: "2px 6px", borderRadius: 3,
                        background: isNew ? "#064e3b" : isChanged ? "#451a03" : "#1f2937",
                        fontSize: 9,
                      }}>
                        <span style={{ color: isNew ? "#10b981" : isChanged ? "#f59e0b" : "#6b7280" }}>
                          {isNew ? "+" : isChanged ? "~" : " "}
                        </span>
                        <span style={{ color: "#34d399" }}>{e.folder}/</span>
                      </div>
                    );
                  })}
                  {step.before?.filter(b => !step.after.some(a => a.folder === b.folder)).map(e => (
                    <div key={e.folder} style={{
                      display: "flex", gap: 6, padding: "2px 6px", borderRadius: 3,
                      background: "#2b0e0e", fontSize: 9,
                    }}>
                      <span style={{ color: "#ef4444" }}>−</span>
                      <span style={{ color: "#f87171" }}>{e.folder}/</span>
                    </div>
                  ))}
                  {step.rejected && (
                    <div style={{
                      display: "flex", gap: 6, padding: "2px 6px", borderRadius: 3,
                      background: "#2b0e0e", border: "1px dashed #ef4444", fontSize: 9,
                    }}>
                      <span style={{ color: "#ef4444" }}>✕</span>
                      <span style={{ color: "#fca5a5", textDecoration: "line-through" }}>{step.rejected.folder}/</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Flow canvas ──────────────────────────────────────────────────────────────
function FlowCanvas({ step, scenarioTag, onExplain }: { step: CRUDStep; scenarioTag: string; onExplain: (id: string) => void }) {
  const { nodes: initNodes, edges: initEdges } = buildFlowNodes(step, scenarioTag, onExplain);
  const [nodes, , onNodesChange] = useNodesState(initNodes);
  const [edges, , onEdgesChange] = useEdgesState(initEdges);

  return (
    <ReactFlow
      key={JSON.stringify(step.after) + step.error}
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.3}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} color="#1e2130" gap={20} size={1} />
      <Controls style={{ background: "#1e2130", border: "1px solid #374151" }} />
      <MiniMap
        style={{ background: "#111827", border: "1px solid #374151" }}
        nodeColor={n => {
          const v = (n.data as { variant?: string }).variant;
          return v === "mono" ? "#3b82f6" : v === "poly" ? "#f59e0b" : v === "crud" ? "#10b981" : v === "error" ? "#ef4444" : "#6b7280";
        }}
      />
    </ReactFlow>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function FlowDiagram() {
  const [scenarioId, setScenarioId] = useState("mono-init");
  const [stepIndex, setStepIndex] = useState(0);
  const [explainNode, setExplainNode] = useState<string | null>(null);

  const scenario = SCENARIOS.find(s => s.id === scenarioId)!;
  const step = scenario.steps[stepIndex];

  const handleScenarioSelect = (id: string) => {
    setScenarioId(id);
    setStepIndex(0);
  };

  const tc = TAG_COLORS[scenario.tag];

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", background: "#0a0e1a" }}>
      {/* Scenario list */}
      <ScenarioSidebar scenarios={SCENARIOS} selected={scenarioId} onSelect={handleScenarioSelect} />

      {/* Step list */}
      <StepPanel scenario={scenario} stepIndex={stepIndex} onStepSelect={setStepIndex} />

      {/* Flow canvas */}
      <div style={{ flex: 1, position: "relative" }}>
        {explainNode && <ExplainPanel nodeId={explainNode} onClose={() => setExplainNode(null)} />}
        {/* Header bar */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
          background: "#0d1117", borderBottom: "1px solid #1f2937",
          padding: "8px 16px", display: "flex", alignItems: "center", gap: 10,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          <span style={{
            background: tc.bg, color: tc.text, border: `1px solid ${tc.border}`,
            fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 3,
          }}>
            {scenario.tag.toUpperCase()}
          </span>
          <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{scenario.title}</span>
          <ChevronRight size={12} color="#6b7280" />
          <span style={{ color: "#9ca3af", fontSize: 11 }}>Step {stepIndex + 1} of {scenario.steps.length}</span>
          <span style={{
            marginLeft: "auto", background: (OP_COLORS[step.op] ?? "#6b7280") + "22",
            color: OP_COLORS[step.op] ?? "#6b7280", border: `1px solid ${(OP_COLORS[step.op] ?? "#6b7280")}44`,
            fontSize: 10, fontWeight: 700, padding: "2px 10px", borderRadius: 3,
          }}>
            {step.op}
          </span>
        </div>

        {/* Step nav buttons */}
        <div style={{
          position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 10, display: "flex", gap: 8,
        }}>
          <button
            onClick={() => setStepIndex(i => Math.max(0, i - 1))}
            disabled={stepIndex === 0}
            style={{
              background: "#1f2937", border: "1px solid #374151", color: stepIndex === 0 ? "#374151" : "#e2e8f0",
              borderRadius: 6, padding: "6px 14px", cursor: stepIndex === 0 ? "not-allowed" : "pointer",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
            }}
          >
            ← Prev
          </button>
          <button
            onClick={() => setStepIndex(i => Math.min(scenario.steps.length - 1, i + 1))}
            disabled={stepIndex === scenario.steps.length - 1}
            style={{
              background: "#1f2937", border: "1px solid #374151",
              color: stepIndex === scenario.steps.length - 1 ? "#374151" : "#e2e8f0",
              borderRadius: 6, padding: "6px 14px",
              cursor: stepIndex === scenario.steps.length - 1 ? "not-allowed" : "pointer",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
            }}
          >
            Next →
          </button>
        </div>

        <div style={{ paddingTop: 44, height: "100%" }}>
          {/* key forces FlowCanvas to remount on every step change so the
              internal useNodesState/useEdgesState re-seeds from the new step
              — otherwise the canvas was frozen at step 1's nodes forever. */}
          <FlowCanvas
            key={`${scenarioId}:${stepIndex}`}
            step={step}
            scenarioTag={scenario.tag}
            onExplain={setExplainNode}
          />
        </div>
      </div>
    </div>
  );
}
