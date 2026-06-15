package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.entity.SequenceMessageDto;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.mockito.Mockito.mock;

/**
 * Unit tests for SequenceDiagramService endpoint display validation.
 *
 * Spec: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response
 * Task Group 2: Entity, DTO, Mapper, and Validation
 */
class SequenceDiagramEndpointValidationTest {

    private SequenceDiagramService service;

    @BeforeEach
    void setUp() {
        service = new SequenceDiagramService(
            mock(DiagramRepository.class),
            mock(SequenceDiagramRepository.class),
            mock(SequenceParticipantRepository.class),
            mock(SequenceMessageRepository.class),
            mock(SequenceFragmentRepository.class),
            mock(SequenceOperandRepository.class),
            mock(SequenceNodeRepository.class)
        );
    }

    @Test
    @DisplayName("Reject non-InterfaceEndpoint with responseMode != 'normal'")
    void validateEndpointDisplayOptions_shouldRejectNonEndpointWithNonNormalResponseMode() {
        // Given - a Method reference with endpoint_response mode (invalid)
        SequenceMessageDto message = new SequenceMessageDto(
            "msg-1", "exc-1", "Request", "p1", "p2",
            "Method", "method-1", null, null,
            null, null, null, "endpoint_response"
        );

        // Then
        assertThatThrownBy(() -> service.validateEndpointDisplayOptions(message))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("responseMode must be 'normal'");
    }

    @Test
    @DisplayName("Accept non-InterfaceEndpoint with responseMode 'normal'")
    void validateEndpointDisplayOptions_shouldAcceptNonEndpointWithNormalResponseMode() {
        SequenceMessageDto message = new SequenceMessageDto(
            "msg-1", "exc-1", "Request", "p1", "p2",
            "Method", "method-1", null, null,
            null, null, null, "normal"
        );

        assertThatNoException().isThrownBy(() -> service.validateEndpointDisplayOptions(message));
    }

    @Test
    @DisplayName("Accept non-InterfaceEndpoint with null responseMode")
    void validateEndpointDisplayOptions_shouldAcceptNonEndpointWithNullResponseMode() {
        SequenceMessageDto message = new SequenceMessageDto(
            "msg-1", "exc-1", "Request", "p1", "p2",
            "Method", "method-1", null, null,
            null, null, null, null
        );

        assertThatNoException().isThrownBy(() -> service.validateEndpointDisplayOptions(message));
    }

    @Test
    @DisplayName("Reject InterfaceEndpoint with all show_* flags false")
    void validateEndpointDisplayOptions_shouldRejectEndpointWithNoShowFlags() {
        SequenceMessageDto message = new SequenceMessageDto(
            "msg-1", "exc-1", "Request", "p1", "p2",
            "InterfaceEndpoint", "ep-1", null, null,
            false, false, false, "normal"
        );

        assertThatThrownBy(() -> service.validateEndpointDisplayOptions(message))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("at least one show_* flag");
    }

    @Test
    @DisplayName("Reject InterfaceEndpoint with all show_* flags null")
    void validateEndpointDisplayOptions_shouldRejectEndpointWithNullShowFlags() {
        SequenceMessageDto message = new SequenceMessageDto(
            "msg-1", "exc-1", "Request", "p1", "p2",
            "InterfaceEndpoint", "ep-1", null, null,
            null, null, null, "normal"
        );

        assertThatThrownBy(() -> service.validateEndpointDisplayOptions(message))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("at least one show_* flag");
    }

    @Test
    @DisplayName("Accept InterfaceEndpoint with at least one show_* flag true")
    void validateEndpointDisplayOptions_shouldAcceptEndpointWithOneShowFlag() {
        SequenceMessageDto message = new SequenceMessageDto(
            "msg-1", "exc-1", "Request", "p1", "p2",
            "InterfaceEndpoint", "ep-1", null, null,
            false, true, false, "endpoint_response"
        );

        assertThatNoException().isThrownBy(() -> service.validateEndpointDisplayOptions(message));
    }

    @Test
    @DisplayName("Accept label-text message (null refKind) with null responseMode")
    void validateEndpointDisplayOptions_shouldAcceptLabelTextMessageWithNullRefKind() {
        SequenceMessageDto message = new SequenceMessageDto(
            "msg-1", "exc-1", "Request", "p1", "p2",
            null, null, "Hello", null,
            null, null, null, null
        );

        assertThatNoException().isThrownBy(() -> service.validateEndpointDisplayOptions(message));
    }
}
