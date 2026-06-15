package com.example.architecturemodel.controller.migration;

import com.example.architecturemodel.model.dto.migration.ReadyToRetryResponse;
import com.example.architecturemodel.service.migration.MissingInputCrossStoryMatcherService;
import com.example.architecturemodel.service.migration.MissingInputCrossStoryMatcherService.ReadyToRetryStoryRow;
import com.example.architecturemodel.service.migration.MissingInputCrossStoryMatcherService.ReadyToRetrySummary;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * REST controller for the spec-generation retry surface of the Missing Input
 * Resolver Flow.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 4.</p>
 *
 * <h2>Endpoints</h2>
 * <ul>
 *   <li>{@code GET  /api/projects/{projectId}/spec-generations/ready-to-retry}
 *       -- returns the project-wide ready-to-retry summary (count + spec ids +
 *       per-spec readiness rows). Delegates to
 *       {@link MissingInputCrossStoryMatcherService#findReadyToRetry(UUID)}.</li>
 *   <li>{@code POST /api/projects/{projectId}/spec-generations/retry-batch}
 *       -- ALWAYS returns HTTP 501 Not Implemented with the structured envelope
 *       {@code { code: 'use_gateway_retry', message: '...' }}. See the
 *       "Why 501" note below.</li>
 * </ul>
 *
 * <h2>Why retry-batch returns 501 (not a deferred-to-gateway proxy)</h2>
 * The retry orchestration -- token-cost preview gating, LLM dispatch, batch
 * fan-out, partial-failure rollup -- lives in the gateway via the existing
 * {@code runShapeSpecGenerationBatch} handler (Spec 2026-05-19). Wiring an AMS
 * stub that "stamps each row's status back to {@code not_attempted}" would
 * fork the orchestration in two places and invite drift: AMS would set state
 * the gateway is responsible for clearing, the gateway batch handler would
 * need new code to detect AMS-stamped rows, and the cost-preview threshold
 * would have nowhere obvious to live.
 *
 * <p>By rejecting the call at AMS with a structured 501, the contract is
 * explicit: callers reaching AMS for retry orchestration have a bug. Once
 * Task Group 5 lands the gateway proxy, the gateway route never reaches this
 * controller -- the gateway calls
 * {@code runShapeSpecGenerationBatch(targetWorkItemIds, regenerateAll=true)}
 * directly. This controller method exists only as a safety net + discovery
 * surface (the response envelope tells the caller exactly which gateway route
 * to use).</p>
 *
 * <p>Documented in spec.md line 37 (retry-batch delegates to the gateway) and
 * tasks.md 4.1 (the test for this endpoint asserts the 4xx/501 + envelope
 * contract rather than a stub stamping).</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/spec-generations")
@RequiredArgsConstructor
@Slf4j
public class SpecGenerationRetryController {

    /** Structured envelope code the gateway / frontend branch on. */
    static final String USE_GATEWAY_CODE = "use_gateway_retry";

    /** Human-readable message threaded through the envelope. */
    static final String USE_GATEWAY_MESSAGE =
        "Retry orchestration lives in the gateway; call POST "
            + "/api/v1/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/"
            + "generate-batch with targetWorkItemIds.";

    private final MissingInputCrossStoryMatcherService matcherService;

    @GetMapping("/ready-to-retry")
    public ResponseEntity<ReadyToRetryResponse> readyToRetry(@PathVariable UUID projectId) {
        log.debug(
            "[diag-ams] spec_generations ready_to_retry projectId={}",
            projectId);

        ReadyToRetrySummary summary = matcherService.findReadyToRetry(projectId);
        List<ReadyToRetryResponse.ReadyToRetrySpec> specs =
            new ArrayList<>(summary.stories() == null ? 0 : summary.stories().size());
        if (summary.stories() != null) {
            for (ReadyToRetryStoryRow row : summary.stories()) {
                if (row == null) continue;
                specs.add(new ReadyToRetryResponse.ReadyToRetrySpec(
                    row.specGenerationId(),
                    row.workItemId(),
                    row.title(),
                    row.totalKeys(),
                    row.totalKeys(), // missingInputKeyCount mirrors totalKeys
                    row.resolvedKeys()));
            }
        }
        return ResponseEntity.ok(new ReadyToRetryResponse(
            summary.count(),
            summary.specGenerationIds() == null
                ? List.of()
                : summary.specGenerationIds(),
            specs));
    }

    /**
     * Retry orchestration lives at the gateway -- see the class-level javadoc.
     * This endpoint always returns HTTP 501 with the structured envelope.
     */
    @PostMapping("/retry-batch")
    public ResponseEntity<Map<String, Object>> retryBatch(
            @PathVariable UUID projectId,
            @RequestBody(required = false) Object body) {
        log.warn(
            "[diag-ams] spec_generations retry_batch_called_on_ams projectId={} -- responding 501",
            projectId);

        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("status", HttpStatus.NOT_IMPLEMENTED.value());
        envelope.put("error", "Not Implemented");
        envelope.put("code", USE_GATEWAY_CODE);
        envelope.put("message", USE_GATEWAY_MESSAGE);
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).body(envelope);
    }
}
