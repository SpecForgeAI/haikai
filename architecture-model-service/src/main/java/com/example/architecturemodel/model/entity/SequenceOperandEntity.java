package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;

@Entity
@Table(name = "sequence_operands")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SequenceOperandEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "fragment_id", nullable = false)
    private String fragmentId;

    @Column(name = "guard_expression", nullable = false)
    private String guardExpression;

    @Column(name = "operand_index", nullable = false)
    private Integer operandIndex;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
