# Clarifying Answers: Missing Input Resolver Flow

The user has confirmed ALL 10 recommended defaults from `clarifying-questions.md` verbatim. No overrides.

Each answer below is the confirmed product decision the spec-writer should use directly.

---

## 1. Bulk upload entry point

**Confirmed:** A "Bulk resolve" button at the TOP of the Migration Delivery Dashboard (next to the "X specs ready to retry" badge), opening a modal that accepts one OAS/WSDL file or one mapping bundle and previews which keys it will resolve across all stories. The story-drawer resolver panel keeps its own per-story upload affordance for the single-story case.

## 2. Missing-input key hash inputs

**Confirmed:** The stable `missing_input_key` is hashed over `(input_type, canonical_descriptor)` where `canonical_descriptor` is the normalised target identifier:
- For API contracts: `service_name + operation_name`, lowercased and trimmed.
- For mappings: `source_element_id + target_element_id`.
- For missing arch elements: `target_element_logical_name`.

Hash algorithm: SHA-256, truncated to 16 hex chars for storage.

## 3. "Retry anyway" override

**Confirmed:** NO override in v1. The Retry button is disabled until all inputs for that story are resolved, with a hover-tooltip explaining why. Keeps the contract simple and avoids low-quality regenerations.

## 4. Resolver panel layout at scale (10+ missing inputs)

**Confirmed:** Group by input-type (API contracts / mappings / target elements). Each group is collapsible. Default-expanded if the group has any unresolved items; default-collapsed once fully resolved. No pagination; vertical scroll within the drawer.

## 5. Resolution undo / reset semantics

**Confirmed:** Yes, a "Reset" action per resolution row that soft-deletes the resolution (keeps audit history), flips every spec that referenced that key back to `insufficient_context`, and requires explicit re-Retry. Cross-story cascade is automatic — if 12 specs were marked ready-to-retry from this resolution, all 12 revert.

## 6. Cross-story preview before bulk apply

**Confirmed:** ALWAYS show a preview modal listing every story + key the upload will affect, with a confirm button before committing the transaction. Avoids surprise mass-flips.

## 7. Resolver panel sort order

**Confirmed:** Sort by:
1. Status: unresolved first, resolved last.
2. Type: API contracts → mappings → target elements → out-of-v1 types.
3. Descriptor alphabetically.

Puts actionable work at the top.

## 8. "Ready to retry" dashboard card click target

**Confirmed:** BOTH. Clicking the count opens a filtered list of the ready-to-retry stories, AND the card has a secondary "Retry all" button next to the count for direct bulk-retry without opening the list.

## 9. Mapping editor scope

**Confirmed:** Single-pair inline editor in v1, scoped to the specific missing-mapping key. A richer multi-pair workspace is a follow-up spec. Keeps drawer footprint small.

## 10. Retry token cost preview

**Confirmed:** Threshold-gated. Show a cost preview only when the batch exceeds a configurable threshold (e.g. 5 stories OR estimated >50k tokens), otherwise retry immediately. Single-story retries never show a preview.

---

All 10 defaults accepted verbatim. Spec-writer may proceed with these as the canonical product decisions.
