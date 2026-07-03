# Run Flow Graph — live, server-owned, event-sourced execution graph

**Status: REQUIREMENTS LOCKED (user, 2026-07-02). Grilled against code
2026-07-02 (Q1: v1 models the SHIPPED runtime, not the target design —
see D2a/D4/D7a and the revised node scheme). Ready to shape.**

## Product definition

> Run Flow Graph is a versioned, event-sourced, server-owned execution graph
> for long-running orchestration and verification runs. It is anchored on
> `orchestrate_id`, emitted by deterministic runtime code, stored as
> append-only graph events, projected into snapshots, streamed over SSE, and
> rendered generically by React Flow. Dynamic branches, repair loops, CI
> nodes, and late DAG growth are normal graph events, not UI special cases.

Core invariant the feature is shaped around:

> A run graph is the authoritative visual model of one orchestration run,
> anchored on `orchestrate_id`, where known structure, live progress, dynamic
> repair loops, external CI state, and evidence references are all
> represented by a versioned protocol.

This is a server-owned execution graph, **not a log visualisation**. The
backend owns the graph. Runtime code emits graph events. The event store
preserves history. The projector folds events into snapshots. React Flow is
only a renderer.

## Prior art (this repo)

- **D6** (`2026-05-20-async-verification-orchestration` + shipped
  `GET /api/v2/orchestrations/{id}/stream`, inbound.py:415) — the
  event-sourced projection pattern, `from_seq` resume, bounded-poll SSE.
- **diagram07** (`diagrams/client/src/data/diagram07.ts`) — the hand-drawn
  React Flow graph of this exact flow (repair back-edge included, plus a
  static "D6 SSE stream" node). This feature replaces its hardcoded arrays
  with live data; diagram07 remains the static reference design.
- Research inventory 2026-07-02: 8 gaps between today's emissions and a live
  flowchart (no start events, no served skeleton, no dependency edges, no
  sub-step telemetry, conditional hook events, no stable node IDs, two
  disjoint progress worlds).

## Non-goals (v1)

- Playback **UI** (step/rewind) — the backend replay *invariant* is v1 (D7);
  the UI on top is later.
- Sub-step / subagent graph nodes — evidence only (D10, I14).
- Gateway + main-frontend integration — v1 renders in `diagrams/client`
  reading :8000 directly (D9); productisation is a later stage.
- Shape-spec chat as graph structure — metadata on the run root only (D2, I12).
- Independent graph-event pruning / archival — graph events live as long
  as the run's `verification_events` live; archive-then-prune is a future
  option, not v1.
- **Target orchestration.yml DAG visualisation.** The protocol remains
  capable of representing future task-group DAGs (group nodes +
  `depends_on` edges), but v1 only emits structure the shipped runtime
  actually owns. The current runtime neither reads nor writes
  `orchestration.yml` (only two docstrings reference it —
  `inline_runner.py:3`, `recorder.py:206`), so v1 emits no
  orchestration.yml-derived task-group nodes or dependency edges.

---

## Decisions

### D1 — Three planes, explicitly separated

1. **Structure plane** — what exists. Events: `graph_node_declared`,
   `graph_edge_declared`. Append-only; nodes and edges are never removed or
   mutated; the graph may grow over time as more structure becomes known.
   (v1 node kinds: run, command, group, ci, cell, gate, repair, attempt;
   sequence / depends_on / spawns / repair_of / binds edges.)
2. **Lifecycle plane** — what is happening. Event:
   `graph_node_state_changed`. States: D13.
3. **Evidence plane** — proof, context, drill-in. Event:
   `graph_evidence_attached`. Always referenced (`{evidence_kind, ref}`),
   never inlined blobs. Rendered in side panels / drawers / drill-ins;
   evidence never drives graph layout.

A renderer consuming only structure + lifecycle is complete enough to draw
the live graph.

### D2 — Run anchor and identity

- The graph **begins at orchestrate-job creation**; root identity =
  `orchestrate_id` (the stitch key between the JobProgress world and the
  verification-events world). Root node: `run/{orchestrate_id}`.
- Shape/spec chat is NOT graph structure in v1 — it attaches as root-node
  metadata, e.g.
  `{"spec_names": [...], "company": ..., "project": ..., "shape_session": ..., "created_from": "shape-spec"}`.
- **Repair orchestrations** have their own physical job ids but do NOT start
  independent visible graphs by default: they attach to the PARENT graph
  under the failing cell. A repair orchestration carries: own job id,
  `repair_of` parent cell/failed node, parent `run_id`/`orchestrate_id`.
  The logical graph remains ONE run graph.
- **Multi-spec batch runs (Q2): one operational run graph.** One
  orchestration → one branch/MR → one CI path → one repair space = one run.
  In v1 each spec is one group node (D2a); a batch run has N group nodes
  under the run root.

**D2a — Spec and group collapse in v1 (grill Q1).** The shipped runtime
binds CI and verification work with `orchestrate_id, spec_name, folder, sha`
(`_record_ci_binding`, tasks.py:171; call sites :293 per-spec, :352 batch) —
there is no runtime-owned `spec_id → task_group_id` hierarchy today;
**`task_group_id` IS the spec name**. Therefore v1 collapses spec and group
into ONE node, `run/{orchestrate_id}/group/{spec_name}`, whose metadata
records the model explicitly:

```json
{"group_model": "spec_as_group", "spec_name": "my-spec",
 "task_group_id": "my-spec", "folder": "specs/my-feature"}
```

The run root's meta likewise carries `"runtime_model": "current_runtime.v1"`.
If a later runtime introduces an orchestration.yml-backed DAG (multiple task
groups per spec), the protocol grows to
`run/{id}/spec/{spec_id}/group/{task_group_id}` under
`"runtime_model": "orchestration_dag.v1"` — the event vocabulary is
unchanged; only emitted structure changes. **v1 does not synthesise that
hierarchy.**

**D2b — Repair target identity is complete (grill Q2).** A repair
orchestration is cell-scoped, so any repair job that attaches to the parent
run graph must carry enough identity to address the failed cell. The
`repair_of` contract is EXTENDED (today it carries only
`{orchestrate_id, task_group_id, repo}` — tasks.py:289-291,
verify-task-group.md:57 — which is insufficient: with multiple verifiers per
repo, `{spec, repo}` is ambiguous, and the job payload doesn't record which
failed verifier caused the repair). Minimum: `orchestrate_id, task_group_id,
repo, verifier`. Preferred: also `attempt` and `repair_id` (a canonical id
from the open_repair record; `repair_id` complements — never substitutes —
the human-readable target fields). An optional `cell_node_id` is derivable
convenience, not source of truth. A repair orchestration must NOT attach to
a cell unless the runtime has VALIDATED that cell is the actual repair
target (see D4/D6). This is valuable beyond the graph: it makes the repair
job payload self-describing for audit, debugging, replay, and attribution.

**D2c — Repair jobs have physical job identity but NO visible root graph
(grill Q3).** A repair orchestration is physically an orchestration job but
logically part of the parent run graph. `run_orchestration` is
**mode-aware**: with `repair_of` absent it declares the normal root graph;
with a validated `repair_of` present it declares NO new root — it resolves
the parent run + repair attempt node, marks the attempt `running`, and
records its physical job id as evidence on the attempt
(`{"evidence_kind":"artifact","ref":"job://<id>"}`). Its internal
command execution is evidence in v1 (D10a). On validation FAILURE: never
silently create `run/{repair_job_id}` as a fallback visible graph (that
would hide the bug and violate D2) — mark the dispatch invalid / emit
group-level error evidence / fail fast. The repair job's CI pipeline (new
SHA) IS a graph node — `run/{parent}/group/{spec}/ci/{repo}/{repair_sha7}`
under the parent group, `meta.source="repair"`, with a `binds` edge from the
attempt (`meta.reason="repair_commit_ci"`); its verdict updates the ORIGINAL
cell and re-folds the gate, exactly matching the runtime's `repair_of`
CI-binding semantics. (Use `binds` in v1; a `reports` edge kind is not
introduced.) Future reserved shape: nested
`…/repair/attempt/{n}/command/*` nodes as an expandable detail view — out of
scope for v1, never a second top-level graph.

### D3 — Same event store, dedicated `graph_events` table, ONE graph module
(revised, grill Q4)

Graph events live in a **dedicated `graph_events` table in the SAME SQLite
store** (same db file, same append/read machinery style, same
transaction scope) — NOT as extra kinds in `verification_events`. Grill Q4
evidence forced this: (1) the D6 frame mapper passes unmapped kinds through
raw (inbound.py:380-401), so graph kinds in `verification_events` would leak
into every D6 consumer — "untouched code, changed output"; (2) D11's
idempotency keys (`node_id`/`edge_id`) would be buried in `payload_json`
with nowhere to put a unique index. Dedicated schema:

```
graph_events(seq INTEGER PRIMARY KEY, run_id, kind, node_id, edge_id,
             payload_json, protocol_version, created_at)
+ UNIQUE indexes making I4/I5 idempotency/conflict a DATABASE CONSTRAINT,
  not application discipline.
```

**D6 and the raw events endpoint stay untouched BY CONSTRUCTION.** When a
guarded recorder write and its graph emission must land together, they
commit in ONE transaction across the two tables.

Plumbing note: `enqueue_cli` runs in the verify agent's session and today
opens only the jobs db — for D2b validation and graph emission it gains a
`--db <verification_db>` parameter, exactly like the recorder CLI
(verify-task-group.md:34).

One module — `src/verification/flow_graph.py` — is the **sole graph-event
API** (I9). Runtime components call it; none append graph events directly.
The module owns: schema validation, protocol versioning, idempotency, state
transition checks, snapshot folding, event replay.

Internal API:

```
ensure_run(run_id, meta=None)
ensure_node(run_id, node_id, parent_id, node_kind, label, meta=None)
ensure_edge(run_id, edge_id, source, target, edge_kind, meta=None)
set_state(run_id, node_id, state, detail=None)
attach_evidence(run_id, node_id, evidence_kind, ref, label=None, meta=None)
snapshot(run_id, at_seq=None)
events_since(run_id, from_seq)
```

Retention (Q1): graph events live as long as the run's verification_events
live — **no independent graph-event pruning in v1** (replay is a v1
invariant; independent pruning breaks it). Evidence *targets* may have their
own retention; refs may go stale. Structure + lifecycle events must remain
replayable for the life of the run.

### D4 — Emission is runtime code, not agent discipline (revised, grill Q1)

At v1 granularity, **every emitted graph event must have a shipped runtime
owner** — never an LLM agent remembering to emit.

The initial run skeleton reflects the ACTUAL command sequence
`run_orchestration` executes (haikai_orchestrator.py:108-113):
`/write-spec → /create-tasks → /implement-tasks → /git-commit-preparation`,
represented as `command` nodes under the run root, joined by `sequence`
edges. **Verification is NOT one of those command nodes** — it happens later
(CI callbacks, `VERIFY_TASK_GROUP` jobs, recorder guarded writes, gates,
repair) and populates the verification subtree under
`run/{orchestrate_id}/group/{spec_name}`.

| Emission point | Condition | Emits |
|---|---|---|
| `run_orchestration` start | no `repair_of` | run root node, four `command` nodes, `sequence` edges |
| command lifecycle callback (`on_step_complete`) | no `repair_of` | command `node_state` updates |
| `run_orchestration` start | validated `repair_of` | repair attempt `running` state on the PARENT graph, repair job evidence (D2c) — NO new root |
| command lifecycle callback | validated `repair_of` | evidence updates on the repair attempt, NOT command nodes |
| `run_orchestration` completion | validated `repair_of` | attempt completion state (if known), commit/MR/SHA evidence |
| `_record_ci_binding(git_config, orchestrate_id, spec_name, folder, sha)` | normal | `group/{spec_name}` node, CI binding evidence, CI node |
| `_record_ci_binding` (repair branch) | validated `repair_of` | repair CI node under the PARENT group, `binds` edge attempt→CI, evidence refs |
| repair CI callback / verdict | validated `repair_of` | CI node state, ORIGINAL cell verdict update, gate re-fold |
| inbound CI webhook correlation | any | CI node state, CI evidence, binding/spawn edges into the verification subtree |
| `VERIFY_TASK_GROUP` job start | any | verification-subtree `running` state |
| recorder guarded writes | any | cell states, gate states, evidence refs |
| `open_repair` guarded recorder write | any | **authoritative**: repair node, attempt node, `repair_of` edge, initial repair state (it alone has the full cell key `repo+verifier+attempt`) |
| `open_repair` cap refusal | any | `escalated` on cell + repair + group — cap exhaustion IS the escalation moment |
| recorder `escalate` (guarded verb, added post-grill) | any | stamped `task_group_state='escalated'` + `escalated` graph states; refuses on an advanced group; `advance` can still land after a human resolves the cause |
| `DELETE /api/v1/jobs/{job_id}` | orchestration jobs | `cancelled` on the run root (normal) or the repair attempt on the PARENT graph (repair jobs) |
| `enqueue_cli` | validated `repair_of` | repair job evidence, attempt `running` state, `spawns`/`binds` edge to the repair orchestration job |
| `enqueue_cli` | invalid `repair_of` | NO cell-scoped structure — group-level error evidence, or fail fast |
| TTL sweeper | any | `timeout` states |

Every row has a runtime home. The former "`orchestration.yml`
materialisation" row is OUT of v1 (no runtime owner — see Non-goals).
Sub-step and subagent telemetry: evidence, not v1 structure.

### D5 — Dynamic structure is normal

Dynamic structure is not a special mode. A repair loop, escalation branch,
retriggered pipeline, late-discovered task group, or CI node is just another
ordered graph event. The client never distinguishes "static skeleton" from
"dynamic patch" — it folds one ordered event stream (I11). Native as a
result: late DAG materialisation, repair back-edges, CI-triggered branches,
retry attempts, escalation paths.

### D6 — Repair attempts: explicit, validated, collapsed in UI

- Repair node = visible collapsed parent; attempts = protocol-level child
  nodes: `…/cell/{repo}/{verifier}/repair/attempt/{n}`.
- **The recorder/`open_repair` path is authoritative for declaring the
  repair target** — it alone carries the full cell key (`repo, verifier,
  attempt`). Repair dispatch via `enqueue_cli(repair_of=...)` must carry the
  same target identity including `verifier` (D2b) and must be **validated
  against the authoritative repair record before emitting any cell-scoped
  graph structure**. Validation rule: there must exist an open repair record
  matching `orchestrate_id + task_group_id + repo + verifier` (+ `attempt` /
  `repair_id` if supplied) in an enqueueable state. On failure: reject —
  missing/unknown/mismatched verifier, attempt mismatch, or ambiguity
  (multiple candidate repairs) all reject. **Do not guess.** Invalid
  dispatches emit group-level error evidence only (or fail fast), never
  attach to a guessed cell. The field is agent-provided but
  runtime-validated — preserving D4's principle.
- Default UI: `Cell failed → Repair ⟳ 2/3 → Cell passed`. Expanded UI lists
  per-attempt state and evidence.
- Cap escalation is a lifecycle state (`escalated`), not new structure.
- Attempt evidence is tagged by attempt (`meta.attempt`), attached to the
  attempt node.
- **Compatibility fallback (transitional only, marked debt):** if the
  contract can't change immediately, `open_repair` declares the cell-scoped
  repair/attempt nodes and `enqueue_cli` emits only group-level evidence
  ("repair job X enqueued, target unresolved in job payload") — do NOT build
  the v1 design around this degraded model.

### D7 — Replay is a backend v1 INVARIANT

Playback UI can wait; replay correctness cannot.

> Graph state at seq N is a pure fold of graph events where seq ≤ N.

No out-of-band graph state; no mutable graph state required to reconstruct a
completed run. Snapshot API supports `at_seq=<n>`. **Property test
requirement (the projector's core correctness test):** for a recorded real
run, `fold(events[..n]) == snapshot(run_id, at_seq=n)` for every prefix n.

**D7a — The projector must not invent semantic structure (grill Q1).**
The projector MAY compute derived presentation fields: latest node state,
evidence counts, latest-evidence-by-kind, the repair attempt badge, collapsed
child summaries, snapshot conveniences. It MUST NOT invent semantic graph
structure no runtime code emitted. Not allowed in v1: a synthetic verify
phase, synthetic orchestration.yml task groups, synthetic `depends_on`
edges, a synthetic spec→group hierarchy. Allowed: deriving display state
from emitted `node_state`, badges from emitted attempt events, summaries
from emitted evidence refs, grouping from emitted `parent_id` values. This
is what preserves the replay invariant.

### D8 — API surface

- `GET /api/v2/runs/{orchestrate_id}/graph` — latest snapshot.
- `GET /api/v2/runs/{orchestrate_id}/graph?at_seq=<n>` — historical snapshot.
- `GET /api/v2/runs/{orchestrate_id}/graph?stream=true&from_seq=<n>` — SSE of
  graph events (existing D6 bounded-poll SSE pattern). Bearer auth like the
  rest of v2.

Snapshot shape:

```json
{
  "run": {"run_id": "orchestrate-123", "root_node_id": "run/orchestrate-123", "meta": {}},
  "seq": 184,
  "nodes": [],
  "edges": [],
  "states": {},
  "evidence_summary": {}
}
```

Snapshots carry **evidence summaries, not full evidence history** (D14).

### D9 — Client v1 lives in diagrams/client

`diagrams/client` gains a **Live Run mode**: select run → fetch snapshot →
render React Flow graph (+ layout: dagre/elk) → connect SSE from snapshot
seq → fold incoming graph events → update React Flow state.

The renderer knows graph concepts only: node_kind, edge_kind, state,
evidence summary, parent-child grouping, collapse/expand. It never parses
`orchestration.yml`, `coordination.lock.yaml`, raw logs, raw D6 frames, or
workspace files (I10). diagram07 remains the static reference design; the
live graph supersedes it visually. Main frontend/gateway integration is a
later productisation stage (gateway shapeSpec.ts SSE-proxy template +
frontend useShapeSpecStream pattern already identified).

### D10 — Granularity and the CI boundary

V1 node kinds: `run, command, group, ci, cell, gate, repair, attempt`.
(`command` — not `phase` — because the shipped runtime is command-driven; a
command node represents one concrete orchestrator command executed by
`run_orchestration`. `spec` is reserved for the future two-level model,
D2a.)

Evidence, NOT structure: AST scan invocations, inline verifier commands,
language pack runs, GitLab trigger/poll API calls, subagent activity, raw
logs, trace fragments.

**D10a — Repair job internals are sub-steps in v1 (grill Q3).** A repair
orchestration's internal command sequence is sub-step telemetry of the
repair attempt: repair job commands, job id, commit, MR, logs = **evidence**
on the attempt node. The repair CI pipeline remains a graph node because it
is an external execution object with an independent lifecycle whose verdict
re-folds the original cell/gate.

The CI boundary (I13):

| Thing | Representation |
|---|---|
| GitLab pipeline run | `ci` node |
| Pipeline URL / logs | evidence |
| Trigger / poll API calls | evidence |
| Pipeline status | lifecycle state on the `ci` node |
| Pipeline failure causing repair | graph edge into the repair flow |

### D11 — Idempotent structure declarations

Multiple emitters may independently derive and emit the same node or edge —
expected, not an error. Rules:

- same `node_id` + same payload → no-op
- same `edge_id` + same payload → no-op
- same `node_id`/`edge_id` + **conflicting** payload → protocol error

Natural keys: node = `run_id + node_id`; edge = `run_id + edge_id`. Runtime
code calls `ensure_node`/`ensure_edge`, never raw appends. Protects against:
worker retries, duplicate CI callbacks, lazy cell creation, process
restarts, repair retries, interleaved emitters.

### D12 — Versioned event envelope

Every graph event uses a versioned envelope:

```json
{
  "protocol_version": "run_graph.v1",
  "run_id": "orchestrate-123",
  "seq": 184,
  "event_time": "2026-07-02T18:30:00Z",
  "kind": "graph_node_state_changed",
  "payload": {}
}
```

`run_id` is explicit — **never derived by parsing `node_id`**. The projector
folds by `WHERE run_id = ? ORDER BY seq ASC` (Q5: with explicit run_id +
idempotent declarations + transition validation, SQLite's serialized writes
— multiple emitter processes, one write lock — give a monotonic `seq` and
sufficient per-run total order; there is no single writer *process*).

### D13 — Explicit lifecycle state machine

States: `pending, ready, running, pass, fail, skipped, timeout, cancelled,
escalated`.

| State | Meaning |
|---|---|
| `pending` | declared, not yet eligible |
| `ready` | dependencies satisfied, waiting to dispatch |
| `running` | dispatched or actively executing |
| `pass` / `fail` | completed |
| `skipped` | deliberately not run |
| `timeout` | TTL/runtime timeout |
| `cancelled` | explicit cancellation |
| `escalated` | failed beyond automatic repair policy |

**Advance dispatch emits transitions (Q3):** dependent groups move
`pending → ready` when dependencies pass and `ready → running` when
dispatched — do NOT wait for the group's first child event. Dispatch-to-
execution lag is itself meaningful and visible.

**Failure taxonomy lives in `detail`, never in state names (Q4):**

```json
{
  "state": "fail",
  "detail": {"classification": "flaky|infra|out-of-scope|real",
              "confidence": 0.91, "repairable": true,
              "repair_policy": "auto", "reason_ref": "event://..."}
}
```

Never `infra_fail`/`real_fail`/`flaky_fail` states.

Every D13 state has a runtime emitter (closure pass, 2026-07-03): `escalated`
via the cap-refusal shim and the new guarded `escalate` recorder verb (which
also closes the old "no formal escalated stamp" gap — the park is a recorded
`task_group_state`, not just a red-gate effect); `cancelled` via the job
cancel route (run root, or the repair attempt on the parent graph).

### D14 — Snapshot evidence is summarised

Snapshots never return full evidence history (completed runs may be large;
initial render must be fast; evidence is drill-in). Snapshot carries per-node
`counts_by_kind`, `latest_by_kind` (+ optional error headline / primary URL):

```json
{
  "evidence_summary": {
    "run/123/group/G1/cell/repoA/verifierX": {
      "counts_by_kind": {"log": 3, "verdict": 1, "diff": 1},
      "latest_by_kind": {"verdict": {"ref": "event://verification/999",
                                      "label": "Verifier failed"}}
    }
  }
}
```

Full drill-in follows `ref`s; a
`GET /api/v2/runs/{id}/graph/nodes/{node_id}/evidence` endpoint is a future
option, not required for v1 if refs suffice.

### D15 — Protocol invariants

- **I1.** Every graph event belongs to exactly one `run_id`.
- **I2.** Every `node_id` is deterministic and stable for the logical
  execution unit it represents.
- **I3.** Structure is append-only; nodes/edges never deleted or mutated.
- **I4.** Structure declarations are idempotent by natural key.
- **I5.** Conflicting re-declarations are protocol errors.
- **I6.** Lifecycle state is latest-wins by seq, subject to valid transitions.
- **I7.** Evidence is append-only and referenced, not inlined.
- **I8.** A snapshot at seq N is a pure fold of graph events ≤ N.
- **I9.** Runtime components emit graph events only through the flow_graph API.
- **I10.** The client never infers graph structure from logs, workspace
  files, or raw D6 events.
- **I11.** Dynamic graph growth is normal protocol behaviour, not a patch mode.
- **I12.** Shape/spec chat context is metadata in v1, not graph structure.
- **I13.** External CI pipelines are graph nodes; low-level CI API calls are
  evidence.
- **I14.** Sub-step and subagent details are evidence in v1, not graph nodes.
- **I15.** Replay correctness is a backend v1 requirement even though
  playback UI is deferred.
- **I16.** A repair orchestration carries a complete repair target identity
  (`orchestrate_id, task_group_id, repo, verifier`, plus `attempt` or
  `repair_id`), and cell-scoped repair structure is emitted only after
  runtime validation against the authoritative open_repair record (D2b, D6).

---

## Event vocabulary

Four kinds, versioned envelope (D12). Distinct kind fields — `kind` (event),
`node_kind`, `edge_kind`, `evidence_kind` — never one overloaded "kind".

**`graph_node_declared`**
```json
{"node_id": "run/123/group/G1/cell/repoA/verifierX",
 "parent_id": "run/123/group/G1",
 "node_kind": "cell", "label": "repoA / verifierX",
 "meta": {"repo": "repoA", "verifier": "verifierX"}}
```

**`graph_edge_declared`**
```json
{"edge_id": "edge/run-123/G1-to-G2",
 "source": "run/123/group/G1", "target": "run/123/group/G2",
 "edge_kind": "depends_on", "meta": {}}
```

**`graph_node_state_changed`**
```json
{"node_id": "run/123/group/G1/cell/repoA/verifierX",
 "state": "running",
 "detail": {"attempt": 1, "last_seen_at": "2026-07-02T18:30:00Z"}}
```

**`graph_evidence_attached`**
```json
{"node_id": "run/123/group/G1/cell/repoA/verifierX/repair/attempt/2",
 "evidence_kind": "diff", "ref": "workspace://patches/repair-attempt-2.diff",
 "label": "Repair attempt 2 patch", "meta": {"attempt": 2}}
```

## Node ID scheme (v1, revised per grill Q1)

```
run/{orchestrate_id}
run/{orchestrate_id}/command/1-write-spec
run/{orchestrate_id}/command/2-create-tasks
run/{orchestrate_id}/command/3-implement-tasks
run/{orchestrate_id}/command/4-git-commit-preparation
run/{orchestrate_id}/group/{spec_name}
run/{orchestrate_id}/group/{spec_name}/ci/{repo}/{sha7}
run/{orchestrate_id}/group/{spec_name}/cell/{repo}/{verifier}
run/{orchestrate_id}/group/{spec_name}/gate
run/{orchestrate_id}/group/{spec_name}/cell/{repo}/{verifier}/repair
run/{orchestrate_id}/group/{spec_name}/cell/{repo}/{verifier}/repair/attempt/{n}
```

Every ID is constructible from data the emitting runtime already has. A
multi-spec batch run = N `group/{spec_name}` nodes under one run root.

The v1 graph shape:

```
run/{orchestrate_id}
├─ command/1-write-spec ─seq→ 2-create-tasks ─seq→ 3-implement-tasks ─seq→ 4-git-commit-preparation
└─ group/{spec_name}          (spawned/bound after commit preparation)
   ├─ ci/{repo}/{sha7}
   ├─ cell/{repo}/{verifier}  (× N)
   ├─ gate
   └─ repair
      └─ attempt/{n}
```

The UI may present this as two lanes (Implementation | Verification/CI/
Repair), but the protocol never claims verification is one of the
orchestration job's commands.

Future two-level model (`orchestration_dag.v1`, NOT emitted in v1):

```
run/{orchestrate_id}/spec/{spec_id}
run/{orchestrate_id}/spec/{spec_id}/group/{task_group_id}
run/{orchestrate_id}/spec/{spec_id}/group/{task_group_id}/cell/{repo}/{verifier}
```

## Edge kinds

| Edge kind | Meaning |
|---|---|
| `sequence` | concrete ordered command progression |
| `depends_on` | target cannot run until source passes — **v1: emit ONLY when the runtime owns a real dependency relation; never from agent-world design files** |
| `spawns` | source caused downstream work to be created |
| `repair_of` | target repair addresses source failure |
| `binds` | runtime correlation between two entities (e.g. group→ci, cell→gate) |
| `contains` | optional explicit containment — only if layout needs it; containment normally lives on `parent_id` |

V1 edge usage: `command ─sequence→ command`;
`command/4 ─spawns→ group/{spec_name}`; `group ─binds→ ci/{repo}/{sha7}`;
`ci ─spawns→ cell`; `cell ─binds→ gate`; failed cell/gate `←repair_of─
repair`.

## Implementation sequence

1. **Build `flow_graph.py`** — envelope, schema validation, ensure_node/
   ensure_edge/set_state/attach_evidence, snapshot fold, events_since.
2. **Projector tests** — synthetic events first, then the recorded-run
   property test `fold(events[..n]) == snapshot(at_seq=n)` (D7).
3. **Emit run + command chain** — instrument `run_orchestration`: root, four
   command nodes, sequence edges, command states via `on_step_complete`.
4. **Emit group + CI binding** — instrument `_record_ci_binding`:
   `group/{spec_name}` node, CI node, binding evidence.
5. **Emit cells and gates** — recorder guarded writes; lazy cell declaration
   on first reference.
6. **Emit repair loop** — instrument `enqueue_cli(repair_of=...)`: repair
   node, attempt detail, `repair_of`, `spawns`.
7. **Emit CI nodes** — inbound gateway correlation: CI lifecycle + `binds`
   to parent cell/group.
8. **API** — snapshot + SSE stream.
9. **diagrams/client Live Run mode** — snapshot render, SSE fold, layout.
