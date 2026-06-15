package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.dto.SelectiveCopyCommitRequest;
import com.example.architecturemodel.model.dto.SelectiveCopyCommitResponse;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import com.example.architecturemodel.service.ArchitectureSelectiveCopyService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;

import javax.sql.DataSource;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Integration tests for the new {@code autoMap} path on
 * {@link ArchitectureSelectiveCopyService#commit}.
 *
 * <p>Covers Task Group 2.1 acceptance:</p>
 * <ol>
 *   <li>{@code autoMap=true} writes exactly one
 *       {@link ArchitectureElementMappingEntity} per element actually copied,
 *       under the same {@code @Transactional} boundary; defaults are
 *       {@code mapping_type=equivalent}, {@code status=confirmed},
 *       {@code confidence=1.0}, {@code created_by_task=selective-copy-with-auto-map}.</li>
 *   <li>A forced JDBC failure during the copy walk rolls back BOTH the copy
 *       AND any mapping rows already constructed (atomic rollback).</li>
 * </ol>
 *
 * <p>Mirrors the test-fixture scaffolding of
 * {@code ArchitectureSelectiveCopyIntegrationTest} (architecture_id column
 * backfill on H2; throwing JdbcTemplate via TestConfig).</p>
 *
 * <p>Spec: Create Target Baseline from Current State (2026-05-15) -- Task Group 2</p>
 */
@SpringBootTest
@TestPropertySource(properties = {
    "app.data-entity-points.startup-ensure=false"
})
class ArchitectureSelectiveCopyAutoMapIntegrationTest {

    public static class ThrowingJdbcTemplate extends JdbcTemplate {
        public final AtomicReference<RuntimeException> throwOn = new AtomicReference<>();

        public ThrowingJdbcTemplate(DataSource dataSource) {
            super(dataSource);
        }

        @Override
        public int update(String sql, Object... args) throws DataAccessException {
            RuntimeException pending = throwOn.get();
            if (pending != null) {
                throw pending;
            }
            return super.update(sql, args);
        }
    }

    @TestConfiguration
    static class TestConfig {
        @Bean
        @Primary
        public JdbcTemplate testJdbcTemplate(DataSource dataSource) {
            return new ThrowingJdbcTemplate(dataSource);
        }
    }

    @Autowired
    private ArchitectureSelectiveCopyService selectiveCopyService;

    @Autowired
    private ArchitectureRepository architectureRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    @Autowired
    private ArchitectureElementMappingRepository mappingRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private UUID projectId;

    @BeforeEach
    void setUp() {
        projectId = UUID.randomUUID();
        if (jdbcTemplate instanceof ThrowingJdbcTemplate t) {
            t.throwOn.set(null);
        }
        ensureArchitectureIdColumn("applications");
        // applications.id has a global single-column PK on the JPA-generated
        // H2 schema. The selective-copy verbatim-insert path preserves the
        // source id when the target has no row by that id, which collides
        // with the source row already in the table during these tests
        // (both rows share the project + arch_id is the only differentiator
        // we can use). Relax to a composite (id, architecture_id) PK to
        // mirror what ArchitectureSelectiveCopyIntegrationTest does.
        relaxToCompositePrimaryKey("applications");
    }

    @AfterEach
    void tearDown() {
        if (jdbcTemplate instanceof ThrowingJdbcTemplate t) {
            t.throwOn.set(null);
        }
        // Mapping rows MUST be cleaned up between tests so we never see leftovers.
        try {
            jdbcTemplate.update("DELETE FROM architecture_element_mappings WHERE 1=1");
        } catch (DataAccessException ignored) { }
        jdbcTemplate.update("DELETE FROM applications WHERE 1=1");
        jdbcTemplate.update("DELETE FROM model_files WHERE 1=1");
        jdbcTemplate.update("DELETE FROM architecture_tag WHERE 1=1");
        jdbcTemplate.update("DELETE FROM architecture WHERE 1=1");
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

    private void relaxToCompositePrimaryKey(String table) {
        try {
            jdbcTemplate.execute(
                "UPDATE " + table + " SET architecture_id = '00000000-0000-0000-0000-000000000000' "
                    + "WHERE architecture_id IS NULL");
            jdbcTemplate.execute(
                "ALTER TABLE " + table + " ALTER COLUMN architecture_id SET NOT NULL");
        } catch (DataAccessException ignored) { }
        try {
            String pkName = jdbcTemplate.queryForObject(
                "SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS "
                    + "WHERE TABLE_NAME = ? AND CONSTRAINT_TYPE = 'PRIMARY KEY'",
                String.class, table.toUpperCase());
            if (pkName != null) {
                jdbcTemplate.execute("ALTER TABLE " + table + " DROP CONSTRAINT " + pkName);
            }
        } catch (DataAccessException ignored) { }
        try {
            jdbcTemplate.execute(
                "ALTER TABLE " + table + " ADD PRIMARY KEY (id, architecture_id)");
        } catch (DataAccessException ignored) { }
    }

    private void seedArchitecture(UUID id, UUID projectId, String name) {
        architectureRepository.save(ArchitectureEntity.builder()
            .id(id)
            .projectId(projectId)
            .name(name)
            .archived(false)
            .build());
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

    private void insertApplication(String id, String mfId, String name, UUID archId) {
        // applications.abbreviation is NOT NULL on the JPA-generated H2 schema;
        // give every test row a deterministic 3-letter abbreviation derived
        // from its index so the inserts succeed.
        String abbreviation = name.replaceAll("[^A-Za-z]", "")
            .toUpperCase()
            .substring(0, Math.min(3, name.replaceAll("[^A-Za-z]", "").length()));
        if (abbreviation.isEmpty()) {
            abbreviation = "APP";
        }
        jdbcTemplate.update(
            "INSERT INTO applications (id, model_file_id, name, abbreviation, architecture_id) "
                + "VALUES (?, ?, ?, ?, ?)",
            id, mfId, name, abbreviation, archId);
    }

    @Test
    @DisplayName("autoMap=true writes one mapping row per copied element with the auto-map defaults, under the same transaction")
    void commitWithAutoMapWritesMappingRowsAtomically() {
        UUID sourceArchId = UUID.randomUUID();
        UUID targetArchId = UUID.randomUUID();
        seedArchitecture(sourceArchId, projectId, "Source");
        seedArchitecture(targetArchId, projectId, "Target");

        String srcMfId = newModelFile(sourceArchId);

        UUID app1Id = UUID.randomUUID();
        UUID app2Id = UUID.randomUUID();
        insertApplication(app1Id.toString(), srcMfId, "App One", sourceArchId);
        insertApplication(app2Id.toString(), srcMfId, "App Two", sourceArchId);

        // Pre-condition: target has zero mapping rows.
        long mappingsBefore = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM architecture_element_mappings", Long.class);
        assertThat(mappingsBefore).isZero();

        SelectiveCopyCommitResponse response = selectiveCopyService.commit(
            projectId,
            targetArchId,
            new SelectiveCopyCommitRequest(
                sourceArchId,
                List.of(app1Id, app2Id),
                List.of(),
                Boolean.TRUE));

        assertThat(response.copied()).isEqualTo(2);
        assertThat(response.createdMappingCount())
            .as("autoMap=true must produce one mapping row per element actually copied")
            .isEqualTo(2);

        // Verify mapping rows persisted with the documented auto-map defaults.
        List<ArchitectureElementMappingEntity> mappings = mappingRepository
            .findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                projectId, sourceArchId, targetArchId);
        assertThat(mappings).hasSize(2);
        assertThat(mappings)
            .allSatisfy(m -> {
                assertThat(m.getMappingType()).isEqualTo("equivalent");
                assertThat(m.getStatus()).isEqualTo("confirmed");
                assertThat(m.getConfidence()).isEqualTo(1.0);
                assertThat(m.getCreatedByTask()).isEqualTo("selective-copy-with-auto-map");
                assertThat(m.getSourceElementType()).isEqualTo("applications");
                assertThat(m.getTargetElementType()).isEqualTo("applications");
                // Verbatim insert (no conflict) -> source id == target id.
                assertThat(m.getSourceElementId()).isEqualTo(m.getTargetElementId());
            });
        assertThat(mappings)
            .extracting(ArchitectureElementMappingEntity::getSourceElementId)
            .containsExactlyInAnyOrder(app1Id.toString(), app2Id.toString());
    }

    @Test
    @DisplayName("autoMap=false (default) writes zero mapping rows and createdMappingCount is 0")
    void commitWithoutAutoMapWritesNoMappingRows() {
        UUID sourceArchId = UUID.randomUUID();
        UUID targetArchId = UUID.randomUUID();
        seedArchitecture(sourceArchId, projectId, "Source");
        seedArchitecture(targetArchId, projectId, "Target");
        String srcMfId = newModelFile(sourceArchId);
        UUID appId = UUID.randomUUID();
        insertApplication(appId.toString(), srcMfId, "Solo App", sourceArchId);

        SelectiveCopyCommitResponse response = selectiveCopyService.commit(
            projectId,
            targetArchId,
            new SelectiveCopyCommitRequest(
                sourceArchId,
                List.of(appId),
                List.of()));

        assertThat(response.copied()).isEqualTo(1);
        assertThat(response.createdMappingCount())
            .as("autoMap=false (legacy) must NOT write mapping rows")
            .isZero();
        long mappingRowsAfter = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM architecture_element_mappings", Long.class);
        assertThat(mappingRowsAfter).isZero();
    }

    @Test
    @DisplayName("forced mid-commit failure rolls back BOTH the copy and any mapping rows (atomic property)")
    void commitWithAutoMapAtomicRollbackOnFailure() {
        UUID sourceArchId = UUID.randomUUID();
        UUID targetArchId = UUID.randomUUID();
        seedArchitecture(sourceArchId, projectId, "Source Atomic");
        seedArchitecture(targetArchId, projectId, "Target Atomic");
        String srcMfId = newModelFile(sourceArchId);
        UUID appId = UUID.randomUUID();
        insertApplication(appId.toString(), srcMfId, "App Atomic", sourceArchId);

        long applicationsBefore = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM applications", Long.class);
        long mappingsBefore = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM architecture_element_mappings", Long.class);

        // Arm the throwing wrapper so the FIRST commit-time write blows up
        // before any successful row insert reaches the target.
        assertThat(jdbcTemplate)
            .as("test must be wired with the ThrowingJdbcTemplate via TestConfig")
            .isInstanceOf(ThrowingJdbcTemplate.class);
        ThrowingJdbcTemplate throwing = (ThrowingJdbcTemplate) jdbcTemplate;
        throwing.throwOn.set(new RuntimeException("Simulated mid-commit failure"));

        try {
            assertThatThrownBy(() -> selectiveCopyService.commit(
                projectId,
                targetArchId,
                new SelectiveCopyCommitRequest(
                    sourceArchId,
                    List.of(appId),
                    List.of(),
                    Boolean.TRUE)))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Simulated mid-commit failure");
        } finally {
            throwing.throwOn.set(null);
        }

        long applicationsAfter = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM applications", Long.class);
        long mappingsAfter = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM architecture_element_mappings", Long.class);
        assertThat(applicationsAfter)
            .as("atomic property: no new applications row should remain after rollback")
            .isEqualTo(applicationsBefore);
        assertThat(mappingsAfter)
            .as("atomic property: no orphan mapping rows should remain after rollback")
            .isEqualTo(mappingsBefore);
    }
}
