package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "user_journey_links")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserJourneyLinkEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "source_user_journey_id", nullable = false)
    private String sourceUserJourneyId;

    @Column(name = "target_user_journey_id", nullable = false)
    private String targetUserJourneyId;

    @Column(name = "relationship_type", nullable = false)
    private String relationshipType;

    @Column(name = "label")
    private String label;

    @Column(name = "description")
    private String description;

    @Column(name = "tags")
    private String tags;
}
