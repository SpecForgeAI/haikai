package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.entity.SequenceMessageDto;
import com.example.architecturemodel.model.entity.SequenceMessageEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the isCollection field round-trip through EntityMapper.
 *
 * Spec: Fix SequenceMessage Entity Missing isCollection Field
 */
class EntityMapperIsCollectionTest {

    private EntityMapper entityMapper;

    @BeforeEach
    void setUp() {
        entityMapper = new EntityMapper();
    }

    @Test
    @DisplayName("toDto maps isCollection=true from entity to DTO")
    void toDto_shouldMapIsCollectionTrue() {
        SequenceMessageEntity entity = SequenceMessageEntity.builder()
            .id("msg-1")
            .sequenceDiagramId("diag-1")
            .exchangeId("exc-1")
            .exchangeRole("Request")
            .fromParticipantId("p1")
            .toParticipantId("p2")
            .labelText("Order")
            .isCollection(true)
            .build();

        SequenceMessageDto dto = entityMapper.toDto(entity);

        assertThat(dto.isCollection()).isTrue();
    }

    @Test
    @DisplayName("toDto maps isCollection=false (default) from entity to DTO")
    void toDto_shouldMapIsCollectionFalse() {
        SequenceMessageEntity entity = SequenceMessageEntity.builder()
            .id("msg-2")
            .sequenceDiagramId("diag-1")
            .exchangeId("exc-2")
            .exchangeRole("Request")
            .fromParticipantId("p1")
            .toParticipantId("p2")
            .labelText("Item")
            .isCollection(false)
            .build();

        SequenceMessageDto dto = entityMapper.toDto(entity);

        assertThat(dto.isCollection()).isFalse();
    }

    @Test
    @DisplayName("toEntity maps isCollection from DTO to entity")
    void toEntity_shouldMapIsCollectionFromDto() {
        SequenceMessageDto dto = new SequenceMessageDto(
            "msg-3",
            "exc-3",
            "Request",
            "p1",
            "p2",
            "LogicalDataEntity",
            "ref-1",
            "Order",
            true,
            null,
            null,
            null,
            null
        );

        SequenceMessageEntity entity = entityMapper.toEntity(dto, "diag-1");

        assertThat(entity.getIsCollection()).isTrue();
        assertThat(entity.getLabelText()).isEqualTo("Order");
    }
}
