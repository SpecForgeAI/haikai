package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "activity_flows")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ActivityFlowEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "from_activity_id", nullable = false)
    private String fromActivityId;

    @Column(name = "to_activity_id", nullable = false)
    private String toActivityId;

    // Trigger fields (optional, one-of: ref pair OR label text)
    @Column(name = "trigger_ref_kind")
    private String triggerRefKind;

    @Column(name = "trigger_ref_id")
    private String triggerRefId;

    @Column(name = "trigger_label_text")
    private String triggerLabelText;

    // Condition fields (optional, one-of: ref pair OR expression)
    @Column(name = "condition_ref_kind")
    private String conditionRefKind;

    @Column(name = "condition_ref_id")
    private String conditionRefId;

    @Column(name = "condition_expression")
    private String conditionExpression;

    // Additional fields
    @Column(name = "flow_kind", nullable = false)
    private String flowKind;

    @Column(name = "order_index")
    private Integer orderIndex;

    @Column(name = "description")
    private String description;
}
