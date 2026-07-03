# ADR 0001 — Inline verify verdicts are pinned to the bound SHA via detached worktrees

Date: 2026-07-03 · Status: accepted · Origin: grill of
`haikai/specs/2026-07-03-parallel-worktrees/spec.md` (Q1)

## Context

Inline (non-CI) verifiers execute pinned repo commands against whatever
the working tree at `cwd` currently holds — `inline_runner.py:81-135`
never inspects or positions branch/commit, and `run_verify_task_group`
(tasks.py:922-955) passes only correlation keys. The tree's state at
verify time is an accident of the previous orchestration: left on
`feature/<batch>` after batch runs (git_workflow.py:118 returns before
checkout-back), reset to DEFAULT after single-spec runs (tasks.py:406).
**Single-spec inline verdicts therefore already score the wrong tree
today.** The parallel-worktrees spec's W1 (jobs never mutate the live
checkout; it stays on default) would turn this from incidentally wrong
into always wrong. No table records a branch; the only durable anchor is
`ci_bindings.head_sha` (store.py:49-58).

## Decision

Each verify job allocates a READ-ONLY detached worktree at the cell's
bound SHA (`git worktree add --detach <verify_root> <head_sha>`, the
`consolidate_and_deploy` pattern) and runs the verify session with cwd
inside it; the worktree is reclaimed after the session under the same
lifecycle ladder and lock as run worktrees. Cells with no CI binding have
no pinned commit: they run against the live checkout as before, and that
fact is recorded as evidence — visible, never silent.

## Consequences

- Inline verdicts become deterministic functions of the commit under
  test. Verdicts that previously (wrongly) passed by scoring the default
  branch may now fail — this is the fix working, not a regression.
- Verify jobs gain a small allocation cost (checkout-only; shared object
  store) and participate in worktree reclamation/sweeping.
- The verification DB still stores no branch names; SHA remains the only
  ref anchor by design.

## Alternatives rejected

- **Defer / document as known bug** — leaves inline verdicts meaningless
  under W1.
- **Position the live tree per verify job** — violates W1 and reintroduces
  the tree contention this spec exists to remove.
