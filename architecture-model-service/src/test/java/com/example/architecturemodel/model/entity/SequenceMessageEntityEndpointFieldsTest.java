package com.example.architecturemodel.model.entity;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit test verifying SequenceMessageEntity persists and retrieves the 4 new
 * endpoint display fields via builder/getters.
 *
 * Spec: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response
 * Task Group 2: Entity, DTO, Mapper, and Validation
 */
class SequenceMessageEntityEndpointFieldsTest {

    @Test
    @DisplayName("SequenceMessageEntity persists and retrieves 4 new endpoint display fields")
    void entity_shouldPersistAndRetrieveEndpointDisplayFields() {
        // Given - build entity with all 4 new fields
        SequenceMessageEntity entity = SequenceMessageEntity.builder()
            .id("msg-1")
            .sequenceDiagramId("diag-1")
            .exchangeId("exc-1")
            .exchangeRole("Request")
            .fromParticipantId("p1")
            .toParticipantId("p2")
            .refKind("InterfaceEndpoint")
            .refId("ep-1")
            .showEndpointName(true)
            .showEndpointVerbPath(false)
            .showEndpointReqResData(true)
            .responseMode("endpoint_response")
            .build();

        // Then - verify all 4 fields are set and retrievable
        assertThat(entity.getShowEndpointName()).isTrue();
        assertThat(entity.getShowEndpointVerbPath()).isFalse();
        assertThat(entity.getShowEndpointReqResData()).isTrue();
        assertThat(entity.getResponseMode()).isEqualTo("endpoint_response");

        // Also verify null defaults work
        SequenceMessageEntity nullEntity = SequenceMessageEntity.builder()
            .id("msg-2")
            .sequenceDiagramId("diag-1")
            .exchangeId("exc-2")
            .exchangeRole("Request")
            .fromParticipantId("p1")
            .toParticipantId("p2")
            .refKind("Method")
            .refId("method-1")
            .build();

        assertThat(nullEntity.getShowEndpointName()).isNull();
        assertThat(nullEntity.getShowEndpointVerbPath()).isNull();
        assertThat(nullEntity.getShowEndpointReqResData()).isNull();
        assertThat(nullEntity.getResponseMode()).isNull();
    }
}
