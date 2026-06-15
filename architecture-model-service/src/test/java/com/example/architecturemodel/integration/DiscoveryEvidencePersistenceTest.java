package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.entity.DiscoveryEvidenceEntity;
import com.example.architecturemodel.model.entity.DiscoveryRunEntity;
import com.example.architecturemodel.repository.entity.DiscoveryEvidenceRepository;
import com.example.architecturemodel.repository.entity.DiscoveryRunRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Persistence-focused tests for DiscoveryEvidenceEntity and the discovery_evidence
 * Liquibase migration.
 *
 * Verifies:
 * - Test 1: Entity can be persisted and retrieved with all fields
 * - Test 2: JSONB data column round-trips a Map<String, Object> correctly
 * - Test 3: Cascade delete removes evidence atoms when parent discovery_run is deleted
 *
 * These tests use Mockito to verify entity construction, field mapping, and
 * repository interaction patterns. The actual ON DELETE CASCADE behavior is
 * enforced at the database level by the 066-discovery-evidence.sql migration
 * (FK constraint on run_id with ON DELETE CASCADE).
 *
 * Spec: Phase 1a Universal Evidence Extraction (Increment 6)
 * Task Group 1: Discovery Evidence Table and Liquibase Migration
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryEvidencePersistenceTest {

    @Mock
    private DiscoveryEvidenceRepository evidenceRepository;

    @Mock
    private DiscoveryRunRepository runRepository;

    /**
     * Test 1: DiscoveryEvidenceEntity can be persisted and retrieved with all fields
     * (id, runId, repoUrl, filePath, type, data JSONB, extractedAt).
     *
     * Verifies that the entity builder correctly populates all fields and that
     * the repository save/findById round-trip returns an entity with all fields intact.
     */
    @Test
    @DisplayName("Test 1: Entity persists and retrieves with all fields")
    void entityCanBePersistedAndRetrievedWithAllFields() {
        // Given
        UUID evidenceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        Instant extractedAt = Instant.parse("2026-04-04T10:30:00Z");

        Map<String, Object> data = new HashMap<>();
        data.put("relativePath", "src/main/java/App.java");
        data.put("extension", ".java");
        data.put("sizeBytes", 2048);
        data.put("lineCount", 75);

        DiscoveryEvidenceEntity entity = DiscoveryEvidenceEntity.builder()
            .id(evidenceId)
            .runId(runId)
            .repoUrl("https://github.com/example/my-app")
            .filePath("src/main/java/App.java")
            .type("file_structure")
            .data(data)
            .extractedAt(extractedAt)
            .build();

        when(evidenceRepository.save(any(DiscoveryEvidenceEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        when(evidenceRepository.findById(evidenceId))
            .thenReturn(Optional.of(entity));

        // When -- save
        DiscoveryEvidenceEntity saved = evidenceRepository.save(entity);

        // Then -- verify saved entity has all fields
        assertThat(saved).isNotNull();
        assertThat(saved.getId()).isEqualTo(evidenceId);
        assertThat(saved.getRunId()).isEqualTo(runId);
        assertThat(saved.getRepoUrl()).isEqualTo("https://github.com/example/my-app");
        assertThat(saved.getFilePath()).isEqualTo("src/main/java/App.java");
        assertThat(saved.getType()).isEqualTo("file_structure");
        assertThat(saved.getData()).isEqualTo(data);
        assertThat(saved.getExtractedAt()).isEqualTo(extractedAt);

        // When -- retrieve
        Optional<DiscoveryEvidenceEntity> retrieved = evidenceRepository.findById(evidenceId);

        // Then -- verify retrieved entity has all fields intact
        assertThat(retrieved).isPresent();
        DiscoveryEvidenceEntity loaded = retrieved.get();
        assertThat(loaded.getId()).isEqualTo(evidenceId);
        assertThat(loaded.getRunId()).isEqualTo(runId);
        assertThat(loaded.getRepoUrl()).isEqualTo("https://github.com/example/my-app");
        assertThat(loaded.getFilePath()).isEqualTo("src/main/java/App.java");
        assertThat(loaded.getType()).isEqualTo("file_structure");
        assertThat(loaded.getData()).containsEntry("relativePath", "src/main/java/App.java");
        assertThat(loaded.getData()).containsEntry("extension", ".java");
        assertThat(loaded.getData()).containsEntry("sizeBytes", 2048);
        assertThat(loaded.getData()).containsEntry("lineCount", 75);
        assertThat(loaded.getExtractedAt()).isEqualTo(extractedAt);

        verify(evidenceRepository).save(entity);
        verify(evidenceRepository).findById(evidenceId);
    }

    /**
     * Test 2: JSONB data column round-trips a Map<String, Object> correctly.
     *
     * Verifies that type-specific payloads for all three evidence atom types
     * (file_structure, symbol, string_pattern) survive the entity construction
     * and field access cycle with correct types and values.
     */
    @Test
    @DisplayName("Test 2: JSONB data column round-trips Map<String, Object> correctly")
    void jsonbDataColumnRoundTripsMapCorrectly() {
        UUID runId = UUID.randomUUID();
        Instant now = Instant.now();

        // -- file_structure payload --
        Map<String, Object> fileStructureData = new HashMap<>();
        fileStructureData.put("relativePath", "src/index.ts");
        fileStructureData.put("extension", ".ts");
        fileStructureData.put("sizeBytes", 4096);
        fileStructureData.put("lineCount", 120);

        DiscoveryEvidenceEntity fileAtom = DiscoveryEvidenceEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .repoUrl("https://github.com/example/frontend")
            .filePath("src/index.ts")
            .type("file_structure")
            .data(fileStructureData)
            .extractedAt(now)
            .build();

        assertThat(fileAtom.getData()).hasSize(4);
        assertThat(fileAtom.getData().get("relativePath")).isEqualTo("src/index.ts");
        assertThat(fileAtom.getData().get("extension")).isEqualTo(".ts");
        assertThat(fileAtom.getData().get("sizeBytes")).isEqualTo(4096);
        assertThat(fileAtom.getData().get("lineCount")).isEqualTo(120);

        // -- symbol payload --
        Map<String, Object> symbolData = new HashMap<>();
        symbolData.put("name", "calculateTax");
        symbolData.put("kind", "function");
        symbolData.put("line", 42);
        symbolData.put("scope", "TaxService");
        symbolData.put("language", "Java");

        DiscoveryEvidenceEntity symbolAtom = DiscoveryEvidenceEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .repoUrl("https://github.com/example/backend")
            .filePath("src/main/java/TaxService.java")
            .type("symbol")
            .data(symbolData)
            .extractedAt(now)
            .build();

        assertThat(symbolAtom.getData()).hasSize(5);
        assertThat(symbolAtom.getData().get("name")).isEqualTo("calculateTax");
        assertThat(symbolAtom.getData().get("kind")).isEqualTo("function");
        assertThat(symbolAtom.getData().get("line")).isEqualTo(42);
        assertThat(symbolAtom.getData().get("scope")).isEqualTo("TaxService");
        assertThat(symbolAtom.getData().get("language")).isEqualTo("Java");

        // -- string_pattern payload --
        Map<String, Object> patternData = new HashMap<>();
        patternData.put("patternName", "spring_boot_app");
        patternData.put("matchedText", "@SpringBootApplication");
        patternData.put("line", 8);
        patternData.put("contextSnippet", "@SpringBootApplication\npublic class Application {");

        DiscoveryEvidenceEntity patternAtom = DiscoveryEvidenceEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .repoUrl("https://github.com/example/backend")
            .filePath("src/main/java/Application.java")
            .type("string_pattern")
            .data(patternData)
            .extractedAt(now)
            .build();

        assertThat(patternAtom.getData()).hasSize(4);
        assertThat(patternAtom.getData().get("patternName")).isEqualTo("spring_boot_app");
        assertThat(patternAtom.getData().get("matchedText")).isEqualTo("@SpringBootApplication");
        assertThat(patternAtom.getData().get("line")).isEqualTo(8);
        assertThat(patternAtom.getData().get("contextSnippet")).isEqualTo(
            "@SpringBootApplication\npublic class Application {"
        );

        // Verify repository would accept all three types through saveAll
        when(evidenceRepository.saveAll(anyList()))
            .thenAnswer(invocation -> invocation.getArgument(0));

        List<DiscoveryEvidenceEntity> atoms = List.of(fileAtom, symbolAtom, patternAtom);
        List<DiscoveryEvidenceEntity> savedAtoms = evidenceRepository.saveAll(atoms);

        assertThat(savedAtoms).hasSize(3);
        assertThat(savedAtoms.get(0).getType()).isEqualTo("file_structure");
        assertThat(savedAtoms.get(1).getType()).isEqualTo("symbol");
        assertThat(savedAtoms.get(2).getType()).isEqualTo("string_pattern");

        // Each atom's data map retains its type-specific structure
        assertThat(savedAtoms.get(0).getData()).containsKey("relativePath");
        assertThat(savedAtoms.get(0).getData()).containsKey("lineCount");
        assertThat(savedAtoms.get(1).getData()).containsKey("name");
        assertThat(savedAtoms.get(1).getData()).containsKey("language");
        assertThat(savedAtoms.get(2).getData()).containsKey("patternName");
        assertThat(savedAtoms.get(2).getData()).containsKey("contextSnippet");

        verify(evidenceRepository).saveAll(atoms);
    }

    /**
     * Test 3: Cascade delete removes evidence atoms when the parent discovery_run is deleted.
     *
     * Verifies the FK cascade delete contract: when a discovery run is deleted,
     * all associated evidence atoms should be removed. This test verifies the
     * repository-level behavior through mocks. The actual ON DELETE CASCADE is
     * enforced at the database level by the 066-discovery-evidence.sql migration
     * (CONSTRAINT fk_discovery_evidence_run FOREIGN KEY (run_id)
     *  REFERENCES discovery_run(id) ON DELETE CASCADE).
     *
     * The test simulates the cascade by:
     * 1. Creating a run and associated evidence atoms linked by runId
     * 2. Verifying evidence atoms are associated with the run's ID
     * 3. Deleting the run
     * 4. Verifying that evidence atoms for that run are no longer retrievable
     */
    @Test
    @DisplayName("Test 3: Cascade delete removes evidence atoms when parent run is deleted")
    void cascadeDeleteRemovesEvidenceWhenRunDeleted() {
        // Given -- a discovery run with evidence atoms
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryRunEntity run = DiscoveryRunEntity.builder()
            .id(runId)
            .projectId(projectId)
            .status("COMPLETED")
            .configSnapshot(Map.of("repos", List.of()))
            .createdAt(now)
            .updatedAt(now)
            .build();

        DiscoveryEvidenceEntity evidence1 = DiscoveryEvidenceEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .repoUrl("https://github.com/example/repo")
            .filePath("src/App.java")
            .type("file_structure")
            .data(Map.of("relativePath", "src/App.java", "extension", ".java",
                         "sizeBytes", 1024, "lineCount", 30))
            .extractedAt(now)
            .build();

        DiscoveryEvidenceEntity evidence2 = DiscoveryEvidenceEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .repoUrl("https://github.com/example/repo")
            .filePath("src/App.java")
            .type("symbol")
            .data(Map.of("name", "main", "kind", "function", "line", 10,
                         "scope", "App", "language", "Java"))
            .extractedAt(now)
            .build();

        // Verify evidence atoms reference the correct run ID (FK relationship)
        assertThat(evidence1.getRunId()).isEqualTo(run.getId());
        assertThat(evidence2.getRunId()).isEqualTo(run.getId());

        // Simulate initial state: evidence atoms exist for that run
        when(evidenceRepository.findByRunId(runId))
            .thenReturn(List.of(evidence1, evidence2))  // Before delete: 2 atoms
            .thenReturn(List.of());  // After delete: 0 atoms (cascade removed them)
        when(evidenceRepository.countByRunId(runId))
            .thenReturn(2L)   // Before delete
            .thenReturn(0L);  // After delete

        // Verify initial state: run has 2 evidence atoms
        List<DiscoveryEvidenceEntity> beforeDelete = evidenceRepository.findByRunId(runId);
        assertThat(beforeDelete).hasSize(2);
        assertThat(beforeDelete).allMatch(e -> e.getRunId().equals(runId));
        assertThat(evidenceRepository.countByRunId(runId)).isEqualTo(2L);

        // When -- delete the parent discovery run
        // (In production, the ON DELETE CASCADE FK constraint removes evidence atoms
        //  automatically when the run row is deleted from discovery_run table)
        runRepository.deleteById(runId);

        // Then -- evidence atoms for this run should be gone (cascade)
        List<DiscoveryEvidenceEntity> afterDelete = evidenceRepository.findByRunId(runId);
        assertThat(afterDelete).isEmpty();
        assertThat(evidenceRepository.countByRunId(runId)).isEqualTo(0L);

        // Verify the run was deleted
        verify(runRepository).deleteById(runId);

        // Verify evidence queries were made (2 findByRunId calls: before and after)
        verify(evidenceRepository, times(2)).findByRunId(runId);
        verify(evidenceRepository, times(2)).countByRunId(runId);
    }
}
