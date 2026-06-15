package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.dto.MigrationReconciliationBreakDto;
import com.example.architecturemodel.model.entity.MigrationReconciliationBreakStatus;
import com.example.architecturemodel.service.MigrationReconciliationBreakService;
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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Persistence + service round-trip tests for the Migration Reconciliation break
 * store added by Liquibase changeset {@code 183}:
 * {@code migration_reconciliation_break}.
 *
 * <p>Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4) --
 * Task Group 1.</p>
 *
 * <p>Mirrors the {@link MigrationExecutionRunStatePersistenceTest} harness (the
 * {@code @DataJpaTest} + H2 PostgreSQL-mode + {@code CREATE DOMAIN JSONB AS JSON}
 * idiom) so the JSONB {@code detail_json} blobs round-trip through persist +
 * reload, and so the changeset's column DDL is exercised by the JPA mapping
 * (the entity mirrors the changeset 1:1). The
 * {@link MigrationReconciliationBreakService} is instantiated directly over the
 * autowired repository (the {@code @DataJpaTest} slice does not register
 * {@code @Service} beans), exercising the full create / read / PATCH null-guard
 * path.</p>
 *
 * <p>Focused tests (7 -- within the 2-8 budget per task 1.1):</p>
 * <ol>
 *   <li>bulk-create persists breaks for a run, keyed on run + pinned baseline +
 *       {@code source_baseline_item_id} (the resolution key); read returns them
 *       oldest-first.</li>
 *   <li>disposition PATCH updates ONLY the provided fields; a disposition-only
 *       PATCH leaves {@code attempt_count} / {@code bug_id} / {@code circuit_broken}
 *       intact (the boxed-type primitive-overwrite guard).</li>
 *   <li>{@code incrementAttempt} bumps the circuit-breaker counter
 *       non-destructively.</li>
 *   <li>{@code setCircuitBroken} trips the breaker + escalates to
 *       {@code circuit_broken_escalated} / {@code needs_human}.</li>
 *   <li>{@code markSent} stamps the {@code bug_id} + moves the batch to
 *       {@code sent_as_bug} (attempt 1).</li>
 *   <li>{@code findBreaksByBugId} resolves the breaks behind a bug (Group 4).</li>
 *   <li>{@code findBreaksBySourceBaselineItemId} resolves the break for a
 *       replayable source operation (the CD-6 scope key); an invalid disposition
 *       on create is rejected.</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:mrbreakdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class MigrationReconciliationBreakPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private MigrationReconciliationBreakRepository breakRepository;

    private MigrationReconciliationBreakService service;

    @BeforeEach
    void setUp() {
        service = new MigrationReconciliationBreakService(breakRepository);
    }

    private static Map<String, Object> detail(String method, String path, String summary) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("method", method);
        m.put("path", path);
        m.put("summary", summary);
        return m;
    }

    /**
     * A fresh OPEN break DTO. The 14 record components in order are:
     * id, runId, pinnedBaselineId, sourceBaselineItemId, diffItemId, detailJson,
     * dispositionStatus, bugId, attemptCount, circuitBroken, needsHuman,
     * errorDetail, createdAt, updatedAt.
     */
    private MigrationReconciliationBreakDto openBreak(
            UUID pinnedBaselineId, UUID sourceBaselineItemId, UUID diffItemId,
            Map<String, Object> detail) {
        return new MigrationReconciliationBreakDto(
            null, null, pinnedBaselineId, sourceBaselineItemId, diffItemId, detail,
            MigrationReconciliationBreakStatus.OPEN,
            null, null, null, null, null, null, null);
    }

    @Test
    @DisplayName("bulk-create persists breaks for a run keyed on run + pinned baseline + source_baseline_item_id; read returns them oldest-first")
    void bulkCreatePersistsBreaksKeyedOnRunAndKeys() {
        UUID runId = UUID.randomUUID();
        UUID pinnedBaselineId = UUID.randomUUID();
        UUID sourceItemA = UUID.randomUUID();
        UUID sourceItemB = UUID.randomUUID();

        List<MigrationReconciliationBreakDto> breaks = List.of(
            openBreak(pinnedBaselineId, sourceItemA, UUID.randomUUID(),
                detail("GET", "/accounts/{id}", "status_drift 200->500")),
            openBreak(pinnedBaselineId, sourceItemB, UUID.randomUUID(),
                detail("POST", "/transfers", "body_value_drift")));

        List<MigrationReconciliationBreakDto> created = service.createBreaks(runId, breaks);
        entityManager.flush();
        entityManager.clear();

        assertThat(created).hasSize(2);
        assertThat(created.get(0).id()).isNotNull();
        // Each break is bound to the path run id (not a body-supplied run_id).
        assertThat(created).allSatisfy(b -> assertThat(b.runId()).isEqualTo(runId));

        List<MigrationReconciliationBreakDto> readBack = service.getBreaksForRun(runId);
        assertThat(readBack).hasSize(2);
        // The oracle anchor (CD-1) + the resolution key (CD-6) round-trip.
        assertThat(readBack.get(0).pinnedBaselineId()).isEqualTo(pinnedBaselineId);
        assertThat(readBack.get(0).sourceBaselineItemId()).isEqualTo(sourceItemA);
        assertThat(readBack.get(1).sourceBaselineItemId()).isEqualTo(sourceItemB);
        // Born OPEN with attempt 0 + flags false (DB DEFAULTs).
        assertThat(readBack.get(0).dispositionStatus()).isEqualTo(MigrationReconciliationBreakStatus.OPEN);
        assertThat(readBack.get(0).attemptCount()).isZero();
        assertThat(readBack.get(0).circuitBroken()).isFalse();
        assertThat(readBack.get(0).needsHuman()).isFalse();
        // The inline break detail JSONB round-trips.
        assertThat(readBack.get(0).detailJson())
            .containsEntry("method", "GET")
            .containsEntry("path", "/accounts/{id}");
    }

    @Test
    @DisplayName("disposition PATCH updates only provided fields; a disposition-only PATCH leaves attempt_count/bug_id/circuit_broken intact (boxed guard)")
    void dispositionPatchDoesNotWipeOmittedFields() {
        UUID runId = UUID.randomUUID();
        MigrationReconciliationBreakDto created = service.createBreaks(runId, List.of(
            openBreak(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                detail("GET", "/ping", "drift")))).get(0);
        UUID breakId = created.id();

        // First PATCH: simulate a send -- set bug_id, attempt=2, circuit_broken=true.
        MigrationReconciliationBreakDto sendPatch = new MigrationReconciliationBreakDto(
            null, null, null, null, null, null,
            MigrationReconciliationBreakStatus.SENT_AS_BUG,
            "bug-keep-me", 2, Boolean.TRUE, null, null, null, null);
        service.updateBreak(breakId, sendPatch);
        entityManager.flush();
        entityManager.clear();

        // Second PATCH: human disposition only -- everything else null on the wire.
        MigrationReconciliationBreakDto dispositionOnly = new MigrationReconciliationBreakDto(
            null, null, null, null, null, null,
            MigrationReconciliationBreakStatus.ACCEPTED,
            null, null, null, null, null, null, null);
        service.updateBreak(breakId, dispositionOnly);
        entityManager.flush();
        entityManager.clear();

        MigrationReconciliationBreakDto reloaded =
            breakRepository.findById(breakId)
                .map(com.example.architecturemodel.mapper.MigrationReconciliationBreakMapper::toDto)
                .orElseThrow();
        assertThat(reloaded.dispositionStatus()).isEqualTo(MigrationReconciliationBreakStatus.ACCEPTED);
        assertThat(reloaded.attemptCount())
            .as("attempt_count must survive a disposition-only PATCH (boxed Integer + null-guard)")
            .isEqualTo(2);
        assertThat(reloaded.bugId())
            .as("bug_id must survive a disposition-only PATCH")
            .isEqualTo("bug-keep-me");
        assertThat(reloaded.circuitBroken())
            .as("circuit_broken must survive a disposition-only PATCH")
            .isTrue();
    }

    @Test
    @DisplayName("incrementAttempt bumps the circuit-breaker counter non-destructively")
    void incrementAttemptBumpsCounter() {
        UUID runId = UUID.randomUUID();
        MigrationReconciliationBreakDto created = service.createBreaks(runId, List.of(
            openBreak(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                detail("GET", "/x", "drift")))).get(0);
        UUID breakId = created.id();
        assertThat(created.attemptCount()).isZero();

        service.incrementAttempt(breakId);
        entityManager.flush();
        entityManager.clear();
        MigrationReconciliationBreakDto once = service.getBreaksForRun(runId).get(0);
        assertThat(once.attemptCount()).isEqualTo(1);

        service.incrementAttempt(breakId);
        entityManager.flush();
        entityManager.clear();
        MigrationReconciliationBreakDto twice = service.getBreaksForRun(runId).get(0);
        assertThat(twice.attemptCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("setCircuitBroken trips the breaker + escalates to circuit_broken_escalated/needs_human")
    void setCircuitBrokenEscalates() {
        UUID runId = UUID.randomUUID();
        MigrationReconciliationBreakDto created = service.createBreaks(runId, List.of(
            openBreak(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                detail("GET", "/y", "drift")))).get(0);
        UUID breakId = created.id();

        service.setCircuitBroken(breakId, true, true, "still differing after 1 re-run round");
        entityManager.flush();
        entityManager.clear();

        MigrationReconciliationBreakDto reloaded = service.getBreaksForRun(runId).get(0);
        assertThat(reloaded.circuitBroken()).isTrue();
        assertThat(reloaded.needsHuman()).isTrue();
        assertThat(reloaded.dispositionStatus())
            .isEqualTo(MigrationReconciliationBreakStatus.CIRCUIT_BROKEN_ESCALATED);
        assertThat(reloaded.errorDetail()).isEqualTo("still differing after 1 re-run round");
    }

    @Test
    @DisplayName("markSent stamps the bug_id + moves the batch to sent_as_bug (attempt 1); findBreaksByBugId resolves them")
    void markSentStampsBugAndResolvesByBugId() {
        UUID runId = UUID.randomUUID();
        List<MigrationReconciliationBreakDto> created = service.createBreaks(runId, List.of(
            openBreak(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                detail("GET", "/a", "drift")),
            openBreak(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                detail("GET", "/b", "drift"))));
        List<UUID> ids = created.stream().map(MigrationReconciliationBreakDto::id).toList();

        service.markSent("bug-42", ids);
        entityManager.flush();
        entityManager.clear();

        List<MigrationReconciliationBreakDto> byBug = service.findBreaksByBugId("bug-42");
        assertThat(byBug).hasSize(2);
        assertThat(byBug).allSatisfy(b -> {
            assertThat(b.bugId()).isEqualTo("bug-42");
            assertThat(b.dispositionStatus()).isEqualTo(MigrationReconciliationBreakStatus.SENT_AS_BUG);
            assertThat(b.attemptCount()).isEqualTo(1);
        });
    }

    @Test
    @DisplayName("findBreaksBySourceBaselineItemId resolves the break for a replayable source operation (CD-6 scope key)")
    void findBreaksBySourceBaselineItemIdResolves() {
        UUID runId = UUID.randomUUID();
        UUID sourceItem = UUID.randomUUID();
        service.createBreaks(runId, List.of(
            openBreak(UUID.randomUUID(), sourceItem, UUID.randomUUID(),
                detail("PUT", "/accounts/{id}", "drift")),
            openBreak(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                detail("GET", "/other", "drift"))));
        entityManager.flush();
        entityManager.clear();

        List<MigrationReconciliationBreakDto> matched =
            service.findBreaksBySourceBaselineItemId(sourceItem);
        assertThat(matched).hasSize(1);
        assertThat(matched.get(0).sourceBaselineItemId()).isEqualTo(sourceItem);
        assertThat(matched.get(0).detailJson()).containsEntry("path", "/accounts/{id}");
    }

    @Test
    @DisplayName("createBreaks rejects an invalid disposition status (service-layer validation)")
    void createBreaksRejectsInvalidDisposition() {
        UUID runId = UUID.randomUUID();
        MigrationReconciliationBreakDto bad = new MigrationReconciliationBreakDto(
            null, null, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
            detail("GET", "/z", "drift"),
            "not_a_real_status",
            null, null, null, null, null, null, null);

        try {
            service.createBreaks(runId, List.of(bad));
            assertThat(false).as("expected IllegalArgumentException for invalid disposition").isTrue();
        } catch (IllegalArgumentException e) {
            assertThat(e.getMessage()).contains("Invalid migration reconciliation break disposition status");
        }
    }
}
