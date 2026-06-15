package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.entity.*;
import com.example.architecturemodel.model.dto.relationship.*;
import com.example.architecturemodel.model.entity.*;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.List;

@Component
public class EntityMapper {

    private final ObjectMapper objectMapper = new ObjectMapper();

    // ============================================================================
    // Business Domain Entity Mappings
    // ============================================================================

    public BusinessUserDto toDto(BusinessUserEntity entity) {
        return new BusinessUserDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getAbbreviation()
        );
    }

    public BusinessUserEntity toEntity(BusinessUserDto dto, String modelFileId) {
        return BusinessUserEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .abbreviation(dto.abbreviation())
            .build();
    }

    public BusinessProcessDto toDto(BusinessProcessEntity entity) {
        return new BusinessProcessDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo()
        );
    }

    public BusinessProcessEntity toEntity(BusinessProcessDto dto, String modelFileId) {
        return BusinessProcessEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
    }

    public ProcessActivityDto toDto(ProcessActivityEntity entity) {
        return new ProcessActivityDto(
            entity.getId(),
            entity.getBusinessProcessId(),
            entity.getName(),
            entity.getDescription(),
            entity.getSequenceOrder(),
            entity.getFrequency(),
            entity.getActorHint(),
            entity.getUserInteractionLevel(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo()
        );
    }

    public ProcessActivityEntity toEntity(ProcessActivityDto dto, String modelFileId) {
        return ProcessActivityEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .businessProcessId(dto.businessProcessId())
            .name(dto.name())
            .description(dto.description())
            .sequenceOrder(dto.sequenceOrder())
            .frequency(dto.frequency())
            .actorHint(dto.actorHint())
            .userInteractionLevel(dto.userInteractionLevel())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
    }

    public UserJourneyDto toDto(UserJourneyEntity entity) {
        return new UserJourneyDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getPrimaryBusinessUserId(),
            entity.getParentBusinessProcessId()
        );
    }

    public UserJourneyEntity toEntity(UserJourneyDto dto, String modelFileId) {
        return UserJourneyEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .primaryBusinessUserId(dto.primaryBusinessUserId())
            .parentBusinessProcessId(dto.parentBusinessProcessId())
            .build();
    }

    public ActivityStepDto toDto(ActivityStepEntity entity) {
        return new ActivityStepDto(
            entity.getId(),
            entity.getUserJourneyId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getSequenceOrder(),
            entity.getProcessActivityId(),
            entity.getBusinessUserId(),
            entity.getApplicationId(),
            entity.getDiagramLabel(),
            entity.getActivityIssues(),
            entity.getUiIssues()
        );
    }

    public ActivityStepEntity toEntity(ActivityStepDto dto, String modelFileId) {
        return ActivityStepEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .userJourneyId(dto.userJourneyId())
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .sequenceOrder(dto.sequenceOrder())
            .processActivityId(dto.processActivityId())
            .businessUserId(dto.businessUserId())
            .applicationId(dto.applicationId())
            .diagramLabel(dto.diagramLabel())
            .activityIssues(dto.activityIssues() != null ? dto.activityIssues() : "")
            .uiIssues(dto.uiIssues() != null ? dto.uiIssues() : "")
            .build();
    }

    public BusinessPointDto toDto(BusinessPointEntity entity) {
        return new BusinessPointDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getKind(),
            entity.getBusinessProcessId(),
            entity.getProcessActivityId(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo()
        );
    }

    public BusinessPointEntity toEntity(BusinessPointDto dto, String modelFileId) {
        return BusinessPointEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .kind(dto.kind())
            .businessProcessId(dto.businessProcessId())
            .processActivityId(dto.processActivityId())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
    }

    // ============================================================================
    // Application Domain Entity Mappings
    // ============================================================================

    /**
     * Maps ApplicationEntity to DTO.
     *
     * Spec: Sequence Diagram Participant Colour and Icons for Services and Components
     * - Added isInternal field for internal/external classification
     */
    public ApplicationDto toDto(ApplicationEntity entity) {
        return new ApplicationDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getAppType(),
            entity.getStatus(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getIsInternal(),
            entity.getAbbreviation()
        );
    }

    /**
     * Maps ApplicationDto to Entity.
     *
     * Spec: Sequence Diagram Participant Colour and Icons for Services and Components
     * - Added isInternal field with null handling (defaults to true)
     */
    public ApplicationEntity toEntity(ApplicationDto dto, String modelFileId) {
        return ApplicationEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .appType(dto.appType())
            .status(dto.status())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .isInternal(dto.isInternal() != null ? dto.isInternal() : true)
            .abbreviation(dto.abbreviation())
            .build();
    }

    /**
     * Maps ApplicationComponentEntity to DTO.
     *
     * Spec: Sequence Diagram Participant Colour and Icons for Services and Components
     * - Added isInternal field for internal/external classification
     * - Added techType field for tier classification (UI Tier, Service Tier, Persistence Tier, Other)
     */
    public ApplicationComponentDto toDto(ApplicationComponentEntity entity) {
        return new ApplicationComponentDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getApplicationId(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getIsInternal(),
            entity.getTechType()
        );
    }

    /**
     * Maps ApplicationComponentDto to Entity.
     *
     * Spec: Sequence Diagram Participant Colour and Icons for Services and Components
     * - Added isInternal field with null handling (defaults to true)
     * - Added techType field with null handling (defaults to "Other")
     */
    public ApplicationComponentEntity toEntity(ApplicationComponentDto dto, String modelFileId) {
        return ApplicationComponentEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .applicationId(dto.applicationId())
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .isInternal(dto.isInternal() != null ? dto.isInternal() : true)
            .techType(dto.techType() != null ? dto.techType() : "Other")
            .build();
    }

    /**
     * Maps ServiceEntity to DTO.
     *
     * Spec: Sequence Diagram Participant Colour and Icons for Services and Components
     * - Added isInternal field for internal/external classification
     *
     * Spec: Tech Hints LLM Resolution (2026-04-20)
     * - Added coreTechResolved, coreTechLanguagePack, coreTechFrameworkPacks,
     *   coreTechResolutionConfidence, coreTechResolvedAt. All nullable; jsonb
     *   map is passed through unchanged.
     */
    public ServiceDto toDto(ServiceEntity entity) {
        return new ServiceDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getApplicationId(),
            entity.getApplicationComponentId(),
            entity.getServiceType(),
            entity.getCoreTech(),
            entity.getRepoLocation(),
            entity.getRepoSubfolder(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getPackageSetId(),
            entity.getIsInternal(),
            entity.getCoreTechResolved(),
            entity.getCoreTechLanguagePack(),
            entity.getCoreTechFrameworkPacks(),
            entity.getCoreTechResolutionConfidence(),
            entity.getCoreTechResolvedAt()
        );
    }

    /**
     * Maps ServiceDto to Entity.
     *
     * Spec: Sequence Diagram Participant Colour and Icons for Services and Components
     * - Added isInternal field with null handling (defaults to true)
     *
     * Spec: Tech Hints LLM Resolution (2026-04-20)
     * - Added coreTechResolved, coreTechLanguagePack, coreTechFrameworkPacks,
     *   coreTechResolutionConfidence, coreTechResolvedAt. All passed through
     *   unchanged; NULL values preserved (NULL means "unresolved" in the
     *   discovery tier gate).
     */
    public ServiceEntity toEntity(ServiceDto dto, String modelFileId) {
        return ServiceEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .applicationId(dto.applicationId())
            .applicationComponentId(dto.appComponentId())
            .name(dto.name())
            .description(dto.description())
            .serviceType(dto.serviceType())
            .coreTech(dto.coreTech())
            .repoLocation(dto.repoLocation())
            .repoSubfolder(dto.repoSubfolder())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .packageSetId(dto.packageSetId())
            .isInternal(dto.isInternal() != null ? dto.isInternal() : true)
            .coreTechResolved(dto.coreTechResolved())
            .coreTechLanguagePack(dto.coreTechLanguagePack())
            .coreTechFrameworkPacks(dto.coreTechFrameworkPacks())
            .coreTechResolutionConfidence(dto.coreTechResolutionConfidence())
            .coreTechResolvedAt(dto.coreTechResolvedAt())
            .build();
    }

    public InterfaceDto toDto(InterfaceEntity entity) {
        return new InterfaceDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getServiceId(),
            entity.getInterfaceType(),
            entity.getSpecLink(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo()
        );
    }

    public InterfaceEntity toEntity(InterfaceDto dto, String modelFileId) {
        return InterfaceEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .serviceId(dto.serviceId())
            .name(dto.name())
            .description(dto.description())
            .interfaceType(dto.interfaceType())
            .specLink(dto.specLink())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
    }

    /**
     * Maps EndpointEntity to DTO.
     *
     * Spec: Metamodel Interface Endpoint - Add Request/Response Data and Simplify Endpoints Table
     * - Added requestDataEntityPointId and responseDataEntityPointId fields
     * - Removed lifecycleStatus, version, tags from DTO (DB columns remain on entity)
     */
    public EndpointDto toDto(EndpointEntity entity) {
        return new EndpointDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getInterfaceId(),
            entity.getEndpointType(),
            entity.getPathOrAddress(),
            entity.getProtocol(),
            entity.getOperationVerb(),
            entity.getDirection(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getRequestDataEntityPointId(),
            entity.getResponseDataEntityPointId(),
            entity.getProtocolMetadataJson(),
            entity.getResponseContract()
        );
    }

    /**
     * Maps EndpointDto to Entity.
     *
     * Spec: Metamodel Interface Endpoint - Add Request/Response Data and Simplify Endpoints Table
     * - Added requestDataEntityPointId and responseDataEntityPointId fields
     * - Removed lifecycleStatus, version, tags mapping from DTO (fields no longer on DTO)
     */
    public EndpointEntity toEntity(EndpointDto dto, String modelFileId) {
        return EndpointEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .interfaceId(dto.interfaceId())
            .name(dto.name())
            .description(dto.description())
            .endpointType(dto.endpointType())
            .pathOrAddress(dto.pathOrAddress())
            .protocol(dto.protocol())
            .operationVerb(dto.operationVerb())
            .direction(dto.direction())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .requestDataEntityPointId(dto.requestDataEntityPointId())
            .responseDataEntityPointId(dto.responseDataEntityPointId())
            .protocolMetadataJson(dto.protocolMetadataJson())
            .responseContract(dto.responseContract())
            .build();
    }

    // ============================================================================
    // Class and Method Entity Mappings (Application Architecture Domain)
    // ============================================================================

    public ClassDto toDto(ClassEntity entity) {
        return new ClassDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getNamespace(),
            entity.getServiceId()
        );
    }

    public ClassEntity toEntity(ClassDto dto, String modelFileId) {
        return ClassEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .namespace(dto.namespace())
            .serviceId(dto.serviceId())
            .build();
    }

    public MethodDto toDto(MethodEntity entity) {
        return new MethodDto(
            entity.getId(),
            entity.getClassId(),
            entity.getName(),
            entity.getDescription(),
            entity.getParametersJson(),
            entity.getReturnsJson(),
            entity.getThrowsJson()
        );
    }

    public MethodEntity toEntity(MethodDto dto, String modelFileId) {
        return MethodEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .classId(dto.classId())
            .name(dto.name())
            .description(dto.description())
            .parametersJson(dto.parametersJson())
            .returnsJson(dto.returnsJson())
            .throwsJson(dto.throwsJson())
            .build();
    }

    /**
     * Maps ApplicationPointEntity to DTO.
     *
     * Includes new target_type and target_ref_id fields for precise targeting
     * of Service, Class, or Method entities.
     *
     * Spec: Expand Application Points to Reference Service/Class/Method
     */
    public ApplicationPointDto toDto(ApplicationPointEntity entity) {
        return new ApplicationPointDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getKind(),
            entity.getApplicationId(),
            entity.getApplicationComponentId(),
            entity.getServiceId(),
            entity.getInterfaceId(),
            entity.getTargetType(),
            entity.getTargetRefId(),
            entity.getPointType(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo()
        );
    }

    /**
     * Maps ApplicationPointDto to Entity.
     *
     * Includes new target_type and target_ref_id fields for precise targeting
     * of Service, Class, or Method entities.
     *
     * Spec: Expand Application Points to Reference Service/Class/Method
     */
    public ApplicationPointEntity toEntity(ApplicationPointDto dto, String modelFileId) {
        return ApplicationPointEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .kind(dto.kind())
            .applicationId(dto.applicationId())
            .applicationComponentId(dto.applicationComponentId())
            .serviceId(dto.serviceId())
            .interfaceId(dto.interfaceId())
            .targetType(dto.targetType())
            .targetRefId(dto.targetRefId())
            .pointType(dto.pointType())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
    }

    // ============================================================================
    // Data Domain Entity Mappings
    // ============================================================================

    public LogicalDataEntityDto toDto(LogicalDataEntityEntity entity) {
        return new LogicalDataEntityDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getSourceProvenance()
        );
    }

    public LogicalDataEntityEntity toEntity(LogicalDataEntityDto dto, String modelFileId) {
        return LogicalDataEntityEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .sourceProvenance(dto.sourceProvenance())
            .build();
    }

    public LogicalDataAttributeDto toDto(LogicalDataAttributeEntity entity) {
        return new LogicalDataAttributeDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getLogicalEntityId(),
            entity.getDataType(),
            entity.getIsPrimaryKey(),
            entity.getIsNullable(),
            entity.getTags(),
            entity.getFieldMetadata()
        );
    }

    public LogicalDataAttributeEntity toEntity(LogicalDataAttributeDto dto, String modelFileId) {
        return LogicalDataAttributeEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .logicalEntityId(dto.logicalEntityId())
            .name(dto.name())
            .description(dto.description())
            .dataType(dto.dataType())
            .isPrimaryKey(dto.isPrimaryKey() != null ? dto.isPrimaryKey() : false)
            .isNullable(dto.isNullable() != null ? dto.isNullable() : true)
            .tags(dto.tags())
            .fieldMetadata(dto.fieldMetadata())
            .build();
    }

    public PhysicalDataEntityDto toDto(PhysicalDataEntityEntity entity) {
        return new PhysicalDataEntityDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getPhysicalType(),
            entity.getDatabaseName(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getConstraintsMetadata()
        );
    }

    public PhysicalDataEntityEntity toEntity(PhysicalDataEntityDto dto, String modelFileId) {
        return PhysicalDataEntityEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .physicalType(dto.physicalType())
            .databaseName(dto.database())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .constraintsMetadata(dto.constraintsMetadata())
            .build();
    }

    public PhysicalDataAttributeDto toDto(PhysicalDataAttributeEntity entity) {
        return new PhysicalDataAttributeDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getPhysicalEntityId(),
            entity.getDataType(),
            entity.getIsPrimaryKey(),
            entity.getIsNullable(),
            entity.getTags(),
            entity.getSourceType(),
            entity.getScale(),
            entity.getPrecision(),
            entity.getColumnDefault(),
            entity.getOrdinal(),
            entity.getIsIdentity()
        );
    }

    public PhysicalDataAttributeEntity toEntity(PhysicalDataAttributeDto dto, String modelFileId) {
        return PhysicalDataAttributeEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .physicalEntityId(dto.physicalEntityId())
            .name(dto.name())
            .description(dto.description())
            .dataType(dto.dataType())
            .isPrimaryKey(dto.isPrimaryKey() != null ? dto.isPrimaryKey() : false)
            .isNullable(dto.isNullable() != null ? dto.isNullable() : true)
            .tags(dto.tags())
            .sourceType(dto.sourceType())
            .scale(dto.scale())
            .precision(dto.precision())
            .columnDefault(dto.columnDefault())
            .ordinal(dto.ordinal())
            .isIdentity(dto.isIdentity())
            .build();
    }

    /**
     * Maps DataEntityPointEntity to DTO.
     *
     * Data Entity Points act as polymorphic reference wrappers for Logical and Physical
     * Data Entities, enabling future relationship tables to point to either entity type
     * through a single foreign key.
     *
     * Spec: Data Entity Point Superclass
     */
    public DataEntityPointDto toDto(DataEntityPointEntity entity) {
        return new DataEntityPointDto(
            entity.getId(),
            entity.getPointKind(),
            entity.getLogicalEntityId(),
            entity.getPhysicalEntityId(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo()
        );
    }

    /**
     * Maps DataEntityPointDto to Entity.
     *
     * Data Entity Points act as polymorphic reference wrappers for Logical and Physical
     * Data Entities, enabling future relationship tables to point to either entity type
     * through a single foreign key.
     *
     * Spec: Data Entity Point Superclass
     */
    public DataEntityPointEntity toEntity(DataEntityPointDto dto, String modelFileId) {
        return DataEntityPointEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .pointKind(dto.pointKind())
            .logicalEntityId(dto.logicalEntityId())
            .physicalEntityId(dto.physicalEntityId())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
    }

    // ============================================================================
    // Interaction Domain Entity Mappings
    // ============================================================================

    public AppBusinessPointDto toDto(AppBusinessPointEntity entity) {
        return new AppBusinessPointDto(
            entity.getId(),
            entity.getName(),
            entity.getKind(),
            entity.getSourceEntityId()
        );
    }

    public AppBusinessPointEntity toEntity(AppBusinessPointDto dto, String modelFileId) {
        return AppBusinessPointEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .kind(dto.kind())
            .sourceEntityId(dto.sourceEntityId())
            .build();
    }

    public InteractionDto toDto(InteractionEntity entity) {
        return new InteractionDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getUserId(),
            entity.getPrimaryAppBusinessPointId(),
            entity.getSecondaryAppBusinessPointId()
        );
    }

    public InteractionEntity toEntity(InteractionDto dto, String modelFileId) {
        return InteractionEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .userId(dto.userId())
            .primaryAppBusinessPointId(dto.primaryAppBusinessPointId())
            .secondaryAppBusinessPointId(dto.secondaryAppBusinessPointId())
            .build();
    }

    // ============================================================================
    // Behavioural Domain Entity Mappings
    // ============================================================================

    public EventDto toDto(EventEntity entity) {
        return new EventDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getSourceRefKind(),
            entity.getSourceRefId(),
            entity.getPayloadRefKind(),
            entity.getPayloadRefId(),
            entity.getPayloadPrimitiveType(),
            entity.getTags()
        );
    }

    public EventEntity toEntity(EventDto dto, String modelFileId) {
        return EventEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .sourceRefKind(dto.sourceRefKind())
            .sourceRefId(dto.sourceRefId())
            .payloadRefKind(dto.payloadRefKind())
            .payloadRefId(dto.payloadRefId())
            .payloadPrimitiveType(dto.payloadPrimitiveType())
            .tags(dto.tags())
            .build();
    }

    public StateDto toDto(StateEntity entity) {
        return new StateDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getStateKind(),
            entity.getOwnerRefKind(),
            entity.getOwnerRefId()
        );
    }

    public StateEntity toEntity(StateDto dto, String modelFileId) {
        return StateEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .stateKind(dto.stateKind())
            .ownerRefKind(dto.ownerRefKind())
            .ownerRefId(dto.ownerRefId())
            .build();
    }

    public StateTransitionDto toDto(StateTransitionEntity entity) {
        return new StateTransitionDto(
            entity.getId(),
            entity.getFromStateId(),
            entity.getToStateId(),
            entity.getOrderIndex(),
            entity.getDescription(),
            entity.getTriggerRefKind(),
            entity.getTriggerRefId(),
            entity.getTriggerLabelText(),
            entity.getGuardRefKind(),
            entity.getGuardRefId(),
            entity.getGuardExpression(),
            entity.getEffectRefKind(),
            entity.getEffectRefId(),
            entity.getEffectLabelText()
        );
    }

    public StateTransitionEntity toEntity(StateTransitionDto dto, String modelFileId) {
        return StateTransitionEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .fromStateId(dto.fromStateId())
            .toStateId(dto.toStateId())
            .orderIndex(dto.orderIndex())
            .description(dto.description())
            .triggerRefKind(dto.triggerRefKind())
            .triggerRefId(dto.triggerRefId())
            .triggerLabelText(dto.triggerLabelText())
            .guardRefKind(dto.guardRefKind())
            .guardRefId(dto.guardRefId())
            .guardExpression(dto.guardExpression())
            .effectRefKind(dto.effectRefKind())
            .effectRefId(dto.effectRefId())
            .effectLabelText(dto.effectLabelText())
            .build();
    }

    // ============================================================================
    // Activity Diagram Entity Mappings (Behavioural Domain)
    // ============================================================================

    public ActivityDto toDto(ActivityEntity entity) {
        return new ActivityDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getActivityKind()
        );
    }

    public ActivityEntity toEntity(ActivityDto dto, String modelFileId) {
        return ActivityEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .activityKind(dto.activityKind())
            .build();
    }

    public ActivityFlowDto toDto(ActivityFlowEntity entity) {
        return new ActivityFlowDto(
            entity.getId(),
            entity.getFromActivityId(),
            entity.getToActivityId(),
            entity.getTriggerRefKind(),
            entity.getTriggerRefId(),
            entity.getTriggerLabelText(),
            entity.getConditionRefKind(),
            entity.getConditionRefId(),
            entity.getConditionExpression(),
            entity.getFlowKind(),
            entity.getOrderIndex(),
            entity.getDescription()
        );
    }

    public ActivityFlowEntity toEntity(ActivityFlowDto dto, String modelFileId) {
        return ActivityFlowEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .fromActivityId(dto.fromActivityId())
            .toActivityId(dto.toActivityId())
            .triggerRefKind(dto.triggerRefKind())
            .triggerRefId(dto.triggerRefId())
            .triggerLabelText(dto.triggerLabelText())
            .conditionRefKind(dto.conditionRefKind())
            .conditionRefId(dto.conditionRefId())
            .conditionExpression(dto.conditionExpression())
            .flowKind(dto.flowKind())
            .orderIndex(dto.orderIndex())
            .description(dto.description())
            .build();
    }

    public ActivityPartitionDto toDto(ActivityPartitionEntity entity) {
        return new ActivityPartitionDto(
            entity.getId(),
            entity.getName(),
            entity.getRefKind(),
            entity.getRefId(),
            entity.getOrderIndex(),
            entity.getDescription()
        );
    }

    public ActivityPartitionEntity toEntity(ActivityPartitionDto dto, String modelFileId) {
        return ActivityPartitionEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .refKind(dto.refKind())
            .refId(dto.refId())
            .orderIndex(dto.orderIndex())
            .description(dto.description())
            .build();
    }

    // ============================================================================
    // Business Logic Entity Mappings (Behavioural Domain)
    // ============================================================================

    public BusinessLogicDto toDto(BusinessLogicEntity entity) {
        return new BusinessLogicDto(
            entity.getId(),
            entity.getName(),
            entity.getTypeText(),
            entity.getDescriptionMd(),
            entity.getTags(),
            entity.getBehavior(),
            entity.getValidFrom(),
            entity.getValidTo()
        );
    }

    public BusinessLogicEntity toEntity(BusinessLogicDto dto, String modelFileId) {
        return BusinessLogicEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .typeText(dto.typeText())
            .descriptionMd(dto.descriptionMd())
            .tags(dto.tags())
            .behavior(dto.behavior())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
    }

    // ============================================================================
    // PackageSet and Package Entity Mappings (Application Domain)
    // Extended with standard_key and standard_source for Package Set Standards Import
    // Spec: Package Set Standards Import (Iteration 6)
    // ============================================================================

    /**
     * Maps PackageSetEntity to DTO.
     * Includes standardKey and standardSource for Package Set Standards Import.
     */
    public PackageSetDto toDto(PackageSetEntity entity) {
        return new PackageSetDto(
            entity.getId(),
            entity.getName(),
            entity.getStandardKey(),
            entity.getStandardSource()
        );
    }

    /**
     * Maps PackageSetDto to Entity.
     * Includes standardKey and standardSource for Package Set Standards Import.
     */
    public PackageSetEntity toEntity(PackageSetDto dto, String modelFileId) {
        return PackageSetEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .standardKey(dto.standardKey())
            .standardSource(dto.standardSource())
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
    }

    /**
     * Maps PackageEntity to DTO.
     * Includes standardSource and standardKey for Package Set Standards Import.
     */
    public PackageDto toDto(PackageEntity entity) {
        return new PackageDto(
            entity.getId(),
            entity.getPackageSetId(),
            entity.getName(),
            entity.getPurpose(),
            entity.getSortOrder(),
            entity.getStandardSource(),
            entity.getStandardKey()
        );
    }

    /**
     * Maps PackageDto to Entity.
     * Includes standardSource and standardKey for Package Set Standards Import.
     */
    public PackageEntity toEntity(PackageDto dto, String modelFileId) {
        return PackageEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .packageSetId(dto.packageSetId())
            .name(dto.name())
            .purpose(dto.purpose())
            .sortOrder(dto.sortOrder())
            .standardSource(dto.standardSource())
            .standardKey(dto.standardKey())
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
    }

    // ============================================================================
    // PackageSetDefaultRule Entity Mappings (Package Set Standards Import)
    // Spec: Package Set Standards Import (Iteration 6)
    // ============================================================================

    /**
     * Maps PackageSetDefaultRuleEntity to DTO.
     * Parses JSON arrays for coreTechIncludes and serviceTypeIncludes.
     */
    public PackageSetDefaultRuleDto toDto(PackageSetDefaultRuleEntity entity) {
        return new PackageSetDefaultRuleDto(
            entity.getId(),
            entity.getStandardSource(),
            entity.getPackageSetId(),
            parseJsonArray(entity.getCoreTechIncludes()),
            parseJsonArray(entity.getServiceTypeIncludes()),
            entity.getPriority()
        );
    }

    /**
     * Maps PackageSetDefaultRuleDto to Entity.
     * Serializes lists to JSON arrays for coreTechIncludes and serviceTypeIncludes.
     */
    public PackageSetDefaultRuleEntity toEntity(PackageSetDefaultRuleDto dto, String modelFileId) {
        return PackageSetDefaultRuleEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .standardSource(dto.standardSource())
            .packageSetId(dto.packageSetId())
            .coreTechIncludes(toJsonArray(dto.coreTechIncludes()))
            .serviceTypeIncludes(toJsonArray(dto.serviceTypeIncludes()))
            .priority(dto.priority() != null ? dto.priority() : 0)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
    }

    /**
     * Maps PackageSetStandardsImportStatusEntity to DTO.
     */
    public PackageSetStandardsImportStatusDto toDto(PackageSetStandardsImportStatusEntity entity) {
        return new PackageSetStandardsImportStatusDto(
            entity.getId(),
            entity.getImportedAt(),
            entity.getCompanyFilePath(),
            entity.getProjectFilePath(),
            entity.getCompanyRevision(),
            entity.getProjectRevision(),
            entity.getInsertedSets(),
            entity.getUpdatedSets(),
            entity.getInsertedPackages(),
            entity.getUpdatedPackages(),
            entity.getInsertedRules(),
            entity.getUpdatedRules()
        );
    }

    // ============================================================================
    // JSON Array Helper Methods
    // ============================================================================

    /**
     * Parse a JSON array string to a List of Strings.
     * Returns empty list if parsing fails or input is null/empty.
     */
    private List<String> parseJsonArray(String json) {
        if (json == null || json.isBlank() || "[]".equals(json)) {
            return Collections.emptyList();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (JsonProcessingException e) {
            return Collections.emptyList();
        }
    }

    /**
     * Serialize a List of Strings to a JSON array string.
     * Returns "[]" if list is null or empty.
     */
    private String toJsonArray(List<String> list) {
        if (list == null || list.isEmpty()) {
            return "[]";
        }
        try {
            return objectMapper.writeValueAsString(list);
        } catch (JsonProcessingException e) {
            return "[]";
        }
    }

    // ============================================================================
    // UI Architecture Entity Mappings (Application Domain)
    // ============================================================================

    public UIScreenDto toDto(UIScreenEntity entity) {
        return new UIScreenDto(
            entity.getId(),
            entity.getName(),
            entity.getRoute(),
            entity.getDescription(),
            entity.getApplicationPointId()
        );
    }

    public UIScreenEntity toEntity(UIScreenDto dto, String modelFileId) {
        return UIScreenEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .route(dto.route())
            .description(dto.description())
            .applicationPointId(dto.applicationPointId())
            .build();
    }

    public UIWorkflowTransitionDto toDto(UIWorkflowTransitionEntity entity) {
        return new UIWorkflowTransitionDto(
            entity.getId(),
            entity.getName(),
            entity.getSourceScreenId(),
            entity.getTargetScreenId(),
            entity.getTrigger(),
            entity.getGuard()
        );
    }

    public UIWorkflowTransitionEntity toEntity(UIWorkflowTransitionDto dto, String modelFileId) {
        return UIWorkflowTransitionEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .sourceScreenId(dto.sourceScreenId())
            .targetScreenId(dto.targetScreenId())
            .trigger(dto.trigger())
            .guard(dto.guard())
            .build();
    }

    // ============================================================================
    // UI Architecture Increment 2 Entity Mappings (UIContract, UIComponent, UIAction)
    // ============================================================================

    public UIContractDto toDto(UIContractEntity entity) {
        return new UIContractDto(
            entity.getId(),
            entity.getName(),
            entity.getContractType(),
            entity.getOperationRef(),
            entity.getRequestSchemaRef(),
            entity.getResponseSchemaRef(),
            entity.getBindingsJson()
        );
    }

    public UIContractEntity toEntity(UIContractDto dto, String modelFileId) {
        return UIContractEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .contractType(dto.contractType())
            .operationRef(dto.operationRef())
            .requestSchemaRef(dto.requestSchemaRef())
            .responseSchemaRef(dto.responseSchemaRef())
            .bindingsJson(dto.bindingsJson())
            .build();
    }

    public UIComponentDto toDto(UIComponentEntity entity) {
        return new UIComponentDto(
            entity.getId(),
            entity.getName(),
            entity.getComponentType(),
            entity.getDescription(),
            entity.getDomain(),
            entity.getPropsSchemaJson()
        );
    }

    public UIComponentEntity toEntity(UIComponentDto dto, String modelFileId) {
        return UIComponentEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .componentType(dto.componentType())
            .description(dto.description())
            .domain(dto.domain() != null ? dto.domain() : "APPLICATION")
            .propsSchemaJson(dto.propsSchemaJson())
            .build();
    }

    public UIActionDto toDto(UIActionEntity entity) {
        return new UIActionDto(
            entity.getId(),
            entity.getName(),
            entity.getTriggerType(),
            entity.getOwnerScreenId(),
            entity.getOwnerComponentId(),
            entity.getEffectType(),
            entity.getDescription(),
            entity.getContractId()
        );
    }

    public UIActionEntity toEntity(UIActionDto dto, String modelFileId) {
        return UIActionEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .triggerType(dto.triggerType())
            .ownerScreenId(dto.ownerScreenId())
            .ownerComponentId(dto.ownerComponentId())
            .effectType(dto.effectType())
            .description(dto.description())
            .contractId(dto.contractId())
            .build();
    }

    // ============================================================================
    // Sequence Diagram Entity Mappings (Behavioural Domain)
    // ============================================================================

    public SequenceParticipantDto toDto(SequenceParticipantEntity entity) {
        return new SequenceParticipantDto(
            entity.getId(),
            entity.getRefKind(),
            entity.getRefId(),
            entity.getOrderIndex()
        );
    }

    public SequenceParticipantEntity toEntity(SequenceParticipantDto dto, String sequenceDiagramId) {
        return SequenceParticipantEntity.builder()
            .id(dto.id())
            .sequenceDiagramId(sequenceDiagramId)
            .refKind(dto.refKind())
            .refId(dto.refId())
            .orderIndex(dto.orderIndex())
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
    }

    /**
     * Maps SequenceMessageEntity to DTO.
     *
     * Spec: Sequence Diagram Message Exchange Collection Entity Display
     * Spec: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response
     * - Added showEndpointName, showEndpointVerbPath, showEndpointReqResData, responseMode fields
     */
    public SequenceMessageDto toDto(SequenceMessageEntity entity) {
        return new SequenceMessageDto(
            entity.getId(),
            entity.getExchangeId(),
            entity.getExchangeRole(),
            entity.getFromParticipantId(),
            entity.getToParticipantId(),
            entity.getRefKind(),
            entity.getRefId(),
            entity.getLabelText(),
            entity.getIsCollection(),
            entity.getShowEndpointName(),
            entity.getShowEndpointVerbPath(),
            entity.getShowEndpointReqResData(),
            entity.getResponseMode()
        );
    }

    /**
     * Maps SequenceMessageDto to Entity.
     *
     * Spec: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response
     * - Added showEndpointName, showEndpointVerbPath, showEndpointReqResData, responseMode fields
     */
    public SequenceMessageEntity toEntity(SequenceMessageDto dto, String sequenceDiagramId) {
        return SequenceMessageEntity.builder()
            .id(dto.id())
            .sequenceDiagramId(sequenceDiagramId)
            .exchangeId(dto.exchangeId())
            .exchangeRole(dto.exchangeRole())
            .fromParticipantId(dto.fromParticipantId())
            .toParticipantId(dto.toParticipantId())
            .refKind(dto.refKind())
            .refId(dto.refId())
            .labelText(dto.labelText())
            .isCollection(dto.isCollection())
            .showEndpointName(dto.showEndpointName())
            .showEndpointVerbPath(dto.showEndpointVerbPath())
            .showEndpointReqResData(dto.showEndpointReqResData())
            .responseMode(dto.responseMode())
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
    }

    public SequenceFragmentDto toDto(SequenceFragmentEntity entity) {
        return new SequenceFragmentDto(
            entity.getId(),
            entity.getFragmentKind(),
            entity.getLabelText()
        );
    }

    public SequenceFragmentEntity toEntity(SequenceFragmentDto dto, String sequenceDiagramId) {
        return SequenceFragmentEntity.builder()
            .id(dto.id())
            .sequenceDiagramId(sequenceDiagramId)
            .fragmentKind(dto.fragmentKind())
            .labelText(dto.labelText())
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
    }

    public SequenceOperandDto toDto(SequenceOperandEntity entity) {
        return new SequenceOperandDto(
            entity.getId(),
            entity.getFragmentId(),
            entity.getGuardExpression(),
            entity.getOperandIndex()
        );
    }

    public SequenceOperandEntity toEntity(SequenceOperandDto dto) {
        return SequenceOperandEntity.builder()
            .id(dto.id())
            .fragmentId(dto.fragmentId())
            .guardExpression(dto.guardExpression())
            .operandIndex(dto.operandIndex())
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
    }

    public SequenceNodeDto toDto(SequenceNodeEntity entity) {
        return new SequenceNodeDto(
            entity.getId(),
            entity.getNodeKind(),
            entity.getMessageId(),
            entity.getFragmentId(),
            entity.getOrderIndex(),
            entity.getParentNodeId(),
            entity.getParentOperandId()
        );
    }

    public SequenceNodeEntity toEntity(SequenceNodeDto dto, String sequenceDiagramId) {
        return SequenceNodeEntity.builder()
            .id(dto.id())
            .sequenceDiagramId(sequenceDiagramId)
            .nodeKind(dto.nodeKind())
            .messageId(dto.messageId())
            .fragmentId(dto.fragmentId())
            .orderIndex(dto.orderIndex())
            .parentNodeId(dto.parentNodeId())
            .parentOperandId(dto.parentOperandId())
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
    }

    public SequenceDiagramEntity toEntity(SequenceDiagramDto dto, String modelFileId) {
        return SequenceDiagramEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .type(dto.type() != null ? dto.type() : "Sequence")
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
    }

    // ============================================================================
    // Relationship Mappings
    // ============================================================================

    public BusinessUserBusinessPointDto toDto(BusinessUserBusinessPointEntity entity) {
        return new BusinessUserBusinessPointDto(
            entity.getId(),
            entity.getBusinessUserId(),
            entity.getBusinessPointId(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo()
        );
    }

    public BusinessUserBusinessPointEntity toEntity(BusinessUserBusinessPointDto dto, String modelFileId) {
        return BusinessUserBusinessPointEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .businessUserId(dto.businessUserId())
            .businessPointId(dto.businessPointId())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
    }

    public ApplicationPointBusinessPointDto toDto(ApplicationPointBusinessPointEntity entity) {
        return new ApplicationPointBusinessPointDto(
            entity.getId(),
            entity.getApplicationPointId(),
            entity.getBusinessPointId(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo()
        );
    }

    public ApplicationPointBusinessPointEntity toEntity(ApplicationPointBusinessPointDto dto, String modelFileId) {
        return ApplicationPointBusinessPointEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .applicationPointId(dto.applicationPointId())
            .businessPointId(dto.businessPointId())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
    }

    // ============================================================================
    // ApplicationPointBusinessLogic Relationship Mappings
    // ============================================================================

    public ApplicationPointBusinessLogicDto toDto(ApplicationPointBusinessLogicEntity entity) {
        return new ApplicationPointBusinessLogicDto(
            entity.getId(),
            entity.getApplicationPointId(),
            entity.getBusinessLogicId(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo()
        );
    }

    public ApplicationPointBusinessLogicEntity toEntity(ApplicationPointBusinessLogicDto dto, String modelFileId) {
        return ApplicationPointBusinessLogicEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .applicationPointId(dto.applicationPointId())
            .businessLogicId(dto.businessLogicId())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
    }

    /**
     * Maps LogicalDataEntityRelationshipEntity to DTO.
     *
     * Maps point-id fields (fromDataEntityPointId, toDataEntityPointId),
     * cardinality, and relationship fields.
     *
     * Spec: Remove Legacy Data Entity Relationship Columns
     */
    public LogicalDataEntityRelationshipDto toDto(LogicalDataEntityRelationshipEntity entity) {
        return new LogicalDataEntityRelationshipDto(
            entity.getId(),
            entity.getFromDataEntityPointId(),
            entity.getToDataEntityPointId(),
            entity.getCardinality(),
            entity.getRelationship(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getFkColumns()
        );
    }

    /**
     * Maps LogicalDataEntityRelationshipDto to Entity.
     *
     * Maps point-id fields (fromDataEntityPointId, toDataEntityPointId),
     * cardinality, and relationship fields.
     *
     * Spec: Remove Legacy Data Entity Relationship Columns
     */
    public LogicalDataEntityRelationshipEntity toEntity(LogicalDataEntityRelationshipDto dto, String modelFileId) {
        return LogicalDataEntityRelationshipEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .fromDataEntityPointId(dto.fromDataEntityPointId())
            .toDataEntityPointId(dto.toDataEntityPointId())
            .cardinality(dto.cardinality())
            .relationship(dto.relationship())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .fkColumns(dto.fkColumns())
            .build();
    }

    public LogicalDataEntityPhysicalDataEntityDto toDto(LogicalDataEntityPhysicalDataEntityEntity entity) {
        return new LogicalDataEntityPhysicalDataEntityDto(
            entity.getId(),
            entity.getLogicalEntityId(),
            entity.getPhysicalEntityId(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo()
        );
    }

    public LogicalDataEntityPhysicalDataEntityEntity toEntity(LogicalDataEntityPhysicalDataEntityDto dto, String modelFileId) {
        return LogicalDataEntityPhysicalDataEntityEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .logicalEntityId(dto.logicalEntityId())
            .physicalEntityId(dto.physicalEntityId())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
    }

    public LogicalDataAttributePhysicalDataAttributeDto toDto(LogicalDataAttributePhysicalDataAttributeEntity entity) {
        return new LogicalDataAttributePhysicalDataAttributeDto(
            entity.getId(),
            entity.getLogicalAttributeId(),
            entity.getPhysicalAttributeId(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo()
        );
    }

    public LogicalDataAttributePhysicalDataAttributeEntity toEntity(LogicalDataAttributePhysicalDataAttributeDto dto, String modelFileId) {
        return LogicalDataAttributePhysicalDataAttributeEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .logicalAttributeId(dto.logicalAttributeId())
            .physicalAttributeId(dto.physicalAttributeId())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
    }

    /**
     * Maps DataMovementEntity to DTO.
     *
     * Spec 2026-01-11: Data Movement Interface Schema Extension
     * - dataEntityPointId is now optional (XOR with interfaceWithSchemaId)
     * - Added interfaceWithSchemaId field
     * - Added biDirectional field
     */
    public DataMovementDto toDto(DataMovementEntity entity) {
        return new DataMovementDto(
            entity.getId(),
            entity.getSourceApplicationPointId(),
            entity.getTargetApplicationPointId(),
            entity.getDataEntityPointId(),
            entity.getInterfaceWithSchemaId(),
            entity.getBiDirectional(),
            entity.getMovementType(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo()
        );
    }

    /**
     * Maps DataMovementDto to Entity.
     *
     * Spec 2026-01-11: Data Movement Interface Schema Extension
     * - dataEntityPointId is now optional (XOR with interfaceWithSchemaId)
     * - Added interfaceWithSchemaId field
     * - Added biDirectional field with null handling (defaults to false)
     */
    public DataMovementEntity toEntity(DataMovementDto dto, String modelFileId) {
        // Normalize blank strings to null for XOR FK columns to avoid FK constraint violations.
        // PostgreSQL treats "" as a non-null value that fails the FK lookup.
        String dataEntityPointId = (dto.dataEntityPointId() != null && !dto.dataEntityPointId().isBlank())
            ? dto.dataEntityPointId() : null;
        String interfaceWithSchemaId = (dto.interfaceWithSchemaId() != null && !dto.interfaceWithSchemaId().isBlank())
            ? dto.interfaceWithSchemaId() : null;

        return DataMovementEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .sourceApplicationPointId(dto.sourceApplicationPointId())
            .targetApplicationPointId(dto.targetApplicationPointId())
            .dataEntityPointId(dataEntityPointId)
            .interfaceWithSchemaId(interfaceWithSchemaId)
            .biDirectional(dto.biDirectional() != null ? dto.biDirectional() : false)
            .movementType(dto.movementType())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
    }

    // ============================================================================
    // InterfaceLogicalEntity Relationship Mappings
    // Spec 2026-01-11: Interface Entity Relationship Refactor
    // - Updated to use dataEntityPointId instead of logicalEntityId
    // ============================================================================

    /**
     * Maps InterfaceLogicalEntityEntity to DTO.
     *
     * Spec 2026-01-11: Interface Entity Relationship Refactor
     * Maps dataEntityPointId field for unified Logical/Physical entity selection.
     */
    public InterfaceLogicalEntityDto toDto(InterfaceLogicalEntityEntity entity) {
        return new InterfaceLogicalEntityDto(
            entity.getId(),
            entity.getInterfaceId(),
            entity.getDataEntityPointId(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo()
        );
    }

    /**
     * Maps InterfaceLogicalEntityDto to Entity.
     *
     * Spec 2026-01-11: Interface Entity Relationship Refactor
     * Maps dataEntityPointId field for unified Logical/Physical entity selection.
     */
    public InterfaceLogicalEntityEntity toEntity(InterfaceLogicalEntityDto dto, String modelFileId) {
        return InterfaceLogicalEntityEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .interfaceId(dto.interfaceId())
            .dataEntityPointId(dto.dataEntityPointId())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
    }
    // ============================================================================
    // UserJourneyLink Relationship Mappings
    // Spec: User Journey Links Meta-Model Foundation
    // ============================================================================

    public UserJourneyLinkDto toDto(UserJourneyLinkEntity entity) {
        return new UserJourneyLinkDto(
            entity.getId(),
            entity.getSourceUserJourneyId(),
            entity.getTargetUserJourneyId(),
            entity.getRelationshipType(),
            entity.getLabel(),
            entity.getDescription(),
            entity.getTags()
        );
    }

    public UserJourneyLinkEntity toEntity(UserJourneyLinkDto dto, String modelFileId) {
        return UserJourneyLinkEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .sourceUserJourneyId(dto.sourceUserJourneyId())
            .targetUserJourneyId(dto.targetUserJourneyId())
            .relationshipType(dto.relationshipType())
            .label(dto.label())
            .description(dto.description())
            .tags(dto.tags())
            .build();
    }

    // ============================================================================
    // Infrastructure Domain Entity Mappings (12 entities + InfrastructurePoint)
    // Spec: 2026-05-04-infrastructure-domain-backend-foundation (Task Group 5)
    //
    // toEntity(TDto, String modelFileId) sets modelFileId server-side from the
    // parameter and never reads it from the DTO.
    // toDto(TEntity) does NOT expose modelFileId.
    // ============================================================================

    public EnvironmentDto toDto(EnvironmentEntity entity) {
        return new EnvironmentDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getEnvironmentType(),
            entity.getLifecycleState(),
            entity.getIsCurrentState(),
            entity.getIsTargetState(),
            entity.getOwner(),
            entity.getCriticality(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt(),
            entity.getTerraformReady(),
            entity.getTerraformModuleHint(),
            entity.getTerraformResourceHint(),
            entity.getTerraformVariableHints(),
            entity.getTerraformNotes()
        );
    }

    public EnvironmentEntity toEntity(EnvironmentDto dto, String modelFileId) {
        return EnvironmentEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .environmentType(dto.environmentType())
            .lifecycleState(dto.lifecycleState())
            .isCurrentState(dto.isCurrentState())
            .isTargetState(dto.isTargetState())
            .owner(dto.owner())
            .criticality(dto.criticality())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .terraformReady(dto.terraformReady())
            .terraformModuleHint(dto.terraformModuleHint())
            .terraformResourceHint(dto.terraformResourceHint())
            .terraformVariableHints(dto.terraformVariableHints())
            .terraformNotes(dto.terraformNotes())
            .build();
    }

    public CloudAccountDto toDto(CloudAccountEntity entity) {
        return new CloudAccountDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getEnvironmentId(),
            entity.getProvider(),
            entity.getExternalAccountId(),
            entity.getParentOrgId(),
            entity.getBillingOwner(),
            entity.getTechnicalOwner(),
            entity.getLandingZoneName(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt(),
            entity.getTerraformReady(),
            entity.getTerraformModuleHint(),
            entity.getTerraformResourceHint(),
            entity.getTerraformVariableHints(),
            entity.getTerraformNotes()
        );
    }

    public CloudAccountEntity toEntity(CloudAccountDto dto, String modelFileId) {
        return CloudAccountEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .environmentId(dto.environmentId())
            .provider(dto.provider())
            .externalAccountId(dto.externalAccountId())
            .parentOrgId(dto.parentOrgId())
            .billingOwner(dto.billingOwner())
            .technicalOwner(dto.technicalOwner())
            .landingZoneName(dto.landingZoneName())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .terraformReady(dto.terraformReady())
            .terraformModuleHint(dto.terraformModuleHint())
            .terraformResourceHint(dto.terraformResourceHint())
            .terraformVariableHints(dto.terraformVariableHints())
            .terraformNotes(dto.terraformNotes())
            .build();
    }

    public LocationDto toDto(LocationEntity entity) {
        return new LocationDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getEnvironmentId(),
            entity.getCloudAccountId(),
            entity.getLocationType(),
            entity.getProvider(),
            entity.getProviderRegionCode(),
            entity.getProviderZoneCode(),
            entity.getCountry(),
            entity.getCity(),
            entity.getAddress(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt(),
            entity.getTerraformReady(),
            entity.getTerraformModuleHint(),
            entity.getTerraformResourceHint(),
            entity.getTerraformVariableHints(),
            entity.getTerraformNotes()
        );
    }

    public LocationEntity toEntity(LocationDto dto, String modelFileId) {
        return LocationEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .environmentId(dto.environmentId())
            .cloudAccountId(dto.cloudAccountId())
            .locationType(dto.locationType())
            .provider(dto.provider())
            .providerRegionCode(dto.providerRegionCode())
            .providerZoneCode(dto.providerZoneCode())
            .country(dto.country())
            .city(dto.city())
            .address(dto.address())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .terraformReady(dto.terraformReady())
            .terraformModuleHint(dto.terraformModuleHint())
            .terraformResourceHint(dto.terraformResourceHint())
            .terraformVariableHints(dto.terraformVariableHints())
            .terraformNotes(dto.terraformNotes())
            .build();
    }

    public NetworkDto toDto(NetworkEntity entity) {
        return new NetworkDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getEnvironmentId(),
            entity.getCloudAccountId(),
            entity.getLocationId(),
            entity.getNetworkType(),
            entity.getProvider(),
            entity.getCidr(),
            entity.getExternalId(),
            entity.getIsShared(),
            entity.getRoutingMode(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt(),
            entity.getTerraformReady(),
            entity.getTerraformModuleHint(),
            entity.getTerraformResourceHint(),
            entity.getTerraformVariableHints(),
            entity.getTerraformNotes()
        );
    }

    public NetworkEntity toEntity(NetworkDto dto, String modelFileId) {
        return NetworkEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .environmentId(dto.environmentId())
            .cloudAccountId(dto.cloudAccountId())
            .locationId(dto.locationId())
            .networkType(dto.networkType())
            .provider(dto.provider())
            .cidr(dto.cidr())
            .externalId(dto.externalId())
            .isShared(dto.isShared())
            .routingMode(dto.routingMode())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .terraformReady(dto.terraformReady())
            .terraformModuleHint(dto.terraformModuleHint())
            .terraformResourceHint(dto.terraformResourceHint())
            .terraformVariableHints(dto.terraformVariableHints())
            .terraformNotes(dto.terraformNotes())
            .build();
    }

    public SubnetDto toDto(SubnetEntity entity) {
        return new SubnetDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getEnvironmentId(),
            entity.getNetworkId(),
            entity.getLocationId(),
            entity.getCidr(),
            entity.getSubnetType(),
            entity.getVisibility(),
            entity.getProviderRegionCode(),
            entity.getProviderZoneCode(),
            entity.getExternalId(),
            entity.getGatewayAddress(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt(),
            entity.getTerraformReady(),
            entity.getTerraformModuleHint(),
            entity.getTerraformResourceHint(),
            entity.getTerraformVariableHints(),
            entity.getTerraformNotes()
        );
    }

    public SubnetEntity toEntity(SubnetDto dto, String modelFileId) {
        return SubnetEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .environmentId(dto.environmentId())
            .networkId(dto.networkId())
            .locationId(dto.locationId())
            .cidr(dto.cidr())
            .subnetType(dto.subnetType())
            .visibility(dto.visibility())
            .providerRegionCode(dto.providerRegionCode())
            .providerZoneCode(dto.providerZoneCode())
            .externalId(dto.externalId())
            .gatewayAddress(dto.gatewayAddress())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .terraformReady(dto.terraformReady())
            .terraformModuleHint(dto.terraformModuleHint())
            .terraformResourceHint(dto.terraformResourceHint())
            .terraformVariableHints(dto.terraformVariableHints())
            .terraformNotes(dto.terraformNotes())
            .build();
    }

    public ComputeClusterDto toDto(ComputeClusterEntity entity) {
        return new ComputeClusterDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getEnvironmentId(),
            entity.getCloudAccountId(),
            entity.getLocationId(),
            entity.getNetworkId(),
            entity.getPlatformType(),
            entity.getProvider(),
            entity.getVersion(),
            entity.getExternalId(),
            entity.getOwner(),
            entity.getOperatingModel(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt(),
            entity.getTerraformReady(),
            entity.getTerraformModuleHint(),
            entity.getTerraformResourceHint(),
            entity.getTerraformVariableHints(),
            entity.getTerraformNotes()
        );
    }

    public ComputeClusterEntity toEntity(ComputeClusterDto dto, String modelFileId) {
        return ComputeClusterEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .environmentId(dto.environmentId())
            .cloudAccountId(dto.cloudAccountId())
            .locationId(dto.locationId())
            .networkId(dto.networkId())
            .platformType(dto.platformType())
            .provider(dto.provider())
            .version(dto.version())
            .externalId(dto.externalId())
            .owner(dto.owner())
            .operatingModel(dto.operatingModel())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .terraformReady(dto.terraformReady())
            .terraformModuleHint(dto.terraformModuleHint())
            .terraformResourceHint(dto.terraformResourceHint())
            .terraformVariableHints(dto.terraformVariableHints())
            .terraformNotes(dto.terraformNotes())
            .build();
    }

    public ComputeResourceDto toDto(ComputeResourceEntity entity) {
        return new ComputeResourceDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getEnvironmentId(),
            entity.getCloudAccountId(),
            entity.getLocationId(),
            entity.getClusterId(),
            entity.getComputeType(),
            entity.getProvider(),
            entity.getHostname(),
            entity.getFqdn(),
            entity.getPrivateIp(),
            entity.getPublicIp(),
            entity.getOs(),
            entity.getRuntime(),
            entity.getInstanceSize(),
            entity.getScalingMin(),
            entity.getScalingMax(),
            entity.getExternalId(),
            entity.getLifecycleState(),
            entity.getOwner(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt(),
            entity.getTerraformReady(),
            entity.getTerraformModuleHint(),
            entity.getTerraformResourceHint(),
            entity.getTerraformVariableHints(),
            entity.getTerraformNotes()
        );
    }

    public ComputeResourceEntity toEntity(ComputeResourceDto dto, String modelFileId) {
        return ComputeResourceEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .environmentId(dto.environmentId())
            .cloudAccountId(dto.cloudAccountId())
            .locationId(dto.locationId())
            .clusterId(dto.clusterId())
            .computeType(dto.computeType())
            .provider(dto.provider())
            .hostname(dto.hostname())
            .fqdn(dto.fqdn())
            .privateIp(dto.privateIp())
            .publicIp(dto.publicIp())
            .os(dto.os())
            .runtime(dto.runtime())
            .instanceSize(dto.instanceSize())
            .scalingMin(dto.scalingMin())
            .scalingMax(dto.scalingMax())
            .externalId(dto.externalId())
            .lifecycleState(dto.lifecycleState())
            .owner(dto.owner())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .terraformReady(dto.terraformReady())
            .terraformModuleHint(dto.terraformModuleHint())
            .terraformResourceHint(dto.terraformResourceHint())
            .terraformVariableHints(dto.terraformVariableHints())
            .terraformNotes(dto.terraformNotes())
            .build();
    }

    public DeploymentUnitDto toDto(DeploymentUnitEntity entity) {
        return new DeploymentUnitDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getServiceId(),
            entity.getDeploymentUnitType(),
            entity.getVersion(),
            entity.getArtifactUri(),
            entity.getImageName(),
            entity.getImageTag(),
            entity.getSourceRepository(),
            entity.getSourceCommit(),
            entity.getBuildPipeline(),
            entity.getOwner(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt(),
            entity.getTerraformReady(),
            entity.getTerraformModuleHint(),
            entity.getTerraformResourceHint(),
            entity.getTerraformVariableHints(),
            entity.getTerraformNotes()
        );
    }

    public DeploymentUnitEntity toEntity(DeploymentUnitDto dto, String modelFileId) {
        return DeploymentUnitEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .serviceId(dto.serviceId())
            .deploymentUnitType(dto.deploymentUnitType())
            .version(dto.version())
            .artifactUri(dto.artifactUri())
            .imageName(dto.imageName())
            .imageTag(dto.imageTag())
            .sourceRepository(dto.sourceRepository())
            .sourceCommit(dto.sourceCommit())
            .buildPipeline(dto.buildPipeline())
            .owner(dto.owner())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .terraformReady(dto.terraformReady())
            .terraformModuleHint(dto.terraformModuleHint())
            .terraformResourceHint(dto.terraformResourceHint())
            .terraformVariableHints(dto.terraformVariableHints())
            .terraformNotes(dto.terraformNotes())
            .build();
    }

    public LoadBalancerDto toDto(LoadBalancerEntity entity) {
        return new LoadBalancerDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getEnvironmentId(),
            entity.getCloudAccountId(),
            entity.getLocationId(),
            entity.getNetworkId(),
            entity.getLoadBalancerType(),
            entity.getProvider(),
            entity.getExposure(),
            entity.getScheme(),
            entity.getDnsName(),
            entity.getIpAddress(),
            entity.getExternalId(),
            entity.getOwner(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt(),
            entity.getTerraformReady(),
            entity.getTerraformModuleHint(),
            entity.getTerraformResourceHint(),
            entity.getTerraformVariableHints(),
            entity.getTerraformNotes()
        );
    }

    public LoadBalancerEntity toEntity(LoadBalancerDto dto, String modelFileId) {
        return LoadBalancerEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .environmentId(dto.environmentId())
            .cloudAccountId(dto.cloudAccountId())
            .locationId(dto.locationId())
            .networkId(dto.networkId())
            .loadBalancerType(dto.loadBalancerType())
            .provider(dto.provider())
            .exposure(dto.exposure())
            .scheme(dto.scheme())
            .dnsName(dto.dnsName())
            .ipAddress(dto.ipAddress())
            .externalId(dto.externalId())
            .owner(dto.owner())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .terraformReady(dto.terraformReady())
            .terraformModuleHint(dto.terraformModuleHint())
            .terraformResourceHint(dto.terraformResourceHint())
            .terraformVariableHints(dto.terraformVariableHints())
            .terraformNotes(dto.terraformNotes())
            .build();
    }

    public ListenerDto toDto(ListenerEntity entity) {
        return new ListenerDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getEnvironmentId(),
            entity.getLoadBalancerId(),
            entity.getComputeResourceId(),
            entity.getProtocol(),
            entity.getPort(),
            entity.getHostName(),
            entity.getPathPattern(),
            entity.getExposure(),
            entity.getIsPublic(),
            entity.getCertificateReference(),
            entity.getExternalId(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt(),
            entity.getTerraformReady(),
            entity.getTerraformModuleHint(),
            entity.getTerraformResourceHint(),
            entity.getTerraformVariableHints(),
            entity.getTerraformNotes()
        );
    }

    public ListenerEntity toEntity(ListenerDto dto, String modelFileId) {
        return ListenerEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .environmentId(dto.environmentId())
            .loadBalancerId(dto.loadBalancerId())
            .computeResourceId(dto.computeResourceId())
            .protocol(dto.protocol())
            .port(dto.port())
            .hostName(dto.hostName())
            .pathPattern(dto.pathPattern())
            .exposure(dto.exposure())
            .isPublic(dto.isPublic())
            .certificateReference(dto.certificateReference())
            .externalId(dto.externalId())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .terraformReady(dto.terraformReady())
            .terraformModuleHint(dto.terraformModuleHint())
            .terraformResourceHint(dto.terraformResourceHint())
            .terraformVariableHints(dto.terraformVariableHints())
            .terraformNotes(dto.terraformNotes())
            .build();
    }

    public DataStoreInstanceDto toDto(DataStoreInstanceEntity entity) {
        return new DataStoreInstanceDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getEnvironmentId(),
            entity.getCloudAccountId(),
            entity.getLocationId(),
            entity.getDataStoreType(),
            entity.getEngine(),
            entity.getEngineVersion(),
            entity.getProvider(),
            entity.getHost(),
            entity.getPort(),
            entity.getExternalId(),
            entity.getEncrypted(),
            entity.getHaEnabled(),
            entity.getBackupEnabled(),
            entity.getOwner(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt(),
            entity.getTerraformReady(),
            entity.getTerraformModuleHint(),
            entity.getTerraformResourceHint(),
            entity.getTerraformVariableHints(),
            entity.getTerraformNotes()
        );
    }

    public DataStoreInstanceEntity toEntity(DataStoreInstanceDto dto, String modelFileId) {
        return DataStoreInstanceEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .environmentId(dto.environmentId())
            .cloudAccountId(dto.cloudAccountId())
            .locationId(dto.locationId())
            .dataStoreType(dto.dataStoreType())
            .engine(dto.engine())
            .engineVersion(dto.engineVersion())
            .provider(dto.provider())
            .host(dto.host())
            .port(dto.port())
            .externalId(dto.externalId())
            .encrypted(dto.encrypted())
            .haEnabled(dto.haEnabled())
            .backupEnabled(dto.backupEnabled())
            .owner(dto.owner())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .terraformReady(dto.terraformReady())
            .terraformModuleHint(dto.terraformModuleHint())
            .terraformResourceHint(dto.terraformResourceHint())
            .terraformVariableHints(dto.terraformVariableHints())
            .terraformNotes(dto.terraformNotes())
            .build();
    }

    public InfrastructureResourceDto toDto(InfrastructureResourceEntity entity) {
        return new InfrastructureResourceDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getEnvironmentId(),
            entity.getCloudAccountId(),
            entity.getLocationId(),
            entity.getResourceType(),
            entity.getProvider(),
            entity.getProviderResourceType(),
            entity.getEndpoint(),
            entity.getExternalId(),
            entity.getCriticality(),
            entity.getOwner(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt(),
            entity.getTerraformReady(),
            entity.getTerraformModuleHint(),
            entity.getTerraformResourceHint(),
            entity.getTerraformVariableHints(),
            entity.getTerraformNotes()
        );
    }

    public InfrastructureResourceEntity toEntity(InfrastructureResourceDto dto, String modelFileId) {
        return InfrastructureResourceEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .environmentId(dto.environmentId())
            .cloudAccountId(dto.cloudAccountId())
            .locationId(dto.locationId())
            .resourceType(dto.resourceType())
            .provider(dto.provider())
            .providerResourceType(dto.providerResourceType())
            .endpoint(dto.endpoint())
            .externalId(dto.externalId())
            .criticality(dto.criticality())
            .owner(dto.owner())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .terraformReady(dto.terraformReady())
            .terraformModuleHint(dto.terraformModuleHint())
            .terraformResourceHint(dto.terraformResourceHint())
            .terraformVariableHints(dto.terraformVariableHints())
            .terraformNotes(dto.terraformNotes())
            .build();
    }

    /**
     * Maps InfrastructurePointEntity to DTO.
     *
     * Polymorphic point: discriminator (point_kind) + 12 nullable typed FK
     * fields. Mirrors {@link DataEntityPointEntity} mapping shape.
     */
    public InfrastructurePointDto toDto(InfrastructurePointEntity entity) {
        return new InfrastructurePointDto(
            entity.getId(),
            entity.getPointKind(),
            entity.getEnvironmentId(),
            entity.getCloudAccountId(),
            entity.getLocationId(),
            entity.getNetworkId(),
            entity.getSubnetId(),
            entity.getComputeClusterId(),
            entity.getComputeResourceId(),
            entity.getDeploymentUnitId(),
            entity.getLoadBalancerId(),
            entity.getListenerId(),
            entity.getDataStoreInstanceId(),
            entity.getInfrastructureResourceId()
        );
    }

    public InfrastructurePointEntity toEntity(InfrastructurePointDto dto, String modelFileId) {
        return InfrastructurePointEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .pointKind(dto.pointKind())
            .environmentId(dto.environmentId())
            .cloudAccountId(dto.cloudAccountId())
            .locationId(dto.locationId())
            .networkId(dto.networkId())
            .subnetId(dto.subnetId())
            .computeClusterId(dto.computeClusterId())
            .computeResourceId(dto.computeResourceId())
            .deploymentUnitId(dto.deploymentUnitId())
            .loadBalancerId(dto.loadBalancerId())
            .listenerId(dto.listenerId())
            .dataStoreInstanceId(dto.dataStoreInstanceId())
            .infrastructureResourceId(dto.infrastructureResourceId())
            .build();
    }

    // ============================================================================
    // Infrastructure Domain Relationship Mappings (3 relationships)
    //
    // Following the precedent set by DataMovementEntity / DataMovementDto, these
    // toEntity / toDto methods live on EntityMapper alongside the entity
    // mappings. ModelService consumes them rather than mapping inline.
    // ============================================================================

    /**
     * Maps ResourceSubnetHostingEntity to DTO. Preserves BigDecimal confidence.
     */
    public ResourceSubnetHostingDto toDto(ResourceSubnetHostingEntity entity) {
        return new ResourceSubnetHostingDto(
            entity.getId(),
            entity.getInfrastructurePointId(),
            entity.getSubnetId(),
            entity.getEnvironmentId(),
            entity.getRelationshipRole(),
            entity.getPrimaryIp(),
            entity.getPrivateIp(),
            entity.getPublicIp(),
            entity.getEvidenceSource(),
            entity.getConfidence(),
            entity.getTags(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt()
        );
    }

    public ResourceSubnetHostingEntity toEntity(ResourceSubnetHostingDto dto, String modelFileId) {
        return ResourceSubnetHostingEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .infrastructurePointId(dto.infrastructurePointId())
            .subnetId(dto.subnetId())
            .environmentId(dto.environmentId())
            .relationshipRole(dto.relationshipRole())
            .primaryIp(dto.primaryIp())
            .privateIp(dto.privateIp())
            .publicIp(dto.publicIp())
            .evidenceSource(dto.evidenceSource())
            .confidence(dto.confidence())
            .tags(dto.tags())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .build();
    }

    /**
     * Maps DeploymentUnitComputeResourceEntity to DTO. Preserves BigDecimal
     * confidence and the JSONB runtime_config String round-trip exactly.
     *
     * A2: compute_infrastructure_point_id (Java: computeInfrastructurePointId).
     */
    public DeploymentUnitComputeResourceDto toDto(DeploymentUnitComputeResourceEntity entity) {
        return new DeploymentUnitComputeResourceDto(
            entity.getId(),
            entity.getDeploymentUnitId(),
            entity.getComputeInfrastructurePointId(),
            entity.getEnvironmentId(),
            entity.getVersion(),
            entity.getRuntimeConfig(),
            entity.getDesiredInstances(),
            entity.getMinInstances(),
            entity.getMaxInstances(),
            entity.getDeploymentStatus(),
            entity.getEvidenceSource(),
            entity.getConfidence(),
            entity.getTags(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt()
        );
    }

    public DeploymentUnitComputeResourceEntity toEntity(DeploymentUnitComputeResourceDto dto, String modelFileId) {
        return DeploymentUnitComputeResourceEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .deploymentUnitId(dto.deploymentUnitId())
            .computeInfrastructurePointId(dto.computeInfrastructurePointId())
            .environmentId(dto.environmentId())
            .version(dto.version())
            .runtimeConfig(dto.runtimeConfig())
            .desiredInstances(dto.desiredInstances())
            .minInstances(dto.minInstances())
            .maxInstances(dto.maxInstances())
            .deploymentStatus(dto.deploymentStatus())
            .evidenceSource(dto.evidenceSource())
            .confidence(dto.confidence())
            .tags(dto.tags())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .build();
    }

    /**
     * Maps LoadBalancerResourceRouteEntity to DTO.
     *
     * R3: target_infrastructure_point_id (Java: targetInfrastructurePointId).
     */
    public LoadBalancerResourceRouteDto toDto(LoadBalancerResourceRouteEntity entity) {
        return new LoadBalancerResourceRouteDto(
            entity.getId(),
            entity.getLoadBalancerId(),
            entity.getListenerId(),
            entity.getTargetInfrastructurePointId(),
            entity.getEnvironmentId(),
            entity.getProtocol(),
            entity.getTargetPort(),
            entity.getHostName(),
            entity.getPathPattern(),
            entity.getRoutingType(),
            entity.getWeight(),
            entity.getHealthCheckPath(),
            entity.getTags(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt()
        );
    }

    public LoadBalancerResourceRouteEntity toEntity(LoadBalancerResourceRouteDto dto, String modelFileId) {
        return LoadBalancerResourceRouteEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .loadBalancerId(dto.loadBalancerId())
            .listenerId(dto.listenerId())
            .targetInfrastructurePointId(dto.targetInfrastructurePointId())
            .environmentId(dto.environmentId())
            .protocol(dto.protocol())
            .targetPort(dto.targetPort())
            .hostName(dto.hostName())
            .pathPattern(dto.pathPattern())
            .routingType(dto.routingType())
            .weight(dto.weight())
            .healthCheckPath(dto.healthCheckPath())
            .tags(dto.tags())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .build();
    }
    // ============================================================================
    // Infrastructure Cross-Domain Relationship Mappings (4 relationships)
    //
    // Spec: 2026-05-05-infrastructure-cross-domain-integration
    // Wires Application/Data to the Infrastructure domain landed by specs 1-2.
    // model_file_id is set server-side from the modelFileId parameter and
    // never read from the DTO.
    // ============================================================================

    /**
     * Maps ApplicationComputeDeploymentEntity to DTO (XR1).
     */
    public ApplicationComputeDeploymentDto toDto(ApplicationComputeDeploymentEntity entity) {
        return new ApplicationComputeDeploymentDto(
            entity.getId(),
            entity.getApplicationPointId(),
            entity.getComputeResourceId(),
            entity.getDeploymentUnitId(),
            entity.getEnvironmentId(),
            entity.getDeploymentRole(),
            entity.getRuntimeName(),
            entity.getRuntimeVersion(),
            entity.getEvidenceSource(),
            entity.getConfidence(),
            entity.getDescription(),
            entity.getTags()
        );
    }

    public ApplicationComputeDeploymentEntity toEntity(ApplicationComputeDeploymentDto dto, String modelFileId) {
        return ApplicationComputeDeploymentEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .applicationPointId(dto.applicationPointId())
            .computeResourceId(dto.computeResourceId())
            .deploymentUnitId(dto.deploymentUnitId())
            .environmentId(dto.environmentId())
            .deploymentRole(dto.deploymentRole())
            .runtimeName(dto.runtimeName())
            .runtimeVersion(dto.runtimeVersion())
            .evidenceSource(dto.evidenceSource())
            .confidence(dto.confidence())
            .description(dto.description())
            .tags(dto.tags())
            .build();
    }

    /**
     * Maps DataEntityDataStoreHostingEntity to DTO (XR2).
     */
    public DataEntityDataStoreHostingDto toDto(DataEntityDataStoreHostingEntity entity) {
        return new DataEntityDataStoreHostingDto(
            entity.getId(),
            entity.getDataEntityPointId(),
            entity.getDataStoreInstanceId(),
            entity.getEnvironmentId(),
            entity.getDatabaseName(),
            entity.getSchemaName(),
            entity.getTableOrCollectionName(),
            entity.getHostingRole(),
            entity.getEvidenceSource(),
            entity.getConfidence(),
            entity.getDescription(),
            entity.getTags()
        );
    }

    public DataEntityDataStoreHostingEntity toEntity(DataEntityDataStoreHostingDto dto, String modelFileId) {
        return DataEntityDataStoreHostingEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .dataEntityPointId(dto.dataEntityPointId())
            .dataStoreInstanceId(dto.dataStoreInstanceId())
            .environmentId(dto.environmentId())
            .databaseName(dto.databaseName())
            .schemaName(dto.schemaName())
            .tableOrCollectionName(dto.tableOrCollectionName())
            .hostingRole(dto.hostingRole())
            .evidenceSource(dto.evidenceSource())
            .confidence(dto.confidence())
            .description(dto.description())
            .tags(dto.tags())
            .build();
    }

    /**
     * Maps ApplicationInfrastructureResourceUseEntity to DTO (XR3).
     */
    public ApplicationInfrastructureResourceUseDto toDto(ApplicationInfrastructureResourceUseEntity entity) {
        return new ApplicationInfrastructureResourceUseDto(
            entity.getId(),
            entity.getApplicationPointId(),
            entity.getInfrastructureResourceId(),
            entity.getEnvironmentId(),
            entity.getDependencyType(),
            entity.getProtocol(),
            entity.getEndpointOrTopic(),
            entity.getAccessMode(),
            entity.getEvidenceSource(),
            entity.getConfidence(),
            entity.getDescription(),
            entity.getTags()
        );
    }

    public ApplicationInfrastructureResourceUseEntity toEntity(ApplicationInfrastructureResourceUseDto dto, String modelFileId) {
        return ApplicationInfrastructureResourceUseEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .applicationPointId(dto.applicationPointId())
            .infrastructureResourceId(dto.infrastructureResourceId())
            .environmentId(dto.environmentId())
            .dependencyType(dto.dependencyType())
            .protocol(dto.protocol())
            .endpointOrTopic(dto.endpointOrTopic())
            .accessMode(dto.accessMode())
            .evidenceSource(dto.evidenceSource())
            .confidence(dto.confidence())
            .description(dto.description())
            .tags(dto.tags())
            .build();
    }

    /**
     * Maps ApplicationLoadBalancerExposureEntity to DTO (XR4).
     *
     * Q2: load_balancer_id NOT NULL + listener_id NULL.
     * target_port is Integer (numeric-as-text in the grid per spec 4 precedent).
     */
    public ApplicationLoadBalancerExposureDto toDto(ApplicationLoadBalancerExposureEntity entity) {
        return new ApplicationLoadBalancerExposureDto(
            entity.getId(),
            entity.getApplicationPointId(),
            entity.getLoadBalancerId(),
            entity.getListenerId(),
            entity.getEnvironmentId(),
            entity.getHostName(),
            entity.getPathPattern(),
            entity.getProtocol(),
            entity.getTargetPort(),
            entity.getExposure(),
            entity.getEvidenceSource(),
            entity.getConfidence(),
            entity.getDescription(),
            entity.getTags()
        );
    }

    public ApplicationLoadBalancerExposureEntity toEntity(ApplicationLoadBalancerExposureDto dto, String modelFileId) {
        return ApplicationLoadBalancerExposureEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .applicationPointId(dto.applicationPointId())
            .loadBalancerId(dto.loadBalancerId())
            .listenerId(dto.listenerId())
            .environmentId(dto.environmentId())
            .hostName(dto.hostName())
            .pathPattern(dto.pathPattern())
            .protocol(dto.protocol())
            .targetPort(dto.targetPort())
            .exposure(dto.exposure())
            .evidenceSource(dto.evidenceSource())
            .confidence(dto.confidence())
            .description(dto.description())
            .tags(dto.tags())
            .build();
    }

    // ============================================================================
    // IaC Sources / IaC Resource Bindings (Spec: 2026-05-05-infrastructure-terraform-discovery-readiness)
    //
    // Adds 1 new entity-shaped arm (iac_sources) and 1 new relationship-shaped
    // arm (iac_resource_bindings). Mirrors spec 1/2/6 mapping pattern: FKs as
    // raw String columns, BigDecimal confidence at scale 3, Integer line
    // numbers, model_file_id set server-side from the modelFileId parameter
    // and never read from the DTO.
    // ============================================================================

    public IaCSourceDto toDto(IaCSourceEntity entity) {
        return new IaCSourceDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getEnvironmentId(),
            entity.getSourceType(),
            entity.getRepositoryUrl(),
            entity.getRepositoryProvider(),
            entity.getBranch(),
            entity.getCommitSha(),
            entity.getPath(),
            entity.getWorkspace(),
            entity.getModuleName(),
            entity.getModulePath(),
            entity.getProvider(),
            entity.getOwner(),
            entity.getLastScannedAt(),
            entity.getLastImportedAt()
        );
    }

    public IaCSourceEntity toEntity(IaCSourceDto dto, String modelFileId) {
        return IaCSourceEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .environmentId(dto.environmentId())
            .sourceType(dto.sourceType())
            .repositoryUrl(dto.repositoryUrl())
            .repositoryProvider(dto.repositoryProvider())
            .branch(dto.branch())
            .commitSha(dto.commitSha())
            .path(dto.path())
            .workspace(dto.workspace())
            .moduleName(dto.moduleName())
            .modulePath(dto.modulePath())
            .provider(dto.provider())
            .owner(dto.owner())
            .lastScannedAt(dto.lastScannedAt())
            .lastImportedAt(dto.lastImportedAt())
            .build();
    }

    public IaCResourceBindingDto toDto(IaCResourceBindingEntity entity) {
        return new IaCResourceBindingDto(
            entity.getId(),
            entity.getIacSourceId(),
            entity.getInfrastructurePointId(),
            entity.getEnvironmentId(),
            entity.getIacAddress(),
            entity.getIacResourceType(),
            entity.getIacResourceName(),
            entity.getProvider(),
            entity.getFilePath(),
            entity.getStartLine(),
            entity.getEndLine(),
            entity.getStateResourceId(),
            entity.getExternalId(),
            entity.getBindingStatus(),
            entity.getConfidence(),
            entity.getLastSeenAt(),
            entity.getDescription(),
            entity.getTags()
        );
    }

    public IaCResourceBindingEntity toEntity(IaCResourceBindingDto dto, String modelFileId) {
        return IaCResourceBindingEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .iacSourceId(dto.iacSourceId())
            .infrastructurePointId(dto.infrastructurePointId())
            .environmentId(dto.environmentId())
            .iacAddress(dto.iacAddress())
            .iacResourceType(dto.iacResourceType())
            .iacResourceName(dto.iacResourceName())
            .provider(dto.provider())
            .filePath(dto.filePath())
            .startLine(dto.startLine())
            .endLine(dto.endLine())
            .stateResourceId(dto.stateResourceId())
            .externalId(dto.externalId())
            .bindingStatus(dto.bindingStatus())
            .confidence(dto.confidence())
            .lastSeenAt(dto.lastSeenAt())
            .description(dto.description())
            .tags(dto.tags())
            .build();
    }
    // ============================================================================
    // Library Backend Foundation (Spec: 2026-05-05-library-backend-foundation)
    // Bidirectional mappings for Library entity and CodeUnitDependency relationship.
    // model_file_id is set server-side from the supplied parameter; never read
    // from the DTO.
    // ============================================================================

    public LibraryDto toDto(LibraryEntity entity) {
        return new LibraryDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getEcosystem(),
            entity.getRepoLocation(),
            entity.getRepoSubfolder(),
            entity.getCoreTech(),
            entity.getCoreTechResolved(),
            entity.getCoreTechLanguagePack(),
            entity.getCoreTechFrameworkPacks(),
            entity.getCoreTechResolutionConfidence(),
            entity.getCoreTechResolvedAt(),
            entity.getSourceOrigin(),
            entity.getSourceSystem(),
            entity.getSourceReference(),
            entity.getGenerationStatus(),
            entity.getGenerationNotes(),
            entity.getLastVerifiedAt(),
            entity.getPackageSetId()
        );
    }

    public LibraryEntity toEntity(LibraryDto dto, String modelFileId) {
        return LibraryEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .name(dto.name())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .ecosystem(dto.ecosystem())
            .repoLocation(dto.repoLocation())
            .repoSubfolder(dto.repoSubfolder())
            .coreTech(dto.coreTech())
            .coreTechResolved(dto.coreTechResolved())
            .coreTechLanguagePack(dto.coreTechLanguagePack())
            .coreTechFrameworkPacks(dto.coreTechFrameworkPacks())
            .coreTechResolutionConfidence(dto.coreTechResolutionConfidence())
            .coreTechResolvedAt(dto.coreTechResolvedAt())
            .sourceOrigin(dto.sourceOrigin())
            .sourceSystem(dto.sourceSystem())
            .sourceReference(dto.sourceReference())
            .generationStatus(dto.generationStatus())
            .generationNotes(dto.generationNotes())
            .lastVerifiedAt(dto.lastVerifiedAt())
            .packageSetId(dto.packageSetId())
            .build();
    }

    public CodeUnitDependencyDto toDto(CodeUnitDependencyEntity entity) {
        return new CodeUnitDependencyDto(
            entity.getId(),
            entity.getSourceApplicationPointId(),
            entity.getTargetApplicationPointId(),
            entity.getDeclaredName(),
            entity.getDeclaredVersion(),
            entity.getDeclaredVersionRange(),
            entity.getScope(),
            entity.getManifestPath(),
            entity.getManifestLine(),
            entity.getEvidenceSource(),
            entity.getConfidence(),
            entity.getDescription(),
            entity.getTags()
        );
    }

    public CodeUnitDependencyEntity toEntity(CodeUnitDependencyDto dto, String modelFileId) {
        return CodeUnitDependencyEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .sourceApplicationPointId(dto.sourceApplicationPointId())
            .targetApplicationPointId(dto.targetApplicationPointId())
            .declaredName(dto.declaredName())
            .declaredVersion(dto.declaredVersion())
            .declaredVersionRange(dto.declaredVersionRange())
            .scope(dto.scope())
            .manifestPath(dto.manifestPath())
            .manifestLine(dto.manifestLine())
            .evidenceSource(dto.evidenceSource())
            .confidence(dto.confidence())
            .description(dto.description())
            .tags(dto.tags())
            .build();
    }

}
