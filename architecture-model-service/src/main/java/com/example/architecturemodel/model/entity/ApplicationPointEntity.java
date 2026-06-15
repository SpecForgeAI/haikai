package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Check;

@Entity
@Table(name = "application_points")
@Check(constraints =
    "target_type IS NULL OR target_type IN ('SERVICE','CLASS','METHOD','LIBRARY')")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApplicationPointEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "kind", nullable = false)
    private String kind;

    @Column(name = "application_id", nullable = false)
    private String applicationId;

    @Column(name = "application_component_id")
    private String applicationComponentId;

    @Column(name = "service_id")
    private String serviceId;

    @Column(name = "interface_id")
    private String interfaceId;

    /**
     * Target type for precise targeting of Service, Class, Method, or Library.
     * Valid values: SERVICE, CLASS, METHOD, LIBRARY
     *
     * The {@link Check} on the class mirrors the relaxed CHECK constraint
     * defined in changeset 124-application-points-target-type-library.sql so
     * the constraint is enforceable in the H2-based test environment (which
     * uses ddl-auto=create-drop with Liquibase disabled).
     *
     * Spec: Expand Application Points to Reference Service/Class/Method
     * Spec: 2026-05-05-library-backend-foundation (LIBRARY added)
     */
    @Column(name = "target_type")
    private String targetType;

    /**
     * Target reference ID - UUID of the targeted Service, Class, Method, or Library.
     * Used in conjunction with targetType to specify which entity this point targets.
     * Spec: Expand Application Points to Reference Service/Class/Method
     */
    @Column(name = "target_ref_id")
    private String targetRefId;

    @Column(name = "point_type")
    private String pointType;

    @Column(name = "tags")
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;
}
