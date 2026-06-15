# Increment 12 of 16 — Discovery results visibility (read-only) in Dashboard + Meta-Model

## Delivery context

This is increment **12 of 16** for the new **legacy / current-state discovery** capability.

Previous increments established:
- full Phase 1 pipeline (1a–1d),
- candidate generation,
- controlled save-back into the canonical architecture model.

This increment introduces **read-only visibility** of discovery outputs so users can:
- understand what was discovered,
- inspect candidates and saved entities,
- build trust in the system before refinement workflows are added.

## Goal

Expose discovery results in a **read-only manner** across:
- Dashboard (high-level summary)
- Meta-Model view (entity-level visibility)

At the end of this increment:
- users can see discovery runs, their status, and outputs,
- users can inspect candidates and saved entities,
- no editing or approval actions are available yet.

## In scope

### 1. Discovery run visibility (Dashboard)
Extend the Dashboard to show:

- existence of discovery runs for a project
- latest run status (e.g. running, complete, failed)
- high-level metrics such as:
  - number of candidates generated
  - number of entities saved
  - coverage indicators (basic counts only)

This should align with the existing Dashboard structure and sections.

### 2. Candidate visibility (read-only)
Expose discovery candidates so users can:
- view candidate type, name, and confidence
- see supporting evidence references (at a high level)
- understand whether a candidate was:
  - saved
  - skipped
  - marked for review

This can be:
- a dedicated view,
- or an extension of existing Meta-Model/inspection views,
consistent with current frontend patterns.

### 3. Saved entity traceability
Allow users to see, for saved entities:
- that they originated from discovery
- which discovery run they came from
- basic linkage back to the originating candidate

Do not expose deep evidence internals yet.

### 4. Basic discovery run detail view
Provide a way to:
- select a discovery run
- view its summary:
  - Phase progression (1a–1d)
  - counts of atoms, clusters, candidates
  - completion status

This should remain high-level and informational.

### 5. Backend read endpoints
Expose read-only endpoints via gateway/backend for:
- discovery runs
- candidates
- candidate → entity mappings
- summary metrics

These endpoints should:
- be project-scoped
- not expose internal-only structures unnecessarily

## Out of scope

Do **not** implement:
- editing or approving candidates
- manual correction of entities
- re-running discovery from UI
- deep evidence graph visualization (atoms/relationships/clusters)
- DecisionTask inspection UI
- log-based enrichment
- AST enrichment
- language/version-specific analyzer packs

## Required design constraints

### Read-only only
All discovery outputs must be non-editable in this increment.

### No new mental model for users
Integrate visibility into existing Dashboard and Meta-Model paradigms rather than introducing entirely new concepts.

### Traceability, not overload
Expose enough information to build trust (origin, confidence, linkage), but avoid overwhelming users with low-level evidence details.

### Project-scoped
All visibility must be scoped to the selected project.

### Consistent API patterns
Backend endpoints must align with existing gateway/API design patterns.

## Acceptance criteria

1. Dashboard shows existence and status of discovery runs.
2. Users can see high-level metrics for a discovery run.
3. Discovery candidates are visible in a read-only form.
4. Saved entities can be identified as originating from discovery.
5. Users can inspect a discovery run summary (phases, counts, status).
6. Backend provides read endpoints for runs, candidates, and mappings.
7. No editing, approval, or re-run functionality is present.

## Notes for later increments

This increment enables:
- Increment 13: review and approval workflows for candidates
- deeper inspection and refinement capabilities
- eventual integration of logs and Q&A-derived insights

The implementation should prioritize:
- clarity and trust,
- minimal UI disruption,
- and clean separation between discovery outputs and canonical model editing.
