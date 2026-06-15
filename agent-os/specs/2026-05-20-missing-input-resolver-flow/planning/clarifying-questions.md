# Clarifying Questions: Missing Input Resolver Flow

These are the genuinely open product questions for this spec. The 10 working assumptions captured in `requirements.md` are treated as decided and are NOT re-opened here.

For each question, a recommended default is included; please confirm or override.

---

1. **Bulk upload entry point** — Where should the bulk upload flow live in the UI? My recommended default: a "Bulk resolve" button at the TOP of the Migration Delivery Dashboard (next to the "X specs ready to retry" badge), opening a modal that accepts one OAS/WSDL file or one mapping bundle and previews which keys it will resolve across all stories. The story-drawer resolver panel keeps its own per-story upload affordance for the single-story case. Confirm, or should bulk live only inside the drawer / only as a dashboard-level page?

2. **Missing-input key hash inputs** — The stable `missing_input_key` is a hash. My recommended default: hash over `(input_type, canonical_descriptor)` where `canonical_descriptor` is the normalised target identifier — e.g. for API contracts: `service_name + operation_name` lowercased and trimmed; for mappings: `source_element_id + target_element_id`; for missing arch elements: `target_element_logical_name`. Hash algorithm: SHA-256, truncated to 16 hex chars for storage. Confirm these inputs per type, or adjust?

3. **"Retry anyway" override** — Should the user be allowed to click Retry while some missing inputs are still unresolved? My recommended default: NO override in v1 — Retry button is disabled until all inputs for that story are resolved, with hover-tooltip explaining why. Keeps the contract simple and avoids low-quality regenerations. Confirm strict block, or do you want an "I know what I'm doing" override path?

4. **Resolver panel layout at scale (10+ missing inputs)** — How should the panel handle stories with many missing inputs? My recommended default: group by input-type (API contracts / mappings / target elements), each group collapsible, default-expanded if group has any unresolved items, default-collapsed once fully resolved. No pagination; vertical scroll within the drawer. Confirm grouped-collapsible, or prefer flat scroll / paginated / tab-per-type?

5. **Resolution undo / reset semantics** — Can a user un-resolve a missing input after the fact, and what cascades? My recommended default: yes, a "Reset" action per resolution row that soft-deletes the resolution (keeps audit history), flips every spec that referenced that key back to `insufficient_context`, and requires explicit re-Retry. Cross-story cascade is automatic — if 12 specs were marked ready-to-retry from this resolution, all 12 revert. Confirm soft-delete + automatic cross-story cascade, or different semantics?

6. **Cross-story preview before bulk apply** — When a bulk upload would resolve keys across many stories, do we show a preview first? My recommended default: ALWAYS show a preview modal listing every story + key the upload will affect, with a confirm button before committing the transaction. Avoids surprise mass-flips. Confirm always-preview, or apply silently with a post-hoc summary toast?

7. **Resolver panel sort order** — How are the missing-input rows ordered inside the resolver panel? My recommended default: sort by (status: unresolved first, resolved last) then by (type: API contracts → mappings → target elements → out-of-v1 types) then by descriptor alphabetically. Puts actionable work at the top. Confirm, or prefer pure-type-grouped or spec-author order?

8. **"Ready to retry" dashboard card click target** — When the user clicks the "X specs ready to retry" dashboard card/badge, what happens? My recommended default: BOTH — clicking the count opens a filtered list of the ready-to-retry stories, and the card has a secondary "Retry all" button next to the count for direct bulk-retry without opening the list. Confirm both, or list-only / direct-bulk-retry-only?

9. **Mapping editor scope** — The inline mapping editor in the drawer: is it a single-pair editor (one source-element → one target-element with field-level mapping) or a general workspace? My recommended default: single-pair inline editor in v1, scoped to the specific missing-mapping key. A richer multi-pair workspace is a follow-up spec. Keeps drawer footprint small. Confirm single-pair, or push for general workspace now?

10. **Retry token cost preview** — Before the user clicks Retry (single or bulk), do we show an estimated LLM token cost? My recommended default: threshold-gated — show a cost preview only when the batch exceeds a configurable threshold (e.g. 5 stories OR estimated >50k tokens), otherwise retry immediately. Single-story retries never show a preview. Confirm threshold-gated, or always-show / never-show?

---

Please answer each by number. "Default" is shorthand for accepting my recommendation as written.
