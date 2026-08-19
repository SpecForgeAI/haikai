# Capture-State Discipline & Log-Replay Reconciliation — Design Agreement (2026-08-18)

Agreed in discussion 2026-08-18 (separate topic from, and independent of, the SCL
pipeline design — see `2026-08-18-scl-pipeline-design.md`). Trigger: baseline
capture executes mutating endpoints (POST/PUT/PATCH/DELETE) against the live
legacy database with no state isolation. Two symptoms, one root cause:

1. The legacy DB is corrupted by capture (writes, retry duplicates, LLM
   learned-fact chains), and the corruption propagates — the DB-plane data load
   reads the LIVE post-capture source DB, so capture artifacts migrate into the
   target as business data.
2. The baseline is a path-dependent TRACE through successive states, not a set
   of samples of one state: capture #2 of current state cannot reproduce
   capture #1; scoped re-reconciles and per-endpoint re-captures replay a
   subset of a trace from the wrong state; reconcile carries a permanent
   state-artifact false-break floor.

Root diagnosis: reconcile is only meaningful if every baseline item is a sample
of ONE canonical database state. Everything below serves that invariant.

## Doctrine

- **S0 is the law.** S0 = the pinned canonical source-DB state, established by
  snapshot before the first capture. Every capture, re-capture, target replay,
  scoped re-reconcile, and the migration data dump reference the same S0. The
  live source DB IS S0 at all times outside an executing compensation bracket.
- **Compensation is derived, never authored.** Per-endpoint hand-written undo
  SQL is rejected (drifts, must be correct twice, needs a dialect twin for the
  target). Compensation is computed generically: before-image → inverse diff →
  verify.
- **Compensation is verified or it didn't happen.** An undo that cannot prove
  byte-parity restoration fails that capture LOUDLY. A half-working undo that
  reports pristine state is worse than no undo.
- **Both sides, symmetrically.** The same compensation engine runs against the
  source during capture and against the target during reconcile replay
  (dialect-neutral through the existing DB adapters). Ruling: the target DB is
  treated as NON-disposable.

## Mechanism 1 (primary): derived per-sequence compensation

Bracket around every mutating scenario SEQUENCE (not every call — intentional
chained lifecycles like create→read-back→delete complete first; the bracket
wraps the sequence; every sequence starts from S0):

1. Before-image the endpoint's effect tables (keyed rows; PKs from the
   harvested `constraints_metadata`).
2. Fire the call(s); capture the response(s) (existing machinery unchanged).
3. Compute row-level diff (after vs before) and apply the inverse: delete rows
   that appeared, re-insert rows that vanished, restore columns that changed.
4. Re-snapshot and VERIFY byte-parity with the before-image. Residue → loud
   fail on that capture + finding; the S0 snapshot (mechanism 2) is the
   recovery path.
5. Reseed identity after undoing INSERTs (privileges confirmed) so replayed
   POSTs mint the SAME ids the baseline recorded — kills the id-volatility
   class entirely.

Foundations that already exist: effect-table map = committed
`endpoint_data_effects` (write / read-write edges) as used by `stateDelta.ts`;
keyed-row before/after snapshots (`snapshotEffectTables`); dual-dialect DB
adapters (source + target, already used live by data-parity); bracket seam =
`execute_http_request.ts` (source) and `targetReplayRunner.ts` (target).

SCL cross-check (soft dependency, lands when both programs exist): `[Q-]`
boundary contracts carry the verbatim SQL each endpoint runs — a write to a
table absent from the effect map is a FINDING before it becomes a bad undo.

Known residuals (accepted, visible): triggers/cascades writing outside the
effect map (bounded by the FK/trigger harvest; caught by the verification
sweep); out-of-DB side effects (outbound calls, MQ) — out of scope, declared
as findings; precondition = exclusive use of the source DB (confirmed: user
has exclusive use for the whole migration).

## Mechanism 2 (safety net): S0 snapshot, fingerprint, restore

**Ruling (2026-08-19): S0 pinning is AUTOMATIC — the DB scan and the S0
snapshot are ONE user action.** A successful database discovery scan
triggers the snapshot immediately at completion, using the scan's OWN
harvested metadata (tables / PKs / identity — no save-back wait) and the
same credentials the scan just used. The outcome (taken / failed / skipped,
snapshot id, reason) rides the scan run's steps payload. Fail-soft + loud: a
snapshot failure never fails the scan. The validation-service route remains
as the manual/recovery path only; there is deliberately NO separate S0 UI.

- **Logical snapshot, existing machinery**: bulk-read S0 to files via the
  uncapped keyset-paginated reader (data plane); restore = truncate + bulk-in
  (mirrors target load). Dialect-neutral. No native dump/load ops dependency.
- **The S0 snapshot IS the migration dump artifact** (or the dump is taken
  from it) — this is what aligns the target's loaded state with the state the
  baseline sampled. Never dump the live DB independently of S0.
- **End-of-job verification, not routine restore**: after every capture /
  replay job, fingerprint the live DB (row counts + per-table checksums via
  the adapters) against S0. Green → no restore (compensation already held the
  invariant). Residue → loud halt + restore from snapshot.
- Target restore = re-run the existing truncate-and-load from the S0 dump.

## Credential-role split

Observational paths (discovery sampling, `sample_db_values`, state snapshots,
parity counts, fingerprints) use a READ-ONLY login. Only the compensation /
restore path holds write credentials, and only inside the verified bracket.
(Environment fact: the available write login is dbo-mapped — full DML/DDL —
which covers inverse apply, truncate/reload, and identity reseed; a read-only
group exists and should be used for everything else.)

## Effect on reconcile semantics

Every baseline item samples S0 → capture is repeatable (capture #2 ≡ capture
#1 modulo genuine volatility); scoped re-reconcile and per-endpoint re-capture
become VALID (no trace prefix needed); target replay compares f(request, S0)
vs f'(request, S0); the noise floor shrinks to genuine time-based volatility,
which the existing volatility machinery already handles. Existing comparison,
volatility, disposition, and pairing logic: UNCHANGED.

## Log-replay reconciliation ("round 2")

**Ruling: the timing/NFR replay idea is ABANDONED entirely.** Functional
sequential replay only.

- **Logs supply REQUESTS, never oracles.** Logged responses are answers about
  production state at logging time, not S0 — ignored even when present. The
  oracle is the live current-state system at S0.
- **Architecture: a second baseline family through the SAME pipeline.**
  Log-mining ingester → deterministic replay-capture against current (NO LLM —
  requests arrive fully specified; compensation brackets apply) → a
  `log_replay`-kind baseline → the EXISTING target replay + diff runner +
  volatility + dispositions, unchanged. Pairing scenario_name = stable
  per-request id from the ingester.
- **Log richness tiers** (classified PER ENDPOINT, not per file — mixed logs
  are normal):
  - Tier 1 — no endpoint calls derivable → no round 2 (correct outcome).
  - Tier 2a — concrete URLs logged → every body-less request (GET/DELETE/HEAD)
    is FULLY replayable (auth/standard headers are re-injected by the harness;
    content-type known per endpoint). Reads dominate traffic, so 2a retains
    most of round 2's value on access-log-grade input.
  - Tier 2b — route templates / counts only → nothing directly replayable;
    OPTIONAL synthesis: fill path/query params by sampling S0 (read-edge
    tables), weighted by logged frequency, BADGED as synthesized-from-S0.
    **v1 ruling: 2b synthesis is DEFERRED** (extension seam documented;
    materialize when an engagement needs it).
  - Tier 3 — bodies (± headers) logged → writes replayable too.
- **Writes without bodies: exclude and report loudly** — the coverage panel
  states "N logged calls to POST /x: 0 replayable — no request body in
  supplied logs" with the remedy (supply richer app-level logs if they exist).
  Synthetic body amplification (echo-back PUT from GET, shape-contract-guided
  POST bodies) is a SEPARATE future feature, never presented as log replay.
- **Log profile, not a parser**: per-engagement pluggable format profile —
  LLM proposes the profile from log samples, human confirms, a deterministic
  parser mines the full corpus (LLM proposes / deterministic executes, house
  doctrine). One LLM interaction per engagement, auditable corpus.
- **Chains in logs break safely**: under per-sequence compensation a logged
  causal chain (POST created X, later GET /X) degrades to consistent-404
  parity on BOTH sides — never a false break. Coverage quality (happy-path hit
  rate) scales with how close S0's data vintage is to the log window.
- **Dedup**: exact duplicates (method+path+query+body hash) collapse with an
  occurrence count (distribution info preserved, zero wasted replays).
- **Triage at volume is a first-class requirement**: thousands of diff items
  must NOT become thousands of dispositions. Signature-level clustering
  (endpoint + failure shape → one group, one disposition covering members) +
  per-endpoint rollups in the breaks/diff UI. (Also benefits round 1.)

## Wizard / UX rulings

- **Source multi-select**: the Step-4 3-way `postmanRunMode` selector
  ('llm' | 'postman-delta' | 'postman-only' in `StartCaptureSessionWizard.tsx`)
  is already a two-source multi-select encoded as an enum. Replace with
  checkboxes {LLM generated, Postman collection, Application log}; ≥1
  required; `modeUsesPostman()`-style helpers become per-source predicates.
- **"Include application log generated in initial reconciliation" checkbox**
  (visible only when Application log is selected) controls CORPUS MEMBERSHIP:
  - CHECKED → useful log requests are fired as concrete sends in the round-1
    capture session (exactly the Postman Mode 1b pattern: concrete sends after
    /start + per-op captured map forwarded so the LLM covers only the delta)
    and join the pinned baseline — replayed on EVERY reconcile thereafter.
  - UNCHECKED → parsed corpus is stored as the separate `log_replay` baseline
    and runs as a second reconciliation, triggered from the reconcile screen
    ("Run log-replay reconciliation") after round 1.
  - Show the useful-request count beside the checkbox — the user decides
    merge-vs-separate SEEING the volume (merge pulls the clustering-triage
    load into round 1; separate contains it).
- **Upload → parse → staging**: mirrors the Postman wizard step. Staging table
  shows ONLY useful requests, grouped by endpoint with counts, expandable to
  individual requests. Above it, the FUNNEL: N lines parsed → M matched an
  inventory endpoint → K useful, with discard-reason breakdown. Never silent
  attrition.
- **Usefulness criteria**: POST/PUT/PATCH → parseable body present (logged
  headers NOT required — auth is re-injected, content-type derivable);
  GET/DELETE/HEAD → fully concrete URL, no unresolved template placeholders
  (absent optional query params = legitimate variant, not a defect).
- **Endpoint matching**: against the session inventory via the existing
  collision-aware reconciliation identity keys. Unmatched lines are discarded
  from the corpus BUT counted in the funnel; unmatched-but-API-shaped paths
  surface in the wizard's existing "discovery gaps" section
  (`operations_without_model_endpoint`) as missed-endpoint evidence.
- **Zero useful requests** → loud warning + the source is marked ABANDONED
  (persisted visibly, so "why is there no round 2?" has an answer). If
  Application log was the ONLY selected source → /start is BLOCKED until
  sources are re-selected.

## Environmental rulings (2026-08-18)

- Write access to the source SIT DB confirmed (dbo-mapped login: full DML/DDL,
  identity management). A read-only group exists → credential split applies.
- Exclusive use of the source DB for the WHOLE migration confirmed → S0 is a
  global invariant, and the migration dump can be taken at any time.
- Compensation active during target replay; target treated as non-disposable.

## Rulings (2026-08-18, pre-build Q&A)

- **Effect-map-missing write endpoints: FAIL CLOSED.** A mutating capture with
  no committed `endpoint_data_effects` write map is SKIPPED with a loud
  finding naming the remedy — an uncompensatable write is never fired. PLUS an
  AGGREGATE pre-capture warning (wizard/coverage surface) listing every write
  endpoint in the inventory that has no effect map, so the operator can judge
  scale. A long list = future tool work on effect-map mining (out of scope for
  this program).
- **S0 for the live engagement**: the source SIT DB was refreshed from Prod on
  2026-08-18 — no prior capture corruption exists. S0 is pinned as-of the
  first snapshot; no pre-clean needed.
- **Log parsing: REUSE the existing discovery runtime-evidence machinery** —
  `discovery-service/src/services/logParsing/*` (format detector + JSONL /
  syslog / framework-pattern / plaintext parsers) and
  `services/runtimeEvidence/*` (CLF/Combined access-log parser with streaming
  caps, known-format fast path, LLM recipe induction with held-out ≥60%
  validation, format-fingerprint recipe reuse, max 3 LLM calls/file). The
  recipe model ALREADY defines field rules for method / path / requestHeaders
  / requestBody / responseStatus / responseBody. The "log profile" concept in
  this doc RESOLVES TO that recipe machinery. Spec 5 = EXTEND the pipeline to
  retain full request detail (raw path + query string, bodies, headers where
  present) into a replay corpus — not a new parser. If the extraction engine
  drops detail the corpus needs, extend the engine.

## Build assumptions (stated pre-build, unobjected)

- Verification failure mid-job = HALT the whole job (state is no longer S0);
  guided restore from snapshot, then resume. Never skip-and-continue.
- Snapshot / fingerprint / restore scope = the committed physical model's
  tables (the set the data migration reads). Writes outside that scope are
  findings.
- Credential split is backward-compatible: read-only credentials are a new
  optional slot; single-credential sessions keep working with a visible
  advisory recommending the split.
- Log append parity: a post-start log upload affordance mirroring
  `PostmanImportAppendModal` (rides gate-recompute-on-append), in addition to
  the wizard path.
- Round-2 trigger is manual from the reconcile screen; round-2 breaks join the
  same disposition surface, tagged by baseline kind.
- Bracket verification granularity = keyed-row byte-parity + row counts;
  full per-table checksums only at end-of-job fingerprint (checksum depth =
  CONFIG). Log upload = multipart, CONFIG size cap, streamed parse. Corpus +
  recipe persist server-side (AMS, snake_case, next changeset).

## Open items

- None blocking. (Log grade of the current engagement resolves at runtime via
  the recipe machinery; corpus persistence shape decided at spec 5.)

## Not changing

Round-1 LLM scenario planning + capture orchestration; the diff comparison /
volatility / disposition machinery; pairing; the DB plane (schema/data/parity
chain) except that its dump must come FROM S0; the reconcile doctrine (CD-A
oracle-never-changes, CD-B full-baseline replay). This program brackets the
existing machinery with state discipline and feeds it a second corpus; it does
not rewrite it.

## Proposed spec program (for review — one commit/merge per spec)

1. **Compensation engine (core)** (L) — side-agnostic module in AMVS:
   before-image (keyed rows via PK metadata), row-level inverse diff
   (insert/update/delete), post-undo byte-parity verification, identity
   reseed, loud-fail taxonomy; unit-tested against both dialect adapters.
2. **S0 snapshot + fingerprint + restore** (M) — logical snapshot via the
   keyset bulk reader; per-table checksum fingerprint; restore =
   truncate + bulk-in; S0-equals-migration-dump alignment; snapshot/verify
   status surfaced in UI.
3. **Source capture integration** (M) — per-sequence brackets in
   `execute_http_request` / the scenario loop; credential-role split
   (read-only for observation, write only inside the bracket); end-of-job
   fingerprint vs S0; residue → halt + guided restore.
4. **Target replay integration** (S/M) — same brackets in
   `targetReplayRunner` via the target adapter; target restore = re-run
   truncate-and-load from the S0 dump; state-delta comparison unchanged.
5. **Log ingestion: replay-corpus extraction** (M/L) — EXTEND the existing
   runtime-evidence pipeline (known-format fast path + recipe induction) to
   retain full request detail; per-endpoint richness classification;
   usefulness filter; identity-key endpoint matching; funnel accounting;
   exact-dup collapse with counts; corpus persistence (AMS).
6. **Wizard: source multi-select + include-in-initial** (M) — checkbox
   sources replacing the 3-way enum; log upload + staging table + funnel +
   discovery-gaps wiring + zero-useful blocking; CHECKED path = concrete-send
   + delta-map wiring (Mode 1b pattern) into /start.
7. **Round-2 run: log_replay baseline + second reconciliation** (M) —
   deterministic replay-capture of the log corpus against current (with
   brackets); `log_replay` baseline kind; reconcile-screen trigger; existing
   target replay + diff reused.
8. **Clustered triage** (M) — signature-level grouping (endpoint + failure
   shape), per-endpoint rollups, group-level dispositions in the breaks/diff
   UI; applies to round 1 and round 2.

Order = dependency order: 1 → 2 → 3 → 4 unlock state-honest reconcile on the
existing round-1 corpus alone (shippable value without any log feature);
5 → 6 → 7 add round 2 (5 can start in parallel with 2–4); 8 lands with 7
(hard requirement before a large corpus is ever triaged). Compressible if
desired: 3+4 (both-side integration), 6 backend wiring into 5.
