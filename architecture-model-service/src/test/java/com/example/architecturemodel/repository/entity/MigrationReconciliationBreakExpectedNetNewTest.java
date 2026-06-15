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
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * D6 service-layer tests for the new {@code expected_net_new} machine-set
 * terminal disposition (Non-Reconciling Work at Reconcile Time, 2026-06-14,
 * Spec 6 of 6 -- Task Group 1).
 *
 * <p>The gateway's post-diff auto-disposition pass PATCHes a {@code target_only}
 * break whose normalised {@code <METHOD> <path>} key matches a {@code net_new}
 * work item into {@code expected_net_new} -- so {@code validateDispositionStatus}
 * (the ONLY AMS validation gate) must accept it. There is NO new changeset: the
 * {@code disposition_status} column is plain TEXT; only
 * {@link MigrationReconciliationBreakStatus#ALL} (the validation set) and
 * {@link MigrationReconciliationBreakStatus#TERMINAL_HUMAN_DISPOSITIONS} (the
 * no-auto-loop terminal set) changed.</p>
 *
 * <p>Mirrors the {@link MigrationReconciliationBreakPersistenceTest} harness
 * (the {@code @DataJpaTest} + H2 PostgreSQL-mode + {@code CREATE DOMAIN JSONB AS
 * JSON} idiom; the {@link MigrationReconciliationBreakService} instantiated
 * directly over the autowired repository) -- it does NOT re-test the existing 8
 * dispositions.</p>
 *
 * <p>Focused tests (2 -- within the 2-3 budget per task 1.1):</p>
 * <ol>
 *   <li>a disposition PATCH to {@code expected_net_new} is ACCEPTED -- it
 *       validates, persists, and reads back; it IS a terminal disposition; and a
 *       human can OVERRIDE it back to {@code open} via the same PATCH path (D7),
 *       proving "terminal + machine-set + human-overridable".</li>
 *   <li>the validation gate is NOT weakened -- an unknown/garbage disposition is
 *       still rejected after adding {@code expected_net_new}.</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:mrbreakexpnndb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class MigrationReconciliationBreakExpectedNetNewTest {

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

    /** A fresh OPEN break DTO (14 components in the entity's canonical order). */
    private MigrationReconciliationBreakDto openBreak(
            UUID pinnedBaselineId, UUID sourceBaselineItemId, UUID diffItemId,
            Map<String, Object> detail) {
        return new MigrationReconciliationBreakDto(
            null, null, pinnedBaselineId, sourceBaselineItemId, diffItemId, detail,
            MigrationReconciliationBreakStatus.OPEN,
            null, null, null, null, null, null, null);
    }

    @Test
    @DisplayName("a break PATCHes to expected_net_new (validates + persists + reads back); it is terminal; a human can override it back to open")
    void expectedNetNew_validatesPersistsAndIsHumanOverridable() {
        // The D6 additive-endpoint terminal value is part of the validation set.
        assertThat(MigrationReconciliationBreakStatus.ALL)
            .as("expected_net_new must be in the validation set the only AMS gate checks")
            .contains(MigrationReconciliationBreakStatus.EXPECTED_NET_NEW);
        // It is terminal (no auto re-loop) -- in the same terminal set the
        // idempotent callback short-circuit consults.
        assertThat(MigrationReconciliationBreakStatus.TERMINAL_HUMAN_DISPOSITIONS)
            .as("expected_net_new is terminal: the loop must not bug/re-run it")
            .contains(MigrationReconciliationBreakStatus.EXPECTED_NET_NEW);

        UUID runId = UUID.randomUUID();
        // A target_only break is created with NO source operation (null
        // source_baseline_item_id), exactly as the diff runner emits target_only.
        MigrationReconciliationBreakDto created = service.createBreaks(runId, List.of(
            openBreak(UUID.randomUUID(), null, UUID.randomUUID(),
                detail("POST", "/accounts", "target_only")))).get(0);
        UUID breakId = created.id();
        assertThat(created.dispositionStatus()).isEqualTo(MigrationReconciliationBreakStatus.OPEN);

        // The gateway auto-disposition pass PATCHes the (already-created, visible)
        // break to the terminal expected_net_new with needs_human=false + an audit
        // note naming the matched work item on detail_json.
        Map<String, Object> auditDetail = new LinkedHashMap<>();
        auditDetail.put("operation", "POST /accounts");
        auditDetail.put("expected_net_new_matched_work_item_id", "wi-net-new-42");
        auditDetail.put("expected_net_new_note",
            "Auto-recognised as an additive net_new endpoint (matched work item wi-net-new-42).");
        MigrationReconciliationBreakDto autoDisposePatch = new MigrationReconciliationBreakDto(
            null, null, null, null, null, auditDetail,
            MigrationReconciliationBreakStatus.EXPECTED_NET_NEW,
            null, null, null, Boolean.FALSE, null, null, null);
        service.updateBreak(breakId, autoDisposePatch);
        entityManager.flush();
        entityManager.clear();

        MigrationReconciliationBreakDto reloaded = service.getBreaksForRun(runId).get(0);
        assertThat(reloaded.dispositionStatus())
            .as("the expected_net_new PATCH validates + persists + reads back")
            .isEqualTo(MigrationReconciliationBreakStatus.EXPECTED_NET_NEW);
        assertThat(reloaded.needsHuman())
            .as("an auto-recognised additive endpoint needs no human")
            .isFalse();
        assertThat(reloaded.detailJson())
            .as("the audit note naming the matched work item round-trips on detail_json")
            .containsEntry("expected_net_new_matched_work_item_id", "wi-net-new-42");

        // D7 human override: the SAME disposition PATCH path moves it back OUT of
        // expected_net_new to open (terminal never blocks a human re-classify).
        MigrationReconciliationBreakDto overridePatch = new MigrationReconciliationBreakDto(
            null, null, null, null, null, null,
            MigrationReconciliationBreakStatus.OPEN,
            null, null, null, Boolean.TRUE, null, null, null);
        service.updateBreak(breakId, overridePatch);
        entityManager.flush();
        entityManager.clear();

        MigrationReconciliationBreakDto afterOverride = service.getBreaksForRun(runId).get(0);
        assertThat(afterOverride.dispositionStatus())
            .as("a human can re-open a wrongly-matched expected_net_new break (D7)")
            .isEqualTo(MigrationReconciliationBreakStatus.OPEN);
    }

    @Test
    @DisplayName("the validation gate is NOT weakened: an unknown disposition is still rejected after adding expected_net_new")
    void garbageDisposition_stillRejected() {
        UUID runId = UUID.randomUUID();
        MigrationReconciliationBreakDto bad = new MigrationReconciliationBreakDto(
            null, null, UUID.randomUUID(), null, UUID.randomUUID(),
            detail("GET", "/z", "target_only"),
            "not_a_real_status",
            null, null, null, null, null, null, null);

        assertThatThrownBy(() -> service.createBreaks(runId, List.of(bad)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid migration reconciliation break disposition status");
    }
}
