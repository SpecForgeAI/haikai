package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryDecisionTaskDto;
import com.example.architecturemodel.model.entity.DiscoveryDecisionTaskEntity;
import com.example.architecturemodel.repository.entity.DiscoveryDecisionTaskRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

/**
 * Service-level tests for DiscoveryDecisionTaskService.
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * Task Group 5: Liquibase Migration and JPA Entity Stack
 *
 * Tests:
 * 1. bulkCreate persists tasks and returns DTOs with correct fields
 * 2. getByRunId returns tasks, and getByRunIdAndStatus filters correctly
 * 3. updateTask transitions status and sets outputData/resolvedAt
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryDecisionTaskServiceTest {

    @Mock
    private DiscoveryDecisionTaskRepository decisionTaskRepository;

    @Mock
    private DiscoveryRunArchitectureGuard runGuard;

    private DiscoveryDecisionTaskService service;

    private static final UUID RUN_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new DiscoveryDecisionTaskService(decisionTaskRepository, runGuard);
    }

    /**
     * Test 1: bulkCreate persists tasks and returns DTOs with correct fields.
     */
    @Test
    @DisplayName("Test 1: bulkCreate persists decision tasks and returns DTOs with correct fields")
    void bulkCreate_persistsTasksAndReturnsDtosWithCorrectFields() {
        // Given
        UUID taskId1 = UUID.randomUUID();
        UUID taskId2 = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryDecisionTaskDto dto1 = new DiscoveryDecisionTaskDto(
            taskId1, RUN_ID, "confirm_relationship", "pending",
            Map.of("sourceAtom", Map.of("type", "symbol"), "targetAtom", Map.of("type", "string_pattern")),
            null, now.toString(), null
        );

        DiscoveryDecisionTaskDto dto2 = new DiscoveryDecisionTaskDto(
            taskId2, RUN_ID, "resolve_competing_relationships", "pending",
            Map.of("sourceAtom", Map.of("type", "symbol"), "competitors", List.of()),
            null, now.toString(), null
        );

        when(decisionTaskRepository.saveAll(anyList()))
            .thenAnswer(invocation -> {
                List<DiscoveryDecisionTaskEntity> entities = invocation.getArgument(0);
                return entities;
            });

        // When
        List<DiscoveryDecisionTaskDto> result = service.bulkCreate(RUN_ID, List.of(dto1, dto2));

        // Then
        assertThat(result).hasSize(2);

        DiscoveryDecisionTaskDto first = result.get(0);
        assertThat(first.id()).isEqualTo(taskId1);
        assertThat(first.runId()).isEqualTo(RUN_ID);
        assertThat(first.taskType()).isEqualTo("confirm_relationship");
        assertThat(first.status()).isEqualTo("pending");
        assertThat(first.inputData()).containsKey("sourceAtom");
        assertThat(first.outputData()).isNull();
        assertThat(first.createdAt()).isNotNull();
        assertThat(first.resolvedAt()).isNull();

        DiscoveryDecisionTaskDto second = result.get(1);
        assertThat(second.id()).isEqualTo(taskId2);
        assertThat(second.taskType()).isEqualTo("resolve_competing_relationships");

        verify(decisionTaskRepository).saveAll(anyList());
    }

    /**
     * Test 2: getByRunId returns tasks, and getByRunIdAndStatus filters correctly.
     */
    @Test
    @DisplayName("Test 2: getByRunId returns all tasks and getByRunIdAndStatus filters by status")
    void getByRunId_returnsAllTasks_andStatusFilterDelegatesToCorrectMethod() {
        // Given - all tasks
        DiscoveryDecisionTaskEntity pendingEntity = buildTaskEntity("confirm_relationship", "pending");
        DiscoveryDecisionTaskEntity resolvedEntity = buildTaskEntity("confirm_relationship", "resolved");

        when(decisionTaskRepository.findByRunId(RUN_ID))
            .thenReturn(List.of(pendingEntity, resolvedEntity));

        // When - no filter
        List<DiscoveryDecisionTaskDto> allResult = service.getByRunId(RUN_ID, null, null);

        // Then
        assertThat(allResult).hasSize(2);
        verify(decisionTaskRepository).findByRunId(RUN_ID);

        // Given - status filter
        when(decisionTaskRepository.findByRunIdAndStatus(RUN_ID, "pending"))
            .thenReturn(List.of(pendingEntity));

        // When - status filter
        List<DiscoveryDecisionTaskDto> filteredResult = service.getByRunId(RUN_ID, "pending", null);

        // Then
        assertThat(filteredResult).hasSize(1);
        assertThat(filteredResult.get(0).status()).isEqualTo("pending");
        verify(decisionTaskRepository).findByRunIdAndStatus(RUN_ID, "pending");
    }

    /**
     * Test 3: updateTask transitions status and sets outputData/resolvedAt.
     */
    @Test
    @DisplayName("Test 3: updateTask transitions status and sets outputData and resolvedAt")
    void updateTask_transitionsStatusAndSetsOutputDataAndResolvedAt() {
        // Given
        UUID taskId = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryDecisionTaskEntity existingEntity = DiscoveryDecisionTaskEntity.builder()
            .id(taskId)
            .runId(RUN_ID)
            .taskType("confirm_relationship")
            .status("pending")
            .inputData(Map.of("sourceAtom", Map.of("type", "symbol")))
            .outputData(null)
            .createdAt(now)
            .resolvedAt(null)
            .build();

        when(decisionTaskRepository.findById(taskId))
            .thenReturn(Optional.of(existingEntity));
        when(decisionTaskRepository.save(any(DiscoveryDecisionTaskEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        Instant resolvedAt = Instant.now();
        DiscoveryDecisionTaskDto updateDto = new DiscoveryDecisionTaskDto(
            null, null, null, "resolved",
            null,
            Map.of("decision", "confirm", "adjustedConfidence", 0.85, "reasoning", "Strong match"),
            null, resolvedAt.toString()
        );

        // When
        DiscoveryDecisionTaskDto result = service.updateTask(RUN_ID, taskId, updateDto);

        // Then
        assertThat(result.id()).isEqualTo(taskId);
        assertThat(result.status()).isEqualTo("resolved");
        assertThat(result.outputData()).containsKey("decision");
        assertThat(result.outputData().get("decision")).isEqualTo("confirm");
        assertThat(result.outputData()).containsKey("reasoning");
        assertThat(result.resolvedAt()).isNotNull();
        // inputData should remain unchanged
        assertThat(result.inputData()).containsKey("sourceAtom");

        verify(decisionTaskRepository).findById(taskId);
        verify(decisionTaskRepository).save(any(DiscoveryDecisionTaskEntity.class));
    }

    /**
     * Helper to build a decision task entity for testing.
     */
    private DiscoveryDecisionTaskEntity buildTaskEntity(String taskType, String status) {
        return DiscoveryDecisionTaskEntity.builder()
            .id(UUID.randomUUID())
            .runId(RUN_ID)
            .taskType(taskType)
            .status(status)
            .inputData(Map.of("sourceAtom", Map.of("type", "symbol")))
            .outputData(null)
            .createdAt(Instant.now())
            .resolvedAt(null)
            .build();
    }
}
