package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

@Entity
@Table(name = "ui_contracts")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UIContractEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "contract_type", nullable = false)
    private String contractType;

    @Column(name = "operation_ref")
    private String operationRef;

    @Column(name = "request_schema_ref")
    private String requestSchemaRef;

    @Column(name = "response_schema_ref")
    private String responseSchemaRef;

    /**
     * Bug fix (2026-04-21): missing `@Type(JsonType.class)` would cause the
     * same VARCHAR-to-JSONB binding error as `UIComponentEntity.propsSchemaJson`.
     * Same pattern as `MethodEntity.parametersJson`.
     */
    @Type(JsonType.class)
    @Column(name = "bindings_json", columnDefinition = "jsonb")
    private String bindingsJson;
}
