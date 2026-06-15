package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.util.Map;

/**
 * JPA Entity for logical_data_entity_relationships table.
 *
 * Supports UML-style relationship semantics with:
 * - Cardinality: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY
 * - Relationship: GENERALIZATION, REALIZATION, COMPOSITION, AGGREGATION, ASSOCIATION, DEPENDENCY
 *
 * Uses Data Entity Point IDs for polymorphic endpoints:
 * - fromDataEntityPointId: references data_entity_points for the "from" side
 * - toDataEntityPointId: references data_entity_points for the "to" side
 *
 * Spec: Remove Legacy Data Entity Relationship Columns
 */
@Entity
@Table(name = "logical_data_entity_relationships")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LogicalDataEntityRelationshipEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    /**
     * FK column referencing data_entity_points.id for the "from" side.
     * ID format: "dep_log_" + entityId for logical, "dep_phy_" + entityId for physical.
     *
     * Spec: Remove Legacy Data Entity Relationship Columns
     */
    @Column(name = "from_data_entity_point_id", nullable = false)
    private String fromDataEntityPointId;

    /**
     * FK column referencing data_entity_points.id for the "to" side.
     * ID format: "dep_log_" + entityId for logical, "dep_phy_" + entityId for physical.
     *
     * Spec: Remove Legacy Data Entity Relationship Columns
     */
    @Column(name = "to_data_entity_point_id", nullable = false)
    private String toDataEntityPointId;

    /**
     * Cardinality of the relationship.
     * Values: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY
     * Nullable to allow partial relationship definition.
     */
    @Column(name = "cardinality")
    private String cardinality;

    /**
     * UML relationship type.
     * Values: GENERALIZATION, REALIZATION, COMPOSITION, AGGREGATION, ASSOCIATION, DEPENDENCY
     * Nullable; defaults to ASSOCIATION conceptually in rendering.
     */
    @Column(name = "relationship")
    private String relationship;

    @Column(name = "description")
    private String description;

    @Column(name = "tags")
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;

    /**
     * FK column-level detail for the relationship -- the join (referencing) and
     * referenced column lists on each side. METADATA ON the relationship, NOT a
     * new entity type. JSONB blob; boxed reference type ({@link Map}) so a PATCH
     * carrying no value preserves the existing column content (per
     * {@code project_primitive_double_dto_overwrite.md}).
     *
     * <p>Shape:</p>
     * <pre>
     * {
     *   join_columns:       [ &lt;column names on the "from"/referencing side&gt; ],
     *   referenced_columns: [ &lt;column names on the "to"/referenced side&gt; ]
     * }
     * </pre>
     *
     * <p>The {@link #fromDataEntityPointId} / {@link #toDataEntityPointId}
     * endpoints are UNCHANGED; {@code fkColumns} just adds the column-level FK
     * detail. Stored via the Hypersistence {@link JsonType}, the same
     * JSONB-via-Hibernate idiom used by {@code BusinessLogicEntity.behavior}. A
     * null/absent block round-trips cleanly (existing rows carry none).</p>
     *
     * <p>Spec: DB Structural Fidelity for Discovery (2026-05-29) -- Task Group 1.</p>
     */
    @Type(JsonType.class)
    @Column(name = "fk_columns", columnDefinition = "jsonb")
    private Map<String, Object> fkColumns;
}
