# Spec: Multi-Repo Product Support

**Status:** PROPOSED  
**Date:** 2026-05-26  
**Branch:** spec/multi-repo-product-orchestration

---

## Problem

The system currently assumes one project equals one repository. Real-world products frequently span multiple independent repositories — a frontend, a backend, a shared library, a gateway. When a spec is run against such a product, the system has no way to coordinate changes across those repos, route generated code to the right place, or produce the correct number of pull requests.

---

## Goal

Enable a single spec run to produce coordinated, correctly-placed changes across N repositories belonging to the same product, without requiring a separate mode, a separate pipeline, or human intervention between pipeline steps.

---

## Core Design Decision

**A mono-repo is the degenerate case of a multi-repo product where N = 1.**

There is no mono mode and poly mode. There is one mode. The system iterates over a list of repo mappings. When the list has one entry, the behaviour is identical to today. When the list has N entries, the same iteration produces N workspaces, N git operations, and N pull requests. No branching in the system logic.

---

## Repo Mapping

At project initialisation, the user declares the product's repository topology as a key-value map:

- **Key:** folder name — a short alias that becomes the sub-directory name on disk (e.g. `backend`, `frontend`, `shared`)
- **Value:** git remote URL — the repository the folder maps to

### Constraints

Both keys and values must be unique within a project:

- **Folder name uniqueness** — two folders with the same name would collide on disk.
- **Repo URL uniqueness** — two entries pointing at the same remote would produce duplicate operations against the same repository, leading to undefined behaviour at commit time.

### Mutability

The mapping is not fixed at init time. It is mutable via CRUD operations after the project is created:

| Operation | Behaviour |
|---|---|
| Add entry | Registers a new folder → repo pair. Both uniqueness constraints are checked before the entry is accepted. |
| Update entry | Changes the repo URL for an existing folder name. The folder name itself is the stable identifier and cannot be changed via update. |
| Remove entry | Removes a folder → repo pair. The last entry cannot be removed — a project must always have at least one repo. |
| List entries | Returns the current mapping in full. |

Every mutation is reflected immediately in the product's coordination file and takes effect on the next pipeline run.

---

## Product Workspace Layout

The workspace is structured as a product root containing one sub-directory per repo entry:

```
workspace/
  {company}/
    {project}/               ← product root
      coordination.yaml      ← the persisted mapping
      {folder-1}/            ← cloned repo 1
      {folder-2}/            ← cloned repo 2
      {folder-N}/            ← cloned repo N
```

For a mono-repo project, the product root contains exactly one sub-directory. The layout is identical — there is simply one entry instead of N.

---

## coordination.yaml

`coordination.yaml` is the system's persisted copy of the repo mapping. It lives at the product root and is written by the system at init time and updated on every CRUD mutation.

It is the single source of truth the pipeline uses to determine:
- Which repos belong to this product
- What folder alias each repo is known by
- How many git operations to perform at commit time

It is human-readable and version-controllable. It contains no generated content, no inferred metadata, and no dependency declarations — only the folder → repo URL pairs the user declared.

---

## Pipeline Behaviour

The pipeline — shape-spec, write-spec, create-tasks, implement-tasks — runs the same way for mono and poly. The difference is in scope and fan-out:

**Scope (shape-spec, write-spec)**  
The LLM session is mounted at the product root and has visibility across all repo sub-directories simultaneously. For mono, it sees one repo. For poly, it sees N repos. The session configuration scales with the mapping; the pipeline steps themselves do not change.

**Task annotation (create-tasks)**  
For poly, each task group carries a repo annotation identifying which folder the tasks in that group belong to. Cross-repo dependencies between task groups are declared explicitly. This annotation is what allows the implement step to route work to the correct repo without user intervention.

**Commit fan-out (implement-tasks)**  
For each repo that has tasks, one feature branch is created, one commit is made, and one pull request is opened. For mono, this produces one PR. For poly, it produces one PR per repo that was touched by the spec. Repos with no tasks in a given spec run are not touched.

---

## Behaviour at the Boundaries

**What happens when a repo is unreachable at init time**  
The entire init is rejected. No workspace is created, no coordination file is written. The user must resolve the access issue and retry.

**What happens when a repo mapping is updated mid-run**  
The pipeline run in progress uses the mapping that was active when it started. The updated mapping takes effect on the next run.

**What happens when a spec touches only some repos**  
Only the repos with tasks in that spec run receive a PR. Repos with no tasks are not cloned, not branched, and not touched.

**What happens when a task group has no repo annotation (poly only)**  
The pipeline rejects the task list and reports which groups are missing annotations. The run does not proceed to implement-tasks until all groups are annotated.

---

## What This Spec Does Not Cover

The following are explicitly out of scope and deferred to follow-up specs:

- Cross-repo standards enforcement (applying the same standards rules across all repos in a product)
- Contract-impact analysis (detecting when a change in one repo breaks a contract consumed by another)
- Atomic cross-repo merges (merging all N PRs as a single coordinated operation)
- Per-repo standards overlays (different standards rules for different repos in the same product)
- Fleet management (managing a large number of repos that are not part of a single product)

---

## Open Questions

1. **Role field** — Should each repo entry carry an optional `role` field (e.g. `api`, `web`, `lib`) to help the LLM reason about what kind of code belongs where, or is the folder name alias sufficient?

2. **Folder rename** — Should the folder name (alias) be updatable after init, or is it a permanent identifier? Renaming would require moving the cloned directory on disk and updating all task annotations that reference the old alias.

3. **Partial failure at commit time** — If implement-tasks successfully commits to 2 of 3 repos and then fails on the third, what is the recovery path? Should the two successful PRs be left open, rolled back, or flagged for manual resolution?
