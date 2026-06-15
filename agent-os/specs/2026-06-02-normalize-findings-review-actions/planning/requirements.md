# Spec Requirements: Normalize Findings Review Actions (Spec F)

## Initial Description

"Spec F" — the FIRST of a 5-spec program (Spec F → Spec 0 → 1 → 2 → 3) that
unifies + aggregates discovery review and adds a conversational "Architect"
review persona. Spec F is a small, FOUNDATIONAL consistency cleanup the later
specs depend on: the unified grid + conversation review must use ONE
disposition vocabulary across architecture CANDIDATES and discovery FINDINGS.

Today discovery FINDINGS overload a single `status` field with five values
(`new`, `accepted`, `ignored`, `needs_review`, `resolved`) that conflate (1) a
scope/relevance disposition with (2) an issue-tracker workflow. Architecture
CANDIDATES instead use a clean, dedicated disposition vocabulary (Approve /
Reject / Defer). The goal is to make findings speak the same disposition
language as candidates so the grid and the future unified review conversation
are consistent, and to demote `resolved` from a human review choice to a
system-owned lifecycle state.

This is SHAPING ONLY. No spec is written here; this file records the grounded
research and the open product decisions to put to the user.

## Research Summary (file:line evidence)

### A. Findings status model today (the thing being normalized)

- **Single overloaded `status` field.** `discovery_findings.status` is
  `TEXT NOT NULL DEFAULT 'new'` with **NO CHECK constraint** — deliberately
  stored as free TEXT "for pack-extensibility without DDL"
  (`architecture-model-service/.../db/changelog/sql/135-discovery-findings.sql:38`;
  column COMMENT documenting the v1 vocabulary at lines 72-73). Entity mirror:
  `DiscoveryFindingEntity.status` defaults `"new"`
  (`.../model/entity/discovery/DiscoveryFindingEntity.java:119-121`). DTO field
  is a plain `String status` (`.../model/dto/discovery/DiscoveryFindingDto.java:46`).
- **Allowed values + transitions live in one service.**
  `DiscoveryFindingService.ALLOWED_STATUSES = { new, accepted, ignored,
  needs_review, resolved }` (`DiscoveryFindingService.java:126-127`);
  `ALLOWED_REVIEWER_STATUSES = { accepted, ignored, needs_review, resolved }`
  (lines 136-137); `ALLOWED_TRANSITIONS` map (lines 171-177). Re-open semantics:
  `accepted | ignored | resolved` can all transition to `needs_review`;
  `resolved -> needs_review` is the ONLY exit from `resolved` (line 176). Backwards
  moves to `new` are rejected. The transition guard is enforced in
  `applyStatusChange(...)` (lines 913-942) — the single mutator reused by single-row
  `review` (line 402), PATCH `update` (line 859), and the bulk loop (line 515).
- **Frontend action verbs / labels (the user-facing inconsistency).**
  `FindingsTab.tsx` maps the four reviewer statuses to button labels via
  `STATUS_BUTTON_LABEL` (`FindingsTab.tsx:361-367`): `accepted→"Accept"`,
  `ignored→"Ignore"`, `needs_review→"Needs Review"`, `resolved→"Mark Resolved"`;
  and display labels via `STATUS_DISPLAY_LABEL` (lines 369-375). Summary pills:
  Total / Critical+High / Needs Review / Accepted / Ignored / Resolved
  (lines 838-867). Status filter dropdown hardcodes the five raw values as
  `<option>`s (lines 882-888). Status badge CSS keyed on the five values
  (lines 82-95). The TypeScript union `DiscoveryFindingStatus` enumerates the
  five (`findingsApi.ts:107-112`).

### B. Candidate disposition model (the parity target)

- **Candidates use a SEPARATE `review_status` field, distinct from `status`.**
  This is the structural difference from findings. `DiscoveryCandidateEntity`
  has BOTH a synthesis-lifecycle `status` (default `"proposed"`; values
  proposed/accepted/rejected/merged) AND a human-review `review_status`
  (default `"pending_review"`) — two columns, two indexes
  (`DiscoveryCandidateEntity.java:84-86` for `status`; `159-161` for
  `reviewStatus`; index `idx_discovery_candidate_run_id_review_status` at
  line 58).
- **Canonical disposition vocabulary = `pending_review` → `approved` /
  `rejected` / `deferred`.** `DiscoveryCandidateService.VALID_REVIEW_STATUSES =
  { approved, rejected, deferred }` (`DiscoveryCandidateService.java:60`); the
  review method validates against it and errors otherwise (lines 399-402).
  `reviewCandidate(...)` captures `previous_review_status` before overwriting
  (lines 413-420) — a lightweight audit/re-open trail findings DO NOT have.
  A "committed" review_status is added downstream by the MCP save-back path
  (not a human action; see E).
- **Candidate UI verbs are "Approve / Reject / Defer".**
  `DiscoveryCandidateTable.tsx` exposes inline per-row Approve/Reject/Defer
  buttons + bulk "Approve All / Reject All / Approve Filtered" + filter chips
  "All, Pending, Approved, Rejected, Deferred", and row-tints
  green/red/grey for approved/rejected/deferred
  (`DiscoveryCandidateTable.tsx:81-85, 564-601, 873-879`).
- **Candidate gateway proxy hardcodes the disposition vocabulary.** The
  candidate bulk-review route validates `review_status` against the literal
  `['approved','rejected','deferred']` (`gateway/src/routes/discovery.ts:1281`).
  Contrast with findings (see D): the findings proxy does NOT inspect status.

### C. In-flight bulk-findings-actions work to reconcile (uncommitted)

Spec at `agent-os/specs/2026-05-28-bulk-findings-actions/` (spec.md +
planning/requirements.md). Built + verified, NOT yet committed.

- **New DTOs:** `BulkReviewDiscoveryFindingsRequest` (with nested `Filter`
  record) + `BulkReviewDiscoveryFindingsResponse` (with `SkippedByReason` +
  `delta_by_from_status`). Endpoint
  `POST .../findings/bulk-review` (`DiscoveryFindingController.java:147-162`);
  service `bulkReview(...)` (`DiscoveryFindingService.java:460-537`).
- **The bulk action verbs map 1:1 onto the SAME raw status values.** The
  toolbar buttons are `[Accept][Ignore][Needs Review][Mark Resolved]` →
  request `status` of `accepted|ignored|needs_review|resolved`
  (`FindingsTab.tsx:354-359` `BULK_TARGET_STATUSES`; modal title "Mark {X}
  findings as {Status}"; spec.md lines 4, 53). The endpoint reuses
  `ALLOWED_REVIEWER_STATUSES`, `ALLOWED_TRANSITIONS`, and `applyStatusChange`
  VERBATIM (spec.md lines 27, 87-91) and skips-instead-of-throws on forbidden
  transitions (e.g. `resolved -> accepted`).
- **`delta_by_from_status` keys ARE the stored status strings.** The response
  map is keyed by pre-mutation status (`new`, `needs_review`, `accepted`,
  `ignored`, `resolved`) and the frontend switches on those exact strings to
  delta the pills (`findingsApi.ts:304-319`; `FindingsTab.tsx:674-712`).
  **Implication:** if stored values change, this contract (Java accumulator
  keys + TS switch) changes in lockstep; if only labels change, this contract
  is untouched. The 2026-05-28 spec explicitly lists "Schema or wire-shape
  changes to `discovery_findings`" and "Bulk reverting to `status='new'`" as
  OUT of scope (spec.md lines 114, 119) — so it does NOT itself fight a rename,
  but it is the largest single surface a rename must update.

### D. Blast radius of a stored-value rename (who reads the values)

- **AMS (owner):** `DiscoveryFindingService` constants + transitions (above),
  the entity default, the 135 changeset column DEFAULT + COMMENT. A rename =
  new Liquibase changeset with an `UPDATE discovery_findings SET status=...`
  data migration + COMMENT refresh. No CHECK constraint to drop (it never
  existed). Plus the two new bulk DTOs' Javadoc/validation messages.
- **Gateway:** the findings proxy is a **thin pass-through** —
  `proxyFindingsToAms(...)` forwards body + query verbatim and never inspects
  or rewrites the finding `status` (`gateway/src/routes/discovery.ts:2495`,
  routes at 2620-2790). So a findings-status rename needs **NO gateway logic
  change** (only test fixtures that assert specific status strings, e.g.
  `discovery-findings-bulk-review-proxy.test.ts`). This is the opposite of
  candidates, whose gateway route hardcodes the vocabulary (C).
- **discovery-service:** `FindingEmitter` defines its own
  `FindingStatus` type + `VALID_STATUSES` set listing all five
  (`discovery-service/src/services/findings/FindingEmitter.ts:66-78`). BUT the
  pipeline only ever EMITS `status: 'new'` (default; D5). Every `status:
  'proposed'` in the pack scanners is CANDIDATE status, a different field
  entirely (e.g. `contractCandidates.ts:128`). **No scanner ever emits
  `accepted/ignored/needs_review/resolved`.** So the discovery-service touch is
  limited to the `VALID_STATUSES`/`FindingStatus` defensive list — and only
  matters at all if a renamed value were ever emitted (it is not today). The
  archModelClient findings test references a `from_status: 'resolved'` fixture
  (`archModelClientFindings.test.ts:281`).
- **mcp-server:** `review_status`/`needs_review`/`ignored` hits in
  `mcp-server/src` are ALL about CANDIDATES (save-back gates on
  candidate `review_status === 'approved'`, excludes `rejected`/`deferred`/
  `committed`; `candidateSaveBackService.ts`, `saveApprovedCandidatesRoute.ts`,
  `archModelClient.ts:107-110`). **mcp-server does NOT read finding status at
  all** — it is OUT of the findings blast radius.
- **Net blast radius for a stored rename:** AMS (service + entity + changeset +
  2 bulk DTOs) + frontend (`findingsApi.ts` union, `FindingsTab.tsx` labels +
  pills + filter options + badge CSS, the bulk modal, and the `.bulk.test.tsx`
  / `FindingsTab.dataLayerFidelity2.test.tsx` fixtures) + a defensive line in
  discovery-service `FindingEmitter` + several test fixtures. NOT gateway logic,
  NOT mcp-server.

### E. Where `resolved` is set today — system vs user (the Q3 evidence)

- **There is NO auto-resolution path anywhere.** No code in AMS or
  discovery-service ever programmatically transitions a finding to `resolved`.
  Every `'resolved'` literal found in discovery-service is either a
  decision-task status (`decisionTask.ts:69`, `gatewayClient.ts:17`,
  `runManager.ts:830`) or the English word resolved/unresolved in prose. The
  ONLY thing that sets finding `status='resolved'` today is the human clicking
  "Mark Resolved" in the drawer or the bulk toolbar.
- The evidence-gap scanner (`evidenceGapScanner.ts`) emits gap findings with
  the DEFAULT status (`new`) and has no notion of later auto-resolving them
  when the gap is filled.
- **Therefore the raw-idea's framing of `resolved` as "a system-set lifecycle
  state the system auto-marks once the gap is filled" describes a capability
  that DOES NOT EXIST yet.** Demoting `resolved` to system-only would today
  REMOVE the only way it is ever set (the user button) and leave it unreachable
  until/unless a future spec builds the auto-resolver. This is a real product
  decision, not a relabel — surfaced as Q3.

### F. Initial-state parity gap (a new question the research surfaced)

Findings default to `new`; candidates default to `pending_review`. If the goal
is ONE vocabulary across both, the pre-review state name also diverges
(`new` vs `pending_review`). Whether Spec F unifies the pre-review state too,
or leaves `new`/`pending_review` as-is, is an open scope decision (Q7).

### G. Architecture difference that shapes the whole spec (one field vs two)

Candidates separate `status` (synthesis lifecycle) from `review_status` (human
disposition) — two columns. Findings have ONE `status` column doing both jobs.
True structural parity ("findings get a dedicated `review_status` column too,
leaving a separate lifecycle field for `new`/`resolved`") is a much larger
change than renaming values inside the single existing column. Which level of
parity is intended — vocabulary-only vs structural — is the highest-leverage
decision (Q1/Q2 frame it; Q8 makes the structural option explicit).

## Existing Code to Reference

**Similar Features Identified (parity target — candidates):**
- Candidate disposition service: `architecture-model-service/.../service/DiscoveryCandidateService.java`
  (`VALID_REVIEW_STATUSES` line 60; `reviewCandidate` 394-427; `previous_review_status` capture 413-420).
- Candidate entity (two-field model): `architecture-model-service/.../model/entity/DiscoveryCandidateEntity.java`
  (`status` 84-86; `reviewStatus` 159-161).
- Candidate review UI verbs: `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`
  (Approve/Reject/Defer + filter chips + row-tints).
- Candidate gateway proxy (vocabulary hardcode precedent): `gateway/src/routes/discovery.ts:1276-1375`.

**Code under change (findings):**
- `architecture-model-service/.../service/discovery/DiscoveryFindingService.java`
- `architecture-model-service/.../controller/discovery/DiscoveryFindingController.java`
- `architecture-model-service/.../model/entity/discovery/DiscoveryFindingEntity.java`
- `architecture-model-service/.../model/dto/discovery/DiscoveryFindingDto.java`
- `architecture-model-service/.../db/changelog/sql/135-discovery-findings.sql` (immutable — needs a NEW changeset)
- `frontend/src/api/findingsApi.ts`, `frontend/src/components/Discovery/FindingsTab.tsx`,
  `FindingsTab.module.css`, `BulkFindingActionConfirmModal.tsx`
- `discovery-service/src/services/findings/FindingEmitter.ts` (defensive `VALID_STATUSES` only)

**In-flight, must reconcile (uncommitted):**
- `agent-os/specs/2026-05-28-bulk-findings-actions/` (spec.md, planning/requirements.md, tasks.md)
- New DTOs `BulkReviewDiscoveryFindingsRequest.java` / `BulkReviewDiscoveryFindingsResponse.java`
- `DiscoveryFindingBulkReviewTest.java`, `FindingsTab.bulk.test.tsx`,
  `gateway/src/__tests__/discovery-findings-bulk-review-proxy.test.ts`

## Visual Assets

### Files Provided:
No visual assets provided (mandatory `ls` of
`planning/visuals/` returned no image files).

## Open Questions To Put To The User

These are the 6 from the brief, refined by the research above, plus 3 new ones
(Q7-Q9) the research surfaced. NOT auto-resolved — each is a product/design call.

**Q1 — One word everywhere: "Approve" or "Accept" (and "Defer" or "Needs
Review")?**
Findings today say "Accept / Ignore / Needs Review / Mark Resolved"; candidates
say "Approve / Reject / Defer". For ONE vocabulary, do candidates adopt findings'
"Accept", or do findings adopt candidates' "Approve"? (Recommend findings adopt
candidates' verbs — candidates' `approved/rejected/deferred` is already the wired
contract in gateway, mcp-server save-back, and the candidate UI; flipping
candidates would ripple far wider. But this is your call.) Confirm the exact
target set, e.g. `Approve / Reject / Defer`.

**Q2 — Stored-value migration vs UI-only relabel?**
Two materially different efforts:
 (a) **Relabel only** — keep stored values `accepted/ignored/needs_review/
 resolved`, change ONLY the button text + display labels + pill labels in the
 frontend. Zero migration, zero API change, zero conflict with the in-flight
 bulk DTOs. Cheapest; but the wire/DB still says `ignored` while the UI says
 "Reject", so the vocabularies are aligned only at the glass.
 (b) **Rename stored values** — e.g. `ignored→rejected`, `needs_review→
 deferred`, `accepted→approved`. Requires a new Liquibase changeset + data
 migration (no CHECK to drop — it never existed), AMS constant/transition-map
 edits, the two in-flight bulk DTOs' value lists + `delta_by_from_status` keys,
 the frontend union/labels/filters, and a defensive line in discovery-service.
 True end-to-end parity; larger, and must land coordinated with the uncommitted
 2026-05-28 work. Which do you want?

**Q3 — `resolved`: confirm there is no built auto-resolver — so what happens to
the only path that sets it (the user button)?**
Research finding: nothing in the system auto-sets `resolved` today; the human
"Mark Resolved" button is the ONLY writer. Options:
 (a) **Drop `resolved` as a human action now, build the auto-resolver later** —
 demote per the raw idea, accept that `resolved` becomes temporarily unreachable
 until a later spec adds gap-fill auto-resolution. Defines WHO/WHAT will set it
 (future evidence-gap auto-resolver).
 (b) **Keep a manual "resolved"** if reviewers genuinely need a "this finding is
 handled / closed" terminal state distinct from Approve/Reject/Defer — in which
 case it stays a 4th human choice and the "human review has exactly 3 choices"
 goal is relaxed.
 (c) **Build the auto-resolver as part of Spec F** (largest scope; pulls
 evidence-gap lifecycle into this foundational spec).
 Which? And if (a)/(c): what is the precise trigger that flips a finding to
 `resolved` (e.g. the linked candidate gained the missing attribute)?

**Q4 — `defer` (was `needs_review`): keep "re-open from any state" semantics?**
Findings' `needs_review` is reachable from `accepted`, `ignored`, AND `resolved`
(it is the universal re-open target). Candidate `deferred` is just one of three
peer dispositions and does not carry special re-open meaning, though candidates
DO record `previous_review_status` on every transition. Do you want findings'
`defer` to retain the "re-open from anywhere" power (i.e. keep the current
transition graph, just renamed), or to become a plain peer disposition matching
candidate `deferred` exactly (and should findings start recording
`previous_review_status` like candidates do)?

**Q5 — Confirm blast radius is contained (AMS + frontend), NOT gateway logic /
mcp-server.**
Research says: the findings gateway proxy is a verbatim pass-through (no status
inspection) and mcp-server never reads finding status — both are OUT of the
findings rename radius (gateway needs only test-fixture updates; mcp-server
nothing). discovery-service has only a defensive `VALID_STATUSES` list and never
emits anything but `new`. Do you accept this scoping (so the spec targets AMS +
frontend + the in-flight bulk work + a one-line discovery-service defensive
update + test fixtures), or do you want the discovery-service emit path and
gateway proxy explicitly in scope anyway for belt-and-braces?

**Q6 — Reconciling the uncommitted 2026-05-28 bulk-findings-actions work.**
That work is built but uncommitted and hardwires the four raw status values into
its DTOs, its `delta_by_from_status` keys, the toolbar buttons
(`[Accept][Ignore][Needs Review][Mark Resolved]`), the modal title, and ~13-15
tests. Under Q2(b) it must be updated in lockstep (no conflict, but real edits to
DTO value lists, response-map keys, button labels, and every test asserting a
status string). Under Q2(a) only its button/label text changes. Preference on
sequencing: (i) commit 2026-05-28 first, then Spec F edits it; (ii) fold the
2026-05-28 changes INTO Spec F so they land together already-normalized; or
(iii) rebase 2026-05-28 onto the new vocabulary before committing? Also: should
the bulk toolbar additionally drop the "Mark Resolved" button if Q3 demotes
`resolved` to system-only?

**Q7 (new) — Unify the PRE-review state too (`new` vs `pending_review`)?**
Findings default to `new`; candidates default to `pending_review`. If the point
is one vocabulary across both, the un-reviewed state name also diverges. Do you
want Spec F to also align the pre-review state (e.g. findings adopt
`pending_review`, or candidates adopt `new`), or leave the initial states
as-is and only unify the three dispositions?

**Q8 (new) — Vocabulary parity only, or STRUCTURAL parity (give findings a
dedicated `review_status` column)?**
Candidates have TWO fields — a synthesis `status` AND a separate human
`review_status`. Findings cram both jobs into one `status` column. The cleanest
long-term parity is to split findings the same way (a lifecycle field holding
`new`/`resolved`, plus a `review_status` holding `approved`/`rejected`/
`deferred`), which also makes Q3's system-vs-human separation structural rather
than conventional. That is a bigger schema change than renaming values in place.
For this FOUNDATIONAL spec, do you want: (a) vocabulary normalization within the
single existing `status` column, or (b) the full two-column structural split to
mirror candidates exactly? (Recommend (a) for a "small foundational cleanup";
flag (b) if you want the later unified-grid specs to treat findings and
candidates with identical field shapes.)

**Q9 (new) — Reviewer-facing transition rules under the new vocabulary.**
Whatever the names, the current findings transition graph forbids some moves
(e.g. `resolved → accepted` is blocked; only `resolved → needs_review`) and the
bulk endpoint SKIPS rather than errors on forbidden moves. Should the normalized
findings keep this exact transition graph (renamed), adopt the candidate model
where any disposition can move to any other freely (candidates have no
transition restrictions — `reviewCandidate` accepts any of the three from any
state), or something else? This determines whether the `ALLOWED_TRANSITIONS` map
survives, is loosened to match candidates, or is removed.

## Notes for the spec writer

- AMS speaks snake_case at the wire by default; the new bulk DTOs are AMS-owned
  and rely on the global `SNAKE_CASE` strategy (no `@CamelCaseWire`). A rename
  changes wire string VALUES, not field naming.
- 135-discovery-findings.sql is an applied changeset — any stored-value change
  needs a NEW changeset (never edit the applied one) with an `UPDATE` migration
  and a refreshed COLUMN COMMENT.
- The 2026-05-28 bulk-findings-actions work is built but UNCOMMITTED — the spec
  writer must treat it as the live baseline to reconcile against, not as
  already-shipped history.
- Findings are persisted migration REALITY (the oracle), not meta-model entity
  proposals — the disposition is "is this finding worth keeping/acting on",
  parallel to a candidate's "should this proposal be approved".

## Resolved Decisions (user-confirmed 2026-06-02)

All six relayed decisions confirmed. Mapping to the questions above:

- **Q1 — Vocabulary:** Findings adopt the candidates' verbs **Approve / Reject /
  Defer**. Target stored disposition values: `approved` / `rejected` / `deferred`.
- **Q2 — Stored rename (option b), NOT UI-only.** Migrate persisted values via a
  NEW Liquibase changeset + `UPDATE` + refreshed COLUMN COMMENT:
  `accepted→approved`, `ignored→rejected`, `needs_review→deferred`,
  `new→pending_review` (Q7), `resolved→approved` (Q3).
- **Q3 — `resolved`:** Drop as a human action (remove the drawer + bulk "Mark
  Resolved" buttons). Migrate existing `resolved` rows → `approved`. The
  "auto-resolve a filled evidence-gap" lifecycle is explicitly OUT of Spec F (no
  auto-resolver is built here; a later spec may add it).
- **Q4 + Q9 — Transitions / history:** Adopt the candidate model — **any
  disposition → any disposition** (remove the restrictive `ALLOWED_TRANSITIONS`
  map; the bulk endpoint no longer skips on "forbidden" transitions). Start
  recording **`previous_review_status`** on every transition, mirroring
  candidates (subsumes the old "re-open from anywhere" need).
- **Q5 — Blast radius (confirmed contained):** AMS (service + entity + DTO + new
  changeset + the two in-flight bulk DTOs) + frontend (findingsApi union/labels/
  pills/filters/badge CSS + bulk modal + test fixtures) + a small
  discovery-service emit update + test fixtures. Gateway findings proxy stays a
  verbatim pass-through (test-fixture updates only, NO logic). mcp-server OUT.
- **Q6 — Sequencing:** The uncommitted `2026-05-28-bulk-findings-actions` work is
  **committed first as the baseline** (user-owned commit), then Spec F normalizes
  the base model AND that bulk surface in one coordinated pass. The bulk "Mark
  Resolved" button is dropped (per Q3).
- **Q7 — Pre-review state unified:** `new` → `pending_review` (matches candidates).
- **Q8 — Single RENAMED column (NOT a two-column split):** Rename the existing
  findings column `status` → **`review_status`**. Because `resolved` is retired
  and `new`→`pending_review`, the single column now carries only dispositions
  {`pending_review`, `approved`, `rejected`, `deferred`}, so NO separate
  synthesis/lifecycle column is added. Add `previous_review_status` (nullable)
  for the audit/re-open trail.

### Net end state for the spec writer
- `discovery_findings.review_status` (renamed from `status`): `TEXT`, default
  `pending_review`, values {`pending_review`, `approved`, `rejected`,
  `deferred`}; NO CHECK constraint (keep today's free-text + pack-extensibility).
- `discovery_findings.previous_review_status`: nullable `TEXT`, set on each
  transition.
- Transitions unrestricted (any→any). `ALLOWED_TRANSITIONS` removed;
  `ALLOWED_REVIEWER_STATUSES` becomes {`approved`, `rejected`, `deferred`}.
- All of `new` / `accepted` / `ignored` / `needs_review` / `resolved` retired via
  the data migration.
- Human review surface (drawer + bulk) = exactly **Approve / Reject / Defer**;
  the "Mark Resolved" and "Needs Review" buttons are removed.

### Open cost-flag for the user on Q8 (the column rename)
The COLUMN rename (`status`→`review_status`) widens the surface beyond a
values-only change — it also touches the DTO field name, the discovery-service
emit field (currently emits `status:'new'` → would emit
`review_status:'pending_review'`, or omit and let AMS default), and the
`delta_by_from_status` response-map key naming in the in-flight bulk work. If the
user prefers to keep the column NAMED `status` and only align its VALUES (still
full vocabulary parity; the shared review logic in Specs 1/3 can map the field
name), Spec F shrinks accordingly. **Decision stands as the rename unless the
user downgrades.**
