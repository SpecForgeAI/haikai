package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.util.Map;

@Entity
@Table(name = "physical_data_entities")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PhysicalDataEntityEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "physical_type")
    private String physicalType;

    @Column(name = "database_name")
    private String databaseName;

    @Column(name = "tags")
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;

    // Foundations Spec 1 (2026-08-22): scope tag + decision receipt.
    @Column(name = "migration_scope")
    private String migrationScope;

    @Column(name = "scope_decision_ref")
    private String scopeDecisionRef;

    /**
     * Structured constraint/index metadata captured for the table by the
     * discovery DB scan -- METADATA ON THE ENTITY, NOT separate entity types.
     * JSONB blob; boxed reference type ({@link Map}) so a PATCH carrying no value
     * preserves the existing column content (per
     * {@code project_primitive_double_dto_overwrite.md}).
     *
     * <p>Shape:</p>
     * <pre>
     * {
     *   primary_key:        { name, columns[] },
     *   unique_constraints: [ { name, columns[] } ],
     *   check_constraints:  [ { name, expression } ],
     *   indexes:            [ { name, columns[], is_unique } ]
     * }
     * </pre>
     *
     * <p>Stored via the Hypersistence {@link JsonType}, the identical
     * JSONB-via-Hibernate idiom used by {@code BusinessLogicEntity.behavior} (the
     * 162-business-logic-behavior.sql precedent). A null/absent block round-trips
     * cleanly (existing rows carry none). Views stay as
     * {@code physical_data_entities} with {@code physical_type='View'}; their
     * defining SQL goes to a Finding, NOT onto this column.</p>
     *
     * <p>Spec: DB Structural Fidelity for Discovery (2026-05-29) -- Task Group 1.</p>
     */
    @Type(JsonType.class)
    @Column(name = "constraints_metadata", columnDefinition = "jsonb")
    private Map<String, Object> constraintsMetadata;
}
