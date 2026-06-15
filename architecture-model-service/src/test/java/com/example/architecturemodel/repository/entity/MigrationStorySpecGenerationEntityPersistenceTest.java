package com.example.architecturemodel.repository.entity;

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
 * Persistence-layer tests for {@link MigrationStorySpecGenerationEntity} and
 * {@link MigrationStorySpecGenerationRepository}, introduced by Liquibase
 * changeset {@code 140}.
 *
 * <p>Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 1.</p>
 *
 * <p>Tests covered (4-6 focused persistence tests per task spec 1.4):</p>
 * <ol>
 *   <li>An entity with all four JSONB columns populated round-trips through
 *       persist + reload (each blob's content matches).</li>
 *   <li>An entity with all four JSONB columns NULL persists and reloads cleanly
 *       (an explicit "first attempt" insert may carry nulls if the LLM /
 *       persistence path leaves them unpopulated).</li>
 *   <li>PATCH semantics: an update touching only {@code status} does NOT wipe
 *       the four JSONB columns NOR reset {@code generation_attempt_number}
 *       (boxed-type + null-guard per
 *       {@code project_primitive_double_dto_overwrite.md}).</li>
 *   <li>{@code findByBookOfWorkId} and {@code findByWorkItemId} repository
 *       finders return only matching rows.</li>
 *   <li>{@code countByBookOfWorkId} and {@code countByBookOfWorkIdAndStatus}
 *       support the summary endpoint's lazy {@code not_attempted} computation
 *       (A-6).</li>
 * </ol>
 *
 * <p>The H2 PostgreSQL-mode test DB does not natively understand JSONB, so a
 * {@code CREATE DOMAIN JSONB AS JSON} INIT alias is registered on the JDBC
 * URL -- same pattern used by {@link GeneratedMigrationBookOfWorkPersistenceTest}
 * and {@link EndpointProtocolMetadataPersistenceTest}.</p>
 *
 * <p>Note on the {@code chk_msg_status} CHECK constraint: that constraint is
 * declared on Liquibase changeset 140 and is the source of truth in production,
 * but {@code @DataJpaTest} rebuilds the schema from Hibernate's JPA mapping
 * (not from the SQL changeset), so CHECK enforcement is exercised by the
 * standard AMS Liquibase smoke path -- not duplicated here. Status validation
 * at the service layer is via
 * {@link MigrationStorySpecGenerationStatus#ALL}.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:mspecgenpersistencedb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class MigrationStorySpecGenerationEntityPersistenceTest {

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
            .confidence(null)
            .predictedReadiness(null)
            .generatedSpecText(null)
            .generationAttemptNumber(0)
            .build();
    }

    @Test
    @DisplayName("Entity with all four JSONB columns populated round-trips through persist + reload")
    void allFourJsonbColumnsRoundTrip() {
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();
        UUID bookOfWorkId = UUID.randomUUID();

        Map<String, Object> warning = new LinkedHashMap<>();
        warning.put("code", "CONFIDENCE_DOWNGRADED");
        warning.put("from", "high");
        warning.put("to", "medium");
        warning.put("missingSignals", List.of("mappings"));

        Map<String, Object> missing = new LinkedHashMap<>();
        missing.put("kind", "mapping");
        missing.put("id", "map-42");
        missing.put("reason", "no mapping found for story scope");

        Map<String, Object> focusedRefs = new LinkedHashMap<>();
        focusedRefs.put("architecture_refs", List.of("arch-current", "arch-target"));
        focusedRefs.put("mapping_refs", List.of("map-1", "map-2"));
        focusedRefs.put("baseline_refs", List.of("baseline-1"));

        MigrationStorySpecGenerationEntity entity = buildEntity(
            id, projectId, workItemId, bookOfWorkId,
            MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS);
        entity.setConfidence("medium");
        entity.setPredictedReadiness("ready");
        entity.setGeneratedSpecText("/agent-os:shape-spec implement service-A migration");
        entity.setWarningsJson(List.of(warning));
        entity.setMissingInputsJson(List.of(missing));
        entity.setFocusedContextRefsJson(focusedRefs);
        entity.setEvidenceRefsJson(List.of("ev-1", "ev-2", "ev-3"));

        repository.save(entity);
        entityManager.flush();
        entityManager.clear();

        MigrationStorySpecGenerationEntity reloaded = repository.findById(id).orElseThrow();

        assertThat(reloaded.getProjectId()).isEqualTo(projectId);
        assertThat(reloaded.getWorkItemId()).isEqualTo(workItemId);
        assertThat(reloaded.getBookOfWorkId()).isEqualTo(bookOfWorkId);
        assertThat(reloaded.getBookItemId()).isEqualTo("book-item-" + workItemId);
        assertThat(reloaded.getStatus()).isEqualTo(MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS);
        assertThat(reloaded.getConfidence()).isEqualTo("medium");
        assertThat(reloaded.getPredictedReadiness()).isEqualTo("ready");
        assertThat(reloaded.getGeneratedSpecText())
            .startsWith("/agent-os:shape-spec");
        assertThat(reloaded.getCreatedByTask())
            .isEqualTo("product-manager--migration-shape-spec-generation");
        assertThat(reloaded.getGenerationAttemptNumber()).isEqualTo(0);

        assertThat(reloaded.getWarningsJson())
            .hasSize(1)
            .first()
            .satisfies(w -> {
                assertThat(w).containsEntry("code", "CONFIDENCE_DOWNGRADED");
                assertThat(w).containsEntry("from", "high");
                assertThat(w).containsEntry("to", "medium");
            });
        assertThat(reloaded.getMissingInputsJson())
            .hasSize(1)
            .first()
            .satisfies(m -> assertThat(m).containsEntry("kind", "mapping"));
        assertThat(reloaded.getFocusedContextRefsJson())
            .containsKey("architecture_refs")
            .containsKey("mapping_refs")
            .containsKey("baseline_refs");
        assertThat(reloaded.getEvidenceRefsJson())
            .containsExactly("ev-1", "ev-2", "ev-3");
    }

    @Test
    @DisplayName("Entity with all four JSONB columns NULL persists and reloads cleanly")
    void allFourJsonbColumnsNullableRoundTrip() {
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();

        MigrationStorySpecGenerationEntity entity = buildEntity(
            id, projectId, workItemId, UUID.randomUUID(),
            MigrationStorySpecGenerationStatus.FAILED);
        entity.setErrorMessage("LLM call timed out after 60s");
        // Leave the four JSONB fields unset -- mirrors a status=failed row.

        repository.save(entity);
        entityManager.flush();
        entityManager.clear();

        MigrationStorySpecGenerationEntity reloaded = repository.findById(id).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(MigrationStorySpecGenerationStatus.FAILED);
        assertThat(reloaded.getErrorMessage()).isEqualTo("LLM call timed out after 60s");
        assertThat(reloaded.getWarningsJson()).isNull();
        assertThat(reloaded.getMissingInputsJson()).isNull();
        assertThat(reloaded.getFocusedContextRefsJson()).isNull();
        assertThat(reloaded.getEvidenceRefsJson()).isNull();
        assertThat(reloaded.getGeneratedSpecText()).isNull();
        assertThat(reloaded.getConfidence()).isNull();
        // generation_attempt_number is NOT NULL with default 0 in the DDL,
        // and the entity initializer also defaults it to 0.
        assertThat(reloaded.getGenerationAttemptNumber()).isEqualTo(0);
    }

    /**
     * PATCH semantics test: when an update touches only {@code status} and
     * leaves the four JSONB DTO fields {@code null} -- AND leaves the boxed
     * {@code generationAttemptNumber} field {@code null} -- the existing
     * column content MUST survive the update untouched.
     *
     * <p>This is the canonical null-guard pattern from
     * {@code project_primitive_double_dto_overwrite.md}. Particularly
     * important for {@code generationAttemptNumber}: if the DTO field were a
     * primitive {@code int}, an omitted JSON property would arrive as
     * {@code 0} and silently reset a previously-bumped attempt counter.
     * Using boxed {@link Integer} + the null-guard below preserves the
     * counter across unrelated PATCHes.</p>
     */
    @Test
    @DisplayName("PATCH touching only status does NOT wipe JSONB columns NOR reset generation_attempt_number")
    void patchOmittedFieldsDoNotWipeColumns() {
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();

        Map<String, Object> originalWarning = new LinkedHashMap<>();
        originalWarning.put("code", "CONFIDENCE_DOWNGRADED");
        originalWarning.put("from", "high");
        originalWarning.put("to", "medium");

        Map<String, Object> originalFocused = new LinkedHashMap<>();
        originalFocused.put("architecture_refs", List.of("arch-1", "arch-2"));

        MigrationStorySpecGenerationEntity persisted = buildEntity(
            id, projectId, workItemId, UUID.randomUUID(),
            MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS);
        persisted.setWarningsJson(List.of(originalWarning));
        persisted.setFocusedContextRefsJson(originalFocused);
        persisted.setEvidenceRefsJson(List.of("ev-1"));
        persisted.setGenerationAttemptNumber(3);  // simulate prior regenerate-all bumps
        persisted.setGeneratedSpecText("/agent-os:shape-spec original spec body");
        persisted.setConfidence("medium");
        repository.save(persisted);
        entityManager.flush();
        entityManager.clear();

        MigrationStorySpecGenerationEntity loaded = repository.findById(id).orElseThrow();

        // Simulate a PATCH-style DTO with only status set, and every other
        // editable field null (omitted on the wire).
        MigrationStorySpecGenerationDto patch = new MigrationStorySpecGenerationDto(
            id,
            projectId,
            workItemId,
            null,  // book_of_work_id omitted
            null,  // book_item_id omitted
            MigrationStorySpecGenerationStatus.FAILED,  // status flip is the ONLY field set
            null,  // confidence omitted
            null,  // predicted_readiness omitted
            null,  // generated_spec_text omitted
            null,  // warnings_json omitted
            null,  // missing_inputs_json omitted
            null,  // focused_context_refs_json omitted
            null,  // evidence_refs_json omitted
            null,  // generated_at omitted
            null,  // error_message omitted
            null,  // generation_attempt_number OMITTED -- must NOT reset to 0
            null,  // created_by_task omitted
            null,  // created_at omitted
            null   // updated_at omitted
        );

        // Null-guard pattern (mirrors MigrationStorySpecGenerationMapper#updateEntityFromDto):
        // only assign each field when present on the DTO.
        if (patch.bookOfWorkId() != null) {
            loaded.setBookOfWorkId(patch.bookOfWorkId());
        }
        if (patch.bookItemId() != null) {
            loaded.setBookItemId(patch.bookItemId());
        }
        if (patch.status() != null) {
            loaded.setStatus(patch.status());
        }
        if (patch.confidence() != null) {
            loaded.setConfidence(patch.confidence());
        }
        if (patch.predictedReadiness() != null) {
            loaded.setPredictedReadiness(patch.predictedReadiness());
        }
        if (patch.generatedSpecText() != null) {
            loaded.setGeneratedSpecText(patch.generatedSpecText());
        }
        if (patch.warningsJson() != null) {
            loaded.setWarningsJson(patch.warningsJson());
        }
        if (patch.missingInputsJson() != null) {
            loaded.setMissingInputsJson(patch.missingInputsJson());
        }
        if (patch.focusedContextRefsJson() != null) {
            loaded.setFocusedContextRefsJson(patch.focusedContextRefsJson());
        }
        if (patch.evidenceRefsJson() != null) {
            loaded.setEvidenceRefsJson(patch.evidenceRefsJson());
        }
        if (patch.errorMessage() != null) {
            loaded.setErrorMessage(patch.errorMessage());
        }
        if (patch.generationAttemptNumber() != null) {
            loaded.setGenerationAttemptNumber(patch.generationAttemptNumber());
        }

        repository.save(loaded);
        entityManager.flush();
        entityManager.clear();

        MigrationStorySpecGenerationEntity reloaded = repository.findById(id).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(MigrationStorySpecGenerationStatus.FAILED);
        // Critical: every JSONB blob, the spec text, the confidence, and the
        // attempt counter survived even though the DTO fields were null on
        // the wire.
        assertThat(reloaded.getWarningsJson())
            .as("warnings_json must survive a PATCH that omits the field")
            .isNotNull()
            .hasSize(1);
        assertThat(reloaded.getFocusedContextRefsJson())
            .as("focused_context_refs_json must survive a PATCH that omits the field")
            .isNotNull()
            .containsKey("architecture_refs");
        assertThat(reloaded.getEvidenceRefsJson())
            .as("evidence_refs_json must survive a PATCH that omits the field")
            .isNotNull()
            .containsExactly("ev-1");
        assertThat(reloaded.getGeneratedSpecText())
            .as("generated_spec_text must survive a PATCH that omits the field")
            .isEqualTo("/agent-os:shape-spec original spec body");
        assertThat(reloaded.getConfidence())
            .as("confidence must survive a PATCH that omits the field")
            .isEqualTo("medium");
        assertThat(reloaded.getGenerationAttemptNumber())
            .as("generation_attempt_number MUST NOT silently reset to 0 -- boxed-type null-guard per project_primitive_double_dto_overwrite.md")
            .isEqualTo(3);
    }

    @Test
    @DisplayName("findByBookOfWorkId and findByWorkItemId return only matching rows")
    void findersReturnOnlyMatchingRows() {
        UUID projectId = UUID.randomUUID();
        UUID bookA = UUID.randomUUID();
        UUID bookB = UUID.randomUUID();
        UUID workItem1 = UUID.randomUUID();
        UUID workItem2 = UUID.randomUUID();
        UUID workItem3 = UUID.randomUUID();

        repository.save(buildEntity(UUID.randomUUID(), projectId, workItem1, bookA,
            MigrationStorySpecGenerationStatus.GENERATED));
        repository.save(buildEntity(UUID.randomUUID(), projectId, workItem2, bookA,
            MigrationStorySpecGenerationStatus.FAILED));
        repository.save(buildEntity(UUID.randomUUID(), projectId, workItem3, bookB,
            MigrationStorySpecGenerationStatus.GENERATED));
        entityManager.flush();
        entityManager.clear();

        List<MigrationStorySpecGenerationEntity> bookAResults =
            repository.findByBookOfWorkId(bookA);
        assertThat(bookAResults).hasSize(2);
        assertThat(bookAResults)
            .allMatch(r -> r.getBookOfWorkId().equals(bookA));

        List<MigrationStorySpecGenerationEntity> bookBResults =
            repository.findByBookOfWorkId(bookB);
        assertThat(bookBResults).hasSize(1);
        assertThat(bookBResults.get(0).getWorkItemId()).isEqualTo(workItem3);

        List<MigrationStorySpecGenerationEntity> wi1Results =
            repository.findByWorkItemId(workItem1);
        assertThat(wi1Results).hasSize(1);
        assertThat(wi1Results.get(0).getStatus())
            .isEqualTo(MigrationStorySpecGenerationStatus.GENERATED);

        List<MigrationStorySpecGenerationEntity> generatedInA =
            repository.findByBookOfWorkIdAndStatusIn(
                bookA, List.of(MigrationStorySpecGenerationStatus.GENERATED));
        assertThat(generatedInA).hasSize(1);
        assertThat(generatedInA.get(0).getWorkItemId()).isEqualTo(workItem1);
    }

    @Test
    @DisplayName("countByBookOfWorkId and countByBookOfWorkIdAndStatus support lazy not_attempted (A-6)")
    void countsSupportLazyNotAttemptedComputation() {
        UUID projectId = UUID.randomUUID();
        UUID bookA = UUID.randomUUID();
        UUID bookB = UUID.randomUUID();

        repository.save(buildEntity(UUID.randomUUID(), projectId, UUID.randomUUID(), bookA,
            MigrationStorySpecGenerationStatus.GENERATED));
        repository.save(buildEntity(UUID.randomUUID(), projectId, UUID.randomUUID(), bookA,
            MigrationStorySpecGenerationStatus.GENERATED));
        repository.save(buildEntity(UUID.randomUUID(), projectId, UUID.randomUUID(), bookA,
            MigrationStorySpecGenerationStatus.FAILED));
        repository.save(buildEntity(UUID.randomUUID(), projectId, UUID.randomUUID(), bookA,
            MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT));
        repository.save(buildEntity(UUID.randomUUID(), projectId, UUID.randomUUID(), bookB,
            MigrationStorySpecGenerationStatus.GENERATED));
        entityManager.flush();
        entityManager.clear();

        // Lazy not_attempted computation per A-6:
        //   notAttempted = totalSavedStoriesInBookOfWorkJson - attempted
        // The repository owes us 'attempted' (rows present) per book.
        long attemptedInA = repository.countByBookOfWorkId(bookA);
        assertThat(attemptedInA)
            .as("attempted-per-book count must equal rows in this book (A-6)")
            .isEqualTo(4L);

        long attemptedInB = repository.countByBookOfWorkId(bookB);
        assertThat(attemptedInB).isEqualTo(1L);

        // Per-status counts back the summary endpoint's by-status totals.
        long generatedInA = repository.countByBookOfWorkIdAndStatus(
            bookA, MigrationStorySpecGenerationStatus.GENERATED);
        assertThat(generatedInA).isEqualTo(2L);

        long failedInA = repository.countByBookOfWorkIdAndStatus(
            bookA, MigrationStorySpecGenerationStatus.FAILED);
        assertThat(failedInA).isEqualTo(1L);

        long insufficientInA = repository.countByBookOfWorkIdAndStatus(
            bookA, MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT);
        assertThat(insufficientInA).isEqualTo(1L);

        // Status NEVER seen on a row (e.g. skipped_blocked, since the test
        // toggle was OFF) returns 0 from the counter -- the summary endpoint
        // surfaces these as zero counts.
        long skippedInA = repository.countByBookOfWorkIdAndStatus(
            bookA, MigrationStorySpecGenerationStatus.SKIPPED_BLOCKED);
        assertThat(skippedInA).isEqualTo(0L);

        // not_attempted is NEVER a persisted status (A-6 / R-12); confirm it
        // is intentionally absent from the persisted status vocabulary.
        assertThat(MigrationStorySpecGenerationStatus.ALL)
            .doesNotContain("not_attempted")
            .containsExactlyInAnyOrder(
                MigrationStorySpecGenerationStatus.GENERATED,
                MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS,
                MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT,
                MigrationStorySpecGenerationStatus.FAILED,
                MigrationStorySpecGenerationStatus.SKIPPED_BLOCKED);
    }
}
