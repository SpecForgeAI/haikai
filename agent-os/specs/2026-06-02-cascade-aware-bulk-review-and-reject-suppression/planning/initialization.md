# Initialization — Cascade-aware Bulk Review + Reject Suppression (Spec 2)

This spec's raw idea is captured in `raw-idea.md` (read that first). This file
exists to satisfy the requirements-research workflow's "initial idea" step; the
authoritative description is `raw-idea.md`.

**One-line:** Spec 2 of the discovery-review-unification program (F → 0 → 1 → 2 → 3).
Build the deterministic (no-LLM) cascade-aware bulk Approve/Reject/Defer/Save layer
over a candidate selection + their linked findings, with a preview→confirm step
rendered from Spec 1's already-computed blast-radius, AND make "reject" mean
EXCLUDED from every downstream consumer (target-state building + book-of-work /
spec generation), not merely hidden in the grid.

See `requirements.md` (written after the Q&A) for the full grounded findings and
the resolved decisions.
