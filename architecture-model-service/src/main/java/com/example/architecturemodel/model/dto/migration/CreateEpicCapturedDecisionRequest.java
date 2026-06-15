package com.example.architecturemodel.model.dto.migration;

/**
 * POST body for {@code epic_captured_decisions} creation.
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Task Group 4.</p>
 *
 * <p>All fields are boxed reference types so an omitted JSON key arrives as
 * {@code null} (not as a primitive zero/false) -- per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <p>Source flag: POST always seeds {@code source = user_added}. The service
 * layer ignores any incoming {@code source} on a POST (it is recorded only
 * indirectly via the audit channel and the PATCH semantics).</p>
 *
 * <p>{@code decisionKey} and {@code decisionText} are required at the service
 * layer; status defaults to {@code draft} if omitted.</p>
 */
public record CreateEpicCapturedDecisionRequest(
    String decisionKey,
    String decisionText,
    String status,
    String lastEditedBy
) {}
