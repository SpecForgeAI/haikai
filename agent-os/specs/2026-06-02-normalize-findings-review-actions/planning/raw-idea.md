"Spec F" — the FIRST of a 5-spec program (Spec F → Spec 0 → 1 → 2 → 3) that unifies + aggregates discovery review and adds a conversational "Architect" review persona. Spec F is a small, FOUNDATIONAL consistency cleanup the later specs depend on: the unified grid + conversation review must use ONE disposition vocabulary across architecture CANDIDATES and discovery FINDINGS.

PROBLEM: Discovery FINDINGS have their own review-status model inconsistent with architecture CANDIDATES and it conflates two lifecycles. From `architecture-model-service/.../discovery/DiscoveryFindingService.java`, finding statuses are `new` (default on emit), `accepted`, `ignored`, `needs_review`, `resolved` (ALLOWED_STATUSES ~line 126; ALLOWED_TRANSITIONS ~line 171). The frontend `frontend/src/components/Discovery/FindingsTab.tsx` exposes user actions "Accept", "Ignore", "Mark Needs Review", "Mark Resolved" — mixing (1) scope/relevance (accept vs ignore) with (2) an issue-tracker workflow (needs_review/resolved). Architecture CANDIDATES instead use a clean disposition: Approve / Reject / Defer.

GOAL: make findings use the SAME disposition vocabulary as candidates so the grid AND the future unified review conversation are consistent:
- accepted → the canonical "keep / in-scope" disposition (Approve/Accept)
- ignored → RENAME to Reject (consistent with candidates)
- needs_review → Defer (revisit-later; keep re-open semantics)
- resolved → DEMOTE from a user action to a SYSTEM-SET lifecycle state (separate user disposition from system lifecycle, e.g. an evidence-gap "value unavailable — TODO" finding the system auto-marks resolved once the gap is filled). The human review must not carry a 4th choice.

GROUNDING: DiscoveryFindingService.java + DiscoveryFindingController.java + the finding entity/DTO; frontend FindingsTab.tsx; the candidate disposition model (approve/reject/defer). Reconcile with IN-FLIGHT uncommitted bulk-findings-actions work: `agent-os/specs/2026-05-28-bulk-findings-actions/` + modified DiscoveryFindingController/Service, frontend FindingsTab.tsx, gateway/src/routes/discovery.ts, new BulkReviewDiscoveryFindingsRequest/Response.java DTOs + DiscoveryFindingBulkReviewTest.java.

CONVENTIONS: AMS speaks snake_case at the wire by default (finding statuses + bulk-review DTOs are AMS-owned; see repo CLAUDE.md). NEVER edit an applied Liquibase changeset — new changeset + data migration if stored vocabulary changes. Findings are persisted migration REALITY (the oracle), not meta-model entity proposals.
