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
   + post-load `setval(max(col)+1)`. STATUS: pending.
3. **Charset detection + transcode** — sidecar reads charset/sortorder
   config tables; declared on the extraction CONNECTION (jConnect CHARSET)
   so strings decode correctly at source; case-sensitivity → target
   collation decision card. STATUS: pending.
4. **Parity keys** — DB scan runs read-only uniqueness probes
   (`count(*)` vs `count(distinct …)`) over candidate tuples (unique-index
   cols ± temporal `valid_from`/`valid_to`-style pair ± composites);
   key-posture foundations propose a VERIFIED `parity_key` per table
   (stored like key_policy, reconciler-materialized); reconcile join
   consumes it; count+checksum for truly keyless; pinned test that the
   `9999-12-31` open sentinel survives type mapping. STATUS: pending.
5. **Quiet-window guardrail + audit-sink** — AMVS pre-capture fingerprints
   twice (configurable gap), REFUSES to start until every drifting table is
   volatile/audit-sink (named list); write-only foundations answer records
   `audit_sink` policy consumed by S0 tolerance + compensation
   (count-only, never compensated) + parity. STATUS: pending.
6. **web.xml servlet roots** — root detector for `HttpRequestHandler`-
   implementing beans mapped via `servlet-mapping`; corpus roots + endpoint
   candidates defaulted capture-scope EXCLUDED (like internal
   auto-exclusion; a cache rebuild mid-capture is exactly what the quiet
   rule forbids). STATUS: pending.
7. **Spring bean-property attribution** — `<bean><property name value>`
   parsed per class; `*table?name*` properties with identifier values
   attribute the runtime-INSERT loader's writes (per-class union across
   bean instances); SQL-ish property values join effect walks verbatim.
   STATUS: pending.
8. **.jil scheduler adapter** — parse in-repo Autosys jil (job → command →
   shell → Java main resolved by scanning the named script); schedule/box/
   conditions attached to internal endpoint candidates; loud finding for
   jobs resolving to no known main; silent no-op when no jil files.
   STATUS: pending.
9. **Log pointing + deterministic pattern translation** — code-scan config
   accepts app-log path + pattern; log4j/logback ConversionPattern
   translated mechanically to the recorder recipe; LLM induction demoted to
   fallback. STATUS: pending.

## Per-item as-built notes

### Item 1 (as-built)
- New: sybase/sybaseProcHarvest.ts (sysobjects+syscomments reassembly via /query, maxRows 20k, types P/F/TR) + optional pack capability `harvestProcSources` on DatabaseDiscoveryPack + orchestrator Phase 4b (soft-fail loud, envelope `procSources`) + DB run steps_payload.database.{proc_sources, procSourceCount}.
- Code side: archModelClient.listDiscoveryRuns (AMS GET runs list — endpoint pre-existing); runManager service-scoped step fetches latest COMPLETED database run's proc_sources (fail-soft repo-only) → structuralScanStep → sclScanRunner → sliceProject options.liveProcSources.
- sqlProcHarvester: ProcCatalogEntry gains bodyMd5 (whitespace-normalized md5) + source repo|live; catalogFromLiveSources; mergeProcCatalogs (LIVE WINS; findings proc_repo_drift/proc_live_only/proc_repo_only/proc_repo_duplicate; summary counts). SclFinding kind union widened. Slice carries procMergeSummary → corpus stats.procMerge (Structural Model header JSON).
- Tests: harvester 7 (md5 insensitivity, drift live-wins tables, live/repo-only, repo-dup loud), sybaseProcHarvest 2 (reassembly order, empty-honest), emitter catalog literals updated. SCL+packs 15 suites/144 green.
- PICKUP: discovery-service restart only (no sidecar rebuild). DB scan re-run harvests live sources; code scan re-run merges.
