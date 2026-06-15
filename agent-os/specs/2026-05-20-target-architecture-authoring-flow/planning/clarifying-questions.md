# Clarifying Questions: Target Architecture Authoring Flow

The 10 working assumptions in `requirements.md` are treated as decided and are
NOT re-litigated here. These questions cover only the genuinely open product
questions the assumptions do not answer.

---

1. **Where the authoring workspace lives in the navigation tree.** Where should
   the "Author target architecture" entry point sit? My assumption is a new
   top-level tab on the project / architecture workspace (peer to the existing
   current-architecture view), with the same workspace also reachable via a
   prominent "Author target" button on the project dashboard. Alternative:
   nest it under the existing architecture view as a sub-tab, or expose it
   only from the migration delivery dashboard. Which placement do you want?

2. **When the "stale" flag fires on downstream specs.** The assumption fixes
   that edits to the active target mark affected specs stale, but not the
   trigger granularity. My assumption is: fire on draft promotion AND on any
   save to the active target (debounced so a burst of saves produces one
   stale-mark event), NOT on every keystroke. Draft edits never mark anything
   stale. Alternative: only mark stale on draft promotion (more conservative,
   active edits are silently propagated), or fire on every save including
   active-target saves with no debounce. Confirm or pick alternative?

3. **LLM "Suggest target architecture" output shape.** The assumption fixes
   one-shot suggest, but not what comes back. My assumption is a full draft
   target architecture (new draft row, populated table) the user opens and
   curates, NOT a diff against current and NOT just commentary. Provenance on
   each element is set to `llm-suggested` so the user sees what came from the
   model vs what they edited. Alternative: emit a delta proposal (add / change /
   remove rows) the user applies selectively to an existing draft, or emit
   commentary only and the user fills in the table. Which output shape?

4. **Mapping-prompt UX on add-new-element.** The assumption fixes that adding a
   new target element prompts for mapping. My assumption is an inline expansion
   on the new row (mapping picker with options "replaces current element X" /
   "brand-new" / "no current equivalent", plus an LLM hint chip the user can
   accept) so the user never leaves the table. Alternative: a modal dialog
   (more disruptive but harder to skip), or deferred (let the user save the
   row mapping-less and surface it in the unmapped-elements warning panel
   later). Which UX?

5. **Decommissioning_status semantics — target-side or current-side.** The
   assumption adds `decommissioning_status` as a per-element field on the
   target architecture, but the natural place to mark something
   "decommissioned" is on the current architecture (the thing being retired).
   My assumption is to keep `decommissioning_status` on the target-side
   element rows (vocabulary: not-applicable / proposed / decommissioned) AND
   also expose a derived "decommissioned in target" annotation on current
   elements that have no target mapping plus a "mark decommissioned" action
   in the unmapped-elements panel that writes the target-side row. So the
   field lives on target; the current-side view is derived. Alternative: move
   the field to current-architecture element rows (target has no
   decommissioning concept at all). Which is right?

6. **Compare view layout in v1.** The assumption fixes stacked-rows table
   comparison for v1 and lists visual side-by-side as a stretch. My assumption
   is to ship ONLY the stacked-rows table comparison in v1 (side-by-side
   diagrams deferred entirely to a follow-up spec), keep the spec scope tight,
   and revisit visual side-by-side once the table comparison is validated in
   use. Alternative: include visual side-by-side as a v1 stretch goal with
   an explicit "may slip" caveat in the spec. Drop the stretch, or keep it?

7. **Promote-to-active confirmation flow.** The assumption fixes "single-click
   promote", but in practice a single click on a destructive-feeling action
   (replaces the active target, marks specs stale) is risky. My assumption is
   a single confirm modal on promote that surfaces "this will mark N specs
   stale" plus a "promote" button — so it is one click to invoke, one click
   to confirm, with the impact preview. Alternative: truly single-click with
   an undo toast (more fluid but riskier), or full multi-step wizard (heavier
   than needed). Which?

8. **Draft naming convention.** Drafts need names for the drafts panel. My
   assumption is auto-generate a default name on create (e.g. "Draft 2026-05-20
   #1" or "Draft from LLM suggest") that is inline-editable in the drafts
   panel; the user is never blocked by a "name your draft" modal. Alternative:
   require the user to name the draft on create (cleaner library, more
   friction), or no names at all (use timestamps only — gets confusing once
   there are several). Auto-generate-and-editable OK?

9. **LLM input budget for "suggest target architecture".** The one-shot suggest
   reuses the focused-context resolver to gather current architecture +
   discovery findings + mappings. My assumption is a fixed token envelope
   in v1 (a sensible default chosen at implementation time, no UI knob), with
   the per-project configurable budget deferred to a later spec once we see
   how the default behaves in practice. Alternative: expose a per-project
   configurable budget in project config from day one. Fixed envelope OK for
   v1?

10. **Audit trail surface.** The assumption fixes "audit trail covers history"
    via the existing AMS audit. My assumption is to rely on the existing AMS
    audit only in v1 (no dedicated audit-trail panel in the authoring
    workspace) and add a dedicated panel later if real users ask for one.
    Alternative: ship a dedicated "history" panel in the authoring workspace
    in v1 showing recent edits / promotions / LLM suggestions for the active
    target. Existing AMS audit only, or dedicated panel in v1?

---

**Visual Assets Request:**

Do you have any design mockups, wireframes, or screenshots that could help
guide the development? In particular:

- Current architecture workspace / project workspace so I can see where the
  authoring entry point and new tab should sit.
- Current architecture diagram view so I can match the target view styling.
- Any sketches of the table editor, drafts panel, compare view, or
  unmapped-elements warning panel.
- Existing imported-target view (if any) so I can see what becomes the v1 seed.

If yes, please place them in:
`agent-os/specs/2026-05-20-target-architecture-authoring-flow/planning/visuals/`

Use descriptive filenames like:
- architecture-workspace-current.png
- target-table-editor-sketch.png
- drafts-panel-wireframe.png
- compare-view-stacked-rows.png
- unmapped-elements-panel.png

Please answer the questions above and let me know if you've added any visual
files.
