package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.LogReplayCorpusCreateRequest;
import com.example.architecturemodel.model.dto.LogReplayCorpusDto;
import com.example.architecturemodel.model.dto.LogReplayCorpusItemDto;
import com.example.architecturemodel.model.entity.LogReplayCorpusEntity;
import com.example.architecturemodel.model.entity.LogReplayCorpusItemEntity;
import com.example.architecturemodel.repository.entity.LogReplayCorpusItemRepository;
import com.example.architecturemodel.repository.entity.LogReplayCorpusRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Service for the log-replay corpus persistence (Spec 5, 2026-08-18).
 *
 * A corpus is created ATOMICALLY with its items (one transaction): the
 * round-2 replay must never see a half-staged corpus. Funnel + request
 * payloads are OPAQUE JSON — persisted and served verbatim.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class LogReplayCorpusService {

    /** Allowed richness vocabulary (validated; anything else is a 400). */
    public static final Set<String> ALLOWED_RICHNESS = Set.of("url_only", "with_body");

    private final LogReplayCorpusRepository corpusRepository;
    private final LogReplayCorpusItemRepository itemRepository;

    @Transactional
    public LogReplayCorpusDto create(
            UUID projectId, UUID architectureId, LogReplayCorpusCreateRequest request) {
        if (request == null || request.items() == null || request.items().isEmpty()) {
            throw new IllegalArgumentException(
                "a log-replay corpus requires at least one item — an empty extraction "
                    + "is abandoned at the source, never persisted");
        }
        LogReplayCorpusEntity corpus = LogReplayCorpusEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .fileName(request.fileName())
            .status("staged")
            .funnelJson(request.funnelJson())
            .build();
        corpusRepository.save(corpus);

        for (LogReplayCorpusCreateRequest.Item item : request.items()) {
            if (item.method() == null || item.method().isBlank()) {
                throw new IllegalArgumentException("corpus item method is required");
            }
            if (item.concretePath() == null || item.concretePath().isBlank()) {
                throw new IllegalArgumentException("corpus item concrete_path is required");
            }
            String richness = item.richness() == null ? "" : item.richness();
            if (!ALLOWED_RICHNESS.contains(richness)) {
                throw new IllegalArgumentException(
                    "corpus item richness '" + richness + "' is not in " + ALLOWED_RICHNESS);
            }
            itemRepository.save(LogReplayCorpusItemEntity.builder()
                .id(UUID.randomUUID())
                .corpusId(corpus.getId())
                .projectId(projectId)
                .method(item.method().toUpperCase())
                .pathTemplate(item.pathTemplate() == null ? item.concretePath() : item.pathTemplate())
                .concretePath(item.concretePath())
                .requestJson(item.requestJson())
                .responseStatus(item.responseStatus())
                .occurrenceCount(item.occurrenceCount() == null ? 1 : item.occurrenceCount())
                .richness(richness)
                .matchedEndpointId(item.matchedEndpointId())
                .sourceFileName(item.sourceFileName())
                .lineNumber(item.lineNumber())
                .build());
        }
        log.info("log-replay corpus created: id={} items={} project={} arch={}",
            corpus.getId(), request.items().size(), projectId, architectureId);
        return toDto(corpus);
    }

    @Transactional(readOnly = true)
    public List<LogReplayCorpusDto> list(UUID projectId, UUID architectureId) {
        return corpusRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(projectId, architectureId)
            .stream()
            .map(this::toDto)
            .toList();
    }

    @Transactional(readOnly = true)
    public Optional<LogReplayCorpusDto> latest(UUID projectId, UUID architectureId) {
        return corpusRepository
            .findFirstByProjectIdAndArchitectureIdOrderByCreatedAtDesc(projectId, architectureId)
            .map(this::toDto);
    }

    @Transactional(readOnly = true)
    public List<LogReplayCorpusItemDto> items(UUID corpusId) {
        if (corpusRepository.findById(corpusId).isEmpty()) {
            throw new ResourceNotFoundException("log-replay corpus " + corpusId + " not found");
        }
        return itemRepository
            .findByCorpusIdOrderByMethodAscPathTemplateAscConcretePathAsc(corpusId)
            .stream()
            .map(this::toItemDto)
            .toList();
    }

    @Transactional
    public LogReplayCorpusDto patchStatus(UUID corpusId, String status) {
        if (status == null || status.isBlank()) {
            throw new IllegalArgumentException("status is required");
        }
        LogReplayCorpusEntity corpus = corpusRepository.findById(corpusId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "log-replay corpus " + corpusId + " not found"));
        corpus.setStatus(status);
        corpusRepository.save(corpus);
        return toDto(corpus);
    }

    private LogReplayCorpusDto toDto(LogReplayCorpusEntity e) {
        return new LogReplayCorpusDto(
            e.getId(),
            e.getProjectId(),
            e.getArchitectureId(),
            e.getFileName(),
            e.getStatus(),
            e.getFunnelJson(),
            itemRepository.countByCorpusId(e.getId()),
            e.getCreatedAt() == null ? null : e.getCreatedAt().toString(),
            e.getUpdatedAt() == null ? null : e.getUpdatedAt().toString()
        );
    }

    private LogReplayCorpusItemDto toItemDto(LogReplayCorpusItemEntity e) {
        return new LogReplayCorpusItemDto(
            e.getId(),
            e.getCorpusId(),
            e.getProjectId(),
            e.getMethod(),
            e.getPathTemplate(),
            e.getConcretePath(),
            e.getRequestJson(),
            e.getResponseStatus(),
            e.getOccurrenceCount(),
            e.getRichness(),
            e.getMatchedEndpointId(),
            e.getSourceFileName(),
            e.getLineNumber(),
            e.getCreatedAt() == null ? null : e.getCreatedAt().toString()
        );
    }
}
