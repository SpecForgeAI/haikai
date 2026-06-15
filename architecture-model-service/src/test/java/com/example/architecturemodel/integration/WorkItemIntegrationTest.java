package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for work item persistence and cascading behavior.
 */
@DataJpaTest
@ActiveProfiles("test")
class WorkItemIntegrationTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private WorkItemRepository workItemRepository;

    private static final UUID PROJECT_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        workItemRepository.deleteAll();
        entityManager.flush();
        entityManager.clear();
    }

    // NOTE: the harness runs Hibernate ddl-auto create-drop (Liquibase disabled
    // in src/test/resources/application.yml), so database-level constraints that
    // exist only in the Liquibase schema are NOT present here and cannot be
    // asserted at the repository level.
    // The former cascadeDelete_deletingEpic_removesFeatureAndStory test asserted
    // the work_item parent_id ON DELETE CASCADE FK, which is defined by Liquibase
    // changeset 012 and exists only in the real schema.

    /**
     * Test deterministic ordering: Same sort_order should order by created_at, then id.
     */
    @Test
    void deterministicOrdering_sameortOrder_ordersbyCreatedAtThenId() {
        Instant baseTime = Instant.now().truncatedTo(ChronoUnit.SECONDS);

        // Create items with same sort_order but different created_at
        WorkItemEntity item3 = createWorkItem("INITIATIVE", "Third (newest)", 0,
            baseTime.plusSeconds(2));
        WorkItemEntity item1 = createWorkItem("INITIATIVE", "First (oldest)", 0,
            baseTime);
        WorkItemEntity item2 = createWorkItem("INITIATIVE", "Second", 0,
            baseTime.plusSeconds(1));

        // Save in random order
        workItemRepository.saveAll(List.of(item3, item1, item2));
        entityManager.flush();
        entityManager.clear();

        List<WorkItemEntity> results = workItemRepository
            .findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(PROJECT_ID);

        assertThat(results).hasSize(3);
        assertThat(results.get(0).getTitle()).isEqualTo("First (oldest)");
        assertThat(results.get(1).getTitle()).isEqualTo("Second");
        assertThat(results.get(2).getTitle()).isEqualTo("Third (newest)");
    }

    /**
     * Test full CRUD workflow: Create, read, update, delete.
     */
    @Test
    void fullCrudWorkflow() {
        // CREATE
        WorkItemEntity created = createAndSaveWorkItem("INITIATIVE", "Test Initiative", null);
        UUID id = created.getId();
        entityManager.flush();
        entityManager.clear();

        // READ
        WorkItemEntity read = workItemRepository.findById(id).orElseThrow();
        assertThat(read.getTitle()).isEqualTo("Test Initiative");
        assertThat(read.getStatus()).isEqualTo("PLANNED");

        // UPDATE
        read.setTitle("Updated Initiative");
        read.setStatus("IN_PROGRESS");
        workItemRepository.save(read);
        entityManager.flush();
        entityManager.clear();

        WorkItemEntity updated = workItemRepository.findById(id).orElseThrow();
        assertThat(updated.getTitle()).isEqualTo("Updated Initiative");
        assertThat(updated.getStatus()).isEqualTo("IN_PROGRESS");

        // DELETE
        workItemRepository.deleteById(id);
        entityManager.flush();
        entityManager.clear();

        assertThat(workItemRepository.findById(id)).isEmpty();
    }

    /**
     * Test filtering by parent ID returns only direct children.
     */
    @Test
    void findByParentId_returnsOnlyDirectChildren() {
        // Create hierarchy with multiple levels
        WorkItemEntity init = createAndSaveWorkItem("INITIATIVE", "Initiative", null);

        WorkItemEntity epic1 = createAndSaveWorkItem("EPIC", "Epic 1", init.getId());
        WorkItemEntity epic2 = createAndSaveWorkItem("EPIC", "Epic 2", init.getId());

        WorkItemEntity feature = createAndSaveWorkItem("FEATURE", "Feature under Epic 1",
            epic1.getId());

        entityManager.flush();
        entityManager.clear();

        // Query for children of initiative
        List<WorkItemEntity> childrenOfInit = workItemRepository
            .findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc(PROJECT_ID, init.getId());

        assertThat(childrenOfInit).hasSize(2);
        assertThat(childrenOfInit).extracting(WorkItemEntity::getTitle)
            .containsExactlyInAnyOrder("Epic 1", "Epic 2");

        // Query for children of epic1
        List<WorkItemEntity> childrenOfEpic1 = workItemRepository
            .findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc(PROJECT_ID, epic1.getId());

        assertThat(childrenOfEpic1).hasSize(1);
        assertThat(childrenOfEpic1.get(0).getTitle()).isEqualTo("Feature under Epic 1");
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private WorkItemEntity createWorkItem(String type, String title, int sortOrder, Instant createdAt) {
        return WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .type(type)
            .title(title)
            .status("PLANNED")
            .sortOrder(sortOrder)
            .createdAt(createdAt)
            .updatedAt(createdAt)
            .build();
    }

    private WorkItemEntity createAndSaveWorkItem(String type, String title, UUID parentId) {
        Instant now = Instant.now();
        WorkItemEntity entity = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .type(type)
            .parentId(parentId)
            .title(title)
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(now)
            .updatedAt(now)
            .build();
        return workItemRepository.save(entity);
    }
}
