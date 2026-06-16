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
 * Task Group 1 service-layer tests for the new {@code expected_volatile}
 * machine-set terminal disposition (Reconcile-Time Determinism &amp;
 * Volatile-Value Handling, 2026-06-16 -- Task Group 1).
 *
 * <p>The gateway's post-diff auto-disposition pass PATCHes a break whose value /
 * ordering divergence lands entirely on measured-volatile paths into
 * {@code expected_volatile} -- so {@code validateDispositionStatus} (the ONLY
 * AMS validation gate) must accept it, and the no-auto-loop short-circuit must
 * treat it as terminal. There is NO new changeset for the disposition value: the
 * {@code disposition_status} column is plain TEXT; only
 * {@link MigrationReconciliationBreakStatus#ALL} (the validation set) and
 * {@link MigrationReconciliationBreakStatus#TERMINAL_HUMAN_DISPOSITIONS} (the
 * no-auto-loop terminal set) changed.</p>
 *
 * <p>Mirrors the {@link MigrationReconciliationBreakExpectedNetNewTest} harness
 * (the {@code @DataJpaTest} + H2 PostgreSQL-mode + {@code CREATE DOMAIN JSONB AS
 * JSON} idiom; the {@link MigrationReconciliationBreakService} instantiated
 * directly over the autowired repository) -- it does NOT re-test the existing
 * dispositions.</p>
 *
 * <p>Focused tests (2 -- within the 2-8 budget per task 1.1):</p>
 * <ol>
 *   <li>{@code expected_volatile} is in BOTH the validation set AND the terminal
 *       set, a PATCH to it validates + persists + reads back with
 *       {@code needs_human=false} + the audit note, and a human can OVERRIDE it
 *       back to {@code open} via the same PATCH path (machine-set + terminal +
 *       human-overridable).</li>
 *   <li>the validation gate is NOT weakened -- an unknown disposition is still
 *       rejected after adding {@code expected_volatile}.</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:mrbreakexpvoldb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class MigrationReconciliationBreakExpectedVolatileTest {

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
    @DisplayName("a break PATCHes to expected_volatile (validates + persists + reads back); it is terminal; a human can override it back to open")
    void expectedVolatile_validatesPersistsAndIsHumanOverridable() {
        // The measured-volatility terminal value is part of the validation set.
        assertThat(MigrationReconciliationBreakStatus.ALL)
            .as("expected_volatile must be in the validation set the only AMS gate checks")
            .contains(MigrationReconciliationBreakStatus.EXPECTED_VOLATILE);
        // It is terminal (no auto re-loop) -- in the same terminal set the
        // idempotent callback short-circuit consults.
        assertThat(MigrationReconciliationBreakStatus.TERMINAL_HUMAN_DISPOSITIONS)
            .as("expected_volatile is terminal: the loop must not bug/re-run it")
            .contains(MigrationReconciliationBreakStatus.EXPECTED_VOLATILE);

        UUID runId = UUID.randomUUID();
        UUID sourceBaselineItemId = UUID.randomUUID();
        // A drifting break is created OPEN by the diff runner.
        MigrationReconciliationBreakDto created = service.createBreaks(runId, List.of(
            openBreak(UUID.randomUUID(), sourceBaselineItemId, UUID.randomUUID(),
                detail("GET", "/widgets", "value_changed")))).get(0);
        UUID breakId = created.id();
        assertThat(created.dispositionStatus()).isEqualTo(MigrationReconciliationBreakStatus.OPEN);

        // The gateway auto-disposition pass PATCHes the (already-created, visible)
        // break to the terminal expected_volatile with needs_human=false + an
        // audit note listing the volatile paths + their source on detail_json.
        Map<String, Object> auditDetail = new LinkedHashMap<>();
        auditDetail.put("operation", "GET /widgets");
        auditDetail.put("expected_volatile_paths", List.of("/createdAt", "/items"));
        auditDetail.put("expected_volatile_source", "probed");
        auditDetail.put("expected_volatile_note",
            "Auto-recognised as legitimately volatile (paths /createdAt, /items; source probed).");
        MigrationReconciliationBreakDto autoDisposePatch = new MigrationReconciliationBreakDto(
            null, null, null, null, null, auditDetail,
            MigrationReconciliationBreakStatus.EXPECTED_VOLATILE,
            null, null, null, Boolean.FALSE, null, null, null);
        service.updateBreak(breakId, autoDisposePatch);
        entityManager.flush();
        entityManager.clear();

        MigrationReconciliationBreakDto reloaded = service.getBreaksForRun(runId).get(0);
        assertThat(reloaded.dispositionStatus())
            .as("the expected_volatile PATCH validates + persists + reads back")
            .isEqualTo(MigrationReconciliationBreakStatus.EXPECTED_VOLATILE);
        assertThat(reloaded.needsHuman())
            .as("an auto-recognised volatile divergence needs no human")
            .isFalse();
        assertThat(reloaded.detailJson())
            .as("the audit note naming the volatile source round-trips on detail_json")
            .containsEntry("expected_volatile_source", "probed");

        // Human override: the SAME disposition PATCH path moves it back OUT of
        // expected_volatile to open (terminal never blocks a human re-classify --
        // the "oracle always breaks on a real divergence" invariant is preserved).
        MigrationReconciliationBreakDto overridePatch = new MigrationReconciliationBreakDto(
            null, null, null, null, null, null,
            MigrationReconciliationBreakStatus.OPEN,
            null, null, null, Boolean.TRUE, null, null, null);
        service.updateBreak(breakId, overridePatch);
        entityManager.flush();
        entityManager.clear();

        MigrationReconciliationBreakDto afterOverride = service.getBreaksForRun(runId).get(0);
        assertThat(afterOverride.dispositionStatus())
            .as("a human can re-open an over-broadly-tolerated expected_volatile break")
            .isEqualTo(MigrationReconciliationBreakStatus.OPEN);
    }

    @Test
    @DisplayName("the validation gate is NOT weakened: an unknown disposition is still rejected after adding expected_volatile")
    void garbageDisposition_stillRejected() {
        UUID runId = UUID.randomUUID();
        MigrationReconciliationBreakDto bad = new MigrationReconciliationBreakDto(
            null, null, UUID.randomUUID(), null, UUID.randomUUID(),
            detail("GET", "/z", "value_changed"),
            "not_a_real_status",
            null, null, null, null, null, null, null);

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.createBreaks(runId, List.of(bad)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid migration reconciliation break disposition status");
    }
}
