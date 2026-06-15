# Polyrepo Support — Analysis (not a spec)

Status: analysis only. No design decisions locked. No implementation plan.

## Why this document exists

Standards-extractor currently assumes one project = one repo (`PROJECT_DIR`). We need to understand what changes when a "product" spans multiple independent repositories, before drafting any spec.

This document captures the analysis to date so the conversation has a single artifact to argue against.

## Cross-validation target

Polyrepo pair cloned for grounding the discussion:

| Alias | Repo | Stack | Path |
| --- | --- | --- | --- |
| backend | spring-petclinic/spring-petclinic-rest | Java, Spring Boot, OpenAPI codegen | `.specforge/repos/spring-petclinic/spring-petclinic-rest` |
| frontend | spring-petclinic/spring-petclinic-vue | Vue 3, TypeScript, axios wrapper | `.specforge/repos/spring-petclinic/spring-petclinic-vue` |

Chosen for:
- Same domain we already have a single-repo baseline for (`2026-05-18-owner-visits-endpoint`).
- Cross-language pair (Java ↔ TypeScript) — stresses contract integrity.
- Small clones (~3 MB total).

### Surface findings from the pair

Backend (`spring-petclinic-rest`):
- Controllers `implement` generated interfaces (`OwnersApi`, `V2Api`).
- HTTP routes live in `src/main/resources/openapi.yml`, not in `@GetMapping` annotations.
- 36 endpoints declared in OpenAPI; 16 schemas.
- Implication: an endpoint discoverer that scans annotations would miss every route. Discovery must detect the codegen pattern and read `openapi.yml` directly.

Frontend (`spring-petclinic-vue`):
- All HTTP traffic goes through `src/services/api.js` — a single object with ~30 methods.
- 28 call sites across 13 views call `api.<method>(args)`; zero raw axios calls.
- Implication: an interaction discoverer that regex-matches `axios.<verb>(...)` would find nothing. It must locate the wrapper module, build a symbol table (`getOwnerById → GET /owners/{id}`), and resolve call sites through it.

Aggregate: 30 frontend methods, all resolve to backend endpoints. 6 endpoints on the backend have no frontend consumer (`/oops`, `/users` POST, `/v2/owners`, ...).

## Current behaviour (single-repo)

What the app actually does today, verified from code:

- Orchestrator (`src/haikai_orchestrator.py`) runs a fixed chain: `/write-spec` → `/create-tasks` → `/implement-tasks` → `/git-commit-preparation`. No discovery step in the chain. Implements without human gate between phases ("`Implement ALL task groups without asking for confirmation.`", line 355).
- `write-spec` workflow (`haikai-profiles/default/workflows/specification/write-spec.md`): freeform search of `PROJECT_DIR` by the spec-writer agent. It does *not* query the structural store or any discoverer output. Output is a strict-template `spec.md` (≤10 requirements, ≤5 reusable-code refs, ≤10 out-of-scope).
- `create-tasks` emits task groups with `Dependencies: Task Group N`, scoped to one repo.
- Discovery layer (`src/ast/endpoint_discoverer.py`, `interaction_discoverer.py`, `metamodel_engine.py`, structural store) is real and exposed under `/api/v1/discovery/*` and `/api/dep/*` — but it is a separate REST surface, not part of the spec/tasks/implement pipeline.
- Standards are a single global set, injected via `{{standards/*}}` at command time.
- `PROJECT_DIR` is a single path. The whole pipeline assumes one tree.

## What works in monorepo today — and why

Cross-checking the polyrepo-failure list against the actual single-repo behaviour:

### Genuinely handled by the app

- Stack/framework detection — `framework_detector.py` + manifest reads, per run.
- Layer ordering inside one repo — `create-tasks` emits `Dependencies:` between groups.

### Handled implicitly by the monorepo, not the app

- Data shape mismatch — caught by the compiler + the final-verification phase running the full test suite. Single-language, single-build means contract drift surfaces as compile or test failure.
- Standards — one stack, one `standards/*` set, injected globally.
- Freeform write-spec search — works because one tree fits in one search.
- Single HEAD — staleness is not a concept; everything is taken against one revision.

### Not handled at all, even today

- Boundary violations (one module writing to another's owned table).
- Dead surface (endpoint with no caller anywhere in the product).
- Unplanned coupling (new internal dependency introduced silently).
- Empirical-neighbourhood anchoring for "where should this code go" — currently freeform.
- Cross-language contract integrity — n/a in current scope.

## What polyrepo changes

Polyrepo doesn't add ten new capabilities to build. It does two things:

1. **Removes the monorepo's implicit guarantees.** The four items in "handled implicitly" stop being handled, because:
   - Different languages → no shared compiler → contract drift silent.
   - Separate test suites → "run all tests" no longer crosses repos.
   - N trees → freeform search blows up or hallucinates across repos.
   - Different stacks → one global `standards/*` set is wrong for at least one repo.
   - N HEADs → staleness becomes a real concept.

2. **Exposes the pre-existing gaps** ("not handled at all" above) by removing the safety net of compile-and-test catching them at the end.

## Coordination.yaml — the simple core

The simplest declaration that lets the system know it is dealing with a polyrepo:

```yaml
product: petclinic
repos:
  - alias: backend
    role: api
    git: https://github.com/spring-petclinic/spring-petclinic-rest
    path: .specforge/repos/spring-petclinic/spring-petclinic-rest
  - alias: frontend
    role: web
    git: https://github.com/spring-petclinic/spring-petclinic-vue
    path: .specforge/repos/spring-petclinic/spring-petclinic-vue
```

One file. One owner (human). One purpose (product → N repos). Lives at `.specforge/products/<product>/coordination.yaml`.

This file alone gives the system enough to clone, isolate per-repo work, and route artifacts. Everything else (contracts, ordering, ownership, dead-surface detection) is a layer above it.

### What does *not* work with only this file

(Same list as the polyrepo-changes section, restated as capability statements rather than mechanism statements.)

- The system cannot write a spec that spans repos: it has no shared picture of "what already exists where."
- "Where should this new code go" gets no answer beyond freeform search per repo.
- Backend and frontend disagreeing on a data shape ships without warning (no shared compiler, no joined contract).
- One repo writing to another's owned table is invisible.
- Endpoints with no consumer in the product look fine.
- Cross-repo ordering of implementation (which repo first?) is undefined.
- Coding standards default to one global set; polyglot products mis-apply them.
- Unplanned cross-repo coupling shows up in no diff.
- Repo A changes; planning for repo B works off the snapshot it was started with.

Net: single-repo features still work fine. What breaks is exactly the set of things that make polyrepo worth more than N independent single-repo setups.

## The shared markdown (`multi_repos_2_options.md`)

Provided by Ozzie for comparison. Describes S1/S2 patterns for routing commits from an implementing service that generates sub-folders within a single project tree, to N external repos. Reproduced verbatim alongside this analysis.

### Gaps in that MD against this polyrepo discussion

(What the MD does not address that our polyrepo problem needs.)

1. Wrong identity model. MD = one project with generated sub-folders inside, route at commit time. Ours = N pre-existing independent repos declared up front via `coordination.yaml`. MD has no product→N-repos concept.
2. No discovery layer. MD stores routing only; no per-repo endpoint/interaction/query discovery.
3. No joiner / derived graph. MD has no cross-repo edges (`http_contract`, `db_ownership`, `async_topic`, `shared_package`).
4. No per-repo profile. MD doesn't detect stack/framework per repo, so discoverer dispatch (annotation vs codegen vs wrapper) has no analogue.
5. No write-spec / `paths_touched`. MD assumes the implementing service already generated the folders; the planning question is sidestepped.
6. No verifier. MD commits and exits; no post-implement path discipline, contract integrity, ownership integrity, or graph drift.
7. No orchestration ordering. MD does not address "backend first or frontend first?" / dependency edges.
8. No brownfield assumption. MD presupposes a generator created the sub-folders; we have N pre-existing brownfield repos.
9. Different commit topology. MD = single working dir, route diffs at push time. Ours = each repo cloned independently; commit destination is implicit.

### Gaps in this polyrepo discussion against the MD

(What the MD addresses that this analysis does not yet.)

1. Editability flow. MD has explicit modal load → user edits → modal save. We assume `coordination.yaml` is hand-written once.
2. Contract boundary. MD specifies GET/POST endpoints with request/response bodies. We have a file on disk and no API.
3. Cross-system ownership articulation. MD names which subsystem owns which fact and warns about cross-coupling. We have not stated who owns what.
4. Read-only vs editable fields. MD splits modal columns (read-only `sub_folder`, editable `git_repo`). Our YAMLs do not annotate human-editable vs derived fields.
5. Partial/null semantics. MD handles per-row fallback explicitly. We do not address partial declarations or unreachable repos.
6. Persistence & versioning. MD implies DB storage with mutation endpoints. Ours is a flat file with no versioning or concurrency control.
7. Cross-system data flow. MD draws read patterns across two systems. We have not modelled how discoverer output, joiner, and write-spec read each other.
8. Fallback as a first-class concept. MD makes it a design decision; ours implies it but never names it.
9. Side-effects-of-edit analysis. MD's S1 vs S2 is built around "what breaks when you mutate X." We have not done this for any of our YAML fields.
10. Naming discipline. MD pins every endpoint, field, and table name. Our YAML names emerged in conversation and are not pinned.

### Overlap

Both documents converge on one principle: single-purpose file, single owner, no cross-coupling between concerns. MD's S2 and our `coordination.yaml` are the same shape applied to different problems (routing vs declaration). The MD is engineered as a system-boundary design; this analysis is engineered as a data-model design. The two are complementary, not substitutes.

## Open questions

These are *not* implementation choices to make in this analysis. They are the questions a future spec will need to answer.

1. Where does `paths_touched` get reviewed when orchestration is non-interactive end-to-end?
2. How and when does `write-spec` query the discovery store, given today's workflow does freeform search of `PROJECT_DIR`?
3. Are there two operating modes (auto-trust-and-verify vs split-orchestration-with-review), and if so where does the split live?
4. Does `coordination.yaml` live in a meta-repo, in a designated primary repo, or in `.specforge/`?
5. What is the per-repo `repo_profile.yaml` populated with, and is it populated from cheap detection or LLM judgment?
6. How is `coordination.derived.yaml` populated, refreshed, and invalidated?
7. Does the verifier run as a separate phase or extend the existing `final-verification` step?
8. Mutation flow for `coordination.yaml` — file edit, CLI, or API?

## Provenance

- Conversation thread: Slack `#standards-extractor`, root message `1779653019.756929`, dates 2026-05-25.
- Cross-validation pair cloned at `.specforge/repos/spring-petclinic/{spring-petclinic-rest,spring-petclinic-vue}`.
- Shared markdown reproduced at `./multi_repos_2_options.md`.
