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

    /** All allowed object kinds, mirroring chk_dmpt_kind. */
    public static final Set<String> ALL_KINDS = Set.of(
        KIND_STORED_PROCEDURE,
        KIND_TRIGGER,
        KIND_VIEW
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
    }
}
