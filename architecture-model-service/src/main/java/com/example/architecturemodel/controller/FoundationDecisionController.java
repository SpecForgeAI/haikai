package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.FoundationDecisionDto;
import com.example.architecturemodel.service.FoundationDecisionService;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Foundation decisions REST surface (Foundations &amp; Scope program,
 * Spec 1, 2026-08-22).
 *
 * <pre>
 *   GET /api/projects/{p}/architectures/{a}/foundation-decisions
 *   PUT /api/projects/{p}/architectures/{a}/foundation-decisions
 *       body { "decisions": [ FoundationDecisionDto... ] }  — bulk upsert
 *       keyed by decision_key (revising clears `stale`).
 * </pre>
 *
 * snake_case wire (AMS global). Consumers: gateway proxies, the MCP
 * apply_foundation_decisions tool, the frontend Foundations panel.
 */
@RestController
@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/foundation-decisions")
@RequiredArgsConstructor
// No-db mode (app.features.include-database=false) runs without JPA
// repositories; every DB-backed controller carries this guard (2026-08-24
// sweep).
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class FoundationDecisionController {

    private final FoundationDecisionService service;

    public record UpsertRequest(
        @JsonProperty("decisions") List<FoundationDecisionDto> decisions
    ) {}

    @GetMapping
    public ResponseEntity<List<FoundationDecisionDto>> list(
            @PathVariable String projectId,
            @PathVariable String architectureId) {
        return ResponseEntity.ok(service.list(projectId, architectureId));
    }

    @PutMapping
    public ResponseEntity<?> upsert(
            @PathVariable String projectId,
            @PathVariable String architectureId,
            @RequestBody UpsertRequest request) {
        if (request == null || request.decisions() == null || request.decisions().isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "decisions must be a non-empty array"));
        }
        try {
            return ResponseEntity.ok(
                service.upsertAll(projectId, architectureId, request.decisions()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
