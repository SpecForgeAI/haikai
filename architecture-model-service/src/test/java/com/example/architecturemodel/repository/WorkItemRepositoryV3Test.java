package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Repository tests for v3 roadmap import repository methods.
 *
 * Tests new query methods added for upsert and archive/delete logic:
 * - findByIdAndProjectId: scoped lookup for upsert
 * - findByProjectIdAndTypeIn: load existing scope
 * - countByProjectIdAndParentId: child existence checks
 */
@DataJpaTest
@ActiveProfiles("test")
class WorkItemRepositoryV3Test {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private WorkItemRepository workItemRepository;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID PROJECT_ID_1 = UUID.randomUUID();
    private static final UUID PROJECT_ID_2 = UUID.randomUUID();

    // ========================================================================
    // Test 1: findByIdAndProjectId returns entity when exists
    // ========================================================================

    /**
     * Test findByIdAndProjectId returns entity when it exists with matching project.
     */
    @Test
    void findByIdAndProjectId_returnsEntityWhenExists() {
        // Setup: Create and save an initiative
        UUID itemId = UUID.randomUUID();
        WorkItemEntity initiative = createWorkItem(itemId, PROJECT_ID, "INITIATIVE", "Test Initiative", null);
        workItemRepository.save(initiative);
        entityManager.flush();
        entityManager.clear();

        // Execute
        Optional<WorkItemEntity> result = workItemRepository.findByIdAndProjectId(itemId, PROJECT_ID);

        // Verify
        assertThat(result).isPresent();
        assertThat(result.get().getId()).isEqualTo(itemId);
        assertThat(result.get().getTitle()).isEqualTo("Test Initiative");
        assertThat(result.get().getProjectId()).isEqualTo(PROJECT_ID);
    }

    /**
     * Test findByIdAndProjectId returns empty when ID exists but project doesn't match.
     */
    @Test
    void findByIdAndProjectId_returnsEmptyWhenProjectMismatch() {
        // Setup: Create item in project-1
        UUID itemId = UUID.randomUUID();
        WorkItemEntity initiative = createWorkItem(itemId, PROJECT_ID_1, "INITIATIVE", "Test Initiative", null);
        workItemRepository.save(initiative);
        entityManager.flush();
        entityManager.clear();

        // Execute: Look for it in project-2
        Optional<WorkItemEntity> result = workItemRepository.findByIdAndProjectId(itemId, PROJECT_ID_2);

        // Verify: Should not find it
        assertThat(result).isEmpty();
    }

    /**
     * Test findByIdAndProjectId returns empty when ID doesn't exist.
     */
    @Test
    void findByIdAndProjectId_returnsEmptyWhenIdNotFound() {
        // Setup: Create an item
        WorkItemEntity initiative = createWorkItem(UUID.randomUUID(), PROJECT_ID, "INITIATIVE", "Test Initiative", null);
        workItemRepository.save(initiative);
        entityManager.flush();
        entityManager.clear();

        // Execute: Look for non-existent ID
        Optional<WorkItemEntity> result = workItemRepository.findByIdAndProjectId(UUID.randomUUID(), PROJECT_ID);

        // Verify
        assertThat(result).isEmpty();
    }

    // ========================================================================
    // Test 2: findByProjectIdAndTypeIn returns filtered list
    // ========================================================================

    /**
     * Test findByProjectIdAndTypeIn returns items matching any of the given types.
     */
    @Test
    void findByProjectIdAndTypeIn_returnsFilteredList() {
        // Setup: Create items of various types
        WorkItemEntity initiative1 = createWorkItem(UUID.randomUUID(), PROJECT_ID, "INITIATIVE", "Initiative 1", null);
        WorkItemEntity initiative2 = createWorkItem(UUID.randomUUID(), PROJECT_ID, "INITIATIVE", "Initiative 2", null);
        WorkItemEntity epic1 = createWorkItem(UUID.randomUUID(), PROJECT_ID, "EPIC", "Epic 1", null);
        WorkItemEntity feature = createWorkItem(UUID.randomUUID(), PROJECT_ID, "FEATURE", "Feature 1", null);
        WorkItemEntity story = createWorkItem(UUID.randomUUID(), PROJECT_ID, "STORY", "Story 1", null);

        workItemRepository.saveAll(List.of(initiative1, initiative2, epic1, feature, story));
        entityManager.flush();
        entityManager.clear();

        // Execute: Query for INITIATIVE and EPIC types only
        List<WorkItemEntity> results = workItemRepository.findByProjectIdAndTypeIn(
                PROJECT_ID, List.of("INITIATIVE", "EPIC"));

        // Verify: Should return only initiatives and epics
        assertThat(results).hasSize(3);
        assertThat(results).extracting(WorkItemEntity::getType)
                .containsOnly("INITIATIVE", "EPIC");
        assertThat(results).extracting(WorkItemEntity::getTitle)
                .containsExactlyInAnyOrder("Initiative 1", "Initiative 2", "Epic 1");
    }

    /**
     * Test findByProjectIdAndTypeIn returns empty list when no types match.
     */
    @Test
    void findByProjectIdAndTypeIn_returnsEmptyWhenNoMatch() {
        // Setup: Create only initiatives
        WorkItemEntity initiative = createWorkItem(UUID.randomUUID(), PROJECT_ID, "INITIATIVE", "Initiative 1", null);
        workItemRepository.save(initiative);
        entityManager.flush();
        entityManager.clear();

        // Execute: Query for FEATURE types only
        List<WorkItemEntity> results = workItemRepository.findByProjectIdAndTypeIn(
                PROJECT_ID, List.of("FEATURE", "STORY"));

        // Verify: Should return empty
        assertThat(results).isEmpty();
    }

    // ========================================================================
    // Test 3: countByProjectIdAndParentId returns correct child count
    // ========================================================================

    /**
     * Test countByProjectIdAndParentId returns correct child count.
     */
    @Test
    void countByProjectIdAndParentId_returnsCorrectChildCount() {
        // Setup: Create parent initiative
        UUID parentId = UUID.randomUUID();
        WorkItemEntity parent = createWorkItem(parentId, PROJECT_ID, "INITIATIVE", "Parent Initiative", null);
        workItemRepository.save(parent);

        // Create children (epics) under parent
        WorkItemEntity child1 = createWorkItem(UUID.randomUUID(), PROJECT_ID, "EPIC", "Epic 1", parentId);
        WorkItemEntity child2 = createWorkItem(UUID.randomUUID(), PROJECT_ID, "EPIC", "Epic 2", parentId);
        WorkItemEntity child3 = createWorkItem(UUID.randomUUID(), PROJECT_ID, "EPIC", "Epic 3", parentId);

        // Create unrelated item (no parent)
        WorkItemEntity orphan = createWorkItem(UUID.randomUUID(), PROJECT_ID, "INITIATIVE", "Orphan Initiative", null);

        workItemRepository.saveAll(List.of(child1, child2, child3, orphan));
        entityManager.flush();
        entityManager.clear();

        // Execute
        long childCount = workItemRepository.countByProjectIdAndParentId(PROJECT_ID, parentId);

        // Verify: Should count only direct children
        assertThat(childCount).isEqualTo(3);
    }

    /**
     * Test countByProjectIdAndParentId returns zero when no children exist.
     */
    @Test
    void countByProjectIdAndParentId_returnsZeroWhenNoChildren() {
        // Setup: Create parent initiative with no children
        UUID parentId = UUID.randomUUID();
        WorkItemEntity parent = createWorkItem(parentId, PROJECT_ID, "INITIATIVE", "Parent Initiative", null);
        workItemRepository.save(parent);
        entityManager.flush();
        entityManager.clear();

        // Execute
        long childCount = workItemRepository.countByProjectIdAndParentId(PROJECT_ID, parentId);

        // Verify
        assertThat(childCount).isEqualTo(0);
    }

    // ========================================================================
    // Test 4: Repository methods enforce projectId scoping
    // ========================================================================

    /**
     * Test repository methods enforce projectId scoping correctly.
     */
    @Test
    void repositoryMethods_enforceProjectIdScoping() {
        // Setup: Create items in two different projects
        UUID sharedId = UUID.randomUUID();
        UUID parentId1 = UUID.randomUUID();
        UUID parentId2 = UUID.randomUUID();

        // Project 1 items
        WorkItemEntity parent1 = createWorkItem(parentId1, PROJECT_ID_1, "INITIATIVE", "Parent 1", null);
        WorkItemEntity child1a = createWorkItem(UUID.randomUUID(), PROJECT_ID_1, "EPIC", "Child 1A", parentId1);
        WorkItemEntity child1b = createWorkItem(UUID.randomUUID(), PROJECT_ID_1, "EPIC", "Child 1B", parentId1);

        // Project 2 items
        WorkItemEntity parent2 = createWorkItem(parentId2, PROJECT_ID_2, "INITIATIVE", "Parent 2", null);
        WorkItemEntity child2a = createWorkItem(UUID.randomUUID(), PROJECT_ID_2, "EPIC", "Child 2A", parentId2);

        workItemRepository.saveAll(List.of(parent1, child1a, child1b, parent2, child2a));
        entityManager.flush();
        entityManager.clear();

        // Test findByProjectIdAndTypeIn scoping
        List<WorkItemEntity> project1Items = workItemRepository.findByProjectIdAndTypeIn(
                PROJECT_ID_1, List.of("INITIATIVE", "EPIC"));
        assertThat(project1Items).hasSize(3);
        assertThat(project1Items).allMatch(e -> PROJECT_ID_1.equals(e.getProjectId()));

        List<WorkItemEntity> project2Items = workItemRepository.findByProjectIdAndTypeIn(
                PROJECT_ID_2, List.of("INITIATIVE", "EPIC"));
        assertThat(project2Items).hasSize(2);
        assertThat(project2Items).allMatch(e -> PROJECT_ID_2.equals(e.getProjectId()));

        // Test countByProjectIdAndParentId scoping
        long project1ChildCount = workItemRepository.countByProjectIdAndParentId(PROJECT_ID_1, parentId1);
        assertThat(project1ChildCount).isEqualTo(2);

        long project2ChildCount = workItemRepository.countByProjectIdAndParentId(PROJECT_ID_2, parentId2);
        assertThat(project2ChildCount).isEqualTo(1);

        // Cross-project count should be zero (parent from project-1, querying project-2)
        long crossProjectCount = workItemRepository.countByProjectIdAndParentId(PROJECT_ID_2, parentId1);
        assertThat(crossProjectCount).isEqualTo(0);
    }

    // ========================================================================
    // Helper Methods
    // ========================================================================

    private WorkItemEntity createWorkItem(UUID id, UUID projectId, String type, String title, UUID parentId) {
        return WorkItemEntity.builder()
                .id(id)
                .projectId(projectId)
                .type(type)
                .title(title)
                .parentId(parentId)
                .status("PLANNED")
                .sortOrder(0)
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();
    }
}
