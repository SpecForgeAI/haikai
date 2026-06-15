package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.entity.DiscoveryRunEntity;
import com.example.architecturemodel.repository.entity.DiscoveryRunRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Focused tests for the new
 * {@code PATCH /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/input-artifacts/log-files}
 * endpoint introduced by Spec 2026-05-10 (Runtime Log Input at Discovery Run Start).
 *
 * <p>Uses {@code @SpringBootTest} + {@code @AutoConfigureMockMvc} with the H2
 * test datasource defined in {@code src/test/resources/application.yml}, so
 * the full Jackson + Bean Validation + JPA + JsonType wiring is exercised.
 *
 * <p>Five tests pinned (per Task 1.1 of the spec):
 * <ol>
 *   <li><b>Initial PATCH appends:</b> against a run with empty
 *       {@code config_snapshot}, the PATCH creates
 *       {@code config_snapshot.inputArtifacts.logFiles[]} populated with
 *       both incoming entries.</li>
 *   <li><b>Re-PATCH replaces (idempotent on artifactId):</b> a follow-up
 *       PATCH carrying the same {@code artifactId} REPLACES the existing
 *       entry rather than appending; the array length stays at 2 even
 *       though both PATCHes carried 2 entries.</li>
 *   <li><b>attemptedCount = max(existing, incoming):</b> a follow-up PATCH
 *       with a LOWER {@code attemptedCount} does NOT lower the persisted
 *       value -- partial-failure state cannot be silently hidden by a
 *       subsequent retry.</li>
 *   <li><b>404 when run row is missing:</b> PATCH against an unknown runId
 *       returns 404 (mapped via {@code ResourceNotFoundException} ->
 *       {@code GlobalExceptionHandler}).</li>
 *   <li><b>400 on schema validation failure:</b> PATCH with a request body
 *       missing the required {@code originalFileName} field returns 400
 *       (Spring's default {@code MethodArgumentNotValidException} handler).</li>
 * </ol>
 *
 * <p>Spec: Runtime Log Input at Discovery Run Start (2026-05-10) -- Task Group 1.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    // Discovery + data-entity-point startup ensures are noisy and unrelated.
    "app.data-entity-points.startup-ensure=false"
})
class DiscoveryRunInputArtifactsControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private DiscoveryRunRepository discoveryRunRepository;

    private static final String BASE_PATH =
        "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/input-artifacts/log-files";

    private UUID projectId;
    private UUID architectureId;
    private UUID runId;

    @BeforeEach
    void setUp() {
        projectId = UUID.randomUUID();
        architectureId = UUID.randomUUID();
        runId = UUID.randomUUID();
    }

    /**
     * Test (a): initial PATCH against a fresh run row writes both incoming
     * entries into {@code inputArtifacts.logFiles[]} and sets
     * {@code attemptedCount}.
     */
    @Test
    @DisplayName("(a) initial PATCH appends entries to empty config_snapshot.inputArtifacts.logFiles[]")
    void initialPatch_appendsEntries_toEmptyConfigSnapshot() throws Exception {
        // Given: a fresh run with empty config_snapshot.
        DiscoveryRunEntity run = DiscoveryRunEntity.builder()
            .id(runId)
            .projectId(projectId)
            .architectureId(architectureId)
            .status("PENDING")
            .configSnapshot(new HashMap<>())
            .build();
        discoveryRunRepository.save(run);

        String body = objectMapper.writeValueAsString(Map.of(
            "logFiles", List.of(
                logFileMeta("art-1", "web_access.log", 12_345L, ".log",
                    "text/plain", "2026-05-10T10:00:00Z",
                    "discovery-runs/" + runId + "/logs/web_access.log"),
                logFileMeta("art-2", "events.jsonl", 6_789L, ".jsonl",
                    "application/x-ndjson", "2026-05-10T10:00:01Z",
                    "discovery-runs/" + runId + "/logs/events.jsonl")
            ),
            "attemptedCount", 2
        ));

        // When/Then: response carries both entries; DB state mirrors that.
        mockMvc.perform(patch(BASE_PATH, projectId, architectureId, runId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.logFiles").isArray())
            .andExpect(jsonPath("$.logFiles.length()").value(2))
            .andExpect(jsonPath("$.logFiles[0].artifactId").value("art-1"))
            .andExpect(jsonPath("$.logFiles[1].artifactId").value("art-2"))
            .andExpect(jsonPath("$.attemptedCount").value(2));

        DiscoveryRunEntity reloaded = discoveryRunRepository.findById(runId).orElseThrow();
        @SuppressWarnings("unchecked")
        Map<String, Object> ia = (Map<String, Object>) reloaded.getConfigSnapshot().get("inputArtifacts");
        assertThat(ia).isNotNull();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> persistedLogFiles = (List<Map<String, Object>>) ia.get("logFiles");
        assertThat(persistedLogFiles).hasSize(2);
        assertThat(persistedLogFiles.get(0).get("originalFileName")).isEqualTo("web_access.log");
        assertThat(persistedLogFiles.get(1).get("originalFileName")).isEqualTo("events.jsonl");
        assertThat(((Number) ia.get("attemptedCount")).intValue()).isEqualTo(2);
    }

    /**
     * Test (b): re-PATCHing with the same {@code artifactId} REPLACES the
     * existing entry rather than appending. This is the idempotency contract
     * the gateway relies on for safe retries.
     */
    @Test
    @DisplayName("(b) re-PATCH with same artifactId REPLACES the entry (idempotent, no duplicate append)")
    void rePatchWithSameArtifactId_replacesEntry_notDuplicate() throws Exception {
        // Given: a run that already has two log-file entries from a prior PATCH.
        seedRunWithTwoLogFiles();

        // First-PATCH state asserted before second PATCH:
        DiscoveryRunEntity priorState = discoveryRunRepository.findById(runId).orElseThrow();
        @SuppressWarnings("unchecked")
        Map<String, Object> priorIa = (Map<String, Object>) priorState.getConfigSnapshot().get("inputArtifacts");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> priorLogFiles = (List<Map<String, Object>>) priorIa.get("logFiles");
        assertThat(priorLogFiles).hasSize(2);

        // When: a follow-up PATCH carries the SAME artifactIds with mutated
        // payload (e.g. updated sizeBytes). One id matches the existing
        // "art-1"; the other is a new "art-3" so we exercise both branches
        // (replace + append) in the same merge.
        String body = objectMapper.writeValueAsString(Map.of(
            "logFiles", List.of(
                logFileMeta("art-1", "web_access.log", 99_999L, ".log",
                    "text/plain", "2026-05-10T10:30:00Z",
                    "discovery-runs/" + runId + "/logs/web_access.log"),
                logFileMeta("art-3", "third_one.txt", 111L, ".txt",
                    "text/plain", "2026-05-10T10:30:01Z",
                    "discovery-runs/" + runId + "/logs/third_one.txt")
            ),
            "attemptedCount", 2
        ));

        mockMvc.perform(patch(BASE_PATH, projectId, architectureId, runId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            // 3 entries total: art-1 (replaced), art-2 (untouched from seed),
            // art-3 (newly appended).
            .andExpect(jsonPath("$.logFiles.length()").value(3));

        // Then: the persisted state has 3 entries; art-1 was REPLACED (size
        // updated to 99999), art-2 is untouched, art-3 was appended.
        DiscoveryRunEntity reloaded = discoveryRunRepository.findById(runId).orElseThrow();
        @SuppressWarnings("unchecked")
        Map<String, Object> ia = (Map<String, Object>) reloaded.getConfigSnapshot().get("inputArtifacts");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> logFiles = (List<Map<String, Object>>) ia.get("logFiles");
        assertThat(logFiles).hasSize(3);

        Map<String, Object> art1 = findById(logFiles, "art-1");
        assertThat(art1).as("art-1 must be replaced").isNotNull();
        assertThat(((Number) art1.get("sizeBytes")).longValue())
            .as("art-1 sizeBytes must be the NEW value (99999), not the seeded value (12345)")
            .isEqualTo(99_999L);

        Map<String, Object> art2 = findById(logFiles, "art-2");
        assertThat(art2).as("art-2 must remain untouched").isNotNull();
        assertThat(((Number) art2.get("sizeBytes")).longValue()).isEqualTo(6_789L);

        Map<String, Object> art3 = findById(logFiles, "art-3");
        assertThat(art3).as("art-3 must be newly appended").isNotNull();
        assertThat(art3.get("originalFileName")).isEqualTo("third_one.txt");
    }

    /**
     * Test (c): {@code attemptedCount} is updated via
     * {@code max(existing, incoming)}. A follow-up PATCH carrying a LOWER
     * count must NOT lower the persisted value -- this protects the
     * partial-failure state from being silently hidden by a retry.
     */
    @Test
    @DisplayName("(c) attemptedCount = max(existing, incoming): a lower follow-up PATCH does not lower the count")
    void attemptedCount_useMaxOfExistingAndIncoming() throws Exception {
        // Given: prior PATCH set attemptedCount = 5 (e.g. user tried 5 files,
        // 2 written successfully -> partial-attach state).
        seedRunWithTwoLogFiles();
        // Bump the seeded attemptedCount to 5 so we can test the max() rule.
        DiscoveryRunEntity entity = discoveryRunRepository.findById(runId).orElseThrow();
        @SuppressWarnings("unchecked")
        Map<String, Object> ia0 = (Map<String, Object>) entity.getConfigSnapshot().get("inputArtifacts");
        ia0.put("attemptedCount", 5);
        discoveryRunRepository.save(entity);

        // When: a retry PATCH carries attemptedCount = 1 (lower).
        String body = objectMapper.writeValueAsString(Map.of(
            "logFiles", List.of(
                logFileMeta("art-1", "web_access.log", 12_345L, ".log",
                    "text/plain", "2026-05-10T10:00:00Z",
                    "discovery-runs/" + runId + "/logs/web_access.log")
            ),
            "attemptedCount", 1
        ));

        mockMvc.perform(patch(BASE_PATH, projectId, architectureId, runId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            // Response echoes the merged sub-map: count must remain 5.
            .andExpect(jsonPath("$.attemptedCount").value(5));

        // And: persisted state confirms attemptedCount stayed at 5 (max rule).
        DiscoveryRunEntity reloaded = discoveryRunRepository.findById(runId).orElseThrow();
        @SuppressWarnings("unchecked")
        Map<String, Object> ia = (Map<String, Object>) reloaded.getConfigSnapshot().get("inputArtifacts");
        assertThat(((Number) ia.get("attemptedCount")).intValue())
            .as("attemptedCount must NOT be lowered by a retry; max(5, 1) = 5")
            .isEqualTo(5);
    }

    /**
     * Test (d): PATCH against an unknown {@code runId} returns 404. Mapped
     * via {@code ResourceNotFoundException} ->
     * {@code GlobalExceptionHandler#handleResourceNotFoundException}.
     */
    @Test
    @DisplayName("(d) 404 when discovery_run row does not exist")
    void patch_returns404_whenRunIsMissing() throws Exception {
        // Given: NO discovery_run row seeded for runId.
        UUID missingRunId = UUID.randomUUID();

        String body = objectMapper.writeValueAsString(Map.of(
            "logFiles", List.of(
                logFileMeta("art-1", "x.log", 1L, ".log",
                    null, "2026-05-10T10:00:00Z", "discovery-runs/x/logs/x.log")
            ),
            "attemptedCount", 1
        ));

        mockMvc.perform(patch(BASE_PATH, projectId, architectureId, missingRunId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isNotFound());
    }

    /**
     * Test (e): PATCH with a request body that fails Bean Validation (missing
     * required {@code originalFileName}) returns 400. Mapped by Spring's
     * default {@code MethodArgumentNotValidException} handler.
     */
    @Test
    @DisplayName("(e) 400 on schema validation failure (missing required field)")
    void patch_returns400_onValidationFailure() throws Exception {
        // Seed the run so the controller doesn't 404 before validation fires.
        DiscoveryRunEntity run = DiscoveryRunEntity.builder()
            .id(runId)
            .projectId(projectId)
            .architectureId(architectureId)
            .status("PENDING")
            .configSnapshot(new HashMap<>())
            .build();
        discoveryRunRepository.save(run);

        // originalFileName field is OMITTED from the entry -- @NotBlank fails.
        Map<String, Object> incompleteEntry = new LinkedHashMap<>();
        incompleteEntry.put("artifactId", "art-1");
        // (originalFileName intentionally absent)
        incompleteEntry.put("sizeBytes", 1L);
        incompleteEntry.put("fileExtension", ".log");
        incompleteEntry.put("uploadedAtIso", "2026-05-10T10:00:00Z");
        incompleteEntry.put("relativePath", "discovery-runs/x/logs/x.log");

        String body = objectMapper.writeValueAsString(Map.of(
            "logFiles", List.of(incompleteEntry),
            "attemptedCount", 1
        ));

        mockMvc.perform(patch(BASE_PATH, projectId, architectureId, runId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest());
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /**
     * Build a single {@code LogFileMetaDto} JSON map. Field names use
     * camelCase (matching the gateway payload shape and the DTO's
     * {@code @JsonProperty} overrides).
     */
    private Map<String, Object> logFileMeta(String artifactId, String originalFileName,
                                            long sizeBytes, String fileExtension,
                                            String contentType, String uploadedAtIso,
                                            String relativePath) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("artifactId", artifactId);
        m.put("originalFileName", originalFileName);
        m.put("sizeBytes", sizeBytes);
        m.put("fileExtension", fileExtension);
        if (contentType != null) {
            m.put("contentType", contentType);
        }
        m.put("uploadedAtIso", uploadedAtIso);
        m.put("relativePath", relativePath);
        return m;
    }

    /**
     * Seed the discovery_run row for {@link #runId} and pre-populate
     * {@code config_snapshot.inputArtifacts.logFiles[]} with two entries
     * (art-1 + art-2) by issuing one PATCH against the live endpoint. We
     * route through the controller (instead of writing directly to the DB)
     * so the seed exercises the same merge code as production -- this keeps
     * the "second PATCH" test's "before" state guaranteed-consistent with
     * the production write path.
     */
    private void seedRunWithTwoLogFiles() throws Exception {
        DiscoveryRunEntity run = DiscoveryRunEntity.builder()
            .id(runId)
            .projectId(projectId)
            .architectureId(architectureId)
            .status("PENDING")
            .configSnapshot(new HashMap<>())
            .build();
        discoveryRunRepository.save(run);

        String seedBody = objectMapper.writeValueAsString(Map.of(
            "logFiles", List.of(
                logFileMeta("art-1", "web_access.log", 12_345L, ".log",
                    "text/plain", "2026-05-10T10:00:00Z",
                    "discovery-runs/" + runId + "/logs/web_access.log"),
                logFileMeta("art-2", "events.jsonl", 6_789L, ".jsonl",
                    "application/x-ndjson", "2026-05-10T10:00:01Z",
                    "discovery-runs/" + runId + "/logs/events.jsonl")
            ),
            "attemptedCount", 2
        ));

        mockMvc.perform(patch(BASE_PATH, projectId, architectureId, runId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(seedBody))
            .andExpect(status().isOk());
    }

    /**
     * Find the first entry in {@code logFiles} whose {@code artifactId}
     * matches the given id, or null if none.
     */
    private Map<String, Object> findById(List<Map<String, Object>> logFiles, String id) {
        for (Map<String, Object> entry : logFiles) {
            if (id.equals(entry.get("artifactId"))) {
                return entry;
            }
        }
        return null;
    }
}
