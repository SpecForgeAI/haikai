# Deterministic Findings-Coverage Verification + Gap Wayfinding (explain every gap, link to where it's fixed)

## Problem / north star
Two related trust gaps in the migration-plan pipeline:
1. FINDINGS COVERAGE IS LLM-CLAIMED: the generated migration book of work's `findingsAddressed/findingsNotAddressed` numbers come from the LLM's own assertion. There is no deterministic check that every ACCEPTED critical/high discovery finding is referenced by at least one book-of-work item (`discoveryFindingReferences`). The same trust gap was eliminated for endpoints (template stamping) and capture inventory (model-seeded reconciliation) — findings are the last LLM-claimed coverage surface.
2. GAPS ARE RAW CODES WITH NO PATH TO RESOLUTION (user-requested extension): the Migration Delivery Plan wizard's readiness panel shows bare gap codes (`no_api_behaviour_baseline`, `high_severity_unreviewed_findings`, `discovery_harness_inventory_mismatch`, ...) with no explanation of what they mean, why they matter, or WHERE in the tool to fix them. The user must know the product to act. Every gap should carry a human explanation + a DEEP LINK to the resolving surface.

## Scope — Part 1: deterministic findings-coverage check (in the plan generation pipeline, gateway)
- After plan assembly (and after each epic expansion — references mostly land on stories), compute IN CODE: the set of accepted critical/high findings from the selected discovery runs vs the union of `discoveryFindingReferences` across book-of-work items.
- REPLACE the LLM-asserted findingsAddressed/NotAddressed in generationSummary with the computed values; persist the unaddressed list (finding ids + titles + severity) in the summary blob.
- Advisory, not blocking: generation never fails on coverage; the review workspace shows an "Unaddressed findings" panel with per-finding wayfinding links (Part 2 machinery) + the count on the draft summary/list surfaces.
- Recompute on expansion appends (coverage improves as stories land).

## Scope — Part 2: the gap wayfinding registry (explain + deep-link every gap)
- ONE registry mapping every gap/limitation code to: a plain-English explanation (what it means, why it matters for the migration), and a RESOLUTION DESTINATION (route within the tool + the label of the action to take there). Known codes from MigrationGapCodes + context warnings + the new unaddressed-findings entries:
  - no_api_behaviour_baseline → API behaviour page: "Capture a current-state baseline, accept captures, Save as Baseline, then Activate"
  - high_severity_unreviewed_findings → the selected run's Findings tab / Architecture Room: "Review (approve/reject/defer) the critical+high findings"
  - missing_current_to_target_mappings → Target State workspace: "Suggest from current / resolve unmapped elements"
  - unresolved_discovery_decisions → decision tasks surface
  - under_specified_endpoints → discovery candidates (endpoint→entity links)
  - discovery_harness_inventory_mismatch → the capture wizard's NEW reconciliation step (model-seeded-capture-inventory spec)
  - incomplete_capture_coverage → Capture Review panel
  - insufficient_runtime_evidence → Start Discovery Run modal (log upload)
  - no_sample_data_hints → DB scan with profiling mode
  - missing_oas_for_in_scope_interface → interface spec_link / OAS upload
  - no_database_discovery_findings → Start Discovery Run (database source)
  - unaddressed finding (per-finding) → that finding's detail drawer
- Surfaces consuming the registry: the wizard's Inputs & context readiness panel (replace bare codes with explanation cards + "Go to ..." links), the plan review workspace's unaddressed-findings panel, and the draft summary. (Dashboard cards optional — shaping question.)
- Deep links must be real routes with the correct project/architecture/run ids threaded (the readiness response may need to carry resolution-context ids, e.g. WHICH run has the unreviewed findings — shaping question on where that context comes from).

## Constraints / philosophy
- The coverage computation is PURE CODE in the gateway — no LLM. The LLM keeps producing its references; code grades them.
- Advisory-only: nothing new blocks generation or saving (consistent with readiness being advice + the user deciding).
- The registry is ONE place (no per-surface copy drift) — likely frontend module exporting {code → {title, explanation, destination(route builder), actionLabel}}; shaping question whether any part must be server-supplied.
- Back-compat: old drafts without computed coverage render unchanged (no false alarms).

## Existing foundations (verify in repo)
- MigrationGapCodes + assessReadiness in AMS MigrationDiscoveryContextService (the gap vocabulary + which stream each affects).
- The plan pipeline: migrationBookOfWorkHandler.ts (generationSummary composition — deterministic counts already recomputed at assembly), migrationBookOfWorkExpansionHandler.ts (expansion appends — where recompute hooks), MigrationBookOfWorkItem.discoveryFindingReferences.
- The wizard readiness display (MigrationDeliveryPlanWizard Inputs & context stage), review workspace, DraftSummary/draft list.
- Finding detail drawer routes; the new capture-wizard reconciliation step; Architecture Room launch; Target State workspace routes.
