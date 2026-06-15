package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

public record DiagramEdgeDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("relationship_type")
    String relationshipType,

    @JsonProperty("relationship_id")
    String relationshipId,

    @JsonProperty("source_node_id")
    String sourceNodeId,

    @JsonProperty("target_node_id")
    String targetNodeId,

    @JsonProperty("label_text")
    String labelText,

    @JsonProperty("label_pos_x")
    Double labelPosX,

    @JsonProperty("label_pos_y")
    Double labelPosY,

    @JsonProperty("line_weight")
    String lineWeight,

    @JsonProperty("line_type")
    String lineType,

    @JsonProperty("line_dashes")
    String lineDashes,

    @JsonProperty("arrow_start")
    String arrowStart,

    @JsonProperty("arrow_end")
    String arrowEnd,

    @JsonProperty("style_override")
    Map<String, Object> styleOverride,

    @JsonProperty("edge_points")
    List<EdgePointDto> edgePoints,

    @JsonProperty("label_font_size")
    String labelFontSize,

    @JsonProperty("label_font_weight")
    String labelFontWeight,

    @JsonProperty("label_font_style")
    String labelFontStyle,

    @JsonProperty("label_text_decoration")
    String labelTextDecoration,

    @JsonProperty("label_h_align")
    String labelHAlign,

    @JsonProperty("label_v_align")
    String labelVAlign,

    @JsonProperty("line_color")
    String lineColor,

    @JsonProperty("text_color")
    String textColor,

    @JsonProperty("subType")
    String subType,

    @JsonProperty("source_label_text")
    String sourceLabelText,

    @JsonProperty("source_label_pos_x")
    Double sourceLabelPosX,

    @JsonProperty("source_label_pos_y")
    Double sourceLabelPosY,

    @JsonProperty("target_label_text")
    String targetLabelText,

    @JsonProperty("target_label_pos_x")
    Double targetLabelPosX,

    @JsonProperty("target_label_pos_y")
    Double targetLabelPosY,

    @JsonProperty("z_index")
    Integer zIndex,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo,

    @JsonProperty("linkedDiagramId")
    String linkedDiagramId
) {}
