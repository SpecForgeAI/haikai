package com.example.architecturemodel.model.dto.targetstate;

import com.example.architecturemodel.jackson.CamelCaseWire;

/**
 * Request body for
 * {@code POST /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions}.
 *
 * <p>Marked {@code @CamelCaseWire} because the captured-decisions data plane speaks camelCase.</p>
 *
 * <p>The {@code projectId} and {@code targetArchitectureId} are taken from
 * the URL path, not the body. The server sets the row {@code id} and
 * {@code createdAt}; the caller MUST pass {@code createdByTask} (per Q9 --
 * NOT NULL with no DB default).</p>
 *
 * <p>All fields are reference types ({@link String}). No primitives appear --
 * future numeric / boolean fields MUST use boxed types per
 * {@code project_primitive_double_dto_overwrite.md} so any future evolution
 * to PATCH semantics will not silently zero-overwrite fields when a JSON key
 * is omitted by the caller.</p>
 */
@CamelCaseWire
public record CreateTargetStateCapturedDecisionRequest(
    String decisionCode,
    String scopeKind,
    String scopeRefType,
    String scopeRefId,
    String answerValue,
    String answerSummary,
    String standardsLookupRef,
    String conversationThreadId,
    String conversationTurnRef,
    String createdByTask
) {}
