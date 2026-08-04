# Spec Requirements: Runtime Log Evidence — Format-Agnostic Extraction

## Initial Description

Runtime log evidence — format-agnostic extraction wired into migration readiness.

The "Create Migration Delivery Plan" wizard shows "Insufficient runtime evidence"
even when the user uploaded a large (27MB) full-day runtime log rich with API
endpoints. The goal is to extract HTTP request observations (and response/headers/body
where the log contains them) from runtime logs of ARBITRARY format, robustly and
cheaply, and PERSIST them so they count — clearing the gap and recording real
runtime usage. Because "deterministically parse every log format in the world" is
unachievable, an LLM RECOGNISES the format once on a small redacted sample, then
deterministic code APPLIES the inferred recipe to the whole file.

(Full diagnosed problem, settled solution, grounding code, and non-goals are recorded
verbatim in `planning/raw-idea.md`.)

## Diagnosed Problem (verified in code this session)

The wizard's "Insufficient runtime evidence" message has TWO independent root causes,
both verified against the codebase:

### Break 1 — Broken matcher (parser cannot read the real log)

`discovery-service` `src/services/runtimeEvidence/runDiscoveryRuntimeEvidence.ts`
(~lines 93-94) uses `HTTP_METHOD_PATH_REGEX = /\b(GET|POST|...)\s+(\/[^\s...]+).../`
which requires a path that starts with `/` IMMEDIATELY after the HTTP method. The
user's real log is a bespoke SampleSvc trace where each request is
`<reqId> > METHOD http://host:port/path` (an ABSOLUTE URL, not a `/path`), followed
by `<reqId> > header: value` lines, a blank `<reqId> >`, then a JSON body, all
interleaved with log4j lines whose logger is bracketed (`[thread] [logger]`). The
regex cannot match `POST http://...`, so it extracts ZERO observations. Format
detection also lands on unknown -> plaintext, and the bracketed-logger lines fail
the framework parser.

### Break 2 — Dead evidence branch (uploaded log never produces countable evidence)

Uploading a runtime log only writes the file to disk and records metadata in
`config_snapshot.inputArtifacts.logFiles[]` (gateway `discoveryRunLogService.ts`
`writeLogFilesAndPatchRun`; AMS `DiscoveryRunService.java` `patchLogFileArtifacts`).
The scan-time runtime stage (`runtimeEvidencePersistence.ts`) NEVER writes a
`discovery_evidence` row — it only writes `steps_payload` + in-memory enrichment +
(potentially) `runtime_usage` findings. The ONLY code that writes `source='log'`
evidence is the Increment-14 logExtractors (`src/services/logExtractors/`), reachable
ONLY from the stranded manual route `routes/logEnrichment.ts`
(`POST /discovery/log-enrichment`) — never called by the scan/upload.

### The Consumer / the Gap (verified — NOT to be modified)

AMS `service/migration/MigrationDiscoveryContextService.java`
`buildRuntimeUsageSummary` (~lines 944-960):

- `hasRuntimeEvidence = (runtimeEvidenceCount > 0 || runtimeFindingCount > 0)`
- `runtimeEvidenceCount` = count of in-scope `discovery_evidence` rows with
  `source == 'log'`
- `runtimeFindingCount` = count of in-scope findings whose category is in
  `{runtime_usage, runtime_log, log}`
- The `insufficient_runtime_evidence` gap fires when `hasRuntimeEvidence` is false.
- Scope = latest 3 COMPLETED runs of the CURRENT architecture.

Because of the two breaks above, BOTH counts are structurally 0 today, so the gap
always fires. This consumer is NOT modified by this spec; the gap clears
automatically once `source='log'` evidence flows into `discovery_evidence`.

## Requirements Discussion

### First Round Questions

The user reviewed 11 recommended-default decisions covering the open shaping questions
from `raw-idea.md` and answered: **"defaults are fine"** — accepting ALL recommended
defaults for questions 1-11.

**Q1 — Induction LLM home + client/model:**
How should the LLM induction call be made, and which client/model?
**Answer (accepted default):** Induction LLM is invoked via the existing
`gatewayClient.gapFill` relay through a NEW dedicated sibling gateway endpoint
(e.g. `/discovery/v3/log-recipe`). The model is selected gateway-side (latest Claude
per gateway config). NO Anthropic SDK is added to discovery-service.

**Q2 — Token / char budget cap for the sample:**
What is the sample size cap sent to the LLM?
**Answer (accepted default):** Assembled redacted sample capped at ~12k chars total;
per-line truncation at ~2k chars.

**Q3 — Recipe persistence location + caching key:**
Where is the inferred recipe persisted and how is reuse keyed?
**Answer (accepted default):** Recipe persisted on the run in
`steps_payload.v3.runtimeEvidence.recipe` (NO schema change). Reuse keyed by a
format-fingerprint hash, with a fallback per-source-file.

**Q4 — Reuse Increment-14 logExtractors vs new extractor:**
Should the deterministic extractor/persistence reuse Increment-14 code or be net-new?
**Answer (accepted default):** Reuse the Increment-14 evidence-atom +
`bulkSaveEvidence` persistence path; drive it from a NEW recipe-aware extractor for
the rich fields. Do NOT extend the old regex-only `endpointUsageExtractor` for
richness.

**Q5 — Does the gap require endpoint-MATCHED findings, or is `source='log'` evidence enough?**
**Answer (accepted default):** v1 MUST guarantee writing `source='log'`
`discovery_evidence` rows (this alone clears the gap). It will ALSO run the existing
matcher (`endpointRuntimeMatcher` / aggregator / `pathNormalizer`) to emit
`runtime_usage` findings best-effort where paths match candidates. Matched findings
are best-effort, NOT a hard requirement.

**Q6 — Auto-run inside scan vs separate manual trigger:**
Should the runtime stage auto-run on a code discovery scan when logFiles are present?
**Answer (accepted default):** Keep it auto-running inside the normal V3 scan
(Stage 2.5). LLM induction fires ONLY when logFiles are present AND the deterministic
fast-path is thin. NO separate manual trigger in v1.

**Q7 — Recipe acceptance threshold + bounded-retry count:**
What confidence threshold accepts a recipe, and how many retries?
**Answer (accepted default):** Accept a recipe if it extracts method+path from >=60%
of request-like lines in one held-out block; else re-sample up to 2 retries (max 3
LLM calls per file) before falling back to the deterministic matcher.

**Q8 — Redaction approach for samples:**
How are samples redacted before leaving the process?
**Answer (accepted default):** Redact samples using `snippetRedaction.redactFullBody`'s
secret scrub (the existing defaults). Base reuse, nothing extra added.

**Q9 — Response-capture + capture-seed-data harvesting in scope now or fast-follow?**
**Answer (accepted default):** In THIS spec the recipe-driven extractor pulls AND
PERSISTS response status/body + request body WHEN the log contains them. Turning
those into formal capture seed-data fixtures is a FAST-FOLLOW (out of scope here).

**Q10 — Behaviour on ~0 extraction despite pre-scan hits:**
What happens if the pre-scan finds candidate lines but extraction yields ~nothing?
**Answer (accepted default):** Never fail the run. Record a structured diagnostic in
`steps_payload.v3.runtimeEvidence` (e.g. `extractionOutcome`) AND emit a low-severity
`runtime_log` finding for visibility. No new gap type is introduced.

**Q11 — Multi-file + very-large-file streaming limits:**
How are large files and multiple files handled?
**Answer (accepted default):** Keep existing caps (`LOG_PARSE_MAX_FILE_BYTES` = 100MB
per-file skip-with-warning; 2GB bundle). Stream the file. Induce ONE recipe per file
(do NOT assume a shared format across multiple files).

### Existing Code to Reference

**Similar Features Identified (verified reuse targets):**

- **Deterministic extraction + persistence path** — `discovery-service`
  `src/services/logExtractors/` plus `bulkSaveEvidence`. Already writes `source='log'`
  evidence atoms. Reuse the evidence-atom + `bulkSaveEvidence` persistence; drive it
  from a NEW recipe-aware extractor for the rich fields (do NOT extend the old
  regex-only `endpointUsageExtractor`).
- **Runtime matching** — `endpointRuntimeMatcher`, `endpointRuntimeAggregator`,
  `endpointPathNormalizer`. Reuse to emit best-effort `runtime_usage` findings where
  extracted paths match discovered endpoint candidates.
- **LLM relay** — `gatewayClient.gapFill`. Reuse as the relay for the LLM induction
  call, routed through the NEW dedicated sibling gateway endpoint
  (e.g. `/discovery/v3/log-recipe`).
- **Redaction** — `snippetRedaction.redactFullBody`. Reuse its secret-scrub defaults
  to redact every sample block before it leaves the process.
- **Stage 2.5 code to MODIFY** — `runtimeEvidence/runDiscoveryRuntimeEvidence.ts`
  (broken regex + reads `config_snapshot` logFiles) and
  `runtimeEvidence/runtimeEvidencePersistence.ts` (writes no evidence today). Stage
  2.5 is invoked from `discoveryV3Pipeline.ts` (~lines 1140-1190).
- **Supporting log code (context)** — `logParsing/logFormatDetector.ts` +
  `frameworkPatternParser.ts` (detection), `accessLogParser.ts` (CLF),
  `routes/logEnrichment.ts` (the stranded manual route),
  `services/archModelClient.ts` (evidence/finding writes).
- **AMS persistence targets** — `model/entity/discovery/DiscoveryEvidenceEntity.java`
  (the `source` field) and its repository (`findByRunId`); `DiscoveryFindingEntity`
  (`finding_type` / `category`).
- **AMS consumer (NOT modified)** —
  `service/migration/MigrationDiscoveryContextService.java`
  `buildRuntimeUsageSummary`. This is the gap consumer; the gap clears once evidence
  flows. Do NOT change it.
- **Gateway upload (context)** — `services/discoveryRunLogService.ts` (writes disk +
  metadata only); AMS `service/DiscoveryRunService.java` `patchLogFileArtifacts`
  (`config_snapshot` only).
- **Frontend (NO change needed)** — `gapWayfindingRegistry.ts` +
  `MigrationDeliveryPlanWizard.tsx`. The gap is backend pre-computed and clears
  automatically once evidence flows.

### Follow-up Questions

None. The user accepted all recommended defaults in a single response, so no follow-up
round was required.

## Visual Assets

### Files Provided:

No visual assets provided. The `planning/visuals/` folder was checked via bash and
contained no image or PDF files.

### Visual Insights:

Not applicable — no visual assets to analyze.

## Requirements Summary

### Functional Requirements

This spec implements a quality-first, format-agnostic runtime-log extraction pipeline
wired into the V3 scan so that runtime evidence becomes countable and the migration
gap clears.

**Quality-first ordering (deliberate inversion of cost-first):** attempt the BEST
extraction first; fall back to a flexible deterministic matcher ONLY if the smart path
fails.

1. **Ingest precondition (dead-branch fix):** the runtime log uploaded to a discovery
   run MUST be consumed by the runtime stage (today it is stranded on disk +
   `config_snapshot` metadata only). Wiring this in is part of the build.

2. **Pre-scan + sample (cheap, streaming, no LLM):** scan the WHOLE file for candidate
   request lines (an HTTP verb, OR `http(s)://`, OR a `/seg/seg` path token). Build
   8-12 sample BLOCKS, each = a hit line plus ~10 lines BEFORE and ~30 lines AFTER
   (~40 lines, enough to span a full request->response cycle). Spread blocks across the
   file by BYTE OFFSET (not just the head — startup banners live at the top). Dedup
   near-identical blocks. Truncate over-long individual lines (~2k chars). REDACT every
   block before it leaves the process. Cap the assembled sample to ~12k chars total. If
   the pre-scan finds NO hits, fall back to offset-stratified head/middle/tail windows
   so the LLM still gets representative data.

3. **Known-format fast path (richness-gated):** try the existing structured parsers
   (CLF / combined / JSON-lines). Use deterministic structured extraction for the whole
   file ONLY IF it yields the RICH field set the log supports (method, path, request
   headers, request body, response status + body). If it comes back THIN, do NOT settle
   — go to the LLM step. (A plain CLF log has no bodies/responses, so it fails the
   richness gate and falls to the LLM, which also cannot invent what isn't logged — we
   take the best available; no harm, one extra call.)

4. **LLM pattern induction:** send the redacted sample blocks to the LLM via
   `gatewayClient.gapFill` -> NEW `/discovery/v3/log-recipe` gateway endpoint
   (model selected gateway-side). The LLM returns a STRUCTURED RECIPE (record delimiter
   + field rules for all 5 fields: method, path, headers, body, response) OR
   "no pattern". VALIDATE the recipe by applying it to a HELD-OUT block the LLM did NOT
   see; accept if it extracts method+path from >=60% of request-like lines in that
   block; else re-sample with different/more blocks (bounded: up to 2 retries, max 3
   LLM calls per file) before giving up.

5. **Deterministic full-file extraction:** (a) if a validated recipe exists -> a
   deterministic engine applies it across the FULL file (e.g. 27MB), pulling EVERY field
   the log actually contains (method, path, headers, body, response IF logged — never
   invent a response that isn't there); (b) if the LLM found no pattern OR its recipe
   failed validation -> fall back to the single FLEXIBLE deterministic matcher,
   broadened to accept `METHOD <absolute-URL>` as well as `METHOD /path`, extracting
   method+path, which always at least clears the gap. CRITICAL invariant: the LLM ONLY
   ever sees the small redacted samples; the WHOLE file is ALWAYS processed by
   deterministic code.

6. **Persist + wire (the dead-branch fix):** turn extracted observations into COUNTABLE
   evidence — write `source='log'` `discovery_evidence` rows (reusing the Increment-14
   evidence-atom + `bulkSaveEvidence` path, driven by the new recipe-aware extractor)
   AND best-effort `runtime_usage` findings matched to discovered endpoint candidates
   where paths match. Persist the inferred recipe on the run
   (`steps_payload.v3.runtimeEvidence.recipe`) for auditable free reuse on re-runs /
   same-source files (keyed by format-fingerprint hash, fallback per-source-file). This
   flips `hasRuntimeEvidence` true -> the `insufficient_runtime_evidence` gap clears.

7. **Surface:** runtime usage counts visible; gap cleared; recipe auditable. On ~0
   extraction despite pre-scan hits, never fail the run — record a structured diagnostic
   in `steps_payload.v3.runtimeEvidence` (e.g. `extractionOutcome`) AND emit a
   low-severity `runtime_log` finding for visibility (no new gap type).

**Resolved decisions (all accepted defaults, carry as FIXED):**

1. Induction LLM via existing `gatewayClient.gapFill` relay through a NEW dedicated
   sibling gateway endpoint (e.g. `/discovery/v3/log-recipe`); model selected
   gateway-side (latest Claude per gateway config) — no Anthropic SDK in
   discovery-service.
2. Assembled redacted sample capped ~12k chars total; per-line truncation ~2k chars.
3. Recipe persisted on the run in `steps_payload.v3.runtimeEvidence.recipe` (NO schema
   change); reuse keyed by a format-fingerprint hash, fallback per-source-file.
4. Reuse the Increment-14 evidence-atom + `bulkSaveEvidence` persistence path; drive it
   from a NEW recipe-aware extractor for the rich fields (don't extend the old
   regex-only `endpointUsageExtractor` for richness).
5. v1 MUST guarantee writing `source='log'` `discovery_evidence` rows (clears the gap);
   ALSO run the existing matcher (`endpointRuntimeMatcher` / aggregator /
   `pathNormalizer`) to emit `runtime_usage` findings best-effort where paths match
   candidates — matched findings are best-effort, NOT a hard requirement.
6. Keep it auto-running inside the normal V3 scan (Stage 2.5); LLM induction fires only
   when logFiles present AND the deterministic fast-path is thin. NO separate manual
   trigger in v1.
7. Accept a recipe if it extracts method+path from >=60% of request-like lines in one
   held-out block; else re-sample up to 2 retries (max 3 LLM calls/file) before the
   deterministic fallback.
8. Redact samples using `snippetRedaction.redactFullBody`'s secret scrub (the existing
   defaults) — base reuse, nothing extra added.
9. In THIS spec the recipe-driven extractor pulls + PERSISTS response status/body +
   request body WHEN the log contains them; turning those into formal capture seed-data
   fixtures is a FAST-FOLLOW (out of scope).
10. On ~0 extraction despite pre-scan hits: never fail the run; record a structured
    diagnostic in `steps_payload.v3.runtimeEvidence` (e.g. `extractionOutcome`) AND emit
    a low-severity `runtime_log` finding for visibility — no new gap type.
11. Keep existing caps (`LOG_PARSE_MAX_FILE_BYTES` = 100MB per-file skip-with-warning;
    2GB bundle); stream the file; induce ONE recipe per file (don't assume a shared
    format across multiple files).

### Reusability Opportunities

- **Persistence:** `logExtractors/` evidence-atom + `bulkSaveEvidence` (already writes
  `source='log'` evidence) — reuse the persistence, drive from a NEW recipe-aware
  extractor.
- **Matching:** `endpointRuntimeMatcher` / `endpointRuntimeAggregator` /
  `endpointPathNormalizer` — reuse for best-effort `runtime_usage` findings.
- **LLM relay:** `gatewayClient.gapFill` — reuse as the induction relay.
- **Redaction:** `snippetRedaction.redactFullBody` — reuse secret-scrub defaults.
- **Stage 2.5:** `runDiscoveryRuntimeEvidence.ts` + `runtimeEvidencePersistence.ts` —
  the code to modify (broaden matcher; add evidence write).
- **AMS:** `DiscoveryEvidenceEntity` + repository + `DiscoveryFindingEntity` —
  persistence targets.

### Scope Boundaries

**In Scope:**

- Wiring uploaded runtime logs into the V3 runtime stage (Stage 2.5) so they are
  actually consumed (ingest precondition / dead-branch fix).
- Streaming pre-scan + relevance-anchored byte-offset-spread sampling with dedup,
  per-line truncation, redaction, and total-budget cap; head/middle/tail fallback on
  zero hits.
- Richness-gated known-format fast path.
- LLM pattern induction via the new gateway endpoint, returning a structured recipe;
  held-out validation; bounded retries; deterministic fallback matcher broadened for
  absolute URLs.
- Deterministic full-file application of a validated recipe, extracting all logged
  fields including response status/body and request body WHEN present.
- Persisting `source='log'` `discovery_evidence` rows (clears the gap) plus best-effort
  matched `runtime_usage` findings.
- Persisting the inferred recipe on the run for auditable reuse (fingerprint-keyed).
- Structured `extractionOutcome` diagnostic + low-severity `runtime_log` finding on
  ~0-despite-hits.
- One recipe induced per file; existing file/bundle size caps respected.

**Out of Scope:**

- Turning extracted response/request bodies into formal capture seed-data fixtures
  (FAST-FOLLOW — productization of seed data).
- Any change to the migration-plan wizard / gap registry UI (the gap clears upstream
  automatically).
- Any modification of the AMS consumer
  `MigrationDiscoveryContextService.buildRuntimeUsageSummary` (gap clears once evidence
  flows).
- Inventing responses (or any field) not present in the log.
- Real-time / streaming ingestion (this is batch, at discovery-run time).
- The "No sample data hints" bug (already fixed separately this session).
- Adding an Anthropic SDK to discovery-service (model selection stays gateway-side).
- A separate manual trigger for the runtime stage in v1.
- Any DB schema change (recipe lives in `steps_payload`).

### Technical Considerations

- **No schema change:** the recipe is stored in
  `steps_payload.v3.runtimeEvidence.recipe`; the diagnostic in
  `steps_payload.v3.runtimeEvidence.extractionOutcome`.
- **LLM isolation invariant:** the LLM ONLY ever sees small redacted samples; the whole
  file is ALWAYS processed deterministically. Model selection is gateway-side.
- **Cost bound:** one small LLM call per file/format, max 3 calls per file (induction +
  up to 2 re-samples); recipe cached/persisted for reuse (fingerprint key, per-file
  fallback).
- **Redaction is mandatory** on every sample block before it leaves the process.
- **Size caps:** `LOG_PARSE_MAX_FILE_BYTES` = 100MB (per-file skip-with-warning); 2GB
  bundle; file is streamed; one recipe per file (no cross-file format assumption).
- **Determinism of pre-scan/sampler** is required so sampling is reproducible.
- **Stack:** discovery-service (TypeScript/Node), gateway (TypeScript/Node), AMS
  (Java 21 / Spring Boot 3.x, PostgreSQL via Spring Data JPA). AMS wire format is
  `snake_case` by default (per repo CLAUDE.md); evidence/finding persistence flows
  through existing AMS entities/repositories.

### Load-Bearing Test Surfaces

These behaviours must be covered by tests; they are the failure modes that define
"good" for this spec:

1. **Broadened deterministic matcher** MUST extract method+path from an absolute-URL
   line — specifically the SampleSvc `POST http://host:port/path` case that the current
   regex fails on.
2. **The new evidence write** MUST make AMS `buildRuntimeUsageSummary` report
   `hasRuntimeEvidence = true` (i.e. `source='log'` `discovery_evidence` rows are
   written and counted) so the `insufficient_runtime_evidence` gap clears.
3. **Pre-scan / sampler determinism** — candidate detection and byte-offset-spread
   block selection (with dedup, truncation, head/middle/tail fallback on zero hits) are
   reproducible.
4. **Recipe validation + bounded retries + deterministic fallback** — recipe accepted
   at >=60% held-out yield; re-sampled up to 2 retries (max 3 LLM calls/file); falls
   back to the flexible deterministic matcher when no valid recipe is produced.
5. **Redaction of samples** — every sample block is scrubbed by
   `snippetRedaction.redactFullBody` before leaving the process (no secrets reach the
   LLM).
6. **~0-despite-hits diagnostic path** — when pre-scan finds hits but extraction yields
   ~nothing, the run does NOT fail; a structured `extractionOutcome` diagnostic is
   recorded in `steps_payload.v3.runtimeEvidence` AND a low-severity `runtime_log`
   finding is emitted.
