# Spec Requirements: Confirmed manifest → target codebase artifact (Spec 5)

> **Source of truth:** This requirements file is a faithful transcription of the
> LOCKED decisions in
> `agent-os/planning/2026-06-24-vuln-target-state-6-spec-decisions.md` — the
> **"Spec 5"** section plus the shared **"Existing-code anchors"**,
> **"Cross-cutting decisions"**, and **"Build-safety guidance"** sections — and
> the raw idea at `planning/raw-idea.md`. Decisions are already made; nothing
> here was re-asked. Code anchors below were verified against the live codebase
> during shaping (see Visual / Code-anchor verification).

## Initial Description

On target-conversation confirmation, the user's confirmed dependency manifest
becomes the **real build file** in the generated target codebase. Write the
dependency **declarations VERBATIM** (honour the curated versions chosen for
vuln-reduction; the implementation may add scaffolding around them but must not
change the declared deps/versions). Mechanism: inject the manifest into an early
spec's requirements as a "write this exact file" instruction — **NO
implement-verify-service (IVS) change for v1** (IVS has no seed-file input and
reads manifests as analysis only). Lock the seeded build file as authoritative;
instruct the implementation to build around it, never regenerate/replace it.
Per-module placement by service mapping (multiple manifests possible). Committed
at implementation start, riding the normal IVS build/PR flow.

## Requirements Discussion

> All decisions were gathered and LOCKED on 2026-06-24. The shaping phase did
> NOT re-ask the user. The "answers" below are the locked decisions verbatim.

### Locked Decisions (Spec 5)

**D1 — Confirmed manifest becomes the real build file.**
On target-state conversation confirmation, the user's confirmed dependency
manifest (the output of Spec 3, with curated/steered versions from Spec 4) is
written into the generated target codebase as the actual build file
(`pom.xml` / `package.json`), not as advisory documentation.

**D2 — Declarations written VERBATIM; versions are honoured, not re-derived.**
The dependency declarations (coordinates + curated versions) are written exactly
as confirmed. The implementation **may add scaffolding around them** (e.g.
plugin blocks, build config, project metadata, surrounding boilerplate needed to
make the file build) but **must not change the declared dependencies or their
versions**. The curated versions exist specifically for vuln reduction and must
survive into the codebase untouched.

**D3 — Mechanism: inject the manifest into an early spec's requirements as a
"write this exact file" instruction — NO IVS change for v1.**
The confirmed manifest content is embedded into an early migration spec's
requirements text as an explicit, literal "create this file with exactly this
content" instruction. IVS then writes the file as part of its normal
spec→code→verify→PR flow. There is **no new IVS feature, endpoint, or input** in
v1 — IVS continues to read manifests only as analysis inputs and has no
"seed a file" capability today (documented below under IVS Facts).

**D4 — Lock the seeded build file as authoritative; build around it, never
regenerate/replace it.**
The spec text must instruct the implementation to treat the seeded build file as
the authoritative, frozen source of dependency truth: build the rest of the
codebase around it, and never regenerate, overwrite, or replace it with a
generated/inferred alternative.

**D5 — Per-module placement by service mapping (multiple manifests).**
Multiple confirmed manifests are possible (Spec 3 allows multiple manifests,
each tagged to its target module/service). Each manifest is placed into the
correct target module/service location in the generated codebase per the
service mapping. The "write this exact file" instruction is therefore per-module
and carries its destination path.

**D6 — Committed at implementation start, riding the normal IVS build/PR flow.**
The seeded build file(s) are committed at the start of implementation (so the
rest of the build is constructed on top of the authoritative file), riding the
existing IVS commit/push/PR flow with no special-case handoff.

**D7 — Consumes Spec 3's confirmed manifest.**
The input to this spec is the confirmed manifest produced by Spec 3 (target
dependency-manifest upload + auto-answer), with resolved/curated versions —
including any "version-unknown" markers and any Spec 4 steering applied. This
spec does NOT re-parse, re-resolve, or re-curate; it consumes the confirmed
artifact as-is.

**D8 — Longer-term option (explicitly out of scope for v1): a real IVS
"seed files" input.**
The decisions doc names a future option where IVS gains a first-class "seed
files" input so the gateway can hand IVS exact files to write rather than
embedding them in spec prose. v1 deliberately does NOT build this; the spec must
be honest that the v1 mechanism is the spec-text injection, with the IVS
seed-file input recorded as a deferred alternative.

### Existing Code to Reference

> From the decisions doc "Existing-code anchors" + verification during shaping.
> The spec-writer should reference these; the implementer must reuse, not
> reinvent.

**Relevant generation → IVS path:**
- **`gateway/src/services/migrationShapeSpecGenerationHandler.ts`** — the
  gateway-side Product Manager migration shape-spec batch generator. It produces
  the per-story shape-spec text (`generated_spec_text`) that becomes a spec's
  requirements. This is the natural seam into which the "write this exact file"
  manifest instruction is injected (the per-story/per-module spec text the
  implementation later reads).
- **`gateway/src/routes/migrationShapeSpecGeneration.ts`** — the route exposing
  the above handler.
- **`gateway/src/routes/orchestrations.ts`** — proxies
  `POST /api/v2/jobs/orchestrations` to IVS. The job request
  (`CreateJobRequest`) references a `spec_name` (spec FOLDER name) + optional
  `context_files` paths; IVS reads the spec/requirements from disk. **There is
  no build-file / seed-file field** on the contract — direct confirmation that
  v1 must carry the manifest inside the spec's requirements text.

**Upstream producer (Spec 3) of the confirmed manifest:**
- Spec 3 — "Target dependency-manifest upload + auto-answer" — produces the
  confirmed manifest (pom.xml + package.json only; resolved versions; multiple
  manifests tagged to target module/service; `version-unknown` markers).
- Discovery dependency parsers reused upstream: `MavenDependencyResolver`,
  `mavenPomMetadataParser`, `NpmDependencyResolver` (Spec 3 territory — Spec 5
  consumes their resolved output, does not call them).

**Conversation / confirmation seam:**
- `target_state_captured_decisions` + conversation close writes
  `target-tech-stack-<id>.md`; the confirmed-manifest declarations are the
  structured target-version source. Spec 5 is triggered on conversation
  confirmation.
- `openTurnTechStackPrefill.ts` `{value,sourceQuote,sourceFile}` envelope —
  referenced by Spec 3; relevant only as provenance context for where the
  confirmed declarations come from.

**Persistence:**
- AMS (Spring Boot, snake_case wire by default; `@CamelCaseWire` only for
  camelCase consumers). No new wire-format decisions are forced by this spec; if
  any new persisted field is needed it follows the AMS default.

### Follow-up Questions

None. The decisions doc is authoritative and the v1 mechanism was verified
against the live code. See "Open Questions" for the small number of genuine
implementation gaps (none of which re-open a settled decision).

## IVS Facts (verified during shaping — keep the spec honest about v1)

- IVS (`implement-verify-service`) is the spec→code→verify→deploy engine; it
  writes/commits/pushes/PRs and runs CI-webhook verify + reconcile + bug-fix.
- IVS reads `pom.xml` / `package.json` as **analysis inputs only** — no
  upgrading, no build-file editing, no SBOM. Zero CVE/SCA/advisory features.
- **IVS has NO "seed a file" input today.** A repo-wide search for
  `seed_file` / `seed-file` / `seedFile` / `seed_files` in
  `implement-verify-service` returned no input/feature; the only "seed" hits are
  unrelated (log files and generated spec content).
- The migration loop entry is `POST /api/v2/jobs/orchestrations`; the job
  request carries a `spec_name` (spec folder) + optional `context_files` paths,
  not a build-file payload. IVS reads the spec/requirements from the spec folder
  on disk.
- **Consequence (the v1 mechanism):** because IVS has no seed-file input and
  only reads the spec folder, the confirmed manifest must be embedded into a
  spec's requirements text as a literal "write this exact file" instruction.
  This is the locked v1 path; the IVS seed-file input is the deferred longer-term
  alternative (D8), explicitly NOT built in v1.

## Visual Assets

### Files Provided:
No visual assets provided. (Mandatory check of
`agent-os/specs/2026-06-24-confirmed-manifest-to-target-codebase/planning/visuals/`
found no image/PDF files.)

### Code-anchor verification (in lieu of visuals):
- Confirmed `migrationShapeSpecGenerationHandler.ts` + route exist and own the
  per-story spec-text generation that becomes spec requirements.
- Confirmed `orchestrations.ts` `POST /api/v2/jobs/orchestrations` contract has
  no build-file/seed-file field (only `spec_name` + `context_files`).
- Confirmed IVS has no `seed_file`/`seedFile` input anywhere.

## Requirements Summary

### Functional Requirements
- On target-state conversation confirmation, take Spec 3's **confirmed
  manifest(s)** and emit a "write this exact file" instruction embedded in an
  early migration spec's requirements text, one per manifest/module.
- Write the dependency **declarations VERBATIM** — exact coordinates and exact
  curated versions — into the seeded build file content carried by that
  instruction.
- Allow the implementation to add surrounding **scaffolding** needed to build,
  while forbidding any change to declared deps/versions.
- Instruct the implementation to treat the seeded build file as
  **authoritative/frozen**: build around it, never regenerate or replace it.
- Place each manifest into the correct **target module/service** path per the
  service mapping (support **multiple manifests**).
- Ensure the seeded build file(s) are **committed at implementation start**,
  riding the normal IVS build/PR flow (no new IVS feature in v1).
- Preserve `version-unknown` markers from Spec 3 honestly (no guessing); the
  spec text must not invent versions for unresolved entries.

### Reusability Opportunities
- Inject into the existing shape-spec generation path
  (`migrationShapeSpecGenerationHandler.ts` + its route) rather than building a
  new generator.
- Reuse the existing `POST /api/v2/jobs/orchestrations` flow unchanged (no IVS
  contract change).
- Consume Spec 3's confirmed manifest + service mapping directly; do not
  re-parse or re-resolve (discovery parsers already did that upstream).

### Scope Boundaries
**In Scope:**
- Embedding confirmed manifest declarations (verbatim) into an early spec's
  requirements as a literal "write this exact file" instruction, per module.
- Authoritative-lock instruction text ("build around it, never regenerate").
- Per-module placement via service mapping; multiple manifests.
- Commit-at-implementation-start via the existing IVS build/PR flow.

**Out of Scope:**
- Any IVS change in v1 — no new IVS endpoint, no "seed files" input, no
  build-file editing/upgrading/SBOM in IVS (deferred longer-term option, D8).
- Re-parsing / re-resolving / re-curating the manifest (Spec 3's job).
- Computing or steering versions (Spec 4's job) — Spec 5 consumes the curated
  result.
- Gradle (pom.xml + package.json only, per Spec 3).

### Technical Considerations
- **Integration point:** gateway shape-spec generation → spec requirements text
  → IVS via `POST /api/v2/jobs/orchestrations` (`spec_name` + `context_files`).
- **Constraint:** IVS reads only the spec folder; the manifest MUST live inside
  spec requirements text (no seed-file input exists).
- **Verbatim guarantee:** the "write this exact file" instruction must carry the
  declarations byte-faithfully so curated vuln-reduction versions survive.
- **AMS:** snake_case wire by default; `@CamelCaseWire` only for camelCase
  consumers, if any new persisted field is introduced.

### Build-safety guidance to bake into `tasks.md`
> From the decisions doc "Build-safety guidance" — for the unattended overnight
> `implement-tasks`.
- The whole-repo frontend tsc/lint baseline is RED — **verify each feature in
  ISOLATION** (targeted vitest/jest + scoped tsc on changed files), never gate
  on whole-repo green.
- Implementer subagents have Write (not Edit) — use **anchored/surgical edits**;
  after each, run `git diff --stat`, symbol-survival greps, and a mojibake/NUL
  scan on touched files.
- AMS DTOs default to snake_case wire; apply `@CamelCaseWire` only for camelCase
  consumers.
- No silent caps/sampling — log anything dropped.

## Open Questions

The decisions doc fully settles the WHAT and the v1 MECHANISM. The following are
genuine implementation-shaping gaps (HOW within the locked mechanism) that the
spec-writer should resolve — none re-opens a settled decision:

1. **Which "early spec" hosts the injected instruction?** The decision says
   "an early spec's requirements." The spec-authoring/build order is 1 → 2 → 6 →
   3 → 4 → 5; the manifest is confirmed by Spec 3/4, so the host spec must run at
   implementation start yet after confirmation. The spec-writer should pin
   whether the instruction rides the first scaffolding/foundation story per
   module, or a dedicated "seed build files" story sequenced first.
2. **Exact verbatim-carriage format inside spec text.** Whether the declarations
   are embedded as a fenced full-file block (entire `pom.xml` / `package.json`)
   or as a declarations-only block the implementer wraps with scaffolding. D2
   permits scaffolding-around; the spec should state the concrete carriage shape
   so "verbatim" is enforceable.
3. **Service-mapping → destination-path resolution.** How a manifest's
   module/service tag (from Spec 3) maps to a concrete path in the generated
   target codebase (monorepo module dir vs per-service repo). Likely inherited
   from existing service-mapping/placement conventions; the spec should name the
   source of truth for the destination path.
