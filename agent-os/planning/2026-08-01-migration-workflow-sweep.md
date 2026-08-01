# Migration Workflow Sweep — 2026-08-01

Full-pipeline handoff audit driven by the live save-back constraint-metadata drop
(user's Sybase→PostgreSQL migration). Method: field-inventory diff at every
producer→consumer handoff, plus truthiness/wire-case/swallowed-error hunting.

## Status — COMPLETE (2026-08-01)

- [x] Phase 1: fix known save-back drops (constraints_metadata, fk_columns, database wire key + reuse-path backfill)
- [x] Phase 2: 7-segment sweep (background Explore agents, all returned)
- [x] Phase 3: every candidate finding verified at the cited site (verdicts below)
- [x] Phase 4: verified bugs fixed — 4 merges on main, all pushed

## Known bugs (Phase 1 — confirmed by direct read)

| # | Site | Bug |
|---|------|-----|
| K1 | mcp-server/src/services/candidateSaveBackService.ts:1220 | physical branch drops `data.constraints_metadata` entirely |
| K2 | same branch :1231 | writes `database_name` but PhysicalDataEntityDto wire key is `database` (EntityMapper.java:620 `.databaseName(dto.database())`) → silently ignored by Jackson |
| K3 | :3193 (Pass 2 builder) + :1479 (switch branch) + :3594 (enrich builder) | relationship rows never carry `data.fk_columns` (LogicalDataEntityRelationshipDto has snake `fk_columns`) → empty 020-foreign-keys.sql |
| K4 | :2922 (dedup suppress) / :2975 (reuse) / :3180 (Pass 2 existingRel) / :3589 (enrich existsRel) | idempotent paths never enrich existing rows → a re-scan can NEVER backfill the already-committed model; fix must add additive-if-missing backfill |

Downstream consumers verified correct (no changes needed): frontend
`types/model.ts:597` reads `database`/`constraints_metadata`; gateway
`dbMigrationPack/inputs.ts` reads `constraints_metadata`/`fk_columns`/`database`.
Save eligibility: `review_status === 'approved'` only → live-model backfill path
is re-scan → approve → save (suppression-path enrichment does the work).

## Segment agents (Phase 2)

1. capture→candidates (discovery-service DB packs + AMVS emitter)
2. candidates→model (save-back remaining branches vs AMS DTOs)
3. model→DB pack (IR readers, DDL emission, manifest, validation, planner)
4. planning+dispatch (book of work, spec gen, driver state machine, IVS submit, callbacks)
5. DB-plane completion chain (assemble → schema-apply → data load → parity)
6. stage-2 service plane (creds, serve spec, haibox wire, reconcile, gates)
7. cross-cutting wire-case + swallowed-error audit

## Verified findings (Phase 3)

(V = verified by direct read, FP = false positive, ? = pending verification)

From agents 1 (capture→candidates), 2 (save-back), 6 (stage-2), 7 (wire-case):

| id | status | finding |
|----|--------|---------|
| A1-1 | V (fold into Phase 1) | physical_data_attributes branch (saveBack :1421) drops the 6 DTO-backed fidelity fields source_type/scale/precision/column_default/ordinal/is_identity; PhysicalDataAttributeDto declares exactly those 6; EntityMapper :658-663 maps them; gateway inputs.ts:68-73+349-362 READS them for DDL typeMapping → committed models lose column type fidelity |
| A1-2 | FP-actionable | logical_data_attributes "same drop" — LogicalDataAttributeDto has NO fidelity slots; carrying would be inert. Note only |
| A1-3 | note (P2) | discovery emits sequence_name/collation/is_generated/generation_expression but AMS has NO storage (entity lacks columns) → real fidelity gap needing AMS schema change; user question: do computed columns/collation matter in their schema? |
| A2-3 | V (minor) | switch case 'logical_data_entity_relationships' :1479 is unreachable (deferred at :2742 first) and writes source_entity/target_entity keys the DTO doesn't have. Keep + comment + fk carriage (tests call convertCandidateToEntity directly) |
| A6-1 | ? (P2) | toTargetWire omits haibox `setup` (node targets need npm install; spring mvn ok). Optional-field enhancement |
| A6-2 | ? | serve-spec read at dispatch time race — likely by-design (UI registers before Start); verify |
| A6-3 | ? (P2) | IVS OrchestrationRequest.target is Optional[dict] unvalidated; **target unpack → unknown key = TypeError? verify + consider Pydantic model |
| A6-5 | FP (by design) | break-glass every(data_parity_*) — intentional: override can't clear non-parity blockers |
| A6-6 | FP (by design) | in-memory serve spec lost on restart → documented CD-2 pause |
| A7-2 | ? | toAmsWireShape omits stale/stale_reason/stale_marked_at → wipe on round-trip? AMS comment says update IGNORES them (read-only) → likely FP; verify updateEntityFromDto |
| A7-3 | ? | defaultApplySchema resp.json().catch(()=>({})) — ok-but-malformed-json treated as success? verify ordering vs response.ok |
| A7-4 | ? | finalize falls back to stale run on refresh failure — verify severity |
| A7-5 | FP (by design) | waiver fetch fail-soft to [] documented "stricter only" |
| A7-6/7 | P3 | logging/validation hardening notes |

All 7 agents complete. Final Phase-3 verdicts on the remaining findings:

| id | verdict | detail |
|----|---------|--------|
| G3-1 (expected_schema misses checks) | FP | dbMigrationPackDrift.ts:368-370 documents the v1 exclusion ("diffing them would only produce noise"); kind union has check_constraint for a future v2 |
| G3-2 (check exprs verbatim) | VERIFIED → Branch A | liquibase.ts:222-226 emits Sybase check expressions verbatim; defaults (translateDefault) + computed columns both have translation pipelines; checks have none → getdate()/datalength() etc. fail at schema-apply |
| G3-3 (index directions verbatim) | VERIFIED-minor → Branch A | emitIndexesChangeset :342-346 emits any direction string; guard to ASC/DESC |
| G3-4 (index predicate/method ignored) | moot | generator is Sybase ASE→PG only (types.ts SourcePairError); ASE has no partial indexes; predicate always null |
| G4-1 outcome 'failed' vs 'error' | FP | both accepted; non-implemented/deployed handled as failure either way |
| G4-2 implemented drops target_base_url | FP | by design (mid-run has no serving URL) |
| G4-3 outcome/status case | FP | belt-and-braces OR; both sides written lowercase by the same driver |
| G4-4 requirements_text no post-write assert | note P3 | same-process write→read; hardening only |
| G4-5 batch dedup race | FP | IVS dedup returning the existing job is the designed idempotency |
| G4-6 retry-guard substring | VERIFIED-minor → Branch B | driver:2219 `.includes('DB execution chain failed')` → startsWith('DB execution chain failed at ') (writer template migrationDbPlaneCompletion.ts:542) |
| G5-1 dual path normalisers | VERIFIED (downgraded) → Branch C | normalise() (slashes, leading ./) vs normalisePath() (segment collapse, no backslash fix) — mismatch causes a LOUD 422 (issues), not silent skip; unify anyway |
| G5-2 log INSERT escaping | FP/P3 | SqlExecutor is single-arg by design; ids pass the assembly charset gate; escape is safe |
| G5-3 stale error_detail on DEPLOYED | downgraded → Branch B | retry reset (driver:2248-2252) already nulls it; add `error_detail: null` to the finalize DEPLOYED patch as invariant hardening |
| G5-7 kind dropped on assemble submit | note P3 | IVS doesn't consume kind |
| G6-1 no haibox `setup` in serve spec | enhancement (user question) | node targets need `npm install` setup; spring `mvn spring-boot:run` self-builds — user's target is Spring |
| G6-2 serve-spec dispatch-time read | FP | stage-2 Start dialog registers creds then starts; ordering guaranteed by the UI flow |
| G6-3 IVS **target unpack | FP | HaiboxClient.serve has explicit kwargs → unknown key = TypeError = loud job failure; keys currently aligned |
| G7-2 stale trio wipe on PATCH | FP | AMS stale fields are server-side read-only (update ignores them; null-guarded convention) |
| G7-3 applySchema json catch→{} | VERIFIED → Branch B | 200-with-unparseable-body returns ok:true applied:0 — treat parse failure on ok as failure |
| G7-4 finalize stale-run fallback | note P3 | fresh ?? run fallback is deliberate keep-moving; safePatch absorbs |
| G7-5/6/7 | notes P3 | documented fail-soft / logging / validation hardening |
| A1-3 sequence_name/collation/is_generated/generation_expression | user question | discovery emits; AMS has no columns; matters only if the schema uses computed columns/collations |

## Fix log (Phase 4) — all merged --no-ff to main and PUSHED

| merge | branch | content |
|-------|--------|---------|
| f343911 | fix/save-back-structural-carriage (mcp-server) | constraints_metadata carriage; database DTO wire key (database_name never bound); 6 attribute fidelity slots (source_type/scale/precision/column_default/ordinal/is_identity); fk_columns on all 3 relationship builders; ADDITIVE BACKFILL on suppression/reuse/Pass-2/enrich paths so re-scan + approve + save heals a pre-fix model. 26 suites / 152 tests green. |
| 7498ee1 | fix/db-pack-check-expression-portability (gateway) | translateCheckExpression token-walker (getdate→now, len→length, isnull→coalesce; IN-before-paren = list); non-portable checks SKIPPED with loud verbatim-source comment; index directions guarded to ASC/DESC. 12 suites / 86 tests green. |
| 4d3602b | fix/db-chain-robustness (gateway) | schema-apply 2xx-with-unparseable-body = failure (was ok/applied:0); DEPLOYED patch clears error_detail; retry guard anchored startsWith('DB execution chain failed at '). 4 suites / 79 tests green. |
| baac418 | fix/schema-apply-path-normalisation (AMVS) | one canonical normalisePackPath (backslash + ./.. collapse) for file keying, master lookup, include resolution. 11 tests green. |

## User questions — ANSWERED + BUILT (2026-08-01, second round)

1. Haibox `setup` field — user wants it → BUILT (merge 8f23664,
   feat/serve-spec-setup-field): FE stage-2 "Setup command" input
   (start-stage-serve-setup) prefilled from the derived binding; gateway
   TargetServeSpec.setup + route validation (whitespace-only = absent) +
   toTargetWire → haibox serve() `setup` kwarg (IVS passes the target block
   through unchanged); per-runtime defaults (node → `npm install`, python →
   `pip install -r requirements.txt`, dotnet → `dotnet restore`;
   spring/gradle/go self-build → '').
2. Computed columns / non-default collations for the GENERIC tool — user
   confirmed many Sybase sources will have them. VERIFICATION OUTCOME: the
   pipeline already handles both end-to-end via the FINDINGS channel by
   design — Sybase capture (Group B collation / Group E computed / Group C
   sequences, discovery sybaseFindings.ts) → AMS findings → pack-gen IR
   merge (inputs.ts:420 collation handler; :504 tolerant generation-
   expression merge, "these facts exist ONLY in findings, never on committed
   attributes") → citext / computed-column needs_decisions →
   `GENERATED ALWAYS AS (...) STORED` emission → bulk-load EXCLUDES
   generated columns (AMVS buildLoadPlan.ts:78). The model-storage gap I
   originally flagged is deliberate architecture, not a bug. BUILT (merge
   ce24649, feat/findings-channel-visibility): structural_accounting now
   surfaces collation_hazard_columns / generated_columns /
   sequences_captured (numbers only, no zero-warnings — zero can be legit)
   so a source whose findings were lost is visibly suspicious; the
   save-back comment now documents the findings-channel design.

## Work-machine pickup (fresh clone as usual)

Services changed: mcp-server, gateway, api-migration-validation-service (restart
all three; NO new dependencies). Rescue sequence for the live migration:
1. Re-run the DB discovery scan → approve all → save. The save-back backfills
   constraints_metadata / database / attribute fidelity / fk_columns onto the
   EXISTING committed entities (watch for the `[save-back] Structural backfill
   repaired N missing field(s)` log line; entity grid now shows DB names).
2. Regenerate the DB migration pack — DDL now carries PKs / uniques / indexes /
   translated checks / typed columns (precision/scale/default/identity), and
   020-foreign-keys.sql is no longer empty.
3. On the halted run: Retry DB build… (stage-1 modal, both DB sections). The
   assemble step overlays the CURRENT pack from AMS, so the retried chain picks
   up the regenerated files automatically.
