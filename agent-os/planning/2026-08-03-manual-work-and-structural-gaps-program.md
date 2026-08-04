# Manual work items & structural gaps program — shaping decisions (2026-08-03)

## Origin

Bug: DB-pack planner parented structural-gap stories to the epic (validator
requires story→feature), so any pack with `structural_warnings` deterministically
fails schema-epic expansion ("Expansion failed"). Decision: NO short-term parent
fix — the redesign removes structural-gap stories entirely.

Design review found three divergent "human work" mechanisms:
1. `execution:manual-gate` (code stream) — the only one actually enforced
   against IVS dispatch (driver skips in spec gate + dispatch set).
2. `db_pack_review` stories — deterministic "this is human work" spec marked
   generated/high; the "never dispatched" claim is UNENFORCED (driver has no
   knowledge; non-empty spec text ⇒ dispatched).
3. `provenance:prerequisite` — insufficient_context ⇒ run-blocking.
Structural-gap stories carry pack tags + prerequisite tag; pack-review routing
wins in BOTH preflight and spec-gen ordering, so they'd show ready, generate a
hollow spec, and be dispatched to the IVS.

## Agreed taxonomy (user's A/B/C framing)

- A: truly human work by design (review/sign-off gates). Permanent category.
- B: Haikai deterministic work (± OpenAI drafting); output often *delivered*
  via C-i carriage specs.
- C-i: fully spec'ed IVS work. C-ii: spec blocked on missing detail — a
  TRANSIENT STATE, must resolve to C-i, A, or deferral; never a resting place.
- Structural gaps are category A questions, not work: "this zero looks wrong —
  is it?" Answering one changes OTHER stories (regenerated pack), never itself.

## Locked decisions (user-confirmed)

- D1. Bottom line: NO human work item ever generates a spec or reaches the IVS
  via Start Stage 1/2. Manual items MAY appear in the migration plan, visually
  distinct, never dispatched.
- D2. One first-class execution-class marker (automated | manual) on work
  items, enforced in ONE place (driver dispatch set + hard-block gate + Start
  buttons + spec-generation selection). ALL THREE existing mechanisms migrate
  onto it now (not incrementally).
- D3. Structural warnings become pre-plan DISPOSITIONS, not stories. Findings
  panel on the pack/schema screen next to the translation queue. Undispositioned
  findings block plan generation AND (if a pack regen after plan exists emits
  new warnings) block the next Start. CONFIRMED: block, not advise.
- D4. Three dispositions per finding:
  (a) Accepted — source genuinely like this; reason recorded; persists across
      regenerations; produces nothing in the plan.
  (b) Fix upstream — stays open; auto-clears when a regenerated pack no longer
      emits the warning. Resolution is NEVER a manual flag — the warning
      detector is the single oracle; humans/LLMs only feed the model.
  (c) Known gap — real work, can't fix in tool yet ⇒ creates a KNOWN-GAP work
      item (NEW work-item type, manual class) under a "Known gaps" feature on
      the correct epic; carries finding + user note; completes by human note
      or auto-clears if a later regen resolves the warning; rolls up as a debt
      lane in plan/completion reporting.
- D5. Disposition identity keyed on warning KIND + SUBJECT (not exact text) so
  count drift ("5 relationships" → "3") keeps the disposition; genuinely new
  warnings re-ask.
- D6. Fix-upstream paths, all in scope now:
  (i) Sybase-first DIRECT HARVEST: tool has source-DB access — query ASE
      catalogs (sysobjects/syscolumns/sysindexes/sysreferences/syskeys/
      syscomments) for PKs, FKs, indexes, identity/sequences, proc/trigger/
      view source; backfill the AMS model; regenerate pack. No ddlgen
      dependency. File upload = thin fallback into the same ingestion path.
  (ii) LLM gap-proposal queue (translation-queue pattern): drafts FK joins
      from naming conventions, PK proposals; human approves per item; approved
      ⇒ model decisions ⇒ regenerate. Weak for "zero code objects" (harvest or
      accept covers that).
  (iii) Hand-entry via the same queue UI (human-authored proposal).
- D7. Golden standard applies: no manual residue; sign-offs flow through
  recorded-decision machinery; closure = evidence changed, not say-so.

## Build sequence (all in scope, user: "do it all in whatever sequence is best")

- Spec 1 — Execution-class unification: the marker + single-point enforcement;
  migrate manual-gate / db-pack-review / prerequisite stories onto it; plan UI
  manual rendering; kill hollow-spec generation for manual items.
- Spec 2 — Structural findings dispositions: findings panel + 3 dispositions +
  persistence (kind+subject key) + plan-gen/Start gates; DELETE structural-gap
  story emission from the DB-pack planner (bug dies with it); known-gap item
  type + "Known gaps" feature + debt roll-up.
- Spec 3 — Sybase schema harvest: catalog-query ingestion → authoritative
  structural artifact → AMS model backfill (constraints_metadata, fk_columns,
  indexes, PKs, sequences, code objects) → regenerate → warnings clear.
  Upload fallback shares the pipeline.
- Spec 4 — LLM gap-proposal queue: proposals + review dispositions + model
  write-back; reuses queue UI idioms from pack translations.

Order rationale: 1 makes the guarantee structural before anything else changes;
2 removes the broken stories and lands the gate; 3 then 4 are the resolution
levers (3 closes most real gaps with real data; 4 covers artifact-less cases).

## Status

Shaped 2026-08-03; awaiting explicit user GO before build (standing
pause-at-shape→build rule).
