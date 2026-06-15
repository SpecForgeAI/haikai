package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "ui_actions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UIActionEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "trigger_type", nullable = false)
    private String triggerType;

    @Column(name = "owner_screen_id")
    private String ownerScreenId;

    @Column(name = "owner_component_id")
    private String ownerComponentId;

    @Column(name = "effect_type", nullable = false)
    private String effectType;

    @Column(name = "description")
    private String description;

    @Column(name = "contract_id")
    private String contractId;
}
