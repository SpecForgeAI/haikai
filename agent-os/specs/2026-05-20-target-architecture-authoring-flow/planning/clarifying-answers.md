# Clarifying Answers: Target Architecture Authoring Flow

Status: all 10 recommended defaults from `clarifying-questions.md` were confirmed
by the user verbatim, with no changes. This document records the confirmed
answer for each question in a form the spec-writer can use directly.

---

## Q1. Where the authoring workspace lives in the navigation tree

**Confirmed answer:** New top-level tab on the project / architecture workspace
(peer to the existing current-architecture view). The same workspace is ALSO
reachable via a prominent "Author target" button on the project dashboard. It
is NOT nested as a sub-tab under the existing architecture view, and it is NOT
exposed only from the migration delivery dashboard.

---

## Q2. When the "stale" flag fires on downstream specs

**Confirmed answer:** Fires on draft promotion AND on any save to the active
target architecture. Active-target saves are debounced so a burst of saves
produces one stale-mark event; the flag does NOT fire on every keystroke.
Edits to drafts never mark anything stale (only the active target propagates
staleness).

---

## Q3. LLM "Suggest target architecture" output shape

**Confirmed answer:** The one-shot suggest produces a full draft target
architecture — a new draft row with a populated table the user opens and
curates. It is NOT a diff/delta proposal and NOT commentary-only. Provenance
on each element produced by the model is set to `llm-suggested` so the user
can distinguish model-produced rows from rows they later edit.

---

## Q4. Mapping-prompt UX on add-new-element

**Confirmed answer:** Inline expansion on the new row. The mapping picker
exposes three options — "replaces current element X", "brand-new", and "no
current equivalent" — plus an LLM hint chip the user can accept. The user
never leaves the table; no modal dialog, no deferred mapping-less save.

---

## Q5. Decommissioning_status semantics — target-side or current-side

**Confirmed answer:** The `decommissioning_status` field lives on the
target-side element rows (vocabulary: `not-applicable` / `proposed` /
`decommissioned`). A derived "decommissioned in target" annotation is exposed
on current-architecture elements that have no target mapping. The
unmapped-elements panel includes a "mark decommissioned" action that writes
the target-side row. The current-side view is purely derived; the current
architecture itself has no decommissioning concept of its own.

---

## Q6. Compare view layout in v1

**Confirmed answer:** Ship ONLY the stacked-rows table comparison in v1.
Visual side-by-side diagrams are deferred entirely to a follow-up spec — they
are NOT a v1 stretch goal. Spec scope stays tight; revisit visual side-by-side
once the table comparison is validated in real use.

---

## Q7. Promote-to-active confirmation flow

**Confirmed answer:** One click to invoke "promote", one click to confirm in a
modal that surfaces the impact preview ("this will mark N specs stale"). No
undo-toast pattern, no multi-step wizard.

---

## Q8. Draft naming convention

**Confirmed answer:** Auto-generate a default name on create (e.g. "Draft
2026-05-20 #1" or "Draft from LLM suggest"). The name is inline-editable in
the drafts panel. The user is never blocked by a "name your draft" modal on
create.

---

## Q9. LLM input budget for "suggest target architecture"

**Confirmed answer:** Fixed token envelope in v1, with a sensible default
chosen at implementation time and NO UI knob. Per-project configurable budget
is deferred to a later spec, to be revisited once the default behaviour has
been observed in practice.

---

## Q10. Audit trail surface

**Confirmed answer:** Rely on the existing AMS audit only in v1. NO dedicated
audit-trail / history panel in the authoring workspace. A dedicated panel can
be added later if real users ask for one.

---

## Visual assets

No visual assets were provided. The `planning/visuals/` directory contains no
files. The spec-writer should proceed without mockups and describe the UI in
prose plus structural references to existing patterns (current-architecture
workspace, migration delivery dashboard, existing diagram view).
