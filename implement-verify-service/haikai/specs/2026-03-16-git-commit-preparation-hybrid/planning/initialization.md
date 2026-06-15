# Initialization

**Spec:** 2026-03-16-git-commit-preparation-hybrid
**Date:** 2026-03-16
**Source:** User request + prior spec (2026-03-15-git-commit-preparation)

## Raw Idea

Hybrid approach to git commit preparation:

1. **Deterministic layer** (`prepare_for_commit()` in GitManager) — always runs inside `commit_all()` as a safety net: removes stale index.lock, ensures .gitignore has critical patterns, unstages newly-ignored files, increases git add timeout.

2. **Intelligent layer** (`/git-commit-preparation` Claude skill) — invoked by the agent after `/implement-tasks` completes and before git commit. Claude reasons about the project's language/framework, writes a tailored .gitignore, cleans up test artifacts, build output, and anything else it recognizes shouldn't be committed.

3. **Orchestrator integration** — add a new step (step 3.5) between implement-tasks and git commit in the Haikai workflow, or update the implement-tasks skill to include this as a final phase.

## Prior Work

- `haikai/specs/2026-03-15-git-commit-preparation/spec.md` — deterministic-only spec (fully designed, not yet implemented)
- `specs/git-integration/spec.md` — full git integration design (implemented)
- `src/git/git_manager.py` — existing GitManager (no `prepare_for_commit()` yet)
