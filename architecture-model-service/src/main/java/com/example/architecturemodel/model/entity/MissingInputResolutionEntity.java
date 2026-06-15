package com.example.architecturemodel.model.entity;

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
 * JPA Entity for {@code missing_input_resolutions} -- the new AMS-side
 * persistence table recording user-supplied resolutions for missing-input
 * keys surfaced by {@link MigrationStorySpecGenerationEntity} rows.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 1.</p>
 *
 * <p>Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 1 added
 * {@code resolutionSource} and {@code projectArtifactId} columns (changeset
 * 151) to back-reference the uploaded OAS/WSDL artefact a resolution was
 * derived from.</p>
 *
 * <p><b>One ACTIVE row per (project_id, missing_input_key):</b> enforced by
 * the partial unique index {@code ux_mir_project_key_active} which covers
 * only rows with {@code soft_deleted=false}. Soft-deleted rows are excluded
 * from the constraint so resets and re-resolutions are unrestricted, and
 * audit history is preserved.</p>
 *
 * <p><b>Type vocabulary</b> ({@code api_contract}, {@code mapping},
 * {@code target_element}) is enforced by the DB CHECK constraint
 * {@code chk_mir_type} (changeset 148). Out-of-v1 missing-input types
 * NEVER produce a key and NEVER enter this table -- they surface read-only
 * in the resolver panel under the {@code out_of_v1} group.</p>
 *
 * <p><b>Payload shape per type</b> (stored as JSONB, validated at service
 * layer):</p>
 * <ul>
 *   <li>{@code api_contract}   -- {@code { contractBlobId, filename, format: 'oas'|'wsdl', operationsCount }}</li>
 *   <li>{@code mapping}        -- {@code { sourceElementId, targetElementId, mappingRefId }}
 *       (where {@code mappingRefId} FKs to a row in
 *       {@code ArchitectureElementMappingEntity} -- removing the resolution
 *       does NOT delete the mapping; mapping deletion is a separate user
 *       action).</li>
 *   <li>{@code target_element} -- {@code { targetElementId }} (FK to the
 *       element created via the target-architecture authoring workspace,
 *       Spec 2026-05-20-target-architecture-authoring-flow).</li>
 * </ul>
 *
 * <p><b>Provenance columns (changeset 151):</b></p>
 * <ul>
 *   <li>{@link #resolutionSource} -- open-vocabulary stamp written by the
 *       service layer. Current values: {@code manual} (manual-entry path) and
 *       {@code oas_wsdl_upload} (parse-files endpoint). No DB CHECK
 *       constraint by design -- new sources can be added without schema
 *       migration. Pre-existing rows are backfilled to {@code manual}.</li>
 *   <li>{@link #projectArtifactId} -- FK back-reference to the
 *       {@code project_artifact} row holding the uploaded OAS/WSDL file the
 *       resolution was derived from. NULL for manual-entry rows and NULL
 *       after the source artefact is deleted (ON DELETE SET NULL). The
 *       service layer stamps this column when called from the parse-files
 *       commit path. Per
 *       {@code project_pg_deferrable_set_null_action.md}, ON DELETE SET NULL
 *       fires immediately at DELETE time; capture-and-restore flows that
 *       DELETE+re-INSERT a {@code project_artifact} must capture+restore
 *       this column in the same transaction.</li>
 * </ul>
 *
 * <p><b>Soft-delete cascade:</b> setting {@link #softDeleted} = {@code true}
 * triggers the cross-story cascade implemented by the service layer (Task
 * Group 3) -- every spec whose {@code missing_input_keys_json} contains the
 * soft-deleted key is flipped back to {@code insufficient_context} with
 * {@code stale=true}, {@code staleReason='resolution_reset'}, and
 * {@code staleMarkedAt=now()}.</p>
 *
 * <p><b>Boxed types for PATCH safety:</b> every reference type on this entity
 * is boxed ({@link Boolean}, {@link String}, {@link UUID}, {@link Instant})
 * per {@code project_primitive_double_dto_overwrite.md}. The future PATCH
 * endpoint controller (Task Group 4) will null-guard each editable field so
 * an omitted DTO field never silently wipes the column.</p>
 */
@Entity
@Table(
    name = "missing_input_resolutions",
    indexes = {
        @Index(name = "idx_mir_project_key_soft_deleted",
               columnList = "project_id, missing_input_key, soft_deleted"),
        @Index(name = "idx_mir_project_soft_deleted",
               columnList = "project_id, soft_deleted")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MissingInputResolutionEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /**
     * Stable 16-hex-char key produced by
     * {@code MissingInputKeyHasher#computeKey(inputType, canonicalDescriptor)}.
     * Indexed and unique-per-project among non-soft-deleted rows.
     */
    @Column(name = "missing_input_key", nullable = false, length = 16)
    private String missingInputKey;

    /**
     * Allowed values: {@code api_contract}, {@code mapping},
     * {@code target_element}. CHECK constraint {@code chk_mir_type} is the
     * source of truth.
     */
    @Column(name = "missing_input_type", nullable = false, length = 32)
    private String missingInputType;

    /**
     * Type-specific JSONB payload. See class-level javadoc for the per-type
     * shape.
     */
    @Type(JsonType.class)
    @Column(name = "resolution_payload_json", columnDefinition = "jsonb")
    private Map<String, Object> resolutionPayloadJson;

    /**
     * Timestamp at which the resolution was created. Stamped on insert by
     * the DB default and by the entity's {@code @PrePersist} hook.
     */
    @Column(name = "resolved_at", nullable = false)
    @Builder.Default
    private Instant resolvedAt = Instant.now();

    /**
     * Audit channel: user/principal identifier of the creator. Populated by
     * the service layer from the request context.
     */
    @Column(name = "resolved_by", nullable = false, length = 128)
    private String resolvedBy;

    /**
     * TRUE when the resolution has been Reset. Excluded from the active
     * partial unique index but retained for audit history. The service-layer
     * cascade (Task Group 3) walks the dependent specs when this flips.
     *
     * <p>BOXED {@link Boolean} (NOT primitive {@code boolean}) per
     * {@code project_primitive_double_dto_overwrite.md} -- but defaulted to
     * FALSE at the DB level and on {@code @PrePersist} so a builder that
     * omits the field still inserts cleanly with the correct semantics.</p>
     */
    @Column(name = "soft_deleted", nullable = false)
    @Builder.Default
    private Boolean softDeleted = Boolean.FALSE;

    /**
     * Timestamp at which the resolution was Reset. Stamped by the service
     * layer at soft-delete time. Null while {@link #softDeleted} is FALSE.
     */
    @Column(name = "soft_deleted_at")
    private Instant softDeletedAt;

    /**
     * Audit channel: user/principal identifier of the resetter. Populated by
     * the service layer at soft-delete time.
     */
    @Column(name = "soft_deleted_by", length = 128)
    private String softDeletedBy;

    /**
     * Open-vocabulary provenance stamp written by the service layer. Current
     * values:
     * <ul>
     *   <li>{@code manual} -- created via the bulk-resolve modal manual-entry
     *       path. Pre-existing rows from before changeset 151 are backfilled
     *       to this value.</li>
     *   <li>{@code oas_wsdl_upload} -- created by the parse-files endpoint
     *       (Bulk-Resolve OAS/WSDL Parser spec, Task Group 4).</li>
     * </ul>
     *
     * <p>No DB CHECK constraint by design -- the vocabulary stays open so
     * future resolution sources can be added without a schema migration. The
     * service layer is responsible for cooperative enforcement of valid
     * values.</p>
     *
     * <p>BOXED {@link String} (no primitive equivalent for strings, but
     * called out explicitly for the PATCH-preserves-null contract). Nullable
     * on the column so existing manual-entry callers that don't set the field
     * still insert cleanly; the entity's {@code @PrePersist} hook does NOT
     * auto-fill this column -- callers must set it explicitly when known.</p>
     *
     * <p>Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 1</p>
     */
    @Column(name = "resolution_source", length = 32)
    private String resolutionSource;

    /**
     * FK back-reference to the {@code project_artifact} row holding the
     * uploaded OAS/WSDL file the resolution was derived from. NULL for
     * manual-entry rows (no source artefact) and NULL after the source
     * artefact is deleted (FK declared ON DELETE SET NULL in changeset 151).
     *
     * <p>Stored as a UUID column rather than a {@code @ManyToOne} mapping
     * because:</p>
     * <ul>
     *   <li>the relationship is loose -- the artefact row can be deleted
     *       without invalidating the resolution audit row;</li>
     *   <li>capture-and-restore flows that re-insert a project_artifact need
     *       to capture+restore this column explicitly per
     *       {@code project_pg_deferrable_set_null_action.md} -- a UUID
     *       column makes that pattern straightforward;</li>
     *   <li>no traversal from resolution to artefact is required at runtime
     *       in v1 -- the side-panel UI fetches the artefact via a separate
     *       service call when the user clicks "view existing resolution".</li>
     * </ul>
     *
     * <p>BOXED {@link UUID} per {@code project_primitive_double_dto_overwrite.md}.</p>
     *
     * <p>Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 1</p>
     */
    @Column(name = "project_artifact_id")
    private UUID projectArtifactId;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();

    @PrePersist
    protected void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        if (updatedAt == null) {
            updatedAt = now;
        }
        if (resolvedAt == null) {
            resolvedAt = now;
        }
        if (softDeleted == null) {
            softDeleted = Boolean.FALSE;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
