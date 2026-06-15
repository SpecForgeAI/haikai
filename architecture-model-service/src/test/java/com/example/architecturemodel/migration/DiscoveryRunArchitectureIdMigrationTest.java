package com.example.architecturemodel.migration;

import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ProjectRepository;
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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Critical Liquibase integration test for the discovery_run architecture_id
 * backfill (changesets 093 / 094 / 095) — Spec #4 Task Group 1 (Task 1.1).
 *
 * Test environment limitations & strategy:
 * - The test profile uses H2 with `liquibase.enabled=false` and Hibernate
 *   `ddl-auto=create-drop`, so the actual SQL changesets do NOT execute.
 *   Hibernate would generate the schema from JPA entity annotations, but the
 *   `discovery_run` table cannot be auto-created in H2 because it has JSONB
 *   columns (`config_snapshot`, `steps_payload`) that H2's PostgreSQL-compat
 *   mode does not understand. Hibernate logs a warning and skips the table.
 * - To validate the migration's logical behaviour end-to-end, this test:
 *     1. Manually creates a minimal `discovery_run` table via raw DDL
 *        (mirroring changeset 065's column shape, omitting the JSONB columns
 *        which are not relevant to the architecture_id backfill).
 *     2. Adds the `architecture_id` column to that table (simulating
 *        changeset 093).
 *     3. Seeds a fixture project + at least 2 pre-existing `discovery_run`
 *        rows with NULL architecture_id (simulating the post-093 state).
 *     4. Simulates changeset 088 (insert Default architecture) and 094
 *        (UPDATE discovery_run SET architecture_id = project_id) verbatim
 *        via native queries against the EntityManager.
 *     5. Asserts the four required properties (a1)-(a4) below.
 *     6. Re-runs steps 4 and verifies idempotency.
 *
 * The four assertions cover the safety property (a) called out in the spec:
 *   (a1) Every existing discovery_run row has non-null architecture_id after migration.
 *   (a2) Every backfilled row has architecture_id == project_id (deterministic Default rule).
 *   (a3) Per-table row counts unchanged before vs after.
 *   (a4) Re-running the migration is a no-op (idempotency).
 *
 * Spec: Discovery Service architectureId Integration (Spec #4)
 * Task Group 1: Liquibase changesets 093/094/095 + DiscoveryRunEntity field
 */
@DataJpaTest
@ActiveProfiles("test")
class DiscoveryRunArchitectureIdMigrationTest {

    @Autowired
    private TestEntityManager testEntityManager;

    @PersistenceContext
    private EntityManager entityManager;

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private ArchitectureRepository architectureRepository;

    private UUID projectId;
    private UUID runId1;
    private UUID runId2;

    @BeforeEach
    void setUp() {
        // Drop+create a minimal discovery_run table that omits the JSONB columns
        // (they're irrelevant to the architecture_id backfill and would prevent
        // table creation in H2). Mirrors changeset 065 + 093 shape.
        entityManager.createNativeQuery("DROP TABLE IF EXISTS discovery_run").executeUpdate();
        entityManager.createNativeQuery(
            "CREATE TABLE discovery_run (" +
            "  id UUID PRIMARY KEY," +
            "  project_id UUID NOT NULL," +
            "  architecture_id UUID NULL," +
            "  status VARCHAR(255) NOT NULL DEFAULT 'PENDING'," +
            "  current_step VARCHAR(255)," +
            "  error_message VARCHAR(255)," +
            "  created_at TIMESTAMP NOT NULL," +
            "  updated_at TIMESTAMP NOT NULL" +
            ")"
        ).executeUpdate();

        // Seed fixture project (project.id must equal the deterministic Default
        // architecture id created by changeset 088).
        projectId = UUID.randomUUID();
        ProjectEntity project = ProjectEntity.builder()
            .id(projectId)
            .name("test-project-" + projectId)
            .projectParentFolder("/tmp/test")
            .isActive(false)
            .createdAt(Instant.parse("2026-01-01T00:00:00Z"))
            .updatedAt(Instant.parse("2026-01-01T00:00:00Z"))
            .build();
        projectRepository.save(project);

        // Seed two pre-existing discovery_run rows with NULL architecture_id
        // (simulating the post-093 pre-094 state).
        runId1 = UUID.randomUUID();
        runId2 = UUID.randomUUID();
        insertDiscoveryRun(runId1, projectId, "COMPLETED");
        insertDiscoveryRun(runId2, projectId, "FAILED");

        testEntityManager.flush();
        testEntityManager.clear();
    }

    /**
     * The single comprehensive test that asserts all four assertions
     * (a1)-(a4) for the spec #4 backfill, on a seeded fixture, against a
     * simulated execution of changesets 088 and 094.
     */
    @Test
    @DisplayName("discovery_run architecture_id backfill is zero-data-loss + idempotent: every row gets architecture_id = project_id; row counts unchanged; re-run is a no-op")
    void testBackfillZeroDataLossAndIdempotency() {
        // -----------------------------------------------------------------
        // PRE-CONDITION: simulated post-093 state (column exists, values null)
        // -----------------------------------------------------------------
        long discoveryRunsBefore = countDiscoveryRuns();
        long projectsBefore = projectRepository.count();

        assertThat(discoveryRunsBefore).isEqualTo(2);
        assertThat(projectsBefore).isEqualTo(1);
        assertThat(architectureRepository.count()).isEqualTo(0);
        assertThat(countNullArchitectureIds()).isEqualTo(2);

        // -----------------------------------------------------------------
        // FIRST RUN: simulate changesets 088 (Default arch) + 094 (backfill)
        // -----------------------------------------------------------------
        runMigrationStep088InsertDefaults();
        runMigrationStep094Backfill();
        testEntityManager.flush();
        testEntityManager.clear();

        // -----------------------------------------------------------------
        // SETUP: confirm the project's Default architecture exists with
        // the deterministic id = project.id.
        // -----------------------------------------------------------------
        assertThat(architectureRepository.count()).isEqualTo(1);
        ArchitectureEntity defaultArch =
            architectureRepository.findByProjectIdOrderByCreatedAtAsc(projectId).get(0);
        assertThat(defaultArch.getName()).isEqualTo("Default");
        assertThat(defaultArch.getId())
            .as("Default architecture id must equal project.id (spec #1 deterministic rule)")
            .isEqualTo(projectId);

        // -----------------------------------------------------------------
        // ASSERTION (a1): Every discovery_run row has non-null architecture_id.
        // -----------------------------------------------------------------
        assertThat(countNullArchitectureIds())
            .as("no discovery_run row should have a null architecture_id after backfill")
            .isEqualTo(0);

        // -----------------------------------------------------------------
        // ASSERTION (a2): Every backfilled row has architecture_id == project_id
        // (deterministic Default rule -- spec #1 changeset 088).
        // -----------------------------------------------------------------
        UUID resolvedArchOnRun1 = readArchitectureId(runId1);
        UUID resolvedArchOnRun2 = readArchitectureId(runId2);
        assertThat(resolvedArchOnRun1)
            .as("run 1 architecture_id should equal project_id (and the Default's id)")
            .isEqualTo(projectId)
            .isEqualTo(defaultArch.getId());
        assertThat(resolvedArchOnRun2)
            .as("run 2 architecture_id should equal project_id (and the Default's id)")
            .isEqualTo(projectId)
            .isEqualTo(defaultArch.getId());

        // -----------------------------------------------------------------
        // ASSERTION (a3): Per-table row counts unchanged.
        // -----------------------------------------------------------------
        assertThat(countDiscoveryRuns()).isEqualTo(discoveryRunsBefore);
        assertThat(projectRepository.count()).isEqualTo(projectsBefore);

        // -----------------------------------------------------------------
        // SECOND RUN: re-execute the SAME migration steps. Should be a no-op.
        // -----------------------------------------------------------------
        long archCountBeforeRerun = architectureRepository.count();

        runMigrationStep088InsertDefaults();
        runMigrationStep094Backfill();
        testEntityManager.flush();
        testEntityManager.clear();

        // -----------------------------------------------------------------
        // ASSERTION (a4): Idempotency -- counts and architecture row unchanged.
        // -----------------------------------------------------------------
        assertThat(architectureRepository.count())
            .as("architecture row count must not change on re-run")
            .isEqualTo(archCountBeforeRerun);
        assertThat(countDiscoveryRuns()).isEqualTo(discoveryRunsBefore);
        assertThat(projectRepository.count()).isEqualTo(projectsBefore);

        ArchitectureEntity defaultArchAfter =
            architectureRepository.findByProjectIdOrderByCreatedAtAsc(projectId).get(0);
        assertThat(defaultArchAfter.getId()).isEqualTo(defaultArch.getId());
        assertThat(defaultArchAfter.getName()).isEqualTo("Default");

        // Backfilled architecture_ids are still populated and unchanged.
        assertThat(countNullArchitectureIds()).isEqualTo(0);
        assertThat(readArchitectureId(runId1)).isEqualTo(defaultArch.getId());
        assertThat(readArchitectureId(runId2)).isEqualTo(defaultArch.getId());
    }

    // ========================================================================
    // Migration step simulators -- mirror the SQL in changesets 088 and 094
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
     * Mirrors changeset 094: backfill discovery_run.architecture_id from
     * project_id (deterministic Default rule). Idempotent via
     * WHERE architecture_id IS NULL.
     */
    private void runMigrationStep094Backfill() {
        entityManager.createNativeQuery(
            "UPDATE discovery_run SET architecture_id = project_id " +
            "WHERE architecture_id IS NULL"
        ).executeUpdate();
    }

    // ========================================================================
    // Test helpers
    // ========================================================================

    private void insertDiscoveryRun(UUID id, UUID projectIdValue, String status) {
        entityManager.createNativeQuery(
            "INSERT INTO discovery_run (id, project_id, architecture_id, status, created_at, updated_at) " +
            "VALUES ('" + id + "', '" + projectIdValue + "', NULL, '" + status + "', " +
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ).executeUpdate();
    }

    private long countDiscoveryRuns() {
        Object result = entityManager.createNativeQuery(
            "SELECT COUNT(*) FROM discovery_run"
        ).getSingleResult();
        return ((Number) result).longValue();
    }

    private long countNullArchitectureIds() {
        Object result = entityManager.createNativeQuery(
            "SELECT COUNT(*) FROM discovery_run WHERE architecture_id IS NULL"
        ).getSingleResult();
        return ((Number) result).longValue();
    }

    private UUID readArchitectureId(UUID runId) {
        Object result = entityManager.createNativeQuery(
            "SELECT architecture_id FROM discovery_run WHERE id = '" + runId.toString() + "'"
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
