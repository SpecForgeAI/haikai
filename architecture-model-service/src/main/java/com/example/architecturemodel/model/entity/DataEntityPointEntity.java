package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

/**
 * JPA entity representing a Data Entity Point.
 *
 * Data Entity Points act as polymorphic reference wrappers for Logical and Physical
 * Data Entities, enabling future relationship tables to point to either entity type
 * through a single foreign key.
 *
 * <p><b>Target Architecture Authoring Flow extension (2026-05-20, Task Group 1):</b>
 * Liquibase changeset 145 adds two authoring-metadata columns,
 * {@link #provenance} and {@link #decommissioningStatus}. Both are NULLABLE
 * boxed {@link String} reference types so PATCH semantics preserve null per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * Spec: Data Entity Point Superclass
 */
@Entity
@Table(name = "data_entity_points")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DataEntityPointEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "point_kind", nullable = false)
    private String pointKind;

    @Column(name = "logical_entity_id")
    private String logicalEntityId;

    @Column(name = "physical_entity_id")
    private String physicalEntityId;

    @Column(name = "description")
    private String description;

    @Column(name = "tags")
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;

    /**
     * Authoring provenance for this data entity point. Allowed values:
     * {@code cloned-from} / {@code imported} / {@code user-authored} /
     * {@code llm-suggested}. Nullable. Enforced by DB CHECK
     * {@code chk_data_entity_points_provenance} (changeset 145). Spec:
     * Target Architecture Authoring Flow (2026-05-20).
     */
    @Column(name = "provenance", length = 32)
    private String provenance;

    /**
     * Target-side decommissioning vocabulary. Allowed values:
     * {@code not-applicable} / {@code proposed} / {@code decommissioned}.
     * Nullable. Enforced by DB CHECK
     * {@code chk_data_entity_points_decom_status} (changeset 145). Spec:
     * Target Architecture Authoring Flow (2026-05-20).
     */
    @Column(name = "decommissioning_status", length = 32)
    private String decommissioningStatus;
}
