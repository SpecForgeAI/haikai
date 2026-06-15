package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.targetstate.TargetStateCapturedDecisionDto;
import com.example.architecturemodel.model.entity.TargetStateCapturedDecisionEntity;
import org.springframework.stereotype.Component;

/**
 * Mapper for converting {@link TargetStateCapturedDecisionEntity} to
 * {@link TargetStateCapturedDecisionDto}.
 *
 * <p>Spec: Target State Captured Decisions -- Data Plane
 * (2026-05-24-target-state-captured-decisions-data-plane) -- Task Group 3.</p>
 *
 * <p>The entity-side {@code id} is exposed on the wire as {@code decisionId}
 * (lowerCamelCase per the DTO's {@code @CamelCaseWire}) to disambiguate from
 * sibling DTOs returned inside aggregation responses.</p>
 */
@Component
public class TargetStateCapturedDecisionMapper {

    /**
     * Converts the entity to its response DTO. Returns {@code null} when the
     * input is {@code null} so callers can use the mapper unconditionally in
     * an {@code Optional} chain.
     */
    public TargetStateCapturedDecisionDto toDto(TargetStateCapturedDecisionEntity entity) {
        if (entity == null) {
            return null;
        }
        return new TargetStateCapturedDecisionDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getTargetArchitectureId(),
            entity.getDecisionCode(),
            entity.getScopeKind(),
            entity.getScopeRefType(),
            entity.getScopeRefId(),
            entity.getAnswerValue(),
            entity.getAnswerSummary(),
            entity.getStandardsLookupRef(),
            entity.getConversationThreadId(),
            entity.getConversationTurnRef(),
            entity.getCreatedAt(),
            entity.getCreatedByTask(),
            entity.getSupersededById()
        );
    }
}
