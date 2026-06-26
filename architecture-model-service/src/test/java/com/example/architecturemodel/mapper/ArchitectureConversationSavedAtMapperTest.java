package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Pins the {@code conversationSavedAt} save-marker contract on
 * {@link ArchitectureMapper} / {@link ArchitectureDto}.
 *
 * <p>Spec: Target-State Conversation -- Save, Resume, and Plan Sourcing
 * Decoupled from "Active" (2026-06-26) -- Task Group 1 (FR1). The DTO surfaces
 * the new column so {@code listTargets} carries the saved indicator/timestamp;
 * the marker is null until the first save and a stamped instant round-trips.</p>
 */
class ArchitectureConversationSavedAtMapperTest {

    private ArchitectureMapper mapper;

    @BeforeEach
    void setUp() {
        mapper = new ArchitectureMapper();
    }

    @Test
    @DisplayName("toDto maps a null conversationSavedAt (never saved) through to a null DTO field")
    void toDto_nullMarker_mapsToNull() {
        ArchitectureEntity entity = ArchitectureEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .name("Unsaved target draft")
            .kind("target")
            .draftState("draft")
            .conversationSavedAt(null)
            .build();

        ArchitectureDto dto = mapper.toDto(entity, List.of());

        assertThat(dto).isNotNull();
        assertThat(dto.conversationSavedAt()).isNull();
    }

    @Test
    @DisplayName("toDto round-trips a stamped conversationSavedAt instant onto the DTO")
    void toDto_stampedMarker_roundTrips() {
        Instant savedAt = Instant.parse("2026-06-26T10:00:00Z");
        ArchitectureEntity entity = ArchitectureEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .name("Saved target conversation")
            .kind("target")
            .draftState("draft")
            .conversationSavedAt(savedAt)
            .build();

        ArchitectureDto dto = mapper.toDto(entity, List.of());

        assertThat(dto.conversationSavedAt()).isEqualTo(savedAt);
    }

    @Test
    @DisplayName("the pre-marker 11-arg compatibility constructor defaults conversationSavedAt to null")
    void elevenArgConstructor_defaultsMarkerToNull() {
        ArchitectureDto dto = new ArchitectureDto(
            UUID.randomUUID(),
            UUID.randomUUID(),
            "Legacy 11-arg caller",
            "Built via the pre-marker canonical signature",
            List.of(),
            false,
            "target",
            "draft",
            Instant.parse("2026-06-26T08:00:00Z"),
            Instant.parse("2026-06-26T09:00:00Z"),
            7L
        );

        assertThat(dto.elementCount()).isEqualTo(7L);
        assertThat(dto.conversationSavedAt()).isNull();
    }
}
