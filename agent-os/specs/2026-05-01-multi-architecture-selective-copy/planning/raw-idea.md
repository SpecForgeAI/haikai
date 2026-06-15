# Raw Idea: Multi-Architecture Selective Copy

**Spec #:** 7 of 7 (final spec in the multi-architecture-variants initiative)
**Date captured:** 2026-05-01
**Initiative design note:** `agent-os/design-notes/multi-architecture-variants.md`

---

## Predecessors (all shipped)

- Spec #1: `agent-os/specs/2026-05-01-multi-architecture-plumbing/` — plumbing (60 architecture-scoped tables documented in changeset 089).
- Spec #2: `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/` — URL routing + selector.
- Spec #3: `agent-os/specs/2026-05-02-multi-architecture-crud-and-tags/` — CRUD + tags + `ManageArchitecturesModal`.
- Spec #4: `agent-os/specs/2026-05-01-multi-architecture-discovery-integration/` — Discovery integration.
- Spec #5: `agent-os/specs/2026-05-01-multi-architecture-save-target-resolution/` — LLM persona save-target.
- Spec #6: `agent-os/specs/2026-05-01-multi-architecture-full-clone/` — full clone. `ArchitectureCloneService` uses generic JdbcTemplate + DatabaseMetaData per-table cloning with UUID-old-to-new FK rewiring; that pattern is directly reusable for selective copy.

---

## Description

This spec implements **selective cross-architecture copy**: user picks specific entities / relationships / diagrams from a source architecture and copies them into a target architecture (typically the currently active one).

### Locked decisions from the design note

- **Per-element interactive conflict resolution** with upfront summary screen showing total conflict count. Few → resolve inline; many → cancel and rethink.
- **Element ids are globally-unique UUIDs** (per spec #1's design rule) — same UUID in source and target = clear conflict (means the element was previously copied or somehow ended up in both).
- **Conflict resolution actions**: skip / overwrite / duplicate-with-new-id (V1 covers all three).

---

## Scope

### 1. Backend — two-phase API

- **Preflight endpoint**: `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/preflight`
  - Body: `{ sourceArchitectureId, elementIds: [...] }`
  - Returns: conflict report — per-element `{ elementId, type, hasConflict, conflictType (same-uuid in target / FK-source-not-in-target / etc.) }`

- **Commit endpoint**: `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/commit`
  - Body: `{ sourceArchitectureId, elementIds: [...], resolutions: [{ elementId, action: 'skip' | 'overwrite' | 'duplicate' }] }`
  - Atomic `@Transactional` boundary.
  - Returns: summary `{ copied, skipped, overwritten, duplicated }`

### 2. Backend service

New `ArchitectureSelectiveCopyService`. Reuses spec #6's UUID-old-to-new map pattern + per-table generic cloning, but operating on a filtered subset.

### 3. Gateway proxy

Proxy routes for both preflight and commit endpoints.

### 4. Frontend API client

`selectiveCopyPreflight` and `selectiveCopyCommit` functions in `architecturesApi.ts`.

### 5. Frontend UI — multi-step wizard / modal flow

1. Pick source architecture (excluding target + archived).
2. Browse source's elements and tick which to copy.
3. Pre-flight conflict summary (counts + per-element list).
4. Per-conflict resolution (skip / overwrite / duplicate per element).
5. Commit + show summary toast.

Detailed UX shape to be decided during shaping.

### 6. Cascading auto-selection

If user picks a relationship, do source/target entities auto-include? If user picks a diagram, do nodes auto-include? To be decided during shaping.

---

## Out of Scope (deferred indefinitely)

- Comparison UI between architectures.
- Unarchive UI.
- Cross-project copy.

---

## Key Constraints

- **Atomic** — commit is all-or-nothing transaction.
- **Element ids are UUIDs** — same UUID match = conflict.
- **Refuse archived source architectures** (consistent with spec #6).
- **Threads + Discovery runs NOT copyable** (consistent with spec #6).
- **Reference integrity** — if user picks a relationship without its referenced entity, decision needed (auto-include? require it? or refuse-with-error?). To be answered during shaping.
- **No Liquibase schema changes needed.**
