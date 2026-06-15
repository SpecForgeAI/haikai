package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.service.TargetArchitecturePromoteService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * End-to-end integration test for the target-architecture {@code elementCount}
 * aggregation ({@link TargetArchitecturePromoteService#listTargets}), exercising
 * the REAL grouped-count SQL against the H2 schema.
 *
 * <h2>Why this test exists (regression for the Suggest-from-current cascade)</h2>
 *
 * <p>The pre-existing unit test
 * ({@code TargetArchitecturePromoteServiceElementCountTest}) fully MOCKS
 * {@link JdbcTemplate} — it stubs {@code jdbcTemplate.query(...)} to return
 * synthetic rows keyed off the table name in the SQL string. That validates the
 * per-draft aggregation arithmetic, but it can NEVER catch a SQL-vs-schema
 * mismatch: the SQL is never executed against a real schema.</p>
 *
 * <p>The production bug it missed: {@code aggregateElementCounts} issued
 * {@code SELECT architecture_id, COUNT(*) FROM infrastructure_points WHERE
 * architecture_id IN (?) GROUP BY architecture_id}. But
 * {@code infrastructure_points} (added by changesets 098..123, AFTER the
 * changeset-089 {@code architecture_id} rollout) has NO {@code architecture_id}
 * column at all, so the query raised {@code column "architecture_id" does not
 * exist} on PostgreSQL and {@code GET /target-architectures} returned 500. The
 * fix routes the count through the canonical parent chain (JOIN
 * {@code model_files}) via
 * {@code ArchitectureScopeResolver.buildScopedGroupedCountClause}.</p>
 *
 * <p>This test runs the real query against a real schema, so the class of bug
 * (raw architecture-scoped SQL hitting a table that lacks the column) cannot
 * regress silently again — the durable counter to the whack-a-mole loop.</p>
 *
 * <h2>Schema note</h2>
 *
 * <p>The H2 test schema is JPA {@code create-drop} from the entity model. Only
 * entities that declare an {@code architectureId} field get an
 * {@code architecture_id} column; {@code InfrastructurePointEntity} does not, so
 * {@code infrastructure_points} has no such column here — faithfully mirroring
 * production. The test's first assertion proves this directly.</p>
 *
 * <p>{@code InfrastructurePointEntity} carries a Hibernate {@code @Check}
 * (changeset 110's discriminator constraint) that IS applied to the H2 schema,
 * so seeded rows use a CHECK-valid shape: {@code point_kind='ENVIRONMENT'} with
 * {@code environment_id} set and every other typed FK left null. The
 * relationship columns are plain strings (no FK enforced in H2), so arbitrary
 * UUIDs suffice.</p>
 */
@SpringBootTest
@TestPropertySource(properties = {
    // Discovery + data-entity-point startup ensures are noisy and unrelated.
    "app.data-entity-points.startup-ensure=false"
})
class TargetArchitectureElementCountIntegrationTest {

    @Autowired
    private TargetArchitecturePromoteService promoteService;

    @Autowired
    private ArchitectureRepository architectureRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private UUID projectId;

    @BeforeEach
    void setUp() {
        projectId = UUID.randomUUID();
    }

    @AfterEach
    void tearDown() {
        jdbcTemplate.update("DELETE FROM infrastructure_points WHERE 1=1");
        jdbcTemplate.update("DELETE FROM model_files WHERE 1=1");
        try {
            jdbcTemplate.update("DELETE FROM architecture_tag WHERE 1=1");
        } catch (DataAccessException ignored) {
            // architecture_tag may be empty / absent in some profiles.
        }
        jdbcTemplate.update("DELETE FROM architecture WHERE 1=1");
    }

    /**
     * Seeds a target architecture with two {@code infrastructure_points} rows
     * (the model-file-anchored supertype table with NO leaf
     * {@code architecture_id} column) and asserts {@code listTargets} surfaces
     * {@code elementCount == 2} — proving the grouped count now routes through
     * the {@code model_files} parent chain.
     *
     * <p>Running {@code listTargets} also executes the grouped-count query for
     * all four supertype tables (application_components, interfaces,
     * data_entity_points, infrastructure_points). Because
     * {@code aggregateElementCounts} does NOT swallow per-query exceptions, a
     * malformed query for ANY of the four would fail this test — so the test
     * also guards that every one of the four grouped queries is schema-valid.</p>
     */
    @Test
    @DisplayName("listTargets counts model-file-anchored infrastructure_points via the parent chain (no leaf architecture_id)")
    void listTargetsCountsInfrastructurePointsViaParentChain() {
        // ----- Guard: infrastructure_points has NO architecture_id column -----
        // This is the exact schema shape that made the pre-fix leaf-column
        // GROUP BY raise "column architecture_id does not exist" on PostgreSQL.
        // Locking it in documents WHY the parent-chain routing is required.
        assertThatThrownBy(() -> jdbcTemplate.queryForList(
                "SELECT architecture_id FROM infrastructure_points"))
            .isInstanceOf(BadSqlGrammarException.class);

        // ----- Seed a target architecture + model_file -----
        UUID targetArchId = UUID.randomUUID();
        ArchitectureEntity target = ArchitectureEntity.builder()
            .id(targetArchId)
            .projectId(projectId)
            .name("Target State")
            .description("Designed from current")
            .kind("target")
            .draftState("active")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        architectureRepository.save(target);

        String mfId = "mf-" + UUID.randomUUID();
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id(mfId)
            .filename("model-file-" + UUID.randomUUID())
            .description("Target model file")
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .isDefault(false)
            .projectId(projectId)
            .architectureId(targetArchId)
            .build();
        modelFileRepository.save(modelFile);

        // ----- Seed two CHECK-valid infrastructure_points under the model_file -----
        // point_kind='ENVIRONMENT' + environment_id set + all other FKs null.
        // Distinct environment_id values satisfy the per-(model_file_id,
        // environment_id) unique constraint.
        insertEnvironmentPoint(mfId);
        insertEnvironmentPoint(mfId);

        // ----- Act -----
        List<ArchitectureDto> targets = promoteService.listTargets(projectId);

        // ----- Assert -----
        ArchitectureDto dto = targets.stream()
            .filter(t -> targetArchId.equals(t.id()))
            .findFirst()
            .orElseThrow(() -> new AssertionError(
                "listTargets did not return the seeded target architecture"));
        // Both infrastructure_points rows counted via the model_files parent
        // chain; the other three supertype queries ran cleanly and contributed 0.
        assertThat(dto.elementCount()).isEqualTo(2L);
    }

    private void insertEnvironmentPoint(String modelFileId) {
        jdbcTemplate.update(
            "INSERT INTO infrastructure_points (id, model_file_id, point_kind, environment_id) "
                + "VALUES (?, ?, 'ENVIRONMENT', ?)",
            "ip-" + UUID.randomUUID(),
            modelFileId,
            "env-" + UUID.randomUUID());
    }
}
