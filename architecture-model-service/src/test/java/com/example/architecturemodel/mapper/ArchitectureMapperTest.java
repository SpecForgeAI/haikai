package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.ArchitectureTagEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for ArchitectureMapper.
 *
 * Pins the wire-shape contract for ArchitectureDto, including the
 * Target-Architecture-Authoring-Flow additions ({@code kind} and
 * {@code draftState}) which were previously not surfaced on the DTO.
 *
 * Spec: Multi-Architecture Plumbing (Spec #1)
 * Extended: Target Architecture Authoring Flow (2026-05-20)
 */
class ArchitectureMapperTest {

    private ArchitectureMapper mapper;

    @BeforeEach
    void setUp() {
        mapper = new ArchitectureMapper();
    }

    @Test
    @DisplayName("toDto populates kind and draftState from the entity")
    void toDto_populatesKindAndDraftState() {
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        Instant createdAt = Instant.parse("2026-05-20T08:00:00Z");
        Instant updatedAt = Instant.parse("2026-05-20T09:00:00Z");

        ArchitectureEntity entity = ArchitectureEntity.builder()
            .id(id)
            .projectId(projectId)
            .name("Draft target")
            .description("A target draft")
            .archived(false)
            .draftState("draft")
            .kind("target")
            .createdAt(createdAt)
            .updatedAt(updatedAt)
            .build();

        ArchitectureDto dto = mapper.toDto(entity, List.of());

        assertThat(dto).isNotNull();
        assertThat(dto.id()).isEqualTo(id);
        assertThat(dto.projectId()).isEqualTo(projectId);
        assertThat(dto.name()).isEqualTo("Draft target");
        assertThat(dto.description()).isEqualTo("A target draft");
        assertThat(dto.archived()).isFalse();
        assertThat(dto.kind()).isEqualTo("target");
        assertThat(dto.draftState()).isEqualTo("draft");
        assertThat(dto.createdAt()).isEqualTo(createdAt);
        assertThat(dto.updatedAt()).isEqualTo(updatedAt);
    }

    @Test
    @DisplayName("toDto preserves the canonical 'current'/'active' defaults from the entity")
    void toDto_preservesCurrentActiveDefaults() {
        ArchitectureEntity entity = ArchitectureEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .name("Default")
            .archived(false)
            .build();

        ArchitectureDto dto = mapper.toDto(entity, null);

        // The entity's @Builder.Default + @PrePersist defaulter keeps the
        // current/active discriminators on rows that don't explicitly set
        // them; the DTO must surface those defaults verbatim.
        assertThat(dto.kind()).isEqualTo("current");
        assertThat(dto.draftState()).isEqualTo("active");
        assertThat(dto.tags()).isEmpty();
    }

    @Test
    @DisplayName("toDto returns null when the entity is null")
    void toDto_returnsNullForNullEntity() {
        ArchitectureDto dto = mapper.toDto(null, null);

        assertThat(dto).isNull();
    }

    @Test
    @DisplayName("toDto maps tag rows to a flat list of tag values")
    void toDto_mapsTagsToFlatList() {
        ArchitectureEntity entity = ArchitectureEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .name("Tagged")
            .archived(false)
            .build();

        ArchitectureTagEntity tag1 = ArchitectureTagEntity.builder()
            .architectureId(entity.getId())
            .tagValue("imported-target")
            .build();
        ArchitectureTagEntity tag2 = ArchitectureTagEntity.builder()
            .architectureId(entity.getId())
            .tagValue("v1")
            .build();

        ArchitectureDto dto = mapper.toDto(entity, List.of(tag1, tag2));

        assertThat(dto.tags()).containsExactly("imported-target", "v1");
    }

    @Test
    @DisplayName("Backward-compatible 8-arg constructor defaults kind and draftState to null")
    void backwardCompatibleConstructor_defaultsNewFieldsToNull() {
        ArchitectureDto dto = new ArchitectureDto(
            UUID.randomUUID(),
            UUID.randomUUID(),
            "Legacy caller",
            "Built via 8-arg ctor",
            List.of(),
            false,
            Instant.parse("2026-05-20T08:00:00Z"),
            Instant.parse("2026-05-20T09:00:00Z")
        );

        // Existing test fixtures + legacy callers continue to compile via the
        // 8-arg overload; the two new fields default to null so the wire
        // round-trip is unambiguous.
        assertThat(dto.kind()).isNull();
        assertThat(dto.draftState()).isNull();
    }
}
