Build the scaffolding for the "v3 discovery pipeline" that runs extension packs FIRST and then an LLM gap-fill stage SECOND. This spec covers the core pipeline contract, the pack-interface refactor, and migrating ONE reference pack end-to-end to prove the shape. **V3 is the only runtime pipeline from this spec onward — V2 is decommissioned as a runtime path.**

## Context

Today's V2 pipeline (see DISCOVERY_SERVICE_EXPLAINER.md) runs the LLM first and extension packs second, unioning two independent producers. V3 inverts this: packs produce deterministic structural facts first, then the LLM adds semantic gap-fill on top. This gives cheaper LLM runs, fail-fast detection of pack regressions, and a deterministic backbone for candidate output.

Packs today bundle (file filter + language extractor + framework adapter) into a single unit. V3 splits this into two tiers so the pipeline can degrade gracefully to "language-only" (Tier B) or "LLM-only" (Tier C) when no framework adapter matches:
- **LanguagePack** — matches on language, produces Universal IR (`SourceFileIR`)
- **FrameworkPack** — matches on language+technology, consumes IR, emits `DiscoveryCandidate`s

Tier B/C progressive-degradation behavior (what the pipeline does when no FrameworkPack matches the techHints) is specified elsewhere in the V3 plan — for this spec it is sufficient that the V3 pipeline remains the runtime path regardless of pack coverage.

## In scope

1. Refactor `discovery-service/src/services/extensionPacks` types:
   - Introduce `LanguagePack { id, when: { language }, extract(sourceFiles, techHints) → Map<filePath, SourceFileIR> }`.
   - Introduce `FrameworkPack { id, when: { language, technology }, adapt(irFiles, runId, techHints) → DiscoveryCandidate[] }`.
   - Retain the existing `ExtensionPack` TYPE so legacy pack files compile, but no runtime path registers or invokes V2 packs.

2. Update `extensionPackRegistry.ts`:
   - New registries: `languagePacks[]`, `frameworkPacks[]`. The legacy `packs[]` registry is removed or emptied (no V2 runtime registration).
   - New lookups: `findLanguagePack(techHints)`, `findFrameworkPacks(techHints)`, `computeTier(techHints)` returning `'A' | 'B' | 'C'` based on what matches.
   - Keep `matchesPredicate` per-field AND semantics from the recent fix.

3. Create `runDiscoveryV3(context)` in a new file `services/discoveryV3Pipeline.ts`:
   - Stage 1: resolve language pack → extract IR for applicable files.
   - Stage 2: resolve framework packs → run their adapters on IR, collect tagged candidates.
   - Stage 3: stubbed gap-fill in this spec — real LLM gap-fill comes in Spec 2. Stage 3 emits `gapFillStage: "v3-spec1-stub"` and `gapFillCandidates: 0` into the run's `steps_payload` so downstream tooling can distinguish "no gaps" from "not implemented yet."
   - Stage 4: merge + persist.
   - Invoked unconditionally from `llmFileAnalysisStep.ts` — the V2 LLM-first path is removed from the runtime. A dev/test-only override via env flag MAY remain for local experimentation (decision deferred; default assumption is no flag at all).

4. Migrate ONE pack — **spring-classic** — to the new shape as the reference implementation:
   - Split into `javaLangPack` (extractor) and `springClassicFrameworkPack` (adapter).
   - Remove its V2 `ExtensionPack` registration.
   - Local harness (`scripts/run-pack-local.ts` + `scripts/batch-validate-packs.sh`) updated to call the V3 shape. Un-migrated packs (Spec 4) simply do not register — the V3 pipeline runs without them, degrading to Tier B/C.

5. Persist the computed tier on the run entity:
   - Add a nullable `mode` (or `tier`) column to `discovery_run` in `architecture-model-service` and expose it through the `DiscoveryRunEntity` / `DiscoveryRunDto` + mapper.
   - Populated by `runDiscoveryV3` on every run. Avoids a duplicate migration in Spec 5 and gives observability benefits from day one.

6. Add focused scenario tests (see Requirements for the full list).

## Out of scope

- Prompt architecture (Spec 2).
- Evaluation harness (Spec 3) — shadow-mode V2-vs-V3 validation belongs there, not here.
- Migration of any pack other than spring-classic (Spec 4).
- Tier-aware user warnings / confidence propagation / opt-in UX (Spec 5).
- Full `SourceFileIR` schema formalization — Spec 4 broadens multi-language extractors and is the better home for schema tightening. This spec uses the existing IR shape in `discovery-service/src/services/extensionPacks/languageIR.ts` (`ClassIR`/`FunctionIR`/`FieldIR`/`AnnotationIR`) as-is.

## Key constraints

- Service-scoped runs build techHints via `parseCoretech()` — one field per hint. Predicate logic must remain per-field AND across hints, not per-hint.
- `_addedBy` tag format: framework adapter candidates stay `'<framework>-adapter'` (e.g. `'spring-classic-adapter'`).
- V2 files may remain in-tree as dead code if deletion is disruptive, but NO runtime path may reach them. Prefer un-registering / un-referencing over churny deletions.

## Done when

- V3 pipeline runs end-to-end against OpenMRS and emits spring-classic-adapter candidates matching the V2 harness count (~1037, within ±2%) AND passes a spot-check of ≥10 known candidates by `(type, name, filePath, _addedBy)` identity equality.
- `computeTier`, tier lookups, and the stage-3 stub marker are covered by scenario tests.
- Computed tier is persisted on each `discovery_run`.
- `DISCOVERY_SERVICE_EXPLAINER.md` updated with the V3 section.
