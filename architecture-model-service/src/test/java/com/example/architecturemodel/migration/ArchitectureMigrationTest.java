package com.example.architecturemodel.migration;

import com.example.architecturemodel.model.entity.ApplicationEntity;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.LogicalDataEntityEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.entity.ApplicationRepository;
import com.example.architecturemodel.repository.entity.LogicalDataEntityRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;

import java.nio.ByteBuffer;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Critical four-part Liquibase integration test for the multi-architecture
 * migration sequence (changesets 087 - 091).
 *
 * Test environment limitations & strategy:
 * - The test profile uses H2 with `liquibase.enabled=false` and Hibernate
 *   `ddl-auto=create-drop`, so the actual SQL changesets do NOT execute.
 *   Hibernate generates the schema from JPA entity annotations.
 * - The new architecture and architecture_tag tables therefore EXIST in the
 *   test schema (because their JPA entities ship in this spec); but the
 *   architecture_id columns on existing meta-model tables do NOT exist (those
 *   columns are added in changeset 089 to existing tables, and the entity
 *   annotations for those tables won't gain the field until Task Group 2's
 *   Bucket A refactor).
 * - To validate the migration's logical behaviour end-to-end, this test:
 *     1. Adds the architecture_id column to the representative tables via raw
 *        DDL (mirroring changeset 089).
 *     2. Seeds a fixture project + sample meta-model rows in 3 different
 *        in-scope tables (model_files, applications, logical_data_entities).
 *     3. Simulates changesets 088 (insert Default architecture) and 090
 *        (backfill architecture_id) by calling their SQL UPDATE statements
 *        verbatim through the EntityManager.
 *     4. Asserts the four required properties (a)-(d) below.
 *     5. Re-runs steps 3 and verifies idempotency.
 *
 * The four required assertions (per Task 1.1):
 *   (a) Every in-scope meta-model row has non-null architecture_id post-migration.
 *   (b) Every project has exactly one architecture named 'Default'.
 *   (c) Per-table row counts unchanged before vs after.
 *   (d) Re-running the migration is a no-op (idempotency: zero changes on second run).
 *
 * Spec: Multi-Architecture Plumbing (Spec #1)
 * Task Group 1: Backend Foundation (Task 1.1 critical migration test)
 */
@DataJpaTest
@ActiveProfiles("test")
class ArchitectureMigrationTest {

    @Autowired
    private TestEntityManager testEntityManager;

    @PersistenceContext
    private EntityManager entityManager;

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    @Autowired
    private ApplicationRepository applicationRepository;

    @Autowired
    private LogicalDataEntityRepository logicalDataEntityRepository;

    @Autowired
    private ArchitectureRepository architectureRepository;

    private UUID projectId;
    private String modelFileId;
    private static final String APP_ID_1 = "test-app-1";
    private static final String APP_ID_2 = "test-app-2";
    private static final String LOG_ENT_ID_1 = "test-log-ent-1";

    @BeforeEach
    void setUp() {
        // Add architecture_id column to the three representative tables so we
        // can simulate changesets 089 + 090 via raw SQL UPDATE statements.
        // (Hibernate doesn't add this column because the entity hasn't gained
        // the field yet - that lands in Task Group 2's Bucket A refactor.)
        // IF NOT EXISTS makes the DDL itself idempotent across @BeforeEach runs.
        entityManager.createNativeQuery(
            "ALTER TABLE model_files ADD COLUMN IF NOT EXISTS architecture_id UUID NULL"
        ).executeUpdate();
        entityManager.createNativeQuery(
            "ALTER TABLE applications ADD COLUMN IF NOT EXISTS architecture_id UUID NULL"
        ).executeUpdate();
        entityManager.createNativeQuery(
            "ALTER TABLE logical_data_entities ADD COLUMN IF NOT EXISTS architecture_id UUID NULL"
        ).executeUpdate();

        // Seed fixture project + meta-model rows
        projectId = UUID.randomUUID();
        modelFileId = "test-model-file-" + UUID.randomUUID();

        ProjectEntity project = ProjectEntity.builder()
            .id(projectId)
            .name("test-project-" + projectId)
            .projectParentFolder("/tmp/test")
            .isActive(false)
            .createdAt(Instant.parse("2026-01-01T00:00:00Z"))
            .updatedAt(Instant.parse("2026-01-01T00:00:00Z"))
            .build();
        projectRepository.save(project);

        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id(modelFileId)
            .filename("test-mf-" + modelFileId)
            .isDefault(false)
            .projectId(projectId)
            .build();
        modelFileRepository.save(modelFile);

        ApplicationEntity app1 = ApplicationEntity.builder()
            .id(APP_ID_1)
            .modelFileId(modelFileId)
            .name("App One")
            .description("first app")
            .abbreviation("A1")
            .build();
        ApplicationEntity app2 = ApplicationEntity.builder()
            .id(APP_ID_2)
            .modelFileId(modelFileId)
            .name("App Two")
            .description("second app")
            .abbreviation("A2")
            .build();
        applicationRepository.saveAll(List.of(app1, app2));

        LogicalDataEntityEntity logEnt1 = LogicalDataEntityEntity.builder()
            .id(LOG_ENT_ID_1)
            .modelFileId(modelFileId)
            .name("Customer")
            .description("logical entity one")
            .build();
        logicalDataEntityRepository.save(logEnt1);

        testEntityManager.flush();
    }

    /**
     * The single comprehensive test that asserts all four required properties
     * (a)-(d) end-to-end, on a seeded fixture, against a simulated execution
     * of changesets 088 and 090.
     */
    @Test
    @DisplayName("Migration is zero-data-loss + idempotent: every in-scope row gets a non-null architecture_id; every project has exactly one 'Default'; row counts unchanged; re-run is a no-op")
    void testMigrationZeroDataLossAndIdempotency() {
        // -----------------------------------------------------------------
        // SNAPSHOT: per-table row counts before migration
        // -----------------------------------------------------------------
        long modelFilesBefore  = modelFileRepository.count();
        long applicationsBefore = applicationRepository.count();
        long logEntitiesBefore  = logicalDataEntityRepository.count();
        long projectsBefore     = projectRepository.count();

        assertThat(modelFilesBefore).isEqualTo(1);
        assertThat(applicationsBefore).isEqualTo(2);
        assertThat(logEntitiesBefore).isEqualTo(1);
        assertThat(projectsBefore).isEqualTo(1);
        assertThat(architectureRepository.count()).isEqualTo(0);

        // -----------------------------------------------------------------
        // FIRST RUN: simulate changesets 088 + 090
        // -----------------------------------------------------------------
        runMigrationStep088InsertDefaults();
        runMigrationStep090Backfill();
        testEntityManager.flush();
        testEntityManager.clear();

        // -----------------------------------------------------------------
        // ASSERTION (b): Every project has exactly one architecture named 'Default'.
        // -----------------------------------------------------------------
        assertThat(architectureRepository.count()).isEqualTo(1);
        ArchitectureEntity defaultArch =
            architectureRepository.findByProjectIdOrderByCreatedAtAsc(projectId).get(0);
        assertThat(defaultArch.getName()).isEqualTo("Default");
        assertThat(defaultArch.getProjectId()).isEqualTo(projectId);
        assertThat(defaultArch.getArchived()).isFalse();
        // Deterministic UUID derivation: architecture.id == project.id.
        assertThat(defaultArch.getId()).isEqualTo(projectId);

        // -----------------------------------------------------------------
        // ASSERTION (a): Every in-scope row has non-null architecture_id.
        // -----------------------------------------------------------------
        long modelFilesWithNullArch = countNullArchitectureIds("model_files");
        long appsWithNullArch       = countNullArchitectureIds("applications");
        long logEntsWithNullArch    = countNullArchitectureIds("logical_data_entities");
        assertThat(modelFilesWithNullArch).isEqualTo(0);
        assertThat(appsWithNullArch).isEqualTo(0);
        assertThat(logEntsWithNullArch).isEqualTo(0);

        // Spot-check that the populated value is exactly the Default architecture id.
        UUID resolvedArchOnApp1 = readArchitectureId("applications", "id", APP_ID_1);
        UUID resolvedArchOnApp2 = readArchitectureId("applications", "id", APP_ID_2);
        UUID resolvedArchOnLog1 = readArchitectureId("logical_data_entities", "id", LOG_ENT_ID_1);
        assertThat(resolvedArchOnApp1).isEqualTo(defaultArch.getId());
        assertThat(resolvedArchOnApp2).isEqualTo(defaultArch.getId());
        assertThat(resolvedArchOnLog1).isEqualTo(defaultArch.getId());

        // -----------------------------------------------------------------
        // ASSERTION (c): Per-table row counts unchanged.
        // -----------------------------------------------------------------
        assertThat(modelFileRepository.count()).isEqualTo(modelFilesBefore);
        assertThat(applicationRepository.count()).isEqualTo(applicationsBefore);
        assertThat(logicalDataEntityRepository.count()).isEqualTo(logEntitiesBefore);
        assertThat(projectRepository.count()).isEqualTo(projectsBefore);

        // -----------------------------------------------------------------
        // SECOND RUN: re-execute the SAME migration steps. Should be a no-op.
        // -----------------------------------------------------------------
        long archCountBeforeRerun = architectureRepository.count();

        runMigrationStep088InsertDefaults();
        runMigrationStep090Backfill();
        testEntityManager.flush();
        testEntityManager.clear();

        // -----------------------------------------------------------------
        // ASSERTION (d): Idempotency -- counts and architecture row unchanged.
        // -----------------------------------------------------------------
        assertThat(architectureRepository.count())
            .as("architecture row count must not change on re-run")
            .isEqualTo(archCountBeforeRerun);
        assertThat(modelFileRepository.count()).isEqualTo(modelFilesBefore);
        assertThat(applicationRepository.count()).isEqualTo(applicationsBefore);
        assertThat(logicalDataEntityRepository.count()).isEqualTo(logEntitiesBefore);
        assertThat(projectRepository.count()).isEqualTo(projectsBefore);

        // The Default architecture's id must still be the same deterministic value.
        ArchitectureEntity defaultArchAfter =
            architectureRepository.findByProjectIdOrderByCreatedAtAsc(projectId).get(0);
        assertThat(defaultArchAfter.getId()).isEqualTo(defaultArch.getId());
        assertThat(defaultArchAfter.getName()).isEqualTo("Default");

        // Backfilled architecture_ids are still populated and point at the same architecture.
        assertThat(countNullArchitectureIds("model_files")).isEqualTo(0);
        assertThat(countNullArchitectureIds("applications")).isEqualTo(0);
        assertThat(countNullArchitectureIds("logical_data_entities")).isEqualTo(0);
        assertThat(readArchitectureId("applications", "id", APP_ID_1))
            .isEqualTo(defaultArch.getId());
    }

    // ========================================================================
    // Migration step simulators -- mirror the SQL in changesets 088 and 090
    // ========================================================================

    /**
     * Mirrors changeset 088: insert one Default architecture per project where
     * one does not already exist. Idempotent via WHERE NOT EXISTS.
     */
    private void runMigrationStep088InsertDefaults() {
        entityManager.createNativeQuery(
            "INSERT INTO architecture (id, project_id, name, description, archived, draft_state, kind, created_at, updated_at) " +
            "SELECT p.id, p.id, 'Default', NULL, FALSE, 'active', 'current', p.created_at, p.updated_at " +
            "FROM project p " +
            "WHERE NOT EXISTS (" +
            "  SELECT 1 FROM architecture a WHERE a.project_id = p.id AND a.name = 'Default'" +
            ")"
        ).executeUpdate();
    }

    /**
     * Mirrors changeset 090 for the three representative tables. Idempotent
     * via WHERE architecture_id IS NULL.
     */
    private void runMigrationStep090Backfill() {
        // model_files: direct project_id lookup
        entityManager.createNativeQuery(
            "UPDATE model_files mf SET architecture_id = (" +
            "  SELECT a.id FROM architecture a " +
            "  WHERE a.project_id = mf.project_id AND a.name = 'Default' LIMIT 1" +
            ") WHERE mf.architecture_id IS NULL AND mf.project_id IS NOT NULL"
        ).executeUpdate();

        // applications: chain through model_files.architecture_id
        entityManager.createNativeQuery(
            "UPDATE applications SET architecture_id = (" +
            "  SELECT mf.architecture_id FROM model_files mf WHERE mf.id = applications.model_file_id" +
            ") WHERE architecture_id IS NULL"
        ).executeUpdate();

        // logical_data_entities: chain through model_files.architecture_id
        entityManager.createNativeQuery(
            "UPDATE logical_data_entities SET architecture_id = (" +
            "  SELECT mf.architecture_id FROM model_files mf WHERE mf.id = logical_data_entities.model_file_id" +
            ") WHERE architecture_id IS NULL"
        ).executeUpdate();
    }

    // ========================================================================
    // Test helpers
    // ========================================================================

    private long countNullArchitectureIds(String tableName) {
        Object result = entityManager.createNativeQuery(
            "SELECT COUNT(*) FROM " + tableName + " WHERE architecture_id IS NULL"
        ).getSingleResult();
        return ((Number) result).longValue();
    }

    private UUID readArchitectureId(String tableName, String pkColumn, String pkValue) {
        Object result = entityManager.createNativeQuery(
            "SELECT architecture_id FROM " + tableName + " WHERE " + pkColumn + " = '" + pkValue + "'"
        ).getSingleResult();
        return convertToUuid(result);
    }

    /**
     * H2's native query result for a UUID column can be returned as
     * java.util.UUID, byte[] (16 bytes, the binary form), or a string.
     * Normalise all three.
     */
    private UUID convertToUuid(Object result) {
        if (result == null) return null;
        if (result instanceof UUID u) return u;
        if (result instanceof byte[] b) {
            ByteBuffer bb = ByteBuffer.wrap(b);
            long high = bb.getLong();
            long low = bb.getLong();
            return new UUID(high, low);
        }
        return UUID.fromString(result.toString());
    }
}
