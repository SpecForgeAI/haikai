package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

/**
 * JPA Entity for UI Characteristic.
 *
 * Captures business features and UI/UX/technical characteristics associated
 * with frontend UIs, linked to Application Points.
 *
 * Spec: UI Characteristics
 */
@Entity
@Table(name = "ui_characteristics")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UICharacteristicEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "ui_id", nullable = false)
    private String uiId;

    @Column(name = "type", nullable = false)
    private String type;

    @Column(name = "key")
    private String key;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "evidence")
    private String evidence;
}
