package com.example.architecturemodel.mapper.discovery;

import com.example.architecturemodel.model.dto.discovery.EndpointDataEffectDto;
import com.example.architecturemodel.model.entity.discovery.EndpointDataEffectEntity;

/**
 * Manual entity &lt;-&gt; DTO mapper for {@code endpoint_data_effects}.
 *
 * <p>Static methods rather than a Spring bean -- matches the
 * {@code DiscoveryFindingMapper} pattern (no MapStruct in the existing
 * {@code mapper/} package). The structured {@code path_metadata_json} payload
 * is carried through as a passthrough {@code Map} (no field loss), and the
 * boxed {@code confidence} is preserved as-is (PATCH-safe).</p>
 *
 * <p>Spec: Endpoint&rarr;Data-Effect Call Graph for Discovery
 * (2026-05-29) -- Task Group 1.</p>
 */
public final class EndpointDataEffectMapper {

    private EndpointDataEffectMapper() {
        // utility -- no instances
    }

    public static EndpointDataEffectDto toDto(EndpointDataEffectEntity entity) {
        if (entity == null) {
            return null;
        }
        return new EndpointDataEffectDto(
            entity.getId(),
            entity.getEndpointId(),
            entity.getDataEntityPointId(),
            entity.getAccessMode(),
            entity.getPathMetadataJson(),
            entity.getConfidence(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo()
        );
    }

    public static EndpointDataEffectEntity toEntity(EndpointDataEffectDto dto, String modelFileId) {
        if (dto == null) {
            return null;
        }
        return EndpointDataEffectEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .endpointId(dto.endpointId())
            .dataEntityPointId(dto.dataEntityPointId())
            .accessMode(dto.accessMode())
            .pathMetadataJson(dto.pathMetadataJson())
            .confidence(dto.confidence())
            .description(dto.description())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
    }
}
