package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "ui_screens")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UIScreenEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "route", nullable = false)
    private String route;

    @Column(name = "description")
    private String description;

    @Column(name = "application_point_id")
    private String applicationPointId;
}
