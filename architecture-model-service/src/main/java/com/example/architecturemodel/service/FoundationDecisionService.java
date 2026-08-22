package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.FoundationDecisionDto;
import com.example.architecturemodel.model.entity.FoundationDecisionEntity;
import com.example.architecturemodel.repository.FoundationDecisionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Foundation adjudication facts (Foundations &amp; Scope program, Spec 1,
 * 2026-08-22). Semantics:
 *
 * <ul>
 *   <li>Bulk UPSERT keyed by (project, architecture, decision_key) —
 *       answering a question again REVISES the same decision (clears
 *       {@code stale}) rather than duplicating it.</li>
 *   <li>Decisions are never deleted by upserts; deletion is an explicit
 *       operator action only (not exposed in this service).</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class FoundationDecisionService {

    private final FoundationDecisionRepository repository;

    @Transactional(readOnly = true)
    public List<FoundationDecisionDto> list(String projectId, String architectureId) {
        return repository
            .findByProjectIdAndArchitectureIdOrderByDecisionKeyAsc(projectId, architectureId)
            .stream()
            .map(this::toDto)
            .toList();
    }

    @Transactional
    public List<FoundationDecisionDto> upsertAll(
            String projectId, String architectureId, List<FoundationDecisionDto> decisions) {
        List<FoundationDecisionDto> out = new ArrayList<>();
        Instant now = Instant.now();
        for (FoundationDecisionDto dto : decisions) {
            if (dto.decisionKey() == null || dto.decisionKey().isBlank()) {
                throw new IllegalArgumentException("decision_key is required");
            }
            if (dto.answer() == null || dto.answer().isBlank()) {
                throw new IllegalArgumentException(
                    "answer is required for decision " + dto.decisionKey());
            }
            FoundationDecisionEntity entity = repository
                .findByProjectIdAndArchitectureIdAndDecisionKey(
                    projectId, architectureId, dto.decisionKey())
                .orElseGet(() -> FoundationDecisionEntity.builder()
                    .id(UUID.randomUUID().toString())
                    .projectId(projectId)
                    .architectureId(architectureId)
                    .decisionKey(dto.decisionKey())
                    .createdAt(now)
                    .build());
            entity.setRuleKey(dto.ruleKey() != null ? dto.ruleKey() : entity.getRuleKey());
            entity.setQuestionText(
                dto.questionText() != null ? dto.questionText() : entity.getQuestionText());
            entity.setAnswer(dto.answer());
            entity.setScope(dto.scope());
            entity.setTargetsJson(dto.targetsJson() != null ? dto.targetsJson() : List.of());
            entity.setPayloadJson(dto.payloadJson());
            entity.setRationale(dto.rationale());
            entity.setEvidenceHash(dto.evidenceHash());
            // Re-answering clears staleness (the operator has re-adjudicated).
            entity.setStale(Boolean.TRUE.equals(dto.stale()));
            entity.setDecidedAt(now);
            entity.setUpdatedAt(now);
            out.add(toDto(repository.save(entity)));
        }
        log.info("[foundation-decisions] upserted {} decision(s) for {}/{}",
            out.size(), projectId, architectureId);
        return out;
    }

    private FoundationDecisionDto toDto(FoundationDecisionEntity e) {
        return new FoundationDecisionDto(
            e.getId(),
            e.getProjectId(),
            e.getArchitectureId(),
            e.getDecisionKey(),
            e.getRuleKey(),
            e.getQuestionText(),
            e.getAnswer(),
            e.getScope(),
            e.getTargetsJson(),
            e.getPayloadJson(),
            e.getRationale(),
            e.getEvidenceHash(),
            e.isStale(),
            e.getDecidedAt() != null ? e.getDecidedAt().toString() : null,
            e.getCreatedAt() != null ? e.getCreatedAt().toString() : null,
            e.getUpdatedAt() != null ? e.getUpdatedAt().toString() : null
        );
    }
}
