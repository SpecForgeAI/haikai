package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.dto.WorkItemDto;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.service.WorkItemService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Persistence + service round-trip tests for the {@code work_item.provenance}
 * column added by Liquibase changeset {@code 186}.
 *
 * <p>Spec: D5 -- Net-new backlog items + provenance (2026-06-14, Spec 5 of 6)
 * -- Task Group 1.</p>
 *
 * <p>Mirrors the {@code MigrationExecutionRunStatePersistenceTest} harness (the
 * {@code deferred}-column test) exactly: a {@code @DataJpaTest} + H2
 * PostgreSQL-mode slice with the {@code CREATE DOMAIN JSONB AS JSON} idiom so the
 * {@code work_item} table (which carries a {@code jsonb} tags column) is
 * H2-creatable, and {@link WorkItemService} instantiated directly over the
 * autowired repository (the slice does not register {@code @Service} beans).</p>
 *
 * <p>Focused tests (3 -- within the 2-8 budget per task 1.1, the
 * {@code deferred}-precedent shape):</p>
 * <ol>
 *   <li>a builder that OMITS {@code provenance} reads back {@code 'carry_over'}
 *       (the DB DEFAULT + the {@code @PrePersist} mirror -- no backfill needed);</li>
 *   <li>a {@code net_new} provenance round-trips through create + reload (the
 *       deliberate manual-add marker);</li>
 *   <li>a null-guarded PATCH ({@code updateWorkItem} with {@code provenance ==
 *       null}) NEVER wipes an existing {@code net_new} value (the boxed
 *       PATCH-mutable null-guard, mirroring the {@code deferred} guard).</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:workitemprovenancedb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class WorkItemProvenanceColumnTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private WorkItemRepository workItemRepository;

    private WorkItemService workItemService;

    @BeforeEach
    void setUp() {
        workItemService = new WorkItemService(workItemRepository);
    }

    @Test
    @DisplayName("a builder that omits provenance reads back 'carry_over' (DB DEFAULT + @PrePersist mirror; no backfill)")
    void provenanceDefaultsToCarryOver() {
        UUID projectId = UUID.randomUUID();
        // Build a story WITHOUT calling .provenance(...) -- the @Builder.Default +
        // @PrePersist must insert 'carry_over'.
        WorkItemEntity story = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .type("STORY")
            .title("An ordinary discovered story")
            .build();
        workItemRepository.save(story);
        entityManager.flush();
        entityManager.clear();

        WorkItemEntity fresh = workItemRepository.findById(story.getId()).orElseThrow();
        assertThat(fresh.getProvenance())
            .as("every existing/discovered row is correct carry_over with NO backfill")
            .isEqualTo(WorkItemEntity.PROVENANCE_CARRY_OVER);
    }

    @Test
    @DisplayName("a net_new provenance round-trips through create + reload (the manual-add marker)")
    void netNewProvenanceRoundTrips() {
        UUID projectId = UUID.randomUUID();
        WorkItemDto dto = new WorkItemDto(
            null, projectId, "STORY", null,
            "A genuinely new feature", "Adds a brand-new monitoring job",
            "PLANNED", 0, null, null, null,
            null, null, null, null, null,
            null, null, null, Boolean.FALSE, null,
            WorkItemEntity.PROVENANCE_NET_NEW);

        WorkItemDto created = workItemService.createWorkItem(projectId, dto);
        assertThat(created.provenance()).isEqualTo(WorkItemEntity.PROVENANCE_NET_NEW);
        entityManager.flush();
        entityManager.clear();

        WorkItemEntity reloaded = workItemRepository.findById(created.id()).orElseThrow();
        assertThat(reloaded.getProvenance())
            .as("net_new must round-trip on the COLUMN")
            .isEqualTo(WorkItemEntity.PROVENANCE_NET_NEW);
    }

    @Test
    @DisplayName("a null-guarded PATCH (provenance == null) never wipes an existing net_new value (boxed PATCH-mutable null-guard)")
    void patchOmittingProvenanceDoesNotWipeIt() {
        UUID projectId = UUID.randomUUID();
        // Seed a net_new story directly.
        WorkItemEntity story = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .type("STORY")
            .title("A net_new story")
            .provenance(WorkItemEntity.PROVENANCE_NET_NEW)
            .build();
        workItemRepository.save(story);
        entityManager.flush();
        entityManager.clear();

        // A general PATCH that OMITS provenance (null) -- e.g. a title edit. The
        // null-guard must leave the net_new marker intact (mirrors deferred /
        // sourceCapabilityId).
        WorkItemDto patch = new WorkItemDto(
            story.getId(), projectId, "STORY", null,
            "A net_new story (renamed)", null,
            null, null, null, null, null,
            null, null, null, null, null,
            null, null, null, null, null,
            /* provenance */ null);

        WorkItemDto updated = workItemService.updateWorkItem(story.getId(), patch);
        assertThat(updated.provenance())
            .as("an omitted provenance on update must NEVER wipe the column")
            .isEqualTo(WorkItemEntity.PROVENANCE_NET_NEW);
        entityManager.flush();
        entityManager.clear();

        assertThat(workItemRepository.findById(story.getId()).orElseThrow().getProvenance())
            .isEqualTo(WorkItemEntity.PROVENANCE_NET_NEW);
    }
}
