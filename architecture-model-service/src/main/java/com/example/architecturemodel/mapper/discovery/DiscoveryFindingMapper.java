package com.example.architecturemodel.mapper.discovery;

import com.example.architecturemodel.model.dto.discovery.DiscoveryFindingDto;
import com.example.architecturemodel.model.dto.discovery.DiscoveryFindingLinkDto;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingLinkEntity;

import java.util.List;

/**
 * Manual entity &lt;-&gt; DTO mappers for {@code discovery_findings} and
 * {@code discovery_finding_links}.
 *
 * <p>Static methods rather than a Spring bean -- matches the
 * {@code ApiBehaviourMapper} pattern (no MapStruct in the existing
 * {@code mapper/} package).</p>
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 2; extended by API Test Harness — Findings
 * Integration (2026-05-25) Task Group 1 to pass through the new
 * {@code apiBehaviourDiffId} field; normalized by Normalize Findings Review
 * Actions (Spec F, 2026-06-02) to map {@code reviewStatus} +
 * {@code previousReviewStatus}.</p>
 */
public final class DiscoveryFindingMapper {

    private DiscoveryFindingMapper() {
        // utility -- no instances
    }

    public static DiscoveryFindingLinkDto toDto(DiscoveryFindingLinkEntity entity) {
        if (entity == null) {
            return null;
        }
        return new DiscoveryFindingLinkDto(
            entity.getId(),
            entity.getFindingId(),
            entity.getLinkType(),
            entity.getTargetType(),
            entity.getTargetId(),
            entity.getLabel(),
            entity.getCreatedAt()
        );
    }

    /**
     * Map an entity to DTO with an externally-loaded links list. The link
     * collection is passed in (rather than lazily loaded off the entity)
     * because {@code DiscoveryFindingEntity} does not declare a
     * {@code @OneToMany} relationship -- we keep the lightweight FK-as-UUID
     * pattern used elsewhere in the discovery schema.
     */
    public static DiscoveryFindingDto toDto(
            DiscoveryFindingEntity entity,
            List<DiscoveryFindingLinkEntity> links) {
        if (entity == null) {
            return null;
        }
        List<DiscoveryFindingLinkDto> linkDtos = links == null ? List.of()
            : links.stream().map(DiscoveryFindingMapper::toDto).toList();
        return new DiscoveryFindingDto(
            entity.getId(),
            entity.getRunId(),
            entity.getApiBehaviourDiffId(),
            entity.getApiBehaviourCaptureSessionId(),
            entity.getProjectId(),
            entity.getArchitectureId(),
            entity.getFindingType(),
            entity.getCategory(),
            entity.getSeverity(),
            entity.getConfidence(),
            entity.getReviewStatus(),
            entity.getPreviousReviewStatus(),
            entity.getTitle(),
            entity.getSummary(),
            entity.getDetailJson(),
            entity.getSource(),
            entity.getCreatedByStage(),
            entity.getCreatedAt(),
            entity.getUpdatedAt(),
            entity.getReviewedAt(),
            entity.getReviewerNotes(),
            linkDtos
        );
    }

    /** Convenience overload for callers that don't need links. */
    public static DiscoveryFindingDto toDto(DiscoveryFindingEntity entity) {
        return toDto(entity, List.of());
    }
}
