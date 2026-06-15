package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Repository tests for new WorkItemRepository extension methods.
 *
 * Tests countByProjectIdAndTypeIn and deleteByProjectIdAndTypeIn methods
 * needed for roadmap import functionality.
 */
@DataJpaTest
@ActiveProfiles("test")
class WorkItemRepositoryExtensionTest {

    @Autowired
    private WorkItemRepository workItemRepository;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID OTHER_PROJECT_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        workItemRepository.deleteAll();
    }

    /**
     * Test countByProjectIdAndTypeIn returns correct count for FEATURE/STORY types.
     */
    @Test
    void countByProjectIdAndTypeIn_returnsCorrectCount() {
        // Setup: Create various work items
        createWorkItem(PROJECT_ID, "INITIATIVE", null);
        createWorkItem(PROJECT_ID, "EPIC", null);
        createWorkItem(PROJECT_ID, "FEATURE", null);
        createWorkItem(PROJECT_ID, "FEATURE", null);
        createWorkItem(PROJECT_ID, "STORY", null);

        // Execute
        long count = workItemRepository.countByProjectIdAndTypeIn(
                PROJECT_ID, List.of("FEATURE", "STORY"));

        // Verify: Should count 2 FEATUREs + 1 STORY = 3
        assertThat(count).isEqualTo(3);
    }

    /**
     * Test countByProjectIdAndTypeIn returns 0 when no matching types exist.
     */
    @Test
    void countByProjectIdAndTypeIn_returnsZeroWhenNoMatchingTypes() {
        // Setup: Create only INITIATIVE and EPIC (no FEATURE or STORY)
        createWorkItem(PROJECT_ID, "INITIATIVE", null);
        createWorkItem(PROJECT_ID, "EPIC", null);

        // Execute
        long count = workItemRepository.countByProjectIdAndTypeIn(
                PROJECT_ID, List.of("FEATURE", "STORY"));

        // Verify: Should return 0
        assertThat(count).isZero();
    }

    /**
     * Test deleteByProjectIdAndTypeIn removes only specified types.
     */
    @Test
    void deleteByProjectIdAndTypeIn_removesOnlySpecifiedTypes() {
        // Setup: Create various work items
        UUID initiativeId = createWorkItem(PROJECT_ID, "INITIATIVE", null);
        createWorkItem(PROJECT_ID, "EPIC", null);
        createWorkItem(PROJECT_ID, "FEATURE", null);
        createWorkItem(PROJECT_ID, "STORY", null);

        // Execute: Delete only INITIATIVE and EPIC
        workItemRepository.deleteByProjectIdAndTypeIn(
                PROJECT_ID, List.of("INITIATIVE", "EPIC"));

        // Verify: Only FEATURE and STORY should remain
        List<WorkItemEntity> remaining = workItemRepository.findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(PROJECT_ID);
        assertThat(remaining).hasSize(2);
        assertThat(remaining).allMatch(item ->
                item.getType().equals("FEATURE") || item.getType().equals("STORY"));
    }

    /**
     * Test deleteByProjectIdAndTypeIn leaves unspecified types intact.
     */
    @Test
    void deleteByProjectIdAndTypeIn_leavesOtherProjectsIntact() {
        // Setup: Create work items in two projects
        createWorkItem(PROJECT_ID, "INITIATIVE", null);
        createWorkItem(PROJECT_ID, "EPIC", null);
        UUID otherInitiativeId = createWorkItem(OTHER_PROJECT_ID, "INITIATIVE", null);
        UUID otherEpicId = createWorkItem(OTHER_PROJECT_ID, "EPIC", null);

        // Execute: Delete INITIATIVE and EPIC only from PROJECT_ID
        workItemRepository.deleteByProjectIdAndTypeIn(
                PROJECT_ID, List.of("INITIATIVE", "EPIC"));

        // Verify: PROJECT_ID should be empty
        List<WorkItemEntity> projectItems = workItemRepository.findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(PROJECT_ID);
        assertThat(projectItems).isEmpty();

        // Verify: OTHER_PROJECT_ID should still have its items
        List<WorkItemEntity> otherProjectItems = workItemRepository.findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(OTHER_PROJECT_ID);
        assertThat(otherProjectItems).hasSize(2);
    }

    /**
     * Helper method to create a work item.
     */
    private UUID createWorkItem(UUID projectId, String type, UUID parentId) {
        WorkItemEntity entity = WorkItemEntity.builder()
                .id(UUID.randomUUID())
                .projectId(projectId)
                .type(type)
                .parentId(parentId)
                .title("Test " + type)
                .status("PLANNED")
                .sortOrder(0)
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();
        return workItemRepository.save(entity).getId();
    }
}
