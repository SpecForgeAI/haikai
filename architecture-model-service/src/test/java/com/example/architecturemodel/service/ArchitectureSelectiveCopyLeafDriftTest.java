package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.SelectiveCopyCommitRequest;
import com.example.architecturemodel.model.dto.SelectiveCopyCommitResponse;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightRequest;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightResponse;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ModelFileRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration test for {@link ArchitectureSelectiveCopyService} verifying
 * the parent-chain READ path. Seeds source architecture A and target T
 * (plus a third "decoy" architecture C used purely as the leaf-drift
 * destination), inserts in-scope rows whose {@code model_file_id} points
 * at A's model file but whose leaf {@code architecture_id} column has
 * been deliberately UPDATEd to C's id via raw SQL.
 *
 * <p>Each test asserts:</p>
 * <ol>
 *   <li><b>Preflight</b> from A surfaces the drifted rows (today's master
 *       behaviour would silently skip them because the legacy
 *       {@code WHERE architecture_id = ?} predicate trusts the leaf).</li>
 *   <li><b>Commit</b> from A to T copies the drifted rows verbatim;
 *       target rows exist; the newly-copied target rows have leaf
 *       {@code architecture_id = T.id} (write path still sets the leaf
 *       explicitly).</li>
 * </ol>
 *
 * <p>Spec: 2026-05-22-architecture-scope-via-parent-not-leaf — Task Group 3.</p>
 */
@SpringBootTest
@TestPropertySource(properties = {
    "app.data-entity-points.startup-ensure=false"
})
class ArchitectureSelectiveCopyLeafDriftTest {

    @Autowired
    private ArchitectureSelectiveCopyService selectiveCopyService;

    @Autowired
    private ArchitectureRepository architectureRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private UUID projectId;
    private UUID archA;       // source
    private UUID archT;       // target
    private UUID archDecoy;   // drift destination (irrelevant to copy)
    private String mfA;
    private String mfT;

    @BeforeEach
    void setUp() {
        projectId = UUID.randomUUID();
        archA = UUID.randomUUID();
        archT = UUID.randomUUID();
        archDecoy = UUID.randomUUID();

        seedArchitecture(archA, "Source A");
        seedArchitecture(archT, "Target T");
        seedArchitecture(archDecoy, "Decoy C (drift destination)");

        mfA = newModelFile(archA);
        mfT = newModelFile(archT);

        // H2 JPA-create-drop does not add architecture_id to tables whose
        // entity does not declare the field. Mirror the production Liquibase
        // 089 column for the tables this test exercises.
        ensureArchitectureIdColumn("applications");
        ensureArchitectureIdColumn("logical_data_entities");

        // The integration test's same-id-in-different-arch scenario needs a
        // composite (id, architecture_id) PK so the verbatim INSERT into the
        // target architecture is not rejected by the global single-column
        // PK that H2 inherits from JPA's @Id annotation. Mirrors the pattern
        // in ArchitectureSelectiveCopyIntegrationTest. Production schema is
        // unchanged (global PK enforced).
        relaxToCompositePrimaryKey("applications");
        relaxToCompositePrimaryKey("logical_data_entities");
    }

    @AfterEach
    void tearDown() {
        safeDelete("logical_data_entities");
        safeDelete("applications");
        safeDelete("model_files");
        safeDelete("architecture_tag");
        safeDelete("architecture");
    }

    /**
     * Test 1: Preflight from A surfaces drifted rows.
     *
     * <p>Seeds one application and one logical_data_entity, both whose
     * model_file_id points at A but whose leaf architecture_id has been
     * deliberately set to the decoy architecture. The user ticks both ids
     * in the picker; preflight must locate them in source via the parent
     * chain.</p>
     */
    @Test
    @DisplayName("preflight from A surfaces rows whose leaf architecture_id has drifted")
    void preflightSurfacesDriftedRows() {
        UUID appId = UUID.randomUUID();
        insertApplicationWithDrift(appId, mfA, "Drifted App");

        UUID ldeId = UUID.randomUUID();
        insertLogicalDataEntityWithDrift(ldeId, mfA, "Drifted LDE");

        SelectiveCopyPreflightResponse response = selectiveCopyService.preflight(
            projectId,
            archT,
            new SelectiveCopyPreflightRequest(archA, List.of(appId, ldeId)));

        // No conflicts (target is empty).
        assertThat(response.conflicts())
            .as("target is empty so no same_uuid conflicts")
            .isEmpty();
        // Summary should reflect both ids as selected.
        assertThat(response.summary().totalSelected())
            .as("both drifted ids must be recognised as resolvable in source")
            .isEqualTo(2);
    }

    /**
     * Test 2: Commit from A to T copies the drifted rows verbatim. Asserts
     * the target rows exist post-commit AND their leaf architecture_id is
     * set to T (the write path still sets the leaf explicitly even though
     * no reader trusts it).
     */
    @Test
    @DisplayName("commit copies drifted rows; new target rows carry leaf architecture_id = target id")
    void commitCopiesDriftedRowsAndSetsTargetLeaf() {
        UUID appId = UUID.randomUUID();
        insertApplicationWithDrift(appId, mfA, "Drifted App");

        UUID ldeId = UUID.randomUUID();
        insertLogicalDataEntityWithDrift(ldeId, mfA, "Drifted LDE");

        SelectiveCopyCommitResponse result = selectiveCopyService.commit(
            projectId,
            archT,
            new SelectiveCopyCommitRequest(
                archA,
                List.of(appId, ldeId),
                List.of()));

        // Both rows verbatim-copied (no conflicts -> all are inserts).
        assertThat(result.copied())
            .as("both drifted rows should land in the target")
            .isEqualTo(2);
        assertThat(result.skipped()).isEqualTo(0);

        // Target row exists. Use (id, architecture_id) to disambiguate from
        // the source row (composite PK is in place for the test fixture).
        Map<String, Object> targetApp = jdbcTemplate.queryForMap(
            "SELECT name, model_file_id, architecture_id FROM applications "
                + "WHERE id = ? AND architecture_id = ?",
            appId.toString(), archT);
        assertThat(targetApp.get("name")).isEqualTo("Drifted App");
        // Write path sets leaf architecture_id to target architecture explicitly.
        assertThat(targetApp.get("architecture_id"))
            .as("newly-copied row's leaf architecture_id must equal target id")
            .isEqualTo(archT);

        // The new target row's model_file_id must be on target T's model file
        // OR (in the simple case) on the source's mf, but spec demands FK
        // rewiring of in-scope FKs. model_files is in-scope so it should be
        // rewired to T's model file — but only if T's model file was in the
        // ticked set. In this test the user did not tick mf, so the copy
        // uses the source mf-id verbatim BUT remember the leaf architecture_id
        // is overridden to target's, which is enough to confirm the write-path
        // behaviour. (FK-rewiring of model_files specifically is exercised by
        // ArchitectureSelectiveCopyIntegrationTest -- not the focus here.)
    }

    /**
     * Test 3: Preflight from T (the target arch) does NOT surface rows
     * whose only association with T is via the drifted leaf column.
     *
     * <p>Defensive cousin of Test 1 — proves the resolver-based read path
     * is also the GATE for what's considered "in" an architecture, not
     * just what surfaces in a copy out of it.</p>
     */
    @Test
    @DisplayName("preflight from drifted arch does NOT surface rows whose only tie is the leaf column")
    void preflightFromDriftDestinationDoesNotSurfaceLeafBoundRows() {
        UUID appId = UUID.randomUUID();
        // Insert with model_file_id -> mfA and leaf drifted to archDecoy.
        insertApplicationWithDrift(appId, mfA, "Drifted App");

        // Try preflight FROM the decoy arch (the drift destination) -- the
        // row should NOT be locatable there because the parent chain says
        // it belongs to A.
        SelectiveCopyPreflightRequest req =
            new SelectiveCopyPreflightRequest(archDecoy, List.of(appId));
        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                selectiveCopyService.preflight(projectId, archT, req))
            .as("preflight must NOT locate a drifted-leaf-only row under the decoy architecture")
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining(appId.toString());
    }

    // ------------------------------------------------------------------
    // Seed + helper plumbing
    // ------------------------------------------------------------------

    private void insertApplicationWithDrift(UUID id, String modelFileId, String name) {
        jdbcTemplate.update(
            "INSERT INTO applications (id, model_file_id, name, abbreviation, architecture_id) "
                + "VALUES (?, ?, ?, ?, ?)",
            id.toString(), modelFileId, name, "DA", archA);
        // Drift the leaf column to the decoy architecture.
        jdbcTemplate.update(
            "UPDATE applications SET architecture_id = ? WHERE id = ?",
            archDecoy, id.toString());
    }

    private void insertLogicalDataEntityWithDrift(UUID id, String modelFileId, String name) {
        jdbcTemplate.update(
            "INSERT INTO logical_data_entities (id, model_file_id, name, architecture_id) "
                + "VALUES (?, ?, ?, ?)",
            id.toString(), modelFileId, name, archA);
        jdbcTemplate.update(
            "UPDATE logical_data_entities SET architecture_id = ? WHERE id = ?",
            archDecoy, id.toString());
    }

    private void seedArchitecture(UUID id, String name) {
        ArchitectureEntity arch = ArchitectureEntity.builder()
            .id(id)
            .projectId(projectId)
            .name(name)
            .archived(false)
            .build();
        architectureRepository.save(arch);
    }

    private String newModelFile(UUID architectureId) {
        String mfId = "mf-" + UUID.randomUUID();
        modelFileRepository.save(ModelFileEntity.builder()
            .id(mfId)
            .filename("mf-" + UUID.randomUUID())
            .description("Test model file")
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .isDefault(false)
            .projectId(projectId)
            .architectureId(architectureId)
            .build());
        return mfId;
    }

    /**
     * Drops the table's single-column primary key on {@code id} and replaces
     * it with a composite {@code (id, architecture_id)} primary key, so two
     * architectures can hold rows with the same {@code id} value (the
     * precondition for the leaf-drift / verbatim-copy scenario). Mirrors
     * {@code ArchitectureSelectiveCopyIntegrationTest#relaxToCompositePrimaryKey}.
     * Idempotent across cached-Spring-context test methods.
     */
    private void relaxToCompositePrimaryKey(String table) {
        try {
            jdbcTemplate.execute(
                "UPDATE " + table + " SET architecture_id = '00000000-0000-0000-0000-000000000000' "
                    + "WHERE architecture_id IS NULL");
            jdbcTemplate.execute(
                "ALTER TABLE " + table + " ALTER COLUMN architecture_id SET NOT NULL");
        } catch (DataAccessException ignored) {
            // Already NOT NULL or the table is empty.
        }
        try {
            String pkName = jdbcTemplate.queryForObject(
                "SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS "
                    + "WHERE TABLE_NAME = ? AND CONSTRAINT_TYPE = 'PRIMARY KEY'",
                String.class, table.toUpperCase());
            if (pkName != null) {
                jdbcTemplate.execute("ALTER TABLE " + table + " DROP CONSTRAINT " + pkName);
            }
        } catch (DataAccessException ignored) {
            // No PK present (already relaxed).
        }
        try {
            jdbcTemplate.execute(
                "ALTER TABLE " + table + " ADD PRIMARY KEY (id, architecture_id)");
        } catch (DataAccessException ignored) {
            // Composite PK already exists.
        }
    }

    private void ensureArchitectureIdColumn(String table) {
        try {
            jdbcTemplate.execute(
                "ALTER TABLE " + table + " ADD COLUMN IF NOT EXISTS architecture_id UUID");
        } catch (DataAccessException e) {
            throw new IllegalStateException(
                "Failed to ensure architecture_id column on " + table + ": " + e.getMessage(), e);
        }
    }

    private void safeDelete(String table) {
        try {
            jdbcTemplate.update("DELETE FROM " + table + " WHERE 1=1");
        } catch (DataAccessException ignored) {
            // Table absent in this H2 fixture variant — fine.
        }
    }
}
