package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "events")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EventEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "source_ref_kind")
    private String sourceRefKind;

    @Column(name = "source_ref_id")
    private String sourceRefId;

    @Column(name = "payload_ref_kind")
    private String payloadRefKind;

    @Column(name = "payload_ref_id")
    private String payloadRefId;

    @Column(name = "payload_primitive_type")
    private String payloadPrimitiveType;

    @Column(name = "tags")
    private String tags;
}
