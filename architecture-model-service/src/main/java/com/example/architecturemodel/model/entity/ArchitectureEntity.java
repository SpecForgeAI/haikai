package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA Entity for Architecture.
 *
 * Maps to the `architecture` table introduced by migration 087. Represents a
 * named architecture variant scoped under a project. Every project has at
 * least one architecture (the migration-created `Default`); spec #2 and #3
 * allow users to add more.
 *
 * The "Default" architecture for a project is identified at runtime as the
 * oldest non-archived architecture for that project (lowest created_at). No
 * is_default flag -- this survives renames, additions, and archives.
 *
 * <p><b>Target Architecture Authoring Flow extension (2026-05-20, Task Group 1):</b>
 * Liquibase changeset 144 adds two new discriminator columns,
 * {@link #draftState} and {@link #kind}, that let the same table carry both
 * current-state and target-state architecture rows. Both are boxed
 * {@link String} reference types so PATCH semantics preserve null per
 * {@code project_primitive_double_dto_overwrite.md} -- a request that omits
 * the field never wipes the column.</p>
 *
 * <p><b>Target Architecture Authoring Flow extension (2026-05-20, Task Group 3):</b>
 * Liquibase changeset 147 adds {@link #lastMarkedStaleAt}, the debounce
 * anchor for the active-target stale-marking pipeline. Boxed {@link Instant}
 * (NEVER primitive) so PATCH semantics preserve null.</p>
 *
 * <p><b>Vulnerability Reduction + Steering extension (2026-06-24, Spec 4, Task
 * Group 4):</b> Liquibase changeset 198 adds the
 * "proceed with remaining criticals" override audit trio
 * ({@link #proceedCriticalOverrideJustification},
 * {@link #proceedRemainingCriticalCount}, {@link #proceedCriticalOverrideAt}).
 * The architect-conversation proceed step hard-gates on any remaining CRITICAL
 * CVE; overriding it records this audit trio ONCE PER TARGET ARCHITECTURE
 * (the proceed step is scoped to a target architecture), mirroring the
 * capture-session coverage-override trio (changeset 178). All three are NULLABLE
 * and boxed (NEVER primitive) so PATCH semantics preserve null per
 * {@code project_primitive_double_dto_overwrite.md} -- a request that omits a
 * field never silently wipes the column, and an un-overridden architecture
 * carries all three null.</p>
 *
 * Spec: Multi-Architecture Plumbing (Spec #1).
 * Extended: Target Architecture Authoring Flow (2026-05-20) -- Task Groups 1 and 3.
 * Extended: Vulnerability Reduction + Steering (2026-06-24) -- Task Group 4.
 */
@Entity
@Table(name = "architecture")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ArchitectureEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "archived", nullable = false)
    @Builder.Default
    private Boolean archived = false;

    /**
     * Draft lifecycle position. Allowed persisted values are
     * {@code active} and {@code draft}. Drafts of a target architecture carry
     * {@code draft}; the single promoted target carries {@code active}.
     * Current-state rows always carry {@code active} in v1.
     *
     * <p>NOT NULL at the DB level with DEFAULT {@code 'active'}; the entity's
     * {@link #onCreate()} defaulter mirrors this so a builder that omits the
     * field still inserts cleanly. Enforced by DB CHECK
     * {@code chk_architecture_draft_state} (changeset 144).</p>
     *
     * <p>Boxed {@link String} (always was, by Java convention) so a PATCH that
     * omits the field arrives as null and the PATCH handler can null-guard the
     * assignment per {@code project_primitive_double_dto_overwrite.md}.</p>
     */
    @Column(name = "draft_state", nullable = false, length = 32)
    @Builder.Default
    private String draftState = "active";

    /**
     * Architecture kind discriminator. Allowed persisted values are
     * {@code current} and {@code target}. Current-state rows carry
     * {@code current}; target-state rows (active or draft) carry
     * {@code target}.
     *
     * <p>NOT NULL at the DB level with DEFAULT {@code 'current'}; the entity's
     * {@link #onCreate()} defaulter mirrors this. Enforced by DB CHECK
     * {@code chk_architecture_kind} (changeset 144). Existing rows backfill to
     * {@code current}; rows tagged {@code imported-target} via the
     * {@code architecture_tag} table are migrated to {@code target} by the
     * idempotent backfill in changeset 144.</p>
     */
    @Column(name = "kind", nullable = false, length = 32)
    @Builder.Default
    private String kind = "current";

    /**
     * Timestamp of the last successful stale-mark invocation against this
     * architecture as the active target. NULL until the first stale-mark
     * fires; updated on every successful (non-skipped) stale-mark cycle.
     *
     * <p>Drives the AMS-side debounce of the staleness pipeline: if a save
     * arrives within {@code N} seconds (default 5s in v1) of this stamp the
     * stale-mark is skipped; otherwise it fires. Promotions ALWAYS fire
     * regardless of this stamp.</p>
     *
     * <p>NULLABLE; boxed {@link Instant} (NEVER primitive) so PATCH semantics
     * preserve null per {@code project_primitive_double_dto_overwrite.md} --
     * a request that omits the field never silently wipes the column.</p>
     *
     * <p>Added by Liquibase changeset 147 (Target Architecture Authoring Flow,
     * Task Group 3).</p>
     */
    @Column(name = "last_marked_stale_at")
    private Instant lastMarkedStaleAt;

    /**
     * Justification recorded when the architect-conversation "proceed" step is
     * explicitly OVERRIDDEN while remaining CRITICAL CVEs exist (Spec 4 steering
     * hard-gate). {@code null} = no override (the common case; the proceed step
     * was not blocked, or it was blocked and the user fixed the criticals rather
     * than overriding).
     *
     * <p>NULLABLE; boxed {@link String} so a PATCH that omits the field arrives as
     * null and the persist handler null-guards the assignment per
     * {@code project_primitive_double_dto_overwrite.md}. Added by Liquibase
     * changeset 198 (Vulnerability Reduction + Steering, Task Group 4).</p>
     */
    @Column(name = "proceed_critical_override_justification")
    private String proceedCriticalOverrideJustification;

    /**
     * The remaining CRITICAL CVE count AT OVERRIDE TIME -- the audit snapshot of
     * how many critical CVEs were still unaddressed when the proceed gate was
     * overridden. {@code null} = no override.
     *
     * <p>Boxed {@link Integer} -- PATCH-mutable numerics must be boxed (NEVER
     * primitive) per {@code project_primitive_double_dto_overwrite.md} so an
     * absent / zero value is preserved through (de)serialisation without the
     * primitive-default-to-zero hazard. Added by Liquibase changeset 198.</p>
     */
    @Column(name = "proceed_remaining_critical_count")
    private Integer proceedRemainingCriticalCount;

    /**
     * Timestamp of the proceed-with-remaining-criticals override. {@code null} =
     * no override.
     *
     * <p>NULLABLE; boxed {@link Instant} (NEVER primitive) so PATCH semantics
     * preserve null per {@code project_primitive_double_dto_overwrite.md}. Added
     * by Liquibase changeset 198.</p>
     */
    @Column(name = "proceed_critical_override_at")
    private Instant proceedCriticalOverrideAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (updatedAt == null) {
            updatedAt = Instant.now();
        }
        if (archived == null) {
            archived = false;
        }
        if (draftState == null) {
            draftState = "active";
        }
        if (kind == null) {
            kind = "current";
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
