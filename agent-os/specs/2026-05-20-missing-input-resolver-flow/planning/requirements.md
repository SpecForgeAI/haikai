Today the migration shape-spec generation pipeline can return `insufficient_context` status for a story when the inputs needed for a quality spec are missing (no API contract, no data mapping, target architecture element absent, etc.). The story sits on the Migration Delivery Dashboard with that status, and the user has NO clear actionable path forward. The drawer shows the missingInputs list as read-only text. This feature closes that loop with a structured resolver workflow so the user can fix the missing inputs in place, mark them resolved, and retry generation.

This is the highest-value workflow gap in Wave 2: it unlocks every story currently stuck at insufficient_context.

Working assumptions (already agreed with user, treat as decided unless a real product question arises):

1. Resolution mechanisms: structured resolvers per missing-input type. v1 supports three types:
   (a) Missing API contract -- upload OAS / WSDL file OR paste contract text inline.
   (b) Missing current-to-target data mapping -- inline mapping editor.
   (c) Missing target-architecture element -- deep-link to the target-arch authoring workspace (Spec 2026-05-20 target-architecture-authoring-flow).
   Other types (missing decisions, missing API behaviour baselines, etc.) surface read-only with "out of v1 scope" hint.

2. Workspace location: dedicated resolver panel INSIDE the existing story drawer on the Migration Delivery Dashboard. Not a separate top-level workspace. The drawer already shows missing inputs read-only; this makes them actionable in place.

3. Auto-retry behaviour: NO auto-regenerate. User clicks "Retry generation" explicitly after resolving inputs. Avoids LLM token thrash on bursty resolutions.

4. Resolution persistence: new `missing_input_resolutions` AMS table keyed by a stable `missing_input_key` (a hash of the input-type + canonical descriptor). Resolution row carries the resolved-value payload (uploaded bytes for OAS, mapping JSON for mappings, target-element reference for arch elements) plus `resolved_at` + `resolved_by` audit fields.

5. Partial resolution tracking: per-story "X of Y inputs resolved" badge. The spec stays at `insufficient_context` status until ALL of its missing inputs are resolved AND the user clicks Retry. Partial resolution surfaces progress but does not flip status.

6. Cross-story applicability: YES -- when a missing input with a stable key is resolved, every spec listing that same key auto-flags "ready to retry". Dashboard surfaces this as a count badge ("12 specs newly ready to retry"). One resolution can cover many specs.

7. LLM assist for resolution: DEFERRED to a later spec. v1 is structured-by-type resolution only. No "LLM suggests how to resolve this gap" co-pilot in this spec.

8. Audit trail: per-resolution `resolved_at` + `resolved_by` fields, displayed inline on the resolver panel. Reuse existing AMS audit pattern.

9. Bulk resolution: YES -- one OAS upload that satisfies 10 missing-input keys flips all 10 to ready-to-retry in a single transaction. Same for bulk mapping uploads. The cross-story matching happens at upload time.

10. `recommendedNextAction` surfacing: bumped to the TOP of the resolver panel as a prominent "What to do next" banner. Today it's buried inside the drawer; this is its dedicated home.

Out of scope:
- LLM-driven free-text resolution co-pilot (Wave 2 follow-up).
- Resolving missing decisions (Spec 2026-05-20 cross-story-context-injection already covers epic captured decisions; defer richer decision-resolution to a follow-up).
- Resolving missing API behaviour baselines (deferred -- the baselines flow already exists in the api-migration-validation-service; integration is a separate task).
- Auto-regenerating specs without user click (token-cost safety).
- Multi-tenant resolution conflict (e.g., two users uploading different OAS for the same key).
- Approval / sign-off workflow on resolutions.
- Wave 2 #11 auto-regenerate-on-new-findings (the reconciliation-loop closure).

Services touched:
- architecture-model-service: new persistence table `missing_input_resolutions`; extend MigrationStorySpecGenerationEntity OR sibling table for structured missing_inputs[] keys; new endpoints for resolve / list / cross-story-ready-to-retry / retry-batch.
- gateway: proxy routes for new AMS endpoints. No new LLM tasks in v1.
- frontend: extended story drawer with resolver panel; per-type resolvers; "X of Y resolved" badge; cross-story "ready to retry" count + jump-to-list; "Retry generation" + bulk "Retry all ready".

Inputs the resolver flow consumes: MigrationStorySpecGenerationEntity rows with status=insufficient_context, missing_inputs_json, existing OAS/WSDL inventory, existing ArchitectureElementMappings, target architecture from Spec 7.

Outputs: missing_input_resolutions rows; updated spec generation rows when retry completes; new OAS/WSDL records when resolver uploads contracts; new ArchitectureElementMappings rows when resolver creates mappings.

## Visual Assets

No visual assets were provided for this spec.

## Confirmed product decisions (from clarifying answers)

The user reviewed `planning/clarifying-questions.md` and confirmed ALL 10 recommended defaults verbatim. See `planning/clarifying-answers.md` for the full text. Summary for spec-writer consumption:

1. **Bulk upload entry point** — "Bulk resolve" button at the TOP of the Migration Delivery Dashboard (next to the "X specs ready to retry" badge), opening a modal that accepts one OAS/WSDL file or one mapping bundle and previews which keys it will resolve across all stories. The story-drawer resolver panel keeps its own per-story upload affordance for single-story use.

2. **Missing-input key hash inputs** — `missing_input_key` = SHA-256 of `(input_type, canonical_descriptor)` truncated to 16 hex chars, where `canonical_descriptor` is:
   - API contracts: `service_name + operation_name`, lowercased and trimmed.
   - Mappings: `source_element_id + target_element_id`.
   - Missing arch elements: `target_element_logical_name`.

3. **"Retry anyway" override** — NO override in v1. Retry button is disabled until all inputs for the story are resolved, with hover-tooltip explaining why.

4. **Resolver panel layout at scale** — Group by input-type (API contracts / mappings / target elements). Each group is collapsible: default-expanded if it has any unresolved items, default-collapsed once fully resolved. No pagination; vertical scroll within the drawer.

5. **Resolution undo / reset semantics** — "Reset" action per resolution row soft-deletes the resolution (audit history preserved), flips every spec that referenced that key back to `insufficient_context`, and requires explicit re-Retry. Cross-story cascade is automatic.

6. **Cross-story preview before bulk apply** — ALWAYS show a preview modal listing every story + key the upload will affect, with a confirm button before committing the transaction.

7. **Resolver panel sort order** — Sort by (status: unresolved first, resolved last) → (type: API contracts → mappings → target elements → out-of-v1 types) → (descriptor alphabetically).

8. **"Ready to retry" dashboard card click target** — BOTH behaviours: clicking the count opens a filtered list of ready-to-retry stories, AND the card has a secondary "Retry all" button next to the count for direct bulk-retry without opening the list.

9. **Mapping editor scope** — Single-pair inline editor in v1, scoped to the specific missing-mapping key. Multi-pair workspace is a follow-up spec.

10. **Retry token cost preview** — Threshold-gated. Show a cost preview only when the batch exceeds a configurable threshold (e.g. 5 stories OR estimated >50k tokens). Single-story retries never show a preview.
