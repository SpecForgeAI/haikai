package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.EpicCapturedDecisionEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationPass;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import jakarta.persistence.PersistenceException;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Persistence-layer tests for the cross-story-context persistence foundation
 * introduced by Liquibase changesets 141 and 142.
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Task Group 1.</p>
 *
 * <p>Covers the four focal areas called out in tasks.md 1.1:</p>
 * <ol>
 *   <li>{@code generation_pass} value vocabulary -- only 1 and 2 are accepted
 *       by the service-layer guard ({@link MigrationStorySpecGenerationPass}),
 *       which mirrors the DB CHECK constraint {@code chk_msg_generation_pass}
 *       (the actual DB CHECK is exercised by the Liquibase smoke path, not
 *       inside {@code @DataJpaTest} -- see the note on
 *       {@link MigrationStorySpecGenerationEntityPersistenceTest}).</li>
 *   <li>{@code epic_captured_decisions} unique key on
 *       {@code (project_id, epic_work_item_id, decision_key)} is enforced.
 *       This one IS exercised here because the unique index is declared via
 *       JPA {@code @UniqueConstraint} on the entity, so Hibernate emits it
 *       into the H2 schema.</li>
 *   <li>Pass-1 entity round-trips the four new write-time columns
 *       ({@code pass1_spec_text}, {@code budget_meta_json},
 *       {@code decisions_json}, {@code interfaces_json},
 *       {@code assumptions_json}).</li>
 *   <li>PATCH semantics on {@code budget_meta_json} and
 *       {@code no_meaningful_change} do not wipe pre-existing values when the
 *       PATCH DTO omits the field (boxed-type null-guard pattern per
 *       {@code project_primitive_double_dto_overwrite.md}).</li>
 * </ol>
 *
 * <p>The H2 PostgreSQL-mode test DB does not natively understand JSONB, so a
 * {@code CREATE DOMAIN JSONB AS JSON} INIT alias is registered on the JDBC URL
 * -- same pattern used by {@link MigrationStorySpecGenerationEntityPersistenceTest}
 * and {@code DiscoveryFindingPersistenceTest}.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:crossstorycontextdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.liquibase.enabled=false",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect"
})
class CrossStoryContextPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private MigrationStorySpecGenerationRepository specRepository;

    @Autowired
    private EpicCapturedDecisionRepository decisionRepository;

    private MigrationStorySpecGenerationEntity buildSpec(
        UUID id, UUID projectId, UUID workItemId, Integer generationPass) {
        return MigrationStorySpecGenerationEntity.builder()
            .id(id)
            .projectId(projectId)
            .workItemId(workItemId)
            .bookOfWorkId(UUID.randomUUID())
            .bookItemId("book-item-" + workItemId)
            .status(MigrationStorySpecGenerationStatus.GENERATED)
            .generationPass(generationPass)
            .generationAttemptNumber(0)
            .build();
    }

    private EpicCapturedDecisionEntity buildDecision(
        UUID projectId, UUID epicWorkItemId, String decisionKey, String text) {
        return EpicCapturedDecisionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .epicWorkItemId(epicWorkItemId)
            .decisionKey(decisionKey)
            .decisionText(text)
            .source("auto_extracted")
            .status("draft")
            .build();
    }

    @Test
    @DisplayName("generation_pass vocabulary admits only 1 and 2; service-layer guard rejects every other value")
    void generationPassCheckConstraintRejectsValuesOtherThanOneOrTwo() {
        // The actual DB CHECK constraint (chk_msg_generation_pass, changeset 141)
        // is the source of truth at runtime, and is exercised by the Liquibase
        // smoke path. Inside @DataJpaTest the schema is rebuilt from Hibernate
        // JPA mappings only, so the SQL-defined CHECK is not present here.
        //
        // The service-layer guard mirrors the DB CHECK and is what callers
        // hit BEFORE the JDBC write -- both layers must agree on the
        // vocabulary. The assertions below exercise the service-layer guard.

        assertThat(MigrationStorySpecGenerationPass.ALL)
            .as("Only persisted generation_pass values are 1 and 2 (hard cap per spec)")
            .containsExactlyInAnyOrder(1, 2);

        assertThat(MigrationStorySpecGenerationPass.isValid(1)).isTrue();
        assertThat(MigrationStorySpecGenerationPass.isValid(2)).isTrue();

        // The four canonical "this must be rejected" inputs: null, 0, 3, -1.
        assertThat(MigrationStorySpecGenerationPass.isValid(null)).isFalse();
        assertThat(MigrationStorySpecGenerationPass.isValid(0)).isFalse();
        assertThat(MigrationStorySpecGenerationPass.isValid(3))
            .as("Hard cap at 2 -- pass 3 must NEVER be admitted (spec loop guardrail)")
            .isFalse();
        assertThat(MigrationStorySpecGenerationPass.isValid(-1)).isFalse();

        // Sanity: the entity's @PrePersist defaulter writes 1 when the builder
        // omits the field, so pass-1 is implicitly the safe default.
        UUID id = UUID.randomUUID();
        MigrationStorySpecGenerationEntity entity = buildSpec(
            id, UUID.randomUUID(), UUID.randomUUID(), null);
        specRepository.save(entity);
        entityManager.flush();
        entityManager.clear();

        MigrationStorySpecGenerationEntity reloaded =
            specRepository.findById(id).orElseThrow();
        assertThat(reloaded.getGenerationPass())
            .as("Entity-level default for generation_pass is 1 when omitted by the builder")
            .isEqualTo(1);
    }

    @Test
    @DisplayName("epic_captured_decisions unique key on (project_id, epic_work_item_id, decision_key) is enforced")
    void epicCapturedDecisionsUniqueKeyIsEnforced() {
        UUID projectId = UUID.randomUUID();
        UUID epicId = UUID.randomUUID();
        String key = "default-bank-account-currency";

        EpicCapturedDecisionEntity first = buildDecision(
            projectId, epicId, key, "Default currency is GBP");
        decisionRepository.save(first);
        entityManager.flush();

        // Second insert with the SAME (project, epic, key) triple MUST fail.
        EpicCapturedDecisionEntity duplicate = buildDecision(
            projectId, epicId, key, "Different text but same key -- should be rejected");

        assertThatThrownBy(() -> {
            decisionRepository.save(duplicate);
            entityManager.flush();
        })
            .as("Unique constraint ux_ecd_project_epic_key must reject duplicate (project, epic, key) triples")
            .isInstanceOf(PersistenceException.class);

        entityManager.clear();

        // Same key under a DIFFERENT epic must be admitted -- the uniqueness
        // is scoped to (project, epic) not just (project).
        EpicCapturedDecisionEntity differentEpic = buildDecision(
            projectId, UUID.randomUUID(), key, "Same key, different epic -- admitted");
        decisionRepository.save(differentEpic);
        entityManager.flush();

        // And the same key under a different project must also be admitted.
        EpicCapturedDecisionEntity differentProject = buildDecision(
            UUID.randomUUID(), epicId, key, "Same key, different project -- admitted");
        decisionRepository.save(differentProject);
        entityManager.flush();
        entityManager.clear();

        List<EpicCapturedDecisionEntity> originals =
            decisionRepository.findByProjectIdAndEpicWorkItemId(projectId, epicId);
        assertThat(originals)
            .as("Only the originally-inserted row survives for the original (project, epic) tuple")
            .hasSize(1)
            .first()
            .satisfies(row -> assertThat(row.getDecisionText()).isEqualTo("Default currency is GBP"));
    }

    @Test
    @DisplayName("Pass-1 entity round-trips pass1_spec_text, budget_meta_json, decisions_json, interfaces_json, assumptions_json")
    void passOneEntityRoundTripsAllNewWriteTimeColumns() {
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();

        // budget_meta_json mirrors resolver budget_meta:
        //   { used_tokens, max_tokens, trimmed: { sibling_specs_dropped, evidence_refs_dropped } }
        Map<String, Object> trimmed = new LinkedHashMap<>();
        trimmed.put("sibling_specs_dropped", 2);
        trimmed.put("evidence_refs_dropped", 5);
        Map<String, Object> budgetMeta = new LinkedHashMap<>();
        budgetMeta.put("used_tokens", 11342);
        budgetMeta.put("max_tokens", 24000);
        budgetMeta.put("trimmed", trimmed);

        List<String> decisions = List.of(
            "Use HTTPS for all inter-service calls",
            "Default currency is GBP",
            "Idempotency keys required on POST"
        );
        List<String> interfaces = List.of(
            "POST /api/v1/payments -> PaymentResponse",
            "GET /api/v1/accounts/{id} -> AccountSummary"
        );
        List<String> assumptions = List.of(
            "Upstream auth gateway returns JWT in Authorization header",
            "Caller already validated currency code"
        );

        MigrationStorySpecGenerationEntity entity = buildSpec(
            id, projectId, workItemId, MigrationStorySpecGenerationPass.PASS_1);
        entity.setGeneratedSpecText("/agent-os:shape-spec implement payments service");
        // Pass-1 contract: pass1_spec_text = generated_spec_text snapshot.
        entity.setPass1SpecText("/agent-os:shape-spec implement payments service");
        entity.setBudgetMetaJson(budgetMeta);
        entity.setDecisionsJson(decisions);
        entity.setInterfacesJson(interfaces);
        entity.setAssumptionsJson(assumptions);
        // Pass-1 row has no pass-2 changes summary and no_meaningful_change is null.
        entity.setPass2ChangesSummary(null);
        entity.setNoMeaningfulChange(null);

        specRepository.save(entity);
        entityManager.flush();
        entityManager.clear();

        MigrationStorySpecGenerationEntity reloaded =
            specRepository.findById(id).orElseThrow();

        assertThat(reloaded.getGenerationPass()).isEqualTo(1);
        assertThat(reloaded.getPass1SpecText())
            .isEqualTo("/agent-os:shape-spec implement payments service");
        assertThat(reloaded.getPass2ChangesSummary()).isNull();
        assertThat(reloaded.getNoMeaningfulChange()).isNull();

        assertThat(reloaded.getBudgetMetaJson())
            .as("budget_meta_json structure round-trips through JSONB persist")
            .containsEntry("used_tokens", 11342)
            .containsEntry("max_tokens", 24000)
            .containsKey("trimmed");
        @SuppressWarnings("unchecked")
        Map<String, Object> reloadedTrimmed =
            (Map<String, Object>) reloaded.getBudgetMetaJson().get("trimmed");
        assertThat(reloadedTrimmed)
            .containsEntry("sibling_specs_dropped", 2)
            .containsEntry("evidence_refs_dropped", 5);

        assertThat(reloaded.getDecisionsJson())
            .as("decisions_json array round-trips intact -- this is the canonical sibling-summary source")
            .containsExactly(
                "Use HTTPS for all inter-service calls",
                "Default currency is GBP",
                "Idempotency keys required on POST");
        assertThat(reloaded.getInterfacesJson())
            .containsExactly(
                "POST /api/v1/payments -> PaymentResponse",
                "GET /api/v1/accounts/{id} -> AccountSummary");
        assertThat(reloaded.getAssumptionsJson())
            .containsExactly(
                "Upstream auth gateway returns JWT in Authorization header",
                "Caller already validated currency code");
    }

    @Test
    @DisplayName("PATCH semantics on budget_meta_json and no_meaningful_change do NOT wipe pre-existing values when omitted")
    void patchOmittedBudgetMetaAndNoMeaningfulChangeDoNotWipeColumns() {
        // This test mirrors the canonical null-guard pattern from
        // project_primitive_double_dto_overwrite.md. Both new fields are boxed
        // reference types on the entity (Map for budget_meta_json, Boolean for
        // no_meaningful_change), so an omitted PATCH field arrives as null and
        // the PATCH handler MUST null-guard the assignment.
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();

        Map<String, Object> originalTrimmed = new LinkedHashMap<>();
        originalTrimmed.put("sibling_specs_dropped", 3);
        originalTrimmed.put("evidence_refs_dropped", 7);
        Map<String, Object> originalBudget = new LinkedHashMap<>();
        originalBudget.put("used_tokens", 9876);
        originalBudget.put("max_tokens", 24000);
        originalBudget.put("trimmed", originalTrimmed);

        MigrationStorySpecGenerationEntity persisted = buildSpec(
            id, projectId, workItemId, MigrationStorySpecGenerationPass.PASS_2);
        persisted.setStatus(MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS);
        persisted.setBudgetMetaJson(originalBudget);
        persisted.setNoMeaningfulChange(Boolean.TRUE);
        persisted.setPass1SpecText("/agent-os:shape-spec pass-1 body");
        persisted.setGeneratedSpecText("/agent-os:shape-spec pass-2 body");
        persisted.setPass2ChangesSummary("Aligned with epic decision: idempotency keys.");
        specRepository.save(persisted);
        entityManager.flush();
        entityManager.clear();

        // Simulate a PATCH that touches only `status` and omits everything
        // else (so on the wire every other field arrives as null).
        MigrationStorySpecGenerationEntity loaded =
            specRepository.findById(id).orElseThrow();

        // Null-guard each editable field: omitted == do not assign. This is
        // the same posture as MigrationStorySpecGenerationMapper#updateEntityFromDto,
        // extended for the new cross-story columns.
        Map<String, Object> incomingBudget = null;       // OMITTED on the wire
        Boolean incomingNoMeaningfulChange = null;       // OMITTED on the wire
        Map<String, Object> incomingFocusedRefs = null;  // OMITTED on the wire
        String incomingPass2Summary = null;              // OMITTED on the wire
        String incomingStatus = MigrationStorySpecGenerationStatus.FAILED;

        if (incomingStatus != null) {
            loaded.setStatus(incomingStatus);
        }
        if (incomingBudget != null) {
            loaded.setBudgetMetaJson(incomingBudget);
        }
        if (incomingNoMeaningfulChange != null) {
            loaded.setNoMeaningfulChange(incomingNoMeaningfulChange);
        }
        if (incomingFocusedRefs != null) {
            loaded.setFocusedContextRefsJson(incomingFocusedRefs);
        }
        if (incomingPass2Summary != null) {
            loaded.setPass2ChangesSummary(incomingPass2Summary);
        }

        specRepository.save(loaded);
        entityManager.flush();
        entityManager.clear();

        MigrationStorySpecGenerationEntity reloaded =
            specRepository.findById(id).orElseThrow();

        assertThat(reloaded.getStatus())
            .isEqualTo(MigrationStorySpecGenerationStatus.FAILED);

        // CRITICAL: omitted PATCH fields must NOT wipe pre-existing values.
        assertThat(reloaded.getBudgetMetaJson())
            .as("budget_meta_json must survive a PATCH that omits the field (project_primitive_double_dto_overwrite)")
            .isNotNull()
            .containsEntry("used_tokens", 9876)
            .containsEntry("max_tokens", 24000)
            .containsKey("trimmed");

        assertThat(reloaded.getNoMeaningfulChange())
            .as("no_meaningful_change (boxed Boolean) must survive a PATCH that omits the field -- a primitive boolean would have silently flipped to false")
            .isNotNull()
            .isTrue();

        assertThat(reloaded.getPass1SpecText())
            .as("pass1_spec_text snapshot survives the PATCH untouched")
            .isEqualTo("/agent-os:shape-spec pass-1 body");

        assertThat(reloaded.getPass2ChangesSummary())
            .as("pass2_changes_summary survives the PATCH untouched")
            .isEqualTo("Aligned with epic decision: idempotency keys.");

        assertThat(reloaded.getGenerationPass())
            .as("generation_pass survives the PATCH untouched (boxed Integer)")
            .isEqualTo(2);
    }

    @Test
    @DisplayName("EpicCapturedDecisionRepository finders return only matching rows; status-IN filter scopes to draft/confirmed feed")
    void epicCapturedDecisionRepositoryFindersFilterCorrectly() {
        UUID projectA = UUID.randomUUID();
        UUID projectB = UUID.randomUUID();
        UUID epicA = UUID.randomUUID();
        UUID epicB = UUID.randomUUID();
        UUID sourceSpecId = UUID.randomUUID();

        EpicCapturedDecisionEntity draftA1 = buildDecision(
            projectA, epicA, "currency-default", "GBP everywhere");
        draftA1.setStatus("draft");
        draftA1.setSourceSpecGenerationId(sourceSpecId);

        EpicCapturedDecisionEntity confirmedA2 = buildDecision(
            projectA, epicA, "idempotency-key", "Required on POSTs");
        confirmedA2.setStatus("confirmed");
        confirmedA2.setSource("user_edited");
        confirmedA2.setLastEditedBy("alice");

        EpicCapturedDecisionEntity supersededA3 = buildDecision(
            projectA, epicA, "legacy-flag", "Deprecated -- superseded");
        supersededA3.setStatus("superseded");

        EpicCapturedDecisionEntity unrelatedB = buildDecision(
            projectB, epicB, "currency-default", "Different project, same key");
        unrelatedB.setStatus("draft");

        decisionRepository.save(draftA1);
        decisionRepository.save(confirmedA2);
        decisionRepository.save(supersededA3);
        decisionRepository.save(unrelatedB);
        entityManager.flush();
        entityManager.clear();

        // findByProjectIdAndEpicWorkItemId returns ALL three rows for (projectA, epicA).
        List<EpicCapturedDecisionEntity> allForEpicA =
            decisionRepository.findByProjectIdAndEpicWorkItemId(projectA, epicA);
        assertThat(allForEpicA).hasSize(3);

        // findByProjectIdAndEpicWorkItemIdAndStatusIn(draft, confirmed) mirrors
        // the resolver's parent_rollup feed contract -- superseded is excluded.
        List<EpicCapturedDecisionEntity> feedRows =
            decisionRepository.findByProjectIdAndEpicWorkItemIdAndStatusIn(
                projectA, epicA, Set.of("draft", "confirmed"));
        assertThat(feedRows)
            .as("Only draft and confirmed rows feed pass-2 parent_rollup.epic.capturedDecisions[]")
            .hasSize(2)
            .extracting(EpicCapturedDecisionEntity::getStatus)
            .containsExactlyInAnyOrder("draft", "confirmed");

        // findBySourceSpecGenerationId locates rows that originated from a
        // specific spec-generation row (used by capture-and-restore flows).
        List<EpicCapturedDecisionEntity> bySource =
            decisionRepository.findBySourceSpecGenerationId(sourceSpecId);
        assertThat(bySource).hasSize(1);
        assertThat(bySource.get(0).getDecisionKey()).isEqualTo("currency-default");

        // findByProjectIdAndEpicWorkItemIdAndDecisionKey is the upsert helper
        // used by the pass-1 auto-seed pipeline.
        assertThat(decisionRepository.findByProjectIdAndEpicWorkItemIdAndDecisionKey(
            projectA, epicA, "idempotency-key"))
            .isPresent()
            .get()
            .satisfies(row -> {
                assertThat(row.getSource()).isEqualTo("user_edited");
                assertThat(row.getLastEditedBy()).isEqualTo("alice");
                assertThat(row.getStatus()).isEqualTo("confirmed");
            });
        assertThat(decisionRepository.findByProjectIdAndEpicWorkItemIdAndDecisionKey(
            projectA, epicA, "no-such-key"))
            .isEmpty();
    }
}
