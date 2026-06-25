package com.example.architecturemodel.model.dto.targetstate;

import java.time.Instant;

/**
 * Write request for the "proceed with remaining criticals" override audit trio
 * on a target architecture (Spec: Vulnerability Reduction + Steering,
 * 2026-06-24, Spec 4 of 6 -- Task Group 4).
 *
 * <p>Body of {@code PUT .../architectures/{architectureId}/proceed-critical-override}.
 * Written ONCE PER TARGET ARCHITECTURE when the architect-conversation proceed
 * gate is explicitly overridden while remaining CRITICAL CVEs exist -- mirroring
 * the capture-session coverage-override write
 * ({@code UpdateApiBehaviourCaptureSessionRequest}'s coverage-override trio).</p>
 *
 * <p><b>Wire shape: snake_case (AMS default -- NO {@code @CamelCaseWire}).</b> The
 * caller sends {@code proceed_critical_override_justification} /
 * {@code remaining_critical_count} / {@code proceed_critical_override_at}.</p>
 *
 * <p>All fields are nullable / boxed so an omitted field never wipes the column
 * (PATCH-style null-guard semantics per
 * {@code project_primitive_double_dto_overwrite.md}). In practice the proceed
 * override always supplies the justification + the remaining-critical count; the
 * timestamp is optional (the service stamps {@code now()} when omitted, the same
 * convenience the coverage-override write offers).</p>
 *
 * @param proceedCriticalOverrideJustification the user-supplied reason for
 *        proceeding despite remaining criticals (required for a real override;
 *        a blank/null justification is rejected as a no-op by the service so the
 *        gate is never bypassed without a recorded reason).
 * @param remainingCriticalCount the remaining critical CVE count at override time
 *        (boxed Integer; preserved verbatim as the audit snapshot).
 * @param proceedCriticalOverrideAt optional override timestamp; the service
 *        defaults it to {@code Instant.now()} when null.
 */
public record UpsertProceedCriticalOverrideRequest(
    String proceedCriticalOverrideJustification,
    Integer remainingCriticalCount,
    Instant proceedCriticalOverrideAt
) {}
