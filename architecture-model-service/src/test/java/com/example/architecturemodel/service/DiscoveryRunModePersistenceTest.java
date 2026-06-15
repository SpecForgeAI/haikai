package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryRunDto;
import com.example.architecturemodel.model.entity.DiscoveryRunEntity;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Focused tests for the V3 discovery_run.mode column plumbing.
 *
 * Spec: V3 Discovery Pipeline Foundation - Task Group 1
 *
 * Verifies the end-to-end path for the new nullable `mode` column:
 *   DB column (83-discovery-run-mode.sql)
 *     -> DiscoveryRunEntity.mode (@Column("mode"))
 *     -> DiscoveryRunDto.mode (@JsonProperty("mode"))
 *
 * These tests intentionally cover only the column plumbing — orchestration
 * of when the mode is written lives in the discovery-service TypeScript
 * pipeline (Task Group 5 of the V3 spec).
 *
 * Style modeled on ServiceCoreTechPersistenceTest + EntityMapperParticipantStylingTest.
 *
 * Note (Oracle Integrity & Determinism, 2026-05-30 -- TG1): the DTO record gained
 * two trailing-of-discoveryKind fields -- `degraded` (boxed Boolean) and
 * `degraded_reasons` (String) -- inserted between `discovery_kind` and `status`.
 * These constructor calls pass null/null for them (no degraded signal), which is
 * valid (nullable, no backfill) and orthogonal to the mode-plumbing under test.
 */
class DiscoveryRunModePersistenceTest {

    /**
     * Test 1: Entity with mode = "A" copies through to DTO constructor.
     *
     * Mirrors the existing `serviceId` pattern in DiscoveryRunService.toDto().
     */
    @Test
    @DisplayName("Test 1: DiscoveryRunEntity with mode='A' constructs DiscoveryRunDto with mode='A'")
    void entityToDto_preservesModeA() {
        // Given: an entity populated with tier A
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        Instant now = Instant.now();

        UUID architectureId = UUID.randomUUID();
        DiscoveryRunEntity entity = DiscoveryRunEntity.builder()
            .id(runId)
            .projectId(projectId)
            .architectureId(architectureId)
            .serviceId("svc-alpha")
            .mode("A")
            .status("COMPLETED")
            .configSnapshot(new HashMap<>())
            .stepsPayload(new HashMap<>())
            .createdAt(now)
            .updatedAt(now)
            .build();

        // When: constructing a DTO from entity fields (mirrors DiscoveryRunService.toDto)
        DiscoveryRunDto dto = new DiscoveryRunDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getArchitectureId(),
            entity.getServiceId(),
            entity.getMode(),
            entity.getMode(),
            entity.getWarnings(),
            entity.isConfirmedLlmSolo(),
            null,                 // discoveryKind
            entity.getDegraded(), // degraded (Oracle Integrity & Determinism)
            entity.getDegradedReasons(), // degraded_reasons
            entity.getStatus(),
            entity.getCurrentStep(),
            entity.getConfigSnapshot(),
            entity.getStepsPayload(),
            entity.getErrorMessage(),
            entity.getCreatedAt().toString(),
            entity.getUpdatedAt().toString()
        );

        // Then: mode carries through
        assertNotNull(dto);
        assertEquals("A", dto.mode(), "mode should be copied from entity to DTO");
        assertEquals(runId, dto.id());
        assertEquals(projectId, dto.projectId());
        // Spec: Discovery Run Robustness Section 3 -- architectureId carries
        // through the entity -> DTO conversion at record position 3.
        assertEquals(architectureId, dto.architectureId(),
            "architectureId should be copied from entity to DTO at position 3");
        assertEquals("svc-alpha", dto.serviceId());
        assertEquals("COMPLETED", dto.status());
    }

    /**
     * Test 2: Null mode round-trips safely (legacy rows pre-V3).
     */
    @Test
    @DisplayName("Test 2: DiscoveryRunEntity with null mode maps to DTO with null mode")
    void entityToDto_preservesNullMode() {
        // Given: an entity with no tier computed (legacy / pre-V3)
        DiscoveryRunEntity entity = DiscoveryRunEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .mode(null)
            .status("PENDING")
            .configSnapshot(new HashMap<>())
            .stepsPayload(new HashMap<>())
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        // When: converting to DTO
        DiscoveryRunDto dto = new DiscoveryRunDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getArchitectureId(),
            entity.getServiceId(),
            entity.getMode(),
            entity.getMode(),
            entity.getWarnings(),
            entity.isConfirmedLlmSolo(),
            null,                 // discoveryKind
            entity.getDegraded(), // degraded (Oracle Integrity & Determinism)
            entity.getDegradedReasons(), // degraded_reasons
            entity.getStatus(),
            entity.getCurrentStep(),
            entity.getConfigSnapshot(),
            entity.getStepsPayload(),
            entity.getErrorMessage(),
            entity.getCreatedAt().toString(),
            entity.getUpdatedAt().toString()
        );

        // Then: mode remains null — no NPE, no default
        assertNotNull(dto);
        assertNull(dto.mode(), "null mode must be preserved through the entity -> DTO conversion");
    }

    /**
     * Test 3: DTO -> entity field copy preserves mode in both directions.
     *
     * Mirrors the EntityMapperParticipantStylingTest round-trip style. The
     * DiscoveryRun entity/DTO conversion lives in DiscoveryRunService, which
     * reads/writes mode on the entity via setMode/getMode.
     */
    @Test
    @DisplayName("Test 3: DiscoveryRunDto.mode round-trips into DiscoveryRunEntity.mode")
    void dtoToEntity_copiesModeBothDirections() {
        // Given: a DTO with mode = "B"
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        String timestamp = Instant.now().toString();

        DiscoveryRunDto dto = new DiscoveryRunDto(
            runId,
            projectId,
            UUID.randomUUID(),  // architectureId (Spec: Discovery Run Robustness Section 3)
            null,       // serviceId
            "B",        // mode (tier B = language-only match)
            "B",        // tier (same as mode)
            null,       // warnings
            false,      // confirmedLlmSolo
            null,       // discoveryKind
            null,       // degraded (Oracle Integrity & Determinism)
            null,       // degraded_reasons
            "RUNNING",
            "1a",
            Map.of(),
            Map.of(),
            null,
            timestamp,
            timestamp
        );

        // When: copying DTO fields into a new entity (simulating persistence write-back)
        DiscoveryRunEntity entity = DiscoveryRunEntity.builder()
            .id(dto.id())
            .projectId(dto.projectId())
            .serviceId(dto.serviceId())
            .mode(dto.mode())
            .status(dto.status())
            .currentStep(dto.currentStep())
            .configSnapshot(new HashMap<>(dto.configSnapshot()))
            .stepsPayload(new HashMap<>(dto.stepsPayload()))
            .errorMessage(dto.errorMessage())
            .build();

        // Then: entity carries the mode
        assertEquals("B", entity.getMode(), "mode should copy from DTO to entity via builder");

        // And: converting back to DTO preserves the mode
        DiscoveryRunDto roundTrip = new DiscoveryRunDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getArchitectureId(),
            entity.getServiceId(),
            entity.getMode(),
            entity.getMode(),
            entity.getWarnings(),
            entity.isConfirmedLlmSolo(),
            null,                 // discoveryKind
            entity.getDegraded(), // degraded (Oracle Integrity & Determinism)
            entity.getDegradedReasons(), // degraded_reasons
            entity.getStatus(),
            entity.getCurrentStep(),
            entity.getConfigSnapshot(),
            entity.getStepsPayload(),
            entity.getErrorMessage(),
            timestamp,
            timestamp
        );
        assertEquals("B", roundTrip.mode(), "mode survives DTO -> entity -> DTO round-trip");
        assertEquals(runId, roundTrip.id());
        assertEquals(projectId, roundTrip.projectId());
    }

    /**
     * Test 4: DTO setter (via Lombok @Setter on entity) updates mode in place.
     *
     * Covers the DiscoveryRunService.updateRun(..., mode) code path which
     * calls entity.setMode(...) without rebuilding the entity.
     */
    @Test
    @DisplayName("Test 4: DiscoveryRunEntity.setMode updates the mode field")
    void entitySetMode_updatesFieldInPlace() {
        // Given: an entity created without a tier
        DiscoveryRunEntity entity = DiscoveryRunEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .status("RUNNING")
            .configSnapshot(new HashMap<>())
            .stepsPayload(new HashMap<>())
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        assertNull(entity.getMode(), "Pre-condition: mode starts null");

        // When: the V3 pipeline computes tier and writes it back
        entity.setMode("C");

        // Then: the setter records the new value
        assertEquals("C", entity.getMode(),
            "setMode must mutate the field so DiscoveryRunService.updateRun can persist the tier");
    }

    /**
     * Test 5: JSON serialization uses the snake-case "mode" property name.
     *
     * Verifies the DTO round-trips through Jackson so the TypeScript
     * discovery-service client sees a stable `mode` field (matching the
     * @JsonProperty("mode") annotation).
     */
    @Test
    @DisplayName("Test 5: DiscoveryRunDto.mode serializes as JSON property 'mode'")
    void dtoJsonSerialization_includesModeProperty() throws Exception {
        // Given: a DTO with tier A
        ObjectMapper mapper = new ObjectMapper();
        String timestamp = Instant.now().toString();
        DiscoveryRunDto dto = new DiscoveryRunDto(
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),  // architectureId (Spec: Discovery Run Robustness Section 3)
            null,
            "A",
            "A",
            null,
            false,
            null,       // discoveryKind
            null,       // degraded (Oracle Integrity & Determinism)
            null,       // degraded_reasons
            "COMPLETED",
            null,
            Map.of(),
            Map.of(),
            null,
            timestamp,
            timestamp
        );

        // When: serializing
        String json = mapper.writeValueAsString(dto);

        // Then: the `mode` property is present with the tier value
        assertTrue(json.contains("\"mode\":\"A\""),
            "Serialized JSON must expose mode field. Got: " + json);

        // And: deserializing back preserves mode
        DiscoveryRunDto roundTrip = mapper.readValue(json, DiscoveryRunDto.class);
        assertEquals("A", roundTrip.mode(), "mode should survive JSON round-trip");
    }
}
