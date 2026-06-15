package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

@Entity
@Table(name = "ui_components")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UIComponentEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "component_type", nullable = false)
    private String componentType;

    @Column(name = "description")
    private String description;

    @Column(name = "domain")
    private String domain;

    /**
     * Bug fix (2026-04-21): field declares `columnDefinition = "jsonb"` but
     * missing `@Type(JsonType.class)` caused Hibernate to bind the parameter
     * as VARCHAR, which PostgreSQL then refused even for NULL values
     * ("column ... is of type jsonb but expression is of type character
     * varying"). Same pattern as `MethodEntity.parametersJson`.
     */
    @Type(JsonType.class)
    @Column(name = "props_schema_json", columnDefinition = "jsonb")
    private String propsSchemaJson;
}
