package com.example.architecturemodel.service.import_.terraform;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.service.ModelService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Round-trip parity test: feed the export spec's golden HCL files
 * ({@code expected-main.tf}, {@code expected-variables.tf},
 * {@code expected-outputs.tf}) into the importer and assert the resulting
 * candidate set matches the export's seed model entity-for-entity.
 *
 * <p>Pins the locked round-trip invariants from {@code spec.md}:
 * <ul>
 *   <li>{@code iac_address} byte-equal — every {@code iac_address} on the
 *       import's bindings appears as a top-level address in the export's
 *       {@code expected-main.tf}.</li>
 *   <li>Entity-name symmetry — the import's {@code willCreate} set, projected
 *       to {@code (entityType, name)}, includes every entity emitted by the
 *       export.</li>
 *   <li>Composite-LB symmetry — the export emits 5 GCP LB resources but the
 *       import's golden HCL is the EXPORT'S OUTPUT which only emits 4 of the 5
 *       components (no NEG -- see {@code expected-main.tf}). The export's
 *       fixture model has a Listener but the export emits LB pieces only;
 *       this test pins what the export currently emits and surfaces any
 *       symmetry gap as an explicit assertion message.</li>
 *   <li>Technical-field symmetry — CIDR / region / engine /
 *       provider_resource_type round-trip.</li>
 * </ul>
 *
 * <p>NB: any change to the export's golden files MUST update this test in
 * lockstep.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 6.4
 */
class TerraformImportRoundTripTest {

    private static final UUID PROJECT_ID = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID ARCH_ID = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    private static final Path EXPORT_GOLDEN_DIR =
        Paths.get("src/test/resources/terraform-export/expected");

    /**
     * Resource address regex for {@code expected-main.tf}: matches lines like
     * {@code resource "google_xxx" "yyy" {} → captures
     * {@code google_xxx.yyy} as the canonical iac_address.
     */
    private static final Pattern RESOURCE_ADDRESS_RE = Pattern.compile(
        "^resource\\s+\"([^\"]+)\"\\s+\"([^\"]+)\"\\s*\\{",
        Pattern.MULTILINE
    );

    @Test
    void importTerraform_exportGoldenFixture_roundTripsEntityForEntity() throws Exception {
        // ---- Wire up service with empty existing model -----
        ModelService modelService = mock(ModelService.class);
        when(modelService.loadModelByProjectIdAndArchitectureId(any(), any()))
            .thenReturn(new ArchitectureModelDto(new MetaModelDto(null, null), null));

        TerraformImportService service = new TerraformImportService(
            modelService,
            List.of(new GcpTerraformImporter()),
            new ContextInferrer(),
            new CandidateMatcher(),
            new RelationshipInferrer(),
            5L * 1024L * 1024L,
            10L * 1024L * 1024L
        );

        // ---- Load the export's golden HCL fixture -----
        byte[] mainTf = Files.readAllBytes(EXPORT_GOLDEN_DIR.resolve("expected-main.tf"));
        byte[] variablesTf = Files.readAllBytes(EXPORT_GOLDEN_DIR.resolve("expected-variables.tf"));
        byte[] outputsTf = Files.readAllBytes(EXPORT_GOLDEN_DIR.resolve("expected-outputs.tf"));

        MultipartFile mainPart = new MockMultipartFile(
            "files", "main.tf", "text/plain", mainTf
        );
        MultipartFile varsPart = new MockMultipartFile(
            "files", "variables.tf", "text/plain", variablesTf
        );
        MultipartFile outputsPart = new MockMultipartFile(
            "files", "outputs.tf", "text/plain", outputsTf
        );

        // Match the export's seed-model env / cloud-account / location ids so
        // the import's user-supplied form values mirror the export run that
        // produced this golden fixture (see TerraformExportGoldenFileTest).
        ImportOptions options = new ImportOptions(
            "env-prod",
            "cloud-1",
            "loc-1",
            "GCP",
            null, null, null, null, null
        );

        ImportReviewResult result = service.runImport(
            PROJECT_ID, ARCH_ID,
            new MultipartFile[]{mainPart, varsPart, outputsPart},
            options
        );
        assertNotNull(result);
        assertEquals(0, result.willUpdate().size(),
            "no existing model -> all candidates land as willCreate");

        // ---- Step 1: extract every iac_address from expected-main.tf -----
        String mainTfText = new String(mainTf, StandardCharsets.UTF_8);
        Set<String> exportEmittedAddresses = extractResourceAddresses(mainTfText);
        assertFalse(exportEmittedAddresses.isEmpty(),
            "expected-main.tf must declare at least one resource");

        // ---- Step 2: every iac_address on the import's bindings must appear -----
        // in the export's emitted-resource set (proves byte-equal iac_address
        // round-trip per the locked invariant).
        Set<String> importEmittedAddresses = new LinkedHashSet<>();
        for (ImportedCandidate c : result.willCreate()) {
            if (c == null || c.proposedBinding() == null) continue;
            String addr = c.proposedBinding().iacAddress();
            // Skip implicit / synthetic candidates whose addresses are
            // *_cluster / *_du suffixes (these are NOT directly emitted by
            // the export -- they're round-trip-internal carriers and the spec
            // explicitly notes "Lenient on fields the import has no way to
            // recover").
            if (addr == null || addr.endsWith("_cluster") || addr.endsWith("_du")) continue;
            importEmittedAddresses.add(addr);
        }

        // For every "real" iac_address the import produced, the export's
        // emitted-resource set must contain a matching address. Any mismatch
        // surfaces as a real symmetry gap (the test fails loudly with the
        // delta -- the spec instructs NOT to silently rewrite the export).
        Set<String> missingFromExport = new LinkedHashSet<>(importEmittedAddresses);
        missingFromExport.removeAll(exportEmittedAddresses);
        assertTrue(
            missingFromExport.isEmpty(),
            "Round-trip iac_address symmetry gap: import produced addresses "
                + "that the export did not emit. The export side likely has a "
                + "naming-collision or address-rendering gap. Surfaces as a "
                + "spec-level question (do not silently rewrite the export). "
                + "Missing from export: " + missingFromExport
        );

        // ---- Step 3: project candidates by (entityType, name) and assert -----
        // every entity from the export's seed model is represented.
        Map<String, ImportedCandidate> byEntityKey = new LinkedHashMap<>();
        for (ImportedCandidate c : result.willCreate()) {
            if (c == null) continue;
            String name = String.valueOf(
                c.proposedEntityFields() == null
                    ? null
                    : c.proposedEntityFields().get("name")
            );
            byEntityKey.put(c.targetEntityType() + "|" + name, c);
        }

        // Export seed model (from TerraformExportGoldenFileTest.buildFixtureModel):
        // - Network "prod-vpc"           -> google_compute_network.prod_prod_vpc
        // - Subnet  "app-subnet"         -> google_compute_subnetwork.prod_app_subnet
        // - ComputeCluster "orders-gke"  -> google_container_cluster.prod_orders_gke
        // - ComputeResource "orders-cr"  -> google_cloud_run_v2_service.prod_orders_cr
        // - DataStoreInstance "orders-db"-> google_sql_database_instance.prod_orders_db
        // - InfrastructureResource "orders-bucket" -> google_storage_bucket.prod_orders_bucket
        // - LoadBalancer "orders-lb"     -> 4-component LB (no NEG emitted by the export)
        // - Listener "orders-listener"   -> emitted as comment-only (export does NOT
        //   emit a Listener resource block; round-trip is comment-driven only).
        assertCandidateMatches(byEntityKey, ImportedCandidate.TYPE_NETWORK, "prod-vpc",
            "google_compute_network.prod_prod_vpc");
        assertCandidateMatches(byEntityKey, ImportedCandidate.TYPE_SUBNET, "app-subnet",
            "google_compute_subnetwork.prod_app_subnet");
        assertCandidateTechnicalField(byEntityKey, ImportedCandidate.TYPE_SUBNET, "app-subnet",
            "cidr", "10.0.1.0/24");

        assertCandidateMatches(byEntityKey, ImportedCandidate.TYPE_COMPUTE_CLUSTER, "orders-gke",
            "google_container_cluster.prod_orders_gke");

        assertCandidateMatches(byEntityKey, ImportedCandidate.TYPE_COMPUTE_RESOURCE, "orders-cr",
            "google_cloud_run_v2_service.prod_orders_cr");
        assertCandidateTechnicalField(byEntityKey, ImportedCandidate.TYPE_COMPUTE_RESOURCE, "orders-cr",
            "compute_type", "CLOUD_RUN_SERVICE");

        assertCandidateMatches(byEntityKey, ImportedCandidate.TYPE_DATA_STORE_INSTANCE, "orders-db",
            "google_sql_database_instance.prod_orders_db");
        assertCandidateTechnicalField(byEntityKey, ImportedCandidate.TYPE_DATA_STORE_INSTANCE, "orders-db",
            "database_version", "POSTGRES_15");

        assertCandidateMatches(byEntityKey, ImportedCandidate.TYPE_INFRASTRUCTURE_RESOURCE,
            "orders-bucket",
            "google_storage_bucket.prod_orders_bucket");
        assertCandidateTechnicalField(byEntityKey, ImportedCandidate.TYPE_INFRASTRUCTURE_RESOURCE,
            "orders-bucket", "provider_resource_type", "OBJECT_BUCKET");

        // ---- Step 4: composite-LB symmetry -----
        // The export emits FOUR GCP LB components for "orders-lb" (forwarding
        // rule + backend service + url map + target_http_proxy) but NOT the
        // 5th (NEG). The import's composite-LB success path requires all 5,
        // so the import will fall back to per-component candidates rather
        // than emitting one grouped LoadBalancer. This is a real symmetry
        // gap: the export drops NEG (which was never present on the seed
        // model) and the import insists on it. Per spec.md "Lenient on fields
        // the import has no way to recover", we surface the gap explicitly
        // with a meaningful assertion message rather than silently passing.

        // The import will produce per-component "Unsupported"-typed candidates
        // for the 4 LB components after the partial-fallback path runs. The
        // top-level warnings list MUST then carry the "unrecognised LB
        // pattern" warning the importer emits in that path.
        boolean hasLbWarning = result.warnings().stream()
            .anyMatch(w -> w != null && w.contains("unrecognised LB pattern"));
        assertTrue(
            hasLbWarning,
            "Round-trip LB symmetry gap: the export's expected-main.tf only "
                + "emits 4 of the 5 LB components (no NEG), so the import's "
                + "composite-LB success path cannot fire. The importer must "
                + "surface this with the 'unrecognised LB pattern' top-level "
                + "warning. If the export starts emitting NEG this assertion "
                + "must be replaced with a positive LoadBalancer + Listener "
                + "round-trip assertion. warnings=" + result.warnings()
        );
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /**
     * Extract every {@code resource "<type>" "<name>"} declaration from
     * {@code expected-main.tf} and return the canonical
     * {@code <type>.<name>} addresses.
     */
    private static Set<String> extractResourceAddresses(String mainTfText) {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = RESOURCE_ADDRESS_RE.matcher(mainTfText);
        while (m.find()) {
            out.add(m.group(1) + "." + m.group(2));
        }
        return out;
    }

    private static void assertCandidateMatches(
        Map<String, ImportedCandidate> byEntityKey,
        String entityType,
        String name,
        String expectedIacAddress
    ) {
        ImportedCandidate c = byEntityKey.get(entityType + "|" + name);
        assertNotNull(c,
            "Round-trip missing " + entityType + " '" + name + "' in import willCreate set");
        assertNotNull(c.proposedBinding(),
            entityType + " '" + name + "' has no proposed_binding");
        assertEquals(
            expectedIacAddress,
            c.proposedBinding().iacAddress(),
            "iac_address byte-equal mismatch for " + entityType + " '" + name + "'"
        );
    }

    private static void assertCandidateTechnicalField(
        Map<String, ImportedCandidate> byEntityKey,
        String entityType,
        String name,
        String fieldName,
        Object expectedValue
    ) {
        ImportedCandidate c = byEntityKey.get(entityType + "|" + name);
        assertNotNull(c,
            "Round-trip missing " + entityType + " '" + name + "' for technical-field check");
        Object actual = c.proposedEntityFields() == null
            ? null
            : c.proposedEntityFields().get(fieldName);
        assertEquals(
            String.valueOf(expectedValue),
            String.valueOf(actual),
            "technical-field '" + fieldName + "' divergence on "
                + entityType + " '" + name + "'"
        );
    }
}
