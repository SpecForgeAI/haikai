# Polyrepo orchestration — end-to-end, real git + real haibox

Self-contained e2e proving the polyrepo axis of orchestration (the multispec
e2e covers N specs into ONE repo; this covers a polyrepo product — N sibling
repos under a `coordination.yaml` product root). `e2e_polyrepo.py`, 21/21,
`POLYREPO_OK`. Builds its own throwaway repos under a temp product root; owns
the haiboxd lifecycle (always shut down in a finally).

## What's REAL

git, `_resolve_repo_targets`, `_git_one_spec` (run_workflow's per-spec callback),
`consolidate_and_deploy`, and the haibox deploy are all real. Only the LLM
implement-tasks leg is stood in for — a per-spec `feat_<stem>.txt` represents
that spec's generated code in each repo. Each repo's `app.py` serves the sorted
list of `feat_*.txt` it finds, so the LIVE HTTP body is exactly the set of specs
that landed in the deployed (merged) artifact.

## The three phases

1. **Topology** — `_resolve_repo_targets(product_root)` returns one
   `(folder, repo_dir)` per repo in `coordination.yaml` (the polyrepo branch of
   the resolver; legacy single-repo would return `folder=None`).
2. **Git matrix** — 2 specs × 2 repos, interleaved per spec through the real
   `_git_one_spec` → **4** per-(spec,repo) branches `feature/<spec>--<folder>`,
   none collapsed (C1/L3), each carrying ONLY its spec's file (B2 isolation),
   live trees back on main + clean after each spec.
3. **N services** — each repo consolidated (both its spec branches merged in an
   isolated worktree, L1-reclaimed) + deployed on its OWN haibox box → two
   distinct live base_urls, each serving its repo's MERGED specs
   (`backend:health,metrics` / `frontend:health,metrics`). This is the
   polyrepo product = N independently-served boxes — the same per-box model the
   remote-ssh backend routes per host.

## Known Phase-2 boundary (honest, already logged in code)

The production single-call deploy path `_maybe_deploy_orchestration`
(`src/job_queue/tasks.py`) deploys only the **first** repo target and logs the
rest as Phase-2 (`"Multi-box polyrepo deploy is Phase-2"`). This e2e deploys
EACH repo directly via `consolidate_and_deploy` to show the building block
already serves all N — so the gap is orchestration wiring (loop the deploy over
all targets + return N box records), not a backend limitation. Closing it is a
small, well-scoped follow-up.
