package com.example.architecturemodel.controller.procbehaviour;

import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.CreateProcBaselineRequest;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.MarkProcBaselineItemsStaleRequest;
import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourBaselineItemEntity;
import com.example.architecturemodel.service.procbehaviour.ProcBehaviourService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Proc behaviour baselines and their items -- Stored Proc &amp; Function
 * Behaviour Program, Spec 3 (changeset 230).
 *
 * <pre>
 *   POST .../proc-behaviour/baselines                    -> 201 baseline
 *   GET  .../proc-behaviour/baselines                    -> [baseline] newest first
 *   GET  .../proc-behaviour/baselines/pinned[?kind=current] -> baseline | 404
 *   GET  .../proc-behaviour/baselines/{id}               -> baseline | 404
 *   POST .../proc-behaviour/baselines/{id}/pin           -> baseline (supersedes the kind)
 *   GET  .../proc-behaviour/baselines/{id}/items[?routine_id=]
 *   POST .../proc-behaviour/baselines/{id}/items/stale   -> {marked}
 * </pre>
 *
 * <p>{@code /baselines/pinned} is declared BEFORE {@code /baselines/{id}} and
 * wins on literal-over-template specificity, so the word "pinned" never
 * reaches the uuid converter. Entities are returned verbatim (snake_case
 * wire by the AMS default).</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/proc-behaviour/baselines")
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ProcBehaviourBaselineController {

    private final ProcBehaviourService service;

    @PostMapping
    public ResponseEntity<ProcBehaviourBaselineEntity> create(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody CreateProcBaselineRequest request) {
        ProcBehaviourBaselineEntity created = service.createBaseline(projectId, architectureId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @GetMapping
    public List<ProcBehaviourBaselineEntity> list(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        return service.listBaselines(architectureId);
    }

    @GetMapping("/pinned")
    public ResponseEntity<ProcBehaviourBaselineEntity> pinned(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestParam(name = "kind", required = false, defaultValue = "current") String kind) {
        return service.getPinnedBaseline(architectureId, kind)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/{baselineId}")
    public ResponseEntity<ProcBehaviourBaselineEntity> get(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID baselineId) {
        return service.getBaseline(architectureId, baselineId)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/{baselineId}/pin")
    public ResponseEntity<ProcBehaviourBaselineEntity> pin(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID baselineId) {
        if (service.getBaseline(architectureId, baselineId).isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(service.pin(architectureId, baselineId));
    }

    @GetMapping("/{baselineId}/items")
    public ResponseEntity<List<ProcBehaviourBaselineItemEntity>> items(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID baselineId,
            @RequestParam(name = "routine_id", required = false) UUID routineId) {
        if (service.getBaseline(architectureId, baselineId).isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(service.listBaselineItems(baselineId, routineId));
    }

    @PostMapping("/{baselineId}/items/stale")
    public ResponseEntity<Map<String, Object>> markStale(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID baselineId,
            @RequestBody MarkProcBaselineItemsStaleRequest request) {
        if (service.getBaseline(architectureId, baselineId).isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        int marked = service.markItemsStale(baselineId,
            request == null ? Map.of() : request.routineBodyHashes());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("marked", marked);
        return ResponseEntity.ok(body);
    }

    /** Mirrors the session controller: a conflicting state is 409, never 500. */
    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, Object>> handleConflict(IllegalStateException ex) {
        log.warn("[diag-ams] op=proc_behaviour_baseline_conflict message={}", ex.getMessage());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", ex.getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT).body(body);
    }
}
