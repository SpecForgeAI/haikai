# Codebase Grounding — Infrastructure Terraform Export (GCP)

Pass A notes captured before clarifying questions. Used to seed Pass B (questions) and Pass C (inferred decisions). Live during spec-shaping; can be deleted post-spec.

## Source-of-truth specs read

- `2026-05-04-infrastructure-domain-backend-foundation/spec.md` (12 entities, `infrastructure_points` polymorphic supertype, 3 Infra-internal relationships)
- `2026-05-05-infrastructure-cross-domain-integration/spec.md` (4 cross-domain rels: `application_compute_deployments`, `data_entity_data_store_hostings`, `application_infrastructure_resource_uses`, `application_load_balancer_exposures`)
- `2026-05-05-infrastructure-terraform-discovery-readiness/spec.md` (added `iac_sources`, `iac_resource_bindings`; added 6 provenance + 5 readiness fields per entity; added `iacSourceProviderOptions` picklist with `GCP/AWS/AZURE/ON_PREM/MULTI/OTHER`).

Entity tables relevant to export: `environments, cloud_accounts, locations, networks, subnets, compute_clusters, compute_resources, deployment_units, load_balancers, listeners, data_store_instances, infrastructure_resources`. Polymorphic `infrastructure_points` supertype carries the `point_kind` discriminator + 12 typed FKs.

Readiness columns now present on each of the 12 Infra entities: `terraform_ready BOOLEAN, terraform_module_hint TEXT, terraform_resource_hint TEXT, terraform_variable_hints TEXT (JSON-as-string), terraform_notes TEXT`.

## Backend export precedent — STRONG

**`architecture-model-service/src/main/java/com/example/architecturemodel/service/DiagramExportService.java`** is the canonical pattern:

- Uses `java.util.zip.ZipOutputStream` + `ZipEntry` directly (no Apache Commons Compress).
- Builds ZIP in memory via `ByteArrayOutputStream`.
- Writes individual files to `{projectParentFolder}/exports/diagrams/` AND returns ZIP bytes — dual-write pattern.
- Constants: `EXPORTS_SUBDIR = "exports"`, `DIAGRAMS_SUBDIR = "diagrams"`.
- Result records: `SingleDiagramExportResult(Path path, String downloadFileName)` and `AllDiagramsExportResult(byte[] zipBytes, String downloadFileName)`.
- Filename normaliser: lowercase, whitespace → `-`, special chars stripped.
- Timestamp format constant `TIMESTAMP_FORMAT` — reuse.

**Controller pattern (`ModelController.java` lines 367-387):**

```java
@GetMapping("/diagrams/export-all-svg")
public ResponseEntity<byte[]> exportAllDiagramsAsSvg(@RequestParam String filename) {
    DiagramExportService.AllDiagramsExportResult result =
        diagramExportService.exportAllDiagramsAsZip(filename);
    return ResponseEntity.ok()
        .contentType(MediaType.valueOf("application/zip"))
        .header(HttpHeaders.CONTENT_DISPOSITION,
            "attachment; filename=\"" + result.downloadFileName() + "\"")
        .body(result.zipBytes());
}
```

**Test precedent (`DiagramExportControllerTest.java`):** mock service, verify ZIP headers + bytes via `MockMvc`.

## ProjectArtifact persistence pattern

`ProjectArtifactEntity` (`project_artifact` table, columns `id, project_id, artifact_type, content TEXT NOT NULL, source, revision, created_at`) is the precedent for **versioned, content-addressed text artifacts** (`MISSION_MD`, `ROADMAP_MD`, `BACKLOG_MD`). It does NOT support binary blobs — `content` is a `String NOT NULL`. So:

- Right pattern for plain-text Terraform artifact metadata? Maybe — the README could be persisted here. Or the whole concatenated `main.tf+variables.tf+outputs.tf+README.md` text bundle as a single record.
- Wrong pattern for ZIP bytes — `String content NOT NULL`, not `byte[]`.

**Cleanest option:** mirror `DiagramExportService` exactly: write files to `{projectParentFolder}/exports/terraform/{architecture-name}_{environment-name}_{timestamp}/...` AND return ZIP. Optionally add a `ProjectArtifactEntity` row with `artifact_type = 'TERRAFORM_EXPORT_MD'` containing only the README content for searchability. Defer DB persistence of full artifact bytes unless user asks for it.

## Loading model by architecture scoping

`ModelService.loadModelByProjectAndArchitecture(UUID projectId, UUID architectureId)` exists and is the entry point for any new architecture-scoped service. The Terraform export service should accept `(projectId, architectureId, environmentId, optional cloudAccountId, optional locationId, provider)` and call this loader.

## Frontend export precedent — STRONG

**`frontend/src/api/modelApi.ts`** has `exportAllDiagramsAsZip(filename) → Promise<Response>` returning the raw `Response` so the caller can `response.blob()` and use `parseContentDispositionFilename(...)` helper. Mirror exactly for new `exportInfrastructureTerraform(...)`.

**`frontend/src/components/DiagramsView/DiagramsView.tsx`** has the export button group pattern — `Export Current SVG` / `Export All SVG` buttons inside `.exportSection`, with `isExporting` state, `exportError` display. Uses `<a download={filename} href={blobUrl}>` click pattern (or `URL.createObjectURL` + programmatic click).

**`frontend/src/components/Export/ExportProjectNameModal.tsx`** — modal pattern for export dialog already exists; mirror this shape for the new "Export to Terraform" modal that asks for Environment / Cloud Account / Location / Provider.

**`frontend/src/components/MetaModelView/MetaModelView.tsx`** — current Infrastructure tables UI surface. The DomainSelector reads `internalDomain`; when `infrastructure` is selected, the user sees Infra entity tabs. There is no per-domain toolbar today — entity-grid actions sit inline. Two natural placements for the new Export button:
1. **`MetaModelView.tsx` toolbar add-on** — appear only when `internalDomain === 'infrastructure'`.
2. **`TopBar/FileMenu.tsx` new menu item** — there is already an `Export` group with "Export as JSON" / "Export as XLSX". Add "Export Infrastructure as Terraform..." (opens modal). This menu is always visible, but the button is disabled unless an architecture is loaded with Infrastructure data.

Recommend (2) for V1 because it parallels existing JSON/XLSX export precedents and avoids per-domain toolbar work. The modal handles environment/provider selection.

## Library/3-spec arc precedent

Project memory mentions a Library 3-spec arc and prior Jira spec-upload work. The Jira spec-upload work lives in `gateway/src/services/jiraSyncService.ts` — it builds a markdown payload and uploads it as a Jira attachment (HTTP). It is NOT a backend artifact-persistence pattern in `architecture-model-service`. So the "shaped specs as Jira attachments" precedent is **not directly applicable** to local Terraform export; it just confirms the gateway is comfortable with multipart uploads.

## ZIP / templating libraries

- Backend: `java.util.zip.{ZipOutputStream, ZipEntry}` — already used (no Apache Commons Compress, no JTE/FreeMarker/Mustache anywhere). New code should mirror this directly.
- Templating: NO templating engine in use today. Hand-rolled string-fragment emitters with a top-level assembler stay consistent.

## Test fixture / golden-file convention

No existing golden-file convention in `architecture-model-service/src/test/`. Tests are unit-test style with `MockMvc`, `Mockito`, JUnit 5. For the export, fixture-driven snapshot tests (a fixed input model → expected `main.tf` text) would be a NEW pattern but tightly bounded to one test class — recommend adding it under `service/export/` test package alongside the existing `DiagramExportControllerTest.java` precedent.

## Pre-existing failures (carry-forward, do NOT touch)

- ~117 pre-existing broken backend test files (per orchestrator; mitigation = exclude from staging build).
- Frontend pre-existing failures per `~/.claude/.../MEMORY.md` (`bootstrap-summary-fetching`, `chatV2-panel-*`, etc.).

## Inferred design positions for Pass C

1. **Persistence:** filesystem under `{projectParentFolder}/exports/terraform/<architecture>_<env>_<timestamp>/` mirroring `DiagramExportService`. Return ZIP bytes via `application/zip` Content-Disposition. Optionally also write the README content to `ProjectArtifactEntity` with `artifact_type = 'TERRAFORM_EXPORT_README_MD'` for searchability — but only if Q1 confirms this is wanted.
2. **Generation engine:** hand-rolled emitters returning `EmittedResource{filename, hclFragment, comments, warnings}` records, plus a top-level `TerraformAssembler` that concatenates fragments by file. No templating dependency.
3. **Module structure:** flat — single `main.tf`, `variables.tf`, `outputs.tf`, `README.md`. Defer per-domain split.
4. **Provider extensibility:** `interface TerraformExporter { String providerId(); List<EmittedResource> exportNetwork(...); ... }`. V1 registers `GcpTerraformExporter` only.
5. **TODO comments:** standardised `# TODO: <description>. Source: <Infrastructure concept> '<entity name>' (id: <model id>).`
6. **Resource naming:** prefer `iac_resource_bindings.iac_address` if a binding exists for the entity. Else `kebab(entity.name)` with env prefix (e.g. `prod_app_vpc`).
7. **IaC binding write-back:** read-only in V1. Do not auto-create bindings during export. Future spec covers binding write-back.
8. **Validation:** hard-fail on missing Environment selection or unsupported Provider; soft-warn on every other gap → TODO comments.
9. **UI placement:** `FileMenu` "Export Infrastructure as Terraform..." opens a modal. Modal asks Environment, Cloud Account, Location, Provider (hardcoded `GCP` for V1).
10. **Tests:** backend snapshot/golden-file test for one full fixture model (1 VPC + 1 subnet + 1 GKE cluster + 1 Cloud SQL + 1 storage bucket → expected text). Frontend smoke test for modal + download flow.
