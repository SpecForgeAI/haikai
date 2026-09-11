package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * JPA Entity for one per-object DB translation row (Liquibase changeset 176).
 * One row per object in the pack manifest's {@code requires_translation_spec_2}
 * list (stored procedure / trigger / view).
 *
 * <p>Translation rows are NOT pack file rows -- pack files are wholesale
 * delete+insert on regeneration, while this table is the DURABILITY
 * mechanism: rows survive regeneration via the stable {@link #translationKey}
 * identity ({@code kind--object_ref}, the {@code decision_key} analogue,
 * unique per pack via {@code uq_dmpt_pack_translation_key}) plus the
 * {@link #sourceBodyHash} re-link performed by the gateway.</p>

 * <p>Lifecycle fields are three ORTHOGONAL axes (settled spec):
 * {@link #pipelineState} ({@code pending -> translating -> drafted | failed
 * (retryable) | needs_manual (terminal)}), {@link #reviewStatus}
 * ({@code unreviewed -> approved | rejected | needs_rework}) and
 * {@link #disposition} ({@code translate (default) | rewrite_in_app | drop} +
 * mandatory {@link #dropReason}). A draft persists as {@code drafted} ONLY
 * together with its {@link #judgeVerdictJson}; only {@code approved}
 * translations are ever emitted into pack file rows / the master
 * changelog.</p>
 *
 * <p>{@link #truncated} / {@link #legacyRedacted} are boxed {@link Boolean}s
 * per {@code project_primitive_double_dto_overwrite.md} -- they participate
 * in upsert/PATCH semantics and must never be wiped to {@code false} by a
 * sparse payload.</p>
 *
 * <p>Spec: LLM-Assisted DB Object Translation Drafts (2026-06-11) --
 * Task Group 2.</p>
 */
@Entity
@Table(
    name = "db_migration_pack_translations",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uq_dmpt_pack_translation_key",
            columnNames = {"pack_id", "translation_key"}
        )
    },
    indexes = {
        @Index(name = "idx_dmpt_pack", columnList = "pack_id", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DbMigrationPackTranslationEntity {

    public static final String KIND_STORED_PROCEDURE = "stored_procedure";
    public static final String KIND_TRIGGER = "trigger";
    public static final String KIND_VIEW = "view";
    /**
     * 2026-08-07 (gold-standard C4, changeset 220): non-portable CHECK
     * expressions ride the queue as {@code check_constraint} (approved =
     * ALTER TABLE in 050-translations) and DB-resident jobs as
     * {@code scheduled_job} (approved = PL/pgSQL function + pg_cron
     * cron.schedule) — both previously died as manual residue.
     */
    public static final String KIND_CHECK_CONSTRAINT = "check_constraint";
    public static final String KIND_SCHEDULED_JOB = "scheduled_job";

    /** All allowed object kinds, mirroring chk_dmpt_kind (changeset 220). */
    public static final Set<String> ALL_KINDS = Set.of(
        KIND_STORED_PROCEDURE,
        KIND_TRIGGER,
        KIND_VIEW,
        KIND_CHECK_CONSTRAINT,
        KIND_SCHEDULED_JOB
    );

    public static final String DISPOSITION_TRANSLATE = "translate";
    public static final String DISPOSITION_REWRITE_IN_APP = "rewrite_in_app";
    public static final String DISPOSITION_DROP = "drop";

    /** All allowed dispositions, mirroring chk_dmpt_disposition. */
    public static final Set<String> ALL_DISPOSITIONS = Set.of(
        DISPOSITION_TRANSLATE,
        DISPOSITION_REWRITE_IN_APP,
        DISPOSITION_DROP
    );

    public static final String STATE_PENDING = "pending";
    public static final String STATE_TRANSLATING = "translating";
    public static final String STATE_DRAFTED = "drafted";
    public static final String STATE_FAILED = "failed";
    public static final String STATE_NEEDS_MANUAL = "needs_manual";

    /** All allowed pipeline states, mirroring chk_dmpt_pipeline_state. */
    public static final Set<String> ALL_PIPELINE_STATES = Set.of(
        STATE_PENDING,
        STATE_TRANSLATING,
        STATE_DRAFTED,
        STATE_FAILED,
        STATE_NEEDS_MANUAL
    );

    public static final String REVIEW_UNREVIEWED = "unreviewed";
    public static final String REVIEW_APPROVED = "approved";
    public static final String REVIEW_REJECTED = "rejected";
    public static final String REVIEW_NEEDS_REWORK = "needs_rework";

    /** All allowed review statuses, mirroring chk_dmpt_review_status. */
    public static final Set<String> ALL_REVIEW_STATUSES = Set.of(
        REVIEW_UNREVIEWED,
        REVIEW_APPROVED,
        REVIEW_REJECTED,
        REVIEW_NEEDS_REWORK
    );

    public static final String LOOP_IDLE = "idle";
    public static final String LOOP_QUEUED = "queued";
    public static final String LOOP_TRANSLATING = "translating";
    public static final String LOOP_APPLYING = "applying";
    public static final String LOOP_RECONCILING = "reconciling";
    public static final String LOOP_RECONCILED = "reconciled";
    public static final String LOOP_EXHAUSTED = "exhausted";
    public static final String LOOP_APPLY_FAILED = "apply_failed";
    public static final String LOOP_UNVERIFIED = "unverified";
    public static final String LOOP_STALE = "stale";
    public static final String LOOP_BLOCKED_BY_CALLEE = "blocked_by_callee";
    public static final String LOOP_DISPOSITIONED = "dispositioned";

    /**
     * All allowed workbench loop states, mirroring chk_dmpt_loop_status
     * (changeset 231, Stored Proc &amp; Function Behaviour Program, Spec 4).
     */
    public static final Set<String> ALL_LOOP_STATUSES = Set.of(
        LOOP_IDLE,
        LOOP_QUEUED,
        LOOP_TRANSLATING,
        LOOP_APPLYING,
        LOOP_RECONCILING,
        LOOP_RECONCILED,
        LOOP_EXHAUSTED,
        LOOP_APPLY_FAILED,
        LOOP_UNVERIFIED,
        LOOP_STALE,
        LOOP_BLOCKED_BY_CALLEE,
        LOOP_DISPOSITIONED
    );

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "pack_id", nullable = false)
    private UUID packId;

    /**
     * Stable identity {@code kind--object_ref}. Unique per pack so
     * regeneration re-links instead of duplicating.
     */
    @Column(name = "translation_key", nullable = false, columnDefinition = "TEXT")
    private String translationKey;

    /** Human-readable schema.object reference. */
    @Column(name = "object_ref", columnDefinition = "TEXT")
    private String objectRef;

    /** One of {@link #ALL_KINDS}; chk_dmpt_kind is the source of truth. */
    @Column(name = "kind", nullable = false, length = 32)
    private String kind;

    /** One of {@link #ALL_DISPOSITIONS}; chk_dmpt_disposition is the source of truth. */
    @Column(name = "disposition", nullable = false, length = 32)
    @Builder.Default
    private String disposition = DISPOSITION_TRANSLATE;

    /** Mandatory rationale when {@link #disposition} is {@code drop}. */
    @Column(name = "drop_reason", columnDefinition = "TEXT")
    private String dropReason;

    /** One of {@link #ALL_PIPELINE_STATES}; chk_dmpt_pipeline_state is the source of truth. */
    @Column(name = "pipeline_state", nullable = false, length = 32)
    @Builder.Default
    private String pipelineState = STATE_PENDING;

    /** The captured (redacted, size-capped) source T-SQL body. */
    @Column(name = "source_body", columnDefinition = "TEXT")
    private String sourceBody;

    /** SHA-256 of {@link #sourceBody} -- the regeneration re-link change detector. */
    @Column(name = "source_body_hash", length = 80)
    private String sourceBodyHash;

    /**
     * The {@code db_routines} row this translation's body came from (Stored
     * Proc &amp; Function Behaviour Program, Spec 1, changeset 229). Null for
     * rows seeded from a finding snippet (pre-catalog runs) and for kinds
     * the catalog does not cover (views, scheduled jobs, check constraints).
     */
    @Column(name = "routine_id")
    private UUID routineId;

    /** Fidelity flag: body truncated at capture (64KB cap). Boxed -- PATCH-safe. */
    @Column(name = "truncated")
    private Boolean truncated;

    /**
     * Fidelity flag: body captured under the LEGACY blanket-literal-collapse
     * policy (no {@code literal_policy: targeted_v2} marker on the finding).
     * Boxed -- PATCH-safe.
     */
    @Column(name = "legacy_redacted")
    private Boolean legacyRedacted;

    /** The LLM-translated PL/pgSQL draft. Emitted ONLY when approved. */
    @Column(name = "draft_content", columnDefinition = "TEXT")
    private String draftContent;

    /**
     * The verdict-only judge output, stored verbatim:
     * {@code {verdict, confidence, flags: [{construct, concern, severity}]}}.
     */
    @Type(JsonType.class)
    @Column(name = "judge_verdict_json", columnDefinition = "jsonb")
    private Map<String, Object> judgeVerdictJson;

    /** One of {@link #ALL_REVIEW_STATUSES}; chk_dmpt_review_status is the source of truth. */
    @Column(name = "review_status", nullable = false, length = 32)
    @Builder.Default
    private String reviewStatus = REVIEW_UNREVIEWED;

    @Column(name = "reviewer_notes", columnDefinition = "TEXT")
    private String reviewerNotes;

    /**
     * Workbench loop state -- one of {@link #ALL_LOOP_STATUSES};
     * chk_dmpt_loop_status is the source of truth (changeset 231). ORTHOGONAL
     * to {@link #pipelineState} / {@link #reviewStatus} / {@link #disposition}:
     * the loop drives translate -&gt; apply -&gt; reconcile, the other three
     * axes stay exactly what they were.
     */
    @Column(name = "loop_status", nullable = false, length = 32)
    @Builder.Default
    private String loopStatus = LOOP_IDLE;

    /** Attempt the loop is currently on; 0 = never attempted. */
    @Column(name = "current_attempt_no", nullable = false)
    @Builder.Default
    private Integer currentAttemptNo = 0;

    /**
     * On exhaustion, the attempt with the fewest failing scenarios -- its
     * draft becomes {@link #draftContent}. Null until the loop exhausts.
     */
    @Column(name = "best_attempt_no")
    private Integer bestAttemptNo;

    /** Rolled-up loop verdict for the row (match n of m, divergent dimensions, ...). */
    @Type(JsonType.class)
    @Column(name = "verdict_json", columnDefinition = "jsonb")
    private Map<String, Object> verdictJson;

    /** {@code proc_parity_reports.id} backing the current verdict. */
    @Column(name = "parity_report_id")
    private UUID parityReportId;

    /** Why the row went stale (source body changed, baseline re-pinned, target rebuilt). */
    @Column(name = "stale_reason", length = 64)
    private String staleReason;

    /**
     * Named reason the source object is not attempted by the translator
     * (changeset 233, second-pair programme): cross_database_reference,
     * indexed_view, clr_object, service_broker_object, filestream. Null = the
     * object is translatable. Vocabulary is pair data (no CHECK).
     */
    @Column(name = "untranslatable_reason", length = 64)
    private String untranslatableReason;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    /** Stamped when a draft (+ verdict) is persisted. */
    @Column(name = "translated_at")
    private Instant translatedAt;

    /** Stamped when a review action is persisted. */
    @Column(name = "reviewed_at")
    private Instant reviewedAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (disposition == null) {
            disposition = DISPOSITION_TRANSLATE;
        }
        if (pipelineState == null) {
            pipelineState = STATE_PENDING;
        }
        if (reviewStatus == null) {
            reviewStatus = REVIEW_UNREVIEWED;
        }
        if (loopStatus == null) {
            loopStatus = LOOP_IDLE;
        }
        if (currentAttemptNo == null) {
            currentAttemptNo = 0;
        }
    }
}
