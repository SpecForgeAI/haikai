# Specification: Multi-Repo Product Orchestration

**Status:** DISCOVERY — decision points captured; nothing committed for implementation yet.
**Drives:** pending backlog tasks #90 ("Spec: cross-repo groups + Contract Registry") and #91 ("Spec: api_impact + route_map").
**Author:** captured from a conversation on 2026-05-24 between the user and Claude. This spec records the framing + the 5 design forks + the user's stated requirements. It is NOT yet an implementation spec — it's the document that precedes one, so the implementation spec can be reviewed against a written decision history.

---

## Summary

The current system is structured around a single `(company, project)` identity that maps 1:1 to one cloned git repository. Every endpoint, workspace path, spec folder, orchestration run, and git operation assumes "one project = one repo."

The user has a concrete need that breaks this assumption: **products composed of multiple repositories** (e.g. a frontend repo + a backend repo + an API-gateway repo that together implement one logical product). The specific pain to solve first is:

> **One spec → N coordinated changes across N repos.**

Example: a spec like "add an Orders API endpoint" should drive (a) a backend change adding the route + handler, (b) a frontend change adding the consumer, and (c) potentially an API-gateway change routing the new path — produced as 3 coordinated PRs, not one.

This is materially harder than scaling up the existing single-repo flow ("just init each repo separately") because the work in each repo is *coupled* — the frontend can't compile until the backend defines the schema; the gateway can't route until the backend declares the endpoint.

## Scope decisions captured in framing conversation

| Question asked | User's answer |
|---|---|
| What shape of non-monorepo project? | **Multi-repo, one logical product** (vs polyrepo fleet / multi-package monorepo / unrelated projects) |
| Which pain to solve first? | **One spec → N repos to change** (vs contract-impact analysis / cross-repo standards / shape-spec with broader context) |

The other shapes (polyrepo fleet, multi-package monorepo) and the other pains (impact analysis, cross-repo standards) are explicitly **deferred**.

## The 5 design forks

For each: the question, the proposed pick, and the tradeoff. Marked **PROPOSED** — none are committed until the user reviews this doc and signs off (or pushes back).

### Fork 1 — Where does a cross-repo spec live?

**PROPOSED:** a dedicated "product" repo. Either one of the N repos is designated as the primary spec-holder, OR a thin meta-repo exists that contains only `haikai/specs/` + product-level context (mission / roadmap / tech-stack). Specs are committed there; code changes get committed in the affected repos. Each per-repo PR references the spec by its meta-repo location.

**Rejected alternatives:**
- *Replicate the spec into each affected repo and keep them in sync* — git-conflict hell; the spec gets edited concurrently as different PRs land.
- *Workspace-only, never committed anywhere* — loses traceability; the spec disappears when the workspace gets cleaned.
- *Implicit "discover the spec via the first PR's description"* — fragile, doesn't survive repo deletions, no canonical answer to "where is the spec for X?"

**Tradeoff:** the meta-repo approach is cleanest but adds one more repo to maintain. The "primary repo" approach reuses an existing repo but creates ambiguity ("which repo is primary?") and couples the spec lifetime to the primary repo's lifetime.

### Fork 2 — How does a task know which repo it lands in?

**PROPOSED:** explicit annotation in `tasks.md`, either header tag (`## Task Group 1: Backend [@repo:backend]`) or YAML frontmatter on the group:

```markdown
## Task Group 1: Backend changes
> repo: backend
> depends-on: []

- [ ] Add Orders model
- [ ] Add POST /orders endpoint
```

The shape-spec / create-tasks LLM must learn to emit this annotation.

**Rejected alternatives:**
- *Implicit by file path* (paths like `backend/api/orders.py`) — fragile when a task is "update the README" or when the same path exists in multiple repos.
- *Separate tasks.md per repo* — loses the "single coherent spec" view; harder to read dependencies across groups.

**Tradeoff:** annotation requires the create-tasks prompt to learn a new format; if the LLM forgets, the task is unroutable. Mitigation: orchestrator validates every task group has a `repo:` annotation, fails fast with a clear error.

### Fork 3 — Workspace layout?

**PROPOSED:** `API_WORKSPACE_DIR/{company}/{product}/{repo_alias}/` per cloned repo, plus `{company}/{product}/haikai/` for product-level specs that don't live in any single repo.

Today's `(company, project)` becomes:
- `(company, product, repo_alias)` for repo-scoped operations (e.g. "discover endpoints in the backend repo")
- `(company, product)` for product-scoped operations (e.g. "list all specs for the Orders product")

**This is a breaking change** to the existing endpoint surface unless we layer a V3 surface alongside V2.

**Rejected alternatives:**
- *Reuse `project` as a synonym for "product with N=1 repos"* — backwards-compatible but creates ambiguity ("is `project` a repo or a product?"); the LLM authoring specs will get confused; the term means different things to different callers.

**Tradeoff:** clean separation now costs API surface churn (every signature with `project: str` either gets a sibling `repo: str` param or migrates to a `ProjectRef`-like object); deferred clarity costs years of "wait, in this context project means..." confusion.

### Fork 4 — Orchestration: parallel or sequential per-repo?

**PROPOSED:** sequential, topologically ordered by declared `depends-on` between task groups. The tasks.md annotation grows a dependency edge:

```markdown
## Task Group 2: Frontend changes
> repo: frontend
> depends-on: [Task Group 1]

- [ ] Add OrderForm component
- [ ] Wire to backend /orders endpoint
```

The orchestrator runs Task Group 1 (backend) to completion, then Task Group 2 (frontend) — the frontend LLM sees the backend's new code on disk via the locally-cloned backend repo. No dependency cycles allowed (validated at create-tasks time).

**Rejected alternatives:**
- *Parallel per-repo* — faster, but the frontend LLM can't see the backend's new schema because it hasn't been written yet. Forces the spec author to inline the schema in the prompt, doubling work and risking drift.
- *Single shared workspace where all repos co-exist, all changes happen in parallel* — same problem; worse because git operations interleave.

**Tradeoff:** sequential is slower (wall time = sum of per-group times, not max). Worth it for the implementing-with-real-context property. A future optimization: groups with no shared dependencies CAN run in parallel — defer until perf matters.

### Fork 5 — Git ops: one PR or N coordinated PRs?

**PROPOSED:** N independent PRs, one per affected repo, linked in their descriptions with `Depends on owner/repo#N` cross-repo references. The human merges in dependency order (or uses a merge-queue bot if the org has one).

The existing `apply_git_workflow(gm, git_config, branch, commit_msg, pr_title, pr_body, response_obj=None)` helper (commit `9047a8d`) already takes a per-repo `GitManager` — N PRs is N calls. The PR body assembly adds the cross-repo `Depends on:` block based on the task-group dependency graph.

**Rejected alternatives:**
- *One mega-PR spanning multiple repos* — git doesn't support this; would require a third-party tool (atlantis, mergify cross-repo) the user doesn't have.
- *Atomic cross-repo merge via a queue bot* — real concern (e.g. merge backend before frontend deploys or you ship a broken frontend), but solving it day one is a separate problem (deploy coordination ≠ source-merge coordination). Defer to follow-up spec.

**Tradeoff:** N independent PRs means the human shoulders the "merge in the right order" responsibility. The PR-description linking makes it easy to see the order; not solving the atomic-merge problem keeps this spec tractable.

---

## What the user requested in the framing Q&A

Distilled from the AskUserQuestion answers:

1. **Project shape:** multi-repo, one logical product (NOT polyrepo fleet, NOT multi-package monorepo, NOT unrelated projects).
2. **Pain to solve first:** one spec → N coordinated PRs (NOT contract-impact ripple analysis, NOT cross-repo standards, NOT shape-spec with broader context).

Both of those answers reduce the scope of THIS spec. The other shapes / pains are tracked as follow-up specs:

- **Contract-impact analysis** → coupled to task #91 (`api_impact + route_map`). A registry of which repos consume/produce which contracts. Likely a *prerequisite* for fully automating task-group → repo annotation in Fork 2 (without it, the spec author or shape-spec LLM has to annotate manually).
- **Cross-repo standards** → a separate spec; out of scope.
- **Shape-spec with broader context** → a separate spec; out of scope.
- **Polyrepo fleet** → a separate spec; out of scope.

## Open decisions — what to lock down NEXT

Before this becomes an implementation spec, three things need a decision (in order):

1. **Identity model.** Is `product` a first-class concept on the API surface (new `(company, product, repo)` tuple, new endpoints, new workspace shape) — OR do we overload `project` to mean "product with N repos, N≥1" and accept the linguistic ambiguity? My instinct: first-class `product`, layered as a V3 endpoint surface alongside V2. The cost (signature churn) is paid once; the clarity benefit is permanent. **Needs user decision.**

2. **Spec location.** Meta-repo vs primary-repo (Fork 1). Cheap to decide; very hard to change later because every spec ever authored hard-codes the location. My instinct: thin meta-repo, even though it's one more repo. **Needs user decision.**

3. **Backwards-compat strategy.** Three options:
   - (a) **V3 alongside V2** — both work; V2 is the single-repo flow, V3 is the multi-repo flow. Incremental migration. (Recommended.)
   - (b) **Generalize V2** — make V2 work for N=1 and N>1; existing callers see no change. Cleanest end-state; biggest one-shot migration risk.
   - (c) **Separate worker service** — multi-repo orchestration lives in a different service entirely. Over-engineered for current scale.
   
   **Needs user decision.**

Once those three lock, the implementation spec can proceed: data model, endpoint shapes, workspace migrations, orchestrator changes, git_workflow generalization, tests.

## Pre-requisites and related work

- **Task #90 — Spec: cross-repo groups + Contract Registry.** The Contract Registry is partially a prerequisite for Fork 2 automation: without it, the shape-spec LLM must manually annotate `[@repo:X]` on every task group. With it, the orchestrator can derive the annotation from "this task touches the Orders API, which is owned by backend-repo." Implementation order: Contract Registry → multi-repo orchestrator → automatic annotation.
- **Task #91 — Spec: api_impact + route_map.** Strictly the "ripple analysis" pain (out of scope here) but shares the underlying Contract Registry data model.
- **`apply_git_workflow` helper** (`src/api/git_workflow.py`, commit `9047a8d`). Generalizes naturally to N invocations — one per affected repo. No changes needed to support multi-repo; just call it N times from the new orchestrator path.
- **`ProjectRef` value object** (`src/project_ref.py`, commit `c7db1f3`). Already exists in incremental-adoption form. Extension for multi-repo: add `RepoRef(product_ref: ProductRef, repo_alias: str)` alongside, or extend `ProjectRef` to carry an optional `repo_alias`. **Decision deferred to identity-model decision above.**
- **`require_credentials_or_503`** (`src/api/gates.py`). Unchanged; per-repo credentials still need the same gate.

## Non-goals (this spec)

- Cross-repo schema impact analysis (separate spec).
- Atomic cross-repo merge / deploy-train coordination (separate spec).
- Unified standards generation across N repos with per-repo overrides (separate spec).
- Polyrepo fleet management ("apply X to every repo in the org") (separate spec).
- Renaming `(company, project)` everywhere in the existing V2 surface (incremental, can wait).
- Solving the case where N=1 differently from N>1 (the multi-repo flow should reduce cleanly to single-repo when N=1).

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | LLM forgets the `[@repo:X]` annotation, task is unroutable. | Orchestrator validates every task group has a `repo:` annotation at create-tasks output time; fails fast with a clear error pointing at the offending group. |
| R2 | Topological cycle between task groups (frontend depends-on backend, backend depends-on frontend). | Validate the dependency graph at create-tasks output time; reject with a clear error listing the cycle. |
| R3 | Per-repo credentials/auth divergence (one repo uses GitHub, another uses Bitbucket within the same product). | The `GitProviderStrategy` introduced in commit `7bdf8f2` already supports per-repo provider selection — multi-repo just instantiates N `GitManager`s with N strategies. No new work. |
| R4 | The "meta-repo" decision creates a new repo that the user's org doesn't want. | Allow both modes (meta-repo OR designated primary repo) via a per-product config — but pick one as the *default* and document. |
| R5 | Backwards-compat strategy ambiguity confuses early adopters. | If V3 alongside V2, clearly mark V2 endpoints in OpenAPI as "single-repo only" and V3 as "multi-repo, also supports N=1." |
| R6 | The user's first multi-repo product has 5 repos; clone time + storage explodes. | Lazy clone — only clone a repo when a task group annotated `[@repo:X]` is about to run. Workspace cleanup tooling becomes important; track via a `scripts/clean-product-workspace.sh` follow-up. |

## What this spec is NOT

- Not a green-light to start coding. The 3 open decisions need to lock first.
- Not a final endpoint design. V3 surface is sketched, not specified.
- Not a migration plan for existing callers. That's part of the backwards-compat decision.
- Not the Contract Registry spec — that's task #90 and should be authored separately (it's a prerequisite, but a distinct concern).

## Next step

The user reviews the three open decisions (identity model, spec location, backwards-compat strategy). On each: pick + reasoning. Once locked, this discovery spec is closed out and a fresh implementation spec at `haikai/specs/YYYY-MM-DD-multi-repo-product-orchestration-impl/` is authored against the locked decisions.
