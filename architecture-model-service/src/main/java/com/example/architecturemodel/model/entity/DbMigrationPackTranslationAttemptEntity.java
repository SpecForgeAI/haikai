package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * One attempt of the translation workbench loop -- Stored Proc &amp; Function
 * Behaviour Program, Spec 4 (changeset 231,
 * {@code db_migration_pack_translation_attempts}).
 *
 * <p>APPEND-ONLY evidence. Each loop iteration (translate -&gt; judge -&gt;
 * apply -&gt; reconcile) writes exactly one row carrying the draft it produced,
 * the judge verdict, the apply result, the parity report it was reconciled
 * against, the attempt verdict, the EVIDENCE RUNG the attempt was given
 * ({@code none | one | cluster | full} failing-scenario evidence) and any human
 * guidance that seeded the retry. The reviewer reads the history to see how a
 * routine converged -- or why it did not.</p>
 *
 * <p>{@code (translation_id, attempt_no)} is unique
 * ({@code uq_dmpta_translation_attempt}): a re-post of the same attempt number
 * is a CONFLICT, never a silent overwrite of the evidence.</p>
 *
 * <p>Snake_case wire by the AMS default -- entities are returned verbatim.</p>
 */
@Entity
@Table(
    name = "db_migration_pack_translation_attempts",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uq_dmpta_translation_attempt",
            columnNames = {"translation_id", "attempt_no"}
        )
    },
    indexes = {
        @Index(name = "ix_dmpta_pack", columnList = "pack_id")
    }
)
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DbMigrationPackTranslationAttemptEntity {

    public static final String VERDICT_RECONCILED = "reconciled";
    public static final String VERDICT_DIVERGENT = "divergent";
    public static final String VERDICT_APPLY_FAILED = "apply_failed";
    public static final String VERDICT_ABI_MISMATCH = "abi_mismatch";
    public static final String VERDICT_OVERFIT_SUSPECTED = "overfit_suspected";
    public static final String VERDICT_BLOCKED_BY_CALLEE = "blocked_by_callee";
    public static final String VERDICT_UNVERIFIED = "unverified";
    public static final String VERDICT_FAILED = "failed";

    /** All allowed attempt verdicts, mirroring chk_dmpta_verdict. */
    public static final Set<String> ALL_VERDICTS = Set.of(
        VERDICT_RECONCILED,
        VERDICT_DIVERGENT,
        VERDICT_APPLY_FAILED,
        VERDICT_ABI_MISMATCH,
        VERDICT_OVERFIT_SUSPECTED,
        VERDICT_BLOCKED_BY_CALLEE,
        VERDICT_UNVERIFIED,
        VERDICT_FAILED
    );

    @Id
    @Column(name = "id")
    private UUID id;

    /** Denormalised owner so the whole pack's attempt history is one read. */
    @Column(name = "pack_id", nullable = false)
    private UUID packId;

    @Column(name = "translation_id", nullable = false)
    private UUID translationId;

    /** 1-based; capped by PROC_TRANSLATE_ATTEMPT_CAP in the gateway. */
    @Column(name = "attempt_no", nullable = false)
    private Integer attemptNo;

    /** The PL/pgSQL draft this attempt produced. */
    @Column(name = "draft_content", columnDefinition = "TEXT")
    private String draftContent;

    /** The verdict-only judge output for this attempt, verbatim. */
    @Type(JsonType.class)
    @Column(name = "judge_verdict_json", columnDefinition = "jsonb")
    private Map<String, Object> judgeVerdictJson;

    /** The routine-apply result ({@code ok}, sqlstate / message / position). */
    @Type(JsonType.class)
    @Column(name = "apply_result_json", columnDefinition = "jsonb")
    private Map<String, Object> applyResultJson;

    /** {@code proc_parity_reports.id} this attempt was reconciled against. */
    @Column(name = "parity_report_id")
    private UUID parityReportId;

    /** One of {@link #ALL_VERDICTS}; chk_dmpta_verdict is the source of truth. */
    @Column(name = "verdict", nullable = false, length = 32)
    private String verdict;

    /**
     * The evidence rung the attempt was given: which failing scenarios (and
     * which dimensions of them) rode the prompt.
     */
    @Type(JsonType.class)
    @Column(name = "evidence_rungs_json", columnDefinition = "jsonb")
    private Map<String, Object> evidenceRungsJson;

    /** Human guidance that seeded this retry (the "Guidance &amp; retry" action). */
    @Column(name = "guidance_text", columnDefinition = "TEXT")
    private String guidanceText;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
