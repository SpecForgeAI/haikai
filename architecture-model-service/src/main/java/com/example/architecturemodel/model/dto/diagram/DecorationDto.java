package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public record DecorationDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("type")
    String type,

    @JsonProperty("text")
    String text,

    @JsonProperty("text_font_size")
    Double textFontSize,

    @JsonProperty("text_font_weight")
    String textFontWeight,

    @JsonProperty("text_font_style")
    String textFontStyle,

    @JsonProperty("text_text_decoration")
    String textTextDecoration,

    @JsonProperty("text_color")
    String textColor,

    @JsonProperty("line_color")
    String lineColor,

    @JsonProperty("line_style")
    String lineStyle,

    @JsonProperty("line_weight")
    String lineWeight,

    @JsonProperty("z_index")
    Integer zIndex,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo,

    // Shape decoration fields
    @JsonProperty("pos_x")
    Double posX,

    @JsonProperty("pos_y")
    Double posY,

    @JsonProperty("width")
    Double width,

    @JsonProperty("height")
    Double height,

    @JsonProperty("text_h_align")
    String textHAlign,

    @JsonProperty("text_v_align")
    String textVAlign,

    @JsonProperty("background_color")
    String backgroundColor,

    @JsonProperty("background_opacity")
    Integer backgroundOpacity,

    @JsonProperty("border_opacity")
    Integer borderOpacity,

    @JsonProperty("auto_size")
    Boolean autoSize,

    // Line decoration fields
    @JsonProperty("line_points")
    List<LinePointDto> linePoints,

    @JsonProperty("label_pos_x")
    Double labelPosX,

    @JsonProperty("label_pos_y")
    Double labelPosY,

    @JsonProperty("arrow_start")
    String arrowStart,

    @JsonProperty("arrow_end")
    String arrowEnd,

    @JsonProperty("linkedDiagramId")
    String linkedDiagramId
) {}
