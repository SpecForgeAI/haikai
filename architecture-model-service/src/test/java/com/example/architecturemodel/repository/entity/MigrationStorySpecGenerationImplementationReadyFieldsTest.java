package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.mapper.MigrationStorySpecGenerationMapper;
import com.example.architecturemodel.model.dto.MigrationStorySpecGenerationDto;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Persistence + mapper round-trip tests for the two new JSONB columns added by
 * Liquibase changeset {@code 181} on {@code migration_story_spec_generations}:
 * {@code structured_tests_json} (the structured unit/functional test pack) and
 * {@code covered_endpoint_ids} (forward-only endpoint-coverage groundwork, D9).
 *
 * <p>Spec: Implementation-Ready Migration Spec Generation (2026-06-14, Spec 1
 * of 4) -- Task Group 1.</p>
 *
 * <p>Mirrors the existing {@link MigrationStorySpecGenerationEntityPersistenceTest}
 * harness exactly (the {@code @DataJpaTest} + H2 PostgreSQL-mode +
 * {@code CREATE DOMAIN JSONB AS JSON} idiom), so JSONB blobs round-trip through
 * persist + reload. The mapper is exercised directly to prove the null-guarded
 * PATCH path holds for the two new fields (the canonical
 * {@code project_primitive_double_dto_overwrite.md} pitfall).</p>
 *
 * <p>Focused tests (3 -- within the 2-8 budget per task 1.1):</p>
 * <ol>
 *   <li>Both new fields persist + reload verbatim (a populated test pack +
 *       non-empty endpoint ids) -- including through the entity -&gt; DTO -&gt;
 *       entity mapper round-trip.</li>
 *   <li>A PATCH (via {@code updateEntityFromDto}) that OMITS both new fields
 *       does NOT wipe the previously-persisted values.</li>
 *   <li>An EMPTY {@code covered_endpoint_ids} array (non-endpoint story)
 *       survives the round-trip as an empty list (distinct from null).</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:mspecgenimplreadydb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class MigrationStorySpecGenerationImplementationReadyFieldsTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private MigrationStorySpecGenerationRepository repository;

    private MigrationStorySpecGenerationEntity buildEntity(
        UUID id, UUID projectId, UUID workItemId, UUID bookOfWorkId, String status) {
        return MigrationStorySpecGenerationEntity.builder()
            .id(id)
            .projectId(projectId)
            .workItemId(workItemId)
            .bookOfWorkId(bookOfWorkId)
            .bookItemId("book-item-" + workItemId)
            .status(status)
            .generationAttemptNumber(0)
            .build();
    }

    private static Map<String, Object> test(String title, String description, String type) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("title", title);
        m.put("description", description);
        m.put("type", type);
        return m;
    }

    @Test
    @DisplayName("structured_tests_json + covered_endpoint_ids round-trip verbatim through persist/reload + mapper")
    void bothNewFieldsRoundTrip() {
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();
        UUID bookOfWorkId = UUID.randomUUID();

        List<Map<String, Object>> structuredTests = List.of(
            test("Account row migrates", "GET /accounts/{id} returns the migrated row verbatim", "functional"),
            test("Mapper preserves balance", "AccountMapper maps the cents balance without rounding", "unit"));
        List<String> coveredEndpointIds = List.of(
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222");

        MigrationStorySpecGenerationEntity entity = buildEntity(
            id, projectId, workItemId, bookOfWorkId,
            MigrationStorySpecGenerationStatus.GENERATED);
        entity.setConfidence("high");
        entity.setGeneratedSpecText("/agent-os:shape-spec migrate accounts endpoint");
        entity.setStructuredTestsJson(structuredTests);
        entity.setCoveredEndpointIds(coveredEndpointIds);

        repository.save(entity);
        entityManager.flush();
        entityManager.clear();

        MigrationStorySpecGenerationEntity reloaded = repository.findById(id).orElseThrow();

        assertThat(reloaded.getStructuredTestsJson())
            .as("structured_tests_json must round-trip the full test pack")
            .hasSize(2);
        assertThat(reloaded.getStructuredTestsJson().get(0))
            .containsEntry("title", "Account row migrates")
            .containsEntry("description", "GET /accounts/{id} returns the migrated row verbatim")
            .containsEntry("type", "functional");
        assertThat(reloaded.getStructuredTestsJson().get(1))
            .containsEntry("type", "unit");
        assertThat(reloaded.getCoveredEndpointIds())
            .as("covered_endpoint_ids must round-trip verbatim")
            .containsExactly(
                "11111111-1111-1111-1111-111111111111",
                "22222222-2222-2222-2222-222222222222");

        // Mapper round-trip: entity -> DTO -> entity preserves both fields.
        MigrationStorySpecGenerationDto dto = MigrationStorySpecGenerationMapper.toDto(reloaded);
        assertThat(dto.structuredTestsJson()).hasSize(2);
        assertThat(dto.coveredEndpointIds()).containsExactly(
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222");

        MigrationStorySpecGenerationEntity rebuilt =
            MigrationStorySpecGenerationMapper.toNewEntity(dto, projectId);
        assertThat(rebuilt.getStructuredTestsJson()).hasSize(2);
        assertThat(rebuilt.getCoveredEndpointIds()).hasSize(2);
    }

    @Test
    @DisplayName("PATCH omitting both new fields does NOT wipe structured_tests_json / covered_endpoint_ids")
    void patchOmittingNewFieldsDoesNotWipe() {
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();

        MigrationStorySpecGenerationEntity persisted = buildEntity(
            id, projectId, workItemId, UUID.randomUUID(),
            MigrationStorySpecGenerationStatus.GENERATED);
        persisted.setStructuredTestsJson(List.of(
            test("Persisted test", "Should survive an unrelated PATCH", "unit")));
        persisted.setCoveredEndpointIds(List.of(
            "33333333-3333-3333-3333-333333333333"));
        persisted.setGeneratedSpecText("/agent-os:shape-spec original body");
        repository.save(persisted);
        entityManager.flush();
        entityManager.clear();

        MigrationStorySpecGenerationEntity loaded = repository.findById(id).orElseThrow();

        // A PATCH DTO that flips ONLY status and OMITS both new fields (null on
        // the wire). The 19-arg back-compat constructor defaults the new
        // fields to null, modelling an omitted-field PATCH exactly.
        MigrationStorySpecGenerationDto patch = new MigrationStorySpecGenerationDto(
            id, projectId, workItemId,
            null, null,
            MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS,
            null, null, null, null, null, null, null, null, null, null, null,
            null, null);
        assertThat(patch.structuredTestsJson()).isNull();
        assertThat(patch.coveredEndpointIds()).isNull();

        MigrationStorySpecGenerationMapper.updateEntityFromDto(loaded, patch);

        repository.save(loaded);
        entityManager.flush();
        entityManager.clear();

        MigrationStorySpecGenerationEntity reloaded = repository.findById(id).orElseThrow();
        assertThat(reloaded.getStatus())
            .isEqualTo(MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS);
        assertThat(reloaded.getStructuredTestsJson())
            .as("structured_tests_json must survive a PATCH that omits the field")
            .isNotNull()
            .hasSize(1);
        assertThat(reloaded.getStructuredTestsJson().get(0))
            .containsEntry("title", "Persisted test");
        assertThat(reloaded.getCoveredEndpointIds())
            .as("covered_endpoint_ids must survive a PATCH that omits the field")
            .containsExactly("33333333-3333-3333-3333-333333333333");
    }

    @Test
    @DisplayName("Empty covered_endpoint_ids array (non-endpoint story) survives the round-trip as empty (not null)")
    void emptyCoveredEndpointIdsRoundTrip() {
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();

        MigrationStorySpecGenerationEntity entity = buildEntity(
            id, projectId, workItemId, UUID.randomUUID(),
            MigrationStorySpecGenerationStatus.GENERATED);
        // Non-endpoint story (e.g. DB schema build): a structured test pack is
        // present but NO endpoints are in scope -> EMPTY array, not null.
        entity.setStructuredTestsJson(List.of(
            test("Schema applies", "Liquibase changeset creates the accounts table", "functional")));
        entity.setCoveredEndpointIds(List.of());

        repository.save(entity);
        entityManager.flush();
        entityManager.clear();

        MigrationStorySpecGenerationEntity reloaded = repository.findById(id).orElseThrow();
        assertThat(reloaded.getCoveredEndpointIds())
            .as("an empty covered_endpoint_ids array must round-trip as empty, not null-collapse")
            .isNotNull()
            .isEmpty();
        assertThat(reloaded.getStructuredTestsJson()).hasSize(1);

        // The DTO surfaces the empty array too (distinct from a never-populated null).
        MigrationStorySpecGenerationDto dto = MigrationStorySpecGenerationMapper.toDto(reloaded);
        assertThat(dto.coveredEndpointIds()).isNotNull().isEmpty();
    }
}
