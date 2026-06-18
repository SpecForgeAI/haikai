package com.example.architecturemodel.model.entity.apibehaviour;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Saved API Behaviour Baseline header.
 *
 * <p>The durable artefact produced from accepted captures. Each baseline
 * carries summary counts plus a status (draft / active / archived) and
 * references the originating capture session via {@code session_id}.</p>
 *
 * <p>Capture sessions cascade-delete their child rows (scenarios, captures,
 * diagnostics, operations) but baseline rows survive a session deletion —
 * the FK to session is retained as a soft reference rather than a CASCADE so
 * historical baselines outlive the throwaway capture session. Cascade is
 * only on project deletion.</p>
 *
 * <p>Allowed {@code status} values (validated at service layer):
 * {@code draft}, {@code active}, {@code archived}.</p>
 *
 * <p><b>Numeric summary counts</b> are <b>boxed</b> {@link Integer} so PATCH
 * preserves {@code null}. See project memory note
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <h2>Kind discriminator (Spec: 2026-05-25 API Test Harness — Target-Side Capture)</h2>
 * <p>The {@code kind} column distinguishes a current-state baseline (produced
 * by the LLM-driven capture loop) from a target-side baseline (produced by
 * the replay loop against a target URL). Valid values: {@code current} |
 * {@code target}. Validated at the service layer (no DB enum, matches the
 * existing AMS convention for status discriminators).</p>
 *
 * <p>{@code pairedWithBaselineId} is a self-FK from a target baseline back at
 * the source current-state baseline it was replayed from. Service-layer
 * invariant: target baselines MUST have a non-null pair; current baselines
 * MUST have it null. ON DELETE SET NULL keeps the target alive as an
 * unmoored row if the source is deleted.</p>
 *
 * <h2>Integrity + provenance (Spec: 2026-06-17 Baseline Integrity &amp; Provenance)</h2>
 * <p>{@code contentHash} + {@code provenanceJson} make the pinned current-state
 * oracle tamper-EVIDENT + auditable. Both are stamped server-side at the
 * draft→active ACTIVATE transition (see
 * {@link com.example.architecturemodel.service.apibehaviour.ApiBehaviourBaselineService})
 * over the items AS PERSISTED, in the same transaction as the activation, and
 * ONLY for {@code kind='current'} baselines. Drafts and {@code kind='target'}
 * baselines carry neither. Both are nullable reference types (no primitive-wipe
 * risk) with NO backfill — a null hash is "no integrity hash recorded"
 * (neutral, NOT a mismatch).</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 1
 * (initial fields). API Test Harness — Target-Side Capture (2026-05-25) —
 * Task Group 1 (kind + pairedWithBaselineId). Baseline Integrity &amp;
 * Provenance (2026-06-17) — Task Group 1 (contentHash + provenanceJson).</p>
 */
@Entity
@Table(
    name = "api_behaviour_baselines",
    indexes = {
        @Index(
            name = "idx_api_behaviour_baseline_proj_arch_status",
            columnList = "project_id, architecture_id, status"
        )
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApiBehaviourBaselineEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    @Column(name = "session_id", nullable = false)
    private UUID sessionId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "status", nullable = false)
    @Builder.Default
    private String status = "draft";

    /** Boxed {@link Integer} so PATCH preserves {@code null}. */
    @Column(name = "accepted_capture_count")
    private Integer acceptedCaptureCount;

    /** Boxed {@link Integer} so PATCH preserves {@code null}. */
    @Column(name = "operation_count")
    private Integer operationCount;

    @Column(name = "notes")
    private String notes;

    /**
     * Discriminator. Valid values: {@code current} | {@code target}.
     * Validated at the service layer.
     *
     * <p>Reference type ({@link String}) — no primitive-wipe risk per
     * {@code project_primitive_double_dto_overwrite.md}.</p>
     */
    @Column(name = "kind", nullable = false)
    @Builder.Default
    private String kind = "current";

    /**
     * Self-FK from a target baseline back at the source current-state
     * baseline it was replayed from. Service-layer invariant: target
     * baselines MUST have a non-null pair; current baselines MUST have
     * it null.
     *
     * <p>Reference type ({@link UUID}) — no primitive-wipe risk per
     * {@code project_primitive_double_dto_overwrite.md}.</p>
     */
    @Column(name = "paired_with_baseline_id")
    private UUID pairedWithBaselineId;

    /**
     * Deterministic SHA-256 (lowercase hex) over the CANONICAL form of this
     * baseline's item set, stamped server-side at the draft→active ACTIVATE
     * transition over the items AS PERSISTED. Makes the pinned oracle
     * tamper-EVIDENT: the verify operation recomputes the same canonical hash
     * over the current stored items and compares.
     *
     * <p><b>{@code null} = pre-existing / never-activated (draft) baseline</b>
     * (NO backfill) — treated as "no integrity hash recorded" (neutral, NOT a
     * mismatch). Stamped only on transition INTO active and only for
     * {@code kind='current'} baselines; drafts and {@code kind='target'}
     * baselines stay null. Reference type ({@link String}) — no primitive-wipe
     * risk per {@code project_primitive_double_dto_overwrite.md}.</p>
     *
     * <p>The canonical form (and the volatile-pinning-vs-tolerance distinction)
     * is documented on the hashing util in
     * {@link com.example.architecturemodel.service.apibehaviour.ApiBehaviourBaselineService}.</p>
     *
     * <p>Spec: Baseline Integrity &amp; Provenance (2026-06-17) — Task Group 1
     * (changeset 191).</p>
     */
    @Column(name = "content_hash")
    private String contentHash;

    /**
     * Audit record stamped at the draft→active ACTIVATE transition, shaped
     * {@code { session_id, environment_name, activated_at, coverage_score,
     * coverage_summary, accepted_capture_count, operation_count,
     * hash_algo: "sha256", canonical_version: 1 }}. {@code coverage_score} is
     * Spec A's {@code overall_score} read from the linked capture session's
     * {@code coverage_summary_json} (changeset 189) via {@code session_id};
     * {@code null} when the session has no summary (legacy) — never fabricated.
     *
     * <p><b>{@code null} = pre-existing / never-activated baseline</b> (NO
     * backfill). JSONB column via {@code @Type(JsonType.class)}, mirroring the
     * sibling JSONB columns on the capture-session entity; reference type, no
     * primitive-wipe risk per {@code project_primitive_double_dto_overwrite.md}.</p>
     *
     * <p>Spec: Baseline Integrity &amp; Provenance (2026-06-17) — Task Group 1
     * (changeset 191).</p>
     */
    @Type(JsonType.class)
    @Column(name = "provenance_json", columnDefinition = "jsonb")
    private Map<String, Object> provenanceJson;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    protected void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        if (updatedAt == null) {
            updatedAt = now;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
