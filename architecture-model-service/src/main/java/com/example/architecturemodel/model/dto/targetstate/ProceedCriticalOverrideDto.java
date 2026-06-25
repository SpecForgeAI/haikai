package com.example.architecturemodel.model.dto.targetstate;

import java.time.Instant;

/**
 * Read DTO for the "proceed with remaining criticals" override audit trio on a
 * target architecture (Spec: Vulnerability Reduction + Steering, 2026-06-24,
 * Spec 4 of 6 -- Task Group 4).
 *
 * <p>Surfaced by {@code GET .../architectures/{architectureId}/proceed-critical-override}
 * so the frontend can render the later read-only override banner (mirroring the
 * capture-session coverage-override banner read by {@code CaptureSessionDetailView}).</p>
 *
 * <p><b>Wire shape: snake_case (AMS default -- NO {@code @CamelCaseWire}).</b> The
 * global {@code spring.jackson.property-naming-strategy: SNAKE_CASE} serialises
 * these camelCase Java fields as {@code proceed_critical_override_justification} /
 * {@code remaining_critical_count} / {@code proceed_critical_override_at} /
 * {@code overridden}, matching the gateway proxy + frontend snake_case-typed API
 * module that read this trio.</p>
 *
 * <p>{@code overridden} is a convenience flag computed at build time -- true iff
 * an override has actually been recorded (justification present OR a timestamp).
 * The numeric {@code remainingCriticalCount} is boxed {@link Integer} so an absent
 * value is preserved as {@code null} (never the primitive-default {@code 0}) per
 * {@code project_primitive_double_dto_overwrite.md}. When no override exists all
 * three audit fields are {@code null} and {@code overridden} is {@code false}.</p>
 */
public record ProceedCriticalOverrideDto(
    String proceedCriticalOverrideJustification,
    Integer remainingCriticalCount,
    Instant proceedCriticalOverrideAt,
    Boolean overridden
) {

    /**
     * Build the read DTO from the persisted trio, deriving {@code overridden}.
     * An override counts as recorded when a justification was stored OR a
     * timestamp was stored (either is sufficient evidence; the count alone is
     * not, since 0 remaining is a legitimate non-override state).
     */
    public static ProceedCriticalOverrideDto of(
            String justification,
            Integer remainingCriticalCount,
            Instant overrideAt) {
        boolean overridden =
            (justification != null && !justification.isBlank()) || overrideAt != null;
        return new ProceedCriticalOverrideDto(
            justification, remainingCriticalCount, overrideAt, overridden);
    }

    /** The not-overridden default (all audit fields null, {@code overridden=false}). */
    public static ProceedCriticalOverrideDto notOverridden() {
        return new ProceedCriticalOverrideDto(null, null, null, false);
    }
}
