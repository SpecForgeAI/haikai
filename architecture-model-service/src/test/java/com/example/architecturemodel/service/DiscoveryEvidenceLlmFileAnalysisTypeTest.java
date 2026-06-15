package com.example.architecturemodel.service;

import com.example.architecturemodel.model.entity.DiscoveryEvidenceEntity;
import com.example.architecturemodel.repository.entity.DiscoveryEvidenceRepository;
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
 * Tests for the 'llm_file_analysis' evidence type support in the JPA layer.
 *
 * Spec: Extension Pack Framework & LLM File-Level Analysis
 * Task Group 3: JPA Evidence Type Extension
 *
 * 2 focused tests:
 * 1. DiscoveryEvidenceEntity accepts type = 'llm_file_analysis'
 * 2. Evidence with 'llm_file_analysis' type can be persisted and queried by run ID and type
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryEvidenceLlmFileAnalysisTypeTest {

    @Mock
    private DiscoveryEvidenceRepository evidenceRepository;

    /**
     * Test 1: DiscoveryEvidenceEntity accepts type = 'llm_file_analysis'.
     *
     * Verifies that the entity builder can construct an evidence atom with the
     * new 'llm_file_analysis' type value, and that all fields are correctly
     * populated including the type-specific JSONB data payload containing
     * entities, relationships, rawLlmResponse, and analyzedAt.
     */
    @Test
    @DisplayName("Test 1: DiscoveryEvidenceEntity accepts type = 'llm_file_analysis'")
    void entityAcceptsLlmFileAnalysisType() {
        // Given
        UUID evidenceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        Instant extractedAt = Instant.parse("2026-04-07T10:30:00Z");

        // Build the llm_file_analysis data payload
        Map<String, Object> llmFileAnalysisData = new HashMap<>();
        llmFileAnalysisData.put("filePath", "src/main/java/com/example/UserController.java");

        Map<String, Object> entity1 = new HashMap<>();
        entity1.put("entityType", "class");
        entity1.put("name", "UserController");
        entity1.put("confidence", 0.95);
        entity1.put("filePath", "src/main/java/com/example/UserController.java");
        entity1.put("lineRange", List.of(10, 150));
        entity1.put("metadata", Map.of("annotations", List.of("@RestController")));

        Map<String, Object> entity2 = new HashMap<>();
        entity2.put("entityType", "endpoint");
        entity2.put("name", "GET /api/users");
        entity2.put("confidence", 0.9);
        entity2.put("filePath", "src/main/java/com/example/UserController.java");
        entity2.put("parentEntityName", "UserController");
        entity2.put("metadata", Map.of("httpMethod", "GET", "path", "/api/users"));

        llmFileAnalysisData.put("entities", List.of(entity1, entity2));

        Map<String, Object> relationship1 = new HashMap<>();
        relationship1.put("sourceEntityName", "GET /api/users");
        relationship1.put("targetEntityName", "UserController");
        relationship1.put("relationshipType", "belongs_to");
        relationship1.put("detail", "Endpoint defined in UserController class");
        llmFileAnalysisData.put("relationships", List.of(relationship1));

        llmFileAnalysisData.put("rawLlmResponse", "{\"entities\":[...],\"relationships\":[...]}");
        llmFileAnalysisData.put("analyzedAt", "2026-04-07T10:30:00Z");

        // When -- construct entity with llm_file_analysis type
        DiscoveryEvidenceEntity entity = DiscoveryEvidenceEntity.builder()
            .id(evidenceId)
            .runId(runId)
            .repoUrl("https://github.com/example/my-app")
            .filePath("src/main/java/com/example/UserController.java")
            .type("llm_file_analysis")
            .data(llmFileAnalysisData)
            .extractedAt(extractedAt)
            .build();

        // Then -- verify all fields
        assertThat(entity).isNotNull();
        assertThat(entity.getId()).isEqualTo(evidenceId);
        assertThat(entity.getRunId()).isEqualTo(runId);
        assertThat(entity.getRepoUrl()).isEqualTo("https://github.com/example/my-app");
        assertThat(entity.getFilePath()).isEqualTo("src/main/java/com/example/UserController.java");
        assertThat(entity.getType()).isEqualTo("llm_file_analysis");
        assertThat(entity.getExtractedAt()).isEqualTo(extractedAt);

        // Verify JSONB data payload
        assertThat(entity.getData()).containsKey("filePath");
        assertThat(entity.getData().get("filePath")).isEqualTo("src/main/java/com/example/UserController.java");
        assertThat(entity.getData()).containsKey("entities");
        assertThat(entity.getData()).containsKey("relationships");
        assertThat(entity.getData()).containsKey("rawLlmResponse");
        assertThat(entity.getData()).containsKey("analyzedAt");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> entities = (List<Map<String, Object>>) entity.getData().get("entities");
        assertThat(entities).hasSize(2);
        assertThat(entities.get(0).get("entityType")).isEqualTo("class");
        assertThat(entities.get(0).get("name")).isEqualTo("UserController");
        assertThat(entities.get(1).get("entityType")).isEqualTo("endpoint");
        assertThat(entities.get(1).get("name")).isEqualTo("GET /api/users");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> relationships = (List<Map<String, Object>>) entity.getData().get("relationships");
        assertThat(relationships).hasSize(1);
        assertThat(relationships.get(0).get("sourceEntityName")).isEqualTo("GET /api/users");
        assertThat(relationships.get(0).get("targetEntityName")).isEqualTo("UserController");
        assertThat(relationships.get(0).get("relationshipType")).isEqualTo("belongs_to");

        // Verify the type is distinguishable from existing types
        assertThat(entity.getType()).isNotEqualTo("file_structure");
        assertThat(entity.getType()).isNotEqualTo("symbol");
        assertThat(entity.getType()).isNotEqualTo("string_pattern");
    }

    /**
     * Test 2: Evidence with 'llm_file_analysis' type can be persisted and queried
     * by run ID and type.
     *
     * Verifies the repository save/findByRunIdAndType round-trip for the new type,
     * ensuring the entity survives persistence and can be filtered by the
     * 'llm_file_analysis' type discriminator alongside existing evidence types.
     */
    @Test
    @DisplayName("Test 2: Evidence with llm_file_analysis type can be persisted and queried by run ID and type")
    void llmFileAnalysisEvidenceCanBePersistedAndQueriedByType() {
        // Given
        UUID runId = UUID.randomUUID();
        Instant now = Instant.now();

        // Create an llm_file_analysis evidence atom
        Map<String, Object> llmData = new HashMap<>();
        llmData.put("filePath", "src/index.ts");
        llmData.put("entities", List.of(
            Map.of("entityType", "method", "name", "handleRequest",
                   "confidence", 0.85, "filePath", "src/index.ts",
                   "metadata", Map.of())
        ));
        llmData.put("relationships", List.of());
        llmData.put("rawLlmResponse", "{}");
        llmData.put("analyzedAt", "2026-04-07T11:00:00Z");

        DiscoveryEvidenceEntity llmEvidence = DiscoveryEvidenceEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .repoUrl("https://github.com/example/frontend")
            .filePath("src/index.ts")
            .type("llm_file_analysis")
            .data(llmData)
            .extractedAt(now)
            .build();

        // Create existing-type evidence atoms for the same run
        DiscoveryEvidenceEntity fileStructureEvidence = DiscoveryEvidenceEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .repoUrl("https://github.com/example/frontend")
            .filePath("src/index.ts")
            .type("file_structure")
            .data(Map.of("relativePath", "src/index.ts", "extension", ".ts",
                         "sizeBytes", 2048, "lineCount", 80))
            .extractedAt(now)
            .build();

        DiscoveryEvidenceEntity symbolEvidence = DiscoveryEvidenceEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .repoUrl("https://github.com/example/frontend")
            .filePath("src/index.ts")
            .type("symbol")
            .data(Map.of("name", "handleRequest", "kind", "function",
                         "line", 10, "scope", "Server", "language", "TypeScript"))
            .extractedAt(now)
            .build();

        // Mock repository behavior: saveAll accepts all types
        when(evidenceRepository.saveAll(anyList()))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // Mock repository behavior: findByRunIdAndType returns only matching type
        when(evidenceRepository.findByRunIdAndType(runId, "llm_file_analysis"))
            .thenReturn(List.of(llmEvidence));

        when(evidenceRepository.findByRunId(runId))
            .thenReturn(List.of(fileStructureEvidence, symbolEvidence, llmEvidence));

        // When -- persist all three types
        List<DiscoveryEvidenceEntity> allAtoms = List.of(
            fileStructureEvidence, symbolEvidence, llmEvidence
        );
        List<DiscoveryEvidenceEntity> saved = evidenceRepository.saveAll(allAtoms);

        // Then -- verify all three saved successfully
        assertThat(saved).hasSize(3);
        assertThat(saved.get(0).getType()).isEqualTo("file_structure");
        assertThat(saved.get(1).getType()).isEqualTo("symbol");
        assertThat(saved.get(2).getType()).isEqualTo("llm_file_analysis");

        // When -- query by run ID (unfiltered)
        List<DiscoveryEvidenceEntity> allForRun = evidenceRepository.findByRunId(runId);

        // Then -- all three types returned
        assertThat(allForRun).hasSize(3);
        List<String> types = allForRun.stream()
            .map(DiscoveryEvidenceEntity::getType)
            .toList();
        assertThat(types).containsExactlyInAnyOrder(
            "file_structure", "symbol", "llm_file_analysis"
        );

        // When -- query by run ID and type filter
        List<DiscoveryEvidenceEntity> llmOnly =
            evidenceRepository.findByRunIdAndType(runId, "llm_file_analysis");

        // Then -- only llm_file_analysis atoms returned
        assertThat(llmOnly).hasSize(1);
        assertThat(llmOnly.get(0).getType()).isEqualTo("llm_file_analysis");
        assertThat(llmOnly.get(0).getData()).containsKey("filePath");
        assertThat(llmOnly.get(0).getData()).containsKey("entities");
        assertThat(llmOnly.get(0).getData()).containsKey("rawLlmResponse");
        assertThat(llmOnly.get(0).getData()).containsKey("analyzedAt");

        // Verify interactions
        verify(evidenceRepository).saveAll(allAtoms);
        verify(evidenceRepository).findByRunId(runId);
        verify(evidenceRepository).findByRunIdAndType(runId, "llm_file_analysis");
    }
}
