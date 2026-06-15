# Specification: Infrastructure Terraform Import (GCP)

## Goal
Add Terraform import support for the Infrastructure Architecture domain as the inverse of the Terraform Export spec. Users upload `.tf` files or a Terraform ZIP; the backend parses (hand-rolled tolerant HCL subset, no new Maven deps), classifies via a provider-neutral strategy with GCP as the V1 impl, and returns a transient candidate review payload. The approved Infrastructure model is mutated only when the user explicitly clicks "Approve all". Round-trip parity with the export is a top-level invariant.

## User Stories
- As an architect, I want to upload existing Terraform `.tf` files (or a ZIP) and see proposed Infrastructure candidates so that I can pull existing IaC into the model without running `terraform init/plan/apply` and without touching cloud credentials.
- As a platform engineer, I want a read-only summary of every parsed candidate (entity type, name, source `file:line`, confidence, warnings) before any model mutation so that I can confirm the inferred mappings or discard the entire run cleanly.

## Specific Requirements

**New backend service package `service/import/terraform/`**
- `TerraformImportService` orchestrates: validate hard-fails (provider, environmentId), unzip / collect `.tf` files, hand-rolled parse, dispatch to the registered `TerraformImporter` keyed by `providerId()`, run candidate reconciliation against existing `IaCResourceBinding` rows, return a `TerraformImportResult` payload (candidates + warnings). NO model mutation occurs in this service.
- `TerraformImporter` strategy interface mirroring `TerraformExporter`: `String providerId()` plus `List<ImportedCandidate> importResources(TerraformImportContext ctx)`. Spring injects `List<TerraformImporter>` and `TerraformImportService` resolves by `providerId()`. V1 registers only `GcpTerraformImporter`.
- `GcpTerraformImporter` is the V1 implementation (`providerId() == "GCP"`). Owns the GCP reverse-mapping table below, composite-LB detection (Q9), confidence bucketing (Q8), and unsupported-resource fallback.
- `TerraformImportContext` carries: parsed HCL files (with line ranges), user-supplied import options (`environmentId`, `cloudAccountId`, `locationId`, `repositoryUrl?`, `branch?`, `commitSha?`, `path?`, `workspace?`), the loaded existing model (for matching), and a mutable `warnings` collector.
- `ImportedCandidate` record: target entity type discriminator, proposed entity field map, proposed `IaCResourceBinding` shape, `confidence` (0.90 / 0.60 / 0.30), per-candidate warnings, and an evidence block (`file_path`, `start_line`, `end_line`, raw HCL snippet, unresolved-expression text where present).
- `TerraformImportResult` record: `iacSource` proposal (one per import — Q4), `List<ImportedCandidate> willCreate`, `List<ImportedCandidate> willUpdate`, `List<ImportedCandidate> unsupported`, `List<String> warnings`, and a `summary` block with counts per category.

**Hand-rolled tolerant HCL subset parser (Q1)**
- New package `service/import/terraform/hcl/` with `HclParser`, `HclLexer`, `HclBlock`, `HclAttribute`, `HclValue` types. Zero new Maven dependencies.
- Recognised top-level constructs: `resource <type> "<name>" { ... }`, `module "<name>" { ... }`, `variable "<name>" { ... }`, `output "<name>" { ... }`, `locals { ... }`, `provider "<name>" { ... }`.
- Recognised value types: string literal, number literal, bool literal, list (`[...]`), map / object (`{ k = v, ... }`).
- Recognised expressions: `var.x`, `local.x`, `<resource_type>.<name>.<attr>`, `module.<name>.<attr>`. Anything else (functions, template strings with `${...}` logic, ternaries, `for`/`for_each`/`count` blocks) is preserved verbatim as the `rawExpression` string on the `HclValue` and surfaces as a soft-warn TODO on the candidate.
- Line-range tracking is mandatory: every `HclBlock` records `startLine` / `endLine` from the lexer so `IaCResourceBinding.start_line` / `end_line` are accurate.
- Comments (`#`, `//`, `/* */`) are stripped during lexing but preserved as a per-block `precedingComments` string for evidence display.
- Malformed fragments produce a warning (`"unparseable block at <file>:<line>"`) and are skipped — the parser MUST NOT throw out of the importer.

**One-hop variable / locals / module-file resolution (Q5)**
- Resolution priority for a `var.x` reference: (1) user-supplied import option matching `x`, (2) the matching `variable "x" { default = ... }` literal, (3) `null` → preserved verbatim + TODO warning.
- Resolution priority for `local.x`: matching `locals { x = "<literal>" }` only. Anything non-literal → preserved verbatim + TODO warning.
- `module "x" { source = "./..." }` blocks: if the referenced HCL files are present in the upload, they are parsed and their `resource` blocks become candidates with `file_path` relative to the ZIP root and a `# Module call: <name>` evidence comment. Parameter substitution into module variables is NOT performed in V1.
- Remote module sources (`source = "git::..."`, `source = "registry.terraform.io/..."`, `source = "<owner>/<name>/<provider>"`) → soft-warn TODO `"remote module not fetched: <source>"`. NEVER attempt a network fetch.
- No `for_each`, `count`, template-string interpolation, or function evaluation. Any block using these constructs is preserved verbatim and emits a TODO warning; the candidate still lands but at LOW confidence.

**New `InfrastructureTerraformImportController` (NOT folded into `ModelController`)**
- One endpoint: `POST /api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/import-terraform`.
- `Content-Type: multipart/form-data` parts: `files` (one or more `.tf` files OR exactly one `.zip`), plus form fields `environmentId` (required), `cloudAccountId` (optional), `locationId` (optional), `provider` (required, V1 must be `GCP`), `repositoryUrl` (optional), `branch` (optional), `commitSha` (optional), `path` (optional), `workspace` (optional).
- Returns `application/json` with the `TerraformImportResult` payload. NO ZIP download, NO file write — the response body is the entire transient payload (Q2).
- Hard-fail (4xx) when: any file part missing; `environmentId` missing; `provider` missing or not in `iacSourceProviderOptions`; `provider` not registered in the importer map (V1: anything other than `GCP`); ZIP > configured max size; any file > configured max size. Hard-fail boundary checks run BEFORE parse to avoid wasted I/O.
- Slug helper: reuse the same `name.toLowerCase().replaceAll("[^a-z0-9]+", "_")` as the export controller.
- Approval is NOT a new endpoint in this spec — the frontend posts approved candidates back through the existing model-save flow (`PUT /api/model/projects/{p}/architectures/{a}` shape) with the importer-supplied entity payload merged into the model. "Discard all" is a pure client-side state clear; nothing is persisted server-side mid-review.

**ZIP / multi-file semantics (Q4)**
- The whole upload (ZIP root OR the set of submitted `.tf` files) is treated as ONE proposed `IaCSource`. All bindings produced by the run point at this single source.
- Every `.tf` file in the upload is parsed. `IaCResourceBinding.file_path` is recorded relative to the ZIP root (e.g. `modules/network/main.tf`) or to the multipart upload set (filename only when individual `.tf` files are uploaded).
- Local module references (`source = "./modules/x"`) are followed when the matching files exist in the upload payload; missing local module files → soft-warn TODO.
- Remote module sources (`git::`, `registry.terraform.io/...`) → soft-warn TODO; importer NEVER fetches.
- ZIP size cap and per-file size cap enforced before parse (controller-level check).

**GCP reverse-mapping (V1) — must invert `GcpTerraformExporter` exactly**
- `google_compute_network` → `Network`. Preserve name, description, routing mode.
- `google_compute_subnetwork` → `Subnet / NetworkSegment`. Preserve CIDR (`ip_cidr_range`), region, parent network reference.
- `google_container_cluster` → `ComputeCluster` (KUBERNETES). Node pools captured as supporting evidence comments only.
- `google_compute_instance` → `ComputeResource` (VM). Preserve machine type, region/zone, image hint.
- `google_cloud_run_v2_service` → `ComputeResource` (CLOUD_RUN_SERVICE) PLUS implicit `ComputeCluster` (CLOUD_RUN) when one is not already present in the candidate set. Mirrors the export contract.
- `google_cloudfunctions2_function` → `ComputeResource` (FUNCTION) PLUS implicit `ComputeCluster` (CLOUD_FUNCTIONS) when not already present.
- Container `image` / function `source` / VM image fields → `DeploymentUnit` candidate linked to the parent `ComputeResource` via the "Deployment Unit runs on Compute" relationship (only when evidence is unambiguous).
- LB composite (Q9 try-then-fallback): `google_compute_(global_)forwarding_rule` + `google_compute_backend_service` + `google_compute_url_map` + `google_compute_target_(http\|https)_proxy` + (optional `google_compute_(region_)network_endpoint_group`) → ONE `LoadBalancer` + ONE `Listener` candidate. URL-map host/path rules drive listener routes; forwarding-rule port + target-proxy protocol drive listener port/protocol. If pieces missing → emit per-component candidates each with TODO warning + one top-level `"unrecognised LB pattern"` warning.
- `google_sql_database_instance` → `DataStoreInstance` (relational). Preserve engine + version + region.
- `google_sql_database` → child `DataStoreInstance` (database-level), parent reference preserved as `parentInstanceRef` evidence — match the export's choice exactly.
- `google_redis_instance` → `DataStoreInstance` (cache, REDIS engine) — match the export's choice exactly for round-trip parity.
- `google_storage_bucket` → `InfrastructureResource` with `provider_resource_type = OBJECT_BUCKET`.
- `google_pubsub_topic` → `InfrastructureResource` (`MESSAGE_TOPIC`).
- `google_pubsub_subscription` → `InfrastructureResource` (`MESSAGE_QUEUE`); parent topic reference preserved.
- `google_secret_manager_secret` → `InfrastructureResource` (`SECRET_STORE`). Secret values are NEVER imported (even if literally present).
- `google_cloud_scheduler_job` → `InfrastructureResource` (`SCHEDULER`).
- `google_artifact_registry_repository` → `InfrastructureResource` with the same `provider_resource_type` choice the export uses (must match for round-trip).
- BigQuery / AlloyDB resource types → `DataStoreInstance` candidates at LOW confidence (best-effort) with TODO warning.
- `google_project` block / `provider.project` / `var.project_id` → `CloudAccount / Project / Tenant` candidate (inferred). Skipped when the user supplied `cloudAccountId` in the form.
- `provider.region` / `provider.zone` / per-resource region/location fields / `var.region` → `Location / Site / Region` candidate (inferred). Skipped when the user supplied `locationId`.
- Workspace / labels / resource-name conventions → best-effort `Environment` inference only when the user-selected `environmentId` is missing... but `environmentId` is required by the controller, so V1 always uses the user-supplied environment.
- All other `google_*` resource types → emitted as unsupported TODO candidates with full HCL preserved as evidence + a per-candidate warning.

**Relationship inference (only with direct Terraform evidence)**
- "Resource hosted in Subnet" — from `subnet_id` / `network` / `private_network` / `network_interface` / VPC connector references on a compute / data-store resource pointing at a parsed `google_compute_subnetwork` / `google_compute_network` candidate.
- "Deployment Unit runs on Compute" — from `image` / `artifact` / function `source` / VM image fields on the parent `ComputeResource` candidate.
- "Load Balancer routes to Compute / Resource" — from `backend_service` / NEG / URL-map / `target_pool` references when the composite-LB success path fired. Partial / per-component fallback emits no relationships, only warnings.

**Deterministic matching with field-precedence tie-breaker (Q6)**
- Match key: `iac_resource_bindings.iac_address`. Importer queries existing bindings (scoped by `projectId` + `architectureId`) by exact `iac_address` match.
- On match (`willUpdate` candidate): user-edited `name` and `description` win — the proposed update keeps the existing model values for these two fields. Imported values win for technical fields: CIDR, region, engine, type, `provider_resource_type`, machine type, version, etc.
- The candidate review payload surfaces ALL diverging fields (left = current model, right = imported) for transparency; V1 UI presents this read-only.
- On no match: `willCreate` candidate.
- `iac_address` MUST be persisted EXACTLY as parsed — round-trip stability with the export contract.

**Confidence scoring (Q8)**
- Three buckets stored as `DECIMAL(4,3)` on `IaCResourceBinding.confidence`:
- HIGH = `0.900` — resource type is in the GCP mapping table AND zero unresolved variable references AND env/region known (user-supplied or inferred from literals).
- MEDIUM = `0.600` — resource type in mapping table BUT some references unresolved OR env/region not inferred.
- LOW = `0.300` — resource type unknown OR partial mapping (e.g. composite-LB fallback fired).

**Round-trip stability contract (top-level invariant)**
- Re-exporting a model that was just imported MUST emit HCL with the same `iac_address` values for any entity created via import. Therefore the importer MUST persist `IaCResourceBinding.iac_address` byte-equal to what it parsed and MUST NOT rename entities during round-trip.
- Composite-LB symmetry: 5 GCP resources exported as one `LoadBalancer` + one `Listener` re-import as one `LoadBalancer` + one `Listener` (the Q9 success path).
- Technical-field symmetry: CIDR / region / engine / type / `provider_resource_type` round-trip exactly.
- Provenance round-trip: re-importing exported HCL leaves `source_reference == iac_address` and updates `last_verified_at`.
- Pinned by `TerraformImportRoundTripTest` (Q10) which consumes the export spec's golden `expected/main.tf` + `variables.tf` + `outputs.tf` directly.

**Provenance fields on imported entities (REUSED AS-IS, no schema change)**
- On approval, every created/updated Infrastructure entity is stamped with: `source_origin = 'IMPORTED'`, `source_system = 'terraform-import'`, `source_reference = '<iac_address>'`, `last_verified_at = <now>`.
- Schema is unchanged from the discovery-readiness spec — no Liquibase changesets in this spec.

**Backend tests (3 new test classes + golden-file fixtures)**
- `GcpTerraformImporterTest.java` — per-resource-type unit tests covering each entry in the GCP reverse-mapping table + the unsupported-fallback path + the composite-LB success path AND fallback path.
- `TerraformImportForwardFixtureTest.java` — single golden test consuming a hand-written `architecture-model-service/src/test/resources/terraform-import/input.tf` covering: comments, unresolved variables, an unsupported `google_*` resource type, partial LB pieces, and at least one literal-only `locals` block. Asserts the produced candidate JSON byte-equal against committed `expected-candidates.json`.
- `TerraformImportRoundTripTest.java` — feeds `architecture-model-service/src/test/resources/terraform-export/expected/main.tf` (+ `variables.tf`, `outputs.tf`) into the importer, asserts the candidate set matches the export's seed model entity-for-entity (names, technical fields, `iac_address` values). NB: any change to the export's golden files must update both tests in lock-step.
- `InfrastructureTerraformImportControllerTest.java` — MockMvc test mirroring `InfrastructureTerraformExportControllerTest`: asserts `200 OK`, `application/json`, hard-fail responses for missing `environmentId` / unregistered provider / oversized upload, and the multipart parse path.
- Pre-existing broken backend tests carry forward unchanged; do not fix in this spec.

**Frontend API + modal + menu wiring**
- Append `importInfrastructureTerraform(projectId, architectureId, formData): Promise<TerraformImportResult>` to `frontend/src/api/modelApi.ts`, mirroring `exportInfrastructureTerraform` but as `POST` `multipart/form-data` returning parsed JSON. Caller assembles the `FormData` in the modal.
- New `frontend/src/components/Import/InfrastructureTerraformImportModal.tsx` (+ `.module.css`) mirroring `InfrastructureTerraformExportModal.tsx`:
  - File upload control accepting `.tf` files (multiple) OR a single `.zip`.
  - Form fields: Environment (required dropdown of `metaModel.entities.environments`), Cloud Account (optional dropdown of `cloud_accounts`), Location (optional dropdown of `locations`), Provider (required, V1 only `GCP` enabled — other entries from `iacSourceProviderOptions` greyed/disabled with "Coming soon"), and optional IaC Source metadata text inputs (`repository_url`, `branch`, `commit_sha`, `path`, `workspace`).
  - Two-step flow: step 1 = upload + form, "Parse" button submits to the backend; step 2 = read-only review (Q11) showing a summary table (entity type, name, source `file:line`, confidence bucket, warnings count) split into "Will create" / "Will update" / "Unsupported / TODO" sections, plus a warnings panel listing all top-level `warnings`. Inline collapsible row drill-down to the raw HCL evidence is supported but no per-row approve/ignore controls in V1.
  - Footer buttons in step 2: "Approve all" (posts the candidates through the existing model-save flow) and "Discard all" (clears modal state and closes).
  - Submit on step 1 disabled until at least one file is selected AND Environment + Provider are set.
- Append "Import Infrastructure from Terraform..." menu item to `frontend/src/components/TopBar/FileMenu.tsx` parallel to the existing "Export Infrastructure as Terraform..." entry. New props: `onImportInfrastructureTerraform: () => void`, `importInfrastructureTerraformDisabled: boolean`. Disabled gate matches the export entry: model loaded AND Infrastructure has at least one Environment.
- Wire the new modal state into `frontend/src/components/TopBar/TopBar.tsx` parallel to the export modal state.
- Reuse `iacSourceProviderOptions` from `frontend/src/config/defaults.ts` (line 1321) — do NOT redeclare.

**Frontend tests**
- `InfrastructureTerraformImportModal.test.tsx` — modal-render smoke (file input + all form fields render; submit disabled until file + Environment + Provider set; post-parse step 2 renders the three category sections + warnings panel + Approve/Discard buttons).
- One `modelApi.importInfrastructureTerraform` test mocking `fetch` to assert `POST` URL, `multipart/form-data` body content, and JSON Response handling.
- Pre-existing frontend failures untouched.

**Locked contract constraints**
- snake_case JSON throughout backend.
- No new Maven dependencies (HCL parser hand-rolled).
- No new Liquibase changesets (V1 transient — Q2; provenance + binding + source schemas already exist).
- No edits to `ModelController.java`, existing diagram palette / edges, existing 16 Infrastructure grids, gateway, mcp-server, discovery-service, OR `InfrastructureTerraformExportController`.
- V1 deterministic-only — no LLM calls, no feature flag (Q12).
- No Terraform CLI execution, no GCP API calls, no credentials, no Git checkout, no remote-backend access, no remote-module fetch (safety boundary verbatim from requirements).

## Existing Code to Leverage

**`architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/`**
- Direct symmetric template for the new `service/import/terraform/` package. `TerraformExporter` ↔ `TerraformImporter` strategy interface shape, `GcpTerraformExporter` ↔ `GcpTerraformImporter` provider impl, `TerraformContext` ↔ `TerraformImportContext`, `TerraformExportService` ↔ `TerraformImportService`. Spring `List<TerraformImporter>` keyed by `providerId()` follows the `List<TerraformExporter>` pattern verbatim.

**`architecture-model-service/src/main/java/com/example/architecturemodel/controller/InfrastructureTerraformExportController.java`**
- Direct template for the new `InfrastructureTerraformImportController`: same project/architecture path scoping, same hard-fail-before-work pattern, same slug helper, same `iacSourceProviderOptions` provider validation. Inverted: `POST` instead of `GET`, `multipart/form-data` request, `application/json` response (NOT `application/zip`).

**`architecture-model-service/src/main/java/.../service/export/terraform/GcpTerraformExporter.java` (mapping table)**
- Authoritative source for the GCP reverse-mapping table above. Every locked entry MUST be inverted exactly — same resource-type strings, same composite-LB shape, same `google_redis_instance` → cache `DataStoreInstance` choice, same `google_artifact_registry_repository` `provider_resource_type` choice. Round-trip golden test enforces parity.

**Spec-7 `IaCSource` + `IaCResourceBinding` entities + provenance fields (`2026-05-05-infrastructure-terraform-discovery-readiness`)**
- Reused as-is. Importer creates `IaCSource` rows on approval (one per import) and `IaCResourceBinding` rows (one per mapped resource block) with `iac_address`, `iac_resource_type`, `iac_resource_name`, `provider`, `file_path`, `start_line`, `end_line`, `external_id` (where available), `confidence`. Provenance fields `source_origin` / `source_system` / `source_reference` / `last_verified_at` stamped on every imported Infrastructure entity. Zero schema changes.

**`InfrastructurePoint` polymorphic point pattern**
- Reused unchanged. `IaCResourceBinding.infrastructure_point_id` resolves to the appropriate Infrastructure entity via the `target_type` discriminator.

**`frontend/src/api/modelApi.ts` `exportInfrastructureTerraform` + `frontend/src/components/Export/InfrastructureTerraformExportModal.tsx`**
- Direct template for the new `importInfrastructureTerraform` API helper (mirrored signature, `POST` + `multipart/form-data`) AND for the new modal shape (form layout, Environment/Cloud Account/Location/Provider dropdowns, submit-disabled gating). The new modal extends the pattern with a file-upload control on step 1 and a read-only review table on step 2.

**`frontend/src/components/TopBar/FileMenu.tsx` + `TopBar.tsx`**
- Direct template for the new menu item + modal state wiring. Mirror the existing `onExportInfrastructureTerraform` / `exportInfrastructureTerraformDisabled` props verbatim, parallel position in the menu, parallel enablement gate.

## Out of Scope
- Terraform CLI execution of any kind (`init`, `plan`, `apply`); OpenTofu execution; Terraform state file (`.tfstate`) parsing.
- Remote backends (Terraform Cloud, GCS, S3, etc.); Git repository checkout; remote module fetch (`git::`, `registry.terraform.io/...`).
- Live GCP API calls; cloud credential handling, request, or storage; any production-grade Terraform validation.
- Full Terraform expression evaluation (functions, template-string logic, ternaries, `for`/`for_each`/`count`); full module expansion with parameter substitution; complete dependency-graph reconstruction.
- Automatic mutation of the approved Infrastructure model without explicit user approval (V1 is transient + explicit-approve only).
- Full cloud load-balancer reconstruction (V1 is composite-grouping with per-component fallback, not perfect reconstruction); cost estimation; drift detection; policy / compliance scanning; security / IAM / firewall expansion beyond preserving evidence.
- Automatic diagram generation from imported Terraform; pull request creation.
- LLM enrichment of any kind in V1 — no flag (Q12).
- Per-individual candidate approve/ignore controls in the UI (Q11 = read-only summary V1; deferred); per-field manual override in the candidate review (Q6 = field-precedence default V1; deferred); persisted import-run rows / DB tables (Q2 = transient V1; deferred); persisted "rejected" record (Q7 = soft-hide-this-run-only V1).
- Non-GCP provider classification (framework is provider-neutral; concrete impls beyond GCP are follow-up specs); UI shows AWS / AZURE / ON_PREM / MULTI / OTHER as disabled "Coming soon"; backend hard-fails any non-GCP provider.
- Edits to existing controllers, the Terraform Export spec's controller/service/modal, existing 16 Infrastructure grids, existing diagram palette / edges, gateway, mcp-server, discovery-service.
