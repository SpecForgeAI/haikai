package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourBaselineRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourBaselineRequest;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourBaselineService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * REST controller for {@code api_behaviour_baselines}.
 *
 * <p>Sibling to capture sessions: caller MUST supply both {@code projectId}
 * and {@code architectureId} on the list endpoint.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 * <p>Extended: API Test Harness — Target-Side Capture (2026-05-25) — Task Group 2
 * ({@link #listTargetBaselines} endpoint for Spec #5's diff UI consumption).</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/api-behaviour/baselines")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourBaselineController {

    private final ApiBehaviourBaselineService service;

    /**
     * List baselines for an architecture OR for a single capture session.
     * Caller MUST supply exactly one of {@code architectureId} or
     * {@code sessionId}.
     */
    @GetMapping
    public ResponseEntity<List<ApiBehaviourBaselineDto>> list(
            @PathVariable UUID projectId,
            @RequestParam(required = false) UUID architectureId,
            @RequestParam(required = false) UUID sessionId) {
        if (architectureId == null && sessionId == null) {
            throw new IllegalArgumentException(
                "Either architectureId or sessionId is required");
        }
        if (architectureId != null && sessionId != null) {
            throw new IllegalArgumentException(
                "Provide exactly one of architectureId or sessionId, not both");
        }
        if (architectureId != null) {
            return ResponseEntity.ok(
                service.listByProjectAndArchitecture(projectId, architectureId));
        }
        return ResponseEntity.ok(service.listBySession(sessionId));
    }

    @GetMapping("/{baselineId}")
    public ResponseEntity<ApiBehaviourBaselineDto> get(
            @PathVariable UUID projectId,
            @PathVariable UUID baselineId) {
        return ResponseEntity.ok(service.get(projectId, baselineId));
    }

    /**
     * List the target-side baselines paired with the given source current-state
     * baseline.
     *
     * <p>Spec #5's diff UI is the consumer; this spec's frontend does not call
     * the endpoint (accepted Q5 — ships here to keep the AMS contract complete).
     * Returns 404 if {@code sourceId} does not resolve under {@code projectId}
     * OR does not have {@code kind="current"} (the only valid pairing source).</p>
     */
    @GetMapping("/{sourceId}/target-baselines")
    public ResponseEntity<List<ApiBehaviourBaselineDto>> listTargetBaselines(
            @PathVariable UUID projectId,
            @PathVariable UUID sourceId) {
        return ResponseEntity.ok(
            service.listTargetBaselinesPairedWith(projectId, sourceId));
    }

    @PostMapping
    public ResponseEntity<ApiBehaviourBaselineDto> create(
            @PathVariable UUID projectId,
            @RequestBody CreateApiBehaviourBaselineRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(service.create(projectId, request));
    }

    @PatchMapping("/{baselineId}")
    public ResponseEntity<ApiBehaviourBaselineDto> update(
            @PathVariable UUID projectId,
            @PathVariable UUID baselineId,
            @RequestBody UpdateApiBehaviourBaselineRequest request) {
        return ResponseEntity.ok(service.update(projectId, baselineId, request));
    }

    @DeleteMapping("/{baselineId}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID projectId,
            @PathVariable UUID baselineId) {
        service.delete(projectId, baselineId);
        return ResponseEntity.noContent().build();
    }
}
