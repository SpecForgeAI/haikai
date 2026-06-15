package com.example.architecturemodel.migration;

import com.example.architecturemodel.model.entity.DeliveryTeamEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.DeliveryTeamRepository;
import jakarta.persistence.Column;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;

import java.lang.reflect.Field;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Migration verification tests for migrations 044 and 045.
 *
 * Since tests use H2 with hibernate ddl-auto=create-drop, we verify the entity
 * field mappings which mirror the migration's column definitions.
 *
 * Note: The work_item table cannot be created by H2 due to the JSONB columnDefinition
 * on tags_json. Test 2 verifies the field mapping at the Java/entity level instead.
 *
 * Spec: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)
 * Task Group 1: Flyway Migrations
 */
@DataJpaTest
@ActiveProfiles("test")
class DeliveryTeamMigrationTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private DeliveryTeamRepository deliveryTeamRepository;

    /**
     * Test 1: Verify delivery_teams table columns and constraints exist after migration.
     * Persists a DeliveryTeamEntity with all fields and verifies round-trip correctness.
     */
    @Test
    @DisplayName("delivery_teams table exists with all columns - entity persists and retrieves correctly")
    void deliveryTeamsTableExistsWithAllColumns() {
        UUID projectId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();

        DeliveryTeamEntity entity = DeliveryTeamEntity.builder()
            .id(teamId)
            .projectId(projectId)
            .name("Platform Team")
            .type("INTERNAL")
            .description("Core platform engineering team")
            .build();

        deliveryTeamRepository.save(entity);
        entityManager.flush();
        entityManager.clear();

        DeliveryTeamEntity saved = deliveryTeamRepository.findById(teamId).orElseThrow();
        assertThat(saved.getId()).isEqualTo(teamId);
        assertThat(saved.getProjectId()).isEqualTo(projectId);
        assertThat(saved.getName()).isEqualTo("Platform Team");
        assertThat(saved.getType()).isEqualTo("INTERNAL");
        assertThat(saved.getDescription()).isEqualTo("Core platform engineering team");
        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(saved.getUpdatedAt()).isNotNull();
    }

    /**
     * Test 2: Verify work_item.delivery_team_id field mapping is correct on WorkItemEntity.
     *
     * The work_item table uses a JSONB column (tags_json) which prevents H2 from creating
     * the table via ddl-auto. We verify the JPA field mapping at the entity/reflection level
     * to confirm the delivery_team_id column mapping is correct.
     */
    @Test
    @DisplayName("WorkItemEntity has deliveryTeamId field mapped to delivery_team_id column")
    void workItemEntityHasDeliveryTeamIdField() throws NoSuchFieldException {
        // Verify the field exists on the entity class
        Field deliveryTeamIdField = WorkItemEntity.class.getDeclaredField("deliveryTeamId");
        assertThat(deliveryTeamIdField).isNotNull();
        assertThat(deliveryTeamIdField.getType()).isEqualTo(UUID.class);

        // Verify the @Column annotation maps to the correct column name
        Column columnAnnotation = deliveryTeamIdField.getAnnotation(Column.class);
        assertThat(columnAnnotation).isNotNull();
        assertThat(columnAnnotation.name()).isEqualTo("delivery_team_id");

        // Verify the field is nullable (no nullable = false)
        // When @Column(nullable) is not specified, the default is true
        // The annotation should not have nullable = false
        assertThat(columnAnnotation.nullable()).isTrue();

        // Verify the field can be set and retrieved via builder
        UUID teamId = UUID.randomUUID();
        WorkItemEntity withTeam = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .type("INITIATIVE")
            .title("Test")
            .deliveryTeamId(teamId)
            .build();
        assertThat(withTeam.getDeliveryTeamId()).isEqualTo(teamId);

        // Verify null is accepted
        WorkItemEntity withoutTeam = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .type("EPIC")
            .title("Test 2")
            .build();
        assertThat(withoutTeam.getDeliveryTeamId()).isNull();
    }
}
