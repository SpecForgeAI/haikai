package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;

@Entity
@Table(name = "sequence_participants")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SequenceParticipantEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "sequence_diagram_id", nullable = false)
    private String sequenceDiagramId;

    @Column(name = "ref_kind", nullable = false)
    private String refKind;

    @Column(name = "ref_id", nullable = false)
    private String refId;

    @Column(name = "order_index", nullable = false)
    private Integer orderIndex;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
