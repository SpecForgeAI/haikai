package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for hierarchical work items (Initiative, Epic, Feature, Story).
 *
 * Maps to the work_item table with self-referential parent relationship
 * for building work item hierarchies with cascading deletes.
 *
 * <p><b>WorkItem type audit (Spec 2026-05-17 PM Migration Delivery Plan, Group 2, Q-2)</b><br>
 * Confirmed: WorkItem {@code type} is a free-text {@code TEXT NOT NULL} column
 * (see changeset {@code 012-work-items-project-artifacts.sql}). There is no enum
 * type, no check constraint, and no domain on the column, so the four values
 * required by the save-to-backlog flow ({@code initiative | epic | feature | story})
 * already round-trip cleanly without any schema change.
 * The legacy convention used elsewhere in the codebase is the uppercase form
 * ({@code INITIATIVE | EPIC | FEATURE | STORY}); the new save-to-backlog flow
 * (Task Group 8) chooses whether to uppercase incoming values to match that
 * convention. No runtime mapping table is needed; no new Liquibase changeset
 * was added for the PM migration delivery plan flow. See
 * {@code com.example.architecturemodel.repository.entity.WorkItemTypeAuditTest}
 * for the round-trip audit assertions.</p>
 */
@Entity
@Table(name = "work_item")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WorkItemEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "type", nullable = false)
    private String type;

    @Column(name = "parent_id")
    private UUID parentId;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "description")
    private String description;

    @Column(name = "status", nullable = false)
    @Builder.Default
    private String status = "PLANNED";

    @Column(name = "sort_order", nullable = false)
    @Builder.Default
    private Integer sortOrder = 0;

    @Column(name = "priority")
    private Integer priority;

    @Column(name = "target_window")
    private String targetWindow;

    /**
     * Flexible tags stored as JSONB.
     * Uses Map<String, Object> for flexible JSON handling compatible with both
     * PostgreSQL (via Liquibase migration) and H2 (for tests).
     */
    @Type(JsonType.class)
    @Column(name = "tags_json", columnDefinition = "jsonb")
    private Map<String, Object> tagsJson;

    @Column(name = "external_system")
    private String externalSystem;

    @Column(name = "external_key")
    private String externalKey;

    /**
     * Optional external URL for linking to the source system (e.g., Jira browse URL).
     * Spec: RM Increment 4 -- Jira Import for Roadmap Skeleton (Initiatives + Epics)
     */
    @Column(name = "external_url")
    private String externalUrl;

    /**
     * Optional reference to the delivery team responsible for this work item.
     * Bare UUID FK only (no @ManyToOne relationship), consistent with projectId and parentId pattern.
     * Spec: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)
     */
    @Column(name = "delivery_team_id")
    private UUID deliveryTeamId;

    // -------------------------------------------------------------------------
    // Implementation git outcome
    // Spec: 2026-06-12 Implementation-Service Init and Integration Repair --
    // Task Group 1 (Liquibase changeset 180)
    //
    // The git outcome of the implementation job for this work item, extracted
    // defensively from JobDetailResponse.result (untyped upstream) plus the
    // job's logs_url. All nullable Strings; PATCH semantics are null-guarded
    // in WorkItemMapper.updateEntityFromDto (absent on update = unchanged).
    // -------------------------------------------------------------------------

    /** Feature branch produced by the implementation job; null until a job completes. */
    @Column(name = "implementation_branch")
    private String implementationBranch;

    /** Pull request URL produced by the implementation job; null until known. */
    @Column(name = "implementation_pr_url")
    private String implementationPrUrl;

    /** Logs URL of the implementation job (JobDetailResponse.logs_url); null until known. */
    @Column(name = "implementation_logs_url")
    private String implementationLogsUrl;

    // -------------------------------------------------------------------------
    // Defer flag (implementation-exclusion only)
    // Spec: 2026-06-14 Migrate Button + Migration Execution Driver (Spec 3 of 4)
    // -- Task Group 1 (Liquibase changeset 182, CD-7)
    // -------------------------------------------------------------------------

    /**
     * Deliberate, visible per-story defer state (CD-7): EXCLUDES the story from
     * THIS Migrate dispatch set only (implementation-exclusion ONLY). A deferred
     * story drops out of the in-scope hard-block set and is NOT sent for
     * implementation, but is NEVER removed from reconciliation scope (Spec 4
     * reconciles the full pinned baseline, so a deferred / un-migrated story
     * correctly surfaces there as a break -- the truthful signal, not a false
     * break). Read by the Migrate readiness predicate AND the run-sequence
     * builder.
     *
     * <p>BOXED {@link Boolean} (NOT primitive {@code boolean}) per
     * {@code project_primitive_double_dto_overwrite.md}: a primitive would
     * silently default to {@code false} on a PATCH that omits the field and
     * could wipe a previously-set defer. The DB column is
     * {@code NOT NULL DEFAULT false} (changeset 182); the {@code @PrePersist}
     * mirrors that default so a builder that omits the field still inserts
     * cleanly, and existing rows read back {@code deferred=false}.</p>
     */
    @Column(name = "deferred", nullable = false)
    @Builder.Default
    private Boolean deferred = Boolean.FALSE;

    // -------------------------------------------------------------------------
    // Carry-over completeness gate -- capability provenance
    // Spec: 2026-06-14 D4 -- Carry-over Completeness Gate (Spec 4 of 6)
    // -- Task Group 1 (Liquibase changeset 185)
    // -------------------------------------------------------------------------

    /**
     * The {@code discovery_capability} this STORY was minted to cite (D3's
     * {@code append-capability-story}). NULL for every ordinary (non-capability)
     * work item. A capability is "cited-by-story" iff a {@code work_item} exists
     * with {@code source_capability_id == capability.id} (D8) -- the D4
     * carry_over completeness gate JOINs on this column rather than re-parsing
     * the {@code book_of_work_json} blob. D3 stamps the blob (changeset-free);
     * D4 ADDS this column AND has {@code appendCapabilityStory} write it too, so
     * BOTH the blob and the column carry the provenance.
     *
     * <p>BOXED {@link UUID} (a reference type by nature; never a primitive) per
     * {@code project_primitive_double_dto_overwrite.md}: nullable, with
     * null-guarded PATCH semantics in {@code WorkItemMapper.updateEntityFromDto}
     * (an omitted {@code source_capability_id} on update leaves the stored value
     * unchanged and can never wipe it). The DB column is {@code UUID NULL}
     * (changeset 185); {@code null} is the valid empty state, so no
     * {@code @PrePersist} defaulting is needed.</p>
     */
    @Column(name = "source_capability_id")
    private UUID sourceCapabilityId;

    // -------------------------------------------------------------------------
    // Net-new vs carry_over provenance
    // Spec: 2026-06-14 D5 -- Net-new backlog items + provenance (Spec 5 of 6)
    // -- Task Group 1 (Liquibase changeset 186)
    // -------------------------------------------------------------------------

    /**
     * Like-for-like provenance marker (D5): {@link #PROVENANCE_CARRY_OVER}
     * (the default -- the item is like-for-like and must match current-state) or
     * {@link #PROVENANCE_NET_NEW} (the item is additive, deliberately OUTSIDE the
     * like-for-like envelope). Every existing/discovered work item is correctly
     * {@code carry_over} with NO backfill (every discovered item IS like-for-like);
     * only a deliberate manual add can mark {@code net_new}. The allowed values are
     * validated at the service/DTO layer (the column stays a plain {@code VARCHAR}
     * -- no DB enum/CHECK, matching the AMS status-as-string convention).
     *
     * <p>COLUMN-AUTHORITATIVE and COLUMN-ONLY: dispatch ignores it (the migration
     * execution driver keys on {@code workItemId} + spec-ready + non-deferred and
     * reads NO provenance, so a {@code net_new} story dispatches unchanged); the
     * reconcile consumer (program D6) reads rows directly. D5 only SETS the
     * marker.</p>
     *
     * <p>Modelled EXACTLY on {@link #deferred} (changeset 182): a NOT NULL column
     * with a DB {@code DEFAULT 'carry_over'}, mirrored by the {@code @PrePersist}
     * default below so a builder that omits {@code provenance} still inserts
     * {@code 'carry_over'}, and null-guarded PATCH semantics in
     * {@code WorkItemMapper.updateEntityFromDto} per
     * {@code project_primitive_double_dto_overwrite.md} so an omitted
     * {@code provenance} on a general work-item update never wipes the column.
     * {@code String} is a reference type by nature (no primitive-default hazard);
     * the {@code @Builder.Default} + {@code @PrePersist} keep an omitting builder
     * write stable.</p>
     */
    @Column(name = "provenance", nullable = false)
    @Builder.Default
    private String provenance = PROVENANCE_CARRY_OVER;

    /** Default provenance value: like-for-like, must match current-state. */
    public static final String PROVENANCE_CARRY_OVER = "carry_over";

    /** Additive provenance value: deliberately outside the like-for-like envelope. */
    public static final String PROVENANCE_NET_NEW = "net_new";

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
        if (deferred == null) {
            deferred = Boolean.FALSE;
        }
        // D5 (changeset 186): mirror the DB DEFAULT so a builder that omits
        // provenance still inserts 'carry_over' (matches the deferred mirror
        // above). Every existing/discovered item is correctly carry_over.
        if (provenance == null) {
            provenance = PROVENANCE_CARRY_OVER;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
