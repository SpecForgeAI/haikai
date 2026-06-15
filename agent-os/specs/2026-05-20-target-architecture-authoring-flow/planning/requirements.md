Today the target state architecture exists in architecture-model-service (AMS) but is import-only — there is no interactive surface for the user to author, refine, or curate it. The diagram in agent-os/migration-ascii-diagram.txt shows a "user direction → Target State Architecture" arrow that has no UI behind it. This feature provides that surface.

This is one of two material gaps remaining in the migration platform's macro diagram (the other being Wave 2 #8, Claude Code handoff). Target-architecture authoring is a prerequisite for richer shape-spec generation (because better target detail → better specs) and for closing the discovery → spec → reconciliation loop.

Working assumptions (already agreed with user, treat as decided unless a real product question arises):

1. Authoring modality: table-based primary (rows per component / API / data entity / infrastructure unit). A read-only diagram view renders from the table using the existing diagram pipeline. NO drag-drop visual editor in v1. LLM-conversational deferred to a later spec.

2. Seeding the target: clone-current-as-default. Alternatives offered in the seed dialog: "start blank" and "from template". Most migrations are like-for-like + selective changes, so clone-first is the productive default. Existing imported target architecture becomes the v1 seed for editing if one exists.

3. Mapping authoring: auto-create mappings when an element is cloned from current. Prompt for mapping when the user adds a new target element (offer "replaces current element X", "brand-new", or "no current equivalent"). LLM-suggested mapping shown on add as a hint, never auto-applied without confirmation.

4. Versioning: single active target architecture per project + multiple named drafts. Drafts can be promoted to active. No git-style branching, no merge. Audit trail covers history.

5. Validation against discovery: "unmapped current elements" warning panel surfaces every current-architecture element with no target mapping ("Service X exists in current but no target maps to it — mark decommissioned or add mapping"). Inline-actionable from the panel.

6. Downstream impact on existing specs: when the active target architecture changes after shape-specs have been generated, mark affected specs as `stale` (new status flag / boolean on the spec generation row). Do NOT auto-regenerate. User triggers regeneration explicitly from the existing spec generation dashboard. The dashboard surfaces a count of stale specs.

7. LLM assist: single "Suggest target architecture from current" button, one-shot, produces a draft target architecture the user curates. Not a continuous co-pilot. Reuses focused-context resolver to gather current architecture + discovery findings + mappings as input.

8. Persistence model: reuse existing AMS architecture entity model. Target architecture is an architecture row with `kind = 'target'` (already supported by the existing schema). Add a per-element `provenance` field (vocabulary: cloned-from / imported / user-authored / llm-suggested) and a per-element `decommissioning_status` field (vocabulary: not-applicable / proposed / decommissioned). Add a per-architecture `draft_state` field (vocabulary: active / draft).

9. Diagram rendering: reuse the existing diagram pipeline. Target architecture gets its own diagram view (same as current today). Add a "compare" view showing current + target side-by-side (initially a stacked-rows table comparison; visual side-by-side diagrams are a stretch goal for this spec).

10. Conflict resolution with imported target: imported target architecture (today's behaviour) becomes the v1 seed for editing. User edits replace in place. No branching. Version history is the existing AMS audit trail.

Out of scope:
- Drag-drop visual diagram editor (might be a later spec).
- LLM-conversational architecture authoring (continuous co-pilot mode).
- Git-style branching/merging of architectures.
- Auto-regeneration of stale specs (user-triggered only).
- Wave 2 #8 Claude Code handoff (separate spec).
- Wave 2 #5 dependency hints (separate spec, though this spec may surface dependency-style fields if they help validation).
- Multi-tenant authoring conflict resolution (e.g., two users editing simultaneously).
- Approval workflow / sign-off (the "promote draft to active" action is single-click for v1).

Services touched:
- architecture-model-service:
  - new fields on architecture entity (draft_state) and on architecture element rows (provenance, decommissioning_status)
  - new endpoints for: seeding (clone-from-current), mapping suggestions, stale-spec marking, draft promotion, LLM "suggest target" task
  - validation queries (unmapped current elements list)
- gateway:
  - LLM task for "suggest target architecture" (one-shot suggest)
  - proxy routes for new AMS endpoints
- frontend:
  - new authoring workspace (table editor + draft management + compare view)
  - mapping prompt modal on add-new-element
  - unmapped-elements warning panel
  - stale-spec count surfaced on the migration delivery dashboard
- mcp-server: only if architecture entity persistence needs a model-side hook

Inputs the authoring flow consumes:
- Current State Architecture (existing AMS)
- Discovery Findings/Evidence (existing AMS) — for validation hints
- ArchitectureElementMappings (existing AMS) — for round-trip mapping authoring
- API contracts + behaviour baselines (existing AMS) — informs target API shape
- Existing imported target architecture if any

Outputs:
- Active target architecture (kind=target, draft_state=active) — single per project
- Zero-to-many draft target architectures (kind=target, draft_state=draft)
- Updated ArchitectureElementMappings between current and active target
- Stale-spec flags on MigrationStorySpecGeneration rows when active target changes

Key user-facing behaviour:
- "Author target architecture" entry point on the project / architecture workspace.
- Seed dialog: clone current (default) / start blank / from template.
- Table editor: rows per element type (component, api, data entity, infra). Inline edit on each row.
- Add-new-element button → opens a row + mapping prompt modal.
- LLM "Suggest target architecture from current" button → produces a draft the user curates.
- Drafts panel: list, name, view, edit, promote-to-active (single click), delete.
- Compare view: current + target stacked rows (visual side-by-side a stretch).
- Unmapped-elements warning panel with inline "mark decommissioned" / "add mapping" actions.
- After promoting a draft to active OR after editing the active target, affected specs are flagged stale (a single AMS query identifies them by mapping/element involvement).
- Migration delivery dashboard surfaces stale-spec count + a "regenerate stale specs" action.

---

## Confirmed product decisions (from clarifying answers)

The 10 open product questions in `clarifying-questions.md` were reviewed with
the user. All 10 recommended defaults were confirmed verbatim. Each decision
below is binding for the spec; the full per-question record lives in
`clarifying-answers.md`.

1. **Authoring workspace placement.** New top-level tab on the project /
   architecture workspace (peer to current-architecture view), ALSO reachable
   via a prominent "Author target" button on the project dashboard. Not nested
   under the existing architecture view; not exposed only from the migration
   delivery dashboard.

2. **Stale-flag trigger granularity.** Fires on draft promotion AND on any
   save to the active target architecture. Active-target saves are debounced
   so a burst of saves produces one stale-mark event. Draft edits never mark
   downstream specs stale.

3. **LLM suggest output shape.** One-shot "Suggest target architecture"
   produces a full draft target architecture (new draft row + populated table)
   the user opens and curates. Not a diff and not commentary-only. Each
   element produced by the model carries `provenance = llm-suggested`.

4. **Add-new-element mapping UX.** Inline row expansion in the table with a
   mapping picker — options "replaces current element X" / "brand-new" / "no
   current equivalent" — plus an LLM hint chip the user can accept. No modal;
   no deferred mapping-less save.

5. **`decommissioning_status` location.** Lives on target-side element rows
   (vocabulary: `not-applicable` / `proposed` / `decommissioned`). Current
   architecture has no decommissioning concept of its own. The current-side
   "decommissioned in target" annotation is derived from missing mappings;
   the unmapped-elements panel's "mark decommissioned" action writes the
   target-side row.

6. **Compare view scope in v1.** Stacked-rows table comparison ONLY. Visual
   side-by-side diagrams are deferred entirely to a follow-up spec — not a v1
   stretch goal.

7. **Promote-to-active confirmation.** One click to invoke, one click to
   confirm in a modal that surfaces "this will mark N specs stale". No
   undo-toast pattern; no multi-step wizard.

8. **Draft naming.** Auto-generated default name on create (e.g. "Draft
   2026-05-20 #1" or "Draft from LLM suggest"), inline-editable in the drafts
   panel. Never block the user with a "name your draft" modal at create time.

9. **LLM input budget.** Fixed token envelope in v1, chosen at implementation
   time. No UI knob. Per-project configurable budget deferred to a later spec.

10. **Audit trail surface in v1.** Existing AMS audit only. No dedicated
    history panel in the authoring workspace for v1.

## Visual assets

No visual assets were provided. The `planning/visuals/` directory is empty.
The spec-writer should describe UI structurally in prose, referencing existing
surfaces (current-architecture workspace, migration delivery dashboard,
existing diagram view) rather than relying on mockups.
