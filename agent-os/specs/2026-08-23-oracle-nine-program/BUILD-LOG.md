# Oracle Nine Program — build log (2026-08-23)

User mandate: all nine capabilities from the migration-readiness audit, built
generically (idioms + engine adapters + decision cards; estate specifics only
ever enter as DATA), autonomous continuous build, one `--no-ff` merge per
item, order 1→9. Step 0 (estate-token genericization sweep, 22 files) merged
`6e488aea` before the program started.

Q1 ruling: external read of the sequence table is PERMITTED (read-only role
grant) but not OBSERVED — the sequence decision card therefore carries a
native-sequences-plus-compatibility-view option and cites grant evidence.
Q2 ruling: read-only live queries during the DB scan approved (proc text,
charset config, sequence rows, uniqueness probes).

## The nine items (design pinned; status updated per merge)

1. **Live proc harvest + drift** — sidecar `/query` (no Java changes) reads
   `sysobjects`+`syscomments` (types P/F/TR), reassembled per object;
   optional pack capability `harvestProcSources`; orchestrator soft-fail;
   raw sources stored on the DB run's `steps_payload.database.proc_sources`;
   the CODE scan fetches the latest COMPLETED database run
   (new `archModelClient.listDiscoveryRuns`), passes sources through
   structuralScanStep → sclScanRunner → sliceProject options;
   `mergeProcCatalogs(repo, live)` — live WINS; findings
   `proc_repo_drift` / `proc_live_only` / `proc_repo_duplicate` /
   `proc_repo_only` (SclFinding kinds widened); entries carry normalized
   `bodyMd5`; merge counts ride slice→corpus stats. STATUS: MERGED.
2. **Sequence-table identity** — proc-idiom detector over harvested bodies
   (`update X set n=n+1 … select`); foundations card proposes
   sequence-name→table.column mapping (suffix-matched, human-confirmed);
   options: native sequences (recommended) / native + read-compatibility
   VIEW over pg_sequences (Q1) / keep-table-emulation; pack emits sequences
   + post-load `setval(max(col)+1)`. STATUS: MERGED.
3. **Charset detection + transcode** — sidecar reads charset/sortorder
   config tables; declared on the extraction CONNECTION (jConnect CHARSET)
   so strings decode correctly at source; case-sensitivity → target
   collation decision card. STATUS: MERGED.
4. **Parity keys** — DB scan runs read-only uniqueness probes
   (`count(*)` vs `count(distinct …)`) over candidate tuples (unique-index
   cols ± temporal `valid_from`/`valid_to`-style pair ± composites);
   key-posture foundations propose a VERIFIED `parity_key` per table
   (stored like key_policy, reconciler-materialized); reconcile join
   consumes it; count+checksum for truly keyless; pinned test that the
   `9999-12-31` open sentinel survives type mapping. STATUS: MERGED.
5. **Quiet-window guardrail + audit-sink** — AMVS pre-capture fingerprints
   twice (configurable gap), REFUSES to start until every drifting table is
   volatile/audit-sink (named list); write-only foundations answer records
   `audit_sink` policy consumed by S0 tolerance + compensation
   (count-only, never compensated) + parity. STATUS: MERGED.
6. **web.xml servlet roots** — root detector for `HttpRequestHandler`-
   implementing beans mapped via `servlet-mapping`; corpus roots + endpoint
   candidates defaulted capture-scope EXCLUDED (like internal
   auto-exclusion; a cache rebuild mid-capture is exactly what the quiet
   rule forbids). STATUS: MERGED.
7. **Spring bean-property attribution** — `<bean><property name value>`
   parsed per class; `*table?name*` properties with identifier values
   attribute the runtime-INSERT loader's writes (per-class union across
   bean instances); SQL-ish property values join effect walks verbatim.
   STATUS: MERGED.
8. **.jil scheduler adapter** — parse in-repo Autosys jil (job → command →
   shell → Java main resolved by scanning the named script); schedule/box/
   conditions attached to internal endpoint candidates; loud finding for
   jobs resolving to no known main; silent no-op when no jil files.
   STATUS: MERGED.
9. **Log pointing + deterministic pattern translation** — code-scan config
   accepts app-log path + pattern; log4j/logback ConversionPattern
   translated mechanically to the recorder recipe; LLM induction demoted to
   fallback. STATUS: MERGED.

## Shakedown round 1 (2026-08-23, live foundations review on the estate)

Evidence session: 12 in-scope never-touched tables vs 7 expected. Forensics
(operator greps + register cross-reference) proved 10 of 12 correct-dark
(caller-less deployed procs, dead attr subsystem, DDL-seeded lookups,
external deploy tool) and 2 dark from ONE parser gap. Three fixes, one
--no-ff merge each:

1. **Comma-join FROM read extraction** — `parseReadTablesFromSql` walks the
   FROM clause as a comma-separated list w/ optional `as`/aliases,
   conservative stop-words; shared parser (proc bodies + Java verbatim).
   Pins: comma lists, update-from, exists-subselect, assignment-select,
   delete-from exclusion. Lights the two config tables read via the
   classic Sybase comma join.
2. **Never-touched card WHY annotation** — emitter derive now returns
   `orphanProcTouchers` (table -> caller-less proc names, transitively
   closed, cap 100); rides steps_payload effectCandidates; run detail page
   passes it to FoundationsReviewPanel; crud_never target notes read
   "only touched by caller-less deployed proc(s): X, Y". Evidence hash is
   name-based so stored decisions never stale from the richer note.
3. **Proc findings promotion + merge-count rendering** — proc_* merge
   findings (drift/live-only/repo-only/duplicate) now ALSO emit into the
   run findings register (category proc_catalog, source scl_proc_merge,
   soft-fail; pure mapper procMergeFindingInputs pinned); Structural Model
   tab renders the procMerge summary counts, with an explicit repo-only
   line when no live sources merged.

Pickup deltas: discovery-service restart (fixes 1-3 backend), frontend
restart (fixes 2-3 UI). No AMS/gateway/sidecar changes in this round.
Re-run: code scan (DB scan already COMPLETED on the new build) ->
foundations review -> expect 10 dark never-touched tables, annotated.

## Shakedown round 2 (2026-08-24, fresh-project re-run)

Findings from the run payload: (a) "expansion cap 12" lines are the
UNKNOWN-RECEIVER tier of the tiered cap (8f487c72: known-class=40, `?`=12,
deliberate) — every observed line was `?#toString/append` StringBuilder
plumbing; (b) batch transfer procs ALL unreferenced (the real gap — Java->proc
invocation invisible, needs estate grep); (c) phantom alias writes ("grd")
from Sybase ALIASED UPDATE; (d) jil enrichment matched 0/31 (className simple
vs FQN); (e) fresh project = fresh model, no carried edges. Fixes:

1. **Alias-aware writes** — `fromAliasMap` + shared `walkFromClauses`;
   `update <alias> set ... from <table> <alias>` and `delete <alias> from`
   resolve to the real table; phantom alias tables (blocked at save as
   unknown entities) eliminated.
2. **Inert unknown-receiver suppression** — `?#toString/append/equals/...`
   (JDK-semantic name set) no longer recorded as broken calls; kills the
   identical noise on every endpoint AND unblocks proven-read chains that
   were failing on pure StringBuilder plumbing. Known receivers never
   suppressed.
3. **jil enrichment match fix** — batch-main candidates carry FQN in
   `fullPath`, SIMPLE name in `className`; matcher now checks both.
4. **internalWalkedNames** in effectCandidates payload (which internal
   chains walked — batch-plane rooting diagnosis needs names not counts).

5. **Cap policy (user ruling: no small arbitrary caps blocking flow)** —
   dispatch caps now generous + env-tunable, refusal messages name the
   knob: unknown-receiver 12->40 (HAIKAI_DISPATCH_CAP_UNKNOWN),
   known-class 40->120 (HAIKAI_DISPATCH_CAP_KNOWN), chain-walk 500->2000
   (HAIKAI_CHAIN_WALK_CAP), procsUnreferenced display 15->60; gateway
   effectMapBackfill mirror updated identically.

6. **Bare proc-name dispatch + referenced bookkeeping** — estate grep
   proved the transfer chain shape: field-initializer dispatch map
   ("hierarchy" -> "updateHierarchy_hir '<date>', 'Y'") into a generic
   prepareCall. The config-sql row + walked-terminal catalog scan ALREADY
   expands bare-name invocation strings (pinned end-to-end); the bug was
   bookkeeping — only boundary-plane procs counted as REFERENCED, so
   map-dispatched procs expanded yet still reported as orphans
   (procsUnreferenced + never-touched WHY annotations lied).
   collectFromRootKeys now returns procsExpanded; both call sites mark
   them referenced.

7. **Return-status nested exec (`exec @rc = proc`)** — Kiro's end-to-end
   trace of the two REAL dark tables (ValidationConfig/Fields) exposed the
   final hop: Java dispatch literal names `validate_load` (now rooted),
   whose body calls `validate_books` via the Sybase RETURN-STATUS form —
   PROC_CALL_RE captured `@rc`, the closure lacked the edge, the callee
   stayed a false orphan with its config-table reads dark. Exec arm now
   tolerates `@var =`; closure pinned dispatcher->worker->comma-join reads.
   Kiro verdicts on the other 10 match the tool's dark-list categories
   EXACTLY (manual-proc / dead attr / DDL lookups / external tool).

8. **Kiro 19-endpoint audit fixes (5 bugs)** — (1) read edges no longer
   suppressed when the endpoint also writes the table (read-write tables
   were guaranteed audit-sink misclassifications — parity would have
   SKIPPED the authorization list + sequence table); (2) boundary tables
   attribute PER REACHED OPERATION (walkCallGraph carries boundaryOps;
   per-op sets incl. own proc closure; class union = fallback only);
   (3) FE read-write mode counts as BOTH read and write evidence;
   (4) jil-resolved mains with no endpoint candidate are rescue-minted as
   BATCH_MAIN roots (schedulerSummary.mintedRoots); (5) orphan annotation
   caps per-table proc list (10) not table count (alphabetical 100-cut had
   dropped the ven_* explanations). PLUS the defensive backstop:
   corpus-wide UNROOTED readAnywhereTables in the payload — the FE
   write-only bucket REFUSES tables read anywhere in parsed SQL, refusal
   counted in the card detail.

9. **Kiro round-2 fixes (5)** — (a) comment-swallow: stripSqlComments before
   CREATE PROC harvest + SQL-keyword name reject (32 phantom `create`
   entries, importVirtualNodes/getNextSequence absent -> ven_* WHY notes
   restored, phantom-expansion hazard dead); (b) corpus-proven edges no
   longer defer to MINED candidates (existingEdges seed removed; the 6
   read-only-mislabelled batch dimension tables regain their proc writes);
   (c) @Scheduled/listener roots named uniquely (`SCHEDULED <id>
   Class.method`) — same-fixedDelay twins no longer dedupe away (the
   access-info asymmetry); (d) refused write-only tables get their own
   CONFLICTING-evidence card (crud_conflicting: keep read-write
   recommended / audit-sink acknowledge / exclude) instead of vanishing
   from review; (e) enum-held SQL: enum constant args captured, SQL-bearing
   enums become boundaries (op per constant; sql-less method ops fall back
   to class union — `for (op : values()) exec(op.getSql())` attributes).
   DEFERRED knowingly: AOP @AuditInfoDBLogging aspect walking (bucket
   verdict already correct).

10. **Kiro round-3 fixes (3)** — (1) bare-name proc/function scan now ALSO
    runs over BOUNDARY op SQL (SimpleJdbcCall withFunctionName idiom: no
    exec/{call} syntax, so the call parser saw nothing; behaviour-table
    plane had the scan, boundary ops didn't — sequence table looked
    untouched on every create endpoint); empty-closure catalog entries
    (generic names like greatest/least) are skipped. (2) NON-HTTP endpoint
    identity keys on class#method (`endpoints|internal|cls|mth`) — verb+path
    fused same-fixedDelay @Scheduled twins in the MERGE (round-2's unique
    name only entered the fallback branch); HTTP verbs keep verb+path so
    the WADL/JAX-RS cross-source merge is untouched. (3A) rescue-mint
    guard: a class-only candidate (no methodName) cannot root, so it no
    longer suppresses the BATCH_MAIN mint (nine batch-written tables looked
    read-only/untouched); (3B) internal candidates without
    className/methodName surface in internalUnmatched `[no
    className/methodName]` instead of silently dropping. Merge-engine
    suites re-run green per Kiro's ordering note.

11. **Kiro round-4 fixes (3)** — (B, done first per Kiro) Object-method
    denylist in expandDispatch: unresolved `?#toString()` unioned 15
    toString/0 tables incl. the batch loader — 30 API endpoints credited
    with every load_* write + ~10 phantom tables inflating
    readAnywhereTables; the 12->40 cap raise ENABLED it (12 refused by
    luck). `?`-receiver dispatch refuses Object-inherited names
    (tostring/equals/hashcode/clone/finalize/getclass/notify/notifyall/
    wait); known receivers untouched; gateway backfill mirrored; inert
    noise set extended. (A) DAO->DAO delegation: walkCallGraph treats
    boundaries as terminal, so FilterDao#addFilter -> sequenceDao.getNext
    was severed — hir_sequence W=0 R=0 from all 45 roots despite the
    round-3 bare-name detection working. SclBoundaryOperation.delegatesTo
    captured at slice time (field-typed receiver resolving to another
    boundary class, incl. the interface-impl mining path); indexCorpus
    resolves transitively (cycle-safe, depth 10) merging delegate op
    tables (or delegate class union) into the delegating op entry AND
    class union. (C hardening) mint guard now requires the blocking
    candidate's className#methodName to actually JOIN the corpus
    (behaviour-table symbol set built from structural.corpus) — presence
    alone let a hallucinated methodName block the mint and root nothing.
    C's other branch (candidate present + entity absent = commit-path
    drop) needs the run's own records: Blocked chip / committed-model
    check per Kiro.

12. **Kiro on-machine fix replicated (round 5)** — Kiro authored the fix
    directly on the work machine (it holds the estate codebase); replicated
    here verbatim in semantics, estate tokens genericized in comments per
    the standing scrub rule. Fix 1 (behaviourExtractor, 3 hunks): private/
    same-class helper folding — sameClassCallees (implicit/`this` receiver
    only; named receivers are collaborators) + expandSameClass (transitive,
    cycle-safe, depth 5) + foldHelpers folds each helper's mined SQL and
    DAO->DAO delegations into the PUBLIC op; interface ops fold helpers
    from the impl. Root cause: a create op mined sql=null because its
    INSERT lived in a private insert-row helper, and every sequence-DAO
    delegation site was a private helper. Fix 2 (effectCandidateEmitter,
    collectFromRootKeys): per-op class-union fallback — an UNANALYSED
    reached op falls back to the class union for THAT op only; the old
    anyOpKnown form let one resolved sibling discard the fallback for every
    unresolved op (the fix-one-break-another feedback loop). MONOTONIC:
    more information can only narrow, never erase. Two new suites at
    Kiro's counts: perOpFallback (3), privateHelpers (4).

13. **Kiro on-machine fix replicated (round 6): per-batch save isolation** —
    ONE failing bulkSaveCandidates batch aborted the effect-candidate save
    loop: every later batch silently discarded, allCandidates.push skipped,
    outer catch replaced the diagnostic payload with {error}. Minted
    BATCH_MAIN roots emit LAST (estate measurement: 55 batch-plane edges at
    indices 476-530 of 531 — entirely in the final two batches), so an
    abort dropped exactly the proc-written tables' edges = the Issue-C
    "analysed but never committed" branch. Now: per-batch try/catch
    (matches the pinned startDatabaseRun soft-fail convention),
    effect_candidate_partial_save warn (batch index + range + error),
    payload carries emittedTotal/saved/saveFailures, completion log shows
    saved N/M (+ FAILED batch count). No new test (Kiro's call — heavier
    harness; sibling convention already pinned; offer stands).

14. **Kiro on-machine fix replicated (round 7): access_mode in the
    save-back idempotent match** — the payload proved emission+save both
    clean (saved 571/571, roots walked) yet read/write cards still
    reshuffled per run: Pass 2.6's idempotent match keyed
    (endpoint_id, data_entity_point_id) WITHOUT access_mode, so a read
    edge and a write edge for the same endpoint+table collapsed — first
    mode created, second silently 'reused', survivor varying with
    candidate-API order. Latent since the edge type existed; exposed when
    round-5 made reads coexist with writes. Predicate now includes
    `(r.access_mode ?? null) === (row.access_mode ?? null)` (the
    data_movements sibling was already mode-inclusive). New suite
    candidateSaveBackEffectAccessMode (4 tests, real
    saveDiscoveryCandidatesToModel: both modes commit, same-mode
    idempotent, order-independent, null-mode nullish equality). mcp full
    sweep 78/537 green. Restart: mcp-server.

15. **Kiro on-machine fixes replicated (round 8): vocabulary guard +
    interface_type** — (1) the committed physical-table vocabulary now
    guards the DETERMINISTIC effect phase too (the LLM phase always was):
    mineSqlFromMethod's literal join manufactures phantom table tokens
    that could only ever be BLOCKED at save-back (~40 of 86 blocked
    candidates, nothing an operator could set). deriveCorpusEffectCandidates
    gains tableVocabulary (null = guard OFF, legacy/backfill path);
    emitWrite/emitRead + readAnywhereTables gated; droppedUnknownTables
    receipt (cap 100) on the result + run payload + a dropped-tokens log;
    runManager hoists the vocabulary fetch above derivation (moved, not
    duplicated — LLM phase reuses it). (2) interface_type: JAX-RS resource
    + @RestController emit REST_API (only the SOAP emitter ever set the
    field — every REST interface committed null = hand-filled
    QUALITY_GAP); plain @Controller deliberately left unset (may serve MVC
    views — honest gap beats a guessed value). New suites at Kiro's
    counts: vocabularyGuard (4), springClassicInterfaceType (3).

16. **Overnight full-suite stabilization (2026-08-25, all seven modules)** —
    every module's complete test suite swept, triaged (isolated re-runs
    separate parallel-load flakes from real breaks), and fixed:
    - discovery (281 suites/2048): modelScopeGuard ratchet — runManager
      baselined (candidateType discriminator only, item-2 enrichment);
      startDatabaseRunCandidatePersistence — Oracle Nine envelope fields
      read defensively (?? []) so enrichment can never kill persistence +
      fixture carries the modern envelope.
    - gateway (483/3782): engineNameGuard BURN-DOWN (not raised!) —
      engine-typed credential parsing extracted to
      dbMigrationPack/dbCredentialBlock.ts, migrationExecution.ts now 0
      tokens (was 7/allowed 5; CSD-07 added 2); llmClient fixture cast
      (Config grew); azure 429 pin → 500 (429 cool-down-retries by design
      since 2026-07-22); manifest 'Maven 3.9'→'Maven' (version-decoupling
      2026-06-27).
    - mcp (78/537): green untouched. AMVS (120/779): quiet-window seams
      injected into the bracket harness (item 5's 120s two-sweep gap timed
      out 4 tests); config 30s→180s pin (rate-limit program); authRejected
      + dimensionKind additive-field pins.
    - AMS (2423, BUILD SUCCESS): no-db-mode guards added to
      DataMigrationReport/DataParityReport/DbSurfaceInventory/
      FoundationDecision controllers + 4 repo-backed services +
      TraceBootHeader (real product gaps — no-db ApplicationContext was
      broken); 'dismissed' joins the finding-status pins (D4 2026-06-14);
      CRLF normalisation in trigger-SQL + terraform-golden comparisons
      (Windows checkout/filtering artifact).
    - frontend (1123 files/10982): project-menu pin gains 'edit'
      (2026-07-27); create-modal test mocks initProjectWorkspace (init
      phase 2026-06-12 keeps the modal open on failure BY DESIGN);
      dashboard grade-filter tests re-pinned on hierarchy node-title
      testids (migrate-select panel repeats titles). sidecar (93): green.
    Known parallel-load flakes (pass isolated + in clean full runs):
    discovery responseContractScanner/crossCuttingHardeningGaps, frontend
    AppConfigContext + occasional worker OOM under full-suite load.

17. **Blocked-panel typed options + Kiro round-5 fixes (2026-08-25)** —
    (UX) Grid fkTarget parity in the Fix-missing-fields panel:
    REFERENCE_FIELD_TARGETS registry maps each blocking field to its exact
    resolver collections (interfaceClassName->interfaces,
    source/targetEntity->logical+physical, endpoint->endpoints,
    sourceService->services+interfaces, parent->run candidates id-valued);
    group control AND per-row Override render a pick-from-valid-targets
    select (free text could only produce another blocked row — these arms
    resolve existing-only); zero-target fields fall back to free text with
    an honest hint; enum rows also get select overrides; page assembles
    typedReferenceSources (model collections + approved run candidates).
    (Fix 1) mintOperationalHttpCandidates stamps the scoped service_id on
    the web.xml interface + endpoints (mint runs after Step 8's stamping,
    persisted directly — interface blocked on the service FK, cascading
    both endpoints). (Fix 2 — "Better" per golden standard) case_fold tier
    in matchByNormalizedName (0.95): a case-only variant binds confidently
    everywhere (dup-suppression, request/response binding, enrich,
    relationship guard passes); guards still block genuine normalization,
    and the residual block stamps the side that ACTUALLY mismatched
    (targetEntity vs sourceEntity). (Fix 3 — emitter-primary per Kiro)
    interface_logical_entities links are never emitted for interfaces the
    stage-2 post-process drops as internal (service-api etc.) — the 19
    dangling "Interface Class Name" blocks are never born; external REST
    links untouched; reconcile-guard alternative deliberately NOT taken
    (incremental over-drop caveat). Re-pins: springClassic smoke ILE
    expectation, OpenMRS baseline 3460->3132 (the dangling class), SOAP
    WSDL-vs-Java both-suppress. Net per Kiro: 34 blocked -> 0.

18. **Capture wizard OPERATIONAL_HTTP filter (Kiro review, 2026-08-25)** —
    the AMS reconciliation excludes OPERATIONAL_HTTP exactly like the
    internal batch types (both in INTERNAL_INTERFACE_TYPES since item 6),
    but the wizard's selectable-interface filter was never updated: it
    dropped INTERNAL_PROCESSING/INTERNAL_PROCESS and left the web.xml
    operational servlets selectable. Fix + Kiro's drift-prevention
    suggestion taken: NON_CAPTURABLE_INTERFACE_TYPES exported constant
    (the frontend mirror of the AMS set, doc-linked both ways) used by the
    filter; comment rewritten to name both exclusion classes and the
    server-side twin. Pins: mirror-set vocabulary + REST offered /
    batch hidden / operational hidden. Restart: frontend.

19. **Diagnostics header buttons (Kiro replication, 2026-08-25)** —
    serializeDiagnosticsReport pure helper (reuses groupDiagnostics +
    labelFor; halt->warning->info order; EVERY row with
    operation/scenario context + full detail_json — no xN collapsing, no
    truncation: the exported artefact is complete). Session screen's
    diagnostics header is a flex row with Copy
    (navigator.clipboard.writeText + hidden-textarea execCommand fallback,
    "Copied" flash 2s), Download (Blob -> object URL -> auto-click ->
    revoke, capture-diagnostics-<sessionId>.txt), Collapse/Expand
    (diag-collapse-toggle, aria-expanded; header+buttons stay actionable).
    Report memoized on [sessionId, session, diagnostics]; per-group
    "Show all" toggles untouched; styles.secondaryButton reused. One
    deviation from Kiro's build: the serializer PIN Kiro offered is added
    (house standard). Restart: frontend.

20. **Kiro C1 + C2: S0 tolerance discipline (2026-08-25)** — C1: the
    compensation metadata index gains sequenceGeneratorTables (read from
    constraints_metadata.sequence_generator — the Oracle Nine item-2
    foundations decision; decision-driven, no name heuristics, better than
    the suggested shape-detection). Sequence tables join the tolerated set
    of BOTH the end-of-job fingerprint and the quiet-window check: a
    counter bump is unavoidable on every create and only the S0 restore
    resets it (same rationale as audit sinks; it has a PK so the keyless
    rule never covered it — the false checksum_mismatch halt dies). C2:
    new defaultVerifyTolerated(metadata, manifest) = un-dumped manifest
    entries (file:null count-only/no-PK) ∪ volatile ∪ auditSink ∪
    sequenceGenerator; the restore runner's final self-verify AND the
    standalone /verify route now pass it (previously neither passed ANY
    tolerated set → a restore that reset everything restorable reported
    failed). Divergence on un-restorable tables surfaces as
    tolerated_mismatches — visible, honest, non-failing. Applied as the
    route default (no request-body option; simpler + the wire already
    carries tolerated_mismatches). Pins: sequence index read, tolerated
    composition (dumped never tolerated), restore-self-verify RESTORED
    with audit divergence tolerated. A1-A3/B1 from the same Kiro review
    were already on main (rounds 47fcfa3b/bca7f9ff — the review predates
    the work-machine clone refresh); C3 deferred to next-run confirmation
    (rounds 4-5 likely closed it); D1 hardening already satisfied
    (wizard dual-writes canonical allowlist keys); D2 with Kiro on the
    work machine. Restart: AMVS.

21. **S0_SNAPSHOT_DIR anchored to the service root (Kiro replication,
    2026-08-25)** — the default was cwd-relative `'./s0-snapshots'`, so the
    snapshot root silently relocated whenever AMVS was launched from a
    different folder (repo root, IDE run config, service wrapper); a
    missing snapshot is indistinguishable from "no snapshot was ever
    taken", inviting a fresh S0 over polluted state. Now
    `path.resolve(__dirname, '..', 's0-snapshots')` — `__dirname` is
    `src/` under tsx and `dist/` compiled, both landing on the service
    root, so the existing snapshot tree stays discoverable with no env
    var. `S0_SNAPSHOT_DIR` env override still wins (both S0 suites pin it
    to tmp dirs: 18/18). Full AMVS sweep 120 suites / 782 green. Work
    machine already patched by Kiro directly — this replicates to
    canonical main; next clone carries it, no extra pickup action.

22. **Kiro run-3 review: capture round 4 fixes (2026-08-26)** — five fixes
    from the re-run analysis (2 landed confirmed: dbo.* metadata + 2
    tolerated tables; run failed on ONE table).
    **Issue 1 / C3 (the halt, filter_tag +1)** two prongs: (a) ROOT CAUSE
    CANDIDATE — the write-table SQL parser required the optional-in-T-SQL
    keywords: `insert <table>` (no INTO) and `delete <table>` (no FROM)
    are legal Sybase and were INVISIBLE, while the same chain's SELECT
    parsed fine → the favourite-style createOrGet op surfaced its table as
    READ-only, so no bracket imaged it and the +1 leaked to the
    fingerprint (explains +2→+1: other writers use `insert into`). Fixed
    in emitter WRITE_SQL_PATTERNS (optional INTO; new BARE_DELETE_RE with
    whole-token + routing lookaheads — no partial-token backtracking;
    stop-word guard on captured tokens) + gateway effectMapBackfill
    mirror; proc harvester reuses the emitter parser. (b) ATTRIBUTION —
    EffectScopeIndex now KEEPS read-mode tables per op
    (readTablesByOperationKey); a fingerprint mismatch names the ops
    holding the diverged table as READ ("suspect op(s) … missed write
    edge") in the halt detail — Kiro's manual inference automated; both
    orchestrator + log-replay pass the scope. If the next run still
    leaks, the halt now names the op — screenshot it.
    **Issue 2 (retry_exhausted 34→59)** — research rounds are FREE:
    tools declare `research: true` (OAS/contract reads, list_db_metadata,
    sample_db_values, run_readonly_sql, source search/read); a round
    whose calls are ALL research never consumes LLM_SCENARIO_ROUND_LIMIT
    (mirrors the fired-attempt "research is free" rule); new
    LLM_SCENARIO_RESEARCH_ROUND_CEILING (default 60, env-tunable,
    refusal names the knob) bounds pure-research spin WITHOUT undercutting
    Pass-B's derived budget limits; LoopOutcome gains researchRounds and
    the retry_exhausted messages split budget vs research counts.
    **Issue 3 (record_scenario_candidate AMS 400, feeder of 2)** — the
    tool sent request_method/request_path NULL when the LLM omitted the
    schema-optional args; AMS 400s on blank (NOT NULL columns — the
    orchestrator's own create learned this long ago, the tool path never
    did). Now defaulted from the persisted operation row; explicit values
    still win; blank = omitted.
    **Issue 4 (un-actionable credential-split advisory)** — backend was
    fully wired (secrets.db.readonlyUsername/Password → observation
    adapter; advisory when absent); added the MISSING UI: wizard Step 3
    gains an optional read-only login pair (both-or-nothing with an
    incomplete-pair warning), the session screen's re-enter-secrets
    prompt gains the same pair, client toSecretsWireBody maps to
    db.readonly_username/readonly_password (lone value dropped, matching
    the backend rule).
    **Minor** — new diagnostic type `captured_as_business_error`
    (AMS allowlist + AMVS union + record_capture_note valid set + system
    prompt steer): captured-as-200-with-business-error-code is a
    SUCCESSFUL negative capture, not "endpoint skipped" (108 mislabels);
    frontend renders it as info automatically. Auth-failure minor =
    legacy behaviour correctly captured, no action.
    Tests: emitter T-SQL parse+walk pins (incl. backtracking negative),
    gateway mirror pins, suspects-note pins, loop research-free +
    ceiling-knob pins, config knob pins, scenario-candidate default pins,
    secrets wire pins. Suites: discovery 2047 green (2 known parallel
    flakes pass isolated) + tsc, gateway backfill 19 + tsc, AMVS FULL 121
    suites / 790 + tsc, AMS compiles, frontend client 18 + wizard 2 +
    detail-view 11.
    PICKUP (fresh clone covers all): **AMS REBUILD required** (`mvn
    package` — diagnostics allowlist) + restart discovery-service,
    gateway, AMVS, frontend. Expected on the re-run: filter_tag bracketed
    (write edge derives) after code scan re-run + save; retry_exhausted
    collapses; scenario candidates persist; supply the read-only login in
    the wizard to clear the advisory; "endpoint skipped" splits honestly.

Pickup: discovery-service restart only. OPEN: transfer-proc invocation shape
(estate grep), Blocked-101 breakdown, FindingEmitter persist errors (~476).

## Per-item as-built notes

### Item 9 (as-built)
- Log POINTING = the existing upload flow (log-corpus spec); item 9's real gap was the PATTERN: new `logPatternTranslation.ts` translates any log4j/logback ConversionPattern mechanically to a LogRecipe — `%d{...}` date-format walk (SimpleDateFormat letter runs + ISO8601/ABSOLUTE/DATE names), level alternation, padded-converter tolerance, unknown converters degrade to wildcards (reported, never fatal). Record delimiter = start_regex from the rendered prefix, so stack traces fold into parent records; fields = the shared TG1 method/path/status rules (engine strips absolute URLs + normalizes, same as fallback).
- Per-file honesty: translated recipe accepted ONLY when it matches >= half that file's sampled blocks AND extracts >= 1 observation; otherwise fall through to reuse -> LLM induction unchanged. origin `pattern_translation`, llmCallsUsed 0; persists under steps_payload.v3.runtimeEvidence.recipe for cross-run reuse.
- Config carriage mirrors the M knob: FE StartDiscoveryRunModal optional "Log line pattern" input (visible with files) -> uploadDiscoveryRunLogFiles 6th arg -> multipart `runtimeEvidenceConfig` rider {maxLogPathPrefixSegments, logPatternHint} -> gateway forwards verbatim (types widened ×3) -> AMS RuntimeEvidenceConfigDto.logPatternHint (@Size 500, trimmed, omit-preserves) -> config_snapshot.runtimeEvidenceConfig.logPatternHint -> orchestrator readLogPatternHint (defensive, 500 cap).
- Tests: translator 7 (incl. engine round-trip w/ folded stack trace), orchestrator E2E 2 (relay NEVER called on match; honest fall-through on mismatch), AMS merge 5 (incl. trimmed-persist), FE rider 6. Full discovery sweep: only the two suites already failing at baseline fail (modelScopeGuard, startDatabaseRunCandidatePersistence — pre-existing, verified via ae2fbed0 worktree).
- Fixes the observed zero-observation `fallback:validation_failed_exhausted` capture: declare the app's real pattern (e.g. `%d{dd,HH:mm:ss,SSS} %p [%t] [%c{1}] - %m%n`) in the run modal and extraction is deterministic.

### Item 8 (as-built) — NOTE: committed directly on main (1272a012); branch convention slipped once, content verified green
- New schedulerAdapters/autosysJil.ts: parseJilText/parseJilFiles (insert_job blocks; job_type/command/box_name/condition/start_times/days_of_week/watch_file); resolveJobsToMains (direct `java FQN` in command, else script-basename lookup in-repo + FQN/unique-simple-name scan of the script; boxes/file-watchers never resolve).
- runManager (code scan, after structural): resolves against corpus internal-root classes, appends data.schedules entries (job/box/times/days/condition/source) to matching internal endpoint candidates, steps_payload.scheduler {jilJobCount, commandJobsResolved, candidatesEnriched, unresolvedCommandJobs (capped 20, LOUD)}; parse failures non-fatal loud.
- Tests: parse pin (fields+blocks), resolve pin (script resolution, honest nulls). Discovery 16 suites/154.

### Item 7 (as-built)
- javaProjectIndex.beanPropertyHints: `<bean class=X>` blocks joined to project classes; `<property name value/>` pairs unioned across bean instances, sorted.
- behaviourExtractor: hints join the config-sql synthetic row — SQL-ish values verbatim; `*table?name*` properties with bare-identifier values synthesize `insert into <value>` (runtime-INSERT target attribution).
- Pattern widening found by the pin: the `{? = call f(...)}` RETURN-VALUE form defeated both SQL_TEXT_RE and the emitter's PROC_CALL_RE — both now accept `{? = call ...}`, so config-held delete-proc strings parse AND expand through the proc catalog.
- Tests: bean parse + union + proc-string pin; discovery 15/152.

### Item 6 (as-built)
- javaProjectIndex.webXmlHandlerMappings (regex servlet + servlet-mapping join by servlet-name, sorted).
- corpusAssembler detectWebXmlHandlers: direct servlet-class in index OR HttpRequestHandlerServlet bean resolution (@Component("name") / camelCase simple-name match + implements HttpRequestHandler); entry = handleRequest/service/doVerb; external root detail `web_xml:<url-pattern>`.
- runManager mintOperationalHttpCandidates (exported pure fn): one OPERATIONAL_HTTP interface + POST endpoint candidates (className/methodName threaded for internal-style walking too), deduped vs existing names; called after structural scan; bulk-saved.
- AMS INTERNAL_INTERFACE_TYPES += OPERATIONAL_HTTP (auto-classified OUT of capture scope; deliberate opt-in) — AMS REBUILD on pickup.
- Tests: mint pins (dedup, interface parent, silent no-op), end-to-end root pin (tmp project with web.xml + handler -> external web_xml root). SCL 14/147, AMS compiles.

### Item 5 (as-built)
- Frontend crud_write_only 'keep_all' answer carries payload {audit_sink: true}; MCP materializes constraints_metadata.audit_sink + decision ref per named table.
- AMVS: compensationMetadata.auditSinkTables (from constraints_metadata.audit_sink); end-of-job fingerprint tolerates audit sinks alongside volatile/keyless; runQuietWindowCheck (captureCompensation): counts every in-scope table twice gapSeconds apart (default 120), drift on unclassified tables = refusal payload naming each drifter; orchestrator fires it after compensation setup (compensation active + adapter) and REFUSES capture start (finalStatus failed, loud remedy message: quiet window or record volatile/audit-sink); tolerated-drift trace note; check errors are loud-not-fatal; test seams skipQuietCheck/gap/sleep.
- Gateway: IrTable.auditSink -> manifest.audit_sink_tables -> parity reconcile SKIPS audit sinks (they grow under any traffic; comparing is meaningless).
- Tests: quiet-check refusal + tolerance pin, auditSinkTables metadata pin; suites: AMVS orchestrator 5/10 + foundationScopeReaders 10, frontend 29, mcp 533 full, gateway 263.
- PICKUP: AMVS + frontend + mcp-server + gateway restarts.

### Item 4 (as-built)
- Pack capability probeKeyCandidate (Sybase: `(SELECT COUNT(*)) vs (SELECT COUNT(*) FROM (SELECT DISTINCT cols))` via /query, identifier-guarded); orchestrator Phase 5b generates <=3 tuples per PK-less table (unique-index cols; +temporal valid_from/valid_to pair; first-col+temporal fallback), probe budget 60, envelope keyProbes; runManager enriches table candidates data.parity_key_probes + steps_payload keyProbeTableCount.
- Frontend key_posture: a live-VERIFIED unique tuple rides EVERY option payload (parity_key + parity_key_verified) with detail note; no-unique -> parity_mode count_checksum on every option; probes fingerprint joins the evidence hash (changed probes reopen).
- MCP materializes constraints_metadata.parity_key {columns, verified, decision_ref} / parity_mode.
- Gateway: IrTable.parityKey from constraints_metadata; manifest.parity_keys; migrationDataParityReconcile PREFERS verified parity keys over manifest PKs (surrogate/absent/bi-temporally-weak PKs no longer force unverifiable).
- Sentinel pin: timestamp-truncate canonicalizes the 9999-12-31 open sentinel to a finite epoch identical from both engines' renderings.
- Tests: frontend 2 pins (verified-tuple payload, honest count+checksum), sentinel pin; suites: discovery 148, gateway 33/284+17, frontend foundations 22, mcp 4.
- PICKUP: discovery-service + frontend + mcp-server + gateway restarts; DB scan re-run probes keys.

### Item 3 (as-built)
- Sidecar (Java, REBUILD REQUIRED on pickup): optional `charset` threaded request-models -> controller -> query/mutation services -> DriverStrategy 6-arg overload (jConnect props CHARSET; jTDS `;charset=` URL param, identifier-validated); old signatures preserved (default null); 93 Java tests green.
- Discovery: SidecarCredentials.charset (all 3 request bodies); pack capability detectServerCharset (ASE sysconfigures 131/123 join syscharsets; caseSensitive = sortorder name lacks nocase/noaccent/insensitive) — on success DECLARES charset on the pack creds so introspection/profiling/harvest/probes all decode byte-correctly; orchestrator Phase 1b (before harvest); steps_payload.database.server_charset.
- Gateway pack: IR.sourceCharset + manifest.source_charset + bulk-load manifest source_charset (emitBulkLoadManifest arg); fetchServerCharsetFacts (AMS runs list, fail-soft) wired into generation; CASE-SENSITIVE sortorder raises PackDecision `target_collation--database` (preserve_case_sensitive rec / case_insensitive) unless resolved.
- AMVS: DbConnectionConfig.charset -> SybaseAdapter commonCredsBody (every sidecar call: metadata, S0 dump reads, data migration, compensation); data-migration CLI threads bulk-manifest source_charset (env SOURCE_DB_CHARSET fallback).
- Tests: detect+declare pin (creds carry charset on later calls; nocase=insensitive), AMVS creds-body pin; suites: sidecar 93, discovery 146+4, gateway pack 32+, AMVS 15/36.
- PICKUP: sidecar `mvn package` + restart sidecar, discovery-service, gateway, AMVS.

### Item 2 (as-built)
- Detector detectSequenceGeneratorIdioms (sqlProcHarvester, pure regex incl. backreference: update T set C=C+1 [where N=@p] + select gate). Orchestrator Phase 4c detects over live sources + optional pack capability probeSequenceRows (Sybase: guarded-identifier SELECT of name/value rows via /query, maxRows 200); envelope sequenceIdioms; runManager DB side enriches the sequence TABLE candidate: data.sequence_generator_idiom {procName, columns, rows, proposedMappings} — proposals from introspection columns (exact match then >=4-char suffix, cap 3, self-table excluded); steps_payload sequenceIdiomCount.
- Frontend rule `sequence_generator` (DB mode, per-table card FQ-sequence_generator-<table>): single target = the sequence table, note = sorted name(current)->table.column mapping summary (evidence hash reopens when rows/proposals change); options native_sequences (rec) / native_with_view (Q1 grant evidence) / table_emulation; payload {sequence_strategy, name_column, number_column, mappings}. EntityFacts gains sequenceGeneratorIdiom.
- MCP applyDecisionsToEntities materializes payload -> constraints_metadata.sequence_generator {strategy, columns, mappings, decision_ref}.
- Pack: IrTable.sequenceGenerator read from constraints_metadata (inputs.ts); buildSequenceSeeds emits per confirmed mapping `CREATE SEQUENCE IF NOT EXISTS <name>_seq; SELECT setval(..., MAX(col)+1 FROM loaded table)` in the EXISTING post-load sequences-seed changeset (the architecture's designated reseed home — no AMVS change needed); unmapped sequences = loud note, never silent; native_with_view adds CREATE OR REPLACE VIEW (name/number columns, last_value per sequence, UNION ALL); table_emulation = note (table migrates as data; proc semantics reimplemented in service layer).
- Tests: detector 2, rules card 2, MCP materialization 1, pack emission 2; cross-package sweep green (mcp 6, gateway 30, discovery 146, frontend 27).
- PICKUP: discovery-service + frontend + mcp-server + gateway restarts; DB scan re-run -> card appears on DB-run foundations.

### Item 1 (as-built)
- New: sybase/sybaseProcHarvest.ts (sysobjects+syscomments reassembly via /query, maxRows 20k, types P/F/TR) + optional pack capability `harvestProcSources` on DatabaseDiscoveryPack + orchestrator Phase 4b (soft-fail loud, envelope `procSources`) + DB run steps_payload.database.{proc_sources, procSourceCount}.
- Code side: archModelClient.listDiscoveryRuns (AMS GET runs list — endpoint pre-existing); runManager service-scoped step fetches latest COMPLETED database run's proc_sources (fail-soft repo-only) → structuralScanStep → sclScanRunner → sliceProject options.liveProcSources.
- sqlProcHarvester: ProcCatalogEntry gains bodyMd5 (whitespace-normalized md5) + source repo|live; catalogFromLiveSources; mergeProcCatalogs (LIVE WINS; findings proc_repo_drift/proc_live_only/proc_repo_only/proc_repo_duplicate; summary counts). SclFinding kind union widened. Slice carries procMergeSummary → corpus stats.procMerge (Structural Model header JSON).
- Tests: harvester 7 (md5 insensitivity, drift live-wins tables, live/repo-only, repo-dup loud), sybaseProcHarvest 2 (reassembly order, empty-honest), emitter catalog literals updated. SCL+packs 15 suites/144 green.
- PICKUP: discovery-service restart only (no sidecar rebuild). DB scan re-run harvests live sources; code scan re-run merges.
