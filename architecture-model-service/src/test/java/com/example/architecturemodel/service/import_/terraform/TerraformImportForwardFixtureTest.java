package com.example.architecturemodel.service.import_.terraform;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.service.ModelService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Forward-fixture snapshot test for the end-to-end Terraform import pipeline.
 *
 * <p>Loads the hand-rolled {@code src/test/resources/terraform-import/forward/}
 * fixture (which exercises every supported GCP family + edge cases the export
 * would not naturally produce) through {@link TerraformImportService#runImport},
 * normalises the resulting {@link ImportReviewResult} JSON for diff stability
 * (UUID candidate ids scrubbed; lists sorted by stable keys), and asserts
 * byte-equal against the committed {@code expected-candidates.json}.
 *
 * <p>If the golden does not yet exist this test writes it on first run and
 * passes. To regenerate intentionally pass {@code -Dterraform.import.regenerate=true}.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 6.2 / 6.3
 */
class TerraformImportForwardFixtureTest {

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCH_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");

    private static final Path FIXTURE_DIR =
        Paths.get("src/test/resources/terraform-import/forward");
    private static final Path EXPECTED_FILE = FIXTURE_DIR.resolve("expected-candidates.json");

    private static final String REGENERATE_PROP = "terraform.import.regenerate";

    /** Matches any v4 UUID. Used to scrub random UUIDs from warnings. */
    private static final Pattern UUID_RE = Pattern.compile(
        "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    );

    @Test
    void importTerraform_handRolledFixture_matchesGoldenJson() throws Exception {
        // ---- Wire up service with empty existing model (so all candidates -> willCreate) ----
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

        // ---- Read fixture .tf files from the test resources classpath ----
        MultipartFile rootTf = readFixtureAsMultipart("input.tf", "input.tf");
        MultipartFile moduleTf = readFixtureAsMultipart("modules/m/main.tf", "modules/m/main.tf");

        ImportOptions options = new ImportOptions(
            "env-fixture",
            null,            // cloudAccountId NOT supplied -> ContextInferrer fires
            "loc-fixture",   // locationId supplied -> location inference suppressed
            "GCP",
            "https://example.com/fixture.git",
            "main",
            "abc123",
            "infra/",
            "prod"
        );

        // ---- Run pipeline ----
        ImportReviewResult result = service.runImport(
            PROJECT_ID, ARCH_ID,
            new MultipartFile[]{rootTf, moduleTf},
            options
        );
        assertNotNull(result);
        assertEquals(0, result.willUpdate().size(), "no existing model -> no updates");

        // ---- Normalise for diff stability ----
        ImportReviewResult normalised = normalise(result);

        // ---- Serialise to canonical pretty JSON ----
        ObjectMapper mapper = new ObjectMapper();
        mapper.enable(SerializationFeature.INDENT_OUTPUT);
        mapper.enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS);
        String actualJson = mapper.writerWithDefaultPrettyPrinter()
            .writeValueAsString(normalised);
        // Normalise line endings to LF for cross-platform stability.
        actualJson = actualJson.replace("\r\n", "\n");

        boolean regenerate = "true".equalsIgnoreCase(System.getProperty(REGENERATE_PROP));

        if (!Files.exists(EXPECTED_FILE) || regenerate) {
            Files.createDirectories(EXPECTED_FILE.getParent());
            Files.writeString(EXPECTED_FILE, actualJson, StandardCharsets.UTF_8);
            System.out.println("[ForwardFixtureTest] Wrote golden: "
                + EXPECTED_FILE.toAbsolutePath());
            return; // do not fail on first run / regeneration
        }

        String expectedJson = Files.readString(EXPECTED_FILE, StandardCharsets.UTF_8)
            .replace("\r\n", "\n");

        // Sanity: both must be parseable JSON.
        JsonNode actualNode = mapper.readTree(actualJson);
        JsonNode expectedNode = mapper.readTree(expectedJson);
        assertNotNull(actualNode);
        assertNotNull(expectedNode);

        if (!expectedJson.equals(actualJson)) {
            // Print both sides to make regen trivial.
            System.out.println("==== ACTUAL ====");
            System.out.println(actualJson);
            System.out.println("==== EXPECTED ====");
            System.out.println(expectedJson);
        }
        assertEquals(
            expectedJson, actualJson,
            "Forward-fixture golden mismatch. To regenerate, rerun with "
                + "-D" + REGENERATE_PROP + "=true and review the diff."
        );
    }

    // ------------------------------------------------------------------
    // Normalisation helpers
    // ------------------------------------------------------------------

    /**
     * Build a normalised copy of the result for diff stability:
     * <ul>
     *   <li>Sort {@code willCreate} / {@code willUpdate} / {@code unsupported}
     *       lists by ({@code iac_address}, {@code targetEntityType}).</li>
     *   <li>Sort {@code warnings} by string value AFTER scrubbing UUIDs.</li>
     *   <li>Replace each candidate's {@code candidateId} (random UUID per run)
     *       with a stable placeholder of the form
     *       {@code "<bucket>-<index>"}.</li>
     *   <li>Scrub random UUIDs out of top-level warning text (e.g. relationship
     *       inference reports source/target candidate ids inline).</li>
     * </ul>
     */
    private static ImportReviewResult normalise(ImportReviewResult r) {
        Comparator<ImportedCandidate> cmp = Comparator
            .comparing((ImportedCandidate c) -> {
                String addr = c.proposedBinding() == null ? "" : c.proposedBinding().iacAddress();
                return addr == null ? "" : addr;
            })
            .thenComparing(ImportedCandidate::targetEntityType,
                Comparator.nullsFirst(Comparator.naturalOrder()))
            .thenComparing((ImportedCandidate c) -> {
                Object n = c.proposedEntityFields() == null
                    ? null : c.proposedEntityFields().get("name");
                return n == null ? "" : n.toString();
            });

        List<ImportedCandidate> sortedCreate = sortAndScrub(r.willCreate(), cmp, "create");
        List<ImportedCandidate> sortedUpdate = sortAndScrub(r.willUpdate(), cmp, "update");
        List<ImportedCandidate> sortedUnsup = sortAndScrub(r.unsupported(), cmp, "unsupported");

        List<String> scrubbedWarnings = new ArrayList<>();
        for (String w : r.warnings()) {
            scrubbedWarnings.add(scrubUuids(w));
        }
        scrubbedWarnings.sort(Comparator.naturalOrder());

        return ImportReviewResult.build(
            r.iacSource(),
            sortedCreate,
            sortedUpdate,
            sortedUnsup,
            scrubbedWarnings
        );
    }

    /** Replace every UUID (e.g. relationship-inference source/target ids) with a stable token. */
    private static String scrubUuids(String text) {
        if (text == null) return null;
        return UUID_RE.matcher(text).replaceAll("<uuid>");
    }

    private static List<ImportedCandidate> sortAndScrub(
        List<ImportedCandidate> source,
        Comparator<ImportedCandidate> cmp,
        String bucketLabel
    ) {
        List<ImportedCandidate> sorted = new ArrayList<>(source);
        sorted.sort(cmp);
        List<ImportedCandidate> out = new ArrayList<>(sorted.size());
        int i = 0;
        for (ImportedCandidate c : sorted) {
            String stableId = bucketLabel + "-" + i++;
            // Per-candidate warnings: scrub UUIDs but preserve order (source-emitted).
            List<String> warnings = new ArrayList<>();
            if (c.perCandidateWarnings() != null) {
                for (String w : c.perCandidateWarnings()) {
                    warnings.add(scrubUuids(w));
                }
            }
            out.add(new ImportedCandidate(
                stableId,
                c.targetEntityType(),
                c.proposedEntityFields(),
                c.proposedBinding(),
                c.confidence(),
                warnings,
                c.evidence(),
                c.ignored()
            ));
        }
        return out;
    }

    private static MultipartFile readFixtureAsMultipart(String classpathPath, String mfPath) throws IOException {
        // Read from src/test/resources/terraform-import/forward/<classpathPath>.
        Path p = FIXTURE_DIR.resolve(classpathPath);
        byte[] bytes;
        if (Files.exists(p)) {
            bytes = Files.readAllBytes(p);
        } else {
            // Fallback to classpath
            String resourcePath = "/terraform-import/forward/" + classpathPath;
            try (InputStream in = TerraformImportForwardFixtureTest.class.getResourceAsStream(resourcePath)) {
                assertNotNull(in, "Fixture not found: " + resourcePath);
                bytes = in.readAllBytes();
            }
        }
        return new MockMultipartFile("files", mfPath, "text/plain", bytes);
    }
}
