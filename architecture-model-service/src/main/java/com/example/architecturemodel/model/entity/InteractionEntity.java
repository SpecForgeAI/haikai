package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "interactions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class InteractionEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "primary_app_business_point_id", nullable = false)
    private String primaryAppBusinessPointId;

    @Column(name = "secondary_app_business_point_id")
    private String secondaryAppBusinessPointId;
}
