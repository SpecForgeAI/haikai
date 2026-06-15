package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "physical_data_attributes")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PhysicalDataAttributeEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "physical_entity_id", nullable = false)
    private String physicalEntityId;

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
     * Verbatim source engine type string (e.g. {@code varchar(255)},
     * {@code numeric(10,2)}, {@code datetime}). Captured as-is with NO
     * normalization -- the Sybase->Postgres type mapping is a downstream
     * migration / shape-spec concern.
     *
     * <p>Spec: DB Structural Fidelity for Discovery (2026-05-29) -- Task Group 1.</p>
     */
    @Column(name = "source_type")
    private String sourceType;

    /**
     * Numeric scale (digits to the right of the decimal point). Boxed
     * {@link Integer} so a PATCH carrying no value preserves the existing column
     * content rather than wiping to 0 (per
     * {@code project_primitive_double_dto_overwrite.md}).
     */
    @Column(name = "scale")
    private Integer scale;

    /**
     * Numeric precision (total significant digits). Boxed {@link Integer} for the
     * same PATCH-safety reason as {@link #scale}.
     */
    @Column(name = "precision")
    private Integer precision;

    /**
     * Column default expression, verbatim. {@code default} is a SQL reserved
     * word, so the column is named {@code column_default} consistently across
     * SQL / entity / DTO.
     */
    @Column(name = "column_default")
    private String columnDefault;

    /**
     * 1-based ordinal position of the column within its table. Boxed
     * {@link Integer} for PATCH-safety.
     */
    @Column(name = "ordinal")
    private Integer ordinal;

    /**
     * Column-level identity / auto-increment flag. Boxed {@link Boolean} so a
     * PATCH carrying no value preserves the existing column content rather than
     * wiping to {@code false} (per {@code project_primitive_double_dto_overwrite.md}).
     */
    @Column(name = "is_identity")
    private Boolean isIdentity;
}
