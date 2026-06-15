# Library Discovery Integration

This is **Spec 3 of 3** in the Library arc. Spec 1 (`agent-os/specs/2026-05-05-library-backend-foundation/`) landed the backend model. Spec 2 (`agent-os/specs/2026-05-06-library-frontend-types-and-tables/`) added the frontend types, tables UI, and ApplicationPoint extension. This spec integrates the Library concept with the discovery service so internal sibling-subfolder libraries are auto-discovered, scanned (transitively, capped), and recorded with their dependency edges.

## Background

Today, "Start Discovery Run" on a Service scans that service's `repo_location` + `repo_subfolder`. Internal libraries referenced in the service's manifest (pom.xml, package.json, etc.) are encountered by the parser but ignored — there's no place to put them.

After Specs 1 and 2, the model can hold them. This spec adds the deterministic resolver that classifies dependencies (internal vs external), builds the transitive scan plan, surfaces a preflight modal so the user sees the plan before committing LLM tokens, and runs the scan with hierarchical progress reporting.

## Goal

Make the discovery service Library-aware:
- Parse the service/library manifest deterministically per ecosystem (Maven, npm for V1).
- Build a repo-wide lookup table to classify each direct dependency as internal (sibling subfolder with matching coordinates) or external (Maven Central / npm registry).
- For internal direct deps, find-or-create a `Library` row, queue it for scan.
- For internal libs, walk transitively (cap depth 5, cycle-detected).
- For external libs, record one-deep only (no drilling into their poms).
- Show a preflight modal with the full plan + an "Include external libraries" toggle, then run the scan with hierarchical progress reporting in the existing run panel.

## Design decisions (locked through prior discussion)

### Resolver architecture

- New `DependencyResolverRegistry` in `discovery-service`, sibling pattern to existing language packs / framework packs.
- Per-ecosystem resolver: `(repoRoot, manifestPath) → DeclaredDependency[]`.
- V1: Maven (`pom.xml`) and npm (`package.json`).
- Phase 2 (out of scope this spec): Gradle, .NET, Go, Python.
- Pure-function deterministic — no LLM. The host orchestrates transitive walks.

### Repo-wide lookup table

- Built once per discovery run from a single repo scan.
- Maven: `(groupId, artifactId) → subfolder` from all `pom.xml` files in the repo.
- npm: `name → subfolder` from all `package.json` files in the repo (including workspaces).
- Lookup table is per-ecosystem (Maven manifests don't resolve against npm names and vice versa).

### Transitive walk

- BFS from the root (Service or Library being scanned).
- For each manifest:
  - For each direct dependency:
    - Classify: internal (in lookup table) or external.
    - For internal: find-or-create Library, add edge, queue for scan if not visited (or depth cap not hit).
    - For external: record Library + edge (one-deep, no drilling), only if "Include external libraries" toggle is ON.
- Visited-set keyed by `Library.id` after find-or-create — prevents re-scanning same library in same run.
- Depth cap: 5. Walk stops at depth 5; deeper deps recorded as edges to "stub" libraries (no further drilling).
- Scope filtering: only `compile`/`runtime` (Maven) / `dependencies` (npm) followed transitively. Test/dev/optional/provided edges recorded but not walked further.

### Preflight modal

- Triggered by user clicking "Start Discovery Run" (or "Start Discovery Run (No Libraries)") on a Service or Library row.
- Runs the deterministic preflight (no LLM, milliseconds).
- Modal contents:
  - **Root**: the service/library being scanned, with `name` + `repo_location`/`repo_subfolder`.
  - **Internal libraries to scan**: list with `name`, repo subfolder, hop depth, status flag (`new`, `re-scan`, `skipped (cycle)`, `skipped (depth cap)`). Ordered by BFS depth.
  - **External libraries to record** (only if "Include external libraries" toggle is ON): list with `name` + declared coordinates, collapsed-by-default if >10.
  - **Warnings**: cycle hits, depth-cap hits, unresolvable internal refs ("`com.example:lib-foo` declared but no matching pom in repo — recording as external").
  - **Toggle**: "Include external libraries" (default ON, persisted in user preferences for this project? or always default ON? — confirm).
- Single "Run" / "Cancel" button. No per-library opt-out V1.

### Right-click menu

- Service rows + Library rows in the Application-domain table both get:
  - `Start Discovery Run` (default with libraries, transitive cap 5).
  - `Start Discovery Run (No Libraries)` (skip dependency walk; current single-service behaviour).

### Scan execution

- After confirmation, the existing discovery scan flow runs per library, hierarchically:
  - Top of progress panel = root Service/Library being scanned.
  - Indented sub-rows = each library being scanned, with same per-step indicators.
  - "Pending libraries" counter at the top decrements as each completes.
  - "Skipped (cycle)" badge when visited-set rejects a re-scan.
- No mid-run abort (matches existing service-scan UX).
- Re-runs re-scan all internal libs (V1; commit_sha-skip is V2 optimization).

### Library find-or-create rules

- Identity = `(model_file_id, name, ecosystem)` per Spec 1 + 2.
- Find: query existing rows by name + ecosystem within the model file.
- Create: if not found, insert new Library row with `source_origin = 'DISCOVERED'`, `repo_location`/`repo_subfolder` set if internal scannable, `last_verified_at = now()`.
- Update: if found and now scanned, update `last_verified_at`, `core_tech_resolved` (via existing tech-hints flow), etc.

### Edge find-or-create rules

- For each dependency declaration, find-or-create a `code_unit_dependencies` row keyed by `(source_application_point_id, target_application_point_id, declared_name, declared_version)`.
- Multiple declarations of the same (source, target) with different versions become multiple edges.
- ApplicationPoints are derived find-or-create on Service / Library row reference (Spec 2's `applicationPointDerivation` extension already handles this).

### LLM tech-hints flow on Library

- When a Library is scanned, its `core_tech` is resolved through the same LLM tech-hints flow that Service uses.
- Spec 2's typing relaxation made `tech_hints_cell` work for Library rows in the frontend. The backend resolver path is row-id-keyed and works for any entity with the 5 tech-hints columns.
- The discovery service writes `core_tech` (raw text) and the resolver fills in the resolved columns.

### Right-click menu placement / wiring

- Frontend: extend the existing service-row right-click menu (or table-row-context-menu) with the 2 new items. Library rows in Spec 2's new Libraries tab get the same 2 items.
- Backend: existing `/api/discovery/...` endpoints remain. New endpoint or extended endpoint for the preflight (returns plan only) vs the scan (executes plan).

### Tests

- Unit tests for each ecosystem resolver (Maven, npm) with fixture repos.
- Unit tests for the repo-wide lookup table builder.
- Unit tests for the transitive walker (BFS, cycle detection, depth cap, scope filtering).
- 1 integration test for the preflight endpoint with a mocked repo.
- 1 integration test for the scan with libraries against a fixture repo.

## Out of scope

- Phase 2 ecosystems: Gradle, .NET, Go, Python.
- Per-library opt-out in the preflight modal (UI complexity; V1.1 if needed).
- Mid-run abort.
- Commit_sha-based skip-unchanged optimization for re-runs.
- Live cloud / repository inventory.
- Test/dev/optional scope transitive walk (recorded as edges but not followed).
- Library-rooted runs that pre-resolve the entire repo dependency graph and offer a "scan everything reachable" option.
- LLM-assisted dep classification (deterministic only V1).

## Acceptance criteria

- "Start Discovery Run" right-click menu item exists on Service rows AND Library rows; both produce a preflight modal.
- "Start Discovery Run (No Libraries)" right-click menu item exists on the same rows; bypasses preflight, scans only the root.
- Preflight modal shows root + internal libs (with depth, status) + external libs (toggle-controlled) + warnings.
- "Include external libraries" toggle defaults ON inside the modal.
- Run button executes the deterministic plan: internal libs scanned transitively (BFS, cap 5, cycle-detected), external libs recorded one-deep (no drilling) only if toggle was ON.
- Library rows are find-or-create on `(model_file_id, name, ecosystem)`; transient duplicates resolved by resolver.
- `code_unit_dependencies` edges find-or-create on `(source AP, target AP, declared_name, declared_version)`.
- Maven and npm resolvers cover their respective manifests; tests cover fixture pom.xml and package.json files.
- Existing single-service scan behaviour (no libraries) remains as the `(No Libraries)` path; no regression.
- Library-rooted runs work (right-click on Library row → preflight against that library's manifest if internal scannable).
- LLM tech-hints flow runs for Library rows the same as Service rows.
- Hierarchical progress UI in the existing run panel: root + indented library sub-rows + pending counter.
- Re-runs re-scan all internal libs (V1).
- No mid-run abort.
- Phase 2 ecosystems (Gradle, .NET, Go, Python) are out of scope.

### Backend integration requirements

- New `DependencyResolverRegistry` module in `discovery-service`.
- 2 new resolvers: `MavenDependencyResolver`, `NpmDependencyResolver`.
- New repo-wide lookup table builder.
- New transitive walker with BFS, visited-set, depth cap, cycle detection, scope filtering.
- New preflight endpoint (or extension to existing scan endpoint with a "preflight=true" mode that skips the LLM phase).
- Library and CodeUnitDependency creation calls (writes via the architecture-model-service API extended in Spec 1).
- Hierarchical progress events (existing run-progress mechanism extended with library sub-step events).

### Frontend integration requirements

- 2 right-click menu items on Service rows + Library rows.
- New PreflightModal component.
- Existing run-progress panel extended to render library sub-rows hierarchically.
- "Include external libraries" toggle inside modal (state local to the modal session).

### No changes to (out of scope)

- Architecture-model-service entity tables (Spec 1 covered).
- Frontend gridConfigs / TS types beyond the right-click menu wiring (Spec 2 covered).
- Gateway / MCP code.
- Other Phase 2 ecosystems.
