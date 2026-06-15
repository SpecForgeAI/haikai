"""Verification mechanism layer — the executable verifier substrate.

Design: haikai/specs/2026-05-20-async-verification-orchestration/ (D1-D11).
Judgement (gate fold, repair classification) is agentic and lives in
haikai-profiles/default/agents/; this package is the irreducible I/O:

- inline_runner       — run pinned commands (linters, tests) → verdict
- connectors.github_actions — trigger/poll GitHub Actions by head SHA
- connectors.gitlab_ci      — trigger/poll GitLab pipelines by head SHA

Verdicts use the spec vocabulary: pass | fail | pending.
"""
