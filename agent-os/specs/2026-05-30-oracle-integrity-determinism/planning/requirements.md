# Spec Requirements: Oracle Integrity & Determinism (run-level degraded signal + reproducible extraction)

## Initial Description

Spec **#3 of 6** in the HAIKAI Phase-2 "oracle perfection" program (a like-for-like API/DB migration tool; north-star reference: memory `project_migration_ultimate_goal`). Built **strictly sequentially after Spec #1 (response-contract scanner) and Spec #2 (capture-coverage seeding)**, so it EXTENDS their committed scanners + run/readiness DTO rather than racing them.

**Problem / goal.** This spec combines the program's **integrity** cluster and **non-determinism** cluster, holding two bars:

1. **A discovery run must not be SILENTLY incomplete.** Today a framework scanner can throw and silently delete that framework's endpoints from a run still marked `COMPLETED`; a partial/failed LLM gap-fill stage still completes; `filesFailed` is hardcoded `0`; and method/token caps (Spec 2) plus contract/runtime-pass failures leave no trace on the run record. There is no run-level signal that the captured model may be partial. We add an **advisory run-level "degraded/incomplete" signal** (never blocking) so downstream consumers (Spec #5 coverage, the runtime API harness) know the model may be incomplete.

2. **The oracle's own extraction must be reproducible.** The behaviour-capture stage hashes `source_hash`, but the gap-fill stage has **no prompt-hash response cache**, so re-runs differ even with `temperature: 0` (already wired by quick-win **W2**). We add a content-addressed LLM output cache keyed on `(normalized-prompt hash + model + temperature)`, modelled on the behaviour stage's hashing, so deterministic re-runs reuse the prior response.

Plus three correctness/visibility guards so nothing is silently lost or false-bound: below-gate candidate visibility, a false-merge guard on normalized-name matching, and non-pure-endpoint flagging.

The runtime API harness (`api-migration-validation-service`) remains the *equivalence verifier*; this spec makes discovery **honest about its own completeness and reproducible in its own extraction** — it does not prove behaviour.

**Pre-agreed constraints from raw-idea.md (FINAL — not open for re-litigation):**

1. **Advisory only, never blocking.** Every signal in this spec is a visible quality flag. A degraded run still `COMPLETED`s. No blocking gates anywhere — consistent with the program's no-block ethos.
2. **EXTEND the two carved quick-wins already on HEAD — do NOT redo them.**
   - **W2** — `temperature: 0` on the gap-fill / behaviour / decision LLM relays in `gateway/src/routes/discovery*.ts`. (Verified present.)
   - **W4** — a `scanner_failed` evidence-gap Finding emitted at soft-fail catch sites in `discoveryV3Pipeline.ts` + `packFindingScanners/index.ts`, with the `scanner_failed` sentinel in `discovery-service/src/services/findings/emissionSources.ts`. (Verified: `EvidenceGapType` union carries `'scanner_failed'` at line ~466, emitted at ~565.)
3. **Reuse, don't fork:** the `FindingEmitter` / `emissionSources.ts` machinery (+ W4's `scanner_failed`), the W2 temperature wiring, the behaviour stage's `source_hash` hashing for the new cache, the existing normalized-name identity primitive (guard it, do not replace it), and the existing run / readiness surfaces (no bespoke widget).
4. **AMS wire convention matched (VERIFIED).** A new run field, if persisted, follows the existing `DiscoveryRunDto` convention: explicit per-field `@JsonProperty("snake_case")` (belt-and-braces snake_case, no `@CamelCaseWire`).
5. **Spring / Spring Classic only.** No non-Spring protocols.
6. **No auto-remediation.** Signals are surfaced; nothing is auto-fixed.

## Requirements Discussion

> All decisions below are FINAL and user-pre-approved. This is an autonomous build; the questions are recorded for traceability, not to be re-asked.

### First Round Questions

**Q1 — How is the run-level "degraded" status represented, and does it block?**
**Answer:** An **advisory flag/status distinct from `COMPLETED`**, never a block. The run STILL `COMPLETED`s; "degraded" is a visible quality signal layered on top. Model it on the EXISTING advisory `warnings` field on the run (`DiscoveryRunDto.warnings` — JSON-encoded `string[]`, passed through verbatim, null when absent), which is the precedent for an advisory run-level signal. Represent it as a boolean-style `degraded` flag PLUS a structured `degraded_reasons` payload (the set of reasons it tripped). Do NOT introduce a new terminal run STATUS enum value that would break the `validateStatusTransition` state machine (`RUNNING -> [RUNNING, COMPLETED, FAILED]` in `runManager.ts`); degraded rides alongside `COMPLETED`, it does not replace it.

**Q2 — What conditions SET the degraded flag?**
**Answer:** Degraded is SET when ANY of:
- a `scanner_failed` Finding was emitted (W4 — a framework scanner threw at a soft-fail catch site);
- the gap-fill stage failed **OR any files failed** (wire the real count — see Q3);
- a **method / token CAP was hit** (Spec 2's `DEFAULT_METHOD_CAP` / `DEFAULT_TOKEN_CEILING` — capture was truncated);
- a **contract pass or runtime pass failed** (Spec 1's response-contract scanner / the harness pass).
Any one of these trips `degraded = true` and appends the corresponding reason to `degraded_reasons`. (These are advisory escalations — the W4 `scanner_failed` Finding and the cap-hit signal already exist; this spec ESCALATES them to the run-level degraded signal, it does not re-emit them.)

**Q3 — The `filesFailed` hardcode.**
**Answer:** **Wire the real count.** Today `filesFailed` is HARDCODED `0` in `discoveryV3Pipeline.ts` (verified at line 1344, inside the gap-fill stage-output construction). Replace the literal `0` with the actual per-file failure count surfaced by `runLlmGapFill` (`llmGapFillStep.ts`), and feed it into the degraded computation. A nonzero `filesFailed` is one of the Q2 degraded triggers.

**Q4 — The partial-gap-fill completion gap.**
**Answer:** Today `runLlmGapFill` only marks the stage `failed` ABOVE `GAP_FILL_MAX_FAILURE_RATE` (default `0.2`, verified `llmGapFillStep.ts:250`); below that rate, failed files silently produce zero candidates, AND even `stageStatus: 'failed'` does not fail the run (`runManager.ts` COMPLETED branch, lines ~1469-1479 and the resume path ~1710-1719, transitions to `COMPLETED` regardless). **Resolution: keep the existing rate threshold and keep the run COMPLETING (no new block), but treat `stageStatus: 'failed'` OR any nonzero `filesFailed` as a degraded trigger** so the partial outcome is visible on the run record. We do NOT change `GAP_FILL_MAX_FAILURE_RATE` semantics and we do NOT start failing the run.

**Q5 — LLM output caching for reproducibility.**
**Answer:** Add a **content-addressed cache keyed on `(normalized-prompt hash + model + temperature)`** for the **gap-fill relay**, EXTENDING the behaviour stage's existing hashing pattern (the behaviour stage hashes `source_hash` in `llmBehaviourCaptureStep.ts` — reuse that approach). On a cache hit, **reuse the prior response** (no LLM call). This gives deterministic re-runs (W2's `temperature: 0` makes the model deterministic; the cache makes the *pipeline* deterministic and saves cost). Keep the behaviour stage's own `source_hash` cache as-is; the new cache is the gap-fill analogue.

**Q6 — Below-gate candidate visibility.**
**Answer:** **Keep the 0.75 auto-accept gate** (`CANDIDATE_AUTO_ACCEPT_THRESHOLD`, verified `candidateSaveBackService.ts:72`) — do NOT auto-pollute the model with low-confidence guesses. BUT ensure below-gate candidates are **PERSISTED as reviewable candidates** with an explicit **"below auto-accept" review status** AND a **run-summary count** — nothing silently lost. The audit notes below-0.75 candidates are currently surfaced as `low_confidence` Findings but never reach the model, and that an entire Tier-C run sits below the gate (Tier-C `llm-solo` candidates score `0.4`, verified `llmGapFillStep.ts:730`). **First VERIFY whether the existing save-back path already persists below-gate candidates as reviewable candidates** (the code already references "below the auto-accept gate -> reviewable candidate" at several sites, e.g. `candidateSaveBackService.ts:176`, `:2380`, `:2815`); then **HARDEN so the reviewability + the run-summary count are guaranteed and visible** — do not duplicate an already-working path, close any gap where a below-gate candidate is dropped instead of persisted-for-review, and guarantee the count reaches the run summary.

**Q7 — False-merge guard on normalized-name matching.**
**Answer:** When a **NORMALIZED (non-exact) match drives a binding** in `candidateSaveBackService.ts` (relationship / enrich / link / request-response resolution), do **NOT** silently take the first match. The normalized matcher (`normalizeNameForMatch`, verified `candidateSaveBackService.ts:354`) folds case, strips separators, and blanket-singularizes (English-only) — so it can false-bind distinct entities (e.g. `Order` vs `Orders`) silently. **Resolution: only EXACT matches bind silently. A normalized (fuzzy) match must either (a) be recorded as a low-confidence / reviewable binding, OR (b) emit a `possible_entity_collision` Finding.** GUARD the existing identity primitive — do not replace it. Optionally tighten the naive singularization, but **the guard is the must-have**; the singularization tweak is best-effort.

**Q8 — Non-pure (non-deterministic) endpoint flagging.**
**Answer:** Add a **NEW deterministic scanner** that emits a **`non_deterministic_endpoint` evidence-gap Finding** for endpoints whose handler reaches `@Scheduled` / `@Cacheable` / `@Async` / `@Profile`-gated beans, session-scoped state, or clock / random — i.e. the endpoint is NOT a pure function of its inputs. This tells the harness the endpoint has legitimate variance and must not be treated as a behavioural diff. Add the `non_deterministic_endpoint` sentinel to `emissionSources.ts` (alongside W4's `scanner_failed`). Spring / Spring Classic only.

**Q9 — Where does "degraded" surface in the UI?**
**Answer:** On the **existing run / readiness surface** — no bespoke widget. Surface the `degraded` flag (with its `degraded_reasons`) and the **below-gate candidate count** on the run record and the readiness/run UI the same way existing run metadata (`warnings`, tier, status) is shown. Downstream specs (Spec #5 coverage) and the harness read it off the run/readiness DTO.

**Q10 — What is explicitly OUT of scope?**
**Answer:** Blocking gates of any kind; redoing W2 / W4 (extend them); auto-remediation; non-Spring protocols; any new terminal run-status enum value; a bespoke degraded-status UI widget; changing `GAP_FILL_MAX_FAILURE_RATE` semantics or starting to fail the run on partial gap-fill; replacing (vs guarding) the normalized-name identity primitive.

### Existing Code to Reference

**Confirmed reuse / extend targets (VERIFIED in repo — extend, do NOT fork):**

- **W2 temperature wiring (extend):** `gateway/src/routes/discovery*.ts` — `temperature: 0` on the gap-fill / behaviour / decision relays already on HEAD. The new gap-fill cache key includes this temperature; the relay stays the single LLM path (LLM via the gateway relay).
- **W4 `scanner_failed` Finding + sentinel (extend):** soft-fail catch sites in `discovery-service/src/services/discoveryV3Pipeline.ts` + `discovery-service/src/services/findings/packFindingScanners/index.ts`; sentinel `'scanner_failed'` in `discovery-service/src/services/findings/emissionSources.ts` (`EvidenceGapType` union ~L466, emitter ~L565). This spec ESCALATES the `scanner_failed` Finding to the run-level degraded signal.
- **Findings machinery (reuse for the two new sentinels):** `FindingEmitter` + `emissionSources.ts`. Add `non_deterministic_endpoint` and `possible_entity_collision` to the `EvidenceGapType` / finding-type sentinels here, next to `scanner_failed` and the existing `low_confidence_candidate` (verified `emissionSources.ts:50`). Frontend `FindingsTab` / `FindingDetailDrawer` render them with no new component.
- **Behaviour-stage hashing (reuse as the cache template):** `discovery-service/src/services/llmBehaviourCaptureStep.ts` — the `source_hash` content-hash pattern is the model for the new gap-fill `(normalized-prompt hash + model + temperature)` cache.
- **Gap-fill stage (wire `filesFailed`, surface failed count, add cache, emit cap-hit):** `discovery-service/src/services/llmGapFillStep.ts` (`runLlmGapFill`, `GAP_FILL_MAX_FAILURE_RATE` ~L250, Tier-C `llm-solo=0.4` ~L730) and `discovery-service/src/services/discoveryV3Pipeline.ts` (hardcoded `filesFailed: 0` at **L1344** — replace with the real count; this is also where degraded is computed).
- **Run lifecycle / status (compute + persist degraded):** `discovery-service/src/services/runManager.ts` — the COMPLETED branch (~L1469-1479) and resume path (~L1710-1719) with `validateStatusTransition` (`RUNNING -> [RUNNING, COMPLETED, FAILED]`). Degraded rides ALONGSIDE `COMPLETED`; it does not become a new terminal status.
- **Identity / matching primitive (GUARD, do not replace):** `mcp-server/src/services/candidateSaveBackService.ts` — `normalizeNameForMatch` (L354), the 0.75 gate `CANDIDATE_AUTO_ACCEPT_THRESHOLD` (L72), and the existing "below the auto-accept gate -> reviewable candidate" sites (L176, L2380, L2815). The false-merge guard and the below-gate hardening both live here. **This is the same shared identity primitive that Spec #1's resolver upgraded and that Spec #5 (`data_movements` producer) consumes — guard it in place, do not fork.**
- **AMS run record (add advisory `degraded` field if persisted there):** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryRunDto.java` (record; explicit `@JsonProperty("snake_case")` per field; existing advisory `warnings` field is the precedent), `.../model/entity/DiscoveryRunEntity.java`, `.../controller/DiscoveryRunController.java`, `.../service/DiscoveryRunService.java`. Closest changeset precedent: `085-discovery-run-warnings.sql`.
- **Readiness surface (read-only consumer):** `.../model/dto/migration/ReadinessAssessmentDto.java` and the existing frontend run/readiness UI — surface `degraded` + below-gate count here; no bespoke widget.
- **Spec #1 / Spec #2 committed artifacts (build ON TOP of, do not duplicate):** Spec #1's response-contract scanner and Spec #2's seeding + the method/token caps (`DEFAULT_METHOD_CAP` / `DEFAULT_TOKEN_CEILING`) and any run/readiness DTO field they add. This spec consumes a contract-pass-failed signal and a cap-hit signal from them as degraded triggers.

**Genuinely NEW work (no existing prior art):**

- The **run-level `degraded` flag + `degraded_reasons` aggregation** and its computation from the trigger set (Q2). No existing run field aggregates these signals.
- The **gap-fill LLM output cache** keyed on `(normalized-prompt hash + model + temperature)` — the gap-fill stage has none today (behaviour stage's `source_hash` cache is the template, not the same cache).
- The **`non_deterministic_endpoint` scanner** — a new deterministic Spring/Spring-Classic scanner; no scanner flags non-pure endpoints today.
- The **`possible_entity_collision` finding emission** at normalized-match binding sites (the false-merge guard) — the matcher exists but binds the first match silently today.

### Follow-up Questions

None — requirements gathering was completed prior to this document; all decisions are resolved and user-pre-approved. This is an autonomous build.

## Visual Assets

### Files Provided:

No visual assets provided. The `planning/visuals/` folder was created and is empty. (Confirmed: proceed without — the UI reuses the existing run/readiness surface and the Findings tab; no bespoke widget.)

### Visual Insights:

None applicable.

## Requirements Summary

### Functional Requirements

- **Run-level advisory "degraded/incomplete" signal.** Add a `degraded` flag (+ structured `degraded_reasons`) that rides ALONGSIDE `COMPLETED` (not a new terminal status). SET it when ANY of: a `scanner_failed` Finding was emitted (W4); the gap-fill stage failed OR any files failed; a method/token cap was hit (Spec 2 caps); a contract pass or runtime pass failed (Spec 1 / harness). The run still COMPLETES. Surface `degraded` + `degraded_reasons` on the run record and the readiness/run UI so Spec #5 coverage and the harness know the model may be partial.
- **Wire `filesFailed`.** Replace the hardcoded `0` in `discoveryV3Pipeline.ts` (L1344) with the real per-file gap-fill failure count from `runLlmGapFill`; feed it into the degraded computation.
- **Partial gap-fill made visible (not blocked).** Treat `stageStatus: 'failed'` OR nonzero `filesFailed` as a degraded trigger. Keep `GAP_FILL_MAX_FAILURE_RATE` semantics unchanged; keep the run COMPLETING.
- **Gap-fill LLM output cache.** Content-addressed cache keyed on `(normalized-prompt hash + model + temperature)`, extending the behaviour stage's `source_hash` hashing. Cache hit -> reuse prior response (no LLM call). Deterministic, cheaper re-runs. (Pairs with W2's `temperature: 0`.)
- **Below-gate candidate visibility.** Keep the 0.75 auto-accept gate. Ensure below-gate candidates are PERSISTED as reviewable candidates with an explicit "below auto-accept" review status AND a run-summary count. First verify the existing path already persists them; harden so reviewability + the count are guaranteed and visible (Tier-C runs sit entirely below the gate at `0.4`).
- **False-merge guard.** Only EXACT name matches bind silently. A NORMALIZED (fuzzy) match driving a binding (relationship/enrich/link/request-response resolution in `candidateSaveBackService.ts`) must be recorded as a low-confidence/reviewable binding OR emit a `possible_entity_collision` Finding. Guard the existing identity primitive; do not replace it. (Optional: tighten the English-only blanket singularization — best-effort, not required.)
- **Non-pure endpoint flagging.** A NEW deterministic scanner emits a `non_deterministic_endpoint` evidence-gap Finding for endpoints whose handler reaches `@Scheduled`/`@Cacheable`/`@Async`/`@Profile`-gated beans, session-scoped state, or clock/random — so the harness does not false-diff legitimate variance. New sentinel in `emissionSources.ts`.
- **Advisory throughout.** Every signal is a visible quality flag; nothing blocks; nothing auto-remediates.

### Reusability Opportunities

- EXTEND W2 (`temperature: 0` relays in `gateway/src/routes/discovery*.ts`) and W4 (`scanner_failed` Finding + sentinel) — do not redo.
- Reuse `FindingEmitter` / `emissionSources.ts` for the two new sentinels (`non_deterministic_endpoint`, `possible_entity_collision`) next to `scanner_failed` / `low_confidence_candidate`; reuse `FindingsTab` / `FindingDetailDrawer` to render.
- Reuse the behaviour stage's `source_hash` hashing (`llmBehaviourCaptureStep.ts`) as the gap-fill cache template.
- Guard (do not replace) the shared identity primitive in `candidateSaveBackService.ts` (`normalizeNameForMatch`, the 0.75 gate, existing below-gate-reviewable sites) — shared with Spec #1's resolver upgrade and Spec #5's `data_movements` producer.
- Reuse the existing advisory `warnings` field pattern on `DiscoveryRunDto` as the precedent for the new `degraded` field (snake_case `@JsonProperty`); closest changeset precedent `085-discovery-run-warnings.sql`.
- Reuse the existing run/readiness surface (`ReadinessAssessmentDto` + existing run UI) — no bespoke widget.
- Build ON TOP of Spec #1's response-contract scanner and Spec #2's caps + seeding DTO fields (consume their pass-failed / cap-hit signals as degraded triggers).

### Scope Boundaries

**In Scope:**
- Run-level advisory `degraded` flag + `degraded_reasons`, computed from the trigger set, persisted on the run record (AMS) and surfaced on the run/readiness UI.
- Wiring the real `filesFailed` count (replacing the hardcoded `0`).
- Escalating W4's `scanner_failed`, cap-hits (Spec 2), gap-fill stage-failure / failed-files, and contract/runtime-pass failures (Spec 1 / harness) into the degraded signal.
- Gap-fill LLM output cache keyed on `(normalized-prompt hash + model + temperature)`.
- Below-gate candidate persistence-as-reviewable + run-summary count (verify-then-harden the existing path).
- False-merge guard on normalized (non-exact) bindings (reviewable binding OR `possible_entity_collision` Finding); only exact matches bind silently.
- New deterministic `non_deterministic_endpoint` scanner + sentinel (Spring / Spring Classic).
- Two new finding sentinels in `emissionSources.ts`.

**Out of Scope:**
- Blocking gates of any kind (advisory only).
- Redoing W2 / W4 (extend them).
- Auto-remediation of any flagged condition.
- A new terminal run-STATUS enum value (degraded rides alongside `COMPLETED`).
- Changing `GAP_FILL_MAX_FAILURE_RATE` semantics or starting to fail the run on partial gap-fill.
- Replacing (vs guarding) the normalized-name identity primitive.
- A bespoke degraded-status UI widget (reuse the existing run/readiness surface).
- Non-Spring protocols.

### Technical Considerations

**Build layering (strict order):**
1. **AMS** — add the advisory `degraded` (+ `degraded_reasons`) field to the run record IF persisted there, and surface it on the run / readiness DTO. Match the existing wire convention (explicit `@JsonProperty("snake_case")`, no `@CamelCaseWire`, per `DiscoveryRunDto`). **New Liquibase changeset ONLY if a run-status/flag column is added** — a NEW file at the next free number **≥168 at build time** (highest applied today is `167-soap-field-metadata.sql`; Specs #1/#2 may consume 168/169 first, so take the next free number at build time). Never edit an applied changeset.
2. **discovery-service** (`discoveryV3Pipeline.ts` / `runManager.ts`) — compute the degraded status; wire `filesFailed` (replace L1344's `0`); escalate W4's `scanner_failed` + cap-hits to degraded; treat gap-fill stage-failure / nonzero `filesFailed` as degraded triggers. Add the new deterministic `non_deterministic_endpoint` scanner + its sentinel. Add the gap-fill LLM output cache (extend the behaviour stage's hashing). **No `discovery-service/src/**` edits during an in-flight run** (`tsx watch` auto-reload kills runs).
3. **MCP save-back** (`mcp-server/src/services/candidateSaveBackService.ts`) — false-merge guard on normalized bindings (reviewable binding OR `possible_entity_collision` Finding; only exact matches bind silently) + harden below-gate reviewable-candidate persistence and the run-summary count. Guard the identity primitive; do not replace it.
4. **frontend** — surface `degraded` (+ reasons) and the below-gate candidate count on the existing run / readiness surface; render the two new finding types via `FindingsTab` / `FindingDetailDrawer`. No bespoke widget.

**Repo conventions / constraints to honour:**
- **AMS wire format (VERIFIED):** AMS speaks `snake_case` by default (CLAUDE.md / `spring.jackson.property-naming-strategy: SNAKE_CASE`). `DiscoveryRunDto` uses explicit per-field `@JsonProperty("snake_case")`; the new `degraded` field follows that exact pattern. No `@CamelCaseWire` (no camelCase consumer introduced).
- **Liquibase:** new changesets are NEW files only; never edit an applied changeset (checksum-validation breaks startup). A new changeset is needed ONLY if a run column is added.
- **In-flight runs:** do not edit `discovery-service/src/**` during an active discovery run.
- **LLM access:** all LLM calls go via the gateway relay (W2's `temperature: 0` path); the new gap-fill cache wraps that relay.
- **Advisory ethos:** every added signal is non-blocking and surfaced, consistent with the program.

**Relationship to the runtime harness:** `api-migration-validation-service` remains the equivalence verifier. This spec makes discovery honest about its own completeness (degraded signal) and reproducible in its own extraction (gap-fill cache + W2 temperature), and gives the harness the `non_deterministic_endpoint` signal so it does not false-diff legitimate variance. Discovery still describes; the harness still verifies.

## Phase-2 Build Ordering & File-Overlap

**Position:** Spec **#3 of 6** in the HAIKAI Phase-2 "oracle perfection" program. **Built STRICTLY SEQUENTIALLY after Spec #1 and Spec #2** — never in parallel — so it extends their COMMITTED scanners + run/readiness DTO rather than racing them.

**Already on HEAD (extend, do NOT redo):**
- **W2** — `temperature: 0` on the gap-fill / behaviour / decision LLM relays in `gateway/src/routes/discovery*.ts`.
- **W4** — `scanner_failed` evidence-gap Finding at soft-fail catch sites in `discoveryV3Pipeline.ts` + `packFindingScanners/index.ts`, sentinel in `emissionSources.ts`.

**Cross-cutting files shared with sibling specs — extend the committed version, do not duplicate or race:**
- `discovery-service/src/services/discoveryV3Pipeline.ts` and `discovery-service/src/services/runManager.ts` — shared with **#1** (response-contract scanner), **#4** (inbound scanners), **#5 / #6** (resolvers). This spec adds degraded computation + `filesFailed` wiring + the new non-deterministic-endpoint scanner + the gap-fill cache. Build AFTER #1/#2 land their changes here.
- `discovery-service/src/services/findings/emissionSources.ts` — shared sentinel registry (already holds W4's `scanner_failed` + `low_confidence_candidate`; #1/#4 add their own). This spec ADDS `non_deterministic_endpoint` and `possible_entity_collision` next to them.
- `mcp-server/src/services/candidateSaveBackService.ts` — shared with **#5** (`data_movements` producer) and with **#1**'s identity-primitive upgrade. This spec adds the false-merge guard + below-gate hardening on the SAME `normalizeNameForMatch` / 0.75-gate primitive; guard it in place.
- The run / readiness DTO (`DiscoveryRunDto` + `ReadinessAssessmentDto`) — shared with **#2** (seeding). This spec ADDS the advisory `degraded` field to the version #2 committed; it does not re-author the DTO.

**Why sequential:** #3 reads signals produced by #1 (contract-pass-failed) and #2 (method/token cap-hit) as degraded triggers, and extends the scanner/DTO surfaces #1/#2 commit. Building it after they land avoids racing the same files and lets it consume their committed signals rather than stubbing them.
