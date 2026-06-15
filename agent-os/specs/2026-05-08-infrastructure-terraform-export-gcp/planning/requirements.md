# Spec Requirements: Infrastructure Terraform Export (GCP)

## Initial Description

Add Terraform export support for the Infrastructure Architecture domain, with GCP as the first implemented provider. The export reads the approved Infrastructure model (entities + relationships + IaC sources/bindings + provenance + readiness fields landed by specs 1-7) and produces a reviewable Terraform ZIP containing `main.tf`, `variables.tf`, `outputs.tf`, and `README.md`. The framework is provider-neutral; only GCP is wired in V1.

The feature is **export-only**:
- No `terraform init`, `plan`, `apply`, no GCP API calls, no cloud credentials, no Git writes, no provisioning.
- Unsupported providers / resource types / incomplete fields produce `# TODO` comments and warnings rather than failing.
- Output is heavily commented and traceable back to Infrastructure entities by name + model id.

The full raw idea is preserved at `agent-os/specs/2026-05-08-infrastructure-terraform-export-gcp/planning/00-raw-idea.md`. Codebase grounding is at `agent-os/specs/2026-05-08-infrastructure-terraform-export-gcp/planning/codebase-grounding.md`.

## Requirements Discussion

### First Round Questions (10 confirmed)

**Q1: Persistence — filesystem-only V1 or also a `ProjectArtifactEntity` README row?**
**Answer:** Filesystem-only V1. Mirror `DiagramExportService` style — write 4 files to `{projectParentFolder}/exports/terraform/<arch>_<env>_<timestamp>/` AND return ZIP as `application/zip`. Skip ProjectArtifactEntity README DB row.

**Q2: Generation engine — hand-rolled emitters or templating dependency?**
**Answer:** Hand-rolled string-fragment emitters per entity type returning `EmittedResource(targetFile, hclFragment, comments, warnings)` + `TerraformAssembler`. No new dependency.

**Q3: Module structure — flat (4 files) or per-domain split?**
**Answer:** Flat: `main.tf`, `variables.tf`, `outputs.tf`, `README.md`. Comment headers group blocks by Infrastructure concept.

**Q4: Provider extensibility — strategy interface or `if/else` per provider?**
**Answer:** Strategy interface `TerraformExporter` registered by `providerId()` in `Map<String, TerraformExporter>`. V1 registers only `GcpTerraformExporter`.

**Q5: Resource naming — reuse IaC binding addresses or always synthesize?**
**Answer:** Resource naming: reuse `iac_resource_bindings.iac_address` when present; else generate `<env>_<kebab(entity.name)>`.

**Q6: TODO comment style and block headers — standard form?**
**Answer:** TODO comment style: `# TODO: <reason>. Source: <Infrastructure concept> '<entity.name>' (id: <model id>).` Block headers `# Infrastructure concept: ...`, `# Architecture entity: ...`, `# Environment: ...`.

**Q7: Validation — hard-fail vs soft-warn boundary?**
**Answer:** Hard-fail only for: no Environment selected; provider not in `iacSourceProviderOptions`; provider not registered (V1: anything other than `GCP`). Soft-warn for: missing cloud_account, missing location, unsupported types, unresolved relationship targets, ambiguous Deployment Unit→Compute mappings.

**Q8: UI placement — `MetaModelView` toolbar or `TopBar/FileMenu`?**
**Answer:** UI placement: `TopBar/FileMenu.tsx` Export group "Export Infrastructure as Terraform..." parallel to JSON/XLSX exports.

**Q9: Modal UX — required vs optional fields, post-submit display?**
**Answer:** Modal UX: Environment required, Cloud Account optional, Location optional, Provider required (V1 only GCP enabled, others "Coming soon" disabled). Submit disabled until Env + Provider set. Post-submit: warnings list inline + Download ZIP button.

**Q10: Test scope — emitter unit tests, golden-file snapshot, controller MockMvc, frontend?**
**Answer:** Per-emitter backend unit tests + 1 golden-file snapshot test (1 VPC + 1 subnet + 1 GKE + 1 Cloud SQL + 1 GCS bucket + 1 Cloud Run service + 1 LB+listener) committed under `src/test/resources/terraform-export/` + 1 MockMvc controller test mirroring `DiagramExportControllerTest`. Frontend: modal-render smoke + download-flow mock.

### Inferred Decisions (11 accepted)

These were inferred from the codebase grounding and prior-spec patterns, then confirmed by the user without override.

1. **Endpoint:** `GET /api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/export-terraform?environmentId=&cloudAccountId=&locationId=&provider=GCP`. Returns `application/zip`, filename `<arch>_<env>_<timestamp>_terraform.zip`. Warnings included as `warnings.json` inside the ZIP.
2. **Service location:** new package `service/export/terraform/` with `TerraformExportService`, `TerraformExporter` (interface), `GcpTerraformExporter`, `EmittedResource` (record), `TerraformAssembler`, `TerraformContext`.
3. **Controller:** new `InfrastructureTerraformExportController.java`, NOT folded into `ModelController`.
4. **ZIP construction:** in-memory `ByteArrayOutputStream` + `ZipOutputStream`, mirrors `DiagramExportService`. Dual-write to `{projectParentFolder}/exports/terraform/...`.
5. **Spec-7 readiness reuse:** `terraform_resource_hint` overrides default GCP resource type; `terraform_module_hint` comment only (no module split V1); `terraform_variable_hints` parsed to populate `variables.tf`; `terraform_notes` appended verbatim; `terraform_ready=false` produces TODO + scaffold.
6. **Spec-6 cross-domain reuse:** `application_compute_deployments` drives container/VM image into compute resources; `application_load_balancer_exposures` drives URL-map host/path; others documentation-only.
7. **Spec-7 IaC binding reuse:** prefer `iac_resource_bindings.iac_address` for the Terraform resource address where available.
8. **Frontend API:** append `exportInfrastructureTerraform(projectId, architectureId, options): Promise<Response>` to `modelApi.ts`.
9. **Frontend modal:** `Export/InfrastructureTerraformExportModal.tsx` parallel to existing `ExportProjectNameModal.tsx`.
10. **Carry-forward:** ~117 pre-existing broken backend tests staged. Pre-existing frontend failures untouched.
11. **Liquibase:** zero changesets (filesystem-only persistence).

### Existing Code to Reference

**Backend:**
- `architecture-model-service/src/main/java/.../service/DiagramExportService.java` — direct template for ZIP build, dual-write filesystem pattern, filename normalisation, timestamp constant.
- `architecture-model-service/src/main/java/.../controller/ModelController.java` (lines 367-387) — `application/zip` Content-Disposition response pattern.
- `architecture-model-service/src/test/.../DiagramExportControllerTest.java` — MockMvc controller test template.
- `ModelService.loadModelByProjectAndArchitecture(UUID projectId, UUID architectureId)` — entry point for architecture-scoped model loading.
- Spec-1 entity DTOs (12 Infra entities) — source of fields read by emitters.
- Spec-6 cross-domain relationship DTOs (`application_compute_deployments`, `application_load_balancer_exposures`) — drives image / URL-map fields.
- Spec-7 readiness fields on each Infra entity — drives hint/override behaviour.
- Spec-7 `IaCResourceBindingDto` — supplies `iac_address` for stable resource naming.

**Frontend:**
- `frontend/src/api/modelApi.ts` `exportAllDiagramsAsZip(...)` — direct template for new `exportInfrastructureTerraform(...)`.
- `frontend/src/components/Export/ExportProjectNameModal.tsx` — modal shape for new `InfrastructureTerraformExportModal.tsx`.
- `frontend/src/components/TopBar/FileMenu.tsx` Export group — placement parallel to JSON/XLSX export entries.
- `frontend/src/config/defaults.ts` `iacSourceProviderOptions` (line 1321) — provider dropdown source.
- `frontend/src/utils/parseContentDispositionFilename.ts` — used to extract download filename from response.

### Follow-up Questions

No follow-up questions were required. The user provided concrete answers on all 10 open questions and accepted all 11 inferred decisions.

## Visual Assets

### Files Provided

Bash check on `agent-os/specs/2026-05-08-infrastructure-terraform-export-gcp/planning/visuals/` returned no image/PDF files.

No visual assets provided.

### Visual Insights

N/A — backend export pipeline + a single export modal. UX shape mirrors existing `ExportProjectNameModal.tsx`.

## Endpoint Contract

`GET /api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/export-terraform`

| Query param | Required | Notes |
|---|---|---|
| `environmentId` | yes | Hard-fail if missing |
| `cloudAccountId` | no | Soft-warn if missing |
| `locationId` | no | Soft-warn if missing |
| `provider` | yes | Must be in `iacSourceProviderOptions`; V1 only `GCP` is registered. Hard-fail otherwise. |

Response:
- Content-Type: `application/zip`
- Content-Disposition: `attachment; filename="<arch>_<env>_<timestamp>_terraform.zip"`
- ZIP entries: `main.tf`, `variables.tf`, `outputs.tf`, `README.md`, `warnings.json`

Dual-write side effect: same files written under `{projectParentFolder}/exports/terraform/<arch>_<env>_<timestamp>/`.

## GCP Resource Mapping

Primary mapping table per the raw idea's "GCP export mapping" section. TODO-fallback applies wherever required fields are missing or the resource type is unsupported.

| Infrastructure entity | Primary GCP resource | TODO fallback semantics |
|---|---|---|
| Environment | (none — variable + label only) | Always emitted as `var.environment`, `labels = { environment = var.environment }` |
| Cloud Account / Project / Tenant | provider config + `var.project_id` | Soft-warn if absent; `provider "google" { project = var.project_id }` still emitted |
| Location / Site / Region | `var.region`, `var.zone` | Soft-warn if absent; provider block falls back to `var.region` placeholder |
| Network | `google_compute_network` | TODO comment if `network_type`/`provider` not GCP-compatible |
| Subnet / Network Segment | `google_compute_subnetwork` | TODO comment if CIDR or region missing |
| Compute Cluster (GKE/KUBERNETES) | `google_container_cluster` (+ `google_container_node_pool` scaffold) | TODO scaffold if node-pool fields incomplete |
| Compute Cluster (CLOUD_RUN) | (implicit / comment) | No standalone cluster resource emitted |
| Compute Resource (VM) | `google_compute_instance` | TODO scaffold if image / machine_type missing |
| Compute Resource (Cloud Run) | `google_cloud_run_v2_service` | Container image pulled from `application_compute_deployments`; TODO if missing |
| Compute Resource (other types) | TODO scaffold + comment | Unsupported compute types produce TODO scaffold |
| Deployment Unit | (no standalone resource) | Image URI / artifact value injected into target Compute via `application_compute_deployments` |
| Load Balancer / Ingress | `google_compute_backend_service` + `google_compute_url_map` + `google_compute_target_http_proxy`/`google_compute_target_https_proxy` + `google_compute_global_forwarding_rule` (+ `google_compute_region_network_endpoint_group` for Cloud Run) | TODO scaffolding if backend resolution incomplete |
| Listener / Exposure | forwarding-rule port/protocol + URL-map rule | Driven by `application_load_balancer_exposures` for host / path |
| Data Store Instance (relational) | `google_sql_database_instance` (+ `google_sql_database`) | TODO if engine not Cloud SQL-shaped |
| Data Store Instance (cache/Redis) | `google_redis_instance` | TODO scaffold for BigQuery / AlloyDB / unsupported engines |
| Infrastructure Resource (OBJECT_BUCKET) | `google_storage_bucket` | — |
| Infrastructure Resource (MESSAGE_TOPIC) | `google_pubsub_topic` | — |
| Infrastructure Resource (MESSAGE_QUEUE) | `google_pubsub_subscription` | — |
| Infrastructure Resource (CACHE) | `google_redis_instance` | — |
| Infrastructure Resource (SECRET_STORE) | `google_secret_manager_secret` | Secret values are NEVER created |
| Infrastructure Resource (SCHEDULER) | `google_cloud_scheduler_job` | — |
| Infrastructure Resource (other) | TODO scaffold + comment | Unsupported resource types produce TODO |

Override hierarchy for resource type:
1. `terraform_resource_hint` from spec-7 readiness fields wins.
2. Else `iac_resource_bindings.iac_resource_type` wins.
3. Else default mapping above.

## Spec-7 Readiness Field Consumption

Five readiness fields land per Infra entity from spec 7. Each is consumed by the export as follows.

| Readiness field | Type | Export consumption |
|---|---|---|
| `terraform_ready` | nullable Boolean | `false` ⇒ emit a TODO scaffold (resource block kept but flagged). `true` / `null` ⇒ emit normally. |
| `terraform_module_hint` | TEXT | V1: emitted as a comment line above the resource block (`# Module hint: <value>`). No module split in V1. |
| `terraform_resource_hint` | TEXT | Overrides the default GCP resource type for this entity (highest-priority override per the mapping table). |
| `terraform_variable_hints` | TEXT (raw JSON string) | Parsed; each entry becomes a `variable "<name>" { ... }` block in `variables.tf` (description / default propagated where present; type defaults to `string`). |
| `terraform_notes` | TEXT | Appended verbatim as a comment block immediately under the resource header. |

## Spec-6 Cross-Domain Relationship Consumption

Spec 6 landed 4 cross-domain relationship tables. Export consumption:

| Relationship | Export consumption |
|---|---|
| `application_compute_deployments` | Drives container image / VM image / artifact source field on the target Compute Resource (Cloud Run, GCE, etc.). If multiple deployment units target the same compute resource, emit a soft-warn TODO unless the mapping is unambiguous. |
| `application_load_balancer_exposures` | Drives URL-map host / path-pattern entries and listener port/protocol on the relevant Load Balancer resources. |
| `data_entity_data_store_hostings` | Documentation-only — emitted as a comment trail on the Data Store Instance ("Hosts data entity X") for traceability. |
| `application_infrastructure_resource_uses` | Documentation-only — emitted as a comment trail on the Infrastructure Resource ("Used by application Y"). |

## File Touch Summary

### Backend (~10 files)

| # | File | Change |
|---|---|---|
| 1 | `architecture-model-service/src/main/java/.../service/export/terraform/TerraformExportService.java` | **NEW** orchestration: load model via `ModelService.loadModelByProjectAndArchitecture`, validate hard-fails, dispatch to provider `TerraformExporter`, assemble ZIP, dual-write to filesystem. |
| 2 | `architecture-model-service/src/main/java/.../service/export/terraform/TerraformExporter.java` | **NEW** strategy interface (`String providerId(); List<EmittedResource> export(TerraformContext);`). |
| 3 | `architecture-model-service/src/main/java/.../service/export/terraform/GcpTerraformExporter.java` | **NEW** GCP implementation: per-entity-type emitters covering the GCP resource mapping table; reads spec-6 cross-domain rels; reads spec-7 readiness fields and IaC bindings. |
| 4 | `architecture-model-service/src/main/java/.../service/export/terraform/EmittedResource.java` | **NEW** record `(String targetFile, String hclFragment, List<String> comments, List<String> warnings)`. |
| 5 | `architecture-model-service/src/main/java/.../service/export/terraform/TerraformAssembler.java` | **NEW** concatenates `EmittedResource` fragments by `targetFile`, builds README, builds `warnings.json`, packages ZIP via `java.util.zip`. |
| 6 | `architecture-model-service/src/main/java/.../service/export/terraform/TerraformContext.java` | **NEW** value object carrying loaded model + selected env / cloud_account / location / provider. |
| 7 | `architecture-model-service/src/main/java/.../controller/InfrastructureTerraformExportController.java` | **NEW** controller exposing the `GET …/infrastructure/export-terraform` endpoint, returning `application/zip`. |
| 8 | `architecture-model-service/src/test/.../service/export/terraform/GcpTerraformExporterTest.java` | **NEW** per-emitter unit tests covering each entity type. |
| 9 | `architecture-model-service/src/test/.../service/export/terraform/TerraformExportGoldenFileTest.java` | **NEW** snapshot test (1 VPC + 1 subnet + 1 GKE + 1 Cloud SQL + 1 GCS bucket + 1 Cloud Run service + 1 LB+listener). Goldens under `src/test/resources/terraform-export/`. |
| 10 | `architecture-model-service/src/test/.../controller/InfrastructureTerraformExportControllerTest.java` | **NEW** MockMvc test mirroring `DiagramExportControllerTest`. |

Plus: golden-file fixtures under `architecture-model-service/src/test/resources/terraform-export/` (input model JSON + expected `main.tf` / `variables.tf` / `outputs.tf` / `README.md`).

### Frontend (~3 files)

| # | File | Change |
|---|---|---|
| 11 | `frontend/src/api/modelApi.ts` | Append `exportInfrastructureTerraform(projectId, architectureId, options): Promise<Response>` mirroring `exportAllDiagramsAsZip(...)`. |
| 12 | `frontend/src/components/Export/InfrastructureTerraformExportModal.tsx` | **NEW** modal with Environment (required fk_typeahead), Cloud Account (optional), Location (optional), Provider (required dropdown, V1 only `GCP` enabled, others disabled "Coming soon"). Submit disabled until Env + Provider set. Post-submit: inline warnings list + Download ZIP button using `URL.createObjectURL` + `parseContentDispositionFilename`. |
| 13 | `frontend/src/components/TopBar/FileMenu.tsx` | Add "Export Infrastructure as Terraform..." menu item in the existing Export group, parallel to Export-as-JSON / Export-as-XLSX entries. Opens the new modal. |

Plus tests:
- `frontend/src/components/Export/__tests__/InfrastructureTerraformExportModal.test.tsx` — modal-render smoke + mocked download-flow test.

**Files NOT to touch:**
- `gateway/`, `mcp-server/`, `discovery-service/` — out of scope.
- Existing 16 Infrastructure grids — unchanged.
- Existing diagram palette / edges — unchanged.
- Liquibase changelog — zero changesets.
- `ModelController.java` — new controller, not folded in.
- `ProjectArtifactEntity` / `project_artifact` table — V1 deliberately filesystem-only.

## Acceptance Criteria

(Carried verbatim from raw idea where applicable.)

- User can export selected Infrastructure Architecture data as a Terraform ZIP.
- Export supports GCP as the first implemented provider.
- Generated ZIP includes `main.tf`, `variables.tf`, `outputs.tf`, and `README.md` (plus `warnings.json`).
- Generated Terraform includes useful comments linking resources back to Infrastructure concepts (block headers + per-resource source lines).
- Generated Terraform includes `# TODO` comments for unsupported or incomplete mappings.
- Export does not run Terraform, call GCP APIs, require credentials, or provision anything.
- Network and Subnet entities can generate basic GCP Terraform resources (`google_compute_network`, `google_compute_subnetwork`).
- At least one Compute Resource type can generate a basic GCP Terraform resource or scaffold (`google_compute_instance` or `google_cloud_run_v2_service`).
- At least one Data Store Instance type can generate a basic GCP Terraform resource or scaffold (`google_sql_database_instance`).
- At least one Infrastructure Resource type can generate a basic GCP Terraform resource or scaffold (`google_storage_bucket`).
- Load Balancer / Ingress and Listener / Exposure can generate supported scaffolding or clear TODO comments.
- Relationship data is used where available to improve generated Terraform (`application_compute_deployments` → image; `application_load_balancer_exposures` → URL-map).
- Export warnings are returned and displayed to the user (inline modal warnings + `warnings.json` in ZIP).
- Existing Infrastructure modelling, table, and diagram behaviours remain unchanged.
- Endpoint scoped by `projectId` and `architectureId`.
- Resource naming reuses `iac_resource_bindings.iac_address` where available; else generates `<env>_<kebab(entity.name)>`.

## Out of Scope

(From raw idea — preserved verbatim.)

- Terraform import.
- Terraform parser.
- Terraform state parsing.
- Terraform plan/apply.
- Terraform CLI integration.
- OpenTofu execution.
- Live GCP API calls.
- Cloud credentials handling.
- Git repository writes.
- Automatic pull request creation.
- Full module generation strategy.
- Complete production-grade GCP landing zone generation.
- Security group / firewall / IAM expansion beyond TODO comments where necessary.
- Cost estimation.
- Drift detection.
- Policy/compliance scanning.
- Automatic diagram generation from Terraform.
- LLM-based Terraform generation unless an existing LLM utility is already used only for comments or suggestions.

Additional V1 exclusions (from inferred decisions):

- **No `ProjectArtifactEntity` README persistence** — filesystem-only V1 (Q1).
- **No per-domain module split** — flat 4-file output (Q3).
- **No automatic IaC-binding write-back** — bindings are read-only at export time (codebase-grounding inference 7).
- **No additional providers** (AWS, Azure, ON_PREM, MULTI, OTHER) — UI shows them disabled "Coming soon"; backend hard-fails any non-GCP provider (Q4 + Q9).
- **No Terraform editor UI / no plan/apply UI** (raw idea + Q9).
- **No Liquibase changesets** — zero schema changes (inference 11).

## Technical Considerations

- **Provider validation order:** (a) provider must be in `iacSourceProviderOptions`; (b) provider must have a registered `TerraformExporter` (V1: only `GCP`). Both checked before model load.
- **Environment validation:** required; hard-fail before model load to avoid wasted I/O.
- **Soft-warn surface:** every soft-warn becomes both an inline warning in the response and an `# TODO` comment in the relevant Terraform block.
- **Resource naming precedence:** `iac_resource_bindings.iac_address` > `terraform_resource_hint` (for resource _type_; address still synthesized) > generated `<env>_<kebab(entity.name)>`.
- **Override hierarchy for resource _type_:** `terraform_resource_hint` > `iac_resource_bindings.iac_resource_type` > default GCP mapping.
- **Filesystem dual-write:** mirror `DiagramExportService` constants (`EXPORTS_SUBDIR = "exports"`, new `TERRAFORM_SUBDIR = "terraform"`).
- **ZIP construction:** `java.util.zip.{ZipOutputStream, ZipEntry}` only — no Apache Commons Compress.
- **Test fixtures:** introduce a new `src/test/resources/terraform-export/` golden-file convention (acknowledged as a NEW pattern, scoped to this single test class).
- **Pre-existing failing tests:** ~117 backend tests carry forward broken; do not fix in this spec. Frontend pre-existing failures untouched.
- **Carry-forward correctness:** zero edits to existing Liquibase changesets; zero edits to gateway/mcp-server/discovery-service.
- **Frontend provider dropdown source:** reuse existing `iacSourceProviderOptions` from `frontend/src/config/defaults.ts` (verified present at line 1321; contains `'GCP'` plus `AWS`, `AZURE`, `ON_PREM`, `MULTI`, `OTHER`). V1 enables `GCP` only; the other entries render disabled with "Coming soon" affordance.
