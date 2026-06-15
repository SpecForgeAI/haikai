Build the composable layered prompt system the V3 pipeline uses for its LLM gap-fill stage. Prompts compose from (base + language-section + framework-section + dynamic IR/pack-output injection) layers. This spec wires the LLM stage end-to-end for the reference pack; broad content coverage lands in Spec 4 when other packs migrate.

## Context

In V3, the LLM sees the pack's output on a per-file basis and is instructed to add semantic/business/runtime context without restating structural facts. The prompt is not a single template — it's composed from layers so base improvements apply everywhere, language improvements affect all packs in that language, and framework improvements are isolated per adapter.

Three tier variants determine which layers get assembled:
- **Tier A** (framework pack active): base + language + framework(3A-specific) + pack-output injection
- **Tier B** (language-only): base + language + framework(3B no-framework-with-IR) + IR injection
- **Tier C** (nothing matches): base + generic-language-layer + framework(3C no-IR)

## In scope

1. Prompt layer storage: `discovery-service/src/services/prompts/`
   - `base.md` — universal base layer (role, schema, confidence scale, gap-fill instructions)
   - `languages/<language>.md` — per-language idioms and extraction nuances (initial: Java, TypeScript)
   - `frameworks/<pack-id>.md` — per-framework blind-spot guidance (initial: spring-classic)
   - `frameworks/_no-framework-with-ir.md` — Tier B fallback
   - `frameworks/_no-ir.md` — Tier C fallback
   - `generic-language.md` — Tier C when language is unrecognized

2. Prompt composition system: `services/prompts/composer.ts`
   - `composePrompt({ tier, language, frameworkPackId, packOutput, ir, sourceFile })` → assembled prompt string.
   - Records which layer hashes were used so the run metadata can capture prompt version.

3. LLM gap-fill stage: `services/llmGapFillStep.ts`
   - Called by `runDiscoveryV3` (Spec 1) after pack stage.
   - Builds composed prompt per file, calls LLM, parses response into candidates.
   - New candidates tagged `_addedBy: 'llm-gap-fill'` (Tier A) / `'llm-ir-guided'` (Tier B) / `'llm-solo'` (Tier C).
   - Skips LLM call entirely on files where the pack produced ≥N candidates AND no "potential gap" signals (heuristic to be spec'd — start with N=3, override via env).

4. Output schema + parsing:
   - LLM output constrained to JSON schema matching `DiscoveryCandidate`.
   - Dedup against pack output on `(type, name, filePath)` — LLM duplicates dropped with a log line.

5. Initial content pass on the layers:
   - `base.md`: ~300 tokens, covers role and output format, hard rule against restating pack output.
   - `languages/java.md` and `typescript.md`: language-specific patterns the LLM must know about.
   - `frameworks/spring-classic.md`: what the adapter catches, what it misses (XML bean config, HBM XML, AOP cross-cuts, inter-service RestTemplate/FeignClient calls).
   - `_no-framework-with-ir.md` and `_no-ir.md`: Tier B/C instruction variants.

6. Prompt version record: each run persists `promptVersion: { base: <hash>, language: <hash>, framework: <hash> }` in its `steps_payload`.

## Out of scope

- Evaluation metrics (Spec 3).
- Framework layer content for packs beyond spring-classic (Spec 4).
- Tier computation UX surfacing (Spec 5) — internal tier logic is already in Spec 1.

## Key constraints

- LLM output format tightly constrained — non-JSON responses must fail the call rather than be silently ignored, so prompts must emphasize schema strictness.
- Prompt layers must be plain markdown under version control. No dynamic fetching from external services.
- Per-file LLM calls must stay idempotent — same inputs, same output (modulo LLM temperature).

## Done when

- Running V3 pipeline on OpenMRS produces both spring-classic-adapter and llm-gap-fill candidates.
- The llm-gap-fill candidates do not duplicate adapter candidates on (type, name, filePath) for >2% of emitted items (logged rate).
- Run metadata records prompt layer hashes.
- Smoke tests verify composition for all three tiers.

---

## Decisions from Shaping (2026-04-18)

The following decisions clarify or override the original raw idea above. Full rationale captured in `requirements.md`.

**Ownership / endpoint split:**
- Discovery-service composes the prompt in full; gateway is stateless relay.
- New gateway endpoint: `POST /discovery/v3/gap-fill`. Existing `/api/v1/discovery/analyze-files` and `gateway/src/config/prompts/discovery.file-analysis.prompt.md` retained untouched for reference.

**Injection format (uniform JSON, overrides original's silence on format):**
- Pack candidates injected as compact JSON array in a fenced `json` block: fields `type`, `name`, `filePath`, optional `hint`.
- IR injected as compact JSON summary per file (classes + methods + imports; no full AST).
- Single renderer in `services/prompts/injection.ts`. No per-pack rendering hooks.

**Skip-heuristic (concretizes raw idea's "heuristic to be spec'd"):**
- Default N=3, env-overridable via `GAP_FILL_SKIP_THRESHOLD`.
- Signal list env-overridable via `GAP_FILL_SKIP_SIGNALS`:
  - Unparsed XML/YAML/properties blocks in file
  - >200 lines with <3 pack candidates
  - Top-level comments/Javadoc mentioning business terms
  - Imports outside the framework pack's declared remit (JMS, Kafka, RestTemplate, etc.)
- Any single signal forces the LLM call.

**Concurrency:** Parallel per-file processing. Default 5, env-tunable via `GAP_FILL_CONCURRENCY`.

**Token budget:** `DISCOVERY_FILE_LINE_LIMIT` unchanged; accept reduced effective file-line budget.

**Dedup (overrides original's strict equality):**
- Normalized + aggressive. Key = `(type exact, normalize(name), forward-slash-normalized filePath)`.
- `normalize(name)` = trim + lowercase + collapse internal whitespace/underscores/hyphens.

**Prompt version record (refines original's three-hash shape):**
- 8-char truncated SHA-256 hashes.
- Shape: `{ base, language, framework, composed }` — adds a fourth `composed` hash covering the full assembled template excluding per-file data.
- Persisted at `steps_payload.gapFill.promptVersion`.

**Failure handling:**
- Per-file failure → record under `steps_payload.gapFill.failures[]`; zero candidates for that file; run continues.
- Stage failed if failure rate > `GAP_FILL_MAX_FAILURE_RATE` (default 0.2).

**Tier C handling of unclassifiable files:** Files where parseCoretech returns nothing usable are routed through Tier C anyway (no skipping). Tier C prompt handles the "no structural info" case.

**LLM output schema:**
- LLM emits: `type`, `name`, `filePath`, `confidence` (+ optional pass-through fields like `description`).
- Stage injects post-parse: `_addedBy` (tier-appropriate), `sourceClusterIds: []`, `discoveryRunId`.

**Testing:** Mocked `gatewayClient` for unit tests; recorded LLM fixtures for Tier A/B/C integration tests. No live LLM in CI.

**Out-of-scope confirmed additions:** retry-on-invalid-JSON, response caching, streaming, prompt editing UI, A/B comparison, cost metrics.
