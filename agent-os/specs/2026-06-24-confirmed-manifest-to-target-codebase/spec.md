# Specification: Confirmed manifest → target codebase artifact

## Goal
On target-state conversation confirmation, turn the user's confirmed dependency manifest (Spec 3's output, with Spec 4's curated vuln-reduction versions) into the **real build file** in the generated target codebase — by injecting the full manifest as a verbatim "write this exact file" instruction into a dedicated "seed build files" story sequenced first, with no implement-verify-service (IVS) change in v1.

## User Stories
- As a migration architect, I want my confirmed dependency manifest to become the actual `pom.xml` / `package.json` in the generated target codebase, so the curated versions I chose to reduce CVEs survive untouched into the build rather than being re-derived or treated as advisory notes.
- As a platform owner, I want each manifest placed into the correct target module/service location, so a multi-module/multi-service target is seeded with the right build file per service automatically.

## Specific Requirements

**Confirmed manifest becomes the real build file**
- Consume Spec 3's **confirmed** manifest(s) (resolved/curated coordinates + versions); do NOT re-parse, re-resolve, or re-curate.
- Emit one "write this exact file" instruction per confirmed manifest (one per target module/service).
- Output is the actual build file content (`pom.xml` / `package.json`), not advisory documentation.
- Trigger point: target-state conversation **confirmation** (the seam that closes captured decisions / writes `target-tech-stack-<id>.md`).
- Honour `version-unknown` markers from Spec 3 verbatim; the spec text MUST NOT invent or guess a version for unresolved entries.
- Scope is `pom.xml` + `package.json` only (no Gradle), inherited from Spec 3.

**Host = a dedicated "seed build files" story sequenced FIRST (LOCKED)**
- The write instruction(s) ride a **dedicated "seed build files" story**, NOT the first feature/foundation story.
- This story is sequenced **first** in the implementation order (before any other implementation), so the rest of the build is constructed on top of the authoritative file.
- The story carries the per-module instruction(s) in its generated spec/requirements text (the per-story `generatedSpecText` / `generated_spec_text` that IVS later reads from the spec folder).
- Multiple manifests → multiple per-module write instructions carried by this single first-sequenced story (or per-module sibling instructions), each with its own destination path.

**Carriage = full manifest embedded as a "write this exact file" block (LOCKED)**
- Embed the **entire** confirmed manifest file (full `pom.xml` / full `package.json`) as a literal, fenced "create this file with exactly this content" block in the spec text — the authoritative starting file.
- Carry the declarations **byte-faithfully** so curated coordinates + versions survive verbatim into the codebase.
- Scaffolding MAY be added **around** the embedded file (plugin blocks, build config, project metadata, surrounding boilerplate needed to make it build).
- The declared **dependencies and their versions MUST NOT change** — no upgrade, downgrade, re-pin, or removal of any declared dep/version.
- Instruction wording must be explicit and unambiguous so an unattended implementer treats it as an exact-write, not a suggestion.

**Authoritative-lock: build around it, never regenerate/replace**
- Spec text must instruct the implementation to treat the seeded build file as the **authoritative, frozen** source of dependency truth.
- Forbid regenerating, overwriting, inferring, or replacing the seeded file with a generated/alternative build file.
- The implementer builds the rest of the codebase to fit the seeded file (not the reverse).
- Lock language applies per seeded file when multiple manifests exist.

**Per-module placement via the service→module mapping (LOCKED)**
- Destination path is resolved from the **target service→module mapping**: Spec 3's per-manifest service/module tag + the target architecture layout.
- Default layout = **per-service module directories in a monorepo**; **per-repo root** when the target is multi-repo.
- The **service mapping is the source of truth** for the destination path — the spec does not invent paths independently.
- Each "write this exact file" instruction carries its resolved destination path.
- Support **multiple manifests**, each routed to its correct module/service location.

**Commit timing: implementation start, riding the normal IVS build/PR flow**
- The seeded build file(s) are committed at the **start of implementation** (because the seed story runs first).
- They ride the existing IVS commit / push / PR flow — **no special-case handoff**, no new commit path.
- No new IVS endpoint, input field, or build-file payload is introduced (see Out of Scope).

**Injection seam = existing gateway shape-spec generation (reuse, don't reinvent)**
- Inject the write instruction into the existing per-story shape-spec generation path (`migrationShapeSpecGenerationHandler.ts` + its route), which already produces the `generatedSpecText` that becomes a story's requirements.
- Do NOT build a new generator or a parallel spec-emission path.
- The generated spec text flows to IVS unchanged via `POST /api/v2/jobs/orchestrations` (`spec_name` + optional `context_files`); IVS reads the spec folder from disk.
- Because IVS has **no seed-file input** and reads only the spec folder, the manifest MUST live inside the spec's requirements text — this is the locked v1 mechanism.

**Honest v1 boundary + deferred alternative**
- The spec must state plainly that the v1 mechanism is **spec-text injection** (full-manifest write block in a first-sequenced seed story), with **zero IVS change**.
- IVS reads `pom.xml` / `package.json` as **analysis inputs only** today — no upgrading, no build-file editing, no SBOM, no seed input.
- Record the longer-term option — a first-class **IVS "seed files" input** that lets the gateway hand IVS exact files to write — as a **deferred alternative, explicitly NOT built in v1** (D8).

## Visual Design
No visual assets provided. (Mandatory check of `agent-os/specs/2026-06-24-confirmed-manifest-to-target-codebase/planning/visuals/` found no image/PDF files.) Code-anchor verification was performed in lieu of visuals; see Existing Code to Leverage.

## Existing Code to Leverage

**`gateway/src/services/migrationShapeSpecGenerationHandler.ts`**
- Gateway-side Product Manager migration shape-spec batch generator; produces per-story `generatedSpecText` (`generated_spec_text`) that becomes a story's requirements and is persisted to AMS.
- This is the natural seam to inject the "write this exact file" manifest instruction into the seed-build-files story's spec text.
- Already batches per-story serially with per-story failure isolation — reuse this lifecycle; do not add a parallel emission path.

**`gateway/src/routes/migrationShapeSpecGeneration.ts`**
- The route exposing the shape-spec generation handler.
- Reuse as the entry for emitting the seed story's spec text; no new route needed for the injection itself.

**`gateway/src/routes/orchestrations.ts` — `POST /api/v2/jobs/orchestrations`**
- Proxies the migration job to IVS; the request carries `spec_name` (spec FOLDER name) + optional `context_files` only — verified to have **no build-file/seed-file field**.
- Confirms v1 must carry the manifest inside the spec's requirements text; reuse this contract **unchanged**.

**Spec 3 confirmed manifest + service mapping (upstream producer)**
- Spec 3 ("Target dependency-manifest upload + auto-answer") produces the confirmed manifest(s): `pom.xml` + `package.json`, resolved/curated versions, `version-unknown` markers, each tagged to a target module/service.
- Spec 5 **consumes** this confirmed artifact + its service mapping as-is (the destination-path source of truth); it does NOT call the discovery resolvers (`MavenDependencyResolver`, `mavenPomMetadataParser`, `NpmDependencyResolver`) itself.

**Confirmation seam + AMS persistence**
- `target_state_captured_decisions` close → `target-tech-stack-<id>.md` is the structured confirmed-target source; Spec 5 triggers on this confirmation.
- AMS (Spring Boot) is **snake_case wire by default**; apply `@CamelCaseWire` only if a new persisted field has a camelCase consumer (no new wire-format decision is forced by this spec).

## Out of Scope
- Any IVS change in v1 — no new IVS endpoint, no "seed files" input, no build-file editing/upgrading, no SBOM/SCA in IVS (the IVS seed-file input is the deferred longer-term option D8).
- Re-parsing, re-resolving, or re-curating the manifest (Spec 3's job).
- Computing or steering dependency versions (Spec 4's job — Spec 5 consumes the curated result).
- Changing, upgrading, downgrading, or re-pinning any declared dependency or version in the seeded file.
- Inventing or guessing versions for `version-unknown` entries.
- Gradle build files (`pom.xml` + `package.json` only, per Spec 3).
- Modifying the `POST /api/v2/jobs/orchestrations` contract or adding a build-file payload field.
- Treating the manifest as advisory documentation instead of the real build file.
- Allowing the seeded build file to be regenerated, overwritten, or replaced by an inferred alternative during implementation.
