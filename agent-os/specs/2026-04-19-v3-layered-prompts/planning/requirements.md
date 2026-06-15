# Spec Requirements: V3 Layered Prompt System

## Initial Description

Build the composable layered prompt system the V3 pipeline uses for its LLM gap-fill stage. Prompts compose from (base + language-section + framework-section + dynamic IR/pack-output injection) layers. This spec wires the LLM stage end-to-end for the reference pack; broad content coverage lands in Spec 4 when other packs migrate.

Three tier variants determine which layers get assembled:
- **Tier A** (framework pack active): base + language + framework(3A-specific) + pack-output injection
- **Tier B** (language-only): base + language + framework(3B no-framework-with-IR) + IR injection
- **Tier C** (nothing matches): base + generic-language-layer + framework(3C no-IR)

Full original raw idea retained in `raw-idea.md`.

## Requirements Discussion

### First Round Questions

**Q1 (Prompt composition ownership):** Where does prompt assembly happen — in the gateway (as today) or moved entirely to discovery-service?
**Answer:** Discovery-service composes and sends the fully-assembled prompt. Gateway just relays to the LLM. Gateway becomes stateless with respect to prompts.

**Q2 (Gateway endpoint strategy):** Reuse the existing `/api/v1/discovery/analyze-files` endpoint, or add a new dedicated endpoint for the V3 flow?
**Answer:** Add a NEW endpoint `POST /discovery/v3/gap-fill` at the gateway. Keep the existing `/api/v1/discovery/analyze-files` untouched for reference.

**Q3 (Existing V2 prompt file fate):** Delete or retain `gateway/src/config/prompts/discovery.file-analysis.prompt.md`?
**Answer:** Keep it in-tree (don't delete), but don't use it in the V3 flow. The new `/discovery/v3/gap-fill` route does not read it — it just relays whatever prompt the discovery-service sends.

**Q4 (Injection format):** How should pack candidates and IR be serialized into the prompt?
**Answer:** Uniform JSON blobs. Pack candidates injected as a compact JSON array fenced in a ```json``` block (fields: `type`, `name`, `filePath`, `hint` (optional 1-line summary)). IR injected as a compact JSON summary per file (classes + methods + imports; no full AST). No pack-specific rendering hooks. A single renderer in `services/prompts/injection.ts` serializes both.

**Q5 (Skip-heuristic signals):** Which "potential gap" signals should force an LLM call even when the pack produced ≥N candidates?
**Answer:** Signal set approved as proposed:
- Unparsed XML/YAML/properties blocks in file
- >200 lines with <3 pack candidates (low capture ratio)
- Top-level comments/Javadoc mentioning business terms
- Imports outside the framework pack's declared remit (JMS, Kafka, RestTemplate, etc.)

Default N=3. Signal list and N env-overridable (e.g. `GAP_FILL_SKIP_THRESHOLD`, `GAP_FILL_SKIP_SIGNALS`). Any one signal triggers LLM call even if the pack produced ≥N candidates.

**Q6 (Concurrency strategy):** Sequential vs parallel per-file LLM calls?
**Answer:** PARALLELIZE — process 5 files concurrently. Allowed because gap-fill is per-file (no cross-file analysis). Concurrency limit env-tunable via `GAP_FILL_CONCURRENCY`, default 5.

**Q7 (Token budget):** Keep the existing `DISCOVERY_FILE_LINE_LIMIT` or change it to accommodate larger layered prompts?
**Answer:** Keep `DISCOVERY_FILE_LINE_LIMIT` unchanged. Layered prompt context reduces effective file-line budget; accept that trade-off.

**Q8 (Dedup strictness):** Strict `(type, name, filePath)` equality, or normalized?
**Answer:** NORMALIZE NAMES + be AGGRESSIVE. `PatientController` and `Patient Controller` dedup together. Normalization: `type` exact; `name` trimmed + lowercased + internal whitespace/underscores/hyphens collapsed; `filePath` forward-slash normalized relative path. Implementation: a normalizer function; dedup key is `(type, normalize(name), filePath)`. LLM duplicates dropped with a log line.

**Q9 (Prompt version hash format):** Full hash, truncated hash, semver-style version, or another scheme?
**Answer:** SHA-256 content hashes, 8-char truncated, recorded on every run in `steps_payload.gapFill.promptVersion`. Object shape:
```
{
  base: "<8-char>",
  language: "<8-char>",
  framework: "<8-char>",
  composed: "<8-char>"  // hash of full assembled template excluding per-file data
}
```
~40 bytes per run — trivial storage cost, enables reproducibility across prompt iterations.

**Q10 (Failure mode):** What happens when a per-file LLM call fails?
**Answer:** Approved. Per-file LLM failure → record in `steps_payload.gapFill.failures[]`, zero candidates for that file, run continues with remaining files. Stage marked failed if >20% of files failed (threshold env-overridable via `GAP_FILL_MAX_FAILURE_RATE`, default 0.2).

**Q11 (Tier C routing for unclassifiable files):** Skip files with no structural info, or send them through Tier C anyway?
**Answer:** Send unclassifiable files (parseCoretech returns nothing usable) to the Tier C path anyway. No skipping. Tier C prompt handles the "I have no structural info" case.

**Q12 (LLM output schema strictness):** What fields must the LLM emit vs. what does the stage inject post-parse?
**Answer:** Approved. LLM must emit `type`, `name`, `filePath`, `confidence`. Stage post-parse injects `_addedBy` (tier-appropriate value), `sourceClusterIds` (empty array for LLM-only), `discoveryRunId`. Optional LLM fields (`description`, etc.) pass through as emitted.

**Q13 (Testing approach):** Mock the LLM or invoke it live?
**Answer:** Approved. Mock `gatewayClient` for unit tests covering composer output + dedup logic. Recorded LLM fixtures for integration tests covering Tier A/B/C. No live LLM in CI.

**Q14 (Initial content coverage):** Anything to add beyond the layers listed in the raw idea?
**Answer:** Complete as listed — no additions.

**Q15 (Out-of-scope confirmations):** Anything to add to the out-of-scope list?
**Answer:** Nothing to add beyond what's already called out. Retry-on-invalid-JSON, caching, streaming, prompt UI, A/B comparison, and cost metrics all remain out of scope.

### Existing Code to Reference

**Similar Features Identified:**
- **No existing prompt composition utilities in discovery-service** — net-new work under `discovery-service/src/services/prompts/`.
- **Node's `crypto` module** — used for SHA-256 hashing of layer content for `promptVersion`.
- **No existing candidate dedup helpers** — net-new in `services/prompts/dedup.ts` (or similar).
- **`DiscoveryCandidate` type** at `discovery-service/src/types/candidate.ts` — the schema contract the LLM must emit (plus post-parse stage-injected fields).
- **`gateway/src/routes/discoveryFileAnalysis.ts`** — existing route is the template for the new `/discovery/v3/gap-fill` route (same LLM-client invocation pattern, but relays an externally-composed prompt rather than building one itself).
- **`gatewayClient.analyzeFiles`** at `discovery-service/src/services/gatewayClient.ts` — template for a new `gatewayClient.gapFill` method that POSTs to `/discovery/v3/gap-fill`.

### Follow-up Questions

No follow-up round was required. All 15 questions resolved in the first pass.

## Visual Assets

### Files Provided:

No visual assets provided. The `planning/visuals/` directory is empty.

### Visual Insights:

N/A — spec relies on textual descriptions only.

## Requirements Summary

### Functional Requirements

**Prompt composition (discovery-service owns it):**
- Implement `services/prompts/composer.ts` with `composePrompt({ tier, language, frameworkPackId, packOutput, ir, sourceFile })` returning the fully-assembled prompt string plus the layer-hash record.
- Implement `services/prompts/injection.ts` as the single renderer that serializes pack candidates (as a fenced `json` array of `{type, name, filePath, hint?}`) and IR (compact per-file JSON summary: classes + methods + imports, no full AST).
- Implement `services/prompts/dedup.ts` providing the normalizer and dedup key builder for `(type, normalize(name), filePath)`.
- Store prompt layers as markdown under `discovery-service/src/services/prompts/`:
  - `base.md`, `generic-language.md`
  - `languages/java.md`, `languages/typescript.md`
  - `frameworks/spring-classic.md`, `frameworks/_no-framework-with-ir.md`, `frameworks/_no-ir.md`

**Tier routing:**
- Tier A (framework pack active): base + language + framework(3A-specific) + pack-output injection.
- Tier B (language-only): base + language + `_no-framework-with-ir.md` + IR injection.
- Tier C (nothing matches OR parseCoretech returned nothing usable): base + `generic-language.md` + `_no-ir.md`. Unclassifiable files are NOT skipped — they are routed to Tier C.

**LLM gap-fill stage:**
- Implement `services/llmGapFillStep.ts`, called by `runDiscoveryV3` (Spec 1) after the pack stage.
- Per file: compose prompt, call `gatewayClient.gapFill`, parse JSON response, dedup against pack output.
- Skip the LLM call only when (a) pack produced ≥N (default N=3) candidates AND (b) none of the gap signals trip:
  - Unparsed XML/YAML/properties blocks in file.
  - >200 lines with <3 pack candidates (low capture ratio).
  - Top-level comments/Javadoc mentioning business terms.
  - Imports outside the framework pack's declared remit (JMS, Kafka, RestTemplate, etc.).
- Any single signal forces the LLM call regardless of candidate count.
- Process files with a concurrency limit (default 5, env-tunable).
- Tag new candidates:
  - Tier A → `_addedBy: 'llm-gap-fill'`
  - Tier B → `_addedBy: 'llm-ir-guided'`
  - Tier C → `_addedBy: 'llm-solo'`
- Inject `sourceClusterIds: []` and `discoveryRunId` post-parse. Optional LLM fields (`description`, etc.) pass through as emitted.

**Gateway endpoint:**
- Add `POST /discovery/v3/gap-fill` at the gateway. Route relays the composed prompt sent by discovery-service to the LLM and returns the response. No prompt composition at the gateway.
- Existing `POST /api/v1/discovery/analyze-files` route and existing `gateway/src/config/prompts/discovery.file-analysis.prompt.md` remain untouched as reference.

**Dedup:**
- Key = `(type exact, normalize(name), forward-slash-normalized filePath)`.
- `normalize(name)` = trim + lowercase + collapse internal whitespace/underscores/hyphens to a single space.
- Duplicates dropped with a log line; dropped count surfaced in stage payload.

**Failure handling:**
- Per-file failure → record under `steps_payload.gapFill.failures[]` with file path + error; zero candidates for that file; run continues.
- Stage marked failed if failure rate exceeds `GAP_FILL_MAX_FAILURE_RATE` (default 0.2).

**Prompt version recording:**
- Each run persists in `steps_payload.gapFill.promptVersion`:
  ```
  {
    base: "<8-char SHA-256>",
    language: "<8-char SHA-256>",
    framework: "<8-char SHA-256>",
    composed: "<8-char SHA-256>"  // full assembled template excluding per-file data
  }
  ```

**Initial content pass:**
- `base.md`: ~300 tokens, role + output format + hard rule against restating pack output.
- `languages/java.md`, `languages/typescript.md`: language-specific patterns the LLM must handle.
- `frameworks/spring-classic.md`: what the adapter catches and what it misses (XML bean config, HBM XML, AOP cross-cuts, inter-service RestTemplate/FeignClient calls).
- `_no-framework-with-ir.md` + `_no-ir.md`: Tier B/C instruction variants.

**Testing:**
- Unit tests mock `gatewayClient`; cover composer output (all three tiers), injection rendering, and dedup normalization.
- Integration tests use recorded LLM fixtures for Tier A/B/C. No live LLM in CI.
- Smoke tests verify composition for all three tiers.

### Reusability Opportunities

- Node built-in `crypto` module for SHA-256 hashing — no new dep required.
- `DiscoveryCandidate` type at `discovery-service/src/types/candidate.ts` is the schema contract — reuse, do not redefine.
- `gateway/src/routes/discoveryFileAnalysis.ts` is the pattern template for the new `/discovery/v3/gap-fill` route (same LLM-client invocation pattern, minus prompt assembly).
- `discovery-service/src/services/gatewayClient.ts` is the pattern template for the new `gatewayClient.gapFill` method.
- No existing prompt composition or dedup utilities to extend — these are net-new.

### Scope Boundaries

**In Scope:**
- Prompt layer storage under `discovery-service/src/services/prompts/` (base, languages/java, languages/typescript, frameworks/spring-classic, frameworks/_no-framework-with-ir, frameworks/_no-ir, generic-language).
- Prompt composition system (`composer.ts` + `injection.ts` + `dedup.ts`).
- LLM gap-fill stage (`llmGapFillStep.ts`) wired into `runDiscoveryV3`.
- JSON-constrained LLM output parsing into `DiscoveryCandidate` shape.
- Normalized dedup against pack output.
- Skip-heuristic with configurable signals.
- Parallel per-file processing (env-tunable concurrency, default 5).
- Per-file failure tolerance with env-tunable aggregate threshold.
- Prompt version recording (8-char SHA-256s) in run metadata.
- New gateway endpoint `POST /discovery/v3/gap-fill` (stateless relay).
- Unit + fixture-based integration tests; tier-composition smoke tests.
- Initial content for base, java, typescript, spring-classic, no-framework-with-ir, no-ir layers.

**Out of Scope:**
- Evaluation metrics (Spec 3).
- Framework layer content for packs beyond spring-classic (Spec 4).
- Tier computation UX surfacing (Spec 5) — internal tier logic already in Spec 1.
- Retry-on-invalid-JSON, response caching, streaming, prompt editing UI, A/B comparison harness, cost metrics.
- Deleting or refactoring the V2 prompt file at `gateway/src/config/prompts/discovery.file-analysis.prompt.md` or the existing `/api/v1/discovery/analyze-files` route.

### Technical Considerations

**Environment variables (all env-overridable):**
- `GAP_FILL_CONCURRENCY` (default 5)
- `GAP_FILL_SKIP_THRESHOLD` (default 3; the N in "pack produced ≥N candidates")
- `GAP_FILL_SKIP_SIGNALS` (signal list override)
- `GAP_FILL_MAX_FAILURE_RATE` (default 0.2)
- `DISCOVERY_FILE_LINE_LIMIT` (unchanged; layered prompts reduce effective file-line budget — accepted trade-off)

**Integration points:**
- `runDiscoveryV3` (from Spec 1) invokes `llmGapFillStep` after the pack stage.
- `llmGapFillStep` → `composePrompt` + `gatewayClient.gapFill` → dedup → emit candidates.
- Gateway `POST /discovery/v3/gap-fill` relays to the LLM client; no local prompt composition.

**Constraints:**
- LLM output format tightly constrained — non-JSON responses must fail the call rather than be silently ignored; prompts must emphasize schema strictness.
- Prompt layers are plain markdown under version control; no dynamic fetching from external services.
- Per-file LLM calls must stay idempotent — same inputs, same output (modulo LLM temperature).

**Patterns to follow:**
- Gateway route structure mirrors `discoveryFileAnalysis.ts`.
- Discovery-service client wrapper mirrors `gatewayClient.analyzeFiles`.
- Candidate emission conforms to existing `DiscoveryCandidate` type; do not redefine.

**Done when:**
- Running V3 pipeline on OpenMRS produces both spring-classic-adapter and llm-gap-fill candidates.
- llm-gap-fill candidates do not duplicate adapter candidates on `(type, normalize(name), filePath)` for more than 2% of emitted items (logged rate).
- Run metadata records the four-hash `promptVersion` object.
- Smoke tests verify composition for all three tiers.
