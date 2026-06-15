package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.model.entity.*;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

@Component
public class DiagramMapper {

    // ============================================================================
    // Diagram Type Normalization
    // ============================================================================

    /**
     * Normalizes a diagram type string to its canonical form.
     *
     * Handles case-insensitive matching and trims whitespace.
     * Canonical values: "General", "ER", "Sequence", "Activity", "State", "USER_JOURNEY"
     *
     * @param raw The raw diagram type string (may have incorrect casing or whitespace)
     * @return The normalized canonical diagram type, or the trimmed input for unknown values, or null if input is null
     */
    private String normalizeDiagramType(String raw) {
        if (raw == null) {
            return null;
        }

        String trimmed = raw.trim();
        String upper = trimmed.toUpperCase();

        return switch (upper) {
            case "GENERAL" -> "General";
            case "ER" -> "ER";
            case "SEQUENCE" -> "Sequence";
            case "ACTIVITY" -> "Activity";
            case "STATE" -> "State";
            case "USER_JOURNEY" -> "USER_JOURNEY";
            default -> trimmed;  // Return trimmed input for unknown values (do not throw)
        };
    }

    // ============================================================================
    // Diagram Entity Mappings
    // ============================================================================

    /**
     * Converts a DiagramEntity to DiagramDto, including the typedContent field.
     *
     * The entity's typedContentJson (Map<String, Object>) is directly mapped to
     * the DTO's typedContent field. NULL values are preserved for General diagrams.
     *
     * The diagramType is normalized to ensure canonical values are returned,
     * which is defensive for legacy database values that may have incorrect casing.
     *
     * @param entity The diagram entity
     * @param nodes List of diagram nodes
     * @param edges List of diagram edges
     * @param decorations List of decorations
     * @param interactionEdges List of interaction edges
     * @return DiagramDto with all fields including typedContent
     */
    public DiagramDto toDto(DiagramEntity entity, List<DiagramNodeDto> nodes, List<DiagramEdgeDto> edges,
                           List<DecorationDto> decorations, List<DiagramInteractionEdgeDto> interactionEdges) {
        return new DiagramDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            normalizeDiagramType(entity.getDiagramType()),
            entity.getSettings(),
            entity.getViewQuarter(),
            nodes,
            edges,
            decorations,
            interactionEdges,
            entity.getTypedContentJson()  // Map<String, Object> directly maps to typedContent
        );
    }

    /**
     * Converts a DiagramDto to DiagramEntity, including the typedContent field.
     *
     * The DTO's typedContent (Map<String, Object>) is directly mapped to
     * the entity's typedContentJson field. NULL values are preserved for General diagrams.
     *
     * The diagramType is normalized to ensure canonical values are persisted,
     * even if the client sends values with incorrect casing.
     *
     * @param dto The diagram DTO
     * @param modelFileId The model file ID for this diagram
     * @return DiagramEntity with all fields including typedContentJson
     */
    public DiagramEntity toEntity(DiagramDto dto, String modelFileId) {
        return DiagramEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .diagramType(normalizeDiagramType(dto.diagramType()))
            .settings(dto.settings())
            .viewQuarter(dto.viewQuarter())
            .typedContentJson(dto.typedContent())  // Map<String, Object> directly maps to typedContentJson
            .build();
    }

    // ============================================================================
    // Diagram Node Mappings
    // ============================================================================

    public DiagramNodeDto toDto(DiagramNodeEntity entity) {
        return new DiagramNodeDto(
            entity.getId(),
            entity.getEntityType(),
            entity.getEntityId(),
            entity.getPosX(),
            entity.getPosY(),
            entity.getWidth(),
            entity.getHeight(),
            entity.getAutoSize(),
            entity.getZIndex(),
            entity.getParentNodeId(),
            entity.getStyleOverride(),
            entity.getTextHAlign(),
            entity.getTextVAlign(),
            entity.getTextAreaWidth(),
            entity.getTextFontSize(),
            entity.getTextFontWeight(),
            entity.getTextFontStyle(),
            entity.getTextTextDecoration(),
            entity.getBackgroundColor(),
            entity.getLineColor(),
            entity.getLineWeight(),
            entity.getTextColor(),
            entity.getRenderStyle(),
            entity.getEmbeddedAttributeIds(),
            entity.getSelectedAttributeIds(),
            entity.getEmbeddedEndpointIds(),
            entity.getEmbeddedEntityIds(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getLinkedDiagramId()
        );
    }

    public DiagramNodeEntity toEntity(DiagramNodeDto dto, String modelFileId, String diagramId) {
        return DiagramNodeEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .diagramId(diagramId)
            .entityType(dto.entityType())
            .entityId(dto.entityId())
            .posX(dto.posX())
            .posY(dto.posY())
            .width(dto.width())
            .height(dto.height())
            .autoSize(dto.autoSize())
            .zIndex(dto.zIndex())
            .parentNodeId(dto.parentNodeId())
            .styleOverride(dto.styleOverride())
            .textHAlign(dto.textHAlign())
            .textVAlign(dto.textVAlign())
            .textAreaWidth(dto.textAreaWidth())
            .textFontSize(dto.textFontSize())
            .textFontWeight(dto.textFontWeight())
            .textFontStyle(dto.textFontStyle())
            .textTextDecoration(dto.textTextDecoration())
            .backgroundColor(dto.backgroundColor())
            .lineColor(dto.lineColor())
            .lineWeight(dto.lineWeight())
            .textColor(dto.textColor())
            .renderStyle(dto.renderStyle())
            .embeddedAttributeIds(dto.embeddedAttributeIds())
            .selectedAttributeIds(dto.selectedAttributeIds())
            .embeddedEndpointIds(dto.embeddedEndpointIds())
            .embeddedEntityIds(dto.embeddedEntityIds())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .linkedDiagramId(dto.linkedDiagramId())
            .build();
    }

    // ============================================================================
    // Diagram Edge Mappings
    // ============================================================================

    public DiagramEdgeDto toDto(DiagramEdgeEntity entity) {
        return new DiagramEdgeDto(
            entity.getId(),
            entity.getRelationshipType(),
            entity.getRelationshipId(),
            entity.getSourceNodeId(),
            entity.getTargetNodeId(),
            entity.getLabelText(),
            entity.getLabelPosX(),
            entity.getLabelPosY(),
            entity.getLineWeight(),
            entity.getLineType(),
            entity.getLineDashes(),
            entity.getArrowStart(),
            entity.getArrowEnd(),
            entity.getStyleOverride(),
            entity.getEdgePoints(),
            entity.getLabelFontSize(),
            entity.getLabelFontWeight(),
            entity.getLabelFontStyle(),
            entity.getLabelTextDecoration(),
            entity.getLabelHAlign(),
            entity.getLabelVAlign(),
            entity.getLineColor(),
            entity.getTextColor(),
            entity.getSubType(),
            entity.getSourceLabelText(),
            entity.getSourceLabelPosX(),
            entity.getSourceLabelPosY(),
            entity.getTargetLabelText(),
            entity.getTargetLabelPosX(),
            entity.getTargetLabelPosY(),
            entity.getZIndex(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getLinkedDiagramId()
        );
    }

    public DiagramEdgeEntity toEntity(DiagramEdgeDto dto, String modelFileId, String diagramId) {
        return DiagramEdgeEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .diagramId(diagramId)
            .relationshipType(dto.relationshipType())
            .relationshipId(dto.relationshipId())
            .sourceNodeId(dto.sourceNodeId())
            .targetNodeId(dto.targetNodeId())
            .labelText(dto.labelText())
            .labelPosX(dto.labelPosX())
            .labelPosY(dto.labelPosY())
            .lineWeight(dto.lineWeight())
            .lineType(dto.lineType())
            .lineDashes(dto.lineDashes())
            .arrowStart(dto.arrowStart())
            .arrowEnd(dto.arrowEnd())
            .styleOverride(dto.styleOverride())
            .edgePoints(dto.edgePoints())
            .labelFontSize(dto.labelFontSize())
            .labelFontWeight(dto.labelFontWeight())
            .labelFontStyle(dto.labelFontStyle())
            .labelTextDecoration(dto.labelTextDecoration())
            .labelHAlign(dto.labelHAlign())
            .labelVAlign(dto.labelVAlign())
            .lineColor(dto.lineColor())
            .textColor(dto.textColor())
            .subType(dto.subType())
            .sourceLabelText(dto.sourceLabelText())
            .sourceLabelPosX(dto.sourceLabelPosX())
            .sourceLabelPosY(dto.sourceLabelPosY())
            .targetLabelText(dto.targetLabelText())
            .targetLabelPosX(dto.targetLabelPosX())
            .targetLabelPosY(dto.targetLabelPosY())
            .zIndex(dto.zIndex())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .linkedDiagramId(dto.linkedDiagramId())
            .build();
    }

    // ============================================================================
    // Diagram Interaction Edge Mappings
    // ============================================================================

    public DiagramInteractionEdgeDto toDto(DiagramInteractionEdgeEntity entity) {
        return new DiagramInteractionEdgeDto(
            entity.getId(),
            entity.getInteractionId(),
            entity.getRelationshipType(),
            entity.getSourceNodeId(),
            entity.getTargetNodeId(),
            entity.getEdgePoints(),
            entity.getLabelText(),
            entity.getLabelPosX(),
            entity.getLabelPosY(),
            entity.getUserNodeId(),
            entity.getUserLinkEdgePoints(),
            entity.getLineStyle()
        );
    }

    public DiagramInteractionEdgeEntity toEntity(DiagramInteractionEdgeDto dto, String modelFileId, String diagramId) {
        return DiagramInteractionEdgeEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .diagramId(diagramId)
            .interactionId(dto.interactionId())
            .relationshipType(dto.relationshipType() != null ? dto.relationshipType() : "USER_INTERACTION")
            .sourceNodeId(dto.sourceNodeId())
            .targetNodeId(dto.targetNodeId())
            .edgePoints(dto.edgePoints())
            .labelText(dto.labelText())
            .labelPosX(dto.labelPosX())
            .labelPosY(dto.labelPosY())
            .userNodeId(dto.userNodeId())
            .userLinkEdgePoints(dto.userLinkEdgePoints())
            .lineStyle(dto.lineStyle())
            .build();
    }

    // ============================================================================
    // Diagram Decoration Mappings
    // ============================================================================

    public DecorationDto toDto(DiagramDecorationEntity entity) {
        return new DecorationDto(
            entity.getId(),
            entity.getDecorationType(),
            entity.getText(),
            entity.getTextFontSize(),
            entity.getTextFontWeight(),
            entity.getTextFontStyle(),
            entity.getTextTextDecoration(),
            entity.getTextColor(),
            entity.getLineColor(),
            entity.getLineStyle(),
            entity.getLineWeight(),
            entity.getZIndex(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getPosX(),
            entity.getPosY(),
            entity.getWidth(),
            entity.getHeight(),
            entity.getTextHAlign(),
            entity.getTextVAlign(),
            entity.getBackgroundColor(),
            entity.getBackgroundOpacity(),
            entity.getBorderOpacity(),
            entity.getAutoSize(),
            entity.getLinePoints(),
            entity.getLabelPosX(),
            entity.getLabelPosY(),
            entity.getArrowStart(),
            entity.getArrowEnd(),
            entity.getLinkedDiagramId()
        );
    }

    public DiagramDecorationEntity toEntity(DecorationDto dto, String modelFileId, String diagramId) {
        return DiagramDecorationEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .diagramId(diagramId)
            .decorationType(dto.type())
            .text(dto.text())
            .textFontSize(dto.textFontSize())
            .textFontWeight(dto.textFontWeight())
            .textFontStyle(dto.textFontStyle())
            .textTextDecoration(dto.textTextDecoration())
            .textColor(dto.textColor())
            .lineColor(dto.lineColor())
            .lineStyle(dto.lineStyle())
            .lineWeight(dto.lineWeight())
            .zIndex(dto.zIndex())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .posX(dto.posX())
            .posY(dto.posY())
            .width(dto.width())
            .height(dto.height())
            .textHAlign(dto.textHAlign())
            .textVAlign(dto.textVAlign())
            .backgroundColor(dto.backgroundColor())
            .backgroundOpacity(dto.backgroundOpacity())
            .borderOpacity(dto.borderOpacity())
            .autoSize(dto.autoSize())
            .linePoints(dto.linePoints())
            .labelPosX(dto.labelPosX())
            .labelPosY(dto.labelPosY())
            .arrowStart(dto.arrowStart())
            .arrowEnd(dto.arrowEnd())
            .linkedDiagramId(dto.linkedDiagramId())
            .build();
    }
}
