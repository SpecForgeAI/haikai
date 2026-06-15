package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.WorkItemDto;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for WorkItemService validation logic.
 *
 * Tests type hierarchy rules and validation constraints.
 */
@ExtendWith(MockitoExtension.class)
class WorkItemServiceTest {

    @Mock
    private WorkItemRepository workItemRepository;

    @InjectMocks
    private WorkItemService workItemService;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID OTHER_PROJECT_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");

    /**
     * Test that self-parent is rejected with 400.
     */
    @Test
    void updateWorkItem_selfParent_throws400() {
        UUID itemId = UUID.randomUUID();

        WorkItemEntity existingEntity = WorkItemEntity.builder()
            .id(itemId)
            .projectId(PROJECT_ID)
            .type("EPIC")
            .title("Existing Epic")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(workItemRepository.findById(itemId)).thenReturn(Optional.of(existingEntity));

        // Try to set parent_id = id
        WorkItemDto dto = new WorkItemDto(
            itemId,
            PROJECT_ID,
            "EPIC",
            itemId,  // Self-parent
            "Updated Epic",
            null, "PLANNED", 0, null, null, null, null, null, null, null, null
        );

        assertThatThrownBy(() -> workItemService.updateWorkItem(itemId, dto))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("cannot be its own parent");
    }

    /**
     * Test that cross-project parent is rejected with 400.
     */
    @Test
    void createWorkItem_crossProjectParent_throws400() {
        UUID parentId = UUID.randomUUID();

        WorkItemEntity parentEntity = WorkItemEntity.builder()
            .id(parentId)
            .projectId(OTHER_PROJECT_ID)  // Different project
            .type("INITIATIVE")
            .title("Parent Initiative")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(workItemRepository.findById(parentId)).thenReturn(Optional.of(parentEntity));

        WorkItemDto dto = new WorkItemDto(
            null,
            PROJECT_ID,  // Different from parent's project
            "EPIC",
            parentId,
            "Child Epic",
            null, "PLANNED", 0, null, null, null, null, null, null, null, null
        );

        assertThatThrownBy(() -> workItemService.createWorkItem(PROJECT_ID, dto))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("must be in the same project");
    }

    // Strict parent-type validation tests removed 2026-05-01.
    // WorkItemService now uses LOOSE hierarchy semantics: only existence and
    // same-project of the parent are enforced; parent-type relationships
    // (e.g. EPIC must have INITIATIVE parent) are no longer checked here.
    // Reason: Jira import + sync flows create work items in orders/parents
    // that don't always match a strict hierarchy, and enforcing it here
    // produced false-positive failures. The conventional hierarchy
    // INITIATIVE > EPIC > FEATURE > STORY > (TASK | BUG | TEST) is still
    // documented on WorkItemService -- it's just caller-enforced now.

    /**
     * Test that EPIC with INITIATIVE parent succeeds.
     */
    @Test
    void createWorkItem_epicWithInitiativeParent_succeeds() {
        UUID parentId = UUID.randomUUID();

        WorkItemEntity parentEntity = WorkItemEntity.builder()
            .id(parentId)
            .projectId(PROJECT_ID)
            .type("INITIATIVE")
            .title("Parent Initiative")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(workItemRepository.findById(parentId)).thenReturn(Optional.of(parentEntity));
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(invocation -> {
            WorkItemEntity entity = invocation.getArgument(0);
            if (entity.getId() == null) {
                entity.setId(UUID.randomUUID());
            }
            return entity;
        });

        WorkItemDto dto = new WorkItemDto(
            null,
            PROJECT_ID,
            "EPIC",
            parentId,
            "Child Epic",
            null, "PLANNED", 0, null, null, null, null, null, null, null, null
        );

        WorkItemDto result = workItemService.createWorkItem(PROJECT_ID, dto);

        assertThat(result).isNotNull();
        assertThat(result.type()).isEqualTo("EPIC");
        assertThat(result.parentId()).isEqualTo(parentId);
        verify(workItemRepository).save(any(WorkItemEntity.class));
    }

    /**
     * Test that invalid type is rejected.
     */
    @Test
    void createWorkItem_invalidType_throws400() {
        WorkItemDto dto = new WorkItemDto(
            null,
            PROJECT_ID,
            "INVALID_TYPE",
            null,
            "Test Item",
            null, "PLANNED", 0, null, null, null, null, null, null, null, null
        );

        assertThatThrownBy(() -> workItemService.createWorkItem(PROJECT_ID, dto))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid work item type");
    }

    /**
     * Test that invalid status is rejected.
     */
    @Test
    void createWorkItem_invalidStatus_throws400() {
        WorkItemDto dto = new WorkItemDto(
            null,
            PROJECT_ID,
            "INITIATIVE",
            null,
            "Test Initiative",
            null, "INVALID_STATUS", 0, null, null, null, null, null, null, null, null
        );

        assertThatThrownBy(() -> workItemService.createWorkItem(PROJECT_ID, dto))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid work item status");
    }

    // ============================================================================
    // Spec 2026-01-18: Fix Feature Edit 400 Error - Patch Semantics Tests
    // Task Group 1.1: Tests for update validation with null parentId
    // ============================================================================

    /**
     * Test: FEATURE with EPIC parent, update title with null parentId, should succeed (200).
     *
     * Spec 2026-01-18: This test verifies patch semantics - when parentId is null in the update DTO,
     * the existing parentId should be preserved and validation should pass.
     */
    @Test
    void updateWorkItem_featureWithEpicParent_nullParentIdInDto_succeeds() {
        UUID featureId = UUID.randomUUID();
        UUID epicParentId = UUID.randomUUID();

        // Existing FEATURE entity with EPIC parent
        WorkItemEntity existingFeature = WorkItemEntity.builder()
            .id(featureId)
            .projectId(PROJECT_ID)
            .type("FEATURE")
            .parentId(epicParentId)
            .title("Existing Feature")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        // Parent EPIC entity
        WorkItemEntity epicParent = WorkItemEntity.builder()
            .id(epicParentId)
            .projectId(PROJECT_ID)
            .type("EPIC")
            .title("Parent Epic")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(workItemRepository.findById(featureId)).thenReturn(Optional.of(existingFeature));
        when(workItemRepository.findById(epicParentId)).thenReturn(Optional.of(epicParent));
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // Update DTO with null parentId (simulating frontend edit that doesn't send parentId)
        WorkItemDto dto = new WorkItemDto(
            featureId,
            PROJECT_ID,
            "FEATURE",
            null,  // parentId is null - should use existing
            "Updated Feature Title",
            null, "PLANNED", 0, null, null, null, null, null, null, null, null
        );

        // Should NOT throw - patch semantics should preserve existing parentId
        WorkItemDto result = workItemService.updateWorkItem(featureId, dto);

        assertThat(result).isNotNull();
        assertThat(result.title()).isEqualTo("Updated Feature Title");
        verify(workItemRepository).save(any(WorkItemEntity.class));
    }

    /**
     * Test: FEATURE with EPIC parent, update title with null parentId, parentId preserved after update.
     *
     * Spec 2026-01-18: Verifies that the parentId is preserved in the entity after update.
     */
    @Test
    void updateWorkItem_featureWithEpicParent_nullParentIdInDto_preservesParentId() {
        UUID featureId = UUID.randomUUID();
        UUID epicParentId = UUID.randomUUID();

        // Existing FEATURE entity with EPIC parent
        WorkItemEntity existingFeature = WorkItemEntity.builder()
            .id(featureId)
            .projectId(PROJECT_ID)
            .type("FEATURE")
            .parentId(epicParentId)
            .title("Existing Feature")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        // Parent EPIC entity
        WorkItemEntity epicParent = WorkItemEntity.builder()
            .id(epicParentId)
            .projectId(PROJECT_ID)
            .type("EPIC")
            .title("Parent Epic")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(workItemRepository.findById(featureId)).thenReturn(Optional.of(existingFeature));
        when(workItemRepository.findById(epicParentId)).thenReturn(Optional.of(epicParent));
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // Update DTO with null parentId
        WorkItemDto dto = new WorkItemDto(
            featureId,
            PROJECT_ID,
            "FEATURE",
            null,  // parentId is null
            "Updated Feature Title",
            null, "PLANNED", 0, null, null, null, null, null, null, null, null
        );

        WorkItemDto result = workItemService.updateWorkItem(featureId, dto);

        // Verify parentId is preserved
        assertThat(result.parentId()).isEqualTo(epicParentId);
    }

    /**
     * Test: STORY with FEATURE parent, update description with null parentId, should succeed.
     *
     * Spec 2026-01-18: Tests patch semantics for STORY type as well.
     */
    @Test
    void updateWorkItem_storyWithFeatureParent_nullParentIdInDto_succeeds() {
        UUID storyId = UUID.randomUUID();
        UUID featureParentId = UUID.randomUUID();

        // Existing STORY entity with FEATURE parent
        WorkItemEntity existingStory = WorkItemEntity.builder()
            .id(storyId)
            .projectId(PROJECT_ID)
            .type("STORY")
            .parentId(featureParentId)
            .title("Existing Story")
            .description("Old description")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        // Parent FEATURE entity
        WorkItemEntity featureParent = WorkItemEntity.builder()
            .id(featureParentId)
            .projectId(PROJECT_ID)
            .type("FEATURE")
            .title("Parent Feature")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(workItemRepository.findById(storyId)).thenReturn(Optional.of(existingStory));
        when(workItemRepository.findById(featureParentId)).thenReturn(Optional.of(featureParent));
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // Update DTO with null parentId and new description
        WorkItemDto dto = new WorkItemDto(
            storyId,
            PROJECT_ID,
            "STORY",
            null,  // parentId is null - should use existing
            "Existing Story",
            "Updated description",
            "PLANNED", 0, null, null, null, null, null, null, null, null
        );

        WorkItemDto result = workItemService.updateWorkItem(storyId, dto);

        assertThat(result).isNotNull();
        assertThat(result.description()).isEqualTo("Updated description");
        assertThat(result.parentId()).isEqualTo(featureParentId);
    }

    /**
     * Test: Update with explicit parentId should still work (overwrite behavior).
     *
     * Spec 2026-01-18: When parentId is explicitly provided, it should be used (not preserved).
     */
    @Test
    void updateWorkItem_withExplicitParentId_overwritesParent() {
        UUID featureId = UUID.randomUUID();
        UUID oldEpicId = UUID.randomUUID();
        UUID newEpicId = UUID.randomUUID();

        // Existing FEATURE with old EPIC parent
        WorkItemEntity existingFeature = WorkItemEntity.builder()
            .id(featureId)
            .projectId(PROJECT_ID)
            .type("FEATURE")
            .parentId(oldEpicId)
            .title("Existing Feature")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        // New EPIC parent
        WorkItemEntity newEpicParent = WorkItemEntity.builder()
            .id(newEpicId)
            .projectId(PROJECT_ID)
            .type("EPIC")
            .title("New Epic")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(workItemRepository.findById(featureId)).thenReturn(Optional.of(existingFeature));
        when(workItemRepository.findById(newEpicId)).thenReturn(Optional.of(newEpicParent));
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // Update DTO with explicit new parentId
        WorkItemDto dto = new WorkItemDto(
            featureId,
            PROJECT_ID,
            "FEATURE",
            newEpicId,  // Explicit parentId - should overwrite
            "Updated Feature",
            null, "PLANNED", 0, null, null, null, null, null, null, null, null
        );

        WorkItemDto result = workItemService.updateWorkItem(featureId, dto);

        assertThat(result.parentId()).isEqualTo(newEpicId);
    }

    /**
     * Test: Update with null type should preserve existing type.
     *
     * Spec 2026-01-18: When type is null/blank in DTO, existing type should be preserved.
     */
    @Test
    void updateWorkItem_nullTypeInDto_preservesExistingType() {
        UUID featureId = UUID.randomUUID();
        UUID epicParentId = UUID.randomUUID();

        // Existing FEATURE entity
        WorkItemEntity existingFeature = WorkItemEntity.builder()
            .id(featureId)
            .projectId(PROJECT_ID)
            .type("FEATURE")
            .parentId(epicParentId)
            .title("Existing Feature")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        // Parent EPIC
        WorkItemEntity epicParent = WorkItemEntity.builder()
            .id(epicParentId)
            .projectId(PROJECT_ID)
            .type("EPIC")
            .title("Parent Epic")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(workItemRepository.findById(featureId)).thenReturn(Optional.of(existingFeature));
        when(workItemRepository.findById(epicParentId)).thenReturn(Optional.of(epicParent));
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // Update DTO with null type - should preserve existing "FEATURE" type
        WorkItemDto dto = new WorkItemDto(
            featureId,
            PROJECT_ID,
            null,  // type is null - should use existing
            epicParentId,
            "Updated Feature Title",
            null, "PLANNED", 0, null, null, null, null, null, null, null, null
        );

        WorkItemDto result = workItemService.updateWorkItem(featureId, dto);

        assertThat(result.type()).isEqualTo("FEATURE");
    }

    /**
     * Test: Update with blank type should preserve existing type.
     *
     * Spec 2026-01-18: When type is blank in DTO, existing type should be preserved.
     */
    @Test
    void updateWorkItem_blankTypeInDto_preservesExistingType() {
        UUID featureId = UUID.randomUUID();
        UUID epicParentId = UUID.randomUUID();

        // Existing FEATURE entity
        WorkItemEntity existingFeature = WorkItemEntity.builder()
            .id(featureId)
            .projectId(PROJECT_ID)
            .type("FEATURE")
            .parentId(epicParentId)
            .title("Existing Feature")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        // Parent EPIC
        WorkItemEntity epicParent = WorkItemEntity.builder()
            .id(epicParentId)
            .projectId(PROJECT_ID)
            .type("EPIC")
            .title("Parent Epic")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(workItemRepository.findById(featureId)).thenReturn(Optional.of(existingFeature));
        when(workItemRepository.findById(epicParentId)).thenReturn(Optional.of(epicParent));
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // Update DTO with blank type - should preserve existing "FEATURE" type
        WorkItemDto dto = new WorkItemDto(
            featureId,
            PROJECT_ID,
            "   ",  // type is blank - should use existing
            epicParentId,
            "Updated Feature Title",
            null, "PLANNED", 0, null, null, null, null, null, null, null, null
        );

        WorkItemDto result = workItemService.updateWorkItem(featureId, dto);

        assertThat(result.type()).isEqualTo("FEATURE");
    }
}
