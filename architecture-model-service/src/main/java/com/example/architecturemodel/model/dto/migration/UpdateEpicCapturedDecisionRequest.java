package com.example.architecturemodel.model.dto.migration;

/**
 * PATCH body for {@code epic_captured_decisions} updates.
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Task Group 4.</p>
 *
 * <p>All fields are nullable. A {@code null} field means "leave the persisted
 * value alone" -- the service-layer null-guards every field per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <p>Service-layer source-flag pinning rule: any non-null field on this PATCH
 * (other than no-op {@code lastEditedBy} touches) flips an
 * {@code auto_extracted} row's source to {@code user_edited} and pins it
 * against further auto-overwrite by re-runs of pass 1. The flip is one-way --
 * {@code user_edited} and {@code user_added} rows do not revert.</p>
 */
public record UpdateEpicCapturedDecisionRequest(
    String decisionKey,
    String decisionText,
    String status,
    String lastEditedBy
) {}
