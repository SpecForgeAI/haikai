# Spec Requirements: Infrastructure Terraform Import (GCP)

> Status: V1 contract locked. All 12 clarifying-question defaults confirmed by the user. No visual assets provided. The spec-writer should treat this document as authoritative and self-contained — do not re-derive the decisions below.

## Initial Description

Add Terraform import support for the Infrastructure Architecture domain.

The tool's sixth Architecture domain (Infrastructure) already has: backend model foundation, API/persistence integration, frontend types/model integration, table UI, diagram support, cross-domain integration, Terraform/discovery readiness metadata (`IaCSource`, `IaCResourceBinding`, provenance, readiness/hints), and Terraform **export** support. This spec adds the inverse: import Terraform files into reviewable Infrastructure candidates, **without** mutating the approved model unless the user explicitly approves.

Goal: allow users to upload `.tf` files or a Terraform ZIP and generate reviewable Infrastructure Architecture candidates, starting with GCP provider mappings, while keeping the design extensible for other providers later.

Provider scope:
- Build a provider-neutral import framework.
- Implement GCP Terraform resource classification first.
- Unsupported providers / resource types are preserved as evidence/TODO candidates rather than failing.
- The Infrastructure domain itself is NOT hard-coded to GCP.

(Full raw idea retained verbatim at `planning/raw-idea.md`.)

## Requirements Discussion

### First Round Questions

**Q1: HCL parser choice**
- **Answer: (b)** Hand-rolled tolerant subset HCL parser. Scope: top-level `resource`, `module`, `variable`, `output`, `locals`, `provider` blocks; literal string / number / bool / list / map values; simple `var.x` and `<resource>.<name>.<attr>` references. Unsupported expressions are preserved verbatim as raw strings on the candidate (NOT thrown away). Zero new Maven deps. Line tracking required so `IaCResourceBinding.start_line` / `end_line` are accurate.

**Q2: Candidate persistence model**
- **Answer: (b)** Transient single round-trip. Backend parses + classifies + returns the entire candidate review payload in the response. Frontend holds it in React state. Approving into the model is a separate, explicit user action (a follow-up save/apply call). No new DB tables for the import run itself. If the user closes the tab mid-review, no model mutation has occurred — they only lose the staged review payload.

**Q3: Where in the UI**
- **Answer: (a)** FileMenu placement, parallel to the existing "Export Infrastructure as Terraform..." entry. Same group, same enablement gate (model loaded AND at least one Environment exists). One new menu prop + one new modal. Visual symmetry with the export entry is intentional.

**Q4: Multi-file / ZIP semantics**
- **Answer: (a)** Whole-ZIP-is-one-IaCSource. Every `.tf` file inside the ZIP is parsed; every resource block becomes a candidate. `file_path` on each binding is recorded relative to the ZIP root (e.g. `modules/network/main.tf`). One proposed `IaCSource` carries all bindings. Local module references (`source = "./modules/network"`) are followed when those files exist in the upload payload. Remote module references (`source = "git::..."`, `source = "registry.terraform.io/..."`) trigger a soft-warn TODO — do not attempt to fetch them.

**Q5: Variable / locals / module expansion — V1 cut**
- **Answer: (c)** Best-effort one-hop resolution. Resolve in priority order:
  1. User-supplied import options (e.g. user typed `region = europe-west1` in the modal)
  2. Variable defaults (`variable "region" { default = "europe-west1" }`)
  3. Simple locals (`locals { region = "europe-west1" }`)
- No `for_each`, no `count`, no template strings (`"${...}"` with logic), no functions. Anything beyond one hop, or any expression involving the unsupported constructs above, is preserved verbatim as raw evidence on the candidate plus a TODO warning.
- Module bodies referenced by `module "x" { source = "./..." }` ARE parsed when their HCL files are present in the upload payload — their resources land as separate candidates with `file_path` pointing at the module HCL — but parameter substitution into module variables is NOT performed in V1. A comment trail notes the calling module name.

**Q6: Deterministic matching — tie-breaker on edited fields**
- **Answer: (b) with field-level qualification.** When a binding's `iac_address` matches an existing `IaCResourceBinding` AND user has manually edited fields since the last import:
  - **User-edited wins** for `name` and `description` (human-curated labels).
  - **Imported wins** for technical fields: CIDR, region, engine, type, provider_resource_type, and similar derived facts.
- The candidate review UI surfaces ALL diverging fields side-by-side (left = current model, right = imported), but the proposed update only mutates the non-name/description fields by default. The user can still override the per-field default via the candidate review (this is the default proposal, not a hard lock).
- NB: with the V1 read-only summary table (Q11=b), per-field override capability collapses to "Approve all" / "Discard all" — but the diff is still shown for transparency. Per-field override returns when the full review modal lands in a follow-up spec.

**Q7: Approval granularity + ignore semantics**
- **Answer: per-individual-candidate approve/ignore + soft-hide-this-run-only**, BUT collapsed to the V1 read-only summary form because of Q11=b. Concretely:
  - V1 ships with "Approve all" / "Discard all" only (no per-row controls in the modal).
  - The candidate payload returned by the backend ALREADY carries per-candidate identity + ignore-state plumbing in its shape (so the follow-up spec wiring per-row controls is purely UI work, not a payload-shape change).
  - Ignore semantics are soft-hide-from-this-run-only. No new "rejected" persistence table in V1. Future imports of the same `iac_address` will re-propose unless the user has approved/merged in the meantime.

**Q8: Confidence scoring — bucket vs numeric**
- **Answer: (a)** Three fixed buckets — HIGH (0.90) / MEDIUM (0.60) / LOW (0.30). Stored as DECIMAL(4,3) to match the existing `IaCResourceBinding.confidence` column from the readiness spec, but only ever takes one of three values in V1.
- Bucket assignment rule:
  - **HIGH (0.90):** resource type is in the GCP mapping table AND zero unresolved variable references AND environment / region inferred-or-user-provided.
  - **MEDIUM (0.60):** resource type is in the GCP mapping table BUT some references unresolved OR env/region not inferred.
  - **LOW (0.30):** resource type unknown OR partial mapping (e.g. LB composite missing pieces).

**Q9: LB composite handling — V1 mandatory or optional**
- **Answer: (c)** Try composite grouping; fall back to per-component candidates with a warning when pieces are missing. The export-spec dual already locks the composite shape (5 GCP resources mapped to one `LoadBalancer` + one `Listener`); the importer inverts that canonical shape:
  - On success: emit one `LoadBalancer` candidate + one `Listener` candidate, with all 5 component bindings linked to the LoadBalancer entity.
  - On partial: emit per-component infrastructure-resource-style candidates, each with a TODO warning ("this looks like part of a composite LB; consider creating a parent LoadBalancer entity manually") + one top-level "unrecognised-LB-pattern" warning on the import result.

**Q10: Tests — round-trip golden fixture**
- **Answer: (c)** BOTH:
  - **Forward fixture:** new test (e.g. `TerraformImportForwardFixtureTest`) takes a hand-written `src/test/resources/terraform-import/input.tf` covering raw HCL with comments, unresolved variables, unsupported resource types, and partial LB pieces — asserts the candidate JSON byte-equal against a committed `expected-candidates.json`. Exercises warning paths the export wouldn't naturally produce.
  - **Round-trip fixture:** new test (e.g. `TerraformImportRoundTripTest`) feeds the EXPORT spec's golden `expected/main.tf` (+ `variables.tf`, `outputs.tf`) into the importer and asserts the resulting candidate set, when approved, would re-produce the same Infrastructure entities the export started from. The round-trip uses the export's golden files (NOT a separately maintained import fixture) so the two specs stay in sync. Pins export ↔ import contract symmetry: same `iac_address` values come back in the bindings, same entity names, same field values.

**Q11: Frontend review UI — full vs deferred**
- **Answer: (b)** V1 read-only summary table + single "Approve all" / "Discard all" buttons. Modal columns: entity type, name, source `file:line`, confidence bucket, warnings count. Evidence drill-down (raw HCL snippet) is shown inline as collapsible rows where useful but no per-row approve/ignore in V1. Per-candidate controls return in a follow-up spec when persistent import-runs (Q2-style) land.

**Q12: LLM enrichment — V1 deterministic-only or behind a flag**
- **Answer: (a)** V1 deterministic-only. No LLM at all in the V1 import path. No feature flag. Matches the export spec's "no LLM-based generation, hand-rolled emitters only" stance. LLM hooks (naming cleanup, ambiguous-LB grouping, unsupported-resource explanations) are deferred to a follow-up spec when the deterministic baseline is locked.

### Existing Code to Reference

**Symmetric pair to the export package**
- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/`
- New sibling package: `architecture-model-service/src/main/java/com/example/architecturemodel/service/import/terraform/`
- Mirrored shapes:
  - `TerraformImporter` strategy interface (mirrors `TerraformExporter`)
  - `GcpTerraformImporter` impl (mirrors `GcpTerraformExporter`)
  - `TerraformImportContext` (mirrors `TerraformContext`)
  - `TerraformImportService` (mirrors `TerraformExportService`)

**Controller pattern**
- Verbatim template: `InfrastructureTerraformExportController`
- New file: `InfrastructureTerraformImportController` (NOT folded into `ModelController`)
- Endpoint: scoped by `projectId` and `architectureId`, `POST` with `multipart/form-data` for the file upload, returns the candidate review payload as JSON.

**Frontend modal pattern**
- Verbatim template: `frontend/src/components/Export/InfrastructureTerraformExportModal.tsx` (and its `.module.css`)
- New file: `frontend/src/components/Import/InfrastructureTerraformImportModal.tsx` (and its `.module.css`)
- Provider dropdown reuses `iacSourceProviderOptions` from `defaults.ts:1321` — DO NOT redeclare.

**FileMenu wiring pattern**
- Verbatim template: existing `onExportInfrastructureTerraform` / `exportInfrastructureTerraformDisabled` props in `FileMenu.tsx`
- New props: `onImportInfrastructureTerraform` / `importInfrastructureTerraformDisabled`
- New menu entry: "Import Infrastructure from Terraform..." parallel to the export entry.

**API helper pattern**
- Verbatim template: `modelApi.exportInfrastructureTerraform(...)`
- New helper: `modelApi.importInfrastructureTerraform(projectId, architectureId, formData)` — `POST` with `multipart/form-data`.

**Mapping table — REVERSE the export mapping**
- Source of truth: `GcpTerraformExporter` + the export spec's `spec.md` mapping table.
- The importer must invert each mapping. See "GCP Reverse-Mapping Table" below.

**`IaCSource` + `IaCResourceBinding` entity shapes**
- Already landed by the discovery-readiness spec (`2026-05-05-infrastructure-terraform-discovery-readiness`).
- Importer creates instances of these.
- `iac_address` must be persisted EXACTLY as parsed (round-trip stability with the export — Q10 round-trip test pins this).

**Provenance fields on Infrastructure entities**
- Fields: `source_origin`, `source_system`, `source_reference`, `last_verified_at`.
- Importer sets:
  - `source_origin = 'IMPORTED'`
  - `source_system = 'terraform-import'`
  - `source_reference = '<iac_address>'`
  - `last_verified_at = <current timestamp>`

**`InfrastructurePoint` polymorphic point pattern**
- `IaCResourceBinding.infrastructure_point_id` resolves to the appropriate Infra entity via the `target_type` discriminator. Importer uses this pattern unchanged.

**`iacSourceProviderOptions` picklist**
- Frontend: `defaults.ts:1321`
- Backend mirror: `TerraformExportService.PROVIDER_OPTIONS`
- Reused as-is by the import modal.

**Discovery-service candidate review pattern (NOT reused in V1)**
- Path: `discovery-service/src/services/runManager.ts`
- Documents the full run row → candidates → evidence → triage → DecisionTask → approve flow.
- V1 does NOT wire to this (Q2 = transient, Q11 = read-only summary). Documented as the canonical target pattern when persistent import-runs land in a follow-up spec.

### Follow-up Questions

None. All 12 clarifying-question defaults were locked by the user in a single round. No visuals provided, no follow-ups required.

## Visual Assets

### Files Provided

Bash check at `agent-os/specs/2026-05-08-infrastructure-terraform-import-gcp/planning/visuals/` returned no visual files.

No visual assets provided.

### Visual Insights

The import modal will mirror the existing export modal (`InfrastructureTerraformExportModal.tsx`) for visual symmetry — this is the spec-shaper's locked default and the user confirmed no deviation. The spec-writer should reference the export modal as the style + layout template; no separate mockup is needed.

## Requirements Summary

### Functional Requirements

**Backend**
- New service package `service/import/terraform/` with:
  - `TerraformImporter` strategy interface (provider-neutral)
  - `GcpTerraformImporter` first impl
  - `TerraformImportContext` carrying parsed HCL, user-supplied import options, and warnings
  - `TerraformImportService` orchestrating parse → classify → match → respond
- Hand-rolled tolerant subset HCL parser supporting:
  - top-level `resource`, `module`, `variable`, `output`, `locals`, `provider` blocks
  - literal string / number / bool / list / map values
  - simple `var.x` and `<resource>.<name>.<attr>` references
  - unsupported expressions preserved verbatim
  - line tracking for `start_line` / `end_line`
- One-hop variable / locals / module-file resolution per Q5.
- GCP resource classification per "GCP Reverse-Mapping Table" below.
- LB composite detection with per-component fallback per Q9.
- Three-bucket confidence scoring per Q8.
- Deterministic matching against existing `IaCResourceBinding` by `iac_address`, with user-edited / imported field-precedence rules per Q6.
- New controller `InfrastructureTerraformImportController` exposing one endpoint scoped by `projectId` + `architectureId`, accepting multipart upload + import options, returning the transient candidate review payload.
- Approve-into-model: a separate explicit endpoint (or the existing model-save flow, spec-writer's call) — V1 only ships "Approve all" or "Discard all" (no per-row approval).

**Frontend**
- New modal `InfrastructureTerraformImportModal.tsx` mirroring the export modal style, with:
  - file/ZIP upload control
  - import options form: Environment (recommended), Cloud Account / Project / Tenant (optional), Location / Site / Region (optional), provider (defaults to GCP via `iacSourceProviderOptions`), IaC Source metadata fields (repository_url, branch, commit_sha, path, workspace) — all optional
  - "Parse" button → calls `modelApi.importInfrastructureTerraform`
  - Read-only summary table (Q11=b): entity type, name, source `file:line`, confidence bucket, warnings count
  - "Approve all" + "Discard all" buttons
  - Warnings panel for unsupported / unresolved items
- New FileMenu entry "Import Infrastructure from Terraform..." with parallel enablement gate (model loaded AND at least one Environment exists).
- New API helper `modelApi.importInfrastructureTerraform(projectId, architectureId, formData)`.

**Approval — what gets created/updated**
- Infrastructure entities (Network, Subnet, ComputeCluster, ComputeResource, DeploymentUnit, LoadBalancer, Listener, DataStoreInstance, InfrastructureResource — per the GCP reverse-mapping table)
- Infrastructure relationships (Resource hosted in Subnet, Deployment Unit runs on Compute, Load Balancer routes to Compute/Resource — only where direct Terraform evidence exists)
- One `IaCSource` per import (whole-ZIP-is-one-IaCSource)
- One `IaCResourceBinding` per Terraform resource block successfully mapped:
  - `iac_address`, `iac_resource_type`, `iac_resource_name`, `provider`, `file_path`, `start_line`, `end_line`, `external_id` (where available), `confidence`
- Provenance metadata on every created/updated entity:
  - `source_origin = 'IMPORTED'`, `source_system = 'terraform-import'`, `source_reference = '<iac_address>'`, `last_verified_at = <now>`
- Terraform readiness/hint fields where useful (existing fields on Infrastructure entities; spec-writer to enumerate from readiness-spec schema)

### GCP Reverse-Mapping Table

Inverse of the locked export mapping in `GcpTerraformExporter`. The importer must produce the canonical Infrastructure entity for each GCP Terraform resource type listed.

| GCP Terraform resource type | Infrastructure candidate | Notes |
|---|---|---|
| `google_compute_network` | `Network` | Preserve name, description, routing mode, external/self-link references. |
| `google_compute_subnetwork` | `Subnet / Network Segment` | Preserve CIDR, region, network reference, gateway address. Resource hosted/placement candidates only where references are clear. |
| `google_container_cluster` | `ComputeCluster / Platform` (`GKE`) | Optionally map node pools as supporting evidence / TODO comments — not first-class entities unless the existing model requires them. |
| `google_compute_instance` | `ComputeResource` (VM) | Preserve name, provider type, machine type, region/zone, image hints. |
| `google_cloud_run_v2_service` | `ComputeResource` (CLOUD_RUN_SERVICE) + implicit `ComputeCluster` (CLOUD_RUN) | Implicit cluster per the export contract. |
| `google_cloudfunctions2_function` | `ComputeResource` (CLOUD_FUNCTION) + implicit `ComputeCluster` (CLOUD_FUNCTIONS) | Implicit cluster per the export contract. |
| Kubernetes workload resources (already represented in uploaded TF) | `ComputeResource` | Only if parser supports the resource type. |
| Container image / VM image / function source / package/artifact fields on a compute resource | `DeploymentUnit` | Linked to the parent `ComputeResource` via "Deployment Unit runs on Compute" relationship when confidence is sufficient. |
| `google_compute_forwarding_rule` + `google_compute_backend_service` + `google_compute_url_map` + `google_compute_target_*_proxy` + (optional `google_compute_region_network_endpoint_group` for Cloud Run) | One `LoadBalancer` + one `Listener` (composite per Q9) | Listener derived from URL-map host/path rules + forwarding-rule port + target-proxy protocol. Falls back to per-component candidates with warning if pieces are missing. |
| `google_sql_database_instance` | `DataStoreInstance` | Preserve engine/version, region/location, host/connection name, backup/encryption hints. |
| `google_sql_database` | `DataStoreInstance` (database-level) | Preserve name, parent instance reference. |
| `google_redis_instance` | `DataStoreInstance` (Redis) | Preserve memory size, region, version. |
| BigQuery resources (where easily classified) | `DataStoreInstance` | Preserve dataset/table identifiers. |
| AlloyDB resources (where easily classified) | `DataStoreInstance` | Preserve cluster/instance identifiers. |
| `google_storage_bucket` | `InfrastructureResource` | Preserve provider_resource_type, bucket name, location. |
| `google_pubsub_topic` | `InfrastructureResource` | Preserve topic name. |
| `google_pubsub_subscription` | `InfrastructureResource` | Preserve subscription name + parent topic reference. |
| `google_secret_manager_secret` | `InfrastructureResource` | Preserve secret id, replication policy. |
| `google_cloud_scheduler_job` | `InfrastructureResource` | Preserve schedule, target. |
| `google_artifact_registry_repository` | `InfrastructureResource` | Preserve repo id, format, location. |
| CDN / cache resources (where easily classified) | `InfrastructureResource` | Best-effort. |
| `google_project` / `provider.project` / `var.project_id` | `Cloud Account / Project / Tenant` candidate | Inferred from provider block, dedicated resource, or import-options form. |
| `provider.region` / `provider.zone` / resource region/location fields / `var.region` | `Location / Site / Region` candidate | Inferred or user-provided. |
| Workspace / variable names / labels / resource-name conventions / user-provided | `Environment` candidate | Best-effort inference; if uncertain, use user-selected Environment from the import-options form. |
| Anything else (unsupported provider, unsupported resource type) | Preserved as evidence/TODO candidate | Soft-warn, never crash. |

**Relationship inference (only where direct Terraform evidence exists):**
- **Resource hosted in Subnet / Segment:** from `subnet_id` / `network` / `private_network` / `network_interface` / VPC-connector references.
- **Deployment Unit runs on Compute:** from `image` / `artifact` / `function source` / VM image fields on the compute resource.
- **Load Balancer routes to Compute / Resource:** from `backend_service` / NEG / URL-map / `target_pool` / equivalent references. Partial → warning + partial candidates.

### Round-Trip Stability Contract

The export spec and this import spec form a symmetric pair. The round-trip golden test (`TerraformImportRoundTripTest`, Q10=c) pins:

1. **`iac_address` symmetry.** Every resource block emitted by `GcpTerraformExporter` parses back to the exact same `iac_address` string. The export's address-emission and the import's address-parse share the same canonical form.
2. **Entity-name symmetry.** When the importer's candidate set is approved, the resulting Infrastructure entities have the same `name` field values that fed the original export.
3. **Technical-field symmetry.** CIDR / region / engine / type / provider_resource_type values round-trip exactly. (Names + descriptions are subject to the user-edit precedence rule in Q6, so the round-trip test fixture must NOT trigger that rule — i.e. start from a clean export with no manual edits applied.)
4. **Composite-LB symmetry.** A `LoadBalancer` + `Listener` pair exported as 5 GCP resources reads back as one `LoadBalancer` + one `Listener` candidate (composite-success path, Q9).
5. **Provenance round-trip.** Re-importing previously-exported HCL leaves the entity's `source_reference` matching the parsed `iac_address`, and `last_verified_at` updated to the import time.

The round-trip test consumes the EXPORT spec's golden `expected/main.tf` + `variables.tf` + `outputs.tf` directly — no separately maintained import fixture for the round-trip path. This keeps the two specs locked together: any change to the export's golden output forces a matching change in the import's expected-candidate set, surfaced as a CI failure.

### Reusability Opportunities

- Mirror `service/export/terraform/` package layout 1:1 for `service/import/terraform/`.
- Mirror `InfrastructureTerraformExportController` → `InfrastructureTerraformImportController`.
- Mirror `InfrastructureTerraformExportModal.tsx` → `InfrastructureTerraformImportModal.tsx`.
- Mirror `FileMenu.tsx` export wiring → import wiring.
- Mirror `modelApi.exportInfrastructureTerraform` → `modelApi.importInfrastructureTerraform`.
- Reuse `iacSourceProviderOptions` (`defaults.ts:1321`) and `TerraformExportService.PROVIDER_OPTIONS` as-is.
- Reuse `IaCSource` and `IaCResourceBinding` entity shapes from the discovery-readiness spec — no schema changes.
- Reuse provenance fields (`source_origin`, `source_system`, `source_reference`, `last_verified_at`) on Infrastructure entities.
- Reuse `InfrastructurePoint` polymorphic point pattern for binding → entity resolution.
- Reuse the export's golden HCL fixtures (`expected/main.tf`, `variables.tf`, `outputs.tf`) for the round-trip test.
- DO NOT reuse the discovery-service `runManager.ts` flow in V1 — documented as future-direction only.

### Safety Boundaries

The importer MUST NOT:
- Run `terraform init`.
- Run `terraform plan`.
- Run `terraform apply`.
- Call any GCP API (or any cloud provider API).
- Handle, request, or store cloud credentials.
- Read remote Terraform state.
- Access remote backends (Terraform Cloud, GCS, S3, etc.).
- Check out from Git or any remote repository.
- Fetch remote modules (`source = "git::..."`, `source = "registry.terraform.io/..."`) — soft-warn instead.
- Provision any infrastructure.
- Mutate the approved Infrastructure model without explicit user approval action (Q2 locks this — V1 is transient, approval is a separate explicit step).
- Silently overwrite existing model records when matching is ambiguous — surface a warning / decision point instead.

### Scope Boundaries

**In scope (V1):**
- Upload `.tf` files or a Terraform ZIP via the FileMenu modal.
- Hand-rolled tolerant subset HCL parser (Q1).
- GCP reverse-mapping per the table above.
- One-hop variable / locals / module-file resolution (Q5).
- Three-bucket confidence scoring (Q8).
- Composite-LB grouping with per-component fallback (Q9).
- Field-precedence-aware deterministic matching against existing `IaCResourceBinding` (Q6).
- Whole-ZIP-is-one-IaCSource semantics (Q4).
- Transient single-round-trip candidate review payload (Q2).
- Read-only summary table modal + "Approve all" / "Discard all" (Q11).
- Forward fixture test + round-trip golden test against the export spec's golden HCL (Q10).
- Warnings for unsupported resource types, unresolved references, partial LB structure, ambiguous matches, partial data, and "no Terraform plan/apply has been run".
- Provider-neutral framework with GCP as the first concrete impl.

**Out of scope (V1) — deferred to follow-up specs:**
- Terraform export (already shipped — separate spec).
- Terraform CLI execution of any kind.
- `terraform init` / `plan` / `apply`.
- Terraform state file parsing (`.tfstate`).
- Remote backend access (Terraform Cloud, GCS, S3, etc.).
- Git repository checkout.
- Terraform Cloud integration.
- Live GCP API calls.
- Cloud credential handling.
- Full Terraform expression evaluation (functions, templates, complex interpolation).
- Full module expansion with parameter substitution.
- Complete dependency graph reconstruction.
- Automatic direct mutation of approved model without review.
- Full cloud load balancer reconstruction (V1 is grouping-with-fallback, not perfect reconstruction).
- Cost estimation.
- Drift detection.
- Policy / compliance scanning.
- Security / IAM / firewall expansion beyond preserving unsupported evidence.
- Automatic diagram generation from imported Terraform.
- Pull request creation.
- Production-grade Terraform validation.
- LLM enrichment (Q12 = deterministic-only V1; no flag).
- Per-individual candidate approve/ignore in the UI (Q11 = read-only summary V1; per-row controls deferred).
- Persistent import-run rows / DB tables (Q2 = transient V1; persistent runs deferred).
- Persisted "rejected" record on candidates (Q7 = soft-hide-this-run-only V1).
- Per-field manual override in the candidate review (Q6 = field-precedence default V1; per-field UI deferred with the full review modal).
- Non-GCP provider classification (framework is provider-neutral; concrete impls beyond GCP are follow-up specs).

### Technical Considerations

- **Backend stack:** Java 21 / Spring Boot. No new Maven dependency for the HCL parser (Q1=b, hand-rolled). Existing `pom.xml` unchanged.
- **Frontend stack:** React / TypeScript / Vitest. Mirror existing export modal patterns.
- **Persistence:** No new DB tables, no Liquibase changesets for V1 (Q2=b, transient). Importer reads/writes existing `infrastructure_*`, `iac_source`, `iac_resource_binding` tables only on approval, via existing repositories.
- **Project / architecture scoping:** every endpoint scoped by `projectId` + `architectureId`. Approval respects multi-architecture-per-project boundaries (recent commit `e4f342e`).
- **Evidence preservation:** every candidate carries source `file_path`, `start_line`, `end_line`, raw HCL snippet, and the unresolved-expression text where applicable. This is non-negotiable — drives the warnings panel + future per-candidate UI.
- **`iac_address` parse fidelity:** must match the export's emit fidelity exactly. Round-trip golden test (Q10) is the contract enforcement.
- **Error handling:** soft-warn over crash. Unknown resource types, unresolved variables, missing module files, malformed HCL fragments — all generate warnings on the import result, never throw out of the importer.
- **Test discipline:** backend tests cover parsing `.tf` content, parsing ZIP content, every mapping in the GCP table (at least one representative per entity type), `IaCResourceBinding` candidate production, warnings for unsupported resources, no Terraform CLI execution, no cloud API calls, and `projectId`/`architectureId` scoping. Frontend tests cover modal renders where expected, upload request includes files + selected options, results/warnings displayed, no plan/apply UI present, and the FileMenu enablement gate.

## Decisions Locked — Quick Reference

| # | Topic | Locked answer |
|---|---|---|
| 1 | HCL parser | (b) Hand-rolled tolerant subset |
| 2 | Persistence | (b) Transient round-trip |
| 3 | UI placement | (a) FileMenu, parallel to export |
| 4 | ZIP semantics | (a) Whole-ZIP-is-one-IaCSource |
| 5 | Var/locals/module | (c) Best-effort one-hop |
| 6 | Match tie-break | (b) User-edited wins for name+description; imported wins elsewhere |
| 7 | Approval / ignore | Per-individual + soft-hide-this-run; collapsed to all-or-nothing in V1 UI per Q11 |
| 8 | Confidence | (a) Three buckets HIGH/MEDIUM/LOW |
| 9 | LB composite | (c) Try grouping, fall back per-component |
| 10 | Tests | (c) Forward fixture + round-trip golden |
| 11 | Frontend review | (b) Read-only summary + approve/discard all |
| 12 | LLM | (a) Deterministic-only, no flag |
