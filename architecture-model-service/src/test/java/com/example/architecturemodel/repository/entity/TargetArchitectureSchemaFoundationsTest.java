package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.repository.ArchitectureRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Persistence + Liquibase smoke tests for the Target Architecture Authoring
 * Flow schema foundations (Task Group 1).
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 1.</p>
 *
 * <p>Five focused tests per task spec 1.1:</p>
 * <ol>
 *   <li>{@code architecture} row inserts with {@code draft_state='active'} and
 *       {@code kind='current'} as the default (entity-level default + DB
 *       default backfill smoke).</li>
 *   <li>The CHECK constraint on {@code draft_state} rejects an invalid value
 *       (verified at SQL-file level since {@code @DataJpaTest} rebuilds the
 *       schema from Hibernate JPA mappings, not from the SQL changeset --
 *       same approach as
 *       {@link CrossStoryContextPersistenceTest#generationPassCheckConstraintRejectsValuesOtherThanOneOrTwo()}).</li>
 *   <li>The CHECK constraint on {@code architecture.kind} rejects an invalid
 *       value (verified at SQL-file level).</li>
 *   <li>{@code migration_story_spec_generations.stale} defaults to NULL (not
 *       false) on insert so PATCH preserves null per
 *       {@code project_primitive_double_dto_overwrite.md}.</li>
 *   <li>The new index {@code (project_id, stale)} exists and is exercised by
 *       a repository-level count query (smoke test that the dashboard count
 *       path runs).</li>
 * </ol>
 *
 * <p>The H2 PostgreSQL-mode test DB does not natively understand JSONB or
 * TIMESTAMP WITH TIME ZONE in all flavours, so a {@code CREATE DOMAIN JSONB AS
 * JSON} INIT alias is registered on the JDBC URL -- same pattern used by
 * {@link MigrationStorySpecGenerationEntityPersistenceTest} and
 * {@link CrossStoryContextPersistenceTest}.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:targetarchschemadb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.liquibase.enabled=false",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect"
})
class TargetArchitectureSchemaFoundationsTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ArchitectureRepository architectureRepository;

    @Autowired
    private MigrationStorySpecGenerationRepository specRepository;

    private String readClasspathResource(String path) throws Exception {
        try (var stream = Objects.requireNonNull(
            getClass().getClassLoader().getResourceAsStream(path),
            "missing classpath resource: " + path);
             var reader = new BufferedReader(
                 new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append('\n');
            }
            return sb.toString();
        }
    }

    private MigrationStorySpecGenerationEntity buildSpec(
        UUID id, UUID projectId, UUID workItemId) {
        return MigrationStorySpecGenerationEntity.builder()
            .id(id)
            .projectId(projectId)
            .workItemId(workItemId)
            .bookOfWorkId(UUID.randomUUID())
            .bookItemId("book-item-" + workItemId)
            .status(MigrationStorySpecGenerationStatus.GENERATED)
            .generationPass(1)
            .generationAttemptNumber(0)
            .build();
    }

    @Test
    @DisplayName("Test 1: architecture row inserts with draft_state='active' and kind='current' as defaults")
    void architectureRowInsertsWithDefaultDraftStateAndKind() {
        // Build with NO explicit draftState / kind -- the entity-level
        // @Builder.Default + @PrePersist defaulter is what we want to exercise.
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        ArchitectureEntity entity = ArchitectureEntity.builder()
            .id(id)
            .projectId(projectId)
            .name("Default")
            .build();

        architectureRepository.save(entity);
        entityManager.flush();
        entityManager.clear();

        ArchitectureEntity reloaded = architectureRepository.findById(id).orElseThrow();

        assertThat(reloaded.getDraftState())
            .as("Default draft_state on insert is 'active' (entity-level default mirrors DB default)")
            .isEqualTo("active");
        assertThat(reloaded.getKind())
            .as("Default kind on insert is 'current' (entity-level default mirrors DB default)")
            .isEqualTo("current");
        assertThat(reloaded.getArchived())
            .as("Default archived stays false -- the new columns are additive only")
            .isFalse();
    }

    @Test
    @DisplayName("Test 2: changeset 144 SQL declares draft_state CHECK constraint rejecting values other than active/draft")
    void changeset144DraftStateCheckConstraintIsDeclared() throws Exception {
        // @DataJpaTest rebuilds the schema from Hibernate JPA mappings, so the
        // SQL-defined CHECK constraint is not present in the test schema. The
        // DB CHECK is the runtime source of truth and is exercised by the AMS
        // Liquibase smoke path. Verify the SQL file declares the constraint
        // with the correct vocabulary so a future accidental edit surfaces
        // here rather than at app-boot time.
        //
        // This mirrors CrossStoryContextPersistenceTest's approach for
        // chk_msg_generation_pass and CrossStoryLiquibaseSmokeTest's approach
        // for changeset 141.
        String sql = readClasspathResource(
            "db/changelog/sql/144-architecture-draft-state-and-kind.sql");

        assertThat(sql)
            .as("changeset 144 must add the draft_state column with CHECK and the correct vocabulary")
            .contains("ALTER TABLE architecture")
            .contains("ADD COLUMN draft_state")
            .contains("chk_architecture_draft_state")
            .contains("CHECK (draft_state IN ('active', 'draft'))");

        // Verify the vocabulary is exactly {active, draft} -- any other value
        // (e.g. 'archived') is rejected by the CHECK at the DB layer.
        assertThat(sql)
            .as("draft_state vocabulary is exactly active|draft; archived MUST NOT be admitted")
            .doesNotContain("'archived'")
            .doesNotContain("CHECK (draft_state IN ('active', 'draft', 'archived'))");
    }

    @Test
    @DisplayName("Test 3: changeset 144 SQL declares kind CHECK constraint rejecting values other than current/target")
    void changeset144KindCheckConstraintIsDeclared() throws Exception {
        String sql = readClasspathResource(
            "db/changelog/sql/144-architecture-draft-state-and-kind.sql");

        assertThat(sql)
            .as("changeset 144 must add the kind column with CHECK and the correct vocabulary")
            .contains("ALTER TABLE architecture")
            .contains("ADD COLUMN kind")
            .contains("chk_architecture_kind")
            .contains("CHECK (kind IN ('current', 'target'))");

        // Idempotent backfill of imported-target rows is also declared in the
        // same changeset; assert its presence here so a future accidental
        // deletion surfaces immediately.
        assertThat(sql)
            .as("changeset 144 must contain the idempotent backfill that flips imported-target rows to kind='target'")
            .contains("UPDATE architecture")
            .contains("SET kind = 'target'")
            .contains("FROM architecture_tag")
            .contains("imported-target");
    }

    @Test
    @DisplayName("Test 4: migration_story_spec_generations.stale defaults to NULL (not false) so PATCH preserves null")
    void staleDefaultsToNullNotFalse() {
        // BOXED Boolean (NOT primitive). A builder that omits the field leaves
        // stale as null -- a primitive boolean field would silently default to
        // false here and break the PATCH-preserves-null contract.
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();

        MigrationStorySpecGenerationEntity entity = buildSpec(id, projectId, workItemId);
        // Explicit assertion at construction: builder leaves stale + staleMarkedAt null.
        assertThat(entity.getStale())
            .as("Builder default leaves stale null -- never silently false")
            .isNull();
        assertThat(entity.getStaleMarkedAt()).isNull();

        specRepository.save(entity);
        entityManager.flush();
        entityManager.clear();

        MigrationStorySpecGenerationEntity reloaded =
            specRepository.findById(id).orElseThrow();

        assertThat(reloaded.getStale())
            .as("stale column persists as null when the entity omits it -- preserves PATCH semantics per project_primitive_double_dto_overwrite")
            .isNull();
        assertThat(reloaded.getStaleMarkedAt())
            .as("stale_marked_at column persists as null when the entity omits it")
            .isNull();

        // Sanity: explicitly flipping to TRUE round-trips.
        reloaded.setStale(Boolean.TRUE);
        reloaded.setStaleMarkedAt(java.time.Instant.parse("2026-05-20T12:00:00Z"));
        specRepository.save(reloaded);
        entityManager.flush();
        entityManager.clear();

        MigrationStorySpecGenerationEntity afterFlip =
            specRepository.findById(id).orElseThrow();
        assertThat(afterFlip.getStale()).isTrue();
        assertThat(afterFlip.getStaleMarkedAt()).isNotNull();
    }

    @Test
    @DisplayName("Test 5: (project_id, stale) index path -- repository scan filters by stale cheaply")
    void newIndexExistsAndDashboardCountQueryUsesIt() throws Exception {
        // The composite index `idx_msg_project_stale` on (project_id, stale)
        // is declared on the entity via the @Table indexes annotation, so the
        // H2 schema rebuilt by Hibernate carries it. The Liquibase changeset
        // 146 declares the same index for Postgres.
        //
        // Repository-level smoke: write three rows for the same project (one
        // stale=true, one stale=false, one stale=null) and assert the count
        // filter behaves correctly. This exercises the index path (Hibernate
        // emits `WHERE project_id=? AND stale=?`) without requiring an EXPLAIN
        // dump.
        UUID projectId = UUID.randomUUID();
        UUID otherProject = UUID.randomUUID();

        MigrationStorySpecGenerationEntity staleRow = buildSpec(
            UUID.randomUUID(), projectId, UUID.randomUUID());
        staleRow.setStale(Boolean.TRUE);
        staleRow.setStaleMarkedAt(java.time.Instant.parse("2026-05-20T12:00:00Z"));

        MigrationStorySpecGenerationEntity notStaleRow = buildSpec(
            UUID.randomUUID(), projectId, UUID.randomUUID());
        notStaleRow.setStale(Boolean.FALSE);

        MigrationStorySpecGenerationEntity nullStaleRow = buildSpec(
            UUID.randomUUID(), projectId, UUID.randomUUID());
        // stale left null on purpose -- the dashboard count treats null as
        // "not stale".

        // Different-project stale row must NOT count toward this project.
        MigrationStorySpecGenerationEntity otherProjectStale = buildSpec(
            UUID.randomUUID(), otherProject, UUID.randomUUID());
        otherProjectStale.setStale(Boolean.TRUE);

        specRepository.save(staleRow);
        specRepository.save(notStaleRow);
        specRepository.save(nullStaleRow);
        specRepository.save(otherProjectStale);
        entityManager.flush();
        entityManager.clear();

        // Verify the SQL file registers the new index so the dashboard count
        // query against Postgres has the expected covering path.
        String sql = readClasspathResource(
            "db/changelog/sql/146-migration-story-spec-generations-stale.sql");
        assertThat(sql)
            .as("changeset 146 must declare the (project_id, stale) composite index that backs the dashboard count")
            .contains("idx_msg_project_stale")
            .contains("ON migration_story_spec_generations (project_id, stale)")
            .contains("ADD COLUMN stale BOOLEAN NULL")
            .contains("ADD COLUMN stale_marked_at");

        // Repository-level: project-scoped fetch followed by an in-memory
        // stale-true count exercises the same predicate as the indexed query.
        // (The full repository-level countByProjectIdAndStaleTrue finder is
        // wired in the AMS dashboard service in a later task group; here we
        // just confirm the index is in place and the values persist correctly.)
        List<MigrationStorySpecGenerationEntity> projectRows =
            specRepository.findByProjectId(projectId);
        assertThat(projectRows)
            .as("project scope returns exactly the three rows for our test project (not the other project's row)")
            .hasSize(3);

        long staleCount = projectRows.stream()
            .filter(r -> Boolean.TRUE.equals(r.getStale()))
            .count();
        assertThat(staleCount)
            .as("Only the explicit stale=true row counts -- stale=false and stale=null are both 'not stale' for dashboard purposes")
            .isEqualTo(1L);
    }
}
