# Increment 13 of 16 — Candidate review and approval workflow (v1)

## Delivery context

This is increment **13 of 16** for the new **legacy / current-state discovery** capability.

Previous increments established:
- full discovery pipeline (Phase 0 + Phase 1a–1d),
- candidate generation,
- controlled save-back to canonical model,
- read-only visibility of discovery results.

This increment introduces the first **user-in-the-loop review workflow** for discovery candidates.

## Goal

Enable users to:
- review discovery candidates,
- approve, reject, or defer them,
- control what gets persisted into the canonical architecture model.

At the end of this increment:
- users can actively curate discovery outputs,
- save-back becomes user-governed rather than purely automatic.

## In scope

### 1. Candidate review states
Extend candidate model to support review states such as:
- pending_review
- approved
- rejected
- deferred

Ensure state transitions are explicit and traceable.

### 2. Review actions
Allow users to perform basic actions on candidates:
- approve candidate
- reject candidate
- defer candidate

These actions should:
- update candidate state
- be persisted
- be project- and run-scoped

### 3. Controlled save trigger
Modify save-back behavior so:
- only approved candidates are eligible for save-back,
- automatic save-back (from Increment 11) is either disabled or limited to high-confidence cases,
- users can trigger save-back after review.

### 4. UI integration (minimal but functional)
Extend existing visibility views to allow:
- selecting candidates
- performing review actions
- seeing current review status

This should be:
- simple and consistent with existing UI patterns,
- not a full-featured review system yet.

### 5. Backend support for review
Introduce backend endpoints to:
- update candidate review state
- retrieve candidates with review status
- trigger save-back for approved candidates

Ensure:
- idempotent behavior
- consistent project/run scoping

### 6. Audit and traceability
Track:
- who performed the review action (basic attribution)
- when it was performed
- previous state (lightweight history)

No need for full audit history yet — just basic traceability.

## Out of scope

Do **not** implement:
- bulk editing or advanced filtering UX
- editing candidate details (rename, retype, re-parent)
- multi-user collaboration/conflict resolution
- advanced approval workflows (multi-stage, role-based)
- deep evidence inspection UI
- log-based enrichment
- AST enrichment
- language/version-specific analyzer packs

## Required design constraints

### User control over canonical model
Users must have clear control over what enters the canonical architecture model.

### Simple, explicit workflow
Keep review flow simple:
- no hidden automation
- clear state transitions
- predictable outcomes

### Idempotent save behavior
Save-back must remain idempotent even when triggered after review.

### Separation of concerns
Maintain separation between:
- discovery candidates
- canonical architecture entities

### Minimal UI disruption
Integrate into existing views rather than introducing a completely new UI paradigm.

## Acceptance criteria

1. Candidates support review states: pending_review, approved, rejected, deferred.
2. Users can perform review actions (approve/reject/defer).
3. Review state is persisted and visible.
4. Save-back is gated by review state (approved candidates only).
5. Users can trigger save-back after reviewing candidates.
6. Backend endpoints exist for review actions and retrieval.
7. Basic audit information (who/when) is captured.
8. No advanced editing or workflow features are implemented yet.

## Notes for later increments

This increment enables:
- Increment 14: log-based discovery enrichment
- Increment 15: hypothesis-first discovery and Q&A
- deeper refinement and correction workflows

The implementation should prioritize:
- clarity of control,
- simplicity of workflow,
- and safe interaction with the canonical architecture model.
