package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

@Entity
@Table(name = "methods")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MethodEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "class_id", nullable = false)
    private String classId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Type(JsonType.class)
    @Column(name = "parameters_json", columnDefinition = "jsonb")
    private String parametersJson;

    @Type(JsonType.class)
    @Column(name = "returns_json", columnDefinition = "jsonb")
    private String returnsJson;

    @Type(JsonType.class)
    @Column(name = "throws_json", columnDefinition = "jsonb")
    private String throwsJson;
}
