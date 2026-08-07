package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.dto.MigrationExecutionRunDto;
import com.example.architecturemodel.model.dto.MigrationExecutionRunItemDto;
import com.example.architecturemodel.model.dto.WorkItemDto;
import com.example.architecturemodel.model.entity.MigrationExecutionRunItemStatus;
import com.example.architecturemodel.model.entity.MigrationExecutionRunStatus;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.service.MigrationExecutionRunService;
import com.example.architecturemodel.service.MigrationExecutionRunService.CreateRunRequest;
import com.example.architecturemodel.service.WorkItemService;
import org.junit.jupiter.api.BeforeEach;
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
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Persistence + service round-trip tests for the Migration Execution run-state
 * tables added by Liquibase changeset {@code 182}:
 * {@code migration_execution_run} + {@code migration_execution_run_item} (plus
 * the {@code work_item.deferred} flag).
 *
 * <p>Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1.</p>
 *
 * <p>Mirrors the {@link MigrationStorySpecGenerationImplementationReadyFieldsTest}
 * harness exactly (the {@code @DataJpaTest} + H2 PostgreSQL-mode +
 * {@code CREATE DOMAIN JSONB AS JSON} idiom) so the JSONB decision-log blobs
 * round-trip through persist + reload. The {@link MigrationExecutionRunService}
 * and {@link WorkItemService} are instantiated directly over the autowired
 * repositories (the {@code @DataJpaTest} slice does not register {@code @Service}
 * beans), exercising the full create / read / PATCH null-guard path.</p>
 *
 * <p>Focused tests (6 -- within the 2-8 budget per task 1.1):</p>
 * <ol>
 *   <li>create-run round-trips the pinned {@code kind='current'} baseline id +
 *       the {@code deploy_on_complete} (final-item-only) / {@code target_base_url}
 *       markers, AND the read returns the run with its ordered items.</li>
 *   <li>a per-spec run-item PATCH (dispatched / job_id / outcome) persists and
 *       reads back (snake_case wire via the DTO {@code @JsonProperty}s).</li>
 *   <li>a partial run-item PATCH that OMITS {@code dispatched} / {@code job_id}
 *       / the decision log does NOT wipe them (the primitive-overwrite guard).</li>
 *   <li>the inline {@code auto_answer_decision_log_json} JSONB round-trips a
 *       {@code { question, answer, rationale }} list (CD-4).</li>
 *   <li>the run-level {@code decision_log_json} JSONB round-trips.</li>
 *   <li>the {@code deferred} flag set/clear round-trips on the work item (CD-7).</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:merunstatedb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class MigrationExecutionRunStatePersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private MigrationExecutionRunRepository runRepository;

    @Autowired
    private MigrationExecutionRunItemRepository runItemRepository;

    @Autowired
    private WorkItemRepository workItemRepository;

    private MigrationExecutionRunService runService;
    private WorkItemService workItemService;

    @BeforeEach
    void setUp() {
        runService = new MigrationExecutionRunService(runRepository, runItemRepository);
        workItemService = new WorkItemService(workItemRepository);
    }

    private static Map<String, Object> decision(String question, String answer, String rationale) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("question", question);
        m.put("answer", answer);
        m.put("rationale", rationale);
        return m;
    }

    /**
     * A fresh pending run-item DTO. The 21 record components in order are:
     * id, runId, sequencePosition, workItemId, specGenerationId, specName,
     * status, dispatched, jobId, branch, prUrl, outcome, deployOnComplete,
     * targetBaseUrl, errorDetail, autoAnswerDecisionLogJson, retryAttemptCount,
     * retryNextAttemptAt, failureClass, createdAt, updatedAt.
     */
    private MigrationExecutionRunItemDto pendingItem(int seq, boolean deployOnComplete) {
        return new MigrationExecutionRunItemDto(
            null, null, seq,
            UUID.randomUUID(), UUID.randomUUID(),
            "spec-folder-" + seq,
            MigrationExecutionRunItemStatus.PENDING,
            Boolean.FALSE, null, null, null, null,
            deployOnComplete, null, null, null,
            null, null, null,
            null, null);
    }

    @Test
    @DisplayName("create-run round-trips the pinned baseline id + deploy_on_complete/target_base_url markers; read returns run + ordered items")
    void createRunRoundTripsPinnedBaselineAndMarkers() {
        UUID projectId = UUID.randomUUID();
        UUID bookOfWorkId = UUID.randomUUID();
        UUID pinnedBaselineId = UUID.randomUUID();

        MigrationExecutionRunDto runHeader = new MigrationExecutionRunDto(
            null, projectId, bookOfWorkId,
            MigrationExecutionRunStatus.STARTED,
            0, pinnedBaselineId, null, "2026-08-01-stage1-final-spec",
            null, null, null);

        // Two specs: only the FINAL one carries deploy_on_complete=true (big-bang).
        List<MigrationExecutionRunItemDto> items = List.of(
            pendingItem(0, false),
            pendingItem(1, true));

        MigrationExecutionRunDto created =
            runService.createRun(projectId, new CreateRunRequest(runHeader, items));
        entityManager.flush();
        entityManager.clear();

        assertThat(created.id()).isNotNull();
        assertThat(created.pinnedCurrentBaselineId())
            .as("the pinned kind=current baseline id must round-trip (CD-7)")
            .isEqualTo(pinnedBaselineId);
        assertThat(created.baseSpec())
            .as("the run-branch chaining base_spec must round-trip (2026-08-06)")
            .isEqualTo("2026-08-01-stage1-final-spec");
        assertThat(created.items()).hasSize(2);

        // Read run-state back fresh from the DB.
        MigrationExecutionRunDto readBack = runService.getRunState(created.id());
        assertThat(readBack.projectId()).isEqualTo(projectId);
        assertThat(readBack.bookOfWorkId()).isEqualTo(bookOfWorkId);
        assertThat(readBack.pinnedCurrentBaselineId()).isEqualTo(pinnedBaselineId);
        assertThat(readBack.items()).hasSize(2);
        // Ordered by sequence position.
        assertThat(readBack.items().get(0).sequencePosition()).isZero();
        assertThat(readBack.items().get(1).sequencePosition()).isEqualTo(1);
        // deploy_on_complete is set ONLY on the final item.
        assertThat(readBack.items().get(0).deployOnComplete()).isFalse();
        assertThat(readBack.items().get(1).deployOnComplete())
            .as("deploy_on_complete must be true only on the FINAL run-item (big-bang)")
            .isTrue();
        // Each item is bound to the created run id (not a body-supplied run_id).
        assertThat(readBack.items().get(0).runId()).isEqualTo(created.id());
    }

    @Test
    @DisplayName("per-spec run-item PATCH of dispatched/job_id/outcome persists and reads back")
    void runItemPatchPersists() {
        UUID projectId = UUID.randomUUID();
        MigrationExecutionRunDto runHeader = new MigrationExecutionRunDto(
            null, projectId, UUID.randomUUID(),
            MigrationExecutionRunStatus.STARTED, 0, null, null, null, null, null,
            null);
        MigrationExecutionRunDto created = runService.createRun(
            projectId, new CreateRunRequest(runHeader, List.of(pendingItem(0, true))));
        UUID runItemId = created.items().get(0).id();
        entityManager.flush();
        entityManager.clear();

        // PATCH: dispatch the spec, correlate the job_id, set the outcome + branch + pr_url.
        // 21 args: id, runId, seq, workItemId, specGenerationId, specName, status,
        // dispatched, jobId, branch, prUrl, outcome, deployOnComplete, targetBaseUrl,
        // errorDetail, autoAnswerDecisionLogJson, retryAttemptCount,
        // retryNextAttemptAt, failureClass, createdAt, updatedAt.
        MigrationExecutionRunItemDto patch = new MigrationExecutionRunItemDto(
            null, null, null, null, null, null,
            MigrationExecutionRunItemStatus.IMPLEMENTED,
            Boolean.TRUE, "job-abc-123", "feature/migrate-accounts",
            "https://example.test/pr/42",
            MigrationExecutionRunItemStatus.IMPLEMENTED,
            null, null, null, null, null, null, null, null, null);

        runService.updateRunItem(runItemId, patch);
        entityManager.flush();
        entityManager.clear();

        MigrationExecutionRunItemDto reloaded =
            runService.findRunItemByJobId("job-abc-123").orElseThrow();
        assertThat(reloaded.id()).isEqualTo(runItemId);
        assertThat(reloaded.dispatched()).isTrue();
        assertThat(reloaded.jobId()).isEqualTo("job-abc-123");
        assertThat(reloaded.branch()).isEqualTo("feature/migrate-accounts");
        assertThat(reloaded.prUrl()).isEqualTo("https://example.test/pr/42");
        assertThat(reloaded.outcome()).isEqualTo(MigrationExecutionRunItemStatus.IMPLEMENTED);
        assertThat(reloaded.status()).isEqualTo(MigrationExecutionRunItemStatus.IMPLEMENTED);
    }

    @Test
    @DisplayName("partial run-item PATCH omitting dispatched/job_id/decision-log does NOT wipe them (primitive-overwrite guard)")
    void runItemPatchDoesNotWipeOmittedFields() {
        UUID projectId = UUID.randomUUID();
        MigrationExecutionRunDto runHeader = new MigrationExecutionRunDto(
            null, projectId, UUID.randomUUID(),
            MigrationExecutionRunStatus.STARTED, 0, null, null, null, null, null,
            null);
        MigrationExecutionRunDto created = runService.createRun(
            projectId, new CreateRunRequest(runHeader, List.of(pendingItem(0, true))));
        UUID runItemId = created.items().get(0).id();

        // First PATCH: set dispatched + job_id + a decision-log entry.
        List<Map<String, Object>> log = List.of(
            decision("Which port?", "8080", "Matches the migrated service default"));
        MigrationExecutionRunItemDto first = new MigrationExecutionRunItemDto(
            null, null, null, null, null, null,
            MigrationExecutionRunItemStatus.SUBMITTED,
            Boolean.TRUE, "job-keep-me", null, null, null,
            null, null, null, log, null, null, null, null, null);
        runService.updateRunItem(runItemId, first);
        entityManager.flush();
        entityManager.clear();

        // Second PATCH: flip ONLY status (everything else null on the wire).
        MigrationExecutionRunItemDto second = new MigrationExecutionRunItemDto(
            null, null, null, null, null, null,
            MigrationExecutionRunItemStatus.IMPLEMENTED,
            null, null, null, null, null,
            null, null, null, null, null, null, null, null, null);
        runService.updateRunItem(runItemId, second);
        entityManager.flush();
        entityManager.clear();

        MigrationExecutionRunItemDto reloaded =
            runItemRepository.findById(runItemId)
                .map(com.example.architecturemodel.mapper.MigrationExecutionRunItemMapper::toDto)
                .orElseThrow();
        assertThat(reloaded.status()).isEqualTo(MigrationExecutionRunItemStatus.IMPLEMENTED);
        assertThat(reloaded.dispatched())
            .as("dispatched must survive a PATCH that omits it (boxed Boolean + null-guard)")
            .isTrue();
        assertThat(reloaded.jobId())
            .as("job_id must survive a PATCH that omits it")
            .isEqualTo("job-keep-me");
        assertThat(reloaded.autoAnswerDecisionLogJson())
            .as("the inline decision log must survive a PATCH that omits it")
            .isNotNull()
            .hasSize(1);
    }

    @Test
    @DisplayName("inline auto_answer_decision_log_json round-trips a { question, answer, rationale } list (CD-4)")
    void autoAnswerDecisionLogRoundTrips() {
        UUID projectId = UUID.randomUUID();
        MigrationExecutionRunDto runHeader = new MigrationExecutionRunDto(
            null, projectId, UUID.randomUUID(),
            MigrationExecutionRunStatus.STARTED, 0, null, null, null, null, null,
            null);
        MigrationExecutionRunDto created = runService.createRun(
            projectId, new CreateRunRequest(runHeader, List.of(pendingItem(0, true))));
        UUID runItemId = created.items().get(0).id();

        List<Map<String, Object>> log = List.of(
            decision("Auth strategy?", "Bearer JWT", "The current service uses JWT; preserve it"),
            decision("DB driver?", "PostgreSQL", "Migration target is PostgreSQL per the goal"));
        // PATCH only the decision log (status null = unchanged).
        MigrationExecutionRunItemDto patch = new MigrationExecutionRunItemDto(
            null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, log,
            null, null, null, null, null);
        runService.updateRunItem(runItemId, patch);
        entityManager.flush();
        entityManager.clear();

        MigrationExecutionRunItemDto reloaded =
            runItemRepository.findById(runItemId)
                .map(com.example.architecturemodel.mapper.MigrationExecutionRunItemMapper::toDto)
                .orElseThrow();
        assertThat(reloaded.autoAnswerDecisionLogJson()).hasSize(2);
        assertThat(reloaded.autoAnswerDecisionLogJson().get(0))
            .containsEntry("question", "Auth strategy?")
            .containsEntry("answer", "Bearer JWT")
            .containsEntry("rationale", "The current service uses JWT; preserve it");
        assertThat(reloaded.autoAnswerDecisionLogJson().get(1))
            .containsEntry("answer", "PostgreSQL");
    }

    @Test
    @DisplayName("run-level decision_log_json round-trips through a run PATCH")
    void runLevelDecisionLogRoundTrips() {
        UUID projectId = UUID.randomUUID();
        MigrationExecutionRunDto runHeader = new MigrationExecutionRunDto(
            null, projectId, UUID.randomUUID(),
            MigrationExecutionRunStatus.STARTED, 0, null, null, null, null, null,
            null);
        MigrationExecutionRunDto created = runService.createRun(
            projectId, new CreateRunRequest(runHeader, List.of(pendingItem(0, true))));

        List<Map<String, Object>> log = List.of(
            decision("Run event", "dispatched spec 0", "first spec kicked off"));
        MigrationExecutionRunDto patch = new MigrationExecutionRunDto(
            null, null, null, MigrationExecutionRunStatus.DISPATCHING,
            1, null, null, null, log, null, null);
        runService.updateRun(created.id(), patch);
        entityManager.flush();
        entityManager.clear();

        MigrationExecutionRunDto reloaded = runService.getRunState(created.id());
        assertThat(reloaded.status()).isEqualTo(MigrationExecutionRunStatus.DISPATCHING);
        assertThat(reloaded.currentSequencePosition()).isEqualTo(1);
        assertThat(reloaded.decisionLogJson()).isNotNull().hasSize(1);
        assertThat(reloaded.decisionLogJson().get(0))
            .containsEntry("answer", "dispatched spec 0");
    }

    @Test
    @DisplayName("deferred flag set/clear round-trips on the work item (CD-7)")
    void deferredFlagSetAndClear() {
        UUID projectId = UUID.randomUUID();
        WorkItemEntity story = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .type("STORY")
            .title("Migrate accounts endpoint")
            .build();
        workItemRepository.save(story);
        entityManager.flush();
        entityManager.clear();

        // Default reads back false (DB DEFAULT false + @PrePersist).
        WorkItemEntity fresh = workItemRepository.findById(story.getId()).orElseThrow();
        assertThat(fresh.getDeferred()).isFalse();

        // Defer.
        WorkItemDto deferred = workItemService.setDeferred(story.getId(), true);
        assertThat(deferred.deferred()).isTrue();
        entityManager.flush();
        entityManager.clear();
        assertThat(workItemRepository.findById(story.getId()).orElseThrow().getDeferred()).isTrue();

        // Un-defer.
        WorkItemDto undeferred = workItemService.setDeferred(story.getId(), false);
        assertThat(undeferred.deferred()).isFalse();
        entityManager.flush();
        entityManager.clear();
        assertThat(workItemRepository.findById(story.getId()).orElseThrow().getDeferred()).isFalse();

        // getLatestRunForBook on a book with no run returns empty (read path).
        Optional<MigrationExecutionRunDto> none = runService.getLatestRunForBook(UUID.randomUUID());
        assertThat(none).isEmpty();
    }

    @Test
    @DisplayName("changeset 219: scope names persist at create; in-flight list is cross-project + status-scoped; runs-for-book returns full history with items")
    void scopeNamesAndInFlightDiscovery() {
        UUID projectA = UUID.randomUUID();
        UUID projectB = UUID.randomUUID();
        UUID bookA = UUID.randomUUID();
        UUID bookB = UUID.randomUUID();

        // Run 1 (project A): dispatching + scope names -> IN FLIGHT.
        MigrationExecutionRunDto inFlightHeader = new MigrationExecutionRunDto(
            null, projectA, "acme", "order-mig", bookA,
            MigrationExecutionRunStatus.DISPATCHING,
            0, null, null, null, null, null, null);
        MigrationExecutionRunDto inFlight = runService.createRun(
            projectA, new CreateRunRequest(inFlightHeader, List.of(pendingItem(0, true))));

        // Run 2 (project B): deployed -> NOT in flight.
        MigrationExecutionRunDto deployedHeader = new MigrationExecutionRunDto(
            null, projectB, "acme", "other-proj", bookB,
            MigrationExecutionRunStatus.DEPLOYED,
            0, null, null, null, null, null, null);
        runService.createRun(
            projectB, new CreateRunRequest(deployedHeader, List.of(pendingItem(0, true))));

        // Run 3 (book A, older attempt): halted -> not in flight, but IS history.
        MigrationExecutionRunDto haltedHeader = new MigrationExecutionRunDto(
            null, projectA, "acme", "order-mig", bookA,
            MigrationExecutionRunStatus.HALTED,
            0, null, null, null, null, null, null);
        runService.createRun(
            projectA, new CreateRunRequest(haltedHeader, List.of(pendingItem(0, false))));

        entityManager.flush();
        entityManager.clear();

        // Scope names round-trip on the create read.
        MigrationExecutionRunDto reread = runService.getRunState(inFlight.id());
        assertThat(reread.company()).isEqualTo("acme");
        assertThat(reread.project()).isEqualTo("order-mig");

        // In-flight list: ONLY the dispatching run, cross-project by design.
        List<MigrationExecutionRunDto> inFlightRuns = runService.listInFlightRuns();
        assertThat(inFlightRuns).extracting(MigrationExecutionRunDto::id)
            .containsExactly(inFlight.id());
        assertThat(inFlightRuns.get(0).company()).isEqualTo("acme");

        // Runs-for-book: BOTH of book A's runs, newest first, WITH items.
        List<MigrationExecutionRunDto> history = runService.getRunsForBook(bookA);
        assertThat(history).hasSize(2);
        assertThat(history.get(0).items()).isNotNull();
        assertThat(history.get(1).items()).isNotNull();
        assertThat(history).allSatisfy(r -> assertThat(r.bookOfWorkId()).isEqualTo(bookA));
    }
}
