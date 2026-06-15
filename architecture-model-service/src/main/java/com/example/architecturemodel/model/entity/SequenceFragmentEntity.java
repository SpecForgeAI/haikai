package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;

@Entity
@Table(name = "sequence_fragments")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SequenceFragmentEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "sequence_diagram_id", nullable = false)
    private String sequenceDiagramId;

    @Column(name = "fragment_kind", nullable = false)
    private String fragmentKind;

    @Column(name = "label_text")
    private String labelText;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
