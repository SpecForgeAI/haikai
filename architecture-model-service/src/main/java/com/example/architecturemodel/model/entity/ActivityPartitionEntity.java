package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "activity_partitions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ActivityPartitionEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name")
    private String name;

    @Column(name = "ref_kind")
    private String refKind;

    @Column(name = "ref_id")
    private String refId;

    @Column(name = "order_index")
    private Integer orderIndex;

    @Column(name = "description")
    private String description;
}
