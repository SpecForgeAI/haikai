package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

/**
 * JPA Entity for an Interface (the "API" element supertype row in the
 * target-architecture table editor).
 *
 * <p><b>Target Architecture Authoring Flow extension (2026-05-20, Task Group 1):</b>
 * Liquibase changeset 145 adds two authoring-metadata columns,
 * {@link #provenance} and {@link #decommissioningStatus}. Both are NULLABLE
 * boxed {@link String} reference types so PATCH semantics preserve null per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 */
@Entity
@Table(name = "interfaces")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class InterfaceEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "service_id", nullable = false)
    private String serviceId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "interface_type")
    private String interfaceType;

    @Column(name = "spec_link")
    private String specLink;

    @Column(name = "tags")
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;

    /**
     * Authoring provenance for this API. Allowed values:
     * {@code cloned-from} / {@code imported} / {@code user-authored} /
     * {@code llm-suggested}. Nullable. Enforced by DB CHECK
     * {@code chk_interfaces_provenance} (changeset 145). Spec: Target
     * Architecture Authoring Flow (2026-05-20).
     */
    @Column(name = "provenance", length = 32)
    private String provenance;

    /**
     * Target-side decommissioning vocabulary. Allowed values:
     * {@code not-applicable} / {@code proposed} / {@code decommissioned}.
     * Nullable. Enforced by DB CHECK {@code chk_interfaces_decom_status}
     * (changeset 145). Spec: Target Architecture Authoring Flow (2026-05-20).
     */
    @Column(name = "decommissioning_status", length = 32)
    private String decommissioningStatus;
}
