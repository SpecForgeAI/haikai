package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "state_transitions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StateTransitionEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "from_state_id", nullable = false)
    private String fromStateId;

    @Column(name = "to_state_id", nullable = false)
    private String toStateId;

    @Column(name = "order_index")
    private Integer orderIndex;

    @Column(name = "description")
    private String description;

    // Trigger fields (required, one-of: ref pair OR label)
    @Column(name = "trigger_ref_kind")
    private String triggerRefKind;

    @Column(name = "trigger_ref_id")
    private String triggerRefId;

    @Column(name = "trigger_label_text")
    private String triggerLabelText;

    // Guard fields (optional, one-of: ref pair OR expression)
    @Column(name = "guard_ref_kind")
    private String guardRefKind;

    @Column(name = "guard_ref_id")
    private String guardRefId;

    @Column(name = "guard_expression")
    private String guardExpression;

    // Effect fields (optional, one-of: ref pair OR label)
    @Column(name = "effect_ref_kind")
    private String effectRefKind;

    @Column(name = "effect_ref_id")
    private String effectRefId;

    @Column(name = "effect_label_text")
    private String effectLabelText;
}
