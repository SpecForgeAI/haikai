# Specification: Runtime Log Evidence — Format-Agnostic Extraction

## Goal
Extract HTTP request observations (plus response/headers/body where the log contains them) from uploaded runtime logs of arbitrary format and persist them as countable `source='log'` evidence, so the `insufficient_runtime_evidence` migration-readiness gap clears automatically. An LLM recognises the format once on a small redacted sample; deterministic code applies the inferred recipe to the whole file.

## User Stories
- As a migration planner, I want a rich runtime log I uploaded to a discovery run to actually count as runtime evidence, so that the "Create Migration Delivery Plan" wizard stops reporting "Insufficient runtime evidence".
- As a platform engineer, I want bespoke/absolute-URL log formats (e.g. SampleSvc `POST http://host:port/path`) to be parsed without me writing a custom parser, so that non-standard traces still produce endpoint usage.

## Specific Requirements

**Ingest precondition (dead-branch fix)**
- The runtime log uploaded to a discovery run MUST be consumed by Stage 2.5; today it is stranded on disk + `config_snapshot.inputArtifacts.logFiles[]` metadata only.
- Stage 2.5 already auto-runs in every V3 scan and already reads `config_snapshot.inputArtifacts.logFiles[]`; the work is making it extract AND persist, not adding a new trigger.
- Modify `runtimeEvidence/runDiscoveryRuntimeEvidence.ts` (reads logFiles, broken regex) and `runtimeEvidence/runtimeEvidencePersistence.ts` (writes no evidence today).
- No separate manual trigger in v1; the existing stranded manual route `routes/logEnrichment.ts` is unchanged.

**Pre-scan + sampling (cheap, streaming, no LLM)**
- Stream the WHOLE file; detect candidate request lines by: an HTTP verb, OR `http(s)://`, OR a `/seg/seg` path token.
- Build 8-12 sample BLOCKS, each = a hit line plus ~10 lines before and ~30 lines after (~40 lines, enough to span one request->response cycle).
- Spread blocks across the file by BYTE OFFSET (not "first N lines" — startup banners live at the top); dedup near-identical blocks so one hammered endpoint does not consume the budget.
- Truncate over-long individual lines (~2k chars/line); cap the assembled sample to ~12k chars total.
- On ZERO pre-scan hits, fall back to offset-stratified head/middle/tail windows so the LLM still gets representative data.
- Pre-scan and block selection MUST be deterministic/reproducible.

**Sample redaction (mandatory before LLM)**
- Every sample block MUST be scrubbed by `snippetRedaction.redactFullBody` (existing secret-scrub defaults) before it leaves the process.
- Reuse the existing redactor as-is; add nothing extra.
- This is an invariant: no un-redacted log content reaches the gateway/LLM.

**Known-format fast path (richness-gated)**
- Try existing structured parsers (CLF/combined via `accessLogParser.ts`, JSON-lines, framework detection).
- Use deterministic structured extraction for the whole file ONLY IF it yields the rich field set the log supports: method, path, request headers, request body, response status + body.
- If the result is THIN (e.g. only method+path when the log clearly carries more), do NOT settle — proceed to the LLM step.
- A plain CLF log has no bodies/responses, fails the richness gate, and falls to the LLM (which also cannot invent missing fields) — acceptable, one extra call, no harm.

**LLM recipe induction**
- Send the redacted sample blocks via `gatewayClient.gapFill` through a NEW dedicated sibling gateway endpoint (e.g. `/discovery/v3/log-recipe`); model is selected gateway-side (latest Claude per gateway config).
- NO Anthropic SDK is added to discovery-service; model selection stays gateway-side.
- The LLM returns a STRUCTURED RECIPE (record delimiter + field rules for method/path/headers/body/response) OR "no pattern".
- Bounded cost: induction + up to 2 re-samples = max 3 LLM calls per file.

**Recipe validation + bounded retries**
- Validate a returned recipe by applying it to a HELD-OUT block the LLM did NOT see.
- Accept the recipe if it extracts method+path from >=60% of request-like lines in that held-out block.
- On weak yield, re-sample with different/more blocks and retry (up to 2 retries, max 3 LLM calls total).
- If no valid recipe is produced, fall through to the deterministic fallback matcher.

**Deterministic full-file extraction**
- The LLM ONLY ever sees small redacted samples; the WHOLE file is ALWAYS processed by deterministic code (critical invariant).
- Validated recipe path: a NEW recipe-aware deterministic extractor applies the recipe across the FULL file, pulling EVERY field the log contains (method, path, headers, body, response status+body) — response ONLY if logged, never invented.
- Fallback path (no recipe / failed validation): a single FLEXIBLE deterministic matcher broadened to accept `METHOD <absolute-URL>` as well as `METHOD /path`, extracting method+path; this always at least clears the gap.
- The broadened matcher replaces/augments the current `HTTP_METHOD_PATH_REGEX` in `runDiscoveryRuntimeEvidence.ts`, which today requires a `/`-leading path immediately after the method and extracts ZERO observations from absolute-URL lines.

**Persist + wire (countable evidence)**
- v1 MUST guarantee writing `source='log'` `discovery_evidence` rows — that alone clears the gap.
- Reuse the Increment-14 evidence-atom + `bulkSaveEvidence` persistence path (it already writes `source='log'` evidence), driven by the NEW recipe-aware extractor; do NOT extend the old regex-only `endpointUsageExtractor` for richness.
- ALSO run the existing matcher (`endpointRuntimeMatcher` / `endpointRuntimeAggregator` / `endpointPathNormalizer`) to emit best-effort `runtime_usage` findings where extracted paths match discovered endpoint candidates — best-effort, NOT a hard requirement.
- Evidence/finding writes flow through `services/archModelClient.ts` to AMS `DiscoveryEvidenceEntity` and `DiscoveryFindingEntity`.

**Recipe persistence + reuse**
- Persist the inferred recipe on the run in `steps_payload.v3.runtimeEvidence.recipe` (NO schema change) for auditable, free reuse on re-runs / same-source files.
- Key reuse by a format-fingerprint hash, with a fallback per-source-file.
- Induce ONE recipe per file — do NOT assume a shared format across multiple files.

**Diagnostics on ~0 extraction despite hits**
- If pre-scan finds candidate lines but extraction yields ~nothing, NEVER fail the run.
- Record a structured diagnostic in `steps_payload.v3.runtimeEvidence` (e.g. `extractionOutcome`) AND emit a low-severity `runtime_log` finding for visibility.
- Introduce NO new gap type.

**Size, streaming, and cost caps**
- Keep existing caps: `LOG_PARSE_MAX_FILE_BYTES` = 100MB per-file (skip-with-warning); 2GB bundle.
- Files are streamed (the 27MB target case is processed deterministically end-to-end).
- Cost bound: one small LLM call per file/format, max 3 calls per file; recipe cached/persisted for reuse.

## Visual Design
No visual assets were provided in `planning/visuals/`. Not applicable.

## Existing Code to Leverage

**`discovery-service/src/services/logExtractors/` + `bulkSaveEvidence`**
- Increment-14 path that already writes `source='log'` evidence atoms via `bulkSaveEvidence` (in `archModelClient.ts`).
- Reuse the evidence-atom shape + persistence; drive it from the NEW recipe-aware extractor for rich fields.
- Do NOT extend the old regex-only `endpointUsageExtractor.ts` for richness.

**`runtimeEvidence/runDiscoveryRuntimeEvidence.ts` + `runtimeEvidencePersistence.ts` (Stage 2.5)**
- `runDiscoveryRuntimeEvidence.ts` holds the broken `HTTP_METHOD_PATH_REGEX` (lines ~93-94) and the `config_snapshot.inputArtifacts.logFiles[]` reader — broaden the matcher here.
- `runtimeEvidencePersistence.ts` writes `steps_payload` + in-memory enrichment + (potentially) findings but NO `discovery_evidence` row — add the evidence write here.
- Called from `discoveryV3Pipeline.ts` Stage 2.5 (~lines 1140-1179); the auto-run wiring already exists.

**`endpointRuntimeMatcher` / `endpointRuntimeAggregator` / `endpointPathNormalizer`**
- Existing matching/normalisation/aggregation used to correlate observed paths to discovered endpoints.
- Reuse to emit best-effort `runtime_usage` findings where paths match candidates.

**`gatewayClient.gapFill` + `snippetRedaction.redactFullBody`**
- `gapFill` (gatewayClient.ts ~line 365, with a sibling pattern at ~line 449) is the LLM relay — route the induction call through the NEW `/discovery/v3/log-recipe` gateway endpoint.
- `redactFullBody` (utils/snippetRedaction.ts) provides the mandatory secret scrub for every sample block.

**AMS `DiscoveryEvidenceEntity` (+ repository), `DiscoveryFindingEntity`, `MigrationDiscoveryContextService.buildRuntimeUsageSummary`**
- `DiscoveryEvidenceEntity` carries the `source` field; its repository exposes `findByRunId`; `DiscoveryFindingEntity` carries `finding_type`/`category` — these are the persistence targets via `archModelClient`.
- `buildRuntimeUsageSummary` (~lines 944-960) is the CONSUMER: `hasRuntimeEvidence = (source='log' evidence count > 0) || (findings with category in {runtime_usage,runtime_log,log} count > 0)`, scoped to the latest 3 COMPLETED runs of the current architecture. It is NOT modified; the gap clears once `source='log'` evidence flows.

## Out of Scope
- Turning extracted response/request bodies into formal capture seed-data fixtures (fast-follow).
- Any change to the migration-plan wizard / gap registry UI (`MigrationDeliveryPlanWizard.tsx`, `gapWayfindingRegistry.ts`) — the gap clears upstream automatically.
- Any modification of AMS `MigrationDiscoveryContextService.buildRuntimeUsageSummary` (the consumer).
- Inventing responses (or any field) not present in the log.
- Real-time / streaming ingestion (this is batch, at discovery-run time).
- The "No sample data hints" bug (already fixed separately this session).
- Adding an Anthropic SDK to discovery-service (model selection stays gateway-side).
- A separate manual trigger for the runtime stage in v1.
- Any DB schema change (recipe and diagnostic live in `steps_payload`).
- Introducing a new gap type for the ~0-despite-hits diagnostic case.

## Load-Bearing Test Surfaces
- **Broadened deterministic matcher**: extracts method+path from an absolute-URL line — specifically the SampleSvc `POST http://host:port/path` case the current regex fails on.
- **Evidence write -> gap clears**: writing `source='log'` `discovery_evidence` rows makes AMS `buildRuntimeUsageSummary` report `hasRuntimeEvidence = true`, clearing `insufficient_runtime_evidence`.
- **Pre-scan / sampler determinism**: candidate detection and byte-offset-spread block selection (with dedup, per-line truncation, head/middle/tail fallback on zero hits) are reproducible.
- **Recipe validation + bounded retries + fallback**: recipe accepted at >=60% held-out yield; re-sampled up to 2 retries (max 3 LLM calls/file); falls back to the flexible deterministic matcher when no valid recipe is produced.
- **Sample redaction**: every sample block is scrubbed by `snippetRedaction.redactFullBody` before leaving the process (no secrets reach the LLM).
- **~0-despite-hits diagnostic path**: pre-scan hits but ~no extraction does NOT fail the run; a structured `extractionOutcome` is recorded in `steps_payload.v3.runtimeEvidence` AND a low-severity `runtime_log` finding is emitted.
