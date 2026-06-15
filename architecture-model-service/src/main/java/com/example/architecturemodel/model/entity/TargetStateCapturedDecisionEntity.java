package com.example.architecturemodel.model.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.Check;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA Entity for {@code target_state_captured_decisions} -- the first-class
 * artifact carrying architect-persona captured decisions for a target-state
 * architecture.
 *
 * <p>Spec: Target State Captured Decisions -- Data Plane
 * (2026-05-24-target-state-captured-decisions-data-plane) -- Task Group 1.</p>
 *
 * <p>One row per answered concern question, scoped architecture-wide /
 * per-service / per-interface / per-element. The table is empty in every
 * environment until Spec 3 starts writing through the architect-persona
 * conversation; this spec ships the rails only.</p>
 *
 * <p><b>Insert-only at the data plane.</b> Decisions are immutable once
 * written (per D6). To "change" a decision the service layer
 * ({@code TargetStateCapturedDecisionService.createDecision}) inserts a new
 * row and atomically sets the prior matching-tuple row's
 * {@link #supersededById} to the new row's id inside the same transaction.
 * No PATCH / PUT / DELETE endpoints exist.</p>
 *
 * <p><b>Scope invariant (enforced by the DB CHECK constraint
 * {@code chk_tscd_scope_invariant} and mirrored here via Hibernate
 * {@link Check}):</b></p>
 * <ul>
 *   <li>{@code scope_kind='element'} iff {@code scope_ref_type IS NOT NULL}.</li>
 *   <li>{@code scope_kind='architecture'} iff {@code scope_ref_id IS NULL}.</li>
 * </ul>
 *
 * <p>Together these encode the rule that architecture-scope rows carry no ref
 * id and no ref type; service / interface-scope rows carry a ref id but no ref
 * type; element-scope rows carry both a ref id and a ref type. The Hibernate
 * {@code @Check} mirrors the SQL CHECK from changeset 155 so the constraint
 * is enforceable in the H2-based test environment (which uses
 * {@code ddl-auto=create-drop} with Liquibase disabled), matching the pattern
 * established by {@link ApplicationPointEntity} and
 * {@link InfrastructurePointEntity}.</p>
 *
 * <p><b>Self-FK on {@link #supersededById}:</b> this is the first self-FK in
 * the Architecture Model Service. Mapped as a writable raw {@link UUID}
 * column ({@link #supersededById}) plus a read-only lazy
 * {@code @ManyToOne} navigation ({@link #supersededBy}) -- both backed by the
 * same {@code superseded_by_id} database column. The {@code @ManyToOne} side
 * is marked {@code insertable = false, updatable = false} so writes are
 * routed exclusively through the raw-UUID setter, which is what the
 * supersession code path in
 * {@code TargetStateCapturedDecisionService.createDecision} needs (it
 * already has the new row's id in hand and does not need a second managed
 * entity reference).</p>
 *
 * <p>We deliberately do NOT add a reverse
 * {@code @OneToMany(mappedBy = "supersededBy")} collection because this spec
 * has no reverse-traversal need; downstream reads filter by
 * {@code supersededById IS NULL} via repository queries rather than walking a
 * managed collection. Keeping the entity lean avoids unnecessary fetch joins
 * and lazy-loading footguns in serialization paths.</p>
 *
 * <p><b>Boxed types for PATCH safety:</b> all editable fields here are boxed
 * reference types ({@link String}, {@link UUID}, {@link Instant}). No
 * primitives appear. This spec uses POST-only writes (no PATCH), but staying
 * consistent with {@code project_primitive_double_dto_overwrite.md} keeps the
 * door open for future evolution without silent zero-overwrites.</p>
 */
@Entity
@Table(
    name = "target_state_captured_decisions",
    indexes = {
        @Index(
            name = "idx_target_state_captured_decisions_project_target",
            columnList = "project_id, target_architecture_id"
        ),
        @Index(
            name = "idx_target_state_captured_decisions_latest_per_scope",
            columnList = "project_id, target_architecture_id, decision_code, scope_kind, scope_ref_id"
        ),
        @Index(
            name = "idx_target_state_captured_decisions_decision_code",
            columnList = "decision_code"
        )
    }
)
@Check(constraints =
    "( "
    + "  ( "
    + "    (scope_kind = 'element' AND scope_ref_type IS NOT NULL) "
    + "    OR (scope_kind IN ('architecture', 'service', 'interface') AND scope_ref_type IS NULL) "
    + "  ) "
    + "  AND "
    + "  ( "
    + "    (scope_kind = 'architecture' AND scope_ref_id IS NULL) "
    + "    OR (scope_kind IN ('service', 'interface', 'element') AND scope_ref_id IS NOT NULL) "
    + "  ) "
    + ")")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TargetStateCapturedDecisionEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "target_architecture_id", nullable = false)
    private UUID targetArchitectureId;

    /**
     * Stable opaque decision code (e.g. {@code db.engine}, {@code api.protocol},
     * {@code service.framework}). Open-ended by design (per Q7) -- the
     * Architecture Model Service does not validate this against an enum.
     * Spec 3 owns the question library and is the single writer; typo cost is
     * "downstream sees no decisions found and the architect re-answers."
     */
    @Column(name = "decision_code", nullable = false, length = 255)
    private String decisionCode;

    /**
     * Scope kind. One of {@code architecture} / {@code service} /
     * {@code interface} / {@code element}. Stored as {@link String} (not a
     * Java enum) to match the existing Architecture Model Service family
     * pattern.
     */
    @Column(name = "scope_kind", nullable = false, length = 32)
    private String scopeKind;

    /**
     * Element supertype table indicator. Populated ONLY when
     * {@code scope_kind='element'}. NULL for all other scope kinds. Enforced
     * via the scope invariant CHECK constraint.
     */
    @Column(name = "scope_ref_type", length = 64)
    private String scopeRefType;

    /**
     * Target-side element id. NULL only when {@code scope_kind='architecture'}.
     * Populated for service / interface / element scopes. Enforced via the
     * scope invariant CHECK constraint.
     */
    @Column(name = "scope_ref_id", length = 255)
    private String scopeRefId;

    @Column(name = "answer_value", nullable = false, columnDefinition = "TEXT")
    private String answerValue;

    /**
     * Optional short label for the answer, suitable for prompt-ready summary
     * lines rendered by the gateway resolver. May be NULL when the architect
     * supplied only a free-form {@link #answerValue}.
     */
    @Column(name = "answer_summary", length = 1024)
    private String answerSummary;

    /**
     * Optional opaque reference into the standards registry. Format TBD by
     * Spec 3. Nullable -- not every decision is grounded in a standards
     * lookup.
     */
    @Column(name = "standards_lookup_ref", length = 255)
    private String standardsLookupRef;

    /**
     * Optional reference to the architect-persona conversation thread that
     * produced this decision. Spec 3 wires this; nullable for backfill /
     * direct-write tolerance.
     */
    @Column(name = "conversation_thread_id", length = 255)
    private String conversationThreadId;

    /**
     * Optional reference to the turn index within the conversation thread
     * that produced this decision. Spec 3 wires this; nullable for the same
     * reason as {@link #conversationThreadId}.
     */
    @Column(name = "conversation_turn_ref", length = 255)
    private String conversationTurnRef;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /**
     * Task identifier for audit. NOT NULL with NO DB default (per Q9) --
     * callers must pass it explicitly. Spec 3 will pass
     * {@code architect-persona-conversation}; future tasks pass their own
     * task identifier.
     */
    @Column(name = "created_by_task", nullable = false, length = 255)
    private String createdByTask;

    /**
     * Self-FK column (writable side). NULL while this row is the latest
     * decision for its {@code (decision_code, scope)} tuple; non-null after
     * a new row has superseded it.
     *
     * <p>Writes go through this raw-UUID setter; the companion
     * {@link #supersededBy} {@code @ManyToOne} navigation is marked
     * {@code insertable = false, updatable = false} so the two fields cannot
     * fight over the same column.</p>
     */
    @Column(name = "superseded_by_id")
    private UUID supersededById;

    /**
     * Lazy {@code @ManyToOne} navigation back to the superseding row
     * (read-only -- writes go through {@link #supersededById}). This is the
     * first self-FK in the Architecture Model Service; mapped lean (no
     * reverse {@code @OneToMany}) because this spec has no reverse-traversal
     * need.
     *
     * <p>Both this field and {@link #supersededById} are backed by the
     * single {@code superseded_by_id} database column. Hibernate will hydrate
     * this navigation on demand if downstream code traverses it, but the
     * primary access path for tests and the future supersession-aware
     * service code is the raw {@link UUID} on {@link #supersededById}.</p>
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "superseded_by_id", insertable = false, updatable = false)
    private TargetStateCapturedDecisionEntity supersededBy;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
