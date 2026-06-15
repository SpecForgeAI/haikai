# Task Breakdown: V3 Layered Prompt System

## Overview
Total Tasks: 8 task groups

This spec wires the V3 discovery pipeline's LLM gap-fill stage end-to-end: layered markdown prompt files + composer/injection/dedup utilities in discovery-service, a stateless relay endpoint at the gateway, and a new `llmGapFillStep` replacing the current Stage 3 stub in `runDiscoveryV3`. Pure TypeScript work — no Java / Liquibase changes.

**Parallelization notes:**
- Task Groups 1 (layer content), 2 (composer utilities), and 3 (gateway endpoint + client) are largely independent once the contracts are agreed and can be worked in parallel.
- Task Group 4 (gap-fill stage) depends on 1, 2, and 3.
- Task Group 5 (wiring) depends on 4.
- Task Group 6 (persistence) depends on 5.
- Task Group 7 (integration/acceptance) depends on 1-6.
- Task Group 8 (docs) depends on all prior groups landing.

## Task List

### Prompt Content Layer

#### Task Group 1: Prompt Layer Markdown Files
**Dependencies:** None
**Service:** discovery-service

- [x] 1.0 Author all prompt layer markdown files under `discovery-service/src/services/prompts/`
  - [x] 1.1 Write 2-8 focused tests for layer file presence and shape
    - Limit to 2-8 highly focused tests maximum
    - Test that each required layer file exists and is non-empty
    - Test that `base.md` contains the JSON schema contract and the "do not restate pack output" rule
    - Test that `frameworks/spring-classic.md` enumerates adapter catches vs misses (XML bean config, HBM XML, AOP, RestTemplate/FeignClient)
    - Skip exhaustive prose/wording validation
  - [x] 1.2 Author `base.md` (~300 tokens)
    - Role statement for the LLM
    - JSON output schema block (required: `type`, `name`, `filePath`, `confidence`; optional: `description`)
    - Confidence scale (0.0-1.0) guidance
    - Hard rule against restating pack-output content
  - [x] 1.3 Author `generic-language.md`
    - Tier C fallback language-agnostic guidance
    - Extraction nuance guidance when language is unrecognized
  - [x] 1.4 Author `languages/java.md`
    - Java idioms (annotations, package structure, interface patterns)
    - Extraction nuances (Javadoc business hints, inner classes, static factories)
  - [x] 1.5 Author `languages/typescript.md`
    - TypeScript idioms (decorators, type-only exports, re-exports)
    - Extraction nuances (JSDoc business hints, module boundary cues)
  - [x] 1.6 Author `frameworks/spring-classic.md`
    - What the adapter catches (controllers, services, repositories, autowired beans via class-level annotations)
    - What it misses: XML bean config, Hibernate HBM XML, AOP cross-cuts, inter-service RestTemplate/FeignClient calls
    - Instruction to surface only misses, never duplicates
  - [x] 1.7 Author `frameworks/_no-framework-with-ir.md`
    - Tier B instruction variant: use the injected IR (classes + methods + imports) to infer roles
    - Emphasize that no framework pack output is available
  - [x] 1.8 Author `frameworks/_no-ir.md`
    - Tier C instruction variant: no structural info available, infer from raw source only
    - Lowered confidence expectations
  - [x] 1.9 Ensure layer content tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Verify all seven required files exist and meet shape assertions
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- All seven required markdown files exist under `discovery-service/src/services/prompts/`
- `base.md` is ~300 tokens and contains the JSON schema + anti-restate rule
- `spring-classic.md` enumerates both catches and misses
- Tier B and Tier C fallback layers present and distinct

---

### Composer Utilities Layer

#### Task Group 2: Prompt Composer, Injection, and Dedup Utilities
**Dependencies:** None (contracts can be built against stub layer files; real content from Group 1 plugs in)
**Service:** discovery-service

- [x] 2.0 Build composer + injection + dedup utilities under `discovery-service/src/services/prompts/`
  - [x] 2.1 Write 2-8 focused tests for composer/injection/dedup behavior
    - Limit to 2-8 highly focused tests maximum
    - Test `composePrompt` for one representative Tier A, one Tier B, one Tier C composition (verify correct layer markers appear)
    - Test `normalizeName` covers the key edge cases (case, whitespace, underscores, hyphens collapse to single space)
    - Test `dedupKey` produces identical keys for `PatientController` vs `patient_controller` vs `Patient Controller`
    - Test injection renders pack-output as fenced ` ```json ` array and IR as compact JSON
    - Test empty pack-output renders `[]` (not omitted) and missing IR renders `{}` (not omitted)
    - Skip exhaustive permutation coverage
  - [x] 2.2 Implement `services/prompts/injection.ts`
    - Export single renderer for both pack-output and IR
    - Pack-output: compact JSON array fenced in ` ```json ` with `type`, `name`, `filePath`, optional `hint`
    - IR: compact per-file JSON summary (classes + methods + imports only; no full AST)
    - Empty pack-output / missing IR render as `[]` / `{}` respectively — never omitted
  - [x] 2.3 Implement `services/prompts/dedup.ts`
    - Export `normalizeName(name)`: trim + lowercase + collapse internal whitespace/underscores/hyphens to single space
    - Export `dedupKey(candidate)`: returns `(type exact, normalizeName(name), forward-slash-normalized relative filePath)`
    - Export dedup function that drops LLM candidates matching any pack candidate's key
    - Emit log line per dropped duplicate
    - Return dropped count for stage-payload surfacing
  - [x] 2.4 Implement `services/prompts/composer.ts`
    - Export `composePrompt({ tier, language, frameworkPackId, packOutput, ir, sourceFile })`
    - Tier A: base + language + `frameworks/<frameworkPackId>.md` + pack-output injection + IR injection + source file
    - Tier B: base + language + `frameworks/_no-framework-with-ir.md` + IR injection + source file
    - Tier C: base + `generic-language.md` (or specific language layer if recognized) + `frameworks/_no-ir.md` + source file
    - Compute 8-char truncated SHA-256 hashes per layer (`base`, `language`, `framework`)
    - Compute `composed` hash over the full assembled template excluding per-file data
    - Return `{ prompt: string, promptVersion: { base, language, framework, composed } }`
    - Use Node built-in `crypto` module — no new dependency
  - [x] 2.5 Ensure composer/injection/dedup tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Verify Tier A/B/C composition, normalization edge cases, and injection shapes
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- `composePrompt` returns correct layer assembly for each tier
- `normalizeName` handles whitespace/case/hyphen/underscore collapse correctly
- Injection renders pack-output and IR in the documented JSON shapes
- Layer hashes are 8-char SHA-256 truncations using Node's built-in `crypto`

---

### Gateway Layer

#### Task Group 3: Gateway Endpoint + Discovery-Service Client Method
**Dependencies:** None (contract is simple — request carries a fully-assembled prompt string)
**Service:** gateway + discovery-service

- [x] 3.0 Add the stateless relay endpoint at the gateway and the matching client method in discovery-service
  - [x] 3.1 Write 2-8 focused tests for the new route and client
    - Limit to 2-8 highly focused tests maximum
    - Test that `POST /discovery/v3/gap-fill` relays a caller-supplied prompt to the LLM client and returns the response body
    - Test that the new route does NOT load `gateway/src/config/prompts/discovery.file-analysis.prompt.md`
    - Test `gatewayClient.gapFill` success path (posts to the new route, returns parsed response)
    - Test `gatewayClient.gapFill` error path (network failure surfaces as a typed error ready for stage failure capture)
    - Skip exhaustive status-code/header coverage
  - [x] 3.2 Implement gateway route `POST /discovery/v3/gap-fill`
    - New file (mirroring `gateway/src/routes/discoveryFileAnalysis.ts` pattern)
    - Accepts the fully-assembled prompt from discovery-service in the request body
    - Forwards to the existing LLM client using the same invocation pattern as `discoveryFileAnalysis.ts`
    - Returns the LLM response body unmodified
    - Does NOT load or reference `gateway/src/config/prompts/discovery.file-analysis.prompt.md`
  - [x] 3.3 Register the new route in the gateway router wiring
    - Confirm existing `/api/v1/discovery/analyze-files` route remains untouched
    - Confirm the existing V2 prompt file remains in-tree, untouched
  - [x] 3.4 Implement `gatewayClient.gapFill` in `discovery-service/src/services/gatewayClient.ts`
    - New method mirroring the existing `analyzeFiles` shape (fetch, error handling, timeout config)
    - POSTs the assembled prompt to `/discovery/v3/gap-fill`
    - Returns parsed LLM response ready for JSON-schema validation in the stage
  - [x] 3.5 Ensure gateway + client tests pass
    - Run ONLY the 2-8 tests written in 3.1
    - Verify the route relays prompts without loading V2 prompt file
    - Verify `gatewayClient.gapFill` happy path and error path
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- New gateway route exists, relays the prompt, and never loads the V2 prompt file
- Existing `/api/v1/discovery/analyze-files` route and V2 prompt file untouched
- `gatewayClient.gapFill` mirrors `analyzeFiles` shape and error handling

---

### Gap-Fill Stage Layer

#### Task Group 4: LLM Gap-Fill Step Implementation
**Dependencies:** Task Groups 1, 2, 3
**Service:** discovery-service

- [x] 4.0 Implement `services/llmGapFillStep.ts` with skip heuristic, concurrency, and failure handling
  - [x] 4.1 Write 2-8 focused tests for the gap-fill stage
    - Limit to 2-8 highly focused tests maximum
    - Test happy path: per-file compose -> gateway call -> parse -> dedup -> emit candidates (mock `gatewayClient`)
    - Test skip heuristic: pack produced >=N candidates AND zero signals -> LLM call skipped
    - Test skip heuristic: any single signal (e.g. RestTemplate import) forces LLM call even when pack produced >=N
    - Test tier-based `_addedBy` tagging (Tier A -> `llm-gap-fill`, Tier B -> `llm-ir-guided`, Tier C -> `llm-solo`)
    - Test per-file failure: non-JSON response recorded on `failures[]`, zero candidates emitted for that file, run continues
    - Test stage-failed threshold: failure rate over `GAP_FILL_MAX_FAILURE_RATE` marks stage failed
    - Test unclassifiable files (parseCoretech empty) routed through Tier C (NOT skipped)
    - Skip exhaustive signal-matrix permutation coverage (cover representative signals only)
  - [x] 4.2 Implement stage entry point `llmGapFillStep.ts`
    - Signature accepts pack output, IR, source files, and tier per file from the calling pipeline
    - Reuse `DiscoveryCandidate` type from `discovery-service/src/types/candidate.ts` — do not redefine
  - [x] 4.3 Implement skip heuristic
    - Threshold from `GAP_FILL_SKIP_THRESHOLD` (default 3)
    - Signal list env-overridable via `GAP_FILL_SKIP_SIGNALS`
    - Signals: unparsed XML/YAML/properties blocks, >200 lines with <3 pack candidates, top-level comments/Javadoc business terms, imports outside framework pack's remit (JMS, Kafka, RestTemplate, etc.)
    - Skip only when pack produced >=N AND zero signals trip
    - Log skip decisions per file with the active signal set
  - [x] 4.4 Implement Tier C routing for unclassifiable files
    - Files where `parseCoretech` returns nothing usable are routed through Tier C (NOT skipped)
  - [x] 4.5 Implement concurrency control
    - Parallelize per-file LLM calls; concurrency limit default 5 from `GAP_FILL_CONCURRENCY`
  - [x] 4.6 Implement per-file LLM call orchestration
    - Compose prompt via `composePrompt`
    - Call `gatewayClient.gapFill`
    - Parse JSON response; validate against `DiscoveryCandidate` required fields (`type`, `name`, `filePath`, `confidence`)
    - Dedup surviving candidates against pack output via `dedup.ts`
    - Inject post-parse: `_addedBy` (tier-appropriate), `sourceClusterIds: []`, `discoveryRunId`
    - Optional LLM fields (e.g. `description`) pass through as emitted
  - [x] 4.7 Implement failure handling
    - Per-file failure (network, non-JSON, schema-invalid) -> push `{ filePath, error }` onto `steps_payload.gapFill.failures[]`
    - Emit zero candidates for that file; continue remaining files
    - Mark stage failed when failure rate exceeds `GAP_FILL_MAX_FAILURE_RATE` (default 0.2)
  - [x] 4.8 Surface stage-payload metrics
    - Expose dedup-dropped count for persistence (Task Group 6)
    - Expose failures array for persistence (Task Group 6)
  - [x] 4.9 Ensure gap-fill stage tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Verify skip heuristic, concurrency, tier tagging, and failure handling
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- Skip heuristic correctly honors threshold AND signal set
- Per-file failures recorded on `failures[]` without halting the run
- Tier-based `_addedBy` tagging correct for all three tiers
- Unclassifiable files route to Tier C, never skipped
- Concurrency defaults to 5, env-tunable via `GAP_FILL_CONCURRENCY`

---

### Pipeline Wiring Layer

#### Task Group 5: Wire `llmGapFillStep` into `runDiscoveryV3`
**Dependencies:** Task Group 4
**Service:** discovery-service

- [x] 5.0 Replace the Stage 3 stub in `discoveryV3Pipeline.ts` with a real `llmGapFillStep` call
  - [x] 5.1 Write 2-8 focused tests for pipeline integration
    - Limit to 2-8 highly focused tests maximum
    - Test that `runDiscoveryV3` invokes `llmGapFillStep` after the pack stage
    - Test that surviving LLM candidates are merged with pack candidates in final output
    - Test that pack candidates remain untouched by the gap-fill stage
    - Test that `steps_payload.gapFill` is populated with stage results (failures, dedupDroppedCount)
    - Skip end-to-end LLM-call coverage (those live in Task Group 7)
  - [x] 5.2 Remove/replace the Stage 3 stub marker in `discoveryV3Pipeline.ts`
    - Identify and remove the current stub comment/code
    - Invoke `llmGapFillStep` with pack output, IR, source files, and per-file tier assignments
  - [x] 5.3 Merge LLM candidates with pack candidates in pipeline output
    - Preserve pack-adapter candidates as-is
    - Append surviving (post-dedup) LLM candidates
  - [x] 5.4 Propagate stage payload metrics to the run record
    - `steps_payload.gapFill.failures[]`, dedup-dropped count, and promptVersion (Task Group 6 persists the promptVersion specifically)
  - [x] 5.5 Ensure pipeline integration tests pass
    - Run ONLY the 2-8 tests written in 5.1
    - Verify stub is replaced and stage results flow to pipeline output
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- Stage 3 stub removed; `llmGapFillStep` invoked in its place
- Pack + LLM candidates merged correctly in pipeline output
- `steps_payload.gapFill` populated with stage outputs

---

### Persistence Layer

#### Task Group 6: Prompt Version + Stage Payload Persistence
**Dependencies:** Task Group 5
**Service:** discovery-service

- [x] 6.0 Persist prompt version and stage-payload fields via `updateDiscoveryRun`
  - [x] 6.1 Write 2-8 focused tests for persistence
    - Limit to 2-8 highly focused tests maximum
    - Test that a completed run records `steps_payload.gapFill.promptVersion` with all four 8-char hashes (`base`, `language`, `framework`, `composed`)
    - Test that `steps_payload.gapFill.failures[]` persists per-file failure records
    - Test that dedup-dropped count persists on the stage payload
    - Skip exhaustive shape validation
  - [x] 6.2 Capture `promptVersion` from the composer output
    - Use the `promptVersion` object returned by `composePrompt` for the representative file (or aggregate as specified)
    - Persist under `steps_payload.gapFill.promptVersion`
  - [x] 6.3 Persist `steps_payload.gapFill.failures[]` and dedup-dropped count
    - Wire stage-output metrics from Task 4.8 into `updateDiscoveryRun`
  - [x] 6.4 Ensure persistence tests pass
    - Run ONLY the 2-8 tests written in 6.1
    - Verify promptVersion, failures, and dedup-dropped count all land on the run record
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass
- `steps_payload.gapFill.promptVersion` records `{ base, language, framework, composed }` as 8-char SHA-256 hashes
- `steps_payload.gapFill.failures[]` records per-file failures
- Dedup-dropped count surfaced on the stage payload

---

### Integration + Acceptance Layer

#### Task Group 7: Tier Composition Smoke Tests + OpenMRS Acceptance
**Dependencies:** Task Groups 1-6
**Service:** discovery-service

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 2-8 tests written per group (Tasks 1.1, 2.1, 3.1, 4.1, 5.1, 6.1)
    - Total existing tests: approximately 12-48 tests
  - [x] 7.2 Analyze test coverage gaps for THIS feature only
    - Identify end-to-end workflows that lack coverage
    - Focus ONLY on gaps related to this spec's requirements
    - Do NOT assess entire application test coverage
    - Prioritize tier-composition smoke tests and the OpenMRS acceptance check (per spec "Done when")
  - [x] 7.3 Write up to 10 additional strategic tests maximum
    - Added 8 strategic tests in `discovery-service/src/__tests__/v3LayeredPromptsAcceptance.test.ts`:
      1. Tier A composition smoke test — real layer markers (base + java + spring-classic + pack-output JSON + IR JSON + source)
      2. Tier B composition smoke test — base + java + `_no-framework-with-ir` + IR JSON + source (no pack-output)
      3. Tier C composition smoke test — base + generic-language fallback + `_no-ir` + source (no IR, no pack-output)
      4. Recorded-fixture Tier A run — `runLlmGapFill` path with mocked `gatewayClient.gapFill`, `llm-gap-fill` tag
      5. Recorded-fixture Tier B run — `llm-ir-guided` tag, Tier B prompt shape
      6. Recorded-fixture Tier C run — `llm-solo` tag, Tier C prompt shape
      7. Recorded-fixture failure case — malformed JSON on one file, recorded in `failures[]`, dedup unaffected, run continues
      8. OpenMRS acceptance (offline fixture-based, no live LLM): full `runDiscoveryV3` run with fake Java/Spring packs + mocked gateway returning ~61 realistic LLM candidates; asserts adapter + `llm-gap-fill` candidates coexist, `steps_payload.v3.gapFill.promptVersion` has four 8-char hashes, dedup rate <2%
    - Skipped exhaustive edge-case / performance / accessibility coverage
  - [x] 7.4 Run feature-specific tests only
    - Ran ONLY tests related to this spec's feature (promptLayerFiles, promptsUtilities, gatewayClientGapFill, llmGapFillStep, v3PipelineGapFillIntegration, v3PipelineGapFillPersistence, v3LayeredPromptsAcceptance on discovery-service + discoveryGapFill on gateway)
    - Total: 44 feature-specific tests passing (40 discovery-service + 4 gateway)
    - Tier-composition smoke tests and OpenMRS acceptance all pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 22-58 tests total)
- Tier A/B/C composition smoke tests verify correct layer markers per tier
- OpenMRS acceptance test confirms adapter + llm-gap-fill candidates coexist
- OpenMRS dedup rate <2% for LLM candidates overlapping adapter candidates
- `promptVersion` recorded with all four 8-char hashes
- No more than 10 additional tests added when filling in testing gaps
- No live LLM calls in CI

---

### Documentation Layer

#### Task Group 8: Update `DISCOVERY_SERVICE_EXPLAINER.md`
**Dependencies:** Task Groups 1-7
**Service:** discovery-service (docs)

- [x] 8.0 Update the V3 section of `DISCOVERY_SERVICE_EXPLAINER.md`
  - [x] 8.1 Replace the Stage 3 stub description
    - Remove the "stub / placeholder" language from the V3 section
    - Describe the real gap-fill stage: composer-driven layered prompts, per-file tier routing, skip heuristic, concurrency, failure handling, dedup, and persistence of `promptVersion`
  - [x] 8.2 Document the new gateway endpoint
    - Describe `POST /discovery/v3/gap-fill` as a stateless relay
    - Note that `/api/v1/discovery/analyze-files` and the V2 prompt file remain as untouched reference
  - [x] 8.3 Document the env-variable knobs
    - `GAP_FILL_CONCURRENCY` (default 5)
    - `GAP_FILL_SKIP_THRESHOLD` (default 3)
    - `GAP_FILL_SKIP_SIGNALS` (signal list override)
    - `GAP_FILL_MAX_FAILURE_RATE` (default 0.2)
    - Note `DISCOVERY_FILE_LINE_LIMIT` is unchanged
  - [x] 8.4 Document the `steps_payload.gapFill` shape
    - `promptVersion: { base, language, framework, composed }` (8-char hashes)
    - `failures[]` shape
    - Dedup-dropped count

**Acceptance Criteria:**
- `DISCOVERY_SERVICE_EXPLAINER.md` V3 section describes the real gap-fill stage (no stub wording remains)
- New gateway endpoint, env variables, and `steps_payload.gapFill` shape documented
- Existing V2 route + prompt file explicitly called out as retained references

---

## Execution Order

Recommended implementation sequence (Groups 1, 2, 3 can run in parallel):

1. **Parallel phase:**
   - Task Group 1: Prompt Layer Markdown Files
   - Task Group 2: Composer / Injection / Dedup Utilities
   - Task Group 3: Gateway Endpoint + Client Method
2. Task Group 4: LLM Gap-Fill Step Implementation
3. Task Group 5: Wire into `runDiscoveryV3`
4. Task Group 6: Prompt Version + Stage Payload Persistence
5. Task Group 7: Tier Composition Smoke Tests + OpenMRS Acceptance
6. Task Group 8: Documentation Update
