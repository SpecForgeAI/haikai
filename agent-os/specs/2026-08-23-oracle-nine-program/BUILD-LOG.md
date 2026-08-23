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
