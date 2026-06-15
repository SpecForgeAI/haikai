package com.example.architecturemodel.model.entity;

import com.example.architecturemodel.model.dto.diagram.LinePointDto;
import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.util.List;

@Entity
@Table(name = "diagram_decorations")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiagramDecorationEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "diagram_id", nullable = false)
    private String diagramId;

    @Column(name = "decoration_type", nullable = false)
    private String decorationType;

    @Column(name = "text")
    private String text;

    @Column(name = "text_font_size")
    private Double textFontSize;

    @Column(name = "text_font_weight")
    private String textFontWeight;

    @Column(name = "text_font_style")
    private String textFontStyle;

    @Column(name = "text_text_decoration")
    private String textTextDecoration;

    @Column(name = "text_color")
    private String textColor;

    @Column(name = "line_color")
    private String lineColor;

    @Column(name = "line_style")
    private String lineStyle;

    @Column(name = "line_weight")
    private String lineWeight;

    @Column(name = "z_index")
    private Integer zIndex;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;

    // Shape decoration fields
    @Column(name = "pos_x")
    private Double posX;

    @Column(name = "pos_y")
    private Double posY;

    @Column(name = "width")
    private Double width;

    @Column(name = "height")
    private Double height;

    @Column(name = "text_h_align")
    private String textHAlign;

    @Column(name = "text_v_align")
    private String textVAlign;

    @Column(name = "background_color")
    private String backgroundColor;

    @Column(name = "background_opacity")
    private Integer backgroundOpacity;

    @Column(name = "border_opacity")
    private Integer borderOpacity;

    @Column(name = "auto_size")
    private Boolean autoSize;

    // Line decoration fields
    @Type(JsonType.class)
    @Column(name = "line_points", columnDefinition = "jsonb")
    private List<LinePointDto> linePoints;

    @Column(name = "label_pos_x")
    private Double labelPosX;

    @Column(name = "label_pos_y")
    private Double labelPosY;

    @Column(name = "arrow_start")
    private String arrowStart;

    @Column(name = "arrow_end")
    private String arrowEnd;

    @Column(name = "linked_diagram_id")
    private String linkedDiagramId;
}
