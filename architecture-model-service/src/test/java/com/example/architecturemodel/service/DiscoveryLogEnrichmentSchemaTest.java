package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryCandidateDto;
import com.example.architecturemodel.model.dto.DiscoveryEvidenceDto;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import com.example.architecturemodel.model.entity.DiscoveryEvidenceEntity;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import com.example.architecturemodel.repository.entity.DiscoveryEvidenceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Tests for the schema extensions added in Log-based Discovery Enrichment (Increment 14).
 *
 * Verifies the new fields on DiscoveryEvidenceEntity/Dto (source, logOrigin) and
 * DiscoveryCandidateEntity/Dto (logEnrichment) round-trip correctly, and that
 * backward compatibility is maintained when these fields are null.
 *
 * Spec: Log-based Discovery Enrichment (Increment 14)
 * Task Group 1, Task 1.1: 4 focused tests for schema extensions
 *
 * Test 1: DiscoveryEvidenceEntity with source and logOrigin fields set (round-trip)
 * Test 2: DiscoveryEvidenceEntity backward compatibility (source and logOrigin null)
 * Test 3: DiscoveryCandidateEntity with logEnrichment JSONB field set (round-trip)
 * Test 4: DiscoveryCandidateEntity backward compatibility (logEnrichment null)
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryLogEnrichmentSchemaTest {

    @Mock
    private DiscoveryEvidenceRepository evidenceRepository;

    @Mock
    private DiscoveryCandidateRepository candidateRepository;

    @Mock
    private DiscoveryRunArchitectureGuard runGuard;

    private DiscoveryEvidenceService evidenceService;
    private DiscoveryCandidateService candidateService;

    private static final UUID RUN_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        evidenceService = new DiscoveryEvidenceService(evidenceRepository, runGuard);
        candidateService = new DiscoveryCandidateService(candidateRepository, runGuard);
    }

    /**
     * Test 1: DiscoveryEvidenceEntity with source and logOrigin fields set (round-trip).
     *
     * Verifies that building an entity with source="log" and a populated logOrigin map,
     * then converting it through the service toDto path, preserves both fields correctly.
     * Also verifies that the entity builder correctly stores the JSONB logOrigin map
     * with filePath, lineStart, lineEnd, timestamp, and occurrenceCount.
     */
    @Test
    @DisplayName("Test 1: DiscoveryEvidenceEntity with source and logOrigin fields set round-trips correctly")
    void evidenceEntity_withSourceAndLogOrigin_roundTripsCorrectly() {
        // Given: an evidence entity with source="log" and populated logOrigin
        UUID evidenceId = UUID.randomUUID();
        Instant extractedAt = Instant.parse("2026-04-05T10:00:00Z");

        Map<String, Object> logOrigin = new HashMap<>();
        logOrigin.put("filePath", "/var/log/app/server.log");
        logOrigin.put("lineStart", 42);
        logOrigin.put("lineEnd", 42);
        logOrigin.put("timestamp", "2026-04-05T09:30:00Z");
        logOrigin.put("occurrenceCount", 5);

        Map<String, Object> data = new HashMap<>();
        data.put("patternName", "endpoint_usage_log");
        data.put("matchedText", "GET /api/orders");
        data.put("line", 42);

        DiscoveryEvidenceEntity entity = DiscoveryEvidenceEntity.builder()
            .id(evidenceId)
            .runId(RUN_ID)
            .repoUrl("https://github.com/example/app")
            .filePath("/var/log/app/server.log")
            .type("string_pattern")
            .data(data)
            .extractedAt(extractedAt)
            .source("log")
            .logOrigin(logOrigin)
            .build();

        // Then: entity fields are correct
        assertThat(entity.getSource()).isEqualTo("log");
        assertThat(entity.getLogOrigin()).isNotNull();
        assertThat(entity.getLogOrigin()).containsEntry("filePath", "/var/log/app/server.log");
        assertThat(entity.getLogOrigin()).containsEntry("lineStart", 42);
        assertThat(entity.getLogOrigin()).containsEntry("lineEnd", 42);
        assertThat(entity.getLogOrigin()).containsEntry("timestamp", "2026-04-05T09:30:00Z");
        assertThat(entity.getLogOrigin()).containsEntry("occurrenceCount", 5);

        // And: round-trip through the service toDto path preserves both fields
        when(evidenceRepository.findByRunId(RUN_ID))
            .thenReturn(List.of(entity));

        List<DiscoveryEvidenceDto> result = evidenceService.getByRunId(RUN_ID, null);
        assertThat(result).hasSize(1);

        DiscoveryEvidenceDto dto = result.get(0);
        assertThat(dto.source()).isEqualTo("log");
        assertThat(dto.logOrigin()).isNotNull();
        assertThat(dto.logOrigin()).containsEntry("filePath", "/var/log/app/server.log");
        assertThat(dto.logOrigin()).containsEntry("lineStart", 42);
        assertThat(dto.logOrigin()).containsEntry("lineEnd", 42);
        assertThat(dto.logOrigin()).containsEntry("timestamp", "2026-04-05T09:30:00Z");
        assertThat(dto.logOrigin()).containsEntry("occurrenceCount", 5);

        // And: existing fields are still correct
        assertThat(dto.id()).isEqualTo(evidenceId);
        assertThat(dto.runId()).isEqualTo(RUN_ID);
        assertThat(dto.type()).isEqualTo("string_pattern");
        assertThat(dto.data()).containsEntry("patternName", "endpoint_usage_log");
    }

    /**
     * Test 2: DiscoveryEvidenceEntity backward compatibility (source and logOrigin null).
     *
     * Verifies that building an entity without setting source or logOrigin (simulating
     * a pre-existing code-derived atom) leaves both fields null, and that toDto
     * correctly maps null values. This ensures existing atoms continue to work unchanged.
     */
    @Test
    @DisplayName("Test 2: DiscoveryEvidenceEntity backward compatibility - source and logOrigin null")
    void evidenceEntity_backwardCompatibility_sourceAndLogOriginNull() {
        // Given: an evidence entity built without source or logOrigin (pre-existing pattern)
        UUID evidenceId = UUID.randomUUID();
        Instant extractedAt = Instant.parse("2026-04-05T08:00:00Z");

        Map<String, Object> data = new HashMap<>();
        data.put("relativePath", "src/main/java/App.java");
        data.put("extension", ".java");
        data.put("sizeBytes", 2048);
        data.put("lineCount", 75);

        DiscoveryEvidenceEntity entity = DiscoveryEvidenceEntity.builder()
            .id(evidenceId)
            .runId(RUN_ID)
            .repoUrl("https://github.com/example/repo")
            .filePath("src/main/java/App.java")
            .type("file_structure")
            .data(data)
            .extractedAt(extractedAt)
            // source and logOrigin NOT set -- backward compatibility
            .build();

        // Then: both new fields are null
        assertThat(entity.getSource()).isNull();
        assertThat(entity.getLogOrigin()).isNull();

        // And: toDto preserves null values
        when(evidenceRepository.findByRunId(RUN_ID))
            .thenReturn(List.of(entity));

        List<DiscoveryEvidenceDto> result = evidenceService.getByRunId(RUN_ID, null);
        assertThat(result).hasSize(1);

        DiscoveryEvidenceDto dto = result.get(0);
        assertThat(dto.source()).isNull();
        assertThat(dto.logOrigin()).isNull();

        // And: existing fields are unaffected
        assertThat(dto.id()).isEqualTo(evidenceId);
        assertThat(dto.type()).isEqualTo("file_structure");
        assertThat(dto.data()).containsEntry("relativePath", "src/main/java/App.java");
        assertThat(dto.data()).containsEntry("extension", ".java");
        assertThat(dto.data()).containsEntry("sizeBytes", 2048);
        assertThat(dto.data()).containsEntry("lineCount", 75);
    }

    /**
     * Test 3: DiscoveryCandidateEntity with logEnrichment JSONB field set (round-trip).
     *
     * Verifies that building a candidate entity with a populated logEnrichment map
     * (enriched=true, logAtomCount, signalSummary), then converting through toDto,
     * preserves the field correctly.
     */
    @Test
    @DisplayName("Test 3: DiscoveryCandidateEntity with logEnrichment JSONB field set round-trips correctly")
    void candidateEntity_withLogEnrichment_roundTripsCorrectly() {
        // Given: a candidate entity with populated logEnrichment
        UUID candidateId = UUID.randomUUID();
        Instant synthesizedAt = Instant.parse("2026-04-05T11:00:00Z");

        Map<String, Object> logEnrichment = new HashMap<>();
        logEnrichment.put("enriched", true);
        logEnrichment.put("logAtomCount", 7);
        logEnrichment.put("signalSummary", "3 endpoint hits observed, 4 error traces matched");

        DiscoveryCandidateEntity entity = DiscoveryCandidateEntity.builder()
            .id(candidateId)
            .runId(RUN_ID)
            .candidateType("application")
            .name("OrderService")
            .confidence(0.85)
            .status("proposed")
            .sourceClusterIds(List.of("cluster-1", "cluster-2"))
            .data(Map.of("description", "Order management application"))
            .synthesizedAt(synthesizedAt)
            .logEnrichment(logEnrichment)
            .build();

        // Then: entity logEnrichment is correct
        assertThat(entity.getLogEnrichment()).isNotNull();
        assertThat(entity.getLogEnrichment()).containsEntry("enriched", true);
        assertThat(entity.getLogEnrichment()).containsEntry("logAtomCount", 7);
        assertThat(entity.getLogEnrichment()).containsEntry("signalSummary",
            "3 endpoint hits observed, 4 error traces matched");

        // And: round-trip through the service toDto path preserves the field
        DiscoveryCandidateDto dto = candidateService.toDto(entity);
        assertThat(dto.logEnrichment()).isNotNull();
        assertThat(dto.logEnrichment()).containsEntry("enriched", true);
        assertThat(dto.logEnrichment()).containsEntry("logAtomCount", 7);
        assertThat(dto.logEnrichment()).containsEntry("signalSummary",
            "3 endpoint hits observed, 4 error traces matched");

        // And: existing fields are still correct
        assertThat(dto.id()).isEqualTo(candidateId);
        assertThat(dto.candidateType()).isEqualTo("application");
        assertThat(dto.name()).isEqualTo("OrderService");
        assertThat(dto.confidence()).isEqualTo(0.85);
        assertThat(dto.reviewStatus()).isEqualTo("pending_review");
    }

    /**
     * Test 4: DiscoveryCandidateEntity backward compatibility (logEnrichment null).
     *
     * Verifies that building a candidate entity without setting logEnrichment (simulating
     * a pre-existing candidate without log enrichment) leaves the field null, and that
     * toDto correctly maps null. This ensures existing candidates continue to work unchanged.
     */
    @Test
    @DisplayName("Test 4: DiscoveryCandidateEntity backward compatibility - logEnrichment null")
    void candidateEntity_backwardCompatibility_logEnrichmentNull() {
        // Given: a candidate entity built without logEnrichment (pre-existing pattern)
        UUID candidateId = UUID.randomUUID();
        Instant synthesizedAt = Instant.parse("2026-04-05T09:00:00Z");

        DiscoveryCandidateEntity entity = DiscoveryCandidateEntity.builder()
            .id(candidateId)
            .runId(RUN_ID)
            .candidateType("service")
            .name("PaymentGateway")
            .confidence(0.72)
            .status("proposed")
            .sourceClusterIds(List.of("cluster-a"))
            .data(Map.of("description", "Payment processing service"))
            .synthesizedAt(synthesizedAt)
            // logEnrichment NOT set -- backward compatibility
            .build();

        // Then: logEnrichment is null
        assertThat(entity.getLogEnrichment()).isNull();

        // And: toDto preserves null
        DiscoveryCandidateDto dto = candidateService.toDto(entity);
        assertThat(dto.logEnrichment()).isNull();

        // And: existing fields are unaffected
        assertThat(dto.id()).isEqualTo(candidateId);
        assertThat(dto.candidateType()).isEqualTo("service");
        assertThat(dto.name()).isEqualTo("PaymentGateway");
        assertThat(dto.confidence()).isEqualTo(0.72);
        assertThat(dto.status()).isEqualTo("proposed");
        assertThat(dto.reviewStatus()).isEqualTo("pending_review");
        assertThat(dto.parentCandidateId()).isNull();
        assertThat(dto.reviewedBy()).isNull();
        assertThat(dto.reviewedAt()).isNull();
        assertThat(dto.previousReviewStatus()).isNull();
    }
}
