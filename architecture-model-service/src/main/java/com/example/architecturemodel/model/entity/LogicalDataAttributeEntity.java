package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.util.Map;

@Entity
@Table(name = "logical_data_attributes")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LogicalDataAttributeEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "logical_entity_id", nullable = false)
    private String logicalEntityId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "data_type")
    private String dataType;

    @Column(name = "is_primary_key", nullable = false)
    private Boolean isPrimaryKey;

    @Column(name = "is_nullable", nullable = false)
    private Boolean isNullable;

    @Column(name = "tags")
    private String tags;

    /**
     * Structured SOAP/WSDL message-field metadata captured for this attribute by
     * the deterministic XSD / Java-DTO field walker -- METADATA ON THE ATTRIBUTE,
     * NOT separate columns. A SINGLE JSONB blob; boxed reference type
     * ({@link Map}) so a PATCH carrying no value preserves the existing column
     * content (per {@code project_primitive_double_dto_overwrite.md}).
     *
     * <p>Shape:</p>
     * <pre>
     * {
     *   min_occurs, max_occurs, is_collection,            // cardinality
     *   enumeration[], pattern, minLength, maxLength,      // value-domain
     *   minInclusive, maxInclusive, totalDigits, fractionDigits,
     *   xsd_type                                           // XSD source-type, as-is
     * }
     * </pre>
     *
     * <p>Stored via the Hypersistence {@link JsonType}, the identical
     * JSONB-via-Hibernate idiom used by
     * {@code PhysicalDataEntityEntity.constraintsMetadata} (the 164-physical-
     * entity-constraints-jsonb.sql precedent). A null/absent block round-trips
     * cleanly (existing rows carry none).</p>
     *
     * <p>{@code is_nullable} stays a REAL Boolean column mapped from XSD
     * {@code nillable} and is NOT overloaded by the cardinality here:
     * {@code min_occurs=0} (optional) and {@code nillable="true"}
     * (present-but-null) are distinct facts.</p>
     *
     * <p>Spec: SOAP/WSDL Message-Field Depth for Discovery (2026-05-30) --
     * Task Group 1.</p>
     */
    @Type(JsonType.class)
    @Column(name = "field_metadata", columnDefinition = "jsonb")
    private Map<String, Object> fieldMetadata;
}
