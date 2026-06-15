package com.example.architecturemodel.model.dto.targetstate;

import com.example.architecturemodel.jackson.CamelCaseWire;

import java.util.UUID;

/**
 * Compact reference DTO for a single captured decision, embedded inside the
 * {@link TargetStateDecisionsSummaryDto} block returned alongside the
 * existing {@code MigrationDiscoveryContextDto} aggregation response.
 *
 * <p>Marked {@code @CamelCaseWire} because the captured-decisions data plane speaks camelCase.</p>
 *
 * <p>Intentionally narrower than {@link TargetStateCapturedDecisionDto}: this
 * is the shape downstream prompts need (Spec 4 Product Manager Book of Work
 * and Shape-Spec generation) to cite a decision in a bounded summary -- the
 * row id, the decision code, the scope, the short answer, and the optional
 * standards lookup reference. The full {@code answerValue}, audit fields, and
 * supersession fields stay on the standalone DTO.</p>
 *
 * <p>All fields are boxed reference types per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 */
@CamelCaseWire
public record CapturedDecisionRefDto(
    UUID decisionId,
    String decisionCode,
    String scopeKind,
    String scopeRefId,
    String answerSummary,
    String standardsLookupRef
) {}
