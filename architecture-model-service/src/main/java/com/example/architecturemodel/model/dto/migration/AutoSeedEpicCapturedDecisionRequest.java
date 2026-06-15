package com.example.architecturemodel.model.dto.migration;

import java.util.UUID;

/**
 * POST body for the dedicated auto-seed endpoint
 * {@code .../captured-decisions/auto-seed}.
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Task Group 5.4 auto-seed pipeline.</p>
 *
 * <p>Unlike the public POST endpoint (which always stamps
 * {@code source = user_added}), this endpoint routes through
 * {@code EpicCapturedDecisionService#upsertAutoExtracted}, so rows created via
 * this path carry {@code source = auto_extracted} and a non-null
 * {@code sourceSpecGenerationId}. Pinned rows ({@code user_edited} or
 * {@code user_added}) are skipped per the upsert contract.</p>
 */
public record AutoSeedEpicCapturedDecisionRequest(
    String decisionKey,
    String decisionText,
    UUID sourceSpecGenerationId
) {}
