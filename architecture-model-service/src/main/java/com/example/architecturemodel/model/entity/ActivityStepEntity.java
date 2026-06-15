package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "activity_steps")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ActivityStepEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "user_journey_id", nullable = false)
    private String userJourneyId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "tags")
    private String tags;

    @Column(name = "sequence_order")
    private Integer sequenceOrder;

    @Column(name = "process_activity_id", nullable = false)
    private String processActivityId;

    @Column(name = "business_user_id", nullable = false)
    private String businessUserId;

    @Column(name = "application_id", nullable = false)
    private String applicationId;

    @Column(name = "diagram_label", nullable = false)
    private String diagramLabel;

    @Column(name = "activity_issues", nullable = false)
    private String activityIssues;

    @Column(name = "ui_issues", nullable = false)
    private String uiIssues;
}
