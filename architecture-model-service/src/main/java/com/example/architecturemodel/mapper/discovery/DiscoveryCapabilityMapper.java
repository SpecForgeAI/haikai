package com.example.architecturemodel.mapper.discovery;

import com.example.architecturemodel.model.dto.discovery.CreateDiscoveryCapabilityRequest;
import com.example.architecturemodel.model.dto.discovery.DiscoveryCapabilityDto;
import com.example.architecturemodel.model.dto.discovery.DiscoveryCapabilityMemberDto;
import com.example.architecturemodel.model.entity.discovery.DiscoveryCapabilityEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryCapabilityMemberEntity;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Mapper utility for {@link DiscoveryCapabilityEntity} /
 * {@link DiscoveryCapabilityMemberEntity} &lt;-&gt; their DTOs (Liquibase
 * changeset 184).
 *
 * <p>Static helper class to match the established AMS pattern (see
 * {@code MigrationReconciliationBreakMapper} / {@code DiscoveryFindingMapper}).
 * No MapStruct; the DTOs are records.</p>
 *
 * <p><b>PATCH semantics</b> live in
 * {@link #updateEntityFromDto(DiscoveryCapabilityEntity, DiscoveryCapabilityDto)}.
 * Every editable field on the DTO is null-guarded so an omitted JSON property
 * never silently wipes the column (the canonical
 * {@code project_primitive_double_dto_overwrite.md} pattern -- all DTO fields are
 * boxed reference types so a missing field arrives as {@code null}). This is the
 * load-bearing guard so a PATCH that touches (say) only {@code summary} must
 * leave the boxed {@link Double} {@code confidence} -- and the JSONB
 * {@code detailJson} and the members -- intact.</p>
 *
 * <p>NOTE: {@code reviewStatus} / {@code previousReviewStatus} are NOT mutated by
 * {@code updateEntityFromDto}; the review transition (which records the prior
 * value into {@code previous_review_status}) is owned by the service's
 * patch-review path, not the generic PATCH.</p>
 *
 * <p>Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6)
 * -- Task Group 1.</p>
 */
public final class DiscoveryCapabilityMapper {

    private DiscoveryCapabilityMapper() {
        // Utility class - prevent instantiation
    }

    /**
     * Convert a capability entity into its DTO wire shape WITHOUT members
     * (members null). Timestamps are emitted as ISO-8601 strings.
     *
     * @param entity the entity to convert; {@code null} returns {@code null}
     * @return the DTO representation (members null)
     */
    public static DiscoveryCapabilityDto toDto(DiscoveryCapabilityEntity entity) {
        return toDto(entity, null);
    }

    /**
     * Convert a capability entity into its DTO wire shape with the supplied
     * members embedded.
     *
     * @param entity  the entity to convert; {@code null} returns {@code null}
     * @param members the members to embed (may be {@code null})
     * @return the DTO representation
     */
    public static DiscoveryCapabilityDto toDto(
            DiscoveryCapabilityEntity entity,
            List<DiscoveryCapabilityMemberDto> members) {
        if (entity == null) {
            return null;
        }
        return new DiscoveryCapabilityDto(
            entity.getId(),
            entity.getRunId(),
            entity.getProjectId(),
            entity.getArchitectureId(),
            entity.getName(),
            entity.getKind(),
            entity.getSummary(),
            entity.getReviewStatus(),
            entity.getPreviousReviewStatus(),
            entity.getConfidence(),
            entity.getDetailJson(),
            entity.getSource(),
            entity.getCreatedByStage(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getUpdatedAt() != null ? entity.getUpdatedAt().toString() : null,
            members
        );
    }

    /** Convert a member entity into its DTO wire shape. */
    public static DiscoveryCapabilityMemberDto toMemberDto(DiscoveryCapabilityMemberEntity entity) {
        if (entity == null) {
            return null;
        }
        return new DiscoveryCapabilityMemberDto(
            entity.getId(),
            entity.getCapabilityId(),
            entity.getMemberType(),
            entity.getMemberId(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null
        );
    }

    /**
     * Build a fresh {@link DiscoveryCapabilityEntity} from a create request,
     * bound to the supplied {@code projectId} / {@code architectureId} /
     * {@code runId} (taken from the create context, never the body). A capability
     * is born {@code pending_review} unless overridden by the review path.
     *
     * @param request        the create request
     * @param projectId      the owning project UUID (from the URL path)
     * @param architectureId the owning architecture UUID (from the URL path)
     * @param runId          the synthesising run UUID (from the URL path)
     * @return a fresh, unsaved entity ready for INSERT
     */
    public static DiscoveryCapabilityEntity toNewEntity(
            CreateDiscoveryCapabilityRequest request,
            UUID projectId, UUID architectureId, UUID runId) {
        if (request == null) {
            return null;
        }
        Instant now = Instant.now();
        return DiscoveryCapabilityEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .projectId(projectId)
            .architectureId(architectureId)
            .name(request.name())
            .kind(request.kind())
            .summary(request.summary())
            .reviewStatus("pending_review")
            .previousReviewStatus(null)
            .confidence(request.confidence())
            .detailJson(request.detailJson())
            .source(request.source())
            .createdByStage(request.createdByStage())
            .createdAt(now)
            .updatedAt(now)
            .build();
    }

    /**
     * Build a fresh {@link DiscoveryCapabilityMemberEntity} from a member DTO,
     * bound to the supplied {@code capabilityId}.
     *
     * @param dto          the member DTO
     * @param capabilityId the owning capability UUID
     * @return a fresh, unsaved member entity ready for INSERT
     */
    public static DiscoveryCapabilityMemberEntity toNewMemberEntity(
            DiscoveryCapabilityMemberDto dto, UUID capabilityId) {
        if (dto == null) {
            return null;
        }
        return DiscoveryCapabilityMemberEntity.builder()
            .id(dto.id() != null ? dto.id() : UUID.randomUUID())
            .capabilityId(capabilityId)
            .memberType(dto.memberType())
            .memberId(dto.memberId())
            .createdAt(Instant.now())
            .build();
    }

    /**
     * Apply PATCH-style updates onto a loaded capability entity, null-guarding
     * every editable field. Omitted (null) DTO fields leave the existing column
     * untouched -- per {@code project_primitive_double_dto_overwrite.md}.
     *
     * <p>Editable fields: {@code name}, {@code kind}, {@code summary},
     * {@code confidence}, {@code detailJson}, {@code source},
     * {@code createdByStage}. NOT editable here: {@code id}, {@code runId},
     * {@code projectId}, {@code architectureId} (all set at create);
     * {@code reviewStatus} / {@code previousReviewStatus} (owned by the
     * patch-review path so the audit value is recorded); {@code createdAt} /
     * {@code updatedAt} (auto-managed by {@code @PreUpdate}). The members are
     * never mutated by a generic PATCH.</p>
     *
     * @param entity the existing entity loaded from the DB
     * @param dto    the PATCH DTO
     */
    public static void updateEntityFromDto(
            DiscoveryCapabilityEntity entity, DiscoveryCapabilityDto dto) {
        if (entity == null || dto == null) {
            return;
        }
        if (dto.name() != null) {
            entity.setName(dto.name());
        }
        if (dto.kind() != null) {
            entity.setKind(dto.kind());
        }
        if (dto.summary() != null) {
            entity.setSummary(dto.summary());
        }
        if (dto.confidence() != null) {
            entity.setConfidence(dto.confidence());
        }
        if (dto.detailJson() != null) {
            entity.setDetailJson(dto.detailJson());
        }
        if (dto.source() != null) {
            entity.setSource(dto.source());
        }
        if (dto.createdByStage() != null) {
            entity.setCreatedByStage(dto.createdByStage());
        }
    }
}
