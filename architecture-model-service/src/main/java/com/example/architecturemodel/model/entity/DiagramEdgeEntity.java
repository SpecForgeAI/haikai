package com.example.architecturemodel.model.entity;

import com.example.architecturemodel.model.dto.diagram.EdgePointDto;
import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.util.List;
import java.util.Map;

@Entity
@Table(name = "diagram_edges")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiagramEdgeEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "diagram_id", nullable = false)
    private String diagramId;

    @Column(name = "relationship_type", nullable = false)
    private String relationshipType;

    @Column(name = "relationship_id", nullable = false)
    private String relationshipId;

    @Column(name = "source_node_id", nullable = false)
    private String sourceNodeId;

    @Column(name = "target_node_id", nullable = false)
    private String targetNodeId;

    @Column(name = "label_text")
    private String labelText;

    @Column(name = "label_pos_x")
    private Double labelPosX;

    @Column(name = "label_pos_y")
    private Double labelPosY;

    @Column(name = "line_weight")
    private String lineWeight;

    @Column(name = "line_type")
    private String lineType;

    @Column(name = "line_dashes")
    private String lineDashes;

    @Column(name = "arrow_start")
    private String arrowStart;

    @Column(name = "arrow_end")
    private String arrowEnd;

    @Type(JsonType.class)
    @Column(name = "style_override", columnDefinition = "jsonb")
    private Map<String, Object> styleOverride;

    @Type(JsonType.class)
    @Column(name = "edge_points", columnDefinition = "jsonb", nullable = false)
    private List<EdgePointDto> edgePoints;

    @Column(name = "label_font_size")
    private String labelFontSize;

    @Column(name = "label_font_weight")
    private String labelFontWeight;

    @Column(name = "label_font_style")
    private String labelFontStyle;

    @Column(name = "label_text_decoration")
    private String labelTextDecoration;

    @Column(name = "label_h_align")
    private String labelHAlign;

    @Column(name = "label_v_align")
    private String labelVAlign;

    @Column(name = "line_color")
    private String lineColor;

    @Column(name = "text_color")
    private String textColor;

    @Column(name = "sub_type")
    private String subType;

    @Column(name = "source_label_text")
    private String sourceLabelText;

    @Column(name = "source_label_pos_x")
    private Double sourceLabelPosX;

    @Column(name = "source_label_pos_y")
    private Double sourceLabelPosY;

    @Column(name = "target_label_text")
    private String targetLabelText;

    @Column(name = "target_label_pos_x")
    private Double targetLabelPosX;

    @Column(name = "target_label_pos_y")
    private Double targetLabelPosY;

    @Column(name = "z_index")
    private Integer zIndex;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;

    @Column(name = "linked_diagram_id")
    private String linkedDiagramId;
}
