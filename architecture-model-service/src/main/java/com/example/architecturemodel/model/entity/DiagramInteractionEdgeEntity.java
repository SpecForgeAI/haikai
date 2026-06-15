package com.example.architecturemodel.model.entity;

import com.example.architecturemodel.model.dto.diagram.EdgePointDto;
import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.util.List;

@Entity
@Table(name = "diagram_interaction_edges")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiagramInteractionEdgeEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "diagram_id", nullable = false)
    private String diagramId;

    @Column(name = "interaction_id", nullable = false)
    private String interactionId;

    @Column(name = "relationship_type", nullable = false)
    private String relationshipType;

    @Column(name = "source_node_id", nullable = false)
    private String sourceNodeId;

    @Column(name = "target_node_id", nullable = false)
    private String targetNodeId;

    @Type(JsonType.class)
    @Column(name = "edge_points", columnDefinition = "jsonb", nullable = false)
    private List<EdgePointDto> edgePoints;

    @Column(name = "label_text")
    private String labelText;

    @Column(name = "label_pos_x")
    private Double labelPosX;

    @Column(name = "label_pos_y")
    private Double labelPosY;

    @Column(name = "user_node_id")
    private String userNodeId;

    @Type(JsonType.class)
    @Column(name = "user_link_edge_points", columnDefinition = "jsonb")
    private List<EdgePointDto> userLinkEdgePoints;

    @Column(name = "line_style")
    private String lineStyle;
}
