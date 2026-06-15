package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

public record DiagramNodeDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("entity_type")
    String entityType,

    @JsonProperty("entity_id")
    String entityId,

    @JsonProperty("pos_x")
    Double posX,

    @JsonProperty("pos_y")
    Double posY,

    @JsonProperty("width")
    Double width,

    @JsonProperty("height")
    Double height,

    @JsonProperty("auto_size")
    Boolean autoSize,

    @JsonProperty("z_index")
    Integer zIndex,

    @JsonProperty("parent_node_id")
    String parentNodeId,

    @JsonProperty("style_override")
    Map<String, Object> styleOverride,

    @JsonProperty("text_h_align")
    String textHAlign,

    @JsonProperty("text_v_align")
    String textVAlign,

    @JsonProperty("text_area_width")
    Double textAreaWidth,

    @JsonProperty("text_font_size")
    String textFontSize,

    @JsonProperty("text_font_weight")
    String textFontWeight,

    @JsonProperty("text_font_style")
    String textFontStyle,

    @JsonProperty("text_text_decoration")
    String textTextDecoration,

    @JsonProperty("background_color")
    String backgroundColor,

    @JsonProperty("line_color")
    String lineColor,

    @JsonProperty("line_weight")
    String lineWeight,

    @JsonProperty("text_color")
    String textColor,

    @JsonProperty("render_style")
    String renderStyle,

    @JsonProperty("embedded_attribute_ids")
    List<String> embeddedAttributeIds,

    @JsonProperty("selected_attribute_ids")
    List<String> selectedAttributeIds,

    @JsonProperty("embedded_endpoint_ids")
    List<String> embeddedEndpointIds,

    @JsonProperty("embedded_entity_ids")
    List<String> embeddedEntityIds,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo,

    @JsonProperty("linkedDiagramId")
    String linkedDiagramId
) {}
