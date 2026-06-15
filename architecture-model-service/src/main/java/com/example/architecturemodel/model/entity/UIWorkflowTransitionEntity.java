package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "ui_workflow_transitions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UIWorkflowTransitionEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "source_screen_id", nullable = false)
    private String sourceScreenId;

    @Column(name = "target_screen_id", nullable = false)
    private String targetScreenId;

    @Column(name = "trigger")
    private String trigger;

    @Column(name = "guard")
    private String guard;
}
