package com.example.architecturemodel.service.import_.terraform;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.service.ModelService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link TerraformImportService}.
 *
 * <p>Covers: happy path with a single {@code .tf} file, ZIP path with
 * multiple files preserving relative paths, hard-fail boundary cases
 * (missing files / environmentId / provider, unregistered provider, oversized
 * file). Excludes round-trip + golden-file fixture tests (Task Group 6).
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 5.1
 */
@ExtendWith(MockitoExtension.class)
class TerraformImportServiceTest {

    @Mock
    private ModelService modelService;

    private GcpTerraformImporter gcpImporter;
    private ContextInferrer contextInferrer;
    private CandidateMatcher candidateMatcher;
    private RelationshipInferrer relationshipInferrer;

    private TerraformImportService service;

    private static final UUID PROJECT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID ARCH_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");

    @BeforeEach
    void setUp() {
        gcpImporter = new GcpTerraformImporter();
        contextInferrer = new ContextInferrer();
        candidateMatcher = new CandidateMatcher();
        relationshipInferrer = new RelationshipInferrer();

        // Default: empty existing model (so all candidates are willCreate).
        lenient().when(modelService.loadModelByProjectIdAndArchitectureId(any(), any()))
            .thenReturn(new ArchitectureModelDto(new MetaModelDto(null, null), null));

        service = new TerraformImportService(
            modelService,
            List.of(gcpImporter),
            contextInferrer,
            candidateMatcher,
            relationshipInferrer,
            5L * 1024L * 1024L,    // 5 MB per-file
            10L * 1024L * 1024L    // 10 MB ZIP
        );
    }

    // ============================================================
    // Happy path
    // ============================================================

    @Test
    void runImport_singleTfFile_happyPath_returnsWillCreate() {
        String src = """
            resource "google_compute_network" "vpc" {
              name = "main"
            }
            """;
        MockMultipartFile file = new MockMultipartFile(
            "files", "main.tf", "text/plain", src.getBytes(StandardCharsets.UTF_8)
        );
        ImportOptions opts = newOptions("env-1", "GCP");

        ImportReviewResult result = service.runImport(
            PROJECT_ID, ARCH_ID, new MultipartFile[]{file}, opts
        );

        assertNotNull(result);
        assertNotNull(result.iacSource());
        assertEquals("GCP", result.iacSource().provider());
        assertFalse(result.willCreate().isEmpty(),
            "vpc network must land as willCreate candidate");
        assertEquals(0, result.willUpdate().size(),
            "no existing bindings -> no willUpdate");
        assertNotNull(result.summary());
        assertEquals(result.willCreate().size(), result.summary().willCreateCount());
    }

    @Test
    void runImport_zipUpload_extractsFiles_preservesRelativePaths() throws Exception {
        // Build an in-memory ZIP with two .tf files at different paths.
        byte[] zipBytes = buildZip(
            "main.tf", "resource \"google_compute_network\" \"vpc\" { name = \"main\" }",
            "modules/network/subnet.tf",
            "resource \"google_compute_subnetwork\" \"app\" {\n"
                + "  name          = \"app-subnet\"\n"
                + "  ip_cidr_range = \"10.0.0.0/24\"\n"
                + "}\n"
        );
        MockMultipartFile zip = new MockMultipartFile(
            "files", "infra.zip", "application/zip", zipBytes
        );
        ImportOptions opts = newOptions("env-1", "GCP");

        ImportReviewResult result = service.runImport(
            PROJECT_ID, ARCH_ID, new MultipartFile[]{zip}, opts
        );

        // Collect file_paths from candidates' bindings
        boolean sawSubnetPath = false;
        boolean sawMainTf = false;
        for (ImportedCandidate c : result.willCreate()) {
            String fp = c.proposedBinding().filePath();
            if ("modules/network/subnet.tf".equals(fp)) sawSubnetPath = true;
            if ("main.tf".equals(fp)) sawMainTf = true;
        }
        assertTrue(sawMainTf, "main.tf path preserved on candidates from root entry");
        assertTrue(sawSubnetPath,
            "modules/network/subnet.tf relative path preserved on subnet candidate");
    }

    // ============================================================
    // Hard-fail boundary cases
    // ============================================================

    @Test
    void runImport_missingFiles_throwsIllegalArgumentException() {
        ImportOptions opts = newOptions("env-1", "GCP");
        assertThrows(IllegalArgumentException.class, () ->
            service.runImport(PROJECT_ID, ARCH_ID, new MultipartFile[]{}, opts)
        );
        assertThrows(IllegalArgumentException.class, () ->
            service.runImport(PROJECT_ID, ARCH_ID, null, opts)
        );
    }

    @Test
    void runImport_missingEnvironmentId_throwsIllegalArgumentException() {
        MockMultipartFile file = new MockMultipartFile(
            "files", "main.tf", "text/plain", "".getBytes(StandardCharsets.UTF_8)
        );
        ImportOptions opts = newOptions(null, "GCP");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () ->
            service.runImport(PROJECT_ID, ARCH_ID, new MultipartFile[]{file}, opts)
        );
        assertTrue(ex.getMessage().contains("environmentId"));
    }

    @Test
    void runImport_unsupportedProvider_throwsIllegalArgumentException() {
        // 'AWS' is a valid iacSourceProviderOptions entry but not registered (V1).
        MockMultipartFile file = new MockMultipartFile(
            "files", "main.tf", "text/plain", "".getBytes(StandardCharsets.UTF_8)
        );
        ImportOptions opts = newOptions("env-1", "AWS");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () ->
            service.runImport(PROJECT_ID, ARCH_ID, new MultipartFile[]{file}, opts)
        );
        assertTrue(ex.getMessage().contains("not registered"),
            "AWS is in iacSourceProviderOptions but not registered as an importer (V1)");
    }

    @Test
    void runImport_invalidProvider_throwsIllegalArgumentException() {
        MockMultipartFile file = new MockMultipartFile(
            "files", "main.tf", "text/plain", "".getBytes(StandardCharsets.UTF_8)
        );
        // 'ALIBABA' is not in iacSourceProviderOptions at all.
        ImportOptions opts = newOptions("env-1", "ALIBABA");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () ->
            service.runImport(PROJECT_ID, ARCH_ID, new MultipartFile[]{file}, opts)
        );
        assertTrue(ex.getMessage().contains("iacSourceProviderOptions"),
            "ALIBABA must be rejected as not in iacSourceProviderOptions");
    }

    @Test
    void runImport_oversizedFile_throwsIllegalArgumentException() {
        // Build a service with a tiny per-file cap to force the size check.
        TerraformImportService tinyService = new TerraformImportService(
            modelService,
            List.of(gcpImporter),
            contextInferrer,
            candidateMatcher,
            relationshipInferrer,
            10L,           // 10 byte cap
            1024L * 1024L  // 1 MB ZIP cap
        );
        byte[] big = new byte[1024];   // 1 KB > 10 byte cap
        MockMultipartFile file = new MockMultipartFile(
            "files", "main.tf", "text/plain", big
        );
        ImportOptions opts = newOptions("env-1", "GCP");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () ->
            tinyService.runImport(PROJECT_ID, ARCH_ID, new MultipartFile[]{file}, opts)
        );
        assertTrue(ex.getMessage().contains("max size"),
            "oversized file must be rejected with size message");
    }

    // ============================================================
    // helpers
    // ============================================================

    private static ImportOptions newOptions(String envId, String provider) {
        return new ImportOptions(
            envId,
            "ca-1",
            "loc-1",
            provider,
            "https://example.com/repo.git",
            "main",
            "abc123",
            "infra/",
            "prod"
        );
    }

    private static byte[] buildZip(String... pathContentPairs) throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(baos)) {
            for (int i = 0; i < pathContentPairs.length; i += 2) {
                String path = pathContentPairs[i];
                String content = pathContentPairs[i + 1];
                ZipEntry entry = new ZipEntry(path);
                zos.putNextEntry(entry);
                zos.write(content.getBytes(StandardCharsets.UTF_8));
                zos.closeEntry();
            }
        }
        return baos.toByteArray();
    }
}
