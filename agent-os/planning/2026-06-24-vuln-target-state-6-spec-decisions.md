# Initiative — CVE Reduction Across Current→Target Migration + Target-State Conversation Overhaul

**Status:** decisions LOCKED (gathered 2026-06-24). This is the authoritative input for shaping 6 specs.
**Goal:** A major tool goal is to reduce/eliminate CVEs when creating the target state. Capture current-state
vulnerabilities (internal report + automated OSV), and when authoring the target state, **predictively** show which
CVEs are eliminated / remain / newly-introduced, **steering** the user toward non-vulnerable versions — and overhaul the
target-state architect conversation so downstream choices are constrained by earlier answers and framework+version
selection doesn't explode into chips.

**Execution model:** shape → write-spec → create-tasks for ALL 6 first (human reviews every `spec.md` + `tasks.md`),
then `implement-tasks` runs OVERNIGHT, unattended. Do NOT use agent-os `build-spec` (it bundles implement). Run the
sub-phases so implementation is the only unattended step.

**Spec authoring/build order:** 1 → 2 → 6 → 3 → 4 → 5 (later specs reference earlier entities/contracts).

---

## Existing-code anchors (from investigation — reuse, don't reinvent)

- **Libraries:** `libraries` table — `name` = `group:artifact` (Maven) / full pkg (npm); **NO version column**. Resolved
  version lives on the edge `code_unit_dependencies.declared_version` / `declared_version_range` / `scope`. A library
  element is an `ApplicationPoint` (`kind='LIBRARY'`, `target_ref_id`→library). Discovery populates via
  `MavenDependencyResolver` + `mavenPomMetadataParser` (properties incl. `maven.compiler.*`, parent/Spring version,
  plugins, dependencyManagement, `${...}` resolution) + `NpmDependencyResolver`. **No Gradle parser** (out of scope — pom + package.json only).
- **Findings spine:** `discovery_findings` (free-text `finding_type`/`category`/`severity` info..critical, `detail_json`,
  polymorphic `discovery_finding_links` `target_type='architecture_element'`, review lifecycle). A `security` category
  already exists (auth/filters); `risky_dependency` heuristic (`riskyDependencyRules.ts`) exists with CVE *prose* only.
  **No structured CVE/CWE/CVSS/advisory store anywhere.** Migration Discovery Context aggregates findings by
  category/severity; `findingsCoverage.ts` is the existing before/after "addressed/not-addressed" pattern.
- **Current→Target:** `architectures.kind` (`current`|`target`), `draft_state` (`active`|`draft`). Target created via
  deterministic Suggest / seed clone / selective copy → writes `architecture_element_mappings`
  (`equivalent`/`renamed`/`replaced_by`/`split`/`merged`/`manual_review_required`). Libraries clone 1:1 (`equivalent`).
  Diff surface = `TargetArchitectureCompareView.tsx` (pairs current↔target by mapping; decommissioned/brand-new chips) —
  the natural home for the reduction panel.
- **Conversation:** `questionLibrary.ts` — 51 questions, groups A–J. Captured decisions in
  `target_state_captured_decisions` (`answer_value TEXT`, append-only supersession; JSON `{value,sourceQuote,sourceFile}`
  envelope convention). **Reuse seam:** `openTurnTechStackPrefill.ts` already LLM-extracts decision codes from a file and
  writes captured-decision rows — a manifest auto-answerer is its deterministic sibling. Decisions feed the Migration
  Delivery Plan + per-story shape-spec generation; conversation close writes `target-tech-stack-<id>.md`.
- **IVS (`implement-verify-service`):** the spec→code→verify→deploy engine (writes/commits/pushes/PRs, deploys haibox,
  CI-webhook verify + reconcile + bug-fix). Reads pom/gradle/package.json as **analysis inputs only** (no upgrading, no
  build-file editing, no SBOM). **Zero CVE/SCA/advisory features.** **No "seed a file" input.** Migration loop entry =
  `POST /api/v2/jobs/orchestrations`.
- **Persistence:** AMS (Spring Boot, snake_case wire by default; `@CamelCaseWire` for camelCase consumers).
- **Build-safety memory:** the whole-repo frontend tsc/lint baseline is RED → verify features in ISOLATION. Implementer
  subagents have Write (not Edit) → mandate anchored/surgical Bash edits + post-run `git diff --stat` / symbol-survival /
  mojibake checks. Bake this into every `tasks.md`.

---

## Spec 1 — Vulnerability store + manual capture + current-state view

- New **dedicated, queryable** `vulnerabilities` entity (AMS): cve_id, cwe, title, details, severity, cvss?, affected
  coordinate (group:artifact / pkg), affected version/range, **fixed_in_versions[]**, source (`internal_report` | tool
  name | `automated`), raw row, project_id, architecture_id, ingested_at.
- **Ingest formats: CSV, XLSX & JSON.** Parsing is **LLM-flexible** — the LLM either reads the report in its entirety OR
  judges which key columns are where, after which extraction is deterministic. (XLSX needs an extraction-to-rows step.)
- Internal reports **usually do NOT carry fixed-in/affected versions** → `fixed_in` comes from OSV (Spec 2).
- **Dedup per (CVE × coordinate)**; keep raw rows for drill-down.
- Match captured CVEs to current libraries by **coordinate + the resolved edge version** (`code_unit_dependencies.declared_version`).
  Report rows whose coordinate isn't in the scanned graph → keep + flag **"unmatched/orphan"**.
- Re-upload for the same architecture → **replace latest, keep prior reports as history**.
- Severity **normalized to the existing info..critical ladder**, raw value preserved.
- **UI:** a **new top-level "Security" tab** with the full report table (mirrors the user's screenshot) + severity
  roll-ups + grouping by library. (Reduction panel lives in the Compare view — Spec 4.)

## Spec 2 — Automated enrichment (OSV / advisory feed)

- Source = **OSV.dev online, through the corporate proxy** → OSV client MUST honor standard `HTTP(S)_PROXY` (and likely a
  custom CA). Architected **swappable** for an offline mirror later.
- **Transitive** dependency coverage (full graph, depth-cap 5).
- Runs **on-demand ("Scan for vulnerabilities" button) + automatically after a discovery run** completes.
- **Built in the first pass** — it's the primary source of `fixed_in` that steering needs.
- **STRICTLY NON-BLOCKING / ADDITIVE (hard requirement):** if OSV/proxy is unavailable, the workflow continues
  uninterrupted on the internal report alone; show a quiet "automated enrichment unavailable" note; CVEs whose fix
  version can't be determined show as **"remaining — fix version unknown."** OSV NEVER gates the run.
- Reconcile/dedup automated records against manual (same CVE+coordinate); badge source. Refresh capability (advisories
  change over time). Headline reduction is driven by the **internal report when present**, automated shown as an
  additional badged set.

## Spec 3 — Target dependency-manifest upload + auto-answer

- Files: **pom.xml + package.json only** (no Gradle in v1). Reuse the discovery Maven/npm resolvers + `mavenPomMetadataParser`.
- Auto-answer the **dependency-answerable subset** of the architect-conversation decisions via the proven tech-stack-prefill
  `{value,sourceQuote,sourceFile}` envelope (deterministic sibling of `openTurnTechStackPrefill.ts`).
- **Version resolution:** resolve Maven parent/BOM-managed versions where feasible + accept an optional `package-lock.json`
  for exact npm versions; anything still unresolved is marked **"version-unknown"** so steering degrades gracefully (no guessing).
- **Multiple manifests** allowed, each tagged to its target module/service.
- **Manual answer always wins; everything editable**, shown with source provenance.
- **Re-upload supersedes manifest-derived answers, preserves manual edits, and recomputes the delta** (the iterate loop).
- The manifest's resolved versions become the structured **target-version source** for Spec 4.

## Spec 4 — Vulnerability reduction + steering

- Compute per current CVE: **eliminated / remaining / newly-introduced**, from current vulns + target versions (manifest +
  manual answers) + decommission/replace mappings, via per-ecosystem version-range comparison against affected-range + `fixed_in`.
- **Also scan the TARGET versions through OSV** so newly-introduced CVEs are caught (degrade to eliminated/remaining only
  if OSV is off).
- **Steering:** steer on **all severities**; **hard-gate criticals** at the "proceed" step (overridable with justification,
  reusing the existing coverage-override pattern). During the conversation the steer is an **inline, non-blocking nudge**
  with the recommended minimum fixed version + a **one-click "use this version"** that updates the answer/manifest and recomputes.
- **No-known-fix CVEs** → **"remaining — no fix available"** (cannot claim elimination; needs replace/remove).
- A CVE affecting multiple coordinates is **eliminated only when ALL affected coordinates are addressed** (show partial progress).
- **Estimated nature labelled explicitly** in the UI (predictive, not a guarantee).
- **UI:** reduction panel in `TargetArchitectureCompareView`; an **"estimated reduction" close summary at conversation end
  + a persistent, revisitable panel that recomputes on re-upload**; the Spec 1 report table gains a **"target status" column**
  once a target exists; roll-up into the Migration Discovery Context.

## Spec 5 — Confirmed manifest → target codebase artifact

- On conversation confirmation, write the dependency **declarations VERBATIM** (honor the curated versions; implementation
  may add scaffolding around them but must not change declared deps/versions).
- **Mechanism: inject the manifest into an early spec's requirements as a "write this exact file" instruction — NO IVS
  change for v1.** (Longer-term option: a real IVS "seed files" input.)
- **Lock the seeded build file as authoritative**; instruct the implementation to build around it, never regenerate/replace
  it. Per-module placement by service mapping.
- **Committed at implementation start**, riding the normal IVS build/PR flow.
- **HOW (locked 2026-06-24):** **Host** = a dedicated **"seed build files" story sequenced FIRST** (before other
  implementation) carries the write instruction. **Carriage** = the **full manifest embedded as a "write this exact
  file" block** (authoritative starting file; scaffolding may be added around it, declared deps/versions must NOT
  change). **Destination path** = resolved from the **target service→module mapping** (Spec 3 per-manifest service tag +
  target architecture layout); default **per-service module directories in a monorepo** (per-repo root if multi-repo);
  the service mapping is the source of truth.

## Spec 6 — Target-conversation tech-stack constraints + versioned selection

- **Deliverable: a per-question dependency matrix** over the 51 questions, classifying each as **hard-dependent on the
  foundational answer / independent / grey**. Independent bucket (cutover, auth policy, rate limiting, secrets, ...) stays
  constant; hard-dependent (framework, libraries, build tool, drivers, versions) branches; grey gets soft handling.
- **Branching:** `service.language` is the **primary brancher** (Java/Kotlin vs Node/TS vs Python ...); build tool +
  runtime refine. Multiple deterministic branch-lists keyed on the foundational answer(s). Example: Java 21 ⇒ framework
  question offers only JVM frameworks (Spring Boot/Quarkus/Micronaut), never FastAPI/NestJS.
- **Grey area handling:** **deterministic compatibility matrix for clear-cut cases + LLM-judge for the grey** (code
  pre-filter + LLM, same pattern as vuln dedup).
- **Choice filtering strictness:** **hide incompatible choices + an "Other (advanced)" escape hatch** (never trap the user).
  Skip questions that have become moot.
- **Version axis decoupled from framework (fixes chip explosion):** framework = constrained single-select (≤6 chips);
  **version = its own dedicated control** (dropdown/typeahead scoped to the chosen framework, recommended default
  pre-selected, free-text exact for off-list). Captured as a structured `{framework, version}`; the conversation shows ONE
  resolved chip (e.g. `Spring Boot 3.4.1`) — never framework×version chips.
- **Version source:** **free-text + recommended default + optional registry/OSV enrichment** (Maven Central / npm registry
  / OSV); enrichment is **non-blocking** (same proxy/egress caveat as OSV — degrades gracefully).
- This version control is THE surface where Spec 4 steering + "use recommended version" live. Note: today's `cascades` map
  only *seeds* answers; this spec adds the *filtering/constraint* layer it lacks.
- **Matrix fix (2026-06-24):** `db.engine` and `ui.framework` are freely-chosen branchers → **Independent**, NOT
  hard-dependent on `service.language` (they drive their group but aren't narrowed by anything). Tally → **15 H / 9 G / 27 I**.
- **FR9 — API like-for-like lock (added 2026-06-24):** a migration mode `api.surfaceMode` (`like_for_like` | `may_change`),
  defaulting to `like_for_like` when a reconciled API Behaviour Baseline / oracle exists. Under `like_for_like` the WHOLE of
  Group B is **auto-answered + locked from the source contract/baseline** (new treatment class **`L`**, read-only,
  provenance to source) and NOT asked; `may_change` reverts to H/I/G. Rationale: API like-for-like / reconciliation forbids
  API-surface deviation. Open for later review (NOT yet applied): `db.connectionPool` is really language-driven not
  engine-driven; `db.transactionStrategy`/`db.readReplicaUsage` may be Grey on `db.engine`.

---

## Cross-cutting decisions
- Vuln data persisted in **AMS** (new tables), wired through the gateway like the other migration data.
- All external calls (OSV, version registries) are **non-blocking** and **proxy/CA-aware**; the feature is fully usable on
  the internal report alone.
- Reuse existing seams: `TargetArchitectureCompareView`, `findingsCoverage.ts` before/after pattern, Migration Discovery
  Context roll-ups, the discovery dependency parsers, the tech-stack-prefill envelope.
- Reduction is always **labelled an estimate**.

## Build-safety guidance to bake into every `tasks.md` (for the unattended overnight `implement-tasks`)
- The whole-repo frontend tsc/lint baseline is RED — **verify each feature in ISOLATION** (targeted vitest/jest + scoped
  tsc on changed files), never gate on whole-repo green.
- Implementer subagents have Write (not Edit) — use **anchored/surgical edits**; after each, run `git diff --stat`,
  symbol-survival greps, and a mojibake/NUL scan on touched files.
- AMS DTOs default to snake_case wire; apply `@CamelCaseWire` only for camelCase consumers.
- No silent caps/sampling — log anything dropped.
