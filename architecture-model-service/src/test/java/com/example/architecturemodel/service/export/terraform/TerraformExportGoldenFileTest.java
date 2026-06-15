package com.example.architecturemodel.service.export.terraform;

import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.entity.CloudAccountDto;
import com.example.architecturemodel.model.dto.entity.ComputeClusterDto;
import com.example.architecturemodel.model.dto.entity.ComputeResourceDto;
import com.example.architecturemodel.model.dto.entity.DataStoreInstanceDto;
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
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Golden-file snapshot test for the end-to-end Terraform export pipeline.
 *
 * <p>Builds a small but complete Infrastructure model in-memory (1 of each
 * relevant entity type), runs the export, and asserts each of the 4 generated
 * files matches a committed golden under
 * {@code src/test/resources/terraform-export/expected/}.
 *
 * <p>If the goldens don't yet exist this test writes them on first run and
 * passes; on subsequent runs it asserts byte-equal (after normalising the
 * {@code # Generated: ...} timestamp line so unrelated re-runs don't drift).
 *
 * <p>{@code warnings.json} is asserted to exist + parseable (its order may
 * vary across runs so it's NOT byte-equal-asserted).
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-export-gcp -- Task Group 6.
 */
class TerraformExportGoldenFileTest {

    @TempDir
    Path tempDir;

    private static final UUID PROJECT_ID = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID ARCH_ID = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static final String ENV_ID = "env-prod";

    private static final Path GOLDEN_DIR =
        Paths.get("src/test/resources/terraform-export/expected");

    @Test
    void exportTerraform_canonicalFixture_matchesGoldens() throws Exception {
        ModelService modelService = mock(ModelService.class);
        ProjectService projectService = mock(ProjectService.class);
        ArchitectureService architectureService = mock(ArchitectureService.class);
        TerraformAssembler assembler = new TerraformAssembler();
        GcpTerraformExporter exporter = new GcpTerraformExporter();

        // Mocks
        ProjectDto project = new ProjectDto(
            PROJECT_ID, "demo", tempDir.toString(), null, null, null, true,
            Instant.now(), Instant.now()
        );
        when(projectService.getProjectById(PROJECT_ID)).thenReturn(project);

        ArchitectureDto arch = new ArchitectureDto(
            ARCH_ID, PROJECT_ID, "Demo", null, List.of(), false,
            Instant.now(), Instant.now()
        );
        when(architectureService.listForProject(PROJECT_ID)).thenReturn(List.of(arch));

        ArchitectureModelDto model = buildFixtureModel();
        when(modelService.loadModelByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(model);

        TerraformExportService svc = new TerraformExportService(
            modelService, projectService, architectureService, assembler, List.of(exporter));

        TerraformExportService.TerraformExportResult result =
            svc.exportTerraform(PROJECT_ID, ARCH_ID, ENV_ID, "cloud-1", "loc-1", "GCP");

        // Read ZIP entries
        Map<String, String> entries = readZipEntries(result.zipBytes());
        assertNotNull(entries.get("main.tf"));
        assertNotNull(entries.get("variables.tf"));
        assertNotNull(entries.get("outputs.tf"));
        assertNotNull(entries.get("README.md"));
        assertNotNull(entries.get("warnings.json"));

        // warnings.json must be parseable JSON
        JsonNode warningsNode = new ObjectMapper().readTree(entries.get("warnings.json"));
        assertTrue(warningsNode.has("warnings"), "warnings.json missing 'warnings' key");

        // Compare against goldens with timestamp normalisation
        for (String fileName : List.of("main.tf", "variables.tf", "outputs.tf", "README.md")) {
            String actual = normaliseTimestamp(entries.get(fileName));
            Path goldenPath = GOLDEN_DIR.resolve("expected-" + fileName);

            if (!Files.exists(goldenPath)) {
                // First-run: write the golden so subsequent runs can assert.
                Files.createDirectories(goldenPath.getParent());
                Files.writeString(goldenPath, actual, StandardCharsets.UTF_8);
                System.out.println("[GoldenFileTest] Wrote golden: " + goldenPath.toAbsolutePath());
                continue; // Don't fail the first run.
            }

            String expected = normaliseTimestamp(Files.readString(goldenPath, StandardCharsets.UTF_8));
            assertEquals(expected, actual,
                "Golden mismatch for " + fileName + ". Update " + goldenPath.toAbsolutePath()
                    + " if the change is intentional.");
        }
    }

    // ------------------------------------------------------------------
    // Fixture builder
    // ------------------------------------------------------------------

    /**
     * Builds the canonical Infrastructure fixture model used as the snapshot
     * input. 10 entities total: 1 Environment / Cloud Account / Location /
     * Network / Subnet / Compute Cluster / Compute Resource / Data Store /
     * Infrastructure Resource / Load Balancer / Listener.
     */
    private static ArchitectureModelDto buildFixtureModel() {
        EnvironmentDto env = TerraformTestFixtures.buildRecord(EnvironmentDto.class, Map.of(
            "id", ENV_ID,
            "name", "prod"
        ));
        CloudAccountDto cloud = TerraformTestFixtures.buildRecord(CloudAccountDto.class, Map.of(
            "id", "cloud-1",
            "name", "acme-prod-gcp",
            "environment_id", ENV_ID,
            "external_account_id", "acme-prod-1234"
        ));
        LocationDto loc = TerraformTestFixtures.buildRecord(LocationDto.class, Map.of(
            "id", "loc-1",
            "name", "europe-west1",
            "environment_id", ENV_ID,
            "provider_region_code", "europe-west1"
        ));
        NetworkDto net = TerraformTestFixtures.buildRecord(NetworkDto.class, Map.of(
            "id", "net-1",
            "name", "prod-vpc",
            "environment_id", ENV_ID,
            "network_type", "VPC",
            "cidr", "10.0.0.0/16",
            "provider", "GCP"
        ));
        SubnetDto sub = TerraformTestFixtures.buildRecord(SubnetDto.class, Map.of(
            "id", "sub-1",
            "name", "app-subnet",
            "environment_id", ENV_ID,
            "network_id", "net-1",
            "cidr", "10.0.1.0/24"
        ));
        ComputeClusterDto cluster = TerraformTestFixtures.buildRecord(ComputeClusterDto.class, Map.of(
            "id", "cl-1",
            "name", "orders-gke",
            "environment_id", ENV_ID,
            "platform_type", "KUBERNETES"
        ));
        ComputeResourceDto compute = TerraformTestFixtures.buildRecord(ComputeResourceDto.class, Map.of(
            "id", "cr-1",
            "name", "orders-cr",
            "environment_id", ENV_ID,
            "compute_type", "CLOUD_RUN_SERVICE"
        ));
        DataStoreInstanceDto db = TerraformTestFixtures.buildRecord(DataStoreInstanceDto.class, Map.of(
            "id", "db-1",
            "name", "orders-db",
            "environment_id", ENV_ID,
            "data_store_type", "RELATIONAL_DB",
            "engine", "POSTGRES"
        ));
        InfrastructureResourceDto bucket = TerraformTestFixtures.buildRecord(InfrastructureResourceDto.class, Map.of(
            "id", "ir-1",
            "name", "orders-bucket",
            "environment_id", ENV_ID,
            "resource_type", "OBJECT_BUCKET"
        ));
        LoadBalancerDto lb = TerraformTestFixtures.buildRecord(LoadBalancerDto.class, Map.of(
            "id", "lb-1",
            "name", "orders-lb",
            "environment_id", ENV_ID,
            "exposure", "PUBLIC"
        ));
        ListenerDto listener = TerraformTestFixtures.buildRecord(ListenerDto.class, Map.of(
            "id", "li-1",
            "name", "orders-listener",
            "environment_id", ENV_ID,
            "load_balancer_id", "lb-1",
            "protocol", "HTTPS",
            "port", 443
        ));

        Map<String, Object> overrides = new LinkedHashMap<>();
        overrides.put("environments", List.of(env));
        overrides.put("cloud_accounts", List.of(cloud));
        overrides.put("locations", List.of(loc));
        overrides.put("networks", List.of(net));
        overrides.put("subnets", List.of(sub));
        overrides.put("compute_clusters", List.of(cluster));
        overrides.put("compute_resources", List.of(compute));
        overrides.put("data_store_instances", List.of(db));
        overrides.put("infrastructure_resources", List.of(bucket));
        overrides.put("load_balancers", List.of(lb));
        overrides.put("listeners", List.of(listener));

        MetaModelEntitiesDto entities = TerraformTestFixtures.entitiesWith(overrides);
        MetaModelRelationshipsDto rels = TerraformTestFixtures.emptyRelationships();
        return new ArchitectureModelDto(new MetaModelDto(entities, rels), List.of());
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static Map<String, String> readZipEntries(byte[] zipBytes) throws IOException {
        Map<String, String> out = new LinkedHashMap<>();
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                int n;
                while ((n = zis.read(buf)) >= 0) {
                    baos.write(buf, 0, n);
                }
                out.put(entry.getName(), baos.toString(StandardCharsets.UTF_8));
                zis.closeEntry();
            }
        }
        return out;
    }

    /**
     * Normalise the {@code # Generated: <timestamp>} line so re-runs don't
     * fail purely because the wall clock has moved. The exact timestamp shape
     * is locked in the assembler (yyyy-MM-dd HH:mm:ss); we rewrite that to a
     * fixed sentinel before comparison.
     */
    private static String normaliseTimestamp(String content) {
        if (content == null) return null;
        return content.replaceAll(
            "(?m)^# Generated: \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$",
            "# Generated: <NORMALISED>"
        ).replaceAll(
            "(?m)^- Generated: \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$",
            "- Generated: <NORMALISED>"
        );
    }
}
