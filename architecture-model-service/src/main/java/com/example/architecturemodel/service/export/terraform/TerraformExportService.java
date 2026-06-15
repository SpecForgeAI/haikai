package com.example.architecturemodel.service.export.terraform;

import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.entity.CloudAccountDto;
import com.example.architecturemodel.model.dto.entity.ComputeClusterDto;
import com.example.architecturemodel.model.dto.entity.ComputeResourceDto;
import com.example.architecturemodel.model.dto.entity.DataStoreInstanceDto;
import com.example.architecturemodel.model.dto.entity.DeploymentUnitDto;
import com.example.architecturemodel.model.dto.entity.EnvironmentDto;
import com.example.architecturemodel.model.dto.entity.InfrastructureResourceDto;
import com.example.architecturemodel.model.dto.entity.ListenerDto;
import com.example.architecturemodel.model.dto.entity.LoadBalancerDto;
import com.example.architecturemodel.model.dto.entity.LocationDto;
import com.example.architecturemodel.model.dto.entity.NetworkDto;
import com.example.architecturemodel.model.dto.entity.SubnetDto;
import com.example.architecturemodel.service.ArchitectureService;
import com.example.architecturemodel.service.ModelService;
import com.example.architecturemodel.service.ProjectService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Orchestrates the Infrastructure Terraform export: validates hard-fail
 * boundaries, dispatches to the registered {@link TerraformExporter} for the
 * selected provider, runs the {@link TerraformAssembler}, dual-writes the
 * generated files to {@code {projectParentFolder}/exports/terraform/...}, and
 * returns the ZIP bytes + filename.
 *
 * <p>Mirrors {@link com.example.architecturemodel.service.DiagramExportService}
 * for ZIP construction (in-memory {@code ByteArrayOutputStream} +
 * {@code ZipOutputStream}; no Apache Commons Compress) and filesystem
 * dual-write conventions.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-export-gcp -- Task Group 5.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@Slf4j
public class TerraformExportService {

    static final String EXPORTS_SUBDIR = "exports";
    static final String TERRAFORM_SUBDIR = "terraform";
    static final DateTimeFormatter TIMESTAMP_FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");

    /**
     * Backend mirror of {@code iacSourceProviderOptions} declared in
     * {@code frontend/src/config/defaults.ts:1321}. Kept verbatim. New providers
     * MUST be added here AND on the frontend together.
     */
    static final Set<String> PROVIDER_OPTIONS = Set.of(
        "GCP", "AWS", "AZURE", "ON_PREM", "MULTI", "OTHER"
    );

    private final ModelService modelService;
    private final ProjectService projectService;
    private final ArchitectureService architectureService;
    private final TerraformAssembler assembler;
    private final Map<String, TerraformExporter> exportersByProviderId;

    public TerraformExportService(ModelService modelService,
                                  ProjectService projectService,
                                  ArchitectureService architectureService,
                                  TerraformAssembler assembler,
                                  List<TerraformExporter> exporters) {
        this.modelService = modelService;
        this.projectService = projectService;
        this.architectureService = architectureService;
        this.assembler = assembler;
        java.util.LinkedHashMap<String, TerraformExporter> byId = new java.util.LinkedHashMap<>();
        if (exporters != null) {
            for (TerraformExporter e : exporters) {
                if (e == null || e.providerId() == null) continue;
                byId.put(e.providerId(), e);
            }
        }
        this.exportersByProviderId = java.util.Collections.unmodifiableMap(byId);
    }

    /**
     * Result record for an export run.
     */
    public record TerraformExportResult(
        byte[] zipBytes,
        String filename,
        List<String> warnings,
        Path filesystemDir
    ) {}

    /**
     * Run the export.
     *
     * <p>Hard-fails (throws {@link IllegalArgumentException} mapped to 400 by
     * the controller):
     * <ul>
     *   <li>{@code environmentId} null/blank.</li>
     *   <li>{@code providerId} null/blank or not in {@link #PROVIDER_OPTIONS}.</li>
     *   <li>No registered exporter for {@code providerId}.</li>
     * </ul>
     *
     * <p>All other gaps are soft-warns and surface in {@code warnings.json} +
     * inline {@code # TODO} comments.
     */
    public TerraformExportResult exportTerraform(UUID projectId,
                                                 UUID architectureId,
                                                 String environmentId,
                                                 String cloudAccountId,
                                                 String locationId,
                                                 String providerId) {
        // ---- Hard-fail boundary checks (BEFORE model load) ----
        if (environmentId == null || environmentId.isBlank()) {
            throw new IllegalArgumentException("environmentId is required");
        }
        if (providerId == null || providerId.isBlank()) {
            throw new IllegalArgumentException("provider is required");
        }
        if (!PROVIDER_OPTIONS.contains(providerId)) {
            throw new IllegalArgumentException(
                "provider '" + providerId + "' is not in iacSourceProviderOptions");
        }
        if (!exportersByProviderId.containsKey(providerId)) {
            throw new IllegalArgumentException(
                "provider not registered: '" + providerId + "' (V1 only registers 'GCP')");
        }
        if (projectId == null) {
            throw new IllegalArgumentException("projectId is required");
        }
        if (architectureId == null) {
            throw new IllegalArgumentException("architectureId is required");
        }

        TerraformExporter exporter = exportersByProviderId.get(providerId);

        // ---- Load model + resolve project / architecture context ----
        ArchitectureModelDto model =
            modelService.loadModelByProjectIdAndArchitectureId(projectId, architectureId);
        MetaModelEntitiesDto entities = model.metaModel() != null ? model.metaModel().entities() : null;
        MetaModelRelationshipsDto relationships = model.metaModel() != null ? model.metaModel().relationships() : null;

        // ---- Resolve selected env / cloud account / location ----
        EnvironmentDto selectedEnv = findById(entities == null ? null : entities.environments(),
            environmentId, EnvironmentDto::id);
        if (selectedEnv == null) {
            throw new IllegalArgumentException(
                "environmentId '" + environmentId + "' not found in model");
        }
        CloudAccountDto selectedCloud = (cloudAccountId == null || cloudAccountId.isBlank())
            ? null
            : findById(entities == null ? null : entities.cloudAccounts(), cloudAccountId, CloudAccountDto::id);
        LocationDto selectedLoc = (locationId == null || locationId.isBlank())
            ? null
            : findById(entities == null ? null : entities.locations(), locationId, LocationDto::id);

        TerraformContext ctx = new TerraformContext(
            entities, relationships, selectedEnv, selectedCloud, selectedLoc, providerId);

        // ---- Run all 12 emitters ----
        List<EmittedResource> emitted = new ArrayList<>();
        emitted.addAll(safeEmit(() -> exporter.exportEnvironment(selectedEnv, ctx)));
        emitted.addAll(safeEmit(() -> exporter.exportCloudAccount(selectedCloud, ctx)));
        emitted.addAll(safeEmit(() -> exporter.exportLocation(selectedLoc, ctx)));
        if (entities != null) {
            for (NetworkDto e : safeList(entities.networks())) {
                if (matchesEnv(e == null ? null : e.environmentId(), environmentId)) {
                    emitted.addAll(safeEmit(() -> exporter.exportNetwork(e, ctx)));
                }
            }
            for (SubnetDto e : safeList(entities.subnets())) {
                if (matchesEnv(e == null ? null : e.environmentId(), environmentId)) {
                    emitted.addAll(safeEmit(() -> exporter.exportSubnet(e, ctx)));
                }
            }
            for (ComputeClusterDto e : safeList(entities.computeClusters())) {
                if (matchesEnv(e == null ? null : e.environmentId(), environmentId)) {
                    emitted.addAll(safeEmit(() -> exporter.exportComputeCluster(e, ctx)));
                }
            }
            for (ComputeResourceDto e : safeList(entities.computeResources())) {
                if (matchesEnv(e == null ? null : e.environmentId(), environmentId)) {
                    emitted.addAll(safeEmit(() -> exporter.exportComputeResource(e, ctx)));
                }
            }
            for (DeploymentUnitDto e : safeList(entities.deploymentUnits())) {
                // Deployment Units have no environment_id; emit (returns empty list)
                emitted.addAll(safeEmit(() -> exporter.exportDeploymentUnit(e, ctx)));
            }
            for (LoadBalancerDto e : safeList(entities.loadBalancers())) {
                if (matchesEnv(e == null ? null : e.environmentId(), environmentId)) {
                    emitted.addAll(safeEmit(() -> exporter.exportLoadBalancer(e, ctx)));
                }
            }
            for (ListenerDto e : safeList(entities.listeners())) {
                if (matchesEnv(e == null ? null : e.environmentId(), environmentId)) {
                    emitted.addAll(safeEmit(() -> exporter.exportListener(e, ctx)));
                }
            }
            for (DataStoreInstanceDto e : safeList(entities.dataStoreInstances())) {
                if (matchesEnv(e == null ? null : e.environmentId(), environmentId)) {
                    emitted.addAll(safeEmit(() -> exporter.exportDataStoreInstance(e, ctx)));
                }
            }
            for (InfrastructureResourceDto e : safeList(entities.infrastructureResources())) {
                if (matchesEnv(e == null ? null : e.environmentId(), environmentId)) {
                    emitted.addAll(safeEmit(() -> exporter.exportInfrastructureResource(e, ctx)));
                }
            }
        }

        TerraformAssembler.AssembledOutput assembled = assembler.assemble(emitted, ctx);

        // ---- Resolve filename + dual-write directory ----
        String archSlug = resolveArchitectureSlug(projectId, architectureId);
        String envSlug = TerraformContext.slugify(selectedEnv.name());
        String timestamp = LocalDateTime.now().format(TIMESTAMP_FORMAT);
        String dirName = archSlug + "_" + envSlug + "_" + timestamp;
        String zipFileName = dirName + "_terraform.zip";

        Path filesystemDir = writeFilesystemDualWrite(projectId, dirName, assembled);

        // ---- Build ZIP in memory ----
        byte[] zipBytes = buildZip(assembled);

        // De-dupe warnings (some emitters may surface same TODO twice).
        Set<String> dedup = new LinkedHashSet<>(assembled.warnings());

        return new TerraformExportResult(
            zipBytes,
            zipFileName,
            new ArrayList<>(dedup),
            filesystemDir
        );
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static <T> T findById(List<T> list, String id,
                                  java.util.function.Function<T, String> idFn) {
        if (list == null || id == null) return null;
        for (T item : list) {
            if (item == null) continue;
            if (id.equals(idFn.apply(item))) return item;
        }
        return null;
    }

    private static <T> List<T> safeList(List<T> list) {
        return list == null ? List.of() : list;
    }

    private static boolean matchesEnv(String entityEnvId, String selectedEnvId) {
        if (selectedEnvId == null) return false;
        // If the entity has no environment_id, include it (cross-environment
        // shared resources). Emitters surface a soft-warn if context is needed.
        if (entityEnvId == null || entityEnvId.isBlank()) return true;
        return selectedEnvId.equals(entityEnvId);
    }

    private static List<EmittedResource> safeEmit(java.util.function.Supplier<List<EmittedResource>> fn) {
        try {
            List<EmittedResource> out = fn.get();
            return out == null ? List.of() : out;
        } catch (Exception e) {
            log.warn("Emitter threw exception; surfacing as soft-warn EmittedResource", e);
            String w = "# TODO: emitter threw exception: " + e.getClass().getSimpleName() + ": " + e.getMessage();
            return List.of(new EmittedResource(
                TerraformAssembler.FILE_MAIN,
                "# (no fragment emitted -- exporter raised an error)\n",
                List.of(w),
                List.of(w)
            ));
        }
    }

    private String resolveArchitectureSlug(UUID projectId, UUID architectureId) {
        try {
            List<ArchitectureDto> archs = architectureService.listForProject(projectId);
            for (ArchitectureDto a : archs) {
                if (a != null && architectureId.equals(a.id())) {
                    return TerraformContext.slugify(a.name());
                }
            }
        } catch (Exception e) {
            log.debug("Architecture lookup failed; falling back to architectureId", e);
        }
        return TerraformContext.slugify(architectureId.toString());
    }

    private Path writeFilesystemDualWrite(UUID projectId, String dirName,
                                          TerraformAssembler.AssembledOutput assembled) {
        Path dir;
        try {
            ProjectDto project = projectService.getProjectById(projectId);
            String parentFolder = project.projectParentFolder();
            if (parentFolder == null || parentFolder.isBlank()) {
                log.warn("Project {} has no projectParentFolder; skipping filesystem dual-write", projectId);
                return null;
            }
            dir = Paths.get(parentFolder, EXPORTS_SUBDIR, TERRAFORM_SUBDIR, dirName);
            Files.createDirectories(dir);
            // Write the 4 .tf / .md files (NOT warnings.json -- only inside ZIP)
            for (Map.Entry<String, String> e : assembled.filesByName().entrySet()) {
                Path target = dir.resolve(e.getKey());
                Files.writeString(target, e.getValue(), StandardCharsets.UTF_8);
            }
            log.info("Wrote terraform export files to {}", dir);
            return dir;
        } catch (Exception e) {
            log.warn("Failed to dual-write terraform export to filesystem (continuing with ZIP): {}",
                e.getMessage());
            return null;
        }
    }

    private static byte[] buildZip(TerraformAssembler.AssembledOutput assembled) {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(baos)) {
            for (Map.Entry<String, String> e : assembled.filesByName().entrySet()) {
                ZipEntry entry = new ZipEntry(e.getKey());
                zos.putNextEntry(entry);
                zos.write(e.getValue().getBytes(StandardCharsets.UTF_8));
                zos.closeEntry();
            }
            // warnings.json
            ZipEntry warnEntry = new ZipEntry(TerraformAssembler.FILE_WARNINGS);
            zos.putNextEntry(warnEntry);
            zos.write(assembled.warningsJson().getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();
        } catch (IOException e) {
            throw new RuntimeException("Failed to build terraform export ZIP", e);
        }
        return baos.toByteArray();
    }
}
