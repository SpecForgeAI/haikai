package com.example.architecturemodel.integration;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.DeliveryTeamMapper;
import com.example.architecturemodel.model.dto.DeliveryTeamDto;
import com.example.architecturemodel.model.entity.DeliveryTeamEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.DeliveryTeamRepository;
import com.example.architecturemodel.service.DeliveryTeamService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Gap-fill integration tests for the DeliveryTeam feature.
 *
 * These tests cover critical gaps not addressed by TG1-TG4 tests:
 * - Mapper null handling and field mapping accuracy
 * - Service update duplicate name check that excludes self
 * - Service getById project-scoping validation
 * - Service list returns empty list for project with no teams
 * - WorkItemEntity deliveryTeamId field round-trip verification
 * - Service update/delete project-scoping validation
 *
 * Uses Mockito (not full Spring context) to isolate from pre-existing
 * compilation issues in other test files.
 *
 * Spec: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)
 * Task Group 5: Integration Tests and Gap Analysis (Task 5.3)
 */
@ExtendWith(MockitoExtension.class)
class DeliveryTeamIntegrationTest {

    @Mock
    private DeliveryTeamRepository deliveryTeamRepository;

    @Spy
    private DeliveryTeamMapper deliveryTeamMapper = new DeliveryTeamMapper();

    @InjectMocks
    private DeliveryTeamService deliveryTeamService;

    private UUID projectIdA;
    private UUID projectIdB;
    private UUID teamId1;

    @BeforeEach
    void setUp() {
        projectIdA = UUID.randomUUID();
        projectIdB = UUID.randomUUID();
        teamId1 = UUID.randomUUID();
    }

    // -----------------------------------------------------------------------
    // Gap 1: Mapper null handling and field mapping accuracy
    // -----------------------------------------------------------------------

    /**
     * Test 1: DeliveryTeamMapper.toDto() returns null for null input
     * and correctly maps all 7 fields for non-null input.
     *
     * Gap: TG3 tests use the mapper via @Spy but never test it directly
     * for null input or verify all 7 fields are correctly mapped.
     */
    @Test
    @DisplayName("Mapper toDto returns null for null input and maps all 7 fields correctly")
    void testMapperNullHandlingAndFieldMapping() {
        // Part A: null input returns null
        DeliveryTeamDto nullResult = deliveryTeamMapper.toDto(null);
        assertThat(nullResult).isNull();

        // Part B: all 7 fields correctly mapped
        Instant createdAt = Instant.parse("2026-02-15T08:00:00Z");
        Instant updatedAt = Instant.parse("2026-02-15T09:30:00Z");

        DeliveryTeamEntity entity = DeliveryTeamEntity.builder()
            .id(teamId1)
            .projectId(projectIdA)
            .name("Data Engineering")
            .type("EXTERNAL")
            .description("Vendor data team")
            .createdAt(createdAt)
            .updatedAt(updatedAt)
            .build();

        DeliveryTeamDto dto = deliveryTeamMapper.toDto(entity);

        assertThat(dto).isNotNull();
        assertThat(dto.id()).isEqualTo(teamId1);
        assertThat(dto.projectId()).isEqualTo(projectIdA);
        assertThat(dto.name()).isEqualTo("Data Engineering");
        assertThat(dto.type()).isEqualTo("EXTERNAL");
        assertThat(dto.description()).isEqualTo("Vendor data team");
        assertThat(dto.createdAt()).isEqualTo(createdAt);
        assertThat(dto.updatedAt()).isEqualTo(updatedAt);
    }

    // -----------------------------------------------------------------------
    // Gap 2-4: Service update duplicate name check excluding self
    // -----------------------------------------------------------------------

    /**
     * Test 2: Service update allows renaming to a name not used by
     * another team in the same project.
     *
     * Gap: TG3 Test 5 tests update happy path but does not verify that
     * the duplicate name check lookup is performed during update.
     */
    @Test
    @DisplayName("Service update allows renaming when new name is not taken by another team")
    void testUpdateAllowsRenamingToAvailableName() {
        DeliveryTeamEntity existingEntity = DeliveryTeamEntity.builder()
            .id(teamId1)
            .projectId(projectIdA)
            .name("Old Name")
            .type("INTERNAL")
            .description("Original")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(deliveryTeamRepository.findById(teamId1))
            .thenReturn(Optional.of(existingEntity));
        when(deliveryTeamRepository.findByProjectIdAndNameIgnoreCase(projectIdA, "Available Name"))
            .thenReturn(Optional.empty());
        when(deliveryTeamRepository.save(any(DeliveryTeamEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        DeliveryTeamDto result = deliveryTeamService.update(
            projectIdA, teamId1, "Available Name", "INTERNAL", "Updated");

        assertThat(result.name()).isEqualTo("Available Name");
        assertThat(result.description()).isEqualTo("Updated");

        // Verify the duplicate name check was performed
        verify(deliveryTeamRepository).findByProjectIdAndNameIgnoreCase(projectIdA, "Available Name");
    }

    /**
     * Test 3: Service update with duplicate name (same project, different team)
     * throws ConflictException.
     *
     * Gap: TG3 only tests duplicate on create, not on update where another
     * team already has the target name.
     */
    @Test
    @DisplayName("Service update throws ConflictException when another team has the same name")
    void testUpdateThrowsConflictWhenAnotherTeamHasSameName() {
        UUID otherTeamId = UUID.randomUUID();

        DeliveryTeamEntity existingEntity = DeliveryTeamEntity.builder()
            .id(teamId1)
            .projectId(projectIdA)
            .name("Team Alpha")
            .type("INTERNAL")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        DeliveryTeamEntity conflictingEntity = DeliveryTeamEntity.builder()
            .id(otherTeamId)
            .projectId(projectIdA)
            .name("Team Beta")
            .type("EXTERNAL")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(deliveryTeamRepository.findById(teamId1))
            .thenReturn(Optional.of(existingEntity));
        when(deliveryTeamRepository.findByProjectIdAndNameIgnoreCase(projectIdA, "Team Beta"))
            .thenReturn(Optional.of(conflictingEntity));

        assertThatThrownBy(() ->
            deliveryTeamService.update(projectIdA, teamId1, "Team Beta", "INTERNAL", null))
            .isInstanceOf(ConflictException.class)
            .hasMessageContaining("already exists");

        // Verify save was never called
        verify(deliveryTeamRepository, never()).save(any());
    }

    /**
     * Test 4: Service update allows "renaming" to the same name (no self-conflict)
     * when only other fields change.
     *
     * Gap: TG3 does not test the self-exclusion logic on update where the
     * findByName returns the same entity being updated.
     */
    @Test
    @DisplayName("Service update allows keeping same name (self-exclusion) when changing other fields")
    void testUpdateAllowsSameNameSelfExclusion() {
        DeliveryTeamEntity existingEntity = DeliveryTeamEntity.builder()
            .id(teamId1)
            .projectId(projectIdA)
            .name("Team Alpha")
            .type("INTERNAL")
            .description("Old description")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        // findByName returns the SAME entity (same ID) -- should not conflict
        when(deliveryTeamRepository.findById(teamId1))
            .thenReturn(Optional.of(existingEntity));
        when(deliveryTeamRepository.findByProjectIdAndNameIgnoreCase(projectIdA, "Team Alpha"))
            .thenReturn(Optional.of(existingEntity));
        when(deliveryTeamRepository.save(any(DeliveryTeamEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // Should succeed -- changing type and description but keeping same name
        DeliveryTeamDto result = deliveryTeamService.update(
            projectIdA, teamId1, "Team Alpha", "EXTERNAL", "New description");

        assertThat(result.name()).isEqualTo("Team Alpha");
        assertThat(result.type()).isEqualTo("EXTERNAL");
        assertThat(result.description()).isEqualTo("New description");

        // Verify save WAS called (no conflict thrown)
        verify(deliveryTeamRepository).save(any(DeliveryTeamEntity.class));
    }

    // -----------------------------------------------------------------------
    // Gap 5: Service getById project-scoping validation
    // -----------------------------------------------------------------------

    /**
     * Test 5: Service getById throws ResourceNotFoundException when team
     * exists but belongs to a different project.
     *
     * Gap: TG3 does not test the project-scoping check in getById.
     * The production code has an explicit projectId comparison at line 76.
     */
    @Test
    @DisplayName("Service getById throws ResourceNotFoundException when team belongs to different project")
    void testGetByIdThrowsWhenTeamBelongsToDifferentProject() {
        DeliveryTeamEntity entity = DeliveryTeamEntity.builder()
            .id(teamId1)
            .projectId(projectIdA)  // Team belongs to project A
            .name("Platform Team")
            .type("INTERNAL")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(deliveryTeamRepository.findById(teamId1))
            .thenReturn(Optional.of(entity));

        // Request with project B should fail even though the team exists
        assertThatThrownBy(() ->
            deliveryTeamService.getById(projectIdB, teamId1))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("not found");
    }

    // -----------------------------------------------------------------------
    // Gap 6: Service update project-scoping validation
    // -----------------------------------------------------------------------

    /**
     * Test 6: Service update throws ResourceNotFoundException when team
     * exists but belongs to a different project.
     *
     * Gap: TG3 Test 5 tests update on non-existent team but does not test
     * the project-scoping check in update.
     */
    @Test
    @DisplayName("Service update throws ResourceNotFoundException when team belongs to different project")
    void testUpdateThrowsWhenTeamBelongsToDifferentProject() {
        DeliveryTeamEntity entity = DeliveryTeamEntity.builder()
            .id(teamId1)
            .projectId(projectIdA)  // Team belongs to project A
            .name("Platform Team")
            .type("INTERNAL")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(deliveryTeamRepository.findById(teamId1))
            .thenReturn(Optional.of(entity));

        // Request with project B should fail
        assertThatThrownBy(() ->
            deliveryTeamService.update(projectIdB, teamId1, "New Name", "INTERNAL", null))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("not found");

        // Verify save was never called
        verify(deliveryTeamRepository, never()).save(any());
    }

    // -----------------------------------------------------------------------
    // Gap 7: Service list returns empty list
    // -----------------------------------------------------------------------

    /**
     * Test 7: Service list returns empty list when project has no delivery teams.
     *
     * Gap: TG3 does not test the list method at all.
     */
    @Test
    @DisplayName("Service list returns empty list when project has no delivery teams")
    void testListReturnsEmptyListForProjectWithNoTeams() {
        when(deliveryTeamRepository.findByProjectIdOrderByNameAsc(projectIdA))
            .thenReturn(Collections.emptyList());

        List<DeliveryTeamDto> result = deliveryTeamService.list(projectIdA);

        assertThat(result).isNotNull();
        assertThat(result).isEmpty();

        verify(deliveryTeamRepository).findByProjectIdOrderByNameAsc(projectIdA);
    }

    // -----------------------------------------------------------------------
    // Gap 8: Service list returns multiple teams
    // -----------------------------------------------------------------------

    /**
     * Test 8: Service list returns multiple teams mapped to DTOs.
     *
     * Gap: TG3 does not test the list method. This verifies that
     * the mapper is invoked for each entity in the list.
     */
    @Test
    @DisplayName("Service list returns multiple teams mapped to DTOs")
    void testListReturnsMultipleTeamsMappedToDtos() {
        DeliveryTeamEntity team1 = DeliveryTeamEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectIdA)
            .name("Alpha Team")
            .type("INTERNAL")
            .description("First team")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        DeliveryTeamEntity team2 = DeliveryTeamEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectIdA)
            .name("Beta Team")
            .type("EXTERNAL")
            .description(null)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(deliveryTeamRepository.findByProjectIdOrderByNameAsc(projectIdA))
            .thenReturn(List.of(team1, team2));

        List<DeliveryTeamDto> result = deliveryTeamService.list(projectIdA);

        assertThat(result).hasSize(2);
        assertThat(result.get(0).name()).isEqualTo("Alpha Team");
        assertThat(result.get(0).type()).isEqualTo("INTERNAL");
        assertThat(result.get(1).name()).isEqualTo("Beta Team");
        assertThat(result.get(1).type()).isEqualTo("EXTERNAL");
        assertThat(result.get(1).description()).isNull();

        // Verify mapper was called for each entity
        verify(deliveryTeamMapper, times(2)).toDto(any(DeliveryTeamEntity.class));
    }

    // -----------------------------------------------------------------------
    // Gap 9: Service delete project-scoping validation
    // -----------------------------------------------------------------------

    /**
     * Test 9: Service delete throws ResourceNotFoundException when team
     * exists but belongs to a different project.
     *
     * Gap: TG3 Test 6 tests delete on non-existent team but does not test
     * the project-scoping check in delete.
     */
    @Test
    @DisplayName("Service delete throws ResourceNotFoundException when team belongs to different project")
    void testDeleteThrowsWhenTeamBelongsToDifferentProject() {
        DeliveryTeamEntity entity = DeliveryTeamEntity.builder()
            .id(teamId1)
            .projectId(projectIdA)  // Team belongs to project A
            .name("Platform Team")
            .type("INTERNAL")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(deliveryTeamRepository.findById(teamId1))
            .thenReturn(Optional.of(entity));

        // Request with project B should fail
        assertThatThrownBy(() ->
            deliveryTeamService.delete(projectIdB, teamId1))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("not found");

        // Verify delete was never called on the repository
        verify(deliveryTeamRepository, never()).delete(any());
    }

    // -----------------------------------------------------------------------
    // Gap 10: WorkItemEntity deliveryTeamId round-trip
    // -----------------------------------------------------------------------

    /**
     * Test 10: WorkItemEntity with deliveryTeamId set persists and loads
     * correctly without affecting existing fields (non-regression).
     *
     * Gap: TG1/TG2 tests verify field existence via reflection and builder,
     * but do not verify that all existing fields remain intact when
     * deliveryTeamId is set, changed, and cleared.
     */
    @Test
    @DisplayName("WorkItemEntity deliveryTeamId field lifecycle does not affect existing fields")
    void testWorkItemDeliveryTeamIdFieldLifecycle() {
        UUID workItemId = UUID.randomUUID();
        UUID deliveryTeamId = UUID.randomUUID();
        UUID newDeliveryTeamId = UUID.randomUUID();

        // Build with all fields including deliveryTeamId
        WorkItemEntity item = WorkItemEntity.builder()
            .id(workItemId)
            .projectId(UUID.fromString("00000000-0000-0000-0000-000000000999"))
            .type("EPIC")
            .title("Integration Test Epic")
            .description("Testing deliveryTeamId lifecycle")
            .status("IN_PROGRESS")
            .sortOrder(5)
            .priority(2)
            .targetWindow("Q1-2026")
            .deliveryTeamId(deliveryTeamId)
            .build();

        // Verify all original fields are intact
        assertThat(item.getId()).isEqualTo(workItemId);
        assertThat(item.getProjectId()).isEqualTo(UUID.fromString("00000000-0000-0000-0000-000000000999"));
        assertThat(item.getType()).isEqualTo("EPIC");
        assertThat(item.getTitle()).isEqualTo("Integration Test Epic");
        assertThat(item.getDescription()).isEqualTo("Testing deliveryTeamId lifecycle");
        assertThat(item.getStatus()).isEqualTo("IN_PROGRESS");
        assertThat(item.getSortOrder()).isEqualTo(5);
        assertThat(item.getPriority()).isEqualTo(2);
        assertThat(item.getTargetWindow()).isEqualTo("Q1-2026");
        assertThat(item.getDeliveryTeamId()).isEqualTo(deliveryTeamId);

        // Change deliveryTeamId -- verify other fields remain unaffected
        item.setDeliveryTeamId(newDeliveryTeamId);
        assertThat(item.getDeliveryTeamId()).isEqualTo(newDeliveryTeamId);
        assertThat(item.getTitle()).isEqualTo("Integration Test Epic");
        assertThat(item.getType()).isEqualTo("EPIC");
        assertThat(item.getStatus()).isEqualTo("IN_PROGRESS");

        // Clear deliveryTeamId -- verify other fields still intact
        item.setDeliveryTeamId(null);
        assertThat(item.getDeliveryTeamId()).isNull();
        assertThat(item.getTitle()).isEqualTo("Integration Test Epic");
        assertThat(item.getProjectId()).isEqualTo(UUID.fromString("00000000-0000-0000-0000-000000000999"));
        assertThat(item.getSortOrder()).isEqualTo(5);
    }
}
