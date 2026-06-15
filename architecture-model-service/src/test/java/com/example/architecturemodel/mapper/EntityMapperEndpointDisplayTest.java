package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.entity.SequenceMessageDto;
import com.example.architecturemodel.model.entity.SequenceMessageEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for EntityMapper methods mapping the 4 new endpoint display fields
 * on SequenceMessageEntity/SequenceMessageDto.
 *
 * Spec: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response
 * Task Group 2: Entity, DTO, Mapper, and Validation
 */
class EntityMapperEndpointDisplayTest {

    private EntityMapper entityMapper;

    @BeforeEach
    void setUp() {
        entityMapper = new EntityMapper();
    }

    // ============================================================================
    // Test: toDto maps all 4 endpoint display fields correctly
    // ============================================================================

    @Test
    @DisplayName("toDto(SequenceMessageEntity) maps all 4 endpoint display fields correctly")
    void toDto_shouldMapAllEndpointDisplayFields() {
        // Given
        SequenceMessageEntity entity = SequenceMessageEntity.builder()
            .id("msg-1")
            .sequenceDiagramId("diag-1")
            .exchangeId("exc-1")
            .exchangeRole("Request")
            .fromParticipantId("p1")
            .toParticipantId("p2")
            .refKind("InterfaceEndpoint")
            .refId("ep-1")
            .labelText(null)
            .showEndpointName(true)
            .showEndpointVerbPath(false)
            .showEndpointReqResData(true)
            .responseMode("endpoint_response")
            .build();

        // When
        SequenceMessageDto dto = entityMapper.toDto(entity);

        // Then
        assertThat(dto.showEndpointName()).isTrue();
        assertThat(dto.showEndpointVerbPath()).isFalse();
        assertThat(dto.showEndpointReqResData()).isTrue();
        assertThat(dto.responseMode()).isEqualTo("endpoint_response");
        // Verify other fields still mapped
        assertThat(dto.id()).isEqualTo("msg-1");
        assertThat(dto.refKind()).isEqualTo("InterfaceEndpoint");
    }

    // ============================================================================
    // Test: toEntity maps all 4 endpoint display fields correctly
    // ============================================================================

    @Test
    @DisplayName("toEntity(SequenceMessageDto) maps all 4 endpoint display fields correctly")
    void toEntity_shouldMapAllEndpointDisplayFields() {
        // Given
        SequenceMessageDto dto = new SequenceMessageDto(
            "msg-2",
            "exc-2",
            "Response",
            "p1",
            "p2",
            "InterfaceEndpoint",
            "ep-2",
            null,
            null,
            false,
            true,
            true,
            "normal"
        );

        // When
        SequenceMessageEntity entity = entityMapper.toEntity(dto, "diag-2");

        // Then
        assertThat(entity.getShowEndpointName()).isFalse();
        assertThat(entity.getShowEndpointVerbPath()).isTrue();
        assertThat(entity.getShowEndpointReqResData()).isTrue();
        assertThat(entity.getResponseMode()).isEqualTo("normal");
        // Verify other fields still mapped
        assertThat(entity.getId()).isEqualTo("msg-2");
        assertThat(entity.getSequenceDiagramId()).isEqualTo("diag-2");
        assertThat(entity.getRefKind()).isEqualTo("InterfaceEndpoint");
    }

    // ============================================================================
    // Test: toDto maps null endpoint display fields (backward compatibility)
    // ============================================================================

    @Test
    @DisplayName("toDto(SequenceMessageEntity) maps null endpoint display fields for legacy data")
    void toDto_shouldMapNullEndpointDisplayFields() {
        // Given - entity with null values for all 4 new fields (legacy data)
        SequenceMessageEntity entity = SequenceMessageEntity.builder()
            .id("msg-legacy")
            .sequenceDiagramId("diag-1")
            .exchangeId("exc-1")
            .exchangeRole("Request")
            .fromParticipantId("p1")
            .toParticipantId("p2")
            .refKind("Method")
            .refId("method-1")
            .labelText(null)
            .showEndpointName(null)
            .showEndpointVerbPath(null)
            .showEndpointReqResData(null)
            .responseMode(null)
            .build();

        // When
        SequenceMessageDto dto = entityMapper.toDto(entity);

        // Then - null values pass through
        assertThat(dto.showEndpointName()).isNull();
        assertThat(dto.showEndpointVerbPath()).isNull();
        assertThat(dto.showEndpointReqResData()).isNull();
        assertThat(dto.responseMode()).isNull();
    }
}
