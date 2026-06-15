# Specification: Infrastructure Terraform Export (GCP)

## Goal
Add Terraform export support for the Infrastructure Architecture domain with GCP as the first registered provider. Export-only (no plan/apply/init/credentials/Git): the backend reads the approved Infrastructure model + spec-6 cross-domain relationships + spec-7 IaC sources/bindings/readiness fields and produces a heavily-commented Terraform ZIP (`main.tf`, `variables.tf`, `outputs.tf`, `README.md`, `warnings.json`).

## User Stories
- As an architect, I want to export selected Infrastructure data as a Terraform ZIP so that I can review the IaC implications of my model without running any cloud provisioner.
- As a platform engineer, I want generated Terraform to carry comment trails back to Infrastructure concepts (with TODOs for unsupported / incomplete fields) so that I can hand the ZIP to a delivery team and they know exactly what was inferred and what still needs work.

## Specific Requirements

**New backend service package `service/export/terraform/`**
- `TerraformExportService` orchestrates: load via `ModelService.loadModelByProjectAndArchitecture`, validate hard-fails, dispatch to the registered `TerraformExporter` by `providerId()`, run `TerraformAssembler`, dual-write filesystem files, return ZIP bytes + warnings.
- `TerraformExporter` strategy interface: per-Infra-entity-type methods (`exportEnvironment`, `exportCloudAccount`, `exportLocation`, `exportNetwork`, `exportSubnet`, `exportComputeCluster`, `exportComputeResource`, `exportDeploymentUnit`, `exportLoadBalancer`, `exportListener`, `exportDataStoreInstance`, `exportInfrastructureResource`) + `String providerId()`. Each entity method returns `List<EmittedResource>`.
- `GcpTerraformExporter` is the V1 implementation registered as the only provider (`providerId() == "GCP"`).
- `EmittedResource` record `(String targetFile /* main.tf | variables.tf | outputs.tf | README.md */, String hclFragment, List<String> comments, List<String> warnings)`.
- `TerraformAssembler` concatenates fragments by `targetFile`, prepends concept block headers, parses `terraform_variable_hints` JSON into `variables.tf` blocks, and produces `warnings.json`.
- `TerraformContext` carries the loaded model + selected env / cloud_account / location / provider + lookup maps used during relationship resolution.
- All providers are registered as Spring beans, looked up by `providerId()` in `Map<String, TerraformExporter>`. V1 registers only `GcpTerraformExporter`.

**New `InfrastructureTerraformExportController` (NOT folded into `ModelController`)**
- One endpoint: `GET /api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/export-terraform?environmentId=&cloudAccountId=&locationId=&provider=GCP`.
- Returns `application/zip` with `Content-Disposition: attachment; filename="<arch-slug>_<env-slug>_<timestamp>_terraform.zip"`. ZIP entries: `main.tf`, `variables.tf`, `outputs.tf`, `README.md`, `warnings.json`.
- Hard-fail (4xx) when: `environmentId` missing; `provider` missing or not in `iacSourceProviderOptions`; `provider` not registered in the exporter map (V1: anything other than `GCP`).
- Hard-fail boundary checks run BEFORE model load to avoid wasted I/O. All other gaps are soft-warn.
- Slug helper: `name.toLowerCase().replaceAll("[^a-z0-9]+", "_")`.

**GCP resource mapping table (entity type → primary GCP resource type)**
- `Network` → `google_compute_network`; `Subnet` → `google_compute_subnetwork`.
- `Compute Cluster` (KUBERNETES/GKE) → `google_container_cluster` + TODO scaffold for `google_container_node_pool`. (CLOUD_RUN) → no standalone resource (commented in target Compute Resource block).
- `Compute Resource` (VM-style) → `google_compute_instance`; (CLOUD_RUN_SERVICE) → `google_cloud_run_v2_service`; (other types) → TODO scaffold.
- `Deployment Unit` → no standalone resource; image / artifact / version flow into the target Compute Resource via `application_compute_deployments`.
- `Load Balancer` → `google_compute_backend_service` + `google_compute_url_map` + `google_compute_target_http_proxy` / `google_compute_target_https_proxy` + `google_compute_global_forwarding_rule` (+ `google_compute_region_network_endpoint_group` for Cloud Run targets). `Listener` → forwarding-rule port/protocol + URL-map host/path rules driven by `application_load_balancer_exposures`.
- `Data Store Instance` (relational) → `google_sql_database_instance` (+ `google_sql_database` if name available); (cache, Redis engine) → `google_redis_instance`; (other engines) → TODO scaffold.
- `Infrastructure Resource` types: `OBJECT_BUCKET` → `google_storage_bucket`; `MESSAGE_TOPIC` → `google_pubsub_topic`; `MESSAGE_QUEUE` → `google_pubsub_subscription`; `CACHE` → `google_redis_instance` (dedupe note if same ref as a Data Store cache); `SECRET_STORE` → `google_secret_manager_secret` (NEVER include values); `SCHEDULER` → `google_cloud_scheduler_job`; (other types) → TODO scaffold.

**Spec-7 readiness field consumption**
- `terraform_resource_hint` → highest-priority override of the default GCP resource type for that entity.
- `terraform_module_hint` → V1 emits as a `# Module hint: <value>` comment only (no module split).
- `terraform_variable_hints` (raw JSON string) → parsed by the assembler; each entry becomes a `variable "<name>" { ... }` block in `variables.tf` (description / default propagated, type defaults to `string`).
- `terraform_notes` → appended verbatim as a comment block immediately under the resource header.
- `terraform_ready == false` → emit a TODO scaffold (resource block kept but flagged) instead of a full block. `true` / `null` → emit normally.
- Resource-type override hierarchy: `terraform_resource_hint` > `iac_resource_bindings.iac_resource_type` > default mapping.

**Spec-6 cross-domain relationship consumption**
- `application_compute_deployments` (Service → Compute, possibly via Deployment Unit) drives `image` / `artifact_uri` / `version` fields on the target Compute Resource. Multiple DUs targeting the same CR → soft-warn TODO unless unambiguous.
- `application_load_balancer_exposures` drives URL-map `host_name` / `path_pattern` rules and listener port/protocol/certificate fields on the parent Load Balancer.
- `data_entity_data_store_hostings` and `application_infrastructure_resource_uses` → documentation-only (commented `# Hosts data entity ...` / `# Used by application ...` trails).

**Resource naming + comment style**
- Resource address: reuse `iac_resource_bindings.iac_address` verbatim if present for that Infra entity; else generate `<env-slug>_<kebab(entity.name)>` (e.g. `prod_app_vpc`).
- Block headers: `# Infrastructure concept: <ConceptName>`, `# Architecture entity: <entity.name>`, `# Environment: <env.name>`. Optional `# Source model id: <id>` only where useful for traceability.
- TODO comments: `# TODO: <reason>. Source: <Infrastructure concept> '<entity.name>' (id: <model id>).`
- `terraform_notes` value appended verbatim immediately after the standard header lines.

**Validation / warning matrix**
- Hard-fail (4xx): no `environmentId`; provider not in `iacSourceProviderOptions`; provider not registered (V1: not `GCP`).
- Soft-warn (TODO comment + entry in `warnings.json`): missing `cloud_account`; missing `location`; unsupported `compute_type` / data store `engine` / `resource_type`; unresolved relationship targets; ambiguous Deployment Unit → Compute mappings.
- Every soft-warn surfaces in BOTH the inline `warnings.json` payload AND a `# TODO` comment in the relevant Terraform block. Soft-warns NEVER block the response — the ZIP returns cleanly.

**Filesystem dual-write + ZIP construction**
- Dual-write the 4 generated files (`main.tf`, `variables.tf`, `outputs.tf`, `README.md`) to `{projectParentFolder}/exports/terraform/<arch-slug>_<env-slug>_<timestamp>/` mirroring `DiagramExportService` precedent. New constant `TERRAFORM_SUBDIR = "terraform"`; reuse `EXPORTS_SUBDIR` and `TIMESTAMP_FORMAT`.
- ZIP is built in memory via `ByteArrayOutputStream` + `ZipOutputStream` (no Apache Commons Compress, no templating dependency). ZIP entries: the 4 files PLUS `warnings.json`.

**Backend tests (3 new test classes + golden-file fixtures)**
- `GcpTerraformExporterTest.java` — per-entity-type unit tests covering each emitter method's mapping + the TODO-fallback path for unsupported sub-types.
- `TerraformExportGoldenFileTest.java` — single snapshot test using a fixed input model (1 VPC + 1 subnet + 1 GKE cluster + 1 Cloud SQL instance + 1 GCS bucket + 1 Cloud Run service + 1 LB + 1 listener). Goldens (`main.tf`, `variables.tf`, `outputs.tf`, `README.md`) committed under `architecture-model-service/src/test/resources/terraform-export/` and asserted byte-equal.
- `InfrastructureTerraformExportControllerTest.java` — MockMvc test mirroring `DiagramExportControllerTest`: asserts `200 OK`, `application/zip`, expected `Content-Disposition` filename pattern, ZIP entries include all 5 files.
- ~117 pre-existing broken backend test files carry forward unchanged; do not fix in this spec.

**Frontend API + modal + menu wiring**
- Append `exportInfrastructureTerraform(projectId, architectureId, options): Promise<Response>` to `frontend/src/api/modelApi.ts`, returning the raw `Response` (mirrors `exportAllDiagramsAsZip`). Options: `{environmentId, cloudAccountId?, locationId?, provider}`.
- New `frontend/src/components/Export/InfrastructureTerraformExportModal.tsx` modal: Environment (required dropdown of `metaModel.entities.environments`), Cloud Account (optional dropdown of `cloud_accounts`), Location (optional dropdown of `locations`), Provider (required, V1 only `GCP` enabled — other entries from `iacSourceProviderOptions` rendered greyed/disabled with "Coming soon" tooltip). Submit disabled until Environment + Provider set. Post-submit: parse `warnings.json` from the ZIP, display warnings list inline, "Download ZIP" button uses `URL.createObjectURL` + `parseContentDispositionFilename`.
- Append "Export Infrastructure as Terraform..." menu item to the existing Export group in `frontend/src/components/TopBar/FileMenu.tsx`, parallel to JSON / XLSX exports. Disabled unless model is loaded AND Infrastructure has at least one Environment.
- Reuse `iacSourceProviderOptions` from `frontend/src/config/defaults.ts` (line 1321) — do NOT redeclare.

**Frontend tests**
- `InfrastructureTerraformExportModal.test.tsx` — modal-render smoke (fields render; submit disabled until Environment + Provider set; post-submit shows warnings list + download button).
- One `modelApi.exportInfrastructureTerraform` test mocking `fetch` to assert URL + query params + Response handling.
- Pre-existing frontend failures untouched.

**Locked contract constraints**
- snake_case JSON throughout backend; matches existing patterns.
- Mirror `DiagramExportService` exactly for ZIP construction + filesystem dual-write.
- No new templating dependency; hand-rolled string-fragment emitters only.
- Zero Liquibase changesets (filesystem-only persistence; no `ProjectArtifactEntity` row).
- No edits to `ModelController.java`, existing diagram palette / edges, existing 16 Infrastructure grids, gateway, mcp-server, or discovery-service.

## Existing Code to Leverage

**`architecture-model-service/src/main/java/.../service/DiagramExportService.java`**
- Direct template for ZIP construction (`ByteArrayOutputStream` + `ZipOutputStream` + `ZipEntry`), filesystem dual-write under `{projectParentFolder}/exports/...`, filename normaliser (lowercase + whitespace→`-` + special chars stripped), and the `TIMESTAMP_FORMAT` constant. New service mirrors this exactly with `TERRAFORM_SUBDIR = "terraform"`.

**`architecture-model-service/src/main/java/.../controller/ModelController.java` (lines 367-387)**
- `application/zip` `Content-Disposition` response pattern reused verbatim by the new `InfrastructureTerraformExportController` (same `ResponseEntity<byte[]>` shape, same MediaType, same header pattern).

**`architecture-model-service/src/test/.../DiagramExportControllerTest.java`**
- Direct template for the new MockMvc controller test: mock the service, assert ZIP headers + bytes + filename pattern.

**`ModelService.loadModelByProjectAndArchitecture(UUID projectId, UUID architectureId)`**
- Entry point reused by `TerraformExportService` for architecture-scoped model loading. Returns the full DTO graph (entities + relationships + spec-7 IaC sources/bindings) consumed by emitters.

**Spec-1/6/7 DTOs (12 Infra entity DTOs + 4 cross-domain rels + `IaCSourceDto`/`IaCResourceBindingDto` + 6 provenance + 5 readiness fields per entity)**
- All fields read by the GCP emitters via existing `@JsonProperty("snake_case")` accessors; no DTO changes in this spec. Readiness fields drive override / TODO behaviour; `application_compute_deployments` drives container image; `application_load_balancer_exposures` drives URL-map; `iac_resource_bindings.iac_address` drives stable resource naming.

**`frontend/src/api/modelApi.ts` `exportAllDiagramsAsZip(...)` + `frontend/src/components/Export/ExportProjectNameModal.tsx`**
- Direct template for the new `exportInfrastructureTerraform(...)` API helper (raw `Response` return, blob handling, `parseContentDispositionFilename` usage) AND for the new modal shape (form layout, submit-disabled gating, post-submit download flow).

## Out of Scope
- Terraform `init`, `plan`, `apply`, CLI integration; OpenTofu execution; live GCP API calls; cloud credentials handling.
- Git repository writes; automatic pull request creation.
- Per-domain module split (V1 emits a single `main.tf`); production-grade landing zone.
- Security group / firewall / IAM expansion beyond TODO comments; cost estimation; drift detection; policy / compliance scanning; auto-diagram-from-Terraform.
- LLM-based generation (existing LLM utilities NOT used in this spec); per-architecture / per-stage generation strategies.
- `ProjectArtifactEntity` README persistence (filesystem-only V1); Liquibase changesets; Terraform editor UI.
- Provider implementations beyond GCP (interface registered; only V1 GCP impl wired). UI shows AWS / AZURE / ON_PREM / MULTI / OTHER as disabled "Coming soon"; backend hard-fails any non-GCP provider.
- Edits to existing controllers, existing 16 Infrastructure grids, existing diagram palette / edges, gateway, mcp-server, discovery-service.
