package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.util.List;
import java.util.Map;

@Entity
@Table(name = "diagram_nodes")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiagramNodeEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "diagram_id", nullable = false)
    private String diagramId;

    @Column(name = "entity_type", nullable = false)
    private String entityType;

    @Column(name = "entity_id", nullable = false)
    private String entityId;

    @Column(name = "pos_x", nullable = false)
    private Double posX;

    @Column(name = "pos_y", nullable = false)
    private Double posY;

    @Column(name = "width")
    private Double width;

    @Column(name = "height")
    private Double height;

    @Column(name = "auto_size")
    private Boolean autoSize;

    @Column(name = "z_index")
    private Integer zIndex;

    @Column(name = "parent_node_id")
    private String parentNodeId;

    @Type(JsonType.class)
    @Column(name = "style_override", columnDefinition = "jsonb")
    private Map<String, Object> styleOverride;

    @Column(name = "text_h_align")
    private String textHAlign;

    @Column(name = "text_v_align")
    private String textVAlign;

    @Column(name = "text_area_width")
    private Double textAreaWidth;

    @Column(name = "text_font_size")
    private String textFontSize;

    @Column(name = "text_font_weight")
    private String textFontWeight;

    @Column(name = "text_font_style")
    private String textFontStyle;

    @Column(name = "text_text_decoration")
    private String textTextDecoration;

    @Column(name = "background_color")
    private String backgroundColor;

    @Column(name = "line_color")
    private String lineColor;

    @Column(name = "line_weight")
    private String lineWeight;

    @Column(name = "text_color")
    private String textColor;

    @Column(name = "render_style")
    private String renderStyle;

    @Type(JsonType.class)
    @Column(name = "embedded_attribute_ids", columnDefinition = "jsonb")
    private List<String> embeddedAttributeIds;

    @Type(JsonType.class)
    @Column(name = "selected_attribute_ids", columnDefinition = "jsonb")
    private List<String> selectedAttributeIds;

    @Type(JsonType.class)
    @Column(name = "embedded_endpoint_ids", columnDefinition = "jsonb")
    private List<String> embeddedEndpointIds;

    @Type(JsonType.class)
    @Column(name = "embedded_entity_ids", columnDefinition = "jsonb")
    private List<String> embeddedEntityIds;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;

    @Column(name = "linked_diagram_id")
    private String linkedDiagramId;
}
