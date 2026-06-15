package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryDecisionTaskDto;
import com.example.architecturemodel.service.DiscoveryDecisionTaskService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.UUID;

/**
 * REST Controller for Discovery Decision Task endpoints.
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 *
 * Base path: /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/decision-tasks
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/decision-tasks")
@RequiredArgsConstructor
@Slf4j
public class DiscoveryDecisionTaskController {

    private final DiscoveryDecisionTaskService discoveryDecisionTaskService;

    @PostMapping
    public ResponseEntity<?> bulkInsert(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestBody List<DiscoveryDecisionTaskDto> tasks) {
        log.debug("POST /api/model/projects/{}/architectures/{}/discovery/runs/{}/decision-tasks - {} tasks",
            projectId, architectureId, runId, tasks.size());

        try {
            List<DiscoveryDecisionTaskDto> result = discoveryDecisionTaskService.bulkCreateInArchitecture(
                runId, projectId, architectureId, tasks);
            return ResponseEntity.ok(result);
        } catch (NoSuchElementException e) {
            log.warn("Run not found in architecture for decision-task insert: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad request bulk inserting decision tasks for run {}: {}", runId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping
    public ResponseEntity<?> listDecisionTasks(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String taskType) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/runs/{}/decision-tasks?status={}&taskType={}",
            projectId, architectureId, runId, status, taskType);

        try {
            List<DiscoveryDecisionTaskDto> tasks = discoveryDecisionTaskService.getByRunIdInArchitecture(
                runId, projectId, architectureId, status, taskType);
            return ResponseEntity.ok(tasks);
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for decision-task list: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        }
    }

    @GetMapping("/count")
    public ResponseEntity<?> countDecisionTasks(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestParam(required = false) String status) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/runs/{}/decision-tasks/count?status={}",
            projectId, architectureId, runId, status);

        try {
            long count = discoveryDecisionTaskService.countByRunIdInArchitecture(
                runId, projectId, architectureId, status);
            return ResponseEntity.ok(Map.of("count", count));
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for decision-task count: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        }
    }

    @PutMapping("/{taskId}")
    public ResponseEntity<?> updateDecisionTask(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @PathVariable UUID taskId,
            @RequestBody DiscoveryDecisionTaskDto update) {
        log.debug("PUT /api/model/projects/{}/architectures/{}/discovery/runs/{}/decision-tasks/{}",
            projectId, architectureId, runId, taskId);

        try {
            DiscoveryDecisionTaskDto result = discoveryDecisionTaskService.updateTaskInArchitecture(
                runId, projectId, architectureId, taskId, update);
            return ResponseEntity.ok(result);
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for decision-task update: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad request updating decision task {} for run {}: {}", taskId, runId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
