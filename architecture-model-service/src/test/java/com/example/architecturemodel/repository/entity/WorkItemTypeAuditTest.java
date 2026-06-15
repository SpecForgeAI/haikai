package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.WorkItemEntity;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Audit test for the WorkItem {@code type} column.
 *
 * <p>Spec 2026-05-17 PM Migration Delivery Plan / Book of Work Draft, Group 2:
 * confirms that the existing {@link WorkItemEntity} natively round-trips the
 * four lowercase type values required by the save-to-backlog flow
 * (Q-2): {@code initiative}, {@code epic}, {@code feature}, {@code story}.</p>
 *
 * <p>Background:
 * <ul>
 *   <li>The {@code work_item.type} column is a free-text {@code TEXT NOT NULL}
 *       column (see changeset {@code 012-work-items-project-artifacts.sql}).</li>
 *   <li>There is no enum type, no check constraint, and no domain on the column.
 *       Any string value persists successfully.</li>
 *   <li>The legacy convention used by the existing roadmap / book-of-work
 *       importers is uppercase ({@code INITIATIVE}, {@code EPIC},
 *       {@code FEATURE}, {@code STORY}); the new PM migration delivery plan
 *       save-to-backlog flow (Group 8) is responsible for any case mapping it
 *       wants to apply between {@code GeneratedMigrationBookOfWorkItem.type}
 *       and the stored {@code work_item.type} value.</li>
 * </ul></p>
 *
 * <p>Audit outcome (Group 2.4): no schema change required. The
 * {@code initiative | epic | feature | story} values requested by
 * {@code GeneratedMigrationBookOfWorkItem} round-trip cleanly through
 * {@code WorkItemEntity} without a new Liquibase changeset. No mapping table
 * is needed at runtime (Q-2).</p>
 *
 * <p>H2 schema generation in this slice is driven by Hibernate
 * {@code ddl-auto=create-drop}. Because {@code WorkItemEntity.tagsJson} uses
 * {@code columnDefinition = "jsonb"}, the test datasource registers a JSONB
 * domain alias so the table is created cleanly (same pattern as
 * {@code LibraryConstraintTest}).</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    // Register JSONB as a JSON domain alias so the work_item table (whose
    // tags_json column uses columnDefinition = "jsonb") is created cleanly
    // by Hibernate ddl-auto on H2 in PostgreSQL mode.
    "spring.datasource.url=jdbc:h2:mem:workitemtypeauditdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class WorkItemTypeAuditTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private WorkItemRepository workItemRepository;

    /**
     * Group 2.1 — Tests 1+2: All four lowercase type values required by the
     * GeneratedMigrationBookOfWorkItem schema persist and reload with the value
     * intact. Parameterised so each value round-trips through its own entity.
     */
    @ParameterizedTest
    @ValueSource(strings = {"initiative", "epic", "feature", "story"})
    void lowercaseTypeValueRoundTripsCleanly(String typeValue) {
        UUID projectId = UUID.randomUUID();
        UUID itemId = UUID.randomUUID();

        WorkItemEntity entity = WorkItemEntity.builder()
            .id(itemId)
            .projectId(projectId)
            .type(typeValue)
            .title("Audit fixture for type=" + typeValue)
            .build();

        workItemRepository.save(entity);
        entityManager.flush();
        entityManager.clear();

        WorkItemEntity reloaded = workItemRepository.findById(itemId).orElseThrow();
        assertThat(reloaded.getType())
            .as("WorkItem type column must round-trip the exact lowercase value persisted")
            .isEqualTo(typeValue);
        assertThat(reloaded.getProjectId()).isEqualTo(projectId);
    }

    /**
     * Group 2.1 — supplementary: confirms the legacy uppercase convention also
     * round-trips, demonstrating that {@code work_item.type} is genuinely
     * free-text and case-preserving. This anchors the audit conclusion that no
     * enum / check-constrained narrowing exists on the column.
     */
    @ParameterizedTest
    @ValueSource(strings = {"INITIATIVE", "EPIC", "FEATURE", "STORY"})
    void uppercaseLegacyValueAlsoRoundTripsCleanly(String typeValue) {
        UUID projectId = UUID.randomUUID();
        UUID itemId = UUID.randomUUID();

        WorkItemEntity entity = WorkItemEntity.builder()
            .id(itemId)
            .projectId(projectId)
            .type(typeValue)
            .title("Audit fixture for legacy type=" + typeValue)
            .build();

        workItemRepository.save(entity);
        entityManager.flush();
        entityManager.clear();

        WorkItemEntity reloaded = workItemRepository.findById(itemId).orElseThrow();
        assertThat(reloaded.getType()).isEqualTo(typeValue);
    }
}
