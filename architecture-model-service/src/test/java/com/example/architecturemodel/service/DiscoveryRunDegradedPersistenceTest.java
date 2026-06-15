package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryRunDto;
import com.example.architecturemodel.model.entity.DiscoveryConfigEntity;
import com.example.architecturemodel.model.entity.DiscoveryRunEntity;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import com.example.architecturemodel.repository.entity.DiscoveryClusterRepository;
import com.example.architecturemodel.repository.entity.DiscoveryConfigRepository;
import com.example.architecturemodel.repository.entity.DiscoveryDecisionTaskRepository;
import com.example.architecturemodel.repository.entity.DiscoveryEvidenceRepository;
import com.example.architecturemodel.repository.entity.DiscoveryRelationshipRepository;
import com.example.architecturemodel.repository.entity.DiscoveryRunRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Collections;
import java.util.HashMap;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Focused tests for the advisory {@code degraded} / {@code degraded_reasons}
 * run-integrity signal added to discovery_run persistence.
 *
 * Spec: Oracle Integrity & Determinism (2026-05-30) -- Task Group 1
 * (AMS persistence: DTO + entity + service + controller + Liquibase 169).
 *
 * Verifies ONLY (per the task's 2-8 focused-test budget):
 *   - The DTO serializes {@code degraded} and {@code degraded_reasons} under the
 *     correct snake_case wire names (mirroring the {@code warnings} precedent).
 *   - The field round-trips through the entity (entity -> DTO and through the
 *     {@code updateRun} persistence path via an ArgumentCaptor).
 *   - A run with the field absent/null stays valid (back-compat, no backfill).
 *   - The PATCH/update NON-CLOBBER null-guard: a null incoming value does NOT
 *     wipe a previously-set flag (boxed Boolean -- see project memory
 *     primitive_double_dto_overwrite).
 *
 * The Liquibase migration (169-discovery-run-degraded.sql) is NOT loaded in the
 * test profile ({@code spring.liquibase.enabled=false}); schema is built from
 * the JPA entities via Hibernate ddl-auto. These tests verify the entity/DTO
 * plumbing and service contract that the changeset backs.
 *
 * Style modeled directly on {@link DiscoveryRunWarningsAndConfirmPersistenceTest}.
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryRunDegradedPersistenceTest {

    @Mock
    private DiscoveryRunRepository runRepository;

    @Mock
    private DiscoveryConfigRepository configRepository;

    @Mock
    private DiscoveryEvidenceRepository evidenceRepository;

    @Mock
    private DiscoveryCandidateRepository candidateRepository;

    @Mock
    private DiscoveryRelationshipRepository relationshipRepository;

    @Mock
    private DiscoveryClusterRepository clusterRepository;

    @Mock
    private DiscoveryDecisionTaskRepository decisionTaskRepository;

    private DiscoveryRunService runService;

    @BeforeEach
    void setUp() {
        runService = new DiscoveryRunService(
            runRepository,
            configRepository,
            evidenceRepository,
            candidateRepository,
            relationshipRepository,
            clusterRepository,
            decisionTaskRepository
        );
    }

    /**
     * Build a fully-populated DTO with the given degraded values, keeping all the
     * unrelated fields fixed. Centralises the 18-arg record shape so the field
     * order stays in one place if the record grows again.
     */
    private static DiscoveryRunDto dtoWith(Boolean degraded, String degradedReasons) {
        String ts = Instant.now().toString();
        return new DiscoveryRunDto(
            UUID.randomUUID(),   // id
            UUID.randomUUID(),   // projectId
            UUID.randomUUID(),   // architectureId
            "svc-1",             // serviceId
            "C",                 // mode
            "C",                 // tier
            "[\"Tier C warning\"]", // warnings
            false,               // confirmedLlmSolo
            "code",              // discoveryKind
            degraded,            // degraded (Oracle Integrity & Determinism)
            degradedReasons,     // degraded_reasons
            "COMPLETED",         // status -- degraded rides ALONGSIDE COMPLETED
            "1d",                // currentStep
            Collections.emptyMap(), // configSnapshot
            Collections.emptyMap(), // stepsPayload
            null,                // errorMessage
            ts,                  // createdAt
            ts                   // updatedAt
        );
    }

    // =========================================================================
    // Test 1: DTO serializes degraded / degraded_reasons under snake_case
    // =========================================================================

    /**
     * Test 1: a degraded run serializes {@code "degraded": true} and
     * {@code "degraded_reasons": "[...]"} under the snake_case wire names, and
     * the values round-trip back through JSON unchanged (passthrough, no parsing
     * -- mirroring the {@code warnings} precedent).
     */
    @Test
    @DisplayName("Test 1: DTO exposes degraded + degraded_reasons under snake_case and round-trips through JSON")
    void dtoSerializesDegradedFieldsUnderSnakeCase() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        String reasonsJson = "[\"scanner_failed\",\"files_failed\",\"method_cap_hit\"]";

        DiscoveryRunDto dto = dtoWith(Boolean.TRUE, reasonsJson);

        String json = mapper.writeValueAsString(dto);
        DiscoveryRunDto roundTrip = mapper.readValue(json, DiscoveryRunDto.class);

        // Snake_case wire names present (NOT camelCase "degradedReasons").
        assertTrue(json.contains("\"degraded\":true"),
            "Serialized JSON must expose the degraded flag. Got: " + json);
        assertTrue(json.contains("\"degraded_reasons\":"),
            "Serialized JSON must expose degraded_reasons in snake_case. Got: " + json);
        assertFalse(json.contains("degradedReasons"),
            "degraded_reasons must NOT serialize as camelCase. Got: " + json);

        // Values round-trip verbatim (passthrough, no server-side parsing).
        assertEquals(Boolean.TRUE, roundTrip.degraded(),
            "degraded must round-trip unchanged through JSON");
        assertEquals(reasonsJson, roundTrip.degradedReasons(),
            "degraded_reasons string must round-trip verbatim through JSON");

        // The flag rides ALONGSIDE COMPLETED -- the status is unchanged.
        assertEquals("COMPLETED", roundTrip.status(),
            "degraded must NOT replace or alter the run status");
    }

    // =========================================================================
    // Test 2: createRun -> a fresh run has null degraded (no backfill)
    // =========================================================================

    /**
     * Test 2: {@code degraded} is computed by the discovery-service pipeline at
     * the COMPLETED transition, NOT at create time. A freshly created run
     * therefore persists a null flag and null reasons, which is valid (the
     * columns are nullable with no backfill).
     */
    @Test
    @DisplayName("Test 2: createRun leaves degraded / degraded_reasons null (computed later, no backfill)")
    void createRun_leavesDegradedNullByDefault() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        DiscoveryConfigEntity config = new DiscoveryConfigEntity();
        config.setStatus("COMPLETE");
        config.setConfigPayload(new HashMap<>());

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), any()))
            .thenReturn(Collections.emptyList());
        when(configRepository.findByProjectId(projectId)).thenReturn(Optional.of(config));
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(invocation -> {
                DiscoveryRunEntity e = invocation.getArgument(0);
                if (e.getCreatedAt() == null) e.setCreatedAt(Instant.now());
                if (e.getUpdatedAt() == null) e.setUpdatedAt(Instant.now());
                return e;
            });

        DiscoveryRunDto dto = runService.createRun(projectId, architectureId);

        // The saved entity has no degraded signal yet.
        ArgumentCaptor<DiscoveryRunEntity> captor =
            ArgumentCaptor.forClass(DiscoveryRunEntity.class);
        org.mockito.Mockito.verify(runRepository).save(captor.capture());
        DiscoveryRunEntity saved = captor.getValue();

        assertNull(saved.getDegraded(), "degraded defaults to null on a fresh run");
        assertNull(saved.getDegradedReasons(), "degraded_reasons defaults to null on a fresh run");

        // And the DTO surfaces null (back-compat: absent/null stays valid).
        assertNull(dto.degraded());
        assertNull(dto.degradedReasons());
    }

    // =========================================================================
    // Test 3: updateRun persists degraded + reasons; entity round-trip on DTO
    // =========================================================================

    /**
     * Test 3: the widest {@code updateRun(..., degraded, degradedReasons)}
     * overload writes both fields onto the entity (the COMPLETED-transition
     * persistence path the discovery-service uses) and surfaces them on the
     * returned DTO -- the field round-trips through the entity.
     */
    @Test
    @DisplayName("Test 3: updateRun persists degraded + degraded_reasons onto the entity and surfaces on the DTO")
    void updateRun_persistsDegradedAndReasons() {
        UUID runId = UUID.randomUUID();
        DiscoveryRunEntity existing = DiscoveryRunEntity.builder()
            .id(runId)
            .projectId(UUID.randomUUID())
            .architectureId(UUID.randomUUID())
            .mode("C")
            .status("RUNNING")
            .configSnapshot(new HashMap<>())
            .stepsPayload(new HashMap<>())
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(runRepository.findById(runId)).thenReturn(Optional.of(existing));
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        String reasonsJson = "[\"scanner_failed\"]";

        // The discovery-service persists degraded alongside the COMPLETED write.
        DiscoveryRunDto dto = runService.updateRun(
            runId,
            "COMPLETED",   // run still COMPLETES -- degraded rides alongside it
            "1d",
            null,
            null,
            null,          // mode unchanged
            null,          // warnings unchanged
            Boolean.TRUE,  // degraded
            reasonsJson    // degraded_reasons
        );

        ArgumentCaptor<DiscoveryRunEntity> captor =
            ArgumentCaptor.forClass(DiscoveryRunEntity.class);
        org.mockito.Mockito.verify(runRepository).save(captor.capture());
        DiscoveryRunEntity saved = captor.getValue();

        assertEquals(Boolean.TRUE, saved.getDegraded(),
            "degraded flag must be written onto the entity");
        assertEquals(reasonsJson, saved.getDegradedReasons(),
            "degraded_reasons JSON must be written verbatim onto the entity");
        assertEquals("COMPLETED", saved.getStatus(),
            "status must transition to COMPLETED -- degraded does not block or replace it");

        // DTO surfaces the round-tripped values.
        assertEquals(Boolean.TRUE, dto.degraded());
        assertEquals(reasonsJson, dto.degradedReasons());
        assertEquals("COMPLETED", dto.status());
    }

    // =========================================================================
    // Test 4: NON-CLOBBER null-guard -- a null PATCH preserves an existing flag
    // =========================================================================

    /**
     * Test 4: a subsequent update that carries {@code degraded = null} (e.g. a
     * status-only PUT) must NOT wipe a previously-set degraded flag. This is the
     * boxed-Boolean non-clobber guard (project memory
     * primitive_double_dto_overwrite) and mirrors the {@code warnings} semantics.
     */
    @Test
    @DisplayName("Test 4: a null degraded on update does NOT clobber a previously-set flag")
    void updateRun_nullDegradedDoesNotClobberExistingFlag() {
        UUID runId = UUID.randomUUID();
        // The run was already marked degraded by an earlier write.
        DiscoveryRunEntity existing = DiscoveryRunEntity.builder()
            .id(runId)
            .projectId(UUID.randomUUID())
            .architectureId(UUID.randomUUID())
            .mode("C")
            .status("COMPLETED")
            .degraded(Boolean.TRUE)
            .degradedReasons("[\"scanner_failed\"]")
            .configSnapshot(new HashMap<>())
            .stepsPayload(new HashMap<>())
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(runRepository.findById(runId)).thenReturn(Optional.of(existing));
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // A later update touches only currentStep; degraded + reasons are null.
        DiscoveryRunDto dto = runService.updateRun(
            runId,
            null,          // status unchanged
            "1d",
            null,
            null,
            null,
            null,
            null,          // degraded == null -> leave unchanged
            null           // degraded_reasons == null -> leave unchanged
        );

        // The previously-set flag survives (NOT wiped to false / null).
        assertEquals(Boolean.TRUE, dto.degraded(),
            "a null incoming degraded must preserve the existing flag (non-clobber)");
        assertEquals("[\"scanner_failed\"]", dto.degradedReasons(),
            "a null incoming degraded_reasons must preserve the existing reasons (non-clobber)");
    }
}
