# Specification: V3 Layered Prompt System

## Goal
Wire the V3 discovery pipeline's LLM gap-fill stage end-to-end by building a composable, layered prompt system (base + language + framework + dynamic injection) that discovery-service assembles and a new stateless gateway endpoint relays to the LLM.

## User Stories
- As a discovery pipeline author, I want per-layer prompt files under version control so that base, language, and framework improvements can evolve independently without forking whole prompts.
- As a platform operator, I want every run to record prompt version hashes so that I can reproduce or diff LLM behaviour across prompt iterations.
- As an OpenMRS analysis consumer, I want LLM gap-fill candidates alongside adapter candidates so that semantic/business/runtime context the pack misses gets surfaced without restating structural facts.

## Specific Requirements

**Prompt layer storage**
- Store markdown layer files under `discovery-service/src/services/prompts/`.
- Required files: `base.md`, `generic-language.md`, `languages/java.md`, `languages/typescript.md`, `frameworks/spring-classic.md`, `frameworks/_no-framework-with-ir.md`, `frameworks/_no-ir.md`.
- `base.md` (~300 tokens) covers role, JSON output schema, confidence scale, and a hard rule against restating pack output.
- Language layers cover idioms and extraction nuances per language.
- `frameworks/spring-classic.md` enumerates what the adapter catches vs misses (XML bean config, HBM XML, AOP cross-cuts, inter-service RestTemplate/FeignClient calls).
- `_no-framework-with-ir.md` and `_no-ir.md` carry Tier B and Tier C instruction variants respectively.
- Layers are plain markdown, no dynamic fetching.

**Prompt composer (`services/prompts/composer.ts`)**
- Export `composePrompt({ tier, language, frameworkPackId, packOutput, ir, sourceFile })` returning `{ prompt: string, promptVersion: { base, language, framework, composed } }`.
- Tier A: base + language + `frameworks/<frameworkPackId>.md` + pack-output JSON injection + IR JSON injection + source file.
- Tier B: base + language + `frameworks/_no-framework-with-ir.md` + IR JSON injection + source file.
- Tier C: base + `generic-language.md` (or specific language layer if recognized) + `frameworks/_no-ir.md` + source file.
- Compute 8-char truncated SHA-256 hashes per layer (`base`, `language`, `framework`) and one `composed` hash over the full assembled template excluding per-file data.
- Use Node's built-in `crypto` module for hashing.

**Injection renderer (`services/prompts/injection.ts`)**
- Single renderer for both pack-output and IR; no per-pack rendering hooks.
- Pack-output: compact JSON array fenced in a ` ```json ` block with fields `type`, `name`, `filePath`, optional `hint` (1-line summary).
- IR: compact per-file JSON summary (classes + methods + imports only; no full AST).
- Empty pack-output or missing IR rendered as `[]` / `{}` per shape, not omitted.

**Dedup helper (`services/prompts/dedup.ts`)**
- Export a `normalizeName(name)` function: trim + lowercase + collapse internal whitespace/underscores/hyphens to a single space.
- Export a `dedupKey(candidate)` returning `(type exact, normalizeName(name), forward-slash-normalized relative filePath)`.
- Export a dedup function that drops LLM candidates whose key matches any pack candidate; emit a log line per dropped duplicate; return the dropped count for stage-payload surfacing.

**LLM gap-fill stage (`services/llmGapFillStep.ts`)**
- Invoked by `runDiscoveryV3` replacing the Stage 3 stub; receives pack output, IR, source files, and tier per file.
- Per file: compose prompt, call `gatewayClient.gapFill`, parse JSON response, dedup against pack output, emit surviving candidates.
- Tag candidates by tier: Tier A `_addedBy: 'llm-gap-fill'`; Tier B `_addedBy: 'llm-ir-guided'`; Tier C `_addedBy: 'llm-solo'`.
- Inject post-parse: `_addedBy`, `sourceClusterIds: []`, `discoveryRunId`. Optional LLM fields (e.g. `description`) pass through as emitted.
- Files where `parseCoretech` returns nothing usable are routed through Tier C (NOT skipped).

**Skip heuristic**
- Default threshold N=3 via `GAP_FILL_SKIP_THRESHOLD`; skip LLM call only if pack produced ≥N candidates AND zero gap signals trip.
- Signals (any one triggers the LLM call, list env-overridable via `GAP_FILL_SKIP_SIGNALS`): unparsed XML/YAML/properties blocks; >200 lines with <3 pack candidates; top-level comments/Javadoc mentioning business terms; imports outside framework pack's declared remit (JMS, Kafka, RestTemplate, etc.).
- Skip decisions logged per file with the active signal set.

**Concurrency + failure handling**
- Parallelize per-file LLM calls, concurrency limit default 5 via `GAP_FILL_CONCURRENCY`.
- Per-file LLM failure (network error, non-JSON response, schema-invalid JSON) → push `{ filePath, error }` onto `steps_payload.gapFill.failures[]`, emit zero candidates for that file, continue remaining files.
- Mark stage failed when failure rate exceeds `GAP_FILL_MAX_FAILURE_RATE` (default 0.2).
- `DISCOVERY_FILE_LINE_LIMIT` unchanged — accept the reduced effective file-line budget that layered prompts create.

**Gateway endpoint `POST /discovery/v3/gap-fill`**
- New route, stateless relay: accepts the fully-assembled prompt from discovery-service, forwards to the LLM client, returns the LLM response body.
- Does NOT load or reference `gateway/src/config/prompts/discovery.file-analysis.prompt.md`.
- Existing `POST /api/v1/discovery/analyze-files` route and the V2 prompt file remain untouched.

**Discovery-service gateway client (`gatewayClient.gapFill`)**
- New method on `discovery-service/src/services/gatewayClient.ts` that POSTs to `/discovery/v3/gap-fill` with the assembled prompt.
- Mirrors the pattern of existing `analyzeFiles` method (shape, error handling, timeout config).
- Returns parsed LLM response ready for JSON-schema validation in the stage.

**Prompt version persistence**
- Each run writes `steps_payload.gapFill.promptVersion` as `{ base: "<8-char>", language: "<8-char>", framework: "<8-char>", composed: "<8-char>" }`.
- Also persist `steps_payload.gapFill.failures[]` and dedup-dropped count per run.

**Testing**
- Unit: mock `gatewayClient`; cover composer output for all three tiers, injection rendering (pack-output + IR JSON shapes), dedup normalization edge cases (whitespace/case/hyphens/underscores), skip-heuristic signal matrix.
- Integration: recorded LLM fixtures per tier (A/B/C) exercise the full stage path including failure handling.
- Smoke tests assert the assembled prompt contains the expected layer markers for each tier.
- No live LLM calls in CI.

## Existing Code to Leverage

**`discovery-service/src/types/candidate.ts` (`DiscoveryCandidate` type)**
- Schema contract the LLM must emit plus post-parse fields the stage injects.
- Reuse as-is; do not redefine in the gap-fill stage.

**`gateway/src/routes/discoveryFileAnalysis.ts`**
- Template for the new `POST /discovery/v3/gap-fill` route: same LLM-client invocation pattern, same response shape handling.
- New route omits the prompt-loading step — it relays the caller-supplied prompt directly.

**`discovery-service/src/services/gatewayClient.ts` (`analyzeFiles` method)**
- Pattern template for the new `gapFill` method: same fetch/error/timeout wiring.

**`discovery-service/src/services/discoveryV3Pipeline.ts` (`runDiscoveryV3`)**
- Host for the new `llmGapFillStep` invocation — replaces the current Stage 3 stub.

**Node built-in `crypto` module**
- Used for SHA-256 hashing of prompt layer contents; no new dependency required.

## Out of Scope
- Evaluation metrics (Spec 3).
- Framework layer content for packs beyond `spring-classic` (Spec 4).
- Tier computation UX surfacing (Spec 5); internal tier logic already lives in Spec 1.
- Retry-on-invalid-JSON behaviour for failed LLM responses.
- Response caching for per-file LLM calls.
- Streaming LLM responses.
- Prompt editing UI or in-app prompt authoring.
- A/B comparison harness across prompt versions.
- Cost / token-usage metrics capture.
- Deleting or refactoring the existing `gateway/src/config/prompts/discovery.file-analysis.prompt.md` file.
- Modifying the existing `POST /api/v1/discovery/analyze-files` route behaviour.
