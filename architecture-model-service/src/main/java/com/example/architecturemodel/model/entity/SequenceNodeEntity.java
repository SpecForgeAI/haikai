package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;

@Entity
@Table(name = "sequence_nodes")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SequenceNodeEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "sequence_diagram_id", nullable = false)
    private String sequenceDiagramId;

    @Column(name = "node_kind", nullable = false)
    private String nodeKind;

    @Column(name = "message_id")
    private String messageId;

    @Column(name = "fragment_id")
    private String fragmentId;

    @Column(name = "order_index", nullable = false)
    private Integer orderIndex;

    @Column(name = "parent_node_id")
    private String parentNodeId;

    @Column(name = "parent_operand_id")
    private String parentOperandId;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
