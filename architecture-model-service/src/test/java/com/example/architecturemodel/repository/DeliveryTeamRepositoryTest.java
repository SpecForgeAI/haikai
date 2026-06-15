package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.DeliveryTeamEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Repository tests for DeliveryTeamRepository.
 *
 * Tests entity mapping, query methods, and the WorkItemEntity deliveryTeamId field.
 *
 * Note: The work_item table cannot be created by H2 due to the JSONB columnDefinition
 * on tags_json. Test 4 verifies the deliveryTeamId field at the Java/entity level instead.
 *
 * Spec: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)
 * Task Group 2: Entities, Enum, and Repository
 */
@DataJpaTest
@ActiveProfiles("test")
class DeliveryTeamRepositoryTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private DeliveryTeamRepository deliveryTeamRepository;

    private static final UUID PROJECT_ID_1 = UUID.randomUUID();
    private static final UUID PROJECT_ID_2 = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        deliveryTeamRepository.deleteAll();
    }

    /**
     * Test 1: DeliveryTeamEntity can be persisted and retrieved with all fields correctly mapped.
     */
    @Test
    @DisplayName("DeliveryTeamEntity persists and retrieves with all fields correctly mapped")
    void testEntityPersistAndRetrieve() {
        UUID teamId = UUID.randomUUID();
        DeliveryTeamEntity entity = DeliveryTeamEntity.builder()
            .id(teamId)
            .projectId(PROJECT_ID_1)
            .name("Backend Team")
            .type("INTERNAL")
            .description("Handles backend services")
            .build();

        deliveryTeamRepository.save(entity);
        entityManager.flush();
        entityManager.clear();

        DeliveryTeamEntity saved = deliveryTeamRepository.findById(teamId).orElseThrow();
        assertThat(saved.getId()).isEqualTo(teamId);
        assertThat(saved.getProjectId()).isEqualTo(PROJECT_ID_1);
        assertThat(saved.getName()).isEqualTo("Backend Team");
        assertThat(saved.getType()).isEqualTo("INTERNAL");
        assertThat(saved.getDescription()).isEqualTo("Handles backend services");
        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(saved.getUpdatedAt()).isNotNull();
    }

    /**
     * Test 2: findByProjectIdOrderByNameAsc returns teams for a project ordered alphabetically,
     * excludes teams from other projects.
     */
    @Test
    @DisplayName("findByProjectIdOrderByNameAsc returns teams ordered by name, excludes other projects")
    void testFindByProjectIdOrderByNameAsc() {
        // Teams for project 1
        deliveryTeamRepository.save(DeliveryTeamEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID_1)
            .name("Zebra Team")
            .type("EXTERNAL")
            .build());
        deliveryTeamRepository.save(DeliveryTeamEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID_1)
            .name("Alpha Team")
            .type("INTERNAL")
            .build());
        deliveryTeamRepository.save(DeliveryTeamEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID_1)
            .name("Middle Team")
            .type("INTERNAL")
            .build());

        // Team for project 2 (should be excluded)
        deliveryTeamRepository.save(DeliveryTeamEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID_2)
            .name("Other Project Team")
            .type("EXTERNAL")
            .build());

        entityManager.flush();
        entityManager.clear();

        List<DeliveryTeamEntity> results = deliveryTeamRepository.findByProjectIdOrderByNameAsc(PROJECT_ID_1);

        assertThat(results).hasSize(3);
        assertThat(results.get(0).getName()).isEqualTo("Alpha Team");
        assertThat(results.get(1).getName()).isEqualTo("Middle Team");
        assertThat(results.get(2).getName()).isEqualTo("Zebra Team");

        // Verify project 2 team is not included
        List<DeliveryTeamEntity> project2Results = deliveryTeamRepository.findByProjectIdOrderByNameAsc(PROJECT_ID_2);
        assertThat(project2Results).hasSize(1);
        assertThat(project2Results.get(0).getName()).isEqualTo("Other Project Team");
    }

    /**
     * Test 3: existsByProjectIdAndNameIgnoreCase returns true for case-insensitive match
     * and false for non-matching names.
     */
    @Test
    @DisplayName("existsByProjectIdAndNameIgnoreCase returns true for case variations, false for non-matching")
    void testExistsByProjectIdAndNameIgnoreCase() {
        deliveryTeamRepository.save(DeliveryTeamEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID_1)
            .name("Team Alpha")
            .type("INTERNAL")
            .build());
        entityManager.flush();

        // Case-insensitive matches should return true
        assertThat(deliveryTeamRepository.existsByProjectIdAndNameIgnoreCase(PROJECT_ID_1, "Team Alpha")).isTrue();
        assertThat(deliveryTeamRepository.existsByProjectIdAndNameIgnoreCase(PROJECT_ID_1, "team alpha")).isTrue();
        assertThat(deliveryTeamRepository.existsByProjectIdAndNameIgnoreCase(PROJECT_ID_1, "TEAM ALPHA")).isTrue();
        assertThat(deliveryTeamRepository.existsByProjectIdAndNameIgnoreCase(PROJECT_ID_1, "TeAm AlPhA")).isTrue();

        // Non-matching name should return false
        assertThat(deliveryTeamRepository.existsByProjectIdAndNameIgnoreCase(PROJECT_ID_1, "Team Beta")).isFalse();

        // Same name but different project should return false
        assertThat(deliveryTeamRepository.existsByProjectIdAndNameIgnoreCase(PROJECT_ID_2, "Team Alpha")).isFalse();
    }

    /**
     * Test 4: WorkItemEntity with deliveryTeamId field exists and is correctly mapped.
     *
     * The work_item table uses a JSONB column (tags_json) which prevents H2 from creating
     * the table via ddl-auto. We verify the field at the Java/entity level instead.
     */
    @Test
    @DisplayName("WorkItemEntity has deliveryTeamId field that accepts UUID and null values")
    void testWorkItemEntityDeliveryTeamIdField() {
        UUID teamId = UUID.randomUUID();

        // Work item with deliveryTeamId set
        WorkItemEntity withTeam = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .type("INITIATIVE")
            .title("Item With Team")
            .status("PLANNED")
            .sortOrder(0)
            .deliveryTeamId(teamId)
            .build();

        assertThat(withTeam.getDeliveryTeamId()).isEqualTo(teamId);
        // Verify other fields are unaffected
        assertThat(withTeam.getTitle()).isEqualTo("Item With Team");
        assertThat(withTeam.getType()).isEqualTo("INITIATIVE");
        assertThat(withTeam.getStatus()).isEqualTo("PLANNED");

        // Work item with deliveryTeamId null (default)
        WorkItemEntity withoutTeam = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .type("EPIC")
            .title("Item Without Team")
            .status("PLANNED")
            .sortOrder(1)
            .build();

        assertThat(withoutTeam.getDeliveryTeamId()).isNull();
        assertThat(withoutTeam.getTitle()).isEqualTo("Item Without Team");

        // Verify setter works
        withoutTeam.setDeliveryTeamId(teamId);
        assertThat(withoutTeam.getDeliveryTeamId()).isEqualTo(teamId);

        // Verify can be set back to null
        withoutTeam.setDeliveryTeamId(null);
        assertThat(withoutTeam.getDeliveryTeamId()).isNull();
    }
}
