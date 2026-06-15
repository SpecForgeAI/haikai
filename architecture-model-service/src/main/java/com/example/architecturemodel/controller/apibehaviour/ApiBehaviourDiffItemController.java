package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourDiffItemDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourDiffItemRequest;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourDiffItemService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * REST controller for {@code api_behaviour_diff_items}.
 *
 * <p>Nested under {@code /diffs/{diffId}/items} -- the parent diff is the
 * scoping resource. POST is consumed by {@code diffRunner.ts} (one row per
 * classified scenario); GET feeds the Drift report tab.</p>
 *
 * <p>Spec: API Test Harness — Diff Engine (2026-05-25) — Task Group 2</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/api-behaviour/diffs/{diffId}/items")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourDiffItemController {

    private final ApiBehaviourDiffItemService service;

    @GetMapping
    public ResponseEntity<List<ApiBehaviourDiffItemDto>> list(
            @PathVariable UUID projectId,
            @PathVariable UUID diffId) {
        return ResponseEntity.ok(service.listByDiffId(projectId, diffId));
    }

    @PostMapping
    public ResponseEntity<ApiBehaviourDiffItemDto> create(
            @PathVariable UUID projectId,
            @PathVariable UUID diffId,
            @RequestBody CreateApiBehaviourDiffItemRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(service.create(projectId, diffId, request));
    }

    @DeleteMapping
    public ResponseEntity<Void> deleteByDiff(
            @PathVariable UUID projectId,
            @PathVariable UUID diffId) {
        service.deleteByDiffId(projectId, diffId);
        return ResponseEntity.noContent().build();
    }
}
