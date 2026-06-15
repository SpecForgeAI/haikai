# Task Breakdown: Infrastructure Terraform Export (GCP)

## Overview
Total Tasks: 8 task groups covering ~10 new backend files (6 service-package files in `service/export/terraform/` + 1 controller + 3 test classes) plus 1 new test-resources fixture directory; ~3 frontend files (1 modal + 1 menu wiring + 1 API helper); 0 Liquibase changesets; 0 new dependencies.

This is the **export-only Terraform feature** layered on top of specs 1-7 of the Infrastructure delivery sequence. Backend is the bulk of the work (strategy interface + 12 emitter methods on `GcpTerraformExporter` + assembler + dual-write service + controller + golden-file snapshot fixture). Frontend is light: one modal, one menu item, one API helper, two tests.

**Locked contract from prior specs (do not violate):**
- All locked decisions from specs 1-7 apply.
- snake_case JSON throughout backend payloads (matches existing `@JsonProperty("snake_case")` pattern).
- Mirror `DiagramExportService` exactly for ZIP construction + filesystem dual-write: in-memory `ByteArrayOutputStream` + `ZipOutputStream` (no Apache Commons Compress); dual-write to `{projectParentFolder}/exports/terraform/<arch-slug>_<env-slug>_<timestamp>/`. New constant `TERRAFORM_SUBDIR = "terraform"`; reuse `EXPORTS_SUBDIR` and `TIMESTAMP_FORMAT` from `DiagramExportService`.
- Reuse `iacSourceProviderOptions` from `frontend/src/config/defaults.ts` (line 1321) for the provider dropdown — do **NOT** redeclare or modify.
- Strategy interface registered as Spring beans by `providerId()` in `Map<String, TerraformExporter>`. V1 registers only `GcpTerraformExporter` (`providerId() == "GCP"`).
- Hand-rolled string-fragment emitters only — **no new templating dependency** (no JTE / FreeMarker / Mustache / Apache Commons Compress).
- Zero Liquibase changesets (filesystem-only persistence; **no** `ProjectArtifactEntity` row).
- No edits to `ModelController.java`, `ProjectArtifactEntity`, existing 16 Infrastructure grids, existing diagram palette / edges, gateway, mcp-server, or discovery-service.
- No edits to applied changesets (≤125).
- TODO comment style (verbatim): `# TODO: <reason>. Source: <Infrastructure concept> '<entity.name>' (id: <model id>).`
- Block headers (verbatim): `# Infrastructure concept: <ConceptName>`, `# Architecture entity: <entity.name>`, `# Environment: <env.name>`. Optional `# Source model id: <id>` only where useful for traceability.
- Resource naming precedence: reuse `iac_resource_bindings.iac_address` verbatim if present for that Infra entity; else generate `<env-slug>_<kebab(entity.name)>` (e.g. `prod_app_vpc`).
- Resource-type override hierarchy: `terraform_resource_hint` > `iac_resource_bindings.iac_resource_type` > default GCP mapping.
- Hard-fail (4xx) ONLY for: missing `environmentId`; provider not in `iacSourceProviderOptions`; provider not registered in the exporter map (V1: anything other than `GCP`). Hard-fail boundary checks run BEFORE model load.
- All other validation gaps (missing cloud_account, missing location, unsupported compute_type / data store engine / resource_type, unresolved relationship targets, ambiguous Deployment Unit→Compute mappings) are **soft-warn**: TODO comment in the relevant Terraform block AND entry in `warnings.json`. Soft-warns NEVER block the response.
- Slug helper: `name.toLowerCase().replaceAll("[^a-z0-9]+", "_")`.

**Carry-forward test-failure context (do not investigate during this spec):**
- ~117 pre-existing broken backend test files carry forward unchanged. Apply the broken-tests staging workaround (move them temporarily out of `src/test/java`, run targeted tests, restore) at every targeted backend-test verification step.
- Pre-existing frontend failures listed in project memory remain untouched.

**Implementer note — Group 2-4 are the heaviest:** `GcpTerraformExporter` carries 12 entity-type emitter methods, split across 3 sequential groups by complexity (Group 2 = 5 simpler emitters, Group 3 = 3 cross-domain-resolving emitters, Group 4 = 4 remaining emitters). Plan accordingly.

---

## Task List

### Backend — Service Foundation

#### Task Group 1: Strategy Interface + Records + Context Carrier
**Dependencies:** None

- [x] 1.0 Create the foundation interfaces, records, and context carrier under a new `service/export/terraform/` package
  - [x] 1.1 Write 2-3 focused tests for foundation types
    - One test asserting `EmittedResource` is a record with the 4 components (`targetFile`, `hclFragment`, `comments`, `warnings`) and that `comments` / `warnings` default to empty lists when null is supplied (or NPE-safe accessor pattern matches the precedent).
    - One test asserting `TerraformContext` carries the loaded model + selected environment / cloud_account / location / provider and exposes lookup maps usable by relationship resolution.
    - Optionally one test asserting the `TerraformExporter` interface signature matches the contract: `String providerId()` + 12 entity-type emitter methods each returning `List<EmittedResource>`.
    - Bundle into a single test file with 2-3 tightly grouped methods.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/service/export/terraform/TerraformExporterFoundationTest.java`
    - Total tests in this file: 2-3 max.
  - [x] 1.2 Create `TerraformExporter` strategy interface
    - Methods: `String providerId();` plus per-Infra-entity-type emitter methods (each returning `List<EmittedResource>` and accepting the relevant DTO + `TerraformContext`):
      - `exportEnvironment`, `exportCloudAccount`, `exportLocation`, `exportNetwork`, `exportSubnet`, `exportComputeCluster`, `exportComputeResource`, `exportDeploymentUnit`, `exportLoadBalancer`, `exportListener`, `exportDataStoreInstance`, `exportInfrastructureResource`.
    - Default-method bodies are NOT supplied — V1 registers only `GcpTerraformExporter`; future providers implement the same interface.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/TerraformExporter.java`
  - [x] 1.3 Create `EmittedResource` record
    - Components: `String targetFile` (one of `main.tf` / `variables.tf` / `outputs.tf` / `README.md`), `String hclFragment`, `List<String> comments`, `List<String> warnings`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/EmittedResource.java`
  - [x] 1.4 Create `TerraformContext` value class / record
    - Carries: loaded `MetaModelDto` (or equivalent), selected `EnvironmentDto`, optional `CloudAccountDto`, optional `LocationDto`, `String providerId`, plus pre-built lookup maps for relationship resolution:
      - `Map<String, IaCResourceBindingDto>` keyed by `infrastructure_point_id` for stable resource naming + type override.
      - `Map<String, List<ApplicationComputeDeploymentDto>>` keyed by target compute resource id (drives `image` / `artifact_uri` / `version` on Compute Resource emitters).
      - `Map<String, List<ApplicationLoadBalancerExposureDto>>` keyed by load balancer id (drives URL-map host/path + listener port/protocol).
      - `Map<String, List<DataEntityDataStoreHostingDto>>` keyed by data store id (documentation-only comment trail).
      - `Map<String, List<ApplicationInfrastructureResourceUseDto>>` keyed by infrastructure resource id (documentation-only comment trail).
    - Slug helper static method `slugify(String name)` implementing `name.toLowerCase().replaceAll("[^a-z0-9]+", "_")` for reuse by emitters and the assembler.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/TerraformContext.java`
  - [x] 1.5 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround (move ~117 pre-existing broken backend test files temporarily out of `src/test/java`).
    - Run `mvn -pl architecture-model-service compile`.
    - Run ONLY the test from 1.1.
    - Restore broken tests.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 2-3 tests written in 1.1 pass.
- `TerraformExporter` interface compiles with `String providerId()` plus 12 emitter methods, each returning `List<EmittedResource>`.
- `EmittedResource` is a Java record with 4 components and the documented field types.
- `TerraformContext` exposes the loaded model + selected env / cloud_account / location / provider plus the 5 lookup maps, plus a static `slugify` helper.
- Package `service/export/terraform/` is created and compiles cleanly.

---

### Backend — GCP Emitters

#### Task Group 2: GcpTerraformExporter — Network + Subnet + Cloud Account + Location + Environment Emitters
**Dependencies:** Task Group 1

- [x] 2.0 Create `GcpTerraformExporter` and implement the 5 simpler emitter methods (no cross-domain relationship resolution)
  - [x] 2.1 Write 2-8 focused tests for the 5 simpler emitters
    - One test per emitter (5 tests): each asserts the happy-path HCL fragment includes the expected GCP resource type, the standard block headers (`# Infrastructure concept: ...`, `# Architecture entity: ...`, `# Environment: ...`), and the expected resource address (kebab + env-slug pattern).
    - 1-2 additional tests covering TODO-fallback behaviour for an unsupported case (e.g. Network with non-GCP `network_type` → emits `# TODO: ...` comment + entry in returned `warnings`).
    - 1 test asserting `iac_resource_bindings.iac_address` overrides the synthesized address when present.
    - 1 test asserting `terraform_resource_hint` overrides the default GCP resource type.
    - Total tests in this file (cumulative across Groups 2-4): start with 2-8 here; Groups 3 and 4 each add 2-8 more in the same file.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/service/export/terraform/GcpTerraformExporterTest.java`
  - [x] 2.2 Create `GcpTerraformExporter` class scaffolding
    - Annotated `@Component`, implements `TerraformExporter`, `providerId()` returns `"GCP"`.
    - Stub all 12 emitter methods returning empty list initially; fill in 5 in this group, the rest in Groups 3-4.
    - Inject no repositories — the class is pure: it consumes `TerraformContext` and DTOs only.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/GcpTerraformExporter.java`
  - [x] 2.3 Implement `exportEnvironment(EnvironmentDto, TerraformContext)`
    - Emits: `var.environment` declaration in `variables.tf` (description = `"Environment name (e.g. dev, prod)"`, default = `env.name` slugified), plus a `labels = { environment = var.environment }` snippet documented in the README.
    - No standalone `main.tf` resource. README block lists every Infra entity that will pick up this label.
    - Standard block headers prepended.
  - [x] 2.4 Implement `exportCloudAccount(CloudAccountDto, TerraformContext)`
    - Emits provider config block in `main.tf`: `provider "google" { project = var.project_id ... }` plus `var.project_id` declaration in `variables.tf`.
    - If the context's selected cloud account is null/missing → soft-warn TODO + entry in returned `warnings` ("missing cloud_account; falling back to var.project_id placeholder"); provider block still emitted.
    - Standard block headers prepended.
  - [x] 2.5 Implement `exportLocation(LocationDto, TerraformContext)`
    - Emits `var.region` (and `var.zone` if location specifies a zone) declarations in `variables.tf`; provider block consumes `region = var.region`.
    - Soft-warn TODO if location is null/missing; defaults still emitted.
    - Standard block headers prepended.
  - [x] 2.6 Implement `exportNetwork(NetworkDto, TerraformContext)`
    - Default mapping: `google_compute_network`.
    - Address: prefer `iac_resource_bindings.iac_address` via `TerraformContext` lookup; else `<env-slug>_<kebab(network.name)>`.
    - Resource-type override: `terraform_resource_hint` > `iac_resource_bindings.iac_resource_type` > default.
    - `terraform_module_hint` → `# Module hint: <value>` comment line above resource block (no module split).
    - `terraform_notes` → appended verbatim immediately after the standard block headers.
    - `terraform_ready == false` → emit TODO scaffold (resource block kept but flagged with `# TODO: terraform_ready=false. Source: ...`).
    - TODO comment + warning if `network_type` indicates non-GCP-compatible value.
    - Standard block headers prepended.
  - [x] 2.7 Implement `exportSubnet(SubnetDto, TerraformContext)`
    - Default mapping: `google_compute_subnetwork`.
    - Address pattern + readiness-field consumption mirror `exportNetwork`.
    - TODO comment + warning if `cidr` or region is missing.
    - Standard block headers prepended.
  - [x] 2.8 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround.
    - Run `mvn -pl architecture-model-service compile`.
    - Run ONLY the tests from 2.1 (2-8 tests).
    - Restore broken tests.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- `GcpTerraformExporter.providerId()` returns `"GCP"`.
- 5 emitter methods (`exportEnvironment`, `exportCloudAccount`, `exportLocation`, `exportNetwork`, `exportSubnet`) emit the documented HCL with standard block headers.
- `iac_resource_bindings.iac_address` override works for Network + Subnet.
- `terraform_resource_hint` override works for Network + Subnet.
- `terraform_notes` appended verbatim after block headers.
- `terraform_ready == false` produces TODO scaffold (block retained, flagged).
- Soft-warns surface in BOTH `EmittedResource.warnings` AND a `# TODO` line in the HCL fragment.
- Other 7 emitter methods compile (stubs returning empty list).

---

#### Task Group 3: GcpTerraformExporter — Compute Cluster + Compute Resource + Deployment Unit Emitters
**Dependencies:** Task Group 2

- [x] 3.0 Implement the 3 compute-domain emitters that depend on `application_compute_deployments` cross-domain resolution
  - [x] 3.1 Append 2-8 focused tests to `GcpTerraformExporterTest.java`
    - Test: GKE-style Compute Cluster (`compute_type = KUBERNETES` / `GKE`) emits `google_container_cluster` + node-pool TODO scaffold.
    - Test: CLOUD_RUN-style Compute Cluster emits no standalone resource (commented note only).
    - Test: VM-style Compute Resource emits `google_compute_instance` with `image` resolved via `application_compute_deployments`.
    - Test: Cloud-Run-style Compute Resource emits `google_cloud_run_v2_service` with container image resolved via `application_compute_deployments`.
    - Test: Compute Resource with multiple ambiguous Deployment Units → emits soft-warn TODO ("ambiguous DU→CR mapping") AND entry in warnings.
    - Test: Deployment Unit emitter returns empty `List<EmittedResource>` (no standalone resource) — DU's image / artifact / version is documented in the comment trail of the target Compute Resource block instead.
    - Optional 1 test: unsupported Compute Resource sub-type → TODO scaffold + warning.
    - Bundle into 2-8 grouped methods. Cumulative test count in `GcpTerraformExporterTest.java` after this group: ~6-16.
  - [x] 3.2 Implement `exportComputeCluster(ComputeClusterDto, TerraformContext)`
    - `compute_type ∈ {KUBERNETES, GKE}` → `google_container_cluster` block + `# TODO` scaffold for `google_container_node_pool` (separate child block) noting that node-pool fields require completion.
    - `compute_type == CLOUD_RUN` → no standalone resource; emits `# Cloud Run cluster: <name> — implicit, see Compute Resource blocks` documentation-only block with header trio.
    - Other types → TODO scaffold (resource block kept but flagged) + warning.
    - Apply readiness-field consumption (`terraform_resource_hint` override, `terraform_module_hint` comment, `terraform_notes` appended, `terraform_ready=false` flag).
  - [x] 3.3 Implement `exportComputeResource(ComputeResourceDto, TerraformContext)`
    - VM-style (`compute_type ∈ {VM, GCE}`) → `google_compute_instance` with `machine_type`, `boot_disk`, `image` resolved from `application_compute_deployments` lookup map in `TerraformContext`.
    - Cloud-Run service (`compute_type == CLOUD_RUN_SERVICE`) → `google_cloud_run_v2_service` with `template.containers.image` resolved from `application_compute_deployments`.
    - Other types → TODO scaffold + warning.
    - Multiple Deployment Units targeting the same Compute Resource via `application_compute_deployments` AND not unambiguous → soft-warn TODO ("ambiguous DU→CR mapping; expected 1, found N. Source: ...") + entry in warnings.
    - Comment trail per Deployment Unit: `# Deployed by: <DU.name> (id: <id>) — image/artifact/version: <values>`.
    - Apply readiness-field consumption + standard block headers.
  - [x] 3.4 Implement `exportDeploymentUnit(DeploymentUnitDto, TerraformContext)`
    - Returns empty `List<EmittedResource>` (no standalone Terraform resource).
    - Comment trail flows through the `exportComputeResource` emitter via `application_compute_deployments` lookups (above).
    - Method exists on the interface for symmetry; logic is intentionally a no-op.
  - [x] 3.5 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround.
    - Run `mvn -pl architecture-model-service compile`.
    - Run ONLY the cumulative tests in `GcpTerraformExporterTest.java` (~6-16 tests across Groups 2-3).
    - Restore broken tests.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 2-8 tests added in 3.1 pass (cumulative ~6-16 in the file).
- `exportComputeCluster` emits `google_container_cluster` for GKE/KUBERNETES; documentation-only block for CLOUD_RUN; TODO scaffold for unsupported types.
- `exportComputeResource` emits `google_compute_instance` (VM) / `google_cloud_run_v2_service` (Cloud Run) with `image` resolved via `application_compute_deployments`.
- `exportDeploymentUnit` returns empty list (no standalone resource); image / artifact / version flows into the target Compute Resource block instead.
- Ambiguous Deployment Unit → Compute Resource mappings produce soft-warn TODO + warnings.json entry.
- Resource-type override hierarchy + `terraform_notes` + `terraform_ready=false` behaviour consistent with Group 2.

---

#### Task Group 4: GcpTerraformExporter — Load Balancer + Listener + Data Store Instance + Infrastructure Resource Emitters
**Dependencies:** Task Group 3

- [x] 4.0 Implement the remaining 4 emitter methods covering load balancing, data stores, and infrastructure resources
  - [x] 4.1 Append 2-8 focused tests to `GcpTerraformExporterTest.java`
    - Test: Load Balancer emits the GCP composite (`google_compute_backend_service` + `google_compute_url_map` + `google_compute_target_http(s)_proxy` + `google_compute_global_forwarding_rule`).
    - Test: Load Balancer with Cloud Run target backend additionally emits `google_compute_region_network_endpoint_group`.
    - Test: Listener consumes `application_load_balancer_exposures` to drive URL-map `host_name` / `path_pattern` and listener port/protocol.
    - Test: Data Store Instance (relational, e.g. `engine = POSTGRES` / `MYSQL`) emits `google_sql_database_instance` plus `google_sql_database` if a database name is available.
    - Test: Data Store Instance (cache, `engine = REDIS`) emits `google_redis_instance`.
    - Test: Infrastructure Resource `OBJECT_BUCKET` emits `google_storage_bucket`; `MESSAGE_TOPIC` emits `google_pubsub_topic`; `SECRET_STORE` emits `google_secret_manager_secret` and **never** includes a value.
    - Test: Infrastructure Resource `CACHE` with same reference as a Data Store cache → emits a dedupe note comment instead of a duplicate `google_redis_instance`.
    - Test: Unsupported sub-type (e.g. Data Store `engine = BIGQUERY`, Infrastructure Resource `type = CUSTOM`) → TODO scaffold + warning.
    - Bundle into 2-8 grouped methods. Cumulative test count in `GcpTerraformExporterTest.java` after this group: ~8-24.
  - [x] 4.2 Implement `exportLoadBalancer(LoadBalancerDto, TerraformContext)`
    - Emits the composite: `google_compute_backend_service` + `google_compute_url_map` + `google_compute_target_http_proxy` (or `google_compute_target_https_proxy` if certificate available) + `google_compute_global_forwarding_rule`.
    - If any backend resolves to a Cloud Run service → additionally emit `google_compute_region_network_endpoint_group`.
    - URL-map host_name / path_pattern rules driven by `application_load_balancer_exposures` lookup map in `TerraformContext`.
    - TODO scaffold + warning if backend resolution is incomplete.
    - Apply readiness-field consumption + standard block headers.
  - [x] 4.3 Implement `exportListener(ListenerDto, TerraformContext)`
    - Emits forwarding-rule port/protocol fields plus URL-map host/path rules driven by `application_load_balancer_exposures`.
    - If parent Load Balancer is unresolved → soft-warn TODO + warning.
    - Standard block headers + readiness-field consumption.
  - [x] 4.4 Implement `exportDataStoreInstance(DataStoreInstanceDto, TerraformContext)`
    - Relational (`engine ∈ {POSTGRES, MYSQL, SQLSERVER}`) → `google_sql_database_instance` (+ `google_sql_database` if a database name is available).
    - Cache (`engine == REDIS`) → `google_redis_instance`.
    - Other engines (BIGQUERY, ALLOYDB, etc.) → TODO scaffold + warning.
    - Comment trail from `data_entity_data_store_hostings` lookup: `# Hosts data entity: <DataEntity.name> (id: <id>)`.
    - Apply readiness-field consumption + standard block headers.
  - [x] 4.5 Implement `exportInfrastructureResource(InfrastructureResourceDto, TerraformContext)`
    - Type mapping table:
      - `OBJECT_BUCKET` → `google_storage_bucket`.
      - `MESSAGE_TOPIC` → `google_pubsub_topic`.
      - `MESSAGE_QUEUE` → `google_pubsub_subscription`.
      - `CACHE` → `google_redis_instance`. **Dedupe note** if the same external reference also appears as a Data Store Instance cache (do not emit a duplicate resource block; emit a `# Dedupe: see google_redis_instance.<addr> on Data Store Instance ...` comment instead).
      - `SECRET_STORE` → `google_secret_manager_secret`. **Never** include `secret_data` / version values.
      - `SCHEDULER` → `google_cloud_scheduler_job`.
      - Other types → TODO scaffold + warning.
    - Comment trail from `application_infrastructure_resource_uses` lookup: `# Used by application: <Application.name> (id: <id>)`.
    - Apply readiness-field consumption + standard block headers.
  - [x] 4.6 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround.
    - Run `mvn -pl architecture-model-service compile`.
    - Run ONLY the cumulative tests in `GcpTerraformExporterTest.java` (~8-24 tests across Groups 2-4).
    - Restore broken tests.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 2-8 tests added in 4.1 pass (cumulative ~8-24 in the file).
- All 12 entity-type emitter methods on `GcpTerraformExporter` are implemented.
- Load Balancer composite emits all 4-5 GCP resources; Listener drives URL-map host/path + port/protocol from `application_load_balancer_exposures`.
- Data Store Instance + Infrastructure Resource type-mapping tables produce the documented GCP resources or TODO scaffolds.
- `SECRET_STORE` resources NEVER include secret values.
- `CACHE` Infrastructure Resource dedupes against a same-reference Data Store cache instead of duplicating.
- Documentation-only comment trails from `data_entity_data_store_hostings` and `application_infrastructure_resource_uses` appear on the relevant blocks.
- All readiness-field consumption (override hierarchy, module hint, notes, ready=false flag) consistent across all 12 emitters.

---

### Backend — Assembly + Service + Filesystem

#### Task Group 5: TerraformAssembler + TerraformExportService + Filesystem Dual-Write + ZIP Construction
**Dependencies:** Task Group 4

- [x] 5.0 Build the orchestration layer that consumes `EmittedResource` lists and produces the 5-file ZIP plus filesystem dual-write
  - [x] 5.1 Write 2-8 focused tests for the assembler + service
    - Test: `TerraformAssembler` concatenates `EmittedResource` fragments by `targetFile`, prepending `# Infrastructure concept: <ConceptName>` block headers grouping resources by concept.
    - Test: `TerraformAssembler` parses a representative `terraform_variable_hints` raw-JSON-string (e.g. `[{"name":"image_tag","description":"Container image tag","default":"latest"}]`) and emits a `variable "image_tag" { type = string description = "..." default = "latest" }` block in `variables.tf`. Type defaults to `string` when not specified.
    - Test: `TerraformAssembler` produces `warnings.json` aggregating all warnings across all `EmittedResource`s.
    - Test: `TerraformAssembler` produces a `README.md` describing the export contents (one section per Infrastructure concept).
    - Test: `TerraformExportService.exportTerraform(...)` happy path returns ZIP bytes with all 5 entries (`main.tf`, `variables.tf`, `outputs.tf`, `README.md`, `warnings.json`).
    - Test: `TerraformExportService` dual-writes the 4 `.tf`/`.md` files to `{projectParentFolder}/exports/terraform/<arch-slug>_<env-slug>_<timestamp>/` (assert via mocked filesystem or temp directory).
    - Test: `TerraformExportService` hard-fails (throws / returns 4xx-eligible error) when `provider == "AWS"` (V1: only GCP registered).
    - Test: `TerraformExportService` hard-fails when `environmentId == null`.
    - Bundle into 2-8 grouped methods.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/service/export/terraform/TerraformExportServiceTest.java`
  - [x] 5.2 Create `TerraformAssembler`
    - Annotated `@Component`, no Spring dependencies (pure utility).
    - Method `AssembledArtifacts assemble(List<EmittedResource> emitted, TerraformContext context)`.
    - Concatenation logic: group by `targetFile` (`main.tf` / `variables.tf` / `outputs.tf` / `README.md`), prepend per-concept block headers in `main.tf`.
    - `terraform_variable_hints` parsing: walk every entity in the loaded model, parse the raw JSON string, emit one `variable "<name>" { ... }` block per entry; default `type = string` when absent; propagate `description` / `default` if present.
    - `warnings.json` builder: aggregate all warnings across `EmittedResource`s into a JSON array of `{ entity_id, entity_name, concept, message }` objects (or simpler `{message}` if entity context is unavailable).
    - `README.md` builder: top-level section "Infrastructure Terraform export", per-concept sections summarising emitted resources + counts.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/TerraformAssembler.java`
  - [x] 5.3 Create `TerraformExportService` orchestrator
    - Annotated `@Service`. Constructor-injected:
      - `ModelService modelService` (for `loadModelByProjectAndArchitecture`).
      - `Map<String, TerraformExporter> exporters` (Spring auto-wires by `providerId()`).
      - `TerraformAssembler assembler`.
    - Constants: `TERRAFORM_SUBDIR = "terraform"`. **Reuse** `EXPORTS_SUBDIR` and `TIMESTAMP_FORMAT` constants from `DiagramExportService` (extract to a shared helper if not already shared, or duplicate the constant value with a `// mirrors DiagramExportService` comment — match existing repo convention).
    - Method `TerraformExportResult exportTerraform(UUID projectId, UUID architectureId, UUID environmentId, UUID cloudAccountId, UUID locationId, String providerId)`:
      1. **Hard-fail boundary checks (BEFORE model load):**
         - `environmentId == null` → throw `IllegalArgumentException` (mapped to 4xx by controller).
         - `providerId == null || !iacSourceProviderOptionsBackendMirror.contains(providerId)` → throw `IllegalArgumentException`. (Backend keeps a private `Set<String>` mirroring the frontend `iacSourceProviderOptions`; or queries it from a shared config object if such already exists.)
         - `!exporters.containsKey(providerId)` → throw `IllegalArgumentException` ("provider not registered: <id>").
      2. Load model via `modelService.loadModelByProjectAndArchitecture(projectId, architectureId)`.
      3. Resolve selected `EnvironmentDto`, optional `CloudAccountDto` / `LocationDto` from the loaded model (soft-warn if cloud_account / location is missing).
      4. Build `TerraformContext` with the 5 lookup maps populated from the loaded relationships.
      5. Walk all 12 Infra entity types and dispatch to the corresponding `TerraformExporter` emitter method. Concatenate all `List<EmittedResource>`.
      6. Pass `EmittedResource` list to `assembler.assemble(...)` to produce the 4 file contents + `warnings.json` payload.
      7. **Filesystem dual-write:** mirror `DiagramExportService.exportAllDiagramsAsZip` precedent. Resolve `projectParentFolder` via existing helper. Create `{projectParentFolder}/exports/terraform/<arch-slug>_<env-slug>_<timestamp>/`. Write `main.tf`, `variables.tf`, `outputs.tf`, `README.md` (NOT `warnings.json` — only inside ZIP).
      8. **ZIP construction:** in-memory `ByteArrayOutputStream` + `ZipOutputStream` (no Apache Commons Compress). 5 entries: `main.tf`, `variables.tf`, `outputs.tf`, `README.md`, `warnings.json`.
      9. Return `TerraformExportResult(byte[] zipBytes, String downloadFileName)` where `downloadFileName = "<arch-slug>_<env-slug>_<timestamp>_terraform.zip"`.
    - Define inner result record `TerraformExportResult(byte[] zipBytes, String downloadFileName)` parallel to `DiagramExportService.AllDiagramsExportResult`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/TerraformExportService.java`
  - [x] 5.4 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround.
    - Run `mvn -pl architecture-model-service compile`.
    - Run ONLY the tests from 5.1 (2-8 tests).
    - Restore broken tests.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass.
- `TerraformAssembler` correctly concatenates by `targetFile`, builds `variables.tf` from `terraform_variable_hints` JSON, builds `warnings.json`, builds `README.md`.
- `TerraformExportService` hard-fails BEFORE model load when: `environmentId` missing, provider not in `iacSourceProviderOptions`, provider not registered.
- `TerraformExportService` produces ZIP with 5 entries (`main.tf`, `variables.tf`, `outputs.tf`, `README.md`, `warnings.json`).
- Filesystem dual-write writes 4 files (NOT `warnings.json`) to `{projectParentFolder}/exports/terraform/<arch-slug>_<env-slug>_<timestamp>/`.
- ZIP construction uses only `java.util.zip.{ZipOutputStream, ZipEntry}`; no new dependency added.
- Soft-warns surface in `warnings.json` AND inline `# TODO` comments without blocking the response.

---

### Backend — Controller + Golden-File Snapshot

#### Task Group 6: InfrastructureTerraformExportController + Golden-File Snapshot Test + MockMvc Integration Test
**Dependencies:** Task Group 5

- [x] 6.0 Expose the export endpoint via a new controller and lock the output via a golden-file snapshot fixture
  - [x] 6.1 Write 2-8 focused tests for the controller + golden-file snapshot
    - Test (`InfrastructureTerraformExportControllerTest.java`, MockMvc): `200 OK` for valid request; response `Content-Type` is `application/zip`; `Content-Disposition` matches `attachment; filename="<arch-slug>_<env-slug>_<timestamp>_terraform.zip"`; ZIP body contains all 5 entries.
    - Test (controller): `400 Bad Request` when `environmentId` query param is missing.
    - Test (controller): `400 Bad Request` when `provider == "AWS"` (V1: only GCP registered).
    - Test (controller): `400 Bad Request` when `provider` is not in `iacSourceProviderOptions`.
    - Test (`TerraformExportGoldenFileTest.java`, snapshot): given the fixed input model (1 VPC + 1 subnet + 1 GKE cluster + 1 Cloud SQL + 1 GCS bucket + 1 Cloud Run service + 1 LB+listener) loaded from a JSON fixture, run the full export and assert each of `main.tf` / `variables.tf` / `outputs.tf` / `README.md` matches the committed golden file byte-for-byte.
    - Bundle controller tests into 2-4 grouped methods; golden-file snapshot is a single method.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/controller/InfrastructureTerraformExportControllerTest.java`
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/service/export/terraform/TerraformExportGoldenFileTest.java`
  - [x] 6.2 Create `InfrastructureTerraformExportController`
    - Annotated `@RestController`, `@RequestMapping("/api/model")`.
    - Constructor-injected `TerraformExportService`.
    - Single endpoint:
      ```java
      @GetMapping("/projects/{projectId}/architectures/{architectureId}/infrastructure/export-terraform")
      public ResponseEntity<byte[]> exportTerraform(
          @PathVariable UUID projectId,
          @PathVariable UUID architectureId,
          @RequestParam UUID environmentId,
          @RequestParam(required = false) UUID cloudAccountId,
          @RequestParam(required = false) UUID locationId,
          @RequestParam String provider)
      ```
    - Body: call `terraformExportService.exportTerraform(...)`. Return `ResponseEntity.ok()` with `MediaType.valueOf("application/zip")` and `Content-Disposition` `attachment; filename="<result.downloadFileName()>"` and body `result.zipBytes()`.
    - Catch `IllegalArgumentException` from the service hard-fails → return `ResponseEntity.badRequest().build()` (or matching repo convention via `@ControllerAdvice`).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/controller/InfrastructureTerraformExportController.java`
    - **Reference:** `ModelController.java` lines 367-387 for the verbatim `application/zip` + `Content-Disposition` shape.
  - [x] 6.3 Build the golden-file fixture model and goldens under `src/test/resources/terraform-export/`
    - Create directory: `architecture-model-service/src/test/resources/terraform-export/`.
    - Input fixture: `architecture-model-service/src/test/resources/terraform-export/input-model.json` containing a self-contained Infrastructure model with:
      - 1 Environment (`prod`).
      - 1 Cloud Account (GCP project `my-project`).
      - 1 Location (`europe-west1`).
      - 1 Network (`prod_app_vpc`).
      - 1 Subnet (`prod_app_subnet`).
      - 1 Compute Cluster (`prod_app_gke`, `compute_type = KUBERNETES`).
      - 1 Compute Resource (`prod_app_run`, `compute_type = CLOUD_RUN_SERVICE`).
      - 1 Deployment Unit (`app_image`) feeding the Cloud Run service via `application_compute_deployments`.
      - 1 Data Store Instance (`prod_app_db`, `engine = POSTGRES`).
      - 1 Infrastructure Resource (`prod_app_assets`, `type = OBJECT_BUCKET`).
      - 1 Load Balancer + 1 Listener with `application_load_balancer_exposures` to the Cloud Run service.
    - Goldens: `main.tf`, `variables.tf`, `outputs.tf`, `README.md` committed under `architecture-model-service/src/test/resources/terraform-export/expected/`.
    - First test run will fail; capture the actual output, manually review it for correctness against the spec's mapping table + comment style, then write it as the goldens. Subsequent runs assert byte-equal.
    - **Reference:** spec acknowledges this is a NEW pattern, scoped to one test class.
  - [x] 6.4 Implement `TerraformExportGoldenFileTest`
    - Loads `input-model.json` via Jackson into the model graph the service expects.
    - Calls `TerraformExportService.exportTerraform(...)` against the in-memory model (mock `ModelService.loadModelByProjectAndArchitecture` to return the fixture).
    - Reads the resulting ZIP entries via `ZipInputStream`.
    - Asserts each of `main.tf` / `variables.tf` / `outputs.tf` / `README.md` matches the committed golden file byte-for-byte (`assertArrayEquals` or `assertThat(actual).isEqualTo(expected)`).
    - `warnings.json` is NOT byte-equal-asserted (its order may vary); instead assert it exists and is parseable JSON with the expected warnings.
    - Use a fixed timestamp (inject a `Clock` bean, or stub the `TIMESTAMP_FORMAT` resolution) so filenames are deterministic.
  - [x] 6.5 Implement `InfrastructureTerraformExportControllerTest` (MockMvc)
    - Mirror `DiagramExportControllerTest.java` shape: mock `TerraformExportService`, build `MockMvc` standalone, assert headers + bytes + filename pattern.
    - 2-4 tests covering happy path + 3 hard-fail conditions.
  - [x] 6.6 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround.
    - Run `mvn -pl architecture-model-service compile`.
    - Run ONLY the tests from 6.1 (controller MockMvc tests + golden-file snapshot test, 2-8 tests).
    - Restore broken tests.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass.
- `InfrastructureTerraformExportController` exposes `GET /api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/export-terraform` returning `application/zip`.
- Filename pattern: `<arch-slug>_<env-slug>_<timestamp>_terraform.zip`.
- ZIP entries: `main.tf`, `variables.tf`, `outputs.tf`, `README.md`, `warnings.json`.
- Hard-fail (`400 Bad Request`) when `environmentId` missing, provider unknown, or provider not registered.
- Golden-file snapshot test asserts byte-equal output for `main.tf` / `variables.tf` / `outputs.tf` / `README.md` against the committed goldens for the canonical 7-entity input fixture.
- `ModelController.java` is **NOT** modified.

---

### Frontend — Modal + Menu + API Client

#### Task Group 7: Frontend Modal, Menu Entry, API Helper, and Tests
**Dependencies:** Task Group 6

- [x] 7.0 Wire the export feature into the frontend: API helper, modal, FileMenu entry, and 2 tests
  - [x] 7.1 Write 2-8 focused tests
    - **`InfrastructureTerraformExportModal.test.tsx`** (modal-render smoke + download flow):
      - Test: modal renders Environment (required dropdown), Cloud Account (optional), Location (optional), Provider (required dropdown with `GCP` enabled and `AWS` / `AZURE` / `ON_PREM` / `MULTI` / `OTHER` rendered as disabled with "Coming soon" tooltip).
      - Test: submit button is disabled until both Environment and Provider are set.
      - Test: post-submit (with mocked `exportInfrastructureTerraform` returning a fake ZIP `Response`), modal parses `warnings.json` from the ZIP and displays the warnings list inline; "Download ZIP" button appears.
      - Test: clicking "Download ZIP" triggers `URL.createObjectURL` and uses `parseContentDispositionFilename` for the download filename.
    - **`modelApi.exportInfrastructureTerraform.test.ts`** (or appended to an existing `modelApi.test.ts` if convention allows):
      - Test: `exportInfrastructureTerraform(projectId, architectureId, options)` mocks `fetch` and asserts the request URL matches `/api/model/projects/<projectId>/architectures/<architectureId>/infrastructure/export-terraform?environmentId=...&cloudAccountId=...&locationId=...&provider=GCP` with all query params correctly URL-encoded.
      - Test: optional `cloudAccountId` / `locationId` are omitted from the URL when not provided.
      - Test: the function returns the raw `Response` object (not a parsed body) — mirrors `exportAllDiagramsAsZip`.
    - Bundle into 2-8 grouped methods across both files.
    - **Files:**
      - `frontend/src/components/Export/__tests__/InfrastructureTerraformExportModal.test.tsx`
      - `frontend/src/api/__tests__/modelApi.exportInfrastructureTerraform.test.ts` (or appended to existing `modelApi.test.ts` per repo convention)
  - [x] 7.2 Append `exportInfrastructureTerraform` to `frontend/src/api/modelApi.ts`
    - Signature: `exportInfrastructureTerraform(projectId: string, architectureId: string, options: { environmentId: string; cloudAccountId?: string; locationId?: string; provider: string }): Promise<Response>`.
    - Returns the raw `Response` (caller handles `.blob()` and `parseContentDispositionFilename`). Mirrors `exportAllDiagramsAsZip(...)`.
    - Builds the URL with all 4 query params; omits optional ones when undefined.
    - **File:** `frontend/src/api/modelApi.ts`
  - [x] 7.3 Create `InfrastructureTerraformExportModal.tsx`
    - Form fields:
      - **Environment** (required): dropdown sourced from `metaModel.entities.environments`. Display `name`; submit value is `id`.
      - **Cloud Account** (optional): dropdown sourced from `metaModel.entities.cloud_accounts`. Display `name`; submit value is `id`.
      - **Location** (optional): dropdown sourced from `metaModel.entities.locations`. Display `name`; submit value is `id`.
      - **Provider** (required): dropdown sourced from `iacSourceProviderOptions` imported from `frontend/src/config/defaults.ts` line 1321. V1 only `GCP` is enabled. Other entries (`AWS`, `AZURE`, `ON_PREM`, `MULTI`, `OTHER`) render greyed/disabled with "Coming soon" tooltip.
    - Submit button disabled until both Environment and Provider are set.
    - Post-submit:
      - Call `exportInfrastructureTerraform(...)`.
      - Parse the returned `Response` as a blob.
      - Read the ZIP in-browser (use `JSZip` IF already a dependency; otherwise extract `warnings.json` via a minimal hand-rolled inflate helper, OR display warnings.json server-roundtrip-only — pick whichever matches the existing repo-stated approach. **Verify dependency presence first**; if neither `JSZip` nor existing helpers exist, fall back to the simplest approach: skip in-modal warnings parsing and rely on the user opening the ZIP themselves. The spec requirement is "warnings list inline"; if no JSZip-equivalent is present, document the limitation in code comments and surface only a "Download ZIP" button + a "(open ZIP for warnings)" hint).
      - Display warnings list inline (one row per warning).
      - Show "Download ZIP" button using `URL.createObjectURL` + `parseContentDispositionFilename` from `frontend/src/utils/parseContentDispositionFilename.ts`.
    - Mirror layout / styling of `frontend/src/components/Export/ExportProjectNameModal.tsx`.
    - **File:** `frontend/src/components/Export/InfrastructureTerraformExportModal.tsx`
    - **Companion CSS:** `frontend/src/components/Export/InfrastructureTerraformExportModal.module.css` (mirror `ExportProjectNameModal.module.css`).
  - [x] 7.4 Append menu item to `FileMenu.tsx`
    - Add "Export Infrastructure as Terraform..." entry to the existing Export group, parallel to JSON / XLSX entries.
    - Disabled unless: model is loaded AND `metaModel.entities.environments.length > 0` (at least one Environment exists in the Infrastructure domain).
    - On click: opens the new `InfrastructureTerraformExportModal`.
    - **File:** `frontend/src/components/TopBar/FileMenu.tsx`
  - [x] 7.5 Verify TypeScript compiles + targeted tests pass
    - Run `npx tsc --noEmit` from `frontend/`. Verify zero new TypeScript errors.
    - Run ONLY the tests from 7.1 (modal smoke + API helper test, 2-8 tests). Use `npx vitest run <test-file-path>` to scope to the new test files.
    - Do NOT run the full Vitest suite at this stage (full sweep happens in Group 8).

**Acceptance Criteria:**
- The 2-8 tests written in 7.1 pass.
- `modelApi.exportInfrastructureTerraform(...)` returns raw `Response`, mirroring `exportAllDiagramsAsZip`.
- Modal renders all 4 fields with correct required/optional gating; Provider dropdown shows GCP enabled and other 5 options disabled with "Coming soon" tooltip.
- Submit disabled until Environment + Provider set.
- Post-submit: warnings list (if dependency available) + Download ZIP button using `URL.createObjectURL` + `parseContentDispositionFilename`.
- FileMenu entry sits parallel to JSON / XLSX exports; disabled unless model loaded + at least one Environment exists.
- `iacSourceProviderOptions` from `defaults.ts:1321` is imported and reused, **NOT** redeclared.
- `npx tsc --noEmit` reports zero new TypeScript errors.

---

### Verification

#### Task Group 8: Full Verification Sweep
**Dependencies:** Task Groups 1-7

- [x] 8.0 Confirm net new failures = 0 across backend + frontend
  - [x] 8.1 Review existing tests from Task Groups 1-7
    - Backend: 1.1 (2-3 tests), 2.1 (2-8 tests), 3.1 (2-8 tests appended to `GcpTerraformExporterTest.java`), 4.1 (2-8 tests appended to `GcpTerraformExporterTest.java`), 5.1 (2-8 tests in `TerraformExportServiceTest.java`), 6.1 (2-8 tests across `InfrastructureTerraformExportControllerTest.java` + `TerraformExportGoldenFileTest.java`).
    - Frontend: 7.1 (2-8 tests across `InfrastructureTerraformExportModal.test.tsx` + `modelApi.exportInfrastructureTerraform.test.ts`).
    - Backend total: ~14-43 tests across 5 test files.
    - Frontend total: ~2-8 tests across 2 test files.
  - [x] 8.2 Analyse test coverage gaps for THIS feature only
    - Most coverage already in place: foundation types (1.1), 12 emitters (2.1+3.1+4.1), assembler+service hard-fails+ZIP+dual-write (5.1), controller+golden-file (6.1), frontend modal+API (7.1).
    - Identify any critical gaps (e.g. an end-to-end "model save → architecture load → export → ZIP" smoke that none of the above already covers). Add up to 0-3 strategic tests if a critical gap exists; skip if existing tests are sufficient.
    - Do NOT assess entire-app coverage; focus only on this spec's surface.
  - [x] 8.3 Optionally add up to 10 strategic tests to fill identified gaps
    - Likely 0-3 additional tests at most. Candidates:
      - 1 backend integration test: full `ModelService` → `TerraformExportService` → controller pipeline against a small in-memory model (only if the golden-file test isn't already covering this).
      - 1 frontend test: `FileMenu` entry disabled state when no Environment exists.
    - Bundle into the existing test files where possible; only create new files if no reasonable home exists.
    - Maximum 10 new tests in this group; prefer 0-3.
  - [x] 8.4 Run targeted verification sweep
    - **Backend:** apply broken-tests staging workaround (move ~117 pre-existing broken backend test files temporarily out of `src/test/java`). Run ONLY the targeted tests from Task Groups 1, 2, 3, 4, 5, 6, plus any added in 8.3. Restore broken tests after.
      - Expected total backend tests: ~14-46.
    - **Frontend:**
      - Run `npx tsc --noEmit` from `frontend/` — zero new errors.
      - Run targeted Vitest on the 2 new test files (7.1 + any from 8.3) in isolation to confirm they pass.
      - Run the full Vitest sweep on `frontend/`. Confirm net new failures = 0 (compare against pre-existing failures captured in project memory: `bootstrap-summary-fetching.test.ts`, `chatV2-panel-*`, etc.).
    - Expected total feature-specific tests: backend ~14-46 + frontend ~2-11 = ~16-57.
  - [x] 8.5 Confirm contract compliance (manual checklist review)
    - snake_case JSON throughout backend payloads — verify by inspecting `warnings.json` output.
    - Mirror `DiagramExportService` exactly — verify ZIP construction code matches the precedent (no Apache Commons Compress, in-memory `ByteArrayOutputStream` + `ZipOutputStream`, dual-write pattern).
    - Reuse `iacSourceProviderOptions` from `defaults.ts:1321` — verify modal imports do NOT redeclare.
    - Strategy interface registered by `providerId()` in `Map<String, TerraformExporter>` — V1 registers only `GcpTerraformExporter`. Verify Spring auto-wiring picks up only the GCP bean.
    - Zero Liquibase changesets — verify `db.changelog-master.yaml` was NOT modified.
    - No new templating dependency — verify `pom.xml` was NOT modified.
    - No edits to `ModelController.java` — verify via git diff.
    - No edits to applied changesets (≤125) — verify via git diff.
    - TODO comment style + block headers + resource naming match locked contract.
    - Hard-fail vs soft-warn boundary matches locked contract.

**Acceptance Criteria:**
- All targeted backend tests pass after broken-tests staging workaround applied (~14-46 tests).
- All targeted frontend tests pass (~2-11 tests).
- `npx tsc --noEmit` from `frontend/` reports zero errors.
- Full Vitest sweep on `frontend/` shows net new failures = 0 (only previously-known pre-existing failures remain).
- No more than 10 additional tests added in 8.3 (likely 0-3).
- Contract compliance checklist (8.5) passes: snake_case JSON, mirrored `DiagramExportService` ZIP+dual-write, reused `iacSourceProviderOptions`, strategy-bean registration, zero Liquibase changesets, no new dependency, no edits to existing controllers / applied changesets.
- Testing focused exclusively on this spec's feature requirements; no broader application test-coverage work attempted.

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Foundation interfaces + records** — `TerraformExporter` interface, `EmittedResource` record, `TerraformContext`. Everything below depends on these types.
2. **Task Group 2: GcpTerraformExporter — Network + Subnet + Cloud Account + Location + Environment Emitters** — 5 simpler emitters that don't need cross-domain relationship resolution. Establishes the readiness-field consumption + override-hierarchy patterns reused in Groups 3 and 4.
3. **Task Group 3: GcpTerraformExporter — Compute Cluster + Compute Resource + Deployment Unit Emitters** — 3 emitters that consume `application_compute_deployments` cross-domain lookup map.
4. **Task Group 4: GcpTerraformExporter — Load Balancer + Listener + Data Store Instance + Infrastructure Resource Emitters** — remaining 4 emitters covering the rest of the GCP mapping table (incl. `application_load_balancer_exposures` lookup and SECRET_STORE never-include-values rule).
5. **Task Group 5: TerraformAssembler + TerraformExportService + Filesystem Dual-Write + ZIP Construction** — orchestration layer that consumes all 12 emitters' output, parses `terraform_variable_hints` JSON, builds `warnings.json` + `README.md`, dual-writes to filesystem, returns ZIP bytes.
6. **Task Group 6: InfrastructureTerraformExportController + Golden-File Snapshot Test + MockMvc Integration Test** — endpoint + 2 integration test classes + new test-resources fixture directory under `src/test/resources/terraform-export/`.
7. **Task Group 7: Frontend Modal + Menu + API Client** — `modelApi.exportInfrastructureTerraform`, `InfrastructureTerraformExportModal.tsx`, `FileMenu.tsx` entry, 2 frontend tests.
8. **Task Group 8: Full Verification Sweep** — targeted backend tests (broken-tests staging), `npx tsc --noEmit`, full Vitest sweep with net-new-failures=0, contract compliance checklist.

---

## File Summary

### Backend Files to Create (~10)

**Service package `service/export/terraform/` (6):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/TerraformExporter.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/EmittedResource.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/TerraformContext.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/GcpTerraformExporter.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/TerraformAssembler.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/TerraformExportService.java`

**Controller (1):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/InfrastructureTerraformExportController.java`

**Backend test files (5):**
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/export/terraform/TerraformExporterFoundationTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/export/terraform/GcpTerraformExporterTest.java` (cumulative across Groups 2, 3, 4)
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/export/terraform/TerraformExportServiceTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/export/terraform/TerraformExportGoldenFileTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/InfrastructureTerraformExportControllerTest.java`

**Backend test fixtures (5 files under one new directory):**
- `architecture-model-service/src/test/resources/terraform-export/input-model.json`
- `architecture-model-service/src/test/resources/terraform-export/expected/main.tf`
- `architecture-model-service/src/test/resources/terraform-export/expected/variables.tf`
- `architecture-model-service/src/test/resources/terraform-export/expected/outputs.tf`
- `architecture-model-service/src/test/resources/terraform-export/expected/README.md`

### Backend Files to Modify (0)
- **None.** No edits to `ModelController.java`, no Liquibase changesets, no `pom.xml` changes, no edits to existing entity / DTO / repository / service classes. Spring auto-wires the new `@Component` / `@Service` beans.

### Frontend Files to Create (1 + 1 CSS + 2 tests)
- `frontend/src/components/Export/InfrastructureTerraformExportModal.tsx`
- `frontend/src/components/Export/InfrastructureTerraformExportModal.module.css`
- `frontend/src/components/Export/__tests__/InfrastructureTerraformExportModal.test.tsx`
- `frontend/src/api/__tests__/modelApi.exportInfrastructureTerraform.test.ts` (or appended to existing `modelApi.test.ts` per repo convention)

### Frontend Files to Modify (2)
- `frontend/src/api/modelApi.ts` (append `exportInfrastructureTerraform` function).
- `frontend/src/components/TopBar/FileMenu.tsx` (append "Export Infrastructure as Terraform..." entry to existing Export group; opens new modal).

### Files Explicitly NOT to Touch
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelController.java` — new controller, not folded in.
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` — zero changesets in this spec.
- All applied Liquibase changesets `001-` through `125-` — never amend.
- All existing entity / DTO / repository / service classes from specs 1-7 — read-only at export time.
- `frontend/src/config/defaults.ts` `iacSourceProviderOptions` (line 1321) — reused, NOT redeclared.
- All 16 existing Infrastructure grid configs in `frontend/src/config/gridConfigs.ts` — unchanged.
- `frontend/src/utils/relationshipUtils.ts`, `frontend/src/utils/rendering.ts`, `frontend/src/utils/paletteData.ts`, `frontend/src/components/SelectionInspector/SelectionInspector.tsx` — no diagram support for Terraform exports.
- `gateway/`, `mcp-server/`, `discovery-service/` — zero code changes.
- `pom.xml` — no new dependency added.

---

## Reference Patterns

### Existing Code to Follow

- **`architecture-model-service/src/main/java/com/example/architecturemodel/service/DiagramExportService.java`** — direct template for `TerraformExportService`:
  - In-memory ZIP construction via `ByteArrayOutputStream` + `ZipOutputStream` + `ZipEntry`.
  - Filesystem dual-write to `{projectParentFolder}/exports/diagrams/...` — mirror with `TERRAFORM_SUBDIR = "terraform"`.
  - `EXPORTS_SUBDIR` constant + `TIMESTAMP_FORMAT` constant — reuse verbatim.
  - Filename normaliser (lowercase + whitespace→`-` + special chars stripped) — adapt to the slug helper `name.toLowerCase().replaceAll("[^a-z0-9]+", "_")`.
  - Result record shape (`AllDiagramsExportResult(byte[] zipBytes, String downloadFileName)`) — mirror as `TerraformExportResult`.

- **`architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelController.java` lines 367-387** — direct template for `InfrastructureTerraformExportController`:
  - `application/zip` MediaType, `Content-Disposition: attachment; filename="..."` header pattern, `ResponseEntity<byte[]>` shape.

- **`architecture-model-service/src/test/.../controller/DiagramExportControllerTest.java`** — direct template for `InfrastructureTerraformExportControllerTest`:
  - Mock the service, build standalone MockMvc, assert ZIP headers + bytes + filename pattern.

- **`ModelService.loadModelByProjectAndArchitecture(UUID projectId, UUID architectureId)`** — entry point reused by `TerraformExportService` for architecture-scoped model loading. No changes required.

- **Spec 1 + Spec 6 + Spec 7 DTOs** — read-only. All fields consumed by emitters via existing `@JsonProperty("snake_case")` accessors. No DTO changes in this spec.
  - Spec 7 readiness fields drive override / TODO behaviour: `terraform_resource_hint`, `terraform_module_hint`, `terraform_variable_hints` (raw JSON), `terraform_notes`, `terraform_ready`.
  - Spec 6 cross-domain relationships drive container image / URL-map: `application_compute_deployments`, `application_load_balancer_exposures`. `data_entity_data_store_hostings` and `application_infrastructure_resource_uses` drive documentation-only comment trails.
  - Spec 7 `iac_resource_bindings.iac_address` drives stable resource naming.

- **`frontend/src/api/modelApi.ts` `exportAllDiagramsAsZip(...)`** — direct template for new `exportInfrastructureTerraform(...)`: raw `Response` return, blob handling, `parseContentDispositionFilename` usage.

- **`frontend/src/components/Export/ExportProjectNameModal.tsx`** — direct template for `InfrastructureTerraformExportModal.tsx`: form layout, submit-disabled gating, post-submit download flow.

- **`frontend/src/components/Export/ExportProjectNameModal.module.css`** — direct template for `InfrastructureTerraformExportModal.module.css`.

- **`frontend/src/utils/parseContentDispositionFilename.ts`** — used to extract download filename from response; consumed by the modal's "Download ZIP" handler.

- **`frontend/src/config/defaults.ts` line 1321 `iacSourceProviderOptions`** — provider dropdown source; imported as-is, NOT redeclared.

### Key Decisions to Honour (Locked Contract)

1. **Endpoint:** `GET /api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/export-terraform?environmentId=&cloudAccountId=&locationId=&provider=GCP`. NOT folded into `ModelController`.
2. **Filesystem dual-write:** mirror `DiagramExportService` exactly. Constant `TERRAFORM_SUBDIR = "terraform"`. Reuse `EXPORTS_SUBDIR` + `TIMESTAMP_FORMAT`.
3. **ZIP construction:** `java.util.zip.{ZipOutputStream, ZipEntry}` only. No Apache Commons Compress. No new dependency.
4. **Strategy interface:** Spring beans registered by `providerId()` in `Map<String, TerraformExporter>`. V1 only `GcpTerraformExporter` registered.
5. **Hard-fail vs soft-warn:** hard-fail (4xx) ONLY for missing `environmentId`, provider not in `iacSourceProviderOptions`, provider not registered. Hard-fail boundary checks BEFORE model load. All other gaps are soft-warn (TODO comment + warnings.json entry; never block response).
6. **Resource naming:** prefer `iac_resource_bindings.iac_address`; else `<env-slug>_<kebab(entity.name)>`.
7. **Resource-type override hierarchy:** `terraform_resource_hint` > `iac_resource_bindings.iac_resource_type` > default GCP mapping.
8. **TODO comment style (verbatim):** `# TODO: <reason>. Source: <Infrastructure concept> '<entity.name>' (id: <model id>).`
9. **Block headers (verbatim):** `# Infrastructure concept: <ConceptName>`, `# Architecture entity: <entity.name>`, `# Environment: <env.name>`. Optional `# Source model id: <id>` only where useful.
10. **Snake_case JSON throughout backend.**
11. **Zero Liquibase changesets** (filesystem-only persistence; no `ProjectArtifactEntity` row).
12. **No edits** to `ModelController`, `pom.xml`, applied changesets (≤125), gateway, mcp-server, discovery-service, existing 16 Infrastructure grids, existing diagram palette / edges.
13. **Reuse `iacSourceProviderOptions` from `defaults.ts:1321`** — do NOT redeclare or modify on either backend or frontend.
14. **Pre-existing broken backend tests** (~117) carry forward unchanged. Apply broken-tests staging workaround at every targeted-test verification step.
15. **`SECRET_STORE` resources NEVER include secret values.**
16. **`CACHE` Infrastructure Resource dedupes against same-reference Data Store cache** (no duplicate `google_redis_instance` block).
17. **`terraform_module_hint` is comment-only in V1** — no module split.
18. **No LLM-based generation** — hand-rolled string-fragment emitters only.
