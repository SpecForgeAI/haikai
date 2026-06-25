# Task Breakdown: Confirmed manifest → target codebase artifact (Spec 5)

## Build order & prerequisite (READ FIRST)

- **This spec is built LAST.** The locked spec authoring/build order is
  **1 → 2 → 6 → 3 → 4 → 5**; this is Spec 5. Every earlier spec's entities and
  contracts may be assumed present at implementation time.
- **HARD PREREQUISITE: Spec 3 — the confirmed manifest.** Spec 3
  (`agent-os/specs/2026-06-24-target-dependency-manifest-auto-answer/`) is the
  upstream producer of the **confirmed** manifest(s) (`pom.xml` / `package.json`
  with resolved/curated coordinates + versions, `version-unknown` markers, and a
  per-manifest service/module tag). Spec 5 **consumes that confirmed artifact +
  its service mapping as-is** — it does NOT re-parse, re-resolve, or re-curate,
  and does NOT call the discovery resolvers (`MavenDependencyResolver`,
  `mavenPomMetadataParser`, `NpmDependencyResolver`). Do not start Spec 5 until
  Spec 3's confirmed-manifest output + service mapping are available to read.
- **Locked v1 mechanism = spec-text injection, ZERO IVS change.** IVS reads only
  the spec folder on disk and has **no seed-file input**; the
  `POST /api/v2/jobs/orchestrations` contract (`spec_name` + optional
  `context_files`) carries **no build-file field**. Therefore the full manifest
  must be embedded inside the seed story's requirements text. The first-class
  "IVS seed-files input" (D8) is the deferred longer-term alternative and is
  **explicitly OUT of scope** for v1 — no IVS endpoint, input field, build-file
  editing/upgrading, or SBOM/SCA is touched here.

## Overview
Total Tasks: 5 task groups.

This feature is almost entirely **gateway TypeScript** (the shape-spec
generation seam) plus **spec/prompt text authoring**. There is **no new DB
table, no new UI, and no AMS wire-format decision** unless a new persisted field
is genuinely required (it is not expected — `generatedSpecText` already
persists). The work is: build a verbatim-carriage manifest write-block emitter +
a service-mapping→destination-path resolver, then thread the per-module write
instruction(s) into the **dedicated "seed build files" story sequenced FIRST**
via the existing `migrationShapeSpecGenerationHandler.ts` enrichment path, so the
unchanged `POST /api/v2/jobs/orchestrations` flow carries it to IVS.

---

## Build & Verification Standards (MANDATORY — unattended overnight `implement-tasks`)

> Implementation runs UNATTENDED overnight. These standards are non-negotiable
> and are restated as the LAST sub-task of every task group. Sourced from the
> "Build-safety guidance" in
> `agent-os/planning/2026-06-24-vuln-target-state-6-spec-decisions.md` and the
> spec's own "Build-safety guidance to bake into `tasks.md`".

1. **Verify in ISOLATION — never gate on whole-repo green.**
   - The **whole-repo frontend tsc/lint baseline is RED** (pre-existing, on
     `main`). NEVER run a whole-repo build/lint as a gate and NEVER treat its
     red status as this feature's failure.
   - **Gateway** (where nearly all of this work lives): run targeted Jest on the
     touched files only, e.g.
     `cd gateway && npx jest src/services/<file>.test.ts --runInBand`
     and a **scoped** type-check of the changed gateway files only (e.g.
     `cd gateway && npx tsc --noEmit -p tsconfig.json` filtered to touched files,
     or a narrow tsconfig include) — judge only the touched files' diagnostics.
   - **Frontend** (only if any FE file is touched — not expected for this spec):
     targeted `vitest run <file>` + a **scoped** `tsc --noEmit` over the changed
     files only.
2. **Anchored / surgical edits only.**
   - Implementer subagents have **Write, not Edit**, and rewrite whole files
     (clobber risk). Make **anchored, surgical** changes; do not regenerate
     entire files when a localised insertion suffices.
   - After EVERY change to an existing file, run:
     - `git diff --stat` (confirm only the intended files/extent changed),
     - **symbol-survival greps** (grep the touched file for the key
       pre-existing exports/identifiers the file must still contain — e.g.
       `runShapeSpecGenerationBatch`, `productionDeps`, `enrichedSpecText`,
       `ShapeSpecGenerationDeps` — to prove a whole-file rewrite did not drop
       them),
     - a **mojibake / NUL scan** on each touched file (grep for the UTF-8
       replacement char `\357\277\275`, common mojibake sequences like `Ã`/`Â`/
       `â€`, and embedded NUL bytes). Any hit = fix before proceeding.
3. **No silent caps / sampling — LOG every drop.**
   - If anything is ever truncated, capped, sampled, or skipped (e.g. a manifest
     too large to embed, a manifest with no resolvable destination path, a
     `version-unknown` entry), emit an explicit structured `[diag-gateway]` log
     line naming what was dropped and why. Never drop silently.
4. **Verbatim guarantee is load-bearing.** The manifest declarations
   (coordinates + curated versions) MUST be carried **byte-faithfully** into the
   spec text. Any transform that could alter bytes (re-serialisation,
   pretty-printing, entity-escaping the file body, normalising whitespace inside
   the embedded block) is forbidden for the embedded file content. Tests must
   assert byte-equality of the carried block against the source manifest.
5. **AMS wire format.** AMS defaults to **snake_case** on the wire. Only if a
   genuinely new persisted field is introduced does it need attention, and then
   apply `@CamelCaseWire` ONLY if it has a camelCase consumer. No new wire-format
   decision is expected from this spec.

---

## Task List

### Gateway — Verbatim Carriage (write-block emitter)

#### Task Group 1: Full-manifest "write this exact file" block builder
**Dependencies:** None (pure function over a confirmed-manifest input shape).

Build the carriage core: a pure module that turns ONE confirmed manifest (full
`pom.xml` / full `package.json` content + its metadata) into a literal, fenced
**"create this file with exactly this content"** instruction block, byte-faithful
and unambiguous enough that an unattended implementer treats it as an exact-write,
not a suggestion. **Carriage = the FULL manifest embedded verbatim** (the locked
decision): the entire file rides as the authoritative starting file; scaffolding
is permitted *around* it but the declared deps/versions are frozen.

- [x] 1.0 Complete the verbatim manifest write-block builder
  - [x] 1.1 Write 2-8 focused tests for the write-block builder
    - Limit to 2-8 highly focused tests maximum.
    - Cover ONLY the load-bearing behaviours:
      (a) the **entire** manifest file body is carried **byte-for-byte** inside
          the fenced block (assert byte-equality vs the source string — no
          re-serialisation, no whitespace normalisation, no entity-escaping of
          the body);
      (b) the block includes explicit **exact-write + authoritative-lock**
          wording ("create this file with exactly this content", "do NOT
          regenerate / overwrite / replace / re-pin", "build around it");
      (c) a `version-unknown` marker present in the source survives **verbatim**
          (no invented version);
      (d) the resolved **destination path** is rendered into the instruction.
    - Skip exhaustive coverage of formatting permutations.
  - [x] 1.2 Define the confirmed-manifest input type the builder consumes
    - Minimal shape reflecting Spec 3's confirmed output: `{ fileName
      ('pom.xml' | 'package.json'), content (string, verbatim), serviceTag,
      destinationPath?, hasVersionUnknown? }`. Keep it inline in the gateway
      (mirror the existing inline-DTO convention in
      `migrationShapeSpecGenerationHandler.ts`); do NOT pull a generated-types
      module in.
    - Scope is `pom.xml` + `package.json` ONLY (no Gradle) — inherited from
      Spec 3; reject/ignore-with-log any other file type (no silent drop).
  - [x] 1.3 Implement `buildSeedFileWriteBlock(manifest)` (new gateway module)
    - New file e.g. `gateway/src/services/seedBuildFileWriteBlock.ts`.
    - Emit a fenced block embedding the **full** file content verbatim, the
      resolved destination path, exact-write wording, and per-file
      authoritative-lock language (D4: "treat as authoritative/frozen source of
      dependency truth; build the rest of the codebase to fit it; never
      regenerate, overwrite, infer, or replace it").
    - Choose a fence that cannot collide with the file body (e.g. a long
      backtick run or an explicit BEGIN/END sentinel) so embedded backticks in a
      `package.json`/`pom.xml` never break the block — assert this in 1.1.
    - Declared **dependencies and versions MUST NOT be altered** — the builder
      never edits the body; it only wraps it.
  - [x] 1.4 Honour `version-unknown` markers verbatim
    - The builder MUST NOT invent or guess a version for unresolved entries; it
      carries Spec 3's marker through untouched. If a marker is detected, log a
      `[diag-gateway]` note that an unresolved entry is being carried as-is (no
      silent handling).
  - [x] 1.5 Ensure Task Group 1 tests pass **in isolation**
    - Run ONLY the 2-8 tests from 1.1:
      `cd gateway && npx jest src/services/seedBuildFileWriteBlock.test.ts --runInBand`.
    - Scoped type-check the new file only; do NOT run the whole-repo build/lint
      and do NOT gate on the RED whole-repo baseline.
    - `git diff --stat` + mojibake/NUL scan on the new file (and any touched
      file). New module: confirm no stray edits leaked into neighbouring files.

**Acceptance Criteria:**
- The 2-8 tests from 1.1 pass in isolation.
- The full manifest is carried byte-faithfully; declared deps/versions are never
  altered; `version-unknown` survives verbatim.
- The block contains explicit exact-write + authoritative-lock wording and the
  destination path.
- No whole-repo gating; isolation verification clean.

---

### Gateway — Destination Path Resolution (service→module mapping)

#### Task Group 2: Resolve destination path from the service→module mapping
**Dependencies:** Task Group 1 (consumes the builder's input type).

The **service mapping is the source of truth** for where each manifest lands;
the spec does NOT invent paths independently. Resolve each manifest's Spec 3
service/module tag + the target architecture layout into a concrete destination
path: **default = per-service module directories in a monorepo**; **per-repo
root when the target is multi-repo**. Support **multiple manifests**, each routed
to its correct location.

- [x] 2.0 Complete the destination-path resolver
  - [x] 2.1 Write 2-8 focused tests for the resolver
    - Limit to 2-8 highly focused tests maximum.
    - Cover ONLY: (a) monorepo default — a service tag resolves to its
      per-service **module directory** + `pom.xml`/`package.json` filename;
      (b) multi-repo — resolves to the **per-repo root**; (c) **multiple
      manifests** route to distinct, correct paths; (d) a manifest whose tag has
      **no resolvable mapping** is surfaced explicitly (logged, not silently
      dropped — see 2.4).
    - Skip exhaustive layout permutations.
  - [x] 2.2 Implement `resolveSeedFileDestination(manifest, mapping, layout)`
    - New helper (e.g. in `gateway/src/services/seedBuildFileWriteBlock.ts` or a
      sibling `seedBuildFileDestination.ts`).
    - Source of truth = the Spec 3 per-manifest service/module tag + the target
      architecture layout. Default monorepo → `<module-dir>/<fileName>`;
      multi-repo → `<repo-root>/<fileName>`.
    - Reuse any existing service-mapping / placement convention from Spec 3
      rather than inventing a new path scheme; the resolver only formats what the
      mapping dictates.
  - [x] 2.3 Feed the resolved path back into the write-block (Group 1)
    - Each "write this exact file" instruction carries its own resolved
      destination path (1.3 renders it). Confirm multiple manifests each get
      their own path in the emitted block(s).
  - [x] 2.4 Unresolved-mapping handling — explicit, never silent
    - When a manifest's tag cannot be mapped, do NOT guess a path and do NOT drop
      it silently: emit a structured `[diag-gateway]` log naming the manifest +
      tag, and surface it so the threading layer (Group 3) can decide
      (fail-soft skip-with-log, consistent with the handler's per-story
      isolation posture). Assert the log path in 2.1.
  - [x] 2.5 Ensure Task Group 2 tests pass **in isolation**
    - Run ONLY the 2-8 tests from 2.1 (targeted Jest on the resolver test file,
      `--runInBand`).
    - Scoped type-check touched files only; never gate on whole-repo green.
    - `git diff --stat` + symbol-survival greps (builder exports from Group 1
      still present) + mojibake/NUL scan on touched files.

**Acceptance Criteria:**
- The 2-8 tests from 2.1 pass in isolation.
- Destination paths come from the service mapping (monorepo module dir default;
  per-repo root for multi-repo); multiple manifests route correctly.
- Unresolved mappings are logged + surfaced, never silently dropped or guessed.
- No whole-repo gating; isolation verification clean.

---

### Gateway — Seed-Story Threading (the FIRST-sequenced story)

#### Task Group 3: Inject the write block into the dedicated "seed build files" story, sequenced FIRST
**Dependencies:** Task Groups 1 & 2.

This is the heart of the spec. The write instruction(s) ride a **dedicated "seed
build files" story** (NOT the first feature/foundation story), **sequenced first**
in the implementation order so the rest of the build is constructed on top of the
authoritative file. Thread the per-module `generatedSpecText` through the existing
`migrationShapeSpecGenerationHandler.ts` enrichment path (reuse the seam that
already produces `enrichedSpecText` → `generatedSpecText`; do NOT build a new
generator or a parallel emission path). Multiple manifests → multiple per-module
write instructions carried by this single first-sequenced story (or per-module
sibling instructions), each with its own destination path.

- [x] 3.0 Complete seed-story threading via the shape-spec generation seam
  - [x] 3.1 Write 2-8 focused tests for the threading
    - Limit to 2-8 highly focused tests maximum.
    - Cover ONLY: (a) the seed-build-files story's `generatedSpecText` CONTAINS
      the Group 1 write-block(s) verbatim; (b) the story is marked/sequenced so
      it lands **FIRST** in implementation order (assert the
      first-sequenced/seed marker the seam uses); (c) **multiple manifests** →
      multiple per-module instructions all present in the seed story text;
      (d) non-seed stories are **unchanged** (no manifest injected into ordinary
      feature stories) — the existing handler behaviour is preserved.
    - Use the handler's existing dependency-injection seams (`ShapeSpecGenerationDeps`)
      to drive this without standing up AMS/LLM; mirror the existing handler
      test fixtures.
    - IMPLEMENTED: `gateway/src/__tests__/migrationSeedBuildFilesThreading.test.ts`
      (6 tests through the REAL `runShapeSpecGenerationBatch` via injected deps)
      + `gateway/src/services/__tests__/migrationSeedBuildFilesEnrichment.test.ts`
      (9 unit tests on the assembly module, incl. byte-equality carve between the
      Group 1 sentinels). All pass in isolation.
  - [x] 3.2 Add a seed-build-files enrichment step in the handler
    - Anchor at the existing enrichment point where `enrichedSpecText` is
      assembled before becoming `generatedSpecText` (currently around the
      `appendInlineTestPack(...)` call → the `row.generatedSpecText =
      enrichedSpecText` assignment in
      `gateway/src/services/migrationShapeSpecGenerationHandler.ts`). For the
      seed-build-files story ONLY, append the Group 1 write-block(s) into the
      generated spec text. Keep the change **surgical** (insertion, not a
      whole-file rewrite); preserve all existing enrichment, parser, two-pass,
      confidence, persistence, and per-story isolation behaviour.
    - IMPLEMENTED: `const`→`let enrichedSpecText` + a guarded append immediately
      after `appendInlineTestPack(...)` (`if (seedBuildFilesStory &&
      seedBuildFilesEnrichment.text) enrichedSpecText += ...`). Append (not
      overwrite) keeps the pass-2 no-meaningful-change compare weighing the SAME
      body. 39 existing handler/route/two-pass/impl-ready tests still green.
  - [x] 3.3 Identify the seed-build-files story + enforce FIRST sequencing
    - Recognise the dedicated seed story (a stable marker — e.g. a known
      title/kind/provenance on the book-of-work blob item, consistent with how
      the handler already recognises `sourceCapabilityId` / manual-add
      `provenance`+`kind`). Ensure its `sequenceOrder` (or equivalent ordering
      signal the handler honours) places it **first** so it is implemented before
      any other story. Do NOT inject the manifest into the first ordinary
      feature/foundation story — the host is the dedicated seed story (LOCKED).
    - IMPLEMENTED: stable `kind` marker `seed_build_files`
      (`SEED_BUILD_FILES_STORY_KIND` + `isSeedBuildFilesStory`) in
      `migrationSeedBuildFilesEnrichment.ts`. The handler already selects +
      orders stories by `sequenceOrder` (`selectEligibleStories`), so the
      upstream-minted seed story at the lowest `sequenceOrder` is processed +
      persisted FIRST — proven by threading test (b). The seed story runs the
      description-grounded path (provenance present) so it reaches the generated
      branch without the discovered-context resolver.
  - [x] 3.4 Carry per-module instructions for multiple manifests
    - When Spec 3 produced multiple confirmed manifests, the single
      first-sequenced seed story carries one write-block per module (or
      per-module sibling instructions), each with its own resolved destination
      path from Group 2. Confirm none is dropped; if any manifest is skipped
      (e.g. unresolved path from 2.4), log it explicitly (no silent cap).
    - IMPLEMENTED: `buildSeedBuildFilesEnrichment` resolves each manifest
      independently (Group 2) and emits one Group 1 block per module into the
      single seed story; carried + skipped counts logged
      (`seed_build_files_carried` / `seed_build_files_injection`). An unresolved
      path is surfaced in `skipped[]` but the verbatim file is STILL carried (the
      block renders the explicit "UNRESOLVED" notice — never a guessed path,
      never a silent drop). Threading test (c) asserts two manifests at distinct
      paths in the seed story.
  - [x] 3.5 Wire production deps + preserve `generatedSpecText` flow to IVS
    - Wire any new dependency seam through the existing `productionDeps` object
      in `gateway/src/routes/migrationShapeSpecGeneration.ts` (follow the
      established DI pattern; do NOT add a new route for the injection itself).
    - Confirm the enriched `generatedSpecText` still flows unchanged into AMS
      persistence and onward to IVS via the **unchanged**
      `POST /api/v2/jobs/orchestrations` (`spec_name` + `context_files`) — NO
      change to that contract (verify the orchestrations route/types are
      untouched).
    - IMPLEMENTED: `seedBuildFilesSource: defaultProductionSeedBuildFilesSource`
      added to `productionDeps` (honest v1 no-op returning null until the
      confirmed-manifest read is wired). `orchestrations.ts` is byte-for-byte
      UNTOUCHED (verified via `git diff --stat` = empty); Group 4 test (d) guards
      the `CreateJobRequest` contract (company/project/spec_intents/context_files,
      NO build-file/seed-file field) at compile + runtime.
  - [x] 3.6 Ensure Task Group 3 tests pass **in isolation**
    - Run ONLY the 2-8 tests from 3.1 (targeted Jest on the handler/threading
      test file, `--runInBand`).
    - Scoped type-check the touched gateway files only; never gate on the RED
      whole-repo baseline.
    - `git diff --stat` (confirm only the handler + route changed as intended) +
      **symbol-survival greps** on the handler (`runShapeSpecGenerationBatch`,
      `enrichedSpecText`, `ShapeSpecGenerationDeps`, `toAmsWireShape`,
      `normaliseAmsRow`) and the route (`productionDeps`,
      `migrationShapeSpecGenerationRouter`) to prove the surgical edit dropped
      nothing + mojibake/NUL scan on touched files.
    - DONE: threading tests 6/6 + enrichment tests 9/9 green in isolation;
      gateway `tsc -p tsconfig.json` = 0 errors; `git diff --stat` = handler (+64
      / -2) + route (+9) only; all symbol-survival greps non-zero; mojibake/NUL
      scan clean; `orchestrations.ts` untouched.

**Acceptance Criteria:**
- The 2-8 tests from 3.1 pass in isolation.
- The dedicated seed-build-files story carries the verbatim write-block(s) and is
  sequenced FIRST; ordinary feature stories are unchanged.
- Multiple manifests are each carried with their own destination path; nothing is
  silently dropped.
- The injection reuses the existing shape-spec generation seam (no new generator,
  no parallel path) and the `POST /api/v2/jobs/orchestrations` contract is
  untouched.
- Existing handler behaviour (two-pass, isolation, persistence) is preserved;
  symbol-survival greps clean; isolation verification clean.

---

### Gateway — Confirmation Trigger & Commit-at-Start

#### Task Group 4: Trigger on target-state confirmation; commit rides the normal IVS flow at implementation start
**Dependencies:** Task Group 3.

Wire the trigger point and commit timing. **Trigger = target-state conversation
confirmation** (the seam that closes `target_state_captured_decisions` / writes
`target-tech-stack-<id>.md`) — the moment Spec 3's confirmed manifest exists.
**Commit timing = implementation start**: because the seed story runs first, the
seeded build file(s) are committed at the start of implementation, riding the
**existing IVS commit/push/PR flow with NO special-case handoff and no new commit
path**. No new IVS endpoint, input field, or build-file payload is introduced.

- [x] 4.0 Complete the confirmation trigger + commit-timing wiring
  - [x] 4.1 Write 2-8 focused tests for the trigger
    - Limit to 2-8 highly focused tests maximum.
    - Cover ONLY: (a) on confirmation, the confirmed manifest(s) are read and the
      seed-story write-block(s) are emitted (end-to-end through Groups 1-3 with
      injected deps); (b) when NO confirmed manifest exists, the flow is a
      safe no-op (no empty/garbage seed block); (c) the manifest source is the
      **confirmed** artifact (consumes Spec 3's output; does NOT call the
      discovery resolvers).
    - Skip exhaustive trigger-permutation coverage.
    - IMPLEMENTED: `gateway/src/__tests__/migrationSeedBuildFilesTrigger.test.ts`
      (5 tests). (a) source consulted + seed block emitted E2E; (b) null source →
      no-op; (c) handler source asserts ZERO reference to
      `MavenDependencyResolver` / `NpmDependencyResolver` / `mavenPomMetadataParser`;
      (d) orchestrations-contract-unchanged guard; (e) honest v1 default no-op.
  - [x] 4.2 Hook the confirmation seam
    - Trigger Spec 5 on target-state conversation confirmation (the
      captured-decisions close / `target-tech-stack-<id>.md` write seam). Read
      Spec 3's confirmed manifest(s) + service mapping from that confirmed-target
      source; do NOT re-parse/re-resolve/re-curate (D7).
    - IMPLEMENTED: the `SeedBuildFilesSource` DI seam
      (`SeedBuildFilesSourceInput { projectId, bookOfWorkId, targetArchitectureId }`)
      is the consumption point for Spec 3's confirmed artifact + service mapping;
      the handler resolves it ONCE per batch (`resolveSeedBuildFilesEnrichment`,
      NEVER throws — a read hiccup degrades to a safe no-op). `confirmedArtifactsToSeedBundle`
      adapts `ConfirmedManifestArtifact[]` → the carriage shape with NO
      re-parse/re-resolve. The honest v1 production default
      (`defaultProductionSeedBuildFilesSource`) returns null until the
      confirmed-manifest persistence read is wired by a real producer — documented
      as the integration point (the seam + threading ship end-to-end now).
  - [x] 4.3 Confirm commit-at-implementation-start via the existing IVS flow
    - Assert (in code + test) that the seed file(s) ride the normal IVS
      commit/push/PR flow with NO new commit path and NO special-case handoff:
      the seed story being FIRST is what guarantees commit-at-start. The
      `POST /api/v2/jobs/orchestrations` contract is unchanged; no build-file
      payload field is added.
    - DONE: NO new commit path / route is added — the seed file rides inside the
      FIRST-sequenced story's `generatedSpecText` through the EXISTING persistence
      + orchestrations flow. `orchestrations.ts` is untouched (`git diff --stat`
      empty); Group 4 test (d) compile- + runtime-guards the `CreateJobRequest`
      contract (no `seed[_-]?file` / `build[_-]?file` field; `spec_name` +
      `context_files` intact).
  - [x] 4.4 Keep the v1 boundary honest in code + logs
    - No IVS change: no new IVS endpoint/input, no build-file editing/upgrading,
      no SBOM/SCA. If the deferred "IVS seed-files input" (D8) is referenced
      anywhere, reference it as explicitly NOT built in v1. Log a clear
      `[diag-gateway]` marker when the seed-files injection runs (count of
      manifests carried, any skipped-with-reason) — no silent caps.
    - DONE: module docstrings state the v1 mechanism = spec-text injection with
      ZERO IVS change + name D8 as the deferred-NOT-built alternative. The
      `seed_build_files_injection` log line carries
      `carried=<n> skipped=<n> ivs_change=none v1_mechanism=spec_text_injection`;
      the per-story `seed_build_files_injected` line carries the carried/skipped
      counts. No silent caps anywhere.
  - [x] 4.5 Ensure Task Group 4 tests pass **in isolation**
    - Run ONLY the 2-8 tests from 4.1 (targeted Jest, `--runInBand`).
    - Scoped type-check touched files only; never gate on whole-repo green.
    - `git diff --stat` + symbol-survival greps (orchestrations route/types
      UNCHANGED; handler exports intact) + mojibake/NUL scan on touched files.
    - DONE: trigger tests 5/5 green in isolation; gateway `tsc -p tsconfig.json`
      = 0 errors; `orchestrations.ts` UNCHANGED (`git diff --stat` empty +
      contract symbols `spec_name`/`context_files`/`CreateJobRequest` intact);
      handler exports (`runShapeSpecGenerationBatch`, `ShapeSpecGenerationDeps`,
      `enrichedSpecText`, `toAmsWireShape`, `normaliseAmsRow`) all survive;
      mojibake/NUL scan clean.

**Acceptance Criteria:**
- The 2-8 tests from 4.1 pass in isolation.
- The flow triggers on target-state confirmation and consumes Spec 3's confirmed
  manifest (no re-parse/re-resolve/re-curate).
- Seed file(s) commit at implementation start via the unchanged IVS build/PR
  flow; no new IVS endpoint/input/contract change.
- No-manifest case is a safe no-op; logs are explicit; no silent drops.
- Isolation verification clean.

---

### Testing

#### Task Group 5: Test Review & Gap Analysis (this feature only)
**Dependencies:** Task Groups 1-4.

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 2-8 tests from each of Groups 1 (write-block), 2 (destination),
      3 (threading), 4 (trigger). Total existing: ~8-32 tests.
    - DONE: reviewed all 5 existing Spec 5 suites — Group 1
      `seedBuildFileWriteBlock.test.ts` (6), Group 2
      `seedBuildFileDestination.test.ts` (5), Group 3/4 assembly
      `migrationSeedBuildFilesEnrichment.test.ts` (9), Group 3 threading
      `migrationSeedBuildFilesThreading.test.ts` (6), Group 4 trigger
      `migrationSeedBuildFilesTrigger.test.ts` (5) = 31 tests, all GREEN in
      isolation. Each group's load-bearing behaviours are individually covered.
  - [x] 5.2 Analyse coverage gaps for THIS feature only
    - Identify critical end-to-end workflow gaps ONLY for this spec:
      confirmed-manifest → verbatim write-block → correct destination → injected
      into the FIRST-sequenced seed story → flows via unchanged
      `POST /api/v2/jobs/orchestrations`. Focus on the **verbatim/byte-faithful
      guarantee** and the **FIRST-sequencing** invariant as the highest-value
      end-to-end assertions.
    - Do NOT assess whole-application coverage; do NOT touch unrelated suites.
    - DONE. Gap found: the two highest-value E2E invariants were only asserted
      PIECEMEAL across separate `it` blocks, and the multi-manifest threading
      proof used `.toContain` rather than a byte-carve equality on EACH body. No
      single test asserted, through the REAL `runShapeSpecGenerationBatch`: two
      manifests → two per-module blocks, EACH carved byte-for-byte out of the
      PERSISTED seed-story text (the bytes IVS reads), EACH at its own resolved
      path, ALL in the single FIRST-sequenced seed story, with ordinary stories
      present and untouched, and `version-unknown` surviving byte-equal. Edges
      already owned by Group 1-4 (fence collision, rejection, layout
      permutations, repeated no-op) were intentionally NOT re-covered.
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Add at most 10 new tests to fill identified critical gaps — prioritise:
      (a) one full happy-path E2E (multiple manifests → multiple per-module
      blocks, each byte-faithful, each at its correct path, all in the
      first-sequenced seed story); (b) the authoritative-lock + `version-unknown`
      survival assertions if not already covered; (c) the
      orchestrations-contract-unchanged guard.
    - Do NOT write exhaustive edge/perf/accessibility coverage.
    - DONE: added `gateway/src/__tests__/migrationSeedBuildFilesEndToEnd.test.ts`
      (6 strategic tests, under the 10 cap), each driven through the REAL
      `runShapeSpecGenerationBatch` and carving bytes out of the PERSISTED
      seed-story `generatedSpecText` via a per-destination sentinel carve:
      (1) full happy-path — 2 manifests → exactly 2 per-module blocks, EACH
      byte-equal to source at its OWN resolved path, in the FIRST-sequenced seed
      story, ordinary stories carrying no seed section; (2) `version-unknown`
      survives byte-for-byte with no fabricated version; (3) authoritative-lock +
      FIRST-sequencing wording present in persisted text; (4) ordinary stories
      receive NO manifest bytes whatsoever; (5) the carried text flows via the
      UNCHANGED orchestrations contract (compile + runtime guard) AND the carve
      proves real bytes ride it; (6) no-confirmed-manifest → clean no-op, batch
      still completes.
  - [x] 5.4 Run feature-specific tests only **in isolation**
    - Run ONLY this spec's tests (Groups 1-4 + 5.3), targeted Jest in the gateway,
      `--runInBand`. Expected total ~18-42 tests.
    - Do NOT run the entire application/repo test suite; do NOT gate on the RED
      whole-repo frontend baseline.
    - Final `git diff --stat` + symbol-survival greps + mojibake/NUL scan across
      every touched file.
    - DONE: all 6 Spec 5 suites GREEN in isolation —
      `npx jest seedBuildFileWriteBlock seedBuildFileDestination
      migrationSeedBuildFilesEnrichment migrationSeedBuildFilesThreading
      migrationSeedBuildFilesTrigger migrationSeedBuildFilesEndToEnd --runInBand`
      = **37/37** passing (6+5+9+6+5+6), inside the expected ~18-42 band. Gateway
      `tsc --noEmit -p tsconfig.json` = 0 errors (whole-gateway clean; new test
      file contributes none). Group 5 added EXACTLY one new untracked file
      (`migrationSeedBuildFilesEndToEnd.test.ts`) — no tracked gateway file
      modified by this group (the handler/route diffs predate Group 5, from
      Groups 3-4). Symbol-survival greps on every imported module all non-zero
      (`runShapeSpecGenerationBatch`/`ShapeSpecGenerationDeps`/`SpecGenerationResult`,
      the seed enrichment + write-block + destination exports, and the
      orchestrations `CreateJobRequest`/`spec_name`/`context_files`). Mojibake/NUL
      scan on the new file CLEAN (`grep -aP '\x00'` = no NUL; no U+FFFD; no
      `Ã`/`Â`/`â€`; `file` reports clean UTF-8; git does not flag it binary).

**Acceptance Criteria:**
- All feature-specific tests pass in isolation (~18-42 total).
- Critical workflows covered: verbatim carriage, destination routing, FIRST
  sequencing, unchanged IVS contract, `version-unknown` survival.
- No more than 10 additional tests added.
- Testing focused exclusively on this spec; no whole-repo gating.

---

## Execution Order

Recommended implementation sequence (each group ends with isolation verification;
never gate on the RED whole-repo frontend baseline):

1. **Task Group 1** — Verbatim full-manifest "write this exact file" block builder.
2. **Task Group 2** — Destination-path resolution from the service→module mapping.
3. **Task Group 3** — Inject the write block into the dedicated "seed build files"
   story, sequenced FIRST, via the existing `migrationShapeSpecGenerationHandler.ts`
   seam.
4. **Task Group 4** — Trigger on target-state confirmation; commit-at-start rides
   the unchanged IVS build/PR flow.
5. **Task Group 5** — Test review & gap analysis (this feature only).

## Out of Scope (do NOT implement — restated from spec.md)
- Any IVS change in v1 — no new IVS endpoint, no "seed files" input (D8 is
  deferred), no build-file editing/upgrading, no SBOM/SCA in IVS.
- Re-parsing / re-resolving / re-curating the manifest (Spec 3's job) or calling
  the discovery resolvers.
- Computing or steering dependency versions (Spec 4's job) — Spec 5 consumes the
  curated result.
- Changing, upgrading, downgrading, or re-pinning ANY declared dependency or
  version in the seeded file; inventing versions for `version-unknown` entries.
- Gradle build files (`pom.xml` + `package.json` only, per Spec 3).
- Modifying the `POST /api/v2/jobs/orchestrations` contract or adding a build-file
  payload field.
- Treating the manifest as advisory documentation, or allowing the seeded build
  file to be regenerated / overwritten / replaced by an inferred alternative
  during implementation.
