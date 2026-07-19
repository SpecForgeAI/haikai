package com.example.architecturemodel.service.security;

import com.example.architecturemodel.model.dto.security.SecurityLinkingAliasDto;
import com.example.architecturemodel.model.dto.security.UpsertSecurityAliasesRequest;
import com.example.architecturemodel.model.entity.security.SecurityLinkingAliasEntity;
import com.example.architecturemodel.repository.security.SecurityLinkingAliasRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * The wizard's project-scoped value-match memory (Security health dashboard,
 * 2026-07-19, Spec 1 of 3): confirmed alias pairings are taught here and
 * auto-applied on subsequent uploads, so the value matcher becomes review-only
 * over time.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class SecurityAliasService {

    private static final String DEFAULT_LEVEL = "application";

    private final SecurityLinkingAliasRepository aliasRepository;

    @Transactional(readOnly = true)
    public List<SecurityLinkingAliasDto> list(UUID projectId, String level) {
        return aliasRepository
            .findByProjectIdAndLevel(projectId, normalizeLevel(level))
            .stream()
            .map(SecurityLinkingAliasDto::from)
            .toList();
    }

    /**
     * Batch upsert of taught pairings. Re-teaching an existing
     * {@code (level, alias_value)} updates the row (aliases are living memory,
     * not history). Blank alias values / entity ids are skipped.
     */
    @Transactional
    public List<SecurityLinkingAliasDto> upsert(UUID projectId,
                                                UpsertSecurityAliasesRequest request) {
        if (request == null || request.aliases() == null || request.aliases().isEmpty()) {
            return List.of();
        }
        String level = normalizeLevel(request.level());
        List<SecurityLinkingAliasDto> out = new ArrayList<>();
        for (UpsertSecurityAliasesRequest.AliasPair pair : request.aliases()) {
            if (pair == null
                || isBlank(pair.aliasValue())
                || isBlank(pair.entityId())) {
                continue;
            }
            String aliasValue = pair.aliasValue().trim();
            Optional<SecurityLinkingAliasEntity> existing =
                aliasRepository.findByProjectIdAndLevelAndAliasValue(projectId, level, aliasValue);
            SecurityLinkingAliasEntity entity = existing.orElseGet(() ->
                SecurityLinkingAliasEntity.builder()
                    .id(UUID.randomUUID())
                    .projectId(projectId)
                    .level(level)
                    .aliasValue(aliasValue)
                    .build());
            entity.setEntityId(pair.entityId().trim());
            entity.setEntityName(pair.entityName() == null ? null : pair.entityName().trim());
            out.add(SecurityLinkingAliasDto.from(aliasRepository.save(entity)));
        }
        log.debug("Security aliases: upserted {} pairings (project={}, level={})",
            out.size(), projectId, level);
        return out;
    }

    private static String normalizeLevel(String level) {
        return (level == null || level.isBlank()) ? DEFAULT_LEVEL : level.trim();
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
