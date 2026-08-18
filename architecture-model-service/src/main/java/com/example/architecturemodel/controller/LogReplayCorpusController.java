package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.LogReplayCorpusCreateRequest;
import com.example.architecturemodel.model.dto.LogReplayCorpusDto;
import com.example.architecturemodel.model.dto.LogReplayCorpusItemDto;
import com.example.architecturemodel.service.LogReplayCorpusService;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * REST Controller for the log-replay corpus (Spec 5, 2026-08-18).
 *
 * The discovery-service extractor POSTs a whole staged corpus atomically;
 * the round-2 replay machinery and the wizard read it back. Funnel + request
 * payloads are OPAQUE — persisted and served verbatim.
 *
 * Error mapping matches {@link SclCorpusController}:
 * {@link ResourceNotFoundException} -&gt; 404,
 * {@link IllegalArgumentException} -&gt; 400 with {@code {"error": message}}.
 *
 * Base path:
 * /api/model/projects/{projectId}/architectures/{architectureId}/log-replay-corpus
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/log-replay-corpus")
@RequiredArgsConstructor
@Slf4j
public class LogReplayCorpusController {

    private final LogReplayCorpusService service;

    /** POST … — create a corpus WITH its items atomically. 201 Created. */
    @PostMapping
    public ResponseEntity<LogReplayCorpusDto> create(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody LogReplayCorpusCreateRequest request) {
        log.debug("POST /api/model/projects/{}/architectures/{}/log-replay-corpus items={}",
            projectId, architectureId,
            request == null || request.items() == null ? 0 : request.items().size());
        LogReplayCorpusDto created = service.create(projectId, architectureId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /** GET … — corpus history for the pair, newest first. */
    @GetMapping
    public ResponseEntity<List<LogReplayCorpusDto>> list(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        return ResponseEntity.ok(service.list(projectId, architectureId));
    }

    /** GET …/latest — the most recent corpus, or 404 when none exists. */
    @GetMapping("/latest")
    public ResponseEntity<LogReplayCorpusDto> latest(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        return service.latest(projectId, architectureId)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /** GET …/{corpusId}/items — the corpus items in deterministic order. */
    @GetMapping("/{corpusId}/items")
    public ResponseEntity<List<LogReplayCorpusItemDto>> items(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID corpusId) {
        return ResponseEntity.ok(service.items(corpusId));
    }

    /** PATCH …/{corpusId} — status advance ({@code {"status": "…"}}). */
    @PatchMapping("/{corpusId}")
    public ResponseEntity<LogReplayCorpusDto> patch(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID corpusId,
            @RequestBody StatusPatch body) {
        return ResponseEntity.ok(service.patchStatus(corpusId, body == null ? null : body.status()));
    }

    /** Status-patch wire body. */
    public record StatusPatch(@JsonProperty("status") String status) {}

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleNotFound(ResourceNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> handleBadRequest(IllegalArgumentException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(Map.of("error", ex.getMessage()));
    }
}
