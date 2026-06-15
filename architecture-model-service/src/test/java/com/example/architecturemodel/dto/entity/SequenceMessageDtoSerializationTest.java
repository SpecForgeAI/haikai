package com.example.architecturemodel.dto.entity;

import com.example.architecturemodel.model.dto.entity.SequenceMessageDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for SequenceMessageDto JSON serialization with the is_collection field
 * and endpoint display fields.
 *
 * Spec: Sequence Diagram Message Exchange Collection Entity Display
 * Spec: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response
 */
class SequenceMessageDtoSerializationTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        // Configure ObjectMapper to match production configuration from application.yml
        objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
    }

    @Test
    @DisplayName("SequenceMessageDto serializes is_collection field correctly when true")
    void sequenceMessageDto_shouldSerializeIsCollectionTrue() throws Exception {
        // Arrange
        SequenceMessageDto dto = new SequenceMessageDto(
            "msg-1",
            "exchange-1",
            "Request",
            "participant-1",
            "participant-2",
            "PhysicalEntity",
            "entity-1",
            null,
            true,
            null, null, null, null
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert - verify snake_case field name is_collection with value true
        assertThat(json).contains("\"is_collection\":true");
        // Verify other fields are present
        assertThat(json).contains("\"id\":\"msg-1\"");
        assertThat(json).contains("\"exchange_id\":\"exchange-1\"");
        assertThat(json).contains("\"ref_kind\":\"PhysicalEntity\"");
    }

    @Test
    @DisplayName("SequenceMessageDto deserializes with is_collection explicitly null (backward compatibility)")
    void sequenceMessageDto_shouldDeserializeWithIsCollectionNull() throws Exception {
        // Arrange - JSON with is_collection set to null
        String json = """
            {
                "id": "msg-1",
                "exchange_id": "exchange-1",
                "exchange_role": "Request",
                "from_participant_id": "participant-1",
                "to_participant_id": "participant-2",
                "ref_kind": "PhysicalEntity",
                "ref_id": "entity-1",
                "label_text": null,
                "is_collection": null
            }
            """;

        // Act
        SequenceMessageDto result = objectMapper.readValue(json, SequenceMessageDto.class);

        // Assert - isCollection should be null when explicitly set to null
        assertThat(result.id()).isEqualTo("msg-1");
        assertThat(result.exchangeId()).isEqualTo("exchange-1");
        assertThat(result.refKind()).isEqualTo("PhysicalEntity");
        assertThat(result.isCollection()).isNull();
    }

    @Test
    @DisplayName("SequenceMessageDto deserializes with missing is_collection field (backward compatibility)")
    void sequenceMessageDto_shouldDeserializeWithMissingIsCollection() throws Exception {
        // Arrange - JSON without is_collection field (backward compatibility for existing data)
        String json = """
            {
                "id": "msg-1",
                "exchange_id": "exchange-1",
                "exchange_role": "Request",
                "from_participant_id": "participant-1",
                "to_participant_id": "participant-2",
                "ref_kind": "PhysicalEntity",
                "ref_id": "entity-1"
            }
            """;

        // Act
        SequenceMessageDto result = objectMapper.readValue(json, SequenceMessageDto.class);

        // Assert - isCollection should be null when not present (frontend handles default as false)
        assertThat(result.id()).isEqualTo("msg-1");
        assertThat(result.exchangeId()).isEqualTo("exchange-1");
        assertThat(result.refKind()).isEqualTo("PhysicalEntity");
        assertThat(result.refId()).isEqualTo("entity-1");
        assertThat(result.isCollection()).isNull();
    }

    @Test
    @DisplayName("SequenceMessageDto serializes/deserializes 4 endpoint display fields with correct JSON property names")
    void sequenceMessageDto_shouldSerializeAndDeserializeEndpointDisplayFields() throws Exception {
        // Arrange
        SequenceMessageDto dto = new SequenceMessageDto(
            "msg-ep-1",
            "exchange-ep",
            "Request",
            "p1",
            "p2",
            "InterfaceEndpoint",
            "endpoint-1",
            null,
            null,
            true,
            true,
            false,
            "endpoint_response"
        );

        // Act - serialize
        String json = objectMapper.writeValueAsString(dto);

        // Assert - verify snake_case JSON property names
        assertThat(json).contains("\"show_endpoint_name\":true");
        assertThat(json).contains("\"show_endpoint_verb_path\":true");
        assertThat(json).contains("\"show_endpoint_req_res_data\":false");
        assertThat(json).contains("\"response_mode\":\"endpoint_response\"");

        // Act - deserialize
        SequenceMessageDto deserialized = objectMapper.readValue(json, SequenceMessageDto.class);

        // Assert - round-trip
        assertThat(deserialized.showEndpointName()).isTrue();
        assertThat(deserialized.showEndpointVerbPath()).isTrue();
        assertThat(deserialized.showEndpointReqResData()).isFalse();
        assertThat(deserialized.responseMode()).isEqualTo("endpoint_response");
    }

    @Test
    @DisplayName("SequenceMessageDto deserializes with missing endpoint display fields (backward compatibility)")
    void sequenceMessageDto_shouldDeserializeWithMissingEndpointDisplayFields() throws Exception {
        // Arrange - JSON without endpoint display fields (old data)
        String json = """
            {
                "id": "msg-old",
                "exchange_id": "exchange-old",
                "exchange_role": "Request",
                "from_participant_id": "p1",
                "to_participant_id": "p2",
                "ref_kind": "InterfaceEndpoint",
                "ref_id": "ep-1"
            }
            """;

        // Act
        SequenceMessageDto result = objectMapper.readValue(json, SequenceMessageDto.class);

        // Assert - all 4 new fields should be null when not present
        assertThat(result.showEndpointName()).isNull();
        assertThat(result.showEndpointVerbPath()).isNull();
        assertThat(result.showEndpointReqResData()).isNull();
        assertThat(result.responseMode()).isNull();
    }
}
