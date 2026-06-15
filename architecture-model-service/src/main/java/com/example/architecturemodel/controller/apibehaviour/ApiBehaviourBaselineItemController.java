package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineItemDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourBaselineItemRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourBaselineItemRequest;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourBaselineItemService;
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
 * REST controller for {@code api_behaviour_baseline_items}.
 *
 * <p>Items are baseline-owned: the list endpoint requires {@code baselineId}
 * as a query param. (We chose a flat URL under the project rather than a
 * nested {@code /baselines/{id}/items} path to mirror the simpler routing
 * convention used by the existing {@code architecture-mappings} controller.)</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/api-behaviour/baseline-items")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourBaselineItemController {

    private final ApiBehaviourBaselineItemService service;

    @GetMapping
    public ResponseEntity<List<ApiBehaviourBaselineItemDto>> list(
            @PathVariable UUID projectId,
            @RequestParam UUID baselineId) {
        return ResponseEntity.ok(service.listByBaseline(baselineId));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiBehaviourBaselineItemDto> get(
            @PathVariable UUID projectId,
            @PathVariable UUID id) {
        return ResponseEntity.ok(service.get(id));
    }

    @PostMapping
    public ResponseEntity<ApiBehaviourBaselineItemDto> create(
            @PathVariable UUID projectId,
            @RequestBody CreateApiBehaviourBaselineItemRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(request));
    }

    @PatchMapping("/{id}")
    public ResponseEntity<ApiBehaviourBaselineItemDto> update(
            @PathVariable UUID projectId,
            @PathVariable UUID id,
            @RequestBody UpdateApiBehaviourBaselineItemRequest request) {
        return ResponseEntity.ok(service.update(id, request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID projectId,
            @PathVariable UUID id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
