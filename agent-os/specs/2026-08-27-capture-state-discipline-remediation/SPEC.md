# Capture & Reconciliation — State-Discipline Remediation Program

Genericized working spec (2026-08-27), derived from the owner's design review
of a full diagnostic capture run against the estate. All estate tokens are
replaced with the invented vocabulary (deal_book-class = huge batch-owned
read tables; screen_filter / filter_tag / view_registry / seq_registry =
API write surface; markFavourite-style = keyed toggle ops). The owner's
design MD stays OUT of this repo by standing rule.

## The invariant

The source baseline was captured with every call bracketed back to its
starting state, so every source scenario observed identical state. For a
later reconciliation to be meaningful, every target scenario must likewise
observe the freshly-migrated state. If a single undo fails and the run
continues, later scenarios read drifted state and produce responses that
differ from the baseline — false breaks that are artefacts of the run, not
migration defects; they compound toward the end. Hence: on the rec side
quarantine-and-continue is WRONG and halting is the overnight-stop problem —
the answer is provably HEAL and continue.

## Environment model (rulings)

- Capture (LLM, legacy API) and migration+reconciliation share the UAT env:
  capture must not leave drift behind (it would be migrated and reconciled
  against a baseline from a different state).
- Both baseline and target derive from the SAME S0 → strict comparison is
  correct; no canonicaliser, no ID/date mask lists, no strict-vs-shape UI
  toggle (all deliberately dropped). Existing per-endpoint value-tolerance +
  field-level waiver seams are the only relaxations, surfaced read-only.
- Prod is data-parity (DB↔DB) only — cross-data comparison mode out of scope.
- Key estate insight: every table the API writes is SMALL; the huge tables
  are written only by batch, and enter brackets as READ-mapped tables only.

## Decisions pinned in review (owner-confirmed)

1. Terminal status name: `completed_with_findings` (AMS enum) — a run that
   finished, healed what it could, and flagged the rest is NOT `failed`.
   Applied when manual_rec_required or state_healed findings exist.
2. Item #5: strict compare; body cap configurable, default 8 MB, UI-exposed.
3. One `contract_gap` diagnostic type with detail reason
   (`no_negative_available` | `format_variant_impossible`).
4. Four-eyes mechanism: NO per-op checkbox (per-session rows are re-created
   every project — forgetting produces a healthy-looking gap). Instead:
   `execute_http_request` gains optional `useSecondIdentity` (rides
   `requestWithAuthOverride`), the system prompt steers the LLM to retry
   once with the second identity on a "cannot act on own resource"
   permission error, and to record `manual_rec_required` when no second
   token is loaded. Estate pre-checks (finding a user with existing edit
   tags) are skipped for v1.
5. Restore gate (Item #6): blocking modal with an explicit "proceed anyway"
   override that is itself recorded — never a dead button (standing
   staleness-is-a-signal ruling). Gate both rec entry and migrate entry.
6. Budget split (Item #3), grounded in THIS tree: the per-scenario HTTP cap
   (`LLM_HTTP_ATTEMPTS_PER_SCENARIO`) counts every call including setup —
   that is what exhausted the format-fallback one call short. Fix: the
   primary cap becomes TARGET-scoped (template matching, same as the
   fired-attempt budget) and setup calls get their own
   `LLM_SETUP_ATTEMPTS_PER_SCENARIO` (default 10, env-only).
7. Wall-clock-in-body: nothing built; if the estate ever surfaces a now()
   field in a body, the existing field-level waiver seam covers it as
   config. Owner to confirm with the estate assistant at leisure.
8. Sybase ASE has no cheap aggregate whole-table checksum → Tier 3 stays
   count+max(PK). Honest floor: for PK-less count-only tables the S0
   fingerprint backstop is also count-based, so an in-place UPDATE on a
   huge batch table is invisible to both — surfaced as a named gap.

## Work items (dependency order)

1. **Taxonomy + status (Item #2 + §6).** New diagnostic types:
   `captured_ok` (clean success), `contract_gap` (reason in detail),
   `manual_rec_required` (excluded from score), `state_healed`
   (orchestrator-emitted heal receipt; not offered to the LLM). New
   terminal status `completed_with_findings` (AMS ALLOWED_STATUSES +
   TERMINAL_STATUSES, AMVS types, frontend chip, coverage summary).
   Future runs only — no retro-fix of stored diagnostics. Plus
   `.gitignore` for `api-migration-validation-service/s0-snapshots/`.
2. **Scoped-row imaging + reseed (Item #1).** Tier policy per
   (table, request): write-mapped ≤ cap → full image (exact undo,
   unchanged); write-mapped > cap → Tier 1 per-call scoped image on
   derivable keys (path/query param name ≈ PK column, case/underscore
   fold) via a bracket collector threaded into `execute_http_request`;
   plus Tier 2 new-row sweep (max(PK)-before, delete PK>max on undo);
   read-mapped any size → Tier 3 count+max(PK) guard, never imaged;
   sequence-generator tables always fully imaged (tiny — undo restores
   the counter row, which IS the sequence reseed for table-based
   sequences); identity columns reseeded via `buildReseedStatements` on
   every undo. Guard moved on a read table ⇒ mis-mined write detected ⇒
   heal (phase 4) or attributed residue. The 100k cap stays as the
   write-side sanity guard only.
3. **Replay read-mapped blind spot (Item #8).** `seqProvenRead` and both
   replay bracket sites consult read-mapped tables (union), mirroring the
   capture side.
4. **Heal, don't halt (Item #7 — the most important).** Pre-rec snapshot
   of bracket-scope-under-cap tables (write ∪ small-read ∪ sequence) on
   the TARGET via the S0 snapshot machinery (stored `rec-<sessionId>`);
   on residue: heal the affected table with minimal-diff single-table
   restore from that snapshot, emit `state_healed`, continue; stop ONLY
   when a non-snapshotted table drifted (documented remedy = re-run the
   migration load; `migrateOneTable` exported as the fallback seam).
   Receipts: write-surface fingerprint at rec start and end. Capture side
   made symmetric: heal from the pinned S0 snapshot instead of halting;
   quarantine/halt survives only for never-dumped tables.
5. **Body cap + capture tuning (Item #5 + S-1).** `MAX_RESPONSE_BODY_BYTES`
   configurable (default 8 MB) with full-body retention below the cap;
   AMS `capture_tuning_json` on capture sessions; wizard "Capture tuning"
   section (LLM per-round timeout, body cap; env-only budgets shown as
   text). Comparator relies on strict compare + existing tolerance seams.
6. **Second identity (Item #4).** Optional second token in wizard Step 2 +
   secrets bundle; `useSecondIdentity` tool arg; loud tool error naming
   `manual_rec_required` when absent; excluded from coverage score.
7. **Budget split (Item #3) + restore gate (Item #6).** As pinned above;
   restore receipts recorded as `s0_restore_recorded` diagnostics on the
   session; rec/migrate entry checks receipt-after-capture, blocking modal
   with recorded override.
8. **Smaller items.** S-2: not-found oracles use reserved/extreme-range ids
   (caches front reads — DB COUNT=0 ≠ API absence). S-3: a format variant
   whose captures are systematically 415 ⇒ `contract_gap`
   (format_variant_impossible), not failures.

## Risk register (carried from review)

PK requirement (PK-less = named gap, never healthy-looking); reseed is
load-bearing under strict compare; Tier-3 misses no-count-change UPDATEs
(fingerprint count-only for undumped tables — named gap); heuristic key
derivation falls back to Tier 2+3; two four-eyes endpoints uncaptured
without the second token (manual_rec_required); no-halt floor = a
never-snapshotted table drifting stops the run (should be unreachable);
phase 4 must not ship before phase 1's status reclassification.

## Validation

No full overnight run to validate: owner runs a ~3-endpoint smoke capture
on the work machine after cloning (one keyed write op with a huge read
table → cap never fires; one proven-read op → defensive bracket cheap;
one impossible-format op → contract_gap label).

## BUILD-LOG

(One entry per merged phase, appended below.)
