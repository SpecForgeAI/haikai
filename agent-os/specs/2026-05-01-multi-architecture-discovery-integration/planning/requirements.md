# Spec #4 Requirements — Discovery Service `architectureId` Integration

**Spec folder:** `agent-os/specs/2026-05-01-multi-architecture-discovery-integration/`
**Design note:** `agent-os/design-notes/multi-architecture-variants.md`
**Predecessors (shipped):**
- Spec #1 — `agent-os/specs/2026-05-01-multi-architecture-plumbing/` (data model, Bucket A endpoints; Group 5 of spec #1 already updated three entity-fetch helpers in `discovery-service/src/services/archModelClient.ts` to take `architectureId` via a per-run cached resolver — this spec replaces that silent default with the user's explicit choice).
- Spec #2 — `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/` (URL routing, selector pill).
- Spec #3 — `agent-os/specs/2026-05-02-multi-architecture-crud-and-tags/` (CRUD UI + tag management).
**Raw idea:** `planning/raw-idea.md`

---

## Context

The user picks the target architecture at run start; that `architectureId` is bound to the discovery run for its entire lifetime and propagates through every Discovery endpoint and every save-back to architecture-model-service.

**Locked design-note rule:** strictly **one run → one architecture**. No mid-flight re-targeting, no cross-architecture replay, no multi-architecture writes from a single run.

**Hard constraints:**
- `tsx watch` auto-reloads kill in-flight discovery runs — implementer must check no run is active before editing `discovery-service/src/**` (project memory feedback).
- Never edit applied Liquibase changesets — always add new ones (project memory feedback).
- Must not regress spec #1's three already-updated entity-fetch helpers (this spec extends, doesn't replace).
- Pre-existing discovery runs (created before this spec) are silently backfilled to each project's `Default` architecture — no migration banner, no special UI tag.

---

## Resolved Product/UX Decisions

### 1. Architecture pick at run-start UI — **always show explicit picker**

The "Start Discovery Run" dialog (`StartDiscoveryRunConfirmModal.tsx`) **always** shows an architecture picker, even when the project has only one non-archived architecture. The picker is pre-filled with the URL's active architecture (from `useActiveArchitectureId()`).

Rationale: explicit choice every time eliminates the "I didn't realise that's where my run was going" failure mode. It's one extra eye-flick at run start; the always-explicit pattern is worth the friction.

UI shape: a `<select>` (or styled equivalent) listing all **non-archived** architectures for the project, oldest first (matching the spec #1 ordering rule). Label: `Target architecture`. Beneath the select, a one-line confirmation: `Run will be locked to this architecture for its entire lifetime.`

### 2. Run list scoping — **filter by URL active architecture**

When the user is at `/projects/X/architectures/A/...`, the discovery run list shows **only runs whose bound `architectureId` matches A**. Runs targeting other architectures are hidden until the user switches via the selector.

Rationale: matches the rest of the URL-driven UI (each architecture is a parallel workspace per spec #2's "stay-on-view" behaviour). A user investigating architecture A's discovery state shouldn't see runs from architecture B cluttering the list.

Backend filter: discovery list endpoints add `architectureId` to the `WHERE` clause. Frontend reads from URL via `useActiveArchitectureId()` and passes it.

### 3. Architecture display on discovery — **detail page only**

The bound architecture is **not shown on run-list rows** (the list is already implicitly filtered per Q2 — showing it would be redundant noise). On the **run detail page**, a chip/label appears in the run header: `Architecture: <name>`.

Reuse the existing chip styling from `ArchitectureSelector.tsx`'s pill (or a read-only variant of it).

### 4. Pre-existing runs (no `architectureId`) — **silent backfill**

A new Liquibase changeset adds a nullable `architecture_id` column to `discovery_runs`, then backfills it for every existing row using each project's `Default` architecture (the architecture whose id equals the project's id, per spec #1's deterministic-Default rule), then enforces NOT NULL + FK.

**No banner, no "legacy" tag, no per-run notice.** From the user's perspective, the historical runs have always belonged to the project's Default architecture.

Rationale: most projects have only the auto-created Default at this point; backfilling silently is a clean upgrade. Surfacing it would create noise for zero user benefit.

### 5. Save-back to architecture-model-service — **explicit confirmation**

When a Discovery run promotes candidates / relationships into the canonical model, a **save-back confirmation modal** is shown listing what will be promoted and the target architecture by name. The user must confirm before the writes happen.

Rationale: even though the architecture is locked at run start, save-back is the destructive step that mutates the canonical model. A short confirm modal ("**Save 23 candidates and 11 relationships to architecture 'Target State'?**" with Confirm / Cancel) is cheap insurance against an architect promoting against the wrong architecture.

The modal title and content reuse the pattern of `ArchiveArchitectureConfirmModal.tsx` from spec #3.

### 6. Out of scope — **nothing additional excluded**

The user confirmed no additional explicit out-of-scope additions. The implicit rule from the design note remains: one run → one architecture for life. No cross-architecture replay, no re-target mid-flight, no multi-architecture writes.

---

## Decisions Made Inline (technical — no user input needed)

| # | Decision | Rationale |
|---|---|---|
| 7 | **URL shape:** all discovery endpoints become `/api/projects/{projectId}/architectures/{architectureId}/discovery/...` (path-segment, mirrors spec #2's frontend mirror-backend pattern and spec #1's Bucket A convention). Hard cutover — no back-compat. | Consistency with the rest of the app; forgetting `architectureId` 404s. |
| 8 | **Liquibase changesets** (next sequential after 092): `093-add-architecture-id-to-discovery-runs.sql` (nullable column), `094-backfill-discovery-runs-architecture-id.sql` (`UPDATE discovery_runs SET architecture_id = project_id` — exploits spec #1's Default-id-equals-project-id convention), `095-discovery-runs-architecture-id-not-null-fk.sql` (NOT NULL + FK + composite `(project_id, architecture_id)` index). Same multi-step pattern as changesets 087-091 and 020-024. | Matches established backfill pattern; idempotent. |
| 9 | **`architecture_id` column added ONLY to `discovery_runs`.** Children (`discovery_evidence`, `discovery_relationships`, `discovery_clusters`, `discovery_candidates`, `discovery_decision_tasks`) inherit through their `run_id` FK. Backend list endpoints JOIN to `discovery_runs` for the architecture filter where needed. | Single source of truth; no risk of children drifting to a different architecture from their parent run. |
| 10 | **Backend controllers updated** (Discovery_*Controller in architecture-model-service): every endpoint adds `{architectureId}` path variable, services and repositories accept and filter by it (where the entity has `run_id`, the filter is `WHERE run_id IN (SELECT id FROM discovery_runs WHERE project_id = ? AND architecture_id = ?)`). | Matches spec #1's Bucket A refactor pattern. |
| 11 | **discovery-service backend:** every route in `discovery-service/src/routes/runs.ts` (and any sibling route files) accepts `:architectureId` path segment. The `runManager` stores `architectureId` per-run; `archModelClient.ts` per-run resolver from spec #1 is **replaced** by reading the run's stored `architectureId`. The cached `resolveDefaultArchitectureId` helper from spec #1 stays as a fallback ONLY for code paths that operate without a run context (TBD whether any remain — likely zero after this spec). | Single binding point; explicit beats inferred. |
| 12 | **Gateway proxy routes** for discovery endpoints embed `:architectureId`. Same shape as Bucket A proxies in `gateway/src/routes/architectures.ts` (or wherever discovery proxies live currently). | Consistency. |
| 13 | **Frontend API client** functions for discovery accept `architectureId` and embed it in the URL. Call sites read from `useActiveArchitectureId()` (spec #2) when listing or interacting with runs in-context. The run-start flow uses the user's pick from the picker, NOT the URL active id (the user may pick a different architecture from the picker than the one they're viewing). | Matches spec #2's no-silent-default rule. |
| 14 | **LLM persona system prompts** for Discovery-triggered conversations include the line `Architecture: <name> (id: <architectureId>)`. The persona definition for Discovery is updated to declare it operates in **bound-by-system-prompt** mode (per the design note's "save-target resolution" section). The `architectureId` is injected at conversation start by the discovery-service code that opens the LLM thread. | Honours the design note's locked decision. |
| 15 | **Architecture picker component:** new component `frontend/src/components/Discovery/ArchitectureRunTargetPicker.tsx` (or co-located with the existing discovery modal). Lists `architectures.filter(a => !a.archived)` from `useArchitectureContext()`, oldest first. Pre-selected from `useActiveArchitectureId()`. Disabled if exactly one architecture exists (just shown for confirmation, no choice to make). | Reuses spec #1/#2/#3 wiring. |
| 16 | **Save-back confirmation modal:** `frontend/src/components/Discovery/SaveBackConfirmModal.tsx`. Pattern matches `ArchiveArchitectureConfirmModal.tsx` (spec #3). Body shows the count of items being promoted (candidates, relationships) and the architecture name. Confirm button label: `Save to <name>`. Cancel + Esc available; Confirm disabled while in flight. | Reuses spec #3 modal pattern. |
| 17 | **Backfill safety:** the spec #1 deterministic Default rule (`architecture.id = project.id`) means the backfill `UPDATE discovery_runs SET architecture_id = project_id` is correct as long as every project's Default architecture row exists (created by spec #1 changeset 088). Verify in changeset 094 with a precondition assertion. | Avoid silent data corruption. |
| 18 | **Test strategy:** backend integration test for the Liquibase backfill (zero-data-loss for existing discovery runs). Backend controller tests for the path-segment 404 safety (Bucket A pattern). Gateway proxy round-trip tests. Frontend tests for: picker pre-fills active arch; picker selection drives run-start payload; run list filters by URL; save-back confirm modal renders with correct counts and architecture name. | Standard. |
| 19 | **Spec #1's per-run cached `resolveDefaultArchitectureId` helper:** kept available for the rare paths that lack run context (likely none after this spec). Existing tests for the helper stay green. | Non-regression. |
| 20 | **No data migration for the LLM thread storage** — Discovery-triggered LLM threads are project-scoped per spec #1's locked thread-scope decision. The system prompt change is forward-only (existing threads keep their original prompts; new threads get the updated one). | Threads stay project-scoped. |

---

## Out of Scope (deferred)

- **LLM persona save-target resolution for non-Discovery contexts** → spec #5 (this spec only handles Discovery's bound-mode injection; clarify-at-save mode for other personas is spec #5).
- **Full clone** (duplicate architecture A into new B) → spec #6.
- **Selective cross-architecture copy** → spec #7.
- **Comparison** and **unarchive UI** → deferred indefinitely.
- **Per-architecture access control** — not in V1.
- **Cross-architecture run replay / re-target mid-flight / multi-architecture writes from a single run** — locked out by design.
- **Surfacing pre-existing runs as "legacy"** — silent backfill instead (decision #4).

---

## Critical Files (anticipated)

**Backend (`architecture-model-service`):**
- `src/main/resources/db/changelog/sql/093-add-architecture-id-to-discovery-runs.sql` (new).
- `src/main/resources/db/changelog/sql/094-backfill-discovery-runs-architecture-id.sql` (new).
- `src/main/resources/db/changelog/sql/095-discovery-runs-architecture-id-not-null-fk.sql` (new).
- `db.changelog-master.yaml` (modify — register new changesets).
- All `Discovery*Controller.java` files (modify — add `{architectureId}` path variable, propagate to service/repository).
- `DiscoveryRunEntity.java` (modify — add `architectureId UUID` field).
- All Discovery service / repository classes (modify — accept and filter by `architectureId` where listing; child entities filter via JOIN to `discovery_runs`).

**discovery-service:**
- `discovery-service/src/services/archModelClient.ts` (modify — replace per-run cached resolver use with the run's stored `architectureId`; keep helper for any non-run paths; updated three entity-fetch helpers from spec #1 stay green).
- `discovery-service/src/services/runManager.ts` (modify — store `architectureId` on each run; thread it into all entity-fetch + save-back calls).
- `discovery-service/src/routes/runs.ts` (modify — accept `:architectureId` path segment; pass through to runManager).
- `discovery-service/src/routes/*.ts` (any sibling route files — same change).
- LLM persona definition for Discovery (path TBD — search `discovery-service/src/personas/` or similar) (modify — add `Architecture: <name> (id: <id>)` to the system prompt).
- `discovery-service/src/__tests__/*.ts` (new + modify — picker selection drives run-start payload; per-run architectureId persistence).

**Gateway:**
- `gateway/src/routes/discovery.ts` (or wherever discovery proxies live) (modify — embed `:architectureId` segment).
- `gateway/src/services/*.ts` (any client functions hitting discovery endpoints — accept `architectureId`).

**Frontend:**
- `frontend/src/components/Discovery/StartDiscoveryRunConfirmModal.tsx` (modify — embed `<ArchitectureRunTargetPicker>` and pass picked id to run-start payload).
- `frontend/src/components/Discovery/ArchitectureRunTargetPicker.tsx` (new).
- `frontend/src/components/Discovery/SaveBackConfirmModal.tsx` (new).
- `frontend/src/components/Discovery/<run-list component>.tsx` (modify — filter by `useActiveArchitectureId()`).
- `frontend/src/components/Discovery/<run-detail component>.tsx` (modify — show architecture chip in header).
- `frontend/src/api/discoveryApi.ts` (or equivalent — modify — accept `architectureId` in every Discovery API client function).

---

## Visual Assets

None provided. UI follows established patterns: picker mirrors `ArchitectureSelector` styling (read-only/disabled when one architecture); save-back modal mirrors `ArchiveArchitectureConfirmModal`.
