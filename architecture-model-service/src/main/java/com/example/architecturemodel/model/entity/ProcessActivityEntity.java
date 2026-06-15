package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "process_activities")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ProcessActivityEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "business_process_id", nullable = false)
    private String businessProcessId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "sequence_order")
    private Integer sequenceOrder;

    @Column(name = "frequency")
    private String frequency;

    @Column(name = "actor_hint", nullable = true)
    private String actorHint;

    @Column(name = "user_interaction_level", nullable = false)
    private String userInteractionLevel;

    @Column(name = "tags")
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;
}
