# SCL Pipeline — Design Agreement (2026-08-18)

Agreed in discussion 2026-08-17/18, triggered by the `GET /views/{viewId}` review:
a misattributed, truncated, non-happy-path capture was the SOLE construction input
for an endpoint spec, producing an honest stub. Root diagnosis: capture is a
sample of `f(request, state)` at ONE state; source code is `f` in closed form.

## Doctrine

- **Capture leaves the construction contract entirely.** State-dependent content
  (bodies, outcomes) never specifies construction. Capture keeps three roles:
  (1) reconcile/verification oracle (unchanged), (2) aggregate state-independent
  wire-FORM facts (the wire-facts miner: date rendering, negotiation posture,
  header contract — built 2026-08-17), (3) contradiction cross-check vs mined
  behaviour (mismatches become findings).
- **Source code is the construction truth**, projected into SCL (below).
- **LLM proposes and annotates, never concludes**: everything LLM-written is
  citation-checked (file:line) with verbatim-substring guards on quoted
  predicates. Human gate for now = reading the generated specs (user ruling).

## SCL — Structural Contract Language

Neutral structural language; "structured behaviour table: neutral skeleton,
verbatim semantics". The corpus is a DAG (directed acyclic graph) of:

- **`[T-...]` behaviour tables** — one per method. Rows = branches in evaluation
  order; conditions/outcomes VERBATIM from source with file:line cites; prose
  gloss per row (LLM, guarded). Public surface = **outcome signature** (labelled
  value classes + throws + effects); caller rows reference callee OUTCOME LABELS
  (never internals); catch rows declare which callee `throws:` outcomes they
  absorb. Loops = map/filter row semantics; recursion = noted cycle.
- **`[S-...]` shape contracts** — one per project type. Normative: field names,
  recursive kinds, nullability, cardinality, wire names/order (where
  wire-crossing). Non-normative: representation (POJO→record OK), accessors,
  mutability, package. Deterministic flags: `mutated-in-flight` (setter after
  construction — record conversion hazard), inheritance→sealed-variant notes
  (discriminators normative). Internal shapes: like-for-like default; hard floor
  = fields referenced by any verbatim predicate are pinned; unreferenced fields
  marked `carried, no observed reader`.
- **`[Q-...]` boundary contracts** — repos/DAOs/external clients: verbatim SQL /
  derived-query name + result-shape outcomes. Extraction stops here.
- **Shared fragments** — high-fan-in tables (envelope builders etc.), extracted
  once, referenced by id.
- Third-party types: plumbing = ROLE + verbatim usage facts, mapped via the
  dependency equivalence map; value carriers = neutral SEMANTIC KIND (`date`,
  `decimal(p,s)`, `list<T>`, `opaque-passthrough`) + source carrier as evidence.
- Rules: inline-trivial (callee ≤1 branch, no effects/throws → absorbed);
  share-common (fan-in dedup); stop-at-boundaries. All ids content-hashed.
- Dynamic dispatch: statically resolvable selectors → dispatch rows (verbatim
  selection condition); unresolvable → findings.

Rows are the unit, never paths (paths = product, rows = sum; infeasible-path
analysis is undecidable — rows are locally true regardless).

## Corpus

- Roots = external endpoints + internal entrypoints (jobs, batch mains,
  listeners). Closure from roots = the corpus. Built per endpoint, persisted
  globally, content-hash dedup.
- **Reachability report** for code outside the closure; dispositions:
  `dead_code` / `missed_entrypoint` (→ new root, re-closure) /
  `framework_invoked` (→ teach scanner the trigger idiom, then root).
- Near-duplicates: deterministic detection (normalized-AST similarity); the
  merge/keep call is an intermediate DECISION with variant diffs attached.
- **Completeness gate** before spec generation (% endpoints fully sliced, open
  ambiguity findings) — manifest-gate posture.
- Staleness: first full scan = static truth (legacy frozen during the days-long
  migration). Content hashes serve dedup/reference integrity only.

## Extraction pipeline

1. **Deterministic slice** (no LLM): anchor at handler; bounded call-graph
   closure (DI interfaces → single impl; 2 impls = finding); per-method CFG
   skeleton via real parser (tree-sitter/JavaParser) with verbatim
   condition/outcome text + cites; annotations/aspects resolved once per
   codebase into effect facts; response schemas from class graphs. Local per
   method → parallel + incremental. Complexity budget with LOUD truncation.
2. **LLM interpretation** (grounded, guarded): intent paragraph, row glosses,
   fragment naming; citation-check + exact-substring guard; contradiction pass
   vs captures → findings.
3. **Carriage**: contracts persist in AMS (committed, versioned, like
   data-effect edges); specs embed VERBATIM (deterministic carriage — LLM may
   arrange around, never paraphrase inside); acceptance criteria mechanical:
   one test per row per table, callees mocked at reference points; golden
   paths = shortest route to each distinct root-level outcome; endpoint without
   a contract → story `insufficient_context` naming the re-scan remedy.

## Intermediate modernization decisions

New target-state conversation phase, AFTER high-level stack answers:

- Corpus drives the question set: only observed idioms, with usage counts +
  cite sites ("Vector: 61 uses / 14 files").
- Defaults: **pair ruleset keyed (source stack → target stack)** — code-plane
  analog of the DB pair ruleset. Unmapped third-party types + near-dup
  consolidations: LLM-proposed, provenance-badged.
- UI: two-column old→new review table, grouped by family, blast-radius sorted,
  every row editable, confirm-all acceptable (review of defaults). Collisions
  surfaced proactively (e.g. `POJO→record` vs 3 `mutated-in-flight` shapes).
- Confirmed rows persist as captured decisions (`modernize.*` codes) in the
  EXISTING decisions store, architecture-scoped + element overrides; specs cite
  `[decision:...]` — stated once, never repeated.
- Blocking for spec generation, not for scanning (missing-inputs discipline).

Decision families (materialize only if observed): core collections/types;
date-time carriers; numeric carriers (id widths → BigInteger/String); DTO
representation; type hierarchies (sealed); data access (DAO→JpaRepository);
HTTP idioms (JAX-RS→Spring MVC, Response→ResponseEntity); serialization
(JAXB→Jackson, wire names always preserved); exceptions/error model (envelope
posture from behaviour tables — not negotiable); cross-cutting (aspects→AOP);
concurrency; caching; config access (keys are behaviour); utility libraries;
near-duplicate consolidations; package layout.

## Spec plan restructure

Derived from DAG topology, not curated: **fan-in ≥ 2 endpoint roots → hoisted
to a foundational spec; build order = topological order.** Existing foundation
specs stay as-is. New corpus-derived pre-endpoint layers, in order:

1. Constants, enums, custom exceptions
2. DTO/domain shapes package (records per shape contracts, citing decisions)
3. Cross-cutting fragments (identity/audit incl. SSO-cookie-overrides-header,
   envelope builders, aspects)
4. Utility functions package (after near-dup consolidation decisions)
5. Data-access layer (repos per entity cluster implementing `[Q-]` contracts)
6. Test kit (fixture builders generated from shape contracts)

Then **external endpoint specs**, then **internal endpoint specs**.
No walking-skeleton vertical for now (user ruling — quality managed by review).

Endpoint spec granularity: **1–n endpoints per spec, grouped by legacy
interface/controller class, budgeted by behaviour-table ROW COUNT** (not
endpoint count); over budget → split into cohesive slices. Interface-local
helpers (fan-in ≥2 within one controller) stay at interface altitude.
Verification unit is always the row, regardless of grouping.

## Rulings (2026-08-18, round 2)

- **Clean slate**: the user restarts the whole migration on the new tool. NO
  compatibility with capture-based spec sections — do what is cleanest.
- **Reachability report v1 — generic, extendable, diagnostic-only.** The tool
  serves ALL migrations; NEVER hardcode one app's trigger idioms. v1 = set
  difference (scanned definitions − corpus closure), grouped by package/class,
  each row annotated with GENERIC signals requiring no framework knowledge:
  `implements/extends third-party type X` (likely framework-invoked),
  annotations listed verbatim, `name referenced in resource/config file Y`
  (likely wired), `has main()`, `test-only reachable`, `no signals` (dead-code
  candidate). Signals, not dispositions. Extension seam: a pluggable
  trigger-idiom detector registry — future per-framework detectors can promote
  a signal to a corpus root. Priority is external/internal functionality;
  this report is diagnostic for now.
- **UI placement**: the corpus is reviewable-not-readable — a new third
  Architecture tab after "Candidates" and "Findings" (working name
  "Structural Model"; user's placeholder was "Scan Details"): corpus browser
  (search by endpoint/type/contract id, drill into tables/shapes), the
  reachability report, and an "explain this" LLM affordance for humans
  investigating oddities later in the pipeline.
- **Build process**: when details are final, present the full ordered spec set
  for discussion, then build AUTONOMOUSLY end-to-end — no stopping unless
  genuinely blocked, commit/merge per spec. The user will not use the tool
  until the whole program is done (no intermediate shakedowns).
- Captured-examples removal from specs: confirmed IF no TDD role emerges;
  pending the TDD discussion below.

## Final rulings (2026-08-18, round 3)

- **TDD = generated failing suites.** Tests are generated DETERMINISTICALLY
  from the corpus (one test per behaviour-table row: mock callees at reference
  points, assert the verbatim outcome; fixtures from shape contracts via the
  test kit; golden-path integration skeletons) and WRITTEN INTO THE BRANCH as
  the spec's first commit — never transcribed through the implementer.
  Acceptance criterion per story: "shipped suite green, no shipped test
  modified". Initial red may be a compile failure (production classes absent) —
  red means not-green. Implementers may never edit a shipped test.
- **Contested-test protocol (2026-08-18 revision — NO default halting).**
  Contest = implementer flags a test with structured evidence (row + why it
  misreads the source). An independent LLM ARBITER (sees only the verbatim
  source slice, the row, the evidence) rules inline: REJECTED → implementer
  must satisfy the test; UPHELD → test QUARANTINED (skipped-with-reason in a
  manifest, never edited/deleted; verdict shows "green 34/36 · quarantined 2")
  + a finding against the contract row; the run CONTINUES. Threshold
  circuit-breakers are the only halts: per-spec upheld-contest rate > ~20% of
  the suite → halt that spec (systematic extraction misread); run-level
  aggregate quarantine rate > ~5% → halt the run. Batch disposition of the
  quarantine list at the existing stage-2 human gate (contracts re-extracted,
  tests regenerated). Reconcile is the backstop for wrongly-upheld
  quarantines. NEVER a silent red: everything failing at merge is either
  visibly quarantined or the spec is not done.
- **Captured examples are removed from specs entirely** (even shape-level —
  the shape contracts encode it better; capture-vs-code shape comparison
  belongs to the extraction-time contradiction pass). Captures live ONLY in
  reconcile + the contradiction pass.
- v1 slicer parses JAVA ONLY, behind a language-pluggable extractor interface.
- Rows-per-spec budget default: tune on the first real corpus.

## Proposed build program (for review — one commit/merge per spec)

Not changing: DB plane, reconcile/AMVS capture machinery, deployment flow,
existing foundation specs, the wire-facts miner (kept as the form-side input).

1. **SCL core model + AMS persistence** (M) — contract schemas (T/S/Q/
   fragments, outcome signatures, content-hash ids), AMS tables + bulk/query
   endpoints (by root, by type, by fan-in), corpus metadata + completeness
   stats. snake_case wire per AMS default.
2. **Deterministic Java slicer** (L — the monster) — tree-sitter-java
   per-method CFG skeletons; call-graph closure; DI single-impl resolution
   (2 impls → finding); boundary detection; verbatim predicates/outcomes +
   cites; aspect/annotation effects; shape extraction (generics, inheritance,
   wire annotations, mutation-in-flight); third-party role/kind
   classification; inline-trivial rule; hashing. ALSO creates the synthetic
   fixture legacy app (small Java 8/JAX-RS/Joda app in test fixtures) that
   every later spec extends — the program's end-to-end proof, since there is
   no intermediate live shakedown.
3. **Corpus assembly: roots, dedup, reachability** (M) — root enumeration
   (external + internal), closure orchestration, exact dedup, near-dup
   clustering → pending decisions, completeness gate, reachability report v1
   (generic signals + detector-registry seam).
4. **LLM annotation pass** (M) — intent/row glosses + fragment naming with
   citation-check + verbatim-substring guards; contradiction pass vs captured
   baseline → findings; rate-limit-aware batching via existing LLM machinery.
5. **Modernization decisions: pair ruleset + conversation phase** (M/L) —
   seeded (Java8+JAX-RS+Joda → Java21+Spring Boot) ruleset; observed-idiom
   inventory; decision materialization (observed families only) with defaults
   + badged LLM proposals; `modernize.*` codes in the existing decisions
   store; two-column review UI with collision surfacing; blocking-input
   wiring.
6. **Structural Model tab** (M) — corpus browser (search/drill T/S/Q, fan-in
   view), reachability report view, "explain this" LLM affordance.
7. **Corpus-derived spec planner** (L) — fan-in hoisting → the 6 foundational
   layers; topological ordering; external-then-internal endpoint stories
   grouped by controller under the row-count budget; book-of-work
   integration.
8. **SCL spec carriage** (M) — specs embed verbatim contracts +
   `[decision:]` citations + wire-facts section; captured-examples sections
   DELETED; `insufficient_context` when contracts are missing; acceptance
   criteria = suite-green + no-test-modified + contested-test text.
9. **Test suite generator** (L) — per-row tests, fixture builders from shape
   contracts, golden-path skeletons; first-commit delivery into the story
   branch; red-check / green-check / no-modification guard in verification;
   contested-test finding path.
10. **Execution integration + clean-slate removal** (M) — driver/orchestration
    updates for new story types + ordering; retire capture-based spec-gen
    paths; full-pipeline CI run against the fixture app (scan → corpus →
    decisions → specs → generated tests).

Order = dependency order; 5 and 6 can interleave after 3.

## Related, already built this session (independent of SCL)

- Wire-facts miner + scaffold/spec carriage (`migrationBaselineWireFacts.ts`).
- Scaffold spec: error-advice NoResourceFoundException requirement + criterion.
- Reconcile fixes: AMS diff wire-case coerce, reconcile run statuses in AMS
  enum, loud diff-items read + zero-items guard.
