package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "logical_data_entity_physical_data_entities")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LogicalDataEntityPhysicalDataEntityEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "logical_entity_id", nullable = false)
    private String logicalEntityId;

    @Column(name = "physical_entity_id", nullable = false)
    private String physicalEntityId;

    @Column(name = "description")
    private String description;

    @Column(name = "tags")
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;
}
