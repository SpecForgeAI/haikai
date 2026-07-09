package com.example.architecturemodel.mapper.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineDto;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineItemDto;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureDto;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureSessionDto;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourDiagnosticDto;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourDiffDto;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourDiffItemDto;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourOperationDto;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourScenarioDto;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineItemEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureSessionEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiagnosticEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiffEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiffItemEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourOperationEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourScenarioEntity;

/**
 * Manual entity ↔ DTO mappers for the {@code api_behaviour_*} tables.
 *
 * <p>Static methods rather than a Spring bean — matches the pattern used by
 * other AMS DTO converters in this codebase (e.g. the inline {@code toDto}
 * helpers on {@code ArchitectureElementMappingService}). No MapStruct: the
 * existing {@code mapper/} package on this service does not use MapStruct,
 * and the spec explicitly says "do not introduce MapStruct if not already
 * used in package".</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 * <p>Extended: API Test Harness — Target-Side Capture (2026-05-25) — Task Group 2
 * (capture-session {@code kind} + {@code sourceBaselineId}; baseline
 * {@code kind} + {@code pairedWithBaselineId}).</p>
 * <p>Extended: API Test Harness — Diff Engine (2026-05-25) — Task Group 2
 * (diff + diff_item entity/DTO converters).</p>
 * <p>Extended: Reconcile Full-Response Fidelity (2026-06-17) — Task Group 1
 * (diff_item {@code headerClassification}).</p>
 * <p>Extended: Baseline Integrity &amp; Provenance (2026-06-17) — Task Group 1
 * (baseline {@code contentHash} + {@code provenanceJson}).</p>
 * <p>Extended: Stateful Sequence Scenarios (2026-06-18) — Task Group 1
 * (baseline item {@code sequenceJson}).</p>
 */
public final class ApiBehaviourMapper {

    private ApiBehaviourMapper() {
        // utility — no instances
    }

    public static ApiBehaviourCaptureSessionDto toDto(ApiBehaviourCaptureSessionEntity entity) {
        if (entity == null) {
            return null;
        }
        return new ApiBehaviourCaptureSessionDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getArchitectureId(),
            entity.getName(),
            entity.getStatus(),
            entity.getEnvironmentName(),
            entity.getApiBaseUrl(),
            entity.getAuthType(),
            entity.getAuthConfigRedactedJson(),
            entity.getDefaultHeadersRedactedJson(),
            entity.getOasSpecRefsJson(),
            entity.getDbConfigRedactedJson(),
            entity.getMutatingCallsConfirmed(),
            entity.getStartedAt(),
            entity.getCompletedAt(),
            entity.getErrorMessage(),
            entity.getKind(),
            entity.getSourceBaselineId(),
            entity.getScenariosAttempted(),
            entity.getScenariosCompleted(),
            entity.getScenariosErrored(),
            entity.getScopeInterfaceIdsJson(),
            entity.getCoverageOverrideJustification(),
            entity.getCoverageOverrideUnaccountedCount(),
            entity.getCoverageOverrideAt(),
            entity.getCoverageSummaryJson(),
            entity.getDataTypeDefaultsJson(),
            entity.getBehaviourSemanticsConfigJson(),
            entity.getCreatedAt(),
            entity.getUpdatedAt()
        );
    }

    public static ApiBehaviourOperationDto toDto(ApiBehaviourOperationEntity entity) {
        if (entity == null) {
            return null;
        }
        return new ApiBehaviourOperationDto(
            entity.getId(),
            entity.getSessionId(),
            entity.getOperationId(),
            entity.getMethod(),
            entity.getPath(),
            entity.getSummary(),
            entity.getDescription(),
            entity.getIncluded(),
            entity.getSafeToExecute(),
            entity.getRequestSchemaJson(),
            entity.getResponseSchemaJson(),
            entity.getOasOperationJson(),
            entity.getExclusionReason(),
            entity.getCreatedAt(),
            entity.getUpdatedAt()
        );
    }

    public static ApiBehaviourScenarioDto toDto(ApiBehaviourScenarioEntity entity) {
        if (entity == null) {
            return null;
        }
        return new ApiBehaviourScenarioDto(
            entity.getId(),
            entity.getSessionId(),
            entity.getOperationId(),
            entity.getScenarioName(),
            entity.getScenarioType(),
            entity.getStatus(),
            entity.getGenerationSource(),
            entity.getRequestMethod(),
            entity.getRequestPath(),
            entity.getRequestQueryJson(),
            entity.getRequestHeadersRedactedJson(),
            entity.getRequestBodyJson(),
            entity.getNotes(),
            entity.getCreatedAt(),
            entity.getUpdatedAt()
        );
    }

    public static ApiBehaviourCaptureDto toDto(ApiBehaviourCaptureEntity entity) {
        if (entity == null) {
            return null;
        }
        return new ApiBehaviourCaptureDto(
            entity.getId(),
            entity.getSessionId(),
            entity.getScenarioId(),
            entity.getOperationId(),
            entity.getAttemptNumber(),
            entity.getRequestMethod(),
            entity.getRequestUrlRedacted(),
            entity.getRequestPath(),
            entity.getRequestQueryJson(),
            entity.getRequestHeadersRedactedJson(),
            entity.getRequestBodyJson(),
            entity.getResponseStatus(),
            entity.getResponseHeadersRedactedJson(),
            entity.getResponseBodyJson(),
            entity.getResponseBodyRaw(),
            entity.getStateDeltaJson(),
            entity.getDurationMs(),
            entity.getErrorType(),
            entity.getErrorMessage(),
            entity.getCapturedAt(),
            entity.getAccepted(),
            entity.getAcceptedAt(),
            entity.getReviewerNotes(),
            entity.getVolatilePathsJson()
        );
    }

    public static ApiBehaviourDiagnosticDto toDto(ApiBehaviourDiagnosticEntity entity) {
        if (entity == null) {
            return null;
        }
        return new ApiBehaviourDiagnosticDto(
            entity.getId(),
            entity.getSessionId(),
            entity.getOperationId(),
            entity.getScenarioId(),
            entity.getDiagnosticType(),
            entity.getMessage(),
            entity.getDetailJson(),
            entity.getCreatedAt()
        );
    }

    public static ApiBehaviourBaselineDto toDto(ApiBehaviourBaselineEntity entity) {
        if (entity == null) {
            return null;
        }
        return new ApiBehaviourBaselineDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getArchitectureId(),
            entity.getSessionId(),
            entity.getName(),
            entity.getStatus(),
            entity.getAcceptedCaptureCount(),
            entity.getOperationCount(),
            entity.getNotes(),
            entity.getKind(),
            entity.getPairedWithBaselineId(),
            entity.getContentHash(),
            entity.getProvenanceJson(),
            entity.getCreatedAt(),
            entity.getUpdatedAt()
        );
    }

    public static ApiBehaviourBaselineItemDto toDto(ApiBehaviourBaselineItemEntity entity) {
        if (entity == null) {
            return null;
        }
        return new ApiBehaviourBaselineItemDto(
            entity.getId(),
            entity.getBaselineId(),
            entity.getCaptureId(),
            entity.getOperationId(),
            entity.getScenarioId(),
            entity.getMethod(),
            entity.getPath(),
            entity.getScenarioName(),
            entity.getRequestJson(),
            entity.getResponseStatus(),
            entity.getResponseJson(),
            entity.getVolatilePathsJson(),
            entity.getSequenceJson(),
            entity.getResponseBodyRaw(),
            entity.getStateDeltaJson(),
            entity.getBusinessNotes(),
            entity.getCreatedAt(),
            entity.getUpdatedAt()
        );
    }

    /**
     * Entity → DTO conversion for {@link ApiBehaviourDiffEntity}.
     *
     * <p>Spec: API Test Harness — Diff Engine (2026-05-25) — Task Group 2</p>
     */
    public static ApiBehaviourDiffDto toDto(ApiBehaviourDiffEntity entity) {
        if (entity == null) {
            return null;
        }
        return new ApiBehaviourDiffDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getArchitectureId(),
            entity.getSourceBaselineId(),
            entity.getTargetBaselineId(),
            entity.getStatus(),
            entity.getComparisonProfile(),
            entity.getMatchedCount(),
            entity.getStatusDriftCount(),
            entity.getBodyShapeDriftCount(),
            entity.getBodyValueDriftCount(),
            entity.getSourceOnlyCount(),
            entity.getTargetOnlyCount(),
            entity.getSourceBaselineUpdatedAt(),
            entity.getTargetBaselineUpdatedAt(),
            entity.getComputedAt(),
            entity.getErrorMessage(),
            entity.getCreatedAt(),
            entity.getUpdatedAt()
        );
    }

    /**
     * Entity → DTO conversion for {@link ApiBehaviourDiffItemEntity}.
     *
     * <p>Spec: API Test Harness — Diff Engine (2026-05-25) — Task Group 2</p>
     * <p>Extended: Reconcile Full-Response Fidelity (2026-06-17) — Task Group 1
     * ({@code headerClassification}).</p>
     */
    public static ApiBehaviourDiffItemDto toDto(ApiBehaviourDiffItemEntity entity) {
        if (entity == null) {
            return null;
        }
        return new ApiBehaviourDiffItemDto(
            entity.getId(),
            entity.getDiffId(),
            entity.getMethod(),
            entity.getPath(),
            entity.getScenarioName(),
            entity.getSourceBaselineItemId(),
            entity.getTargetBaselineItemId(),
            entity.getStatusClassification(),
            entity.getBodyClassification(),
            entity.getHeaderClassification(),
            entity.getSourceResponseStatus(),
            entity.getTargetResponseStatus(),
            entity.getBodyDiffJson(),
            entity.getNotes(),
            entity.getCreatedAt()
        );
    }
}
