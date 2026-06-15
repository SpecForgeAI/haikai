package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.entity.*;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Service for managing Sequence Diagrams.
 *
 * UPDATED FOR TYPED CONTENT MIGRATION:
 * This service now reads from and writes to diagrams.typed_content_json instead of
 * the sequence_* tables. The sequence_* tables are deprecated but remain in the schema
 * for backward compatibility during the migration period.
 *
 * The typed content structure follows the envelope pattern:
 * {
 *   "type": "Sequence",
 *   "version": 1,
 *   "content": {
 *     "participants": [...],
 *     "messages": [...],
 *     "fragments": [...],
 *     "operands": [...],
 *     "sequenceNodes": [...]
 *   }
 * }
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class SequenceDiagramService {

    private final DiagramRepository diagramRepository;
    private final SequenceDiagramRepository sequenceDiagramRepository;
    private final SequenceParticipantRepository sequenceParticipantRepository;
    private final SequenceMessageRepository sequenceMessageRepository;
    private final SequenceFragmentRepository sequenceFragmentRepository;
    private final SequenceOperandRepository sequenceOperandRepository;
    private final SequenceNodeRepository sequenceNodeRepository;

    // ============================================================================
    // Allowed enum values for validation
    // ============================================================================

    private static final Set<String> ALLOWED_PARTICIPANT_REF_KINDS = Set.of(
        "BusinessUser", "Application", "ApplicationComponent", "Service",
        "Interface", "InterfaceEndpoint", "Class"
    );

    private static final Set<String> ALLOWED_MESSAGE_REF_KINDS = Set.of(
        "Method", "LogicalEntity", "PhysicalEntity", "Class", "Event", "InterfaceEndpoint"
    );

    private static final Set<String> ALLOWED_EXCHANGE_ROLES = Set.of(
        "Request", "Response"
    );

    private static final Set<String> ALLOWED_FRAGMENT_KINDS = Set.of(
        "Loop", "Optional", "Alternative"
    );

    private static final Set<String> ALLOWED_NODE_KINDS = Set.of(
        "Message", "Fragment"
    );

    // ============================================================================
    // Public API Methods - Now using diagrams.typed_content_json
    // ============================================================================

    /**
     * Get a sequence diagram by ID with all nested children.
     *
     * This method now reads from diagrams.typed_content_json instead of the
     * sequence_* tables.
     *
     * @param id The diagram ID (from diagrams table)
     * @return The fully populated SequenceDiagramDto
     * @throws ResourceNotFoundException if the diagram is not found
     * @throws IllegalArgumentException if the diagram is not a Sequence type
     */
    @Transactional(readOnly = true)
    public SequenceDiagramDto getSequenceDiagram(String id) {
        log.debug("Getting sequence diagram with id: {} (reading from typed_content_json)", id);

        // Load from diagrams table
        DiagramEntity diagram = diagramRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Diagram not found: " + id));

        // Verify it's a Sequence diagram
        if (!"Sequence".equals(diagram.getDiagramType())) {
            throw new IllegalArgumentException("Diagram '" + id + "' is not a Sequence diagram");
        }

        // Build DTO from typed_content_json
        return buildSequenceDiagramDtoFromTypedContent(diagram);
    }

    /**
     * Get all sequence diagrams for a model file.
     *
     * This method now reads from diagrams.typed_content_json instead of the
     * sequence_* tables.
     *
     * @param modelFileId The model file ID
     * @return List of SequenceDiagramDto (fully populated with children)
     */
    @Transactional(readOnly = true)
    public List<SequenceDiagramDto> getSequenceDiagramsByModelFileId(String modelFileId) {
        log.debug("Getting sequence diagrams for model file: {} (reading from typed_content_json)", modelFileId);

        // Load all diagrams for this model file
        List<DiagramEntity> diagrams = diagramRepository.findByModelFileId(modelFileId);

        // Filter to only Sequence diagrams and convert
        return diagrams.stream()
            .filter(d -> "Sequence".equals(d.getDiagramType()))
            .map(this::buildSequenceDiagramDtoFromTypedContent)
            .collect(Collectors.toList());
    }

    /**
     * Save the content of a sequence diagram.
     *
     * This method now writes to diagrams.typed_content_json instead of the
     * sequence_* tables. The content is wrapped in the typed content envelope.
     *
     * @param id The diagram ID (from diagrams table)
     * @param diagramDto The full SequenceDiagramDto with all children
     * @return The normalized SequenceDiagramDto after save
     * @throws ResourceNotFoundException if the diagram is not found
     * @throws IllegalArgumentException if validation fails or diagram is not a Sequence type
     */
    @Transactional
    public SequenceDiagramDto saveSequenceDiagramContent(String id, SequenceDiagramDto diagramDto) {
        log.debug("Saving sequence diagram content for id: {} (writing to typed_content_json)", id);

        // 1. Load diagram from diagrams table
        DiagramEntity diagram = diagramRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Diagram not found: " + id));

        // 2. Verify it's a Sequence diagram
        if (!"Sequence".equals(diagram.getDiagramType())) {
            throw new IllegalArgumentException("Diagram '" + id + "' is not a Sequence diagram");
        }

        // 3. Validate all input data
        validateSequenceDiagramContent(diagramDto);

        // 4. Build typed content envelope and persist to diagrams.typed_content_json
        Map<String, Object> typedContent = buildTypedContentEnvelope(diagramDto);
        diagram.setTypedContentJson(typedContent);
        diagramRepository.save(diagram);

        log.debug("Saved sequence diagram content to typed_content_json for diagram: {}", id);

        // 5. Return the DTO built from the saved content
        return buildSequenceDiagramDtoFromTypedContent(diagram);
    }

    // ============================================================================
    // Private Methods - Build DTO from typed_content_json
    // ============================================================================

    /**
     * Build a SequenceDiagramDto from a DiagramEntity's typed_content_json.
     */
    private SequenceDiagramDto buildSequenceDiagramDtoFromTypedContent(DiagramEntity diagram) {
        Map<String, Object> typedContent = diagram.getTypedContentJson();

        // If typed content is null, return empty default
        if (typedContent == null) {
            return new SequenceDiagramDto(
                diagram.getId(),
                diagram.getModelFileId(),
                diagram.getName(),
                "Sequence",
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList()
            );
        }

        // Extract content from envelope
        @SuppressWarnings("unchecked")
        Map<String, Object> content = (Map<String, Object>) typedContent.get("content");
        if (content == null) {
            content = Collections.emptyMap();
        }

        // Parse each array from content
        List<SequenceParticipantDto> participants = parseParticipants(content);
        List<SequenceMessageDto> messages = parseMessages(content);
        List<SequenceFragmentDto> fragments = parseFragments(content);
        List<SequenceOperandDto> operands = parseOperands(content);
        List<SequenceNodeDto> sequenceNodes = parseSequenceNodes(content);

        return new SequenceDiagramDto(
            diagram.getId(),
            diagram.getModelFileId(),
            diagram.getName(),
            "Sequence",
            participants,
            messages,
            fragments,
            operands,
            sequenceNodes
        );
    }

    @SuppressWarnings("unchecked")
    private List<SequenceParticipantDto> parseParticipants(Map<String, Object> content) {
        List<Map<String, Object>> list = (List<Map<String, Object>>) content.get("participants");
        if (list == null) return Collections.emptyList();

        return list.stream()
            .map(p -> new SequenceParticipantDto(
                (String) p.get("id"),
                (String) p.get("refKind"),
                (String) p.get("refId"),
                toInteger(p.get("orderIndex"))
            ))
            .sorted(Comparator.comparing(SequenceParticipantDto::orderIndex, Comparator.nullsLast(Comparator.naturalOrder())))
            .collect(Collectors.toList());
    }

    /**
     * Parse messages from typed content JSON.
     *
     * Includes isCollection field for collection entity display support.
     * Includes showEndpointName, showEndpointVerbPath, showEndpointReqResData, responseMode
     * fields for InterfaceEndpoint display configuration.
     *
     * Spec: Sequence Diagram Message Exchange Collection Entity Display
     * Spec: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response
     */
    @SuppressWarnings("unchecked")
    private List<SequenceMessageDto> parseMessages(Map<String, Object> content) {
        List<Map<String, Object>> list = (List<Map<String, Object>>) content.get("messages");
        if (list == null) return Collections.emptyList();

        return list.stream()
            .map(m -> new SequenceMessageDto(
                (String) m.get("id"),
                (String) m.get("exchangeId"),
                (String) m.get("exchangeRole"),
                (String) m.get("fromParticipantId"),
                (String) m.get("toParticipantId"),
                (String) m.get("refKind"),
                (String) m.get("refId"),
                (String) m.get("labelText"),
                toBoolean(m.get("isCollection")),
                toBoolean(m.get("showEndpointName")),
                toBoolean(m.get("showEndpointVerbPath")),
                toBoolean(m.get("showEndpointReqResData")),
                (String) m.get("responseMode")
            ))
            .collect(Collectors.toList());
    }

    @SuppressWarnings("unchecked")
    private List<SequenceFragmentDto> parseFragments(Map<String, Object> content) {
        List<Map<String, Object>> list = (List<Map<String, Object>>) content.get("fragments");
        if (list == null) return Collections.emptyList();

        return list.stream()
            .map(f -> new SequenceFragmentDto(
                (String) f.get("id"),
                (String) f.get("fragmentKind"),
                (String) f.get("labelText")
            ))
            .collect(Collectors.toList());
    }

    @SuppressWarnings("unchecked")
    private List<SequenceOperandDto> parseOperands(Map<String, Object> content) {
        List<Map<String, Object>> list = (List<Map<String, Object>>) content.get("operands");
        if (list == null) return Collections.emptyList();

        return list.stream()
            .map(o -> new SequenceOperandDto(
                (String) o.get("id"),
                (String) o.get("fragmentId"),
                (String) o.get("guardExpression"),
                toInteger(o.get("operandIndex"))
            ))
            .sorted(Comparator.comparing(SequenceOperandDto::operandIndex, Comparator.nullsLast(Comparator.naturalOrder())))
            .collect(Collectors.toList());
    }

    @SuppressWarnings("unchecked")
    private List<SequenceNodeDto> parseSequenceNodes(Map<String, Object> content) {
        List<Map<String, Object>> list = (List<Map<String, Object>>) content.get("sequenceNodes");
        if (list == null) return Collections.emptyList();

        return list.stream()
            .map(n -> new SequenceNodeDto(
                (String) n.get("id"),
                (String) n.get("nodeKind"),
                (String) n.get("messageId"),
                (String) n.get("fragmentId"),
                toInteger(n.get("orderIndex")),
                (String) n.get("parentNodeId"),
                (String) n.get("parentOperandId")
            ))
            .sorted(Comparator.comparing(SequenceNodeDto::orderIndex, Comparator.nullsLast(Comparator.naturalOrder())))
            .collect(Collectors.toList());
    }

    /**
     * Safely convert a value to Integer, handling Number types.
     */
    private Integer toInteger(Object value) {
        if (value == null) return null;
        if (value instanceof Integer) return (Integer) value;
        if (value instanceof Number) return ((Number) value).intValue();
        return null;
    }

    /**
     * Safely convert a value to Boolean, handling Boolean types.
     * Returns null if value is null or not a Boolean.
     */
    private Boolean toBoolean(Object value) {
        if (value == null) return null;
        if (value instanceof Boolean) return (Boolean) value;
        return null;
    }

    // ============================================================================
    // Private Methods - Build typed_content envelope
    // ============================================================================

    /**
     * Build the typed content envelope from a SequenceDiagramDto.
     */
    private Map<String, Object> buildTypedContentEnvelope(SequenceDiagramDto dto) {
        Map<String, Object> content = new LinkedHashMap<>();

        // Build participants array
        List<Map<String, Object>> participants = dto.participants() == null ? new ArrayList<>() :
            dto.participants().stream()
                .map(this::participantToMap)
                .collect(Collectors.toList());
        content.put("participants", participants);

        // Build messages array
        List<Map<String, Object>> messages = dto.messages() == null ? new ArrayList<>() :
            dto.messages().stream()
                .map(this::messageToMap)
                .collect(Collectors.toList());
        content.put("messages", messages);

        // Build fragments array
        List<Map<String, Object>> fragments = dto.fragments() == null ? new ArrayList<>() :
            dto.fragments().stream()
                .map(this::fragmentToMap)
                .collect(Collectors.toList());
        content.put("fragments", fragments);

        // Build operands array
        List<Map<String, Object>> operands = dto.operands() == null ? new ArrayList<>() :
            dto.operands().stream()
                .map(this::operandToMap)
                .collect(Collectors.toList());
        content.put("operands", operands);

        // Build sequenceNodes array
        List<Map<String, Object>> sequenceNodes = dto.sequenceNodes() == null ? new ArrayList<>() :
            dto.sequenceNodes().stream()
                .map(this::nodeToMap)
                .collect(Collectors.toList());
        content.put("sequenceNodes", sequenceNodes);

        // Build envelope
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("type", "Sequence");
        envelope.put("version", TypedContentDefaults.CURRENT_VERSION);
        envelope.put("content", content);

        return envelope;
    }

    private Map<String, Object> participantToMap(SequenceParticipantDto p) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", p.id());
        map.put("refKind", p.refKind());
        map.put("refId", p.refId());
        map.put("orderIndex", p.orderIndex());
        return map;
    }

    /**
     * Convert a SequenceMessageDto to a Map for JSON serialization.
     *
     * Includes isCollection field for collection entity display support.
     * Includes showEndpointName, showEndpointVerbPath, showEndpointReqResData, responseMode
     * fields for InterfaceEndpoint display configuration.
     *
     * Spec: Sequence Diagram Message Exchange Collection Entity Display
     * Spec: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response
     */
    private Map<String, Object> messageToMap(SequenceMessageDto m) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", m.id());
        map.put("exchangeId", m.exchangeId());
        map.put("exchangeRole", m.exchangeRole());
        map.put("fromParticipantId", m.fromParticipantId());
        map.put("toParticipantId", m.toParticipantId());
        map.put("refKind", m.refKind());
        map.put("refId", m.refId());
        map.put("labelText", m.labelText());
        // Only include isCollection if it's not null (omit null values for cleaner JSON)
        if (m.isCollection() != null) {
            map.put("isCollection", m.isCollection());
        }
        // Only include endpoint display fields if not null (omit null values for cleaner JSON)
        if (m.showEndpointName() != null) {
            map.put("showEndpointName", m.showEndpointName());
        }
        if (m.showEndpointVerbPath() != null) {
            map.put("showEndpointVerbPath", m.showEndpointVerbPath());
        }
        if (m.showEndpointReqResData() != null) {
            map.put("showEndpointReqResData", m.showEndpointReqResData());
        }
        if (m.responseMode() != null) {
            map.put("responseMode", m.responseMode());
        }
        return map;
    }

    private Map<String, Object> fragmentToMap(SequenceFragmentDto f) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", f.id());
        map.put("fragmentKind", f.fragmentKind());
        map.put("labelText", f.labelText());
        return map;
    }

    private Map<String, Object> operandToMap(SequenceOperandDto o) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", o.id());
        map.put("fragmentId", o.fragmentId());
        map.put("guardExpression", o.guardExpression());
        map.put("operandIndex", o.operandIndex());
        return map;
    }

    private Map<String, Object> nodeToMap(SequenceNodeDto n) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", n.id());
        map.put("nodeKind", n.nodeKind());
        map.put("messageId", n.messageId());
        map.put("fragmentId", n.fragmentId());
        map.put("orderIndex", n.orderIndex());
        map.put("parentNodeId", n.parentNodeId());
        map.put("parentOperandId", n.parentOperandId());
        return map;
    }

    // ============================================================================
    // Validation Methods (kept from original implementation)
    // ============================================================================

    /**
     * Validate all children in the SequenceDiagramDto before persistence.
     */
    private void validateSequenceDiagramContent(SequenceDiagramDto dto) {
        // Validate participants
        if (dto.participants() != null) {
            for (SequenceParticipantDto participant : dto.participants()) {
                validateParticipantRefKind(participant.refKind());
            }
        }

        // Validate messages
        if (dto.messages() != null) {
            for (SequenceMessageDto message : dto.messages()) {
                validateMessageRefKind(message.refKind());
                validateMessageExchangeRole(message.exchangeRole());
                validateMessageContentOneOf(message.refKind(), message.refId(), message.labelText());
                validateEndpointDisplayOptions(message);
            }
        }

        // Validate fragments
        if (dto.fragments() != null) {
            for (SequenceFragmentDto fragment : dto.fragments()) {
                validateFragmentKind(fragment.fragmentKind());
            }
        }

        // Validate nodes
        if (dto.sequenceNodes() != null) {
            for (SequenceNodeDto node : dto.sequenceNodes()) {
                validateNodeKind(node.nodeKind(), node.messageId(), node.fragmentId());
            }
        }
    }

    /**
     * Validate participant ref_kind is in allowed set.
     *
     * @param refKind The ref_kind value to validate
     * @throws IllegalArgumentException if invalid
     */
    public void validateParticipantRefKind(String refKind) {
        if (refKind == null || !ALLOWED_PARTICIPANT_REF_KINDS.contains(refKind)) {
            throw new IllegalArgumentException(
                "Invalid participant ref_kind: " + refKind +
                ". Allowed values: " + ALLOWED_PARTICIPANT_REF_KINDS
            );
        }
    }

    /**
     * Validate message ref_kind is in allowed set (when present).
     *
     * @param refKind The ref_kind value to validate
     * @throws IllegalArgumentException if invalid
     */
    public void validateMessageRefKind(String refKind) {
        if (refKind != null && !ALLOWED_MESSAGE_REF_KINDS.contains(refKind)) {
            throw new IllegalArgumentException(
                "Invalid message ref_kind: " + refKind +
                ". Allowed values: " + ALLOWED_MESSAGE_REF_KINDS
            );
        }
    }

    /**
     * Validate exchange_role is in allowed set.
     *
     * @param role The exchange_role value to validate
     * @throws IllegalArgumentException if invalid
     */
    public void validateMessageExchangeRole(String role) {
        if (role == null || !ALLOWED_EXCHANGE_ROLES.contains(role)) {
            throw new IllegalArgumentException(
                "Invalid exchange_role: " + role +
                ". Allowed values: " + ALLOWED_EXCHANGE_ROLES
            );
        }
    }

    /**
     * Validate message content one-of constraint:
     * Either (ref_kind + ref_id) OR label_text must be present, not both.
     *
     * @param refKind The ref_kind value
     * @param refId The ref_id value
     * @param labelText The label_text value
     * @throws IllegalArgumentException if constraint violated
     */
    public void validateMessageContentOneOf(String refKind, String refId, String labelText) {
        boolean hasRef = refKind != null && refId != null;
        boolean hasLabel = labelText != null && !labelText.isBlank();

        if (hasRef && hasLabel) {
            throw new IllegalArgumentException(
                "Message cannot have both (ref_kind + ref_id) and label_text. Choose one."
            );
        }

        if (!hasRef && !hasLabel) {
            throw new IllegalArgumentException(
                "Message must have either (ref_kind + ref_id) or label_text."
            );
        }
    }

    /**
     * Validate endpoint display options on a sequence message.
     *
     * Rules:
     * - If refKind is not InterfaceEndpoint, responseMode must be "normal" (or null)
     * - If refKind is InterfaceEndpoint, at least one show_* flag must be true
     *
     * Spec: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response
     *
     * @param message The message DTO to validate
     * @throws IllegalArgumentException if validation fails
     */
    public void validateEndpointDisplayOptions(SequenceMessageDto message) {
        String refKind = message.refKind();
        String responseMode = message.responseMode();

        // Rule 1: non-InterfaceEndpoint must have responseMode "normal" or null
        if (!"InterfaceEndpoint".equals(refKind)) {
            if (responseMode != null && !"normal".equals(responseMode)) {
                throw new IllegalArgumentException(
                    "responseMode must be 'normal' when ref_kind is not InterfaceEndpoint, " +
                    "but was '" + responseMode + "' for ref_kind '" + refKind + "'."
                );
            }
            return;
        }

        // Rule 2: InterfaceEndpoint must have at least one show_* flag true
        Boolean showName = message.showEndpointName();
        Boolean showVerbPath = message.showEndpointVerbPath();
        Boolean showReqResData = message.showEndpointReqResData();

        boolean anyTrue = Boolean.TRUE.equals(showName)
            || Boolean.TRUE.equals(showVerbPath)
            || Boolean.TRUE.equals(showReqResData);

        if (!anyTrue) {
            throw new IllegalArgumentException(
                "InterfaceEndpoint messages must have at least one show_* flag set to true."
            );
        }
    }

    /**
     * Validate fragment_kind is in allowed set.
     *
     * @param kind The fragment_kind value to validate
     * @throws IllegalArgumentException if invalid
     */
    public void validateFragmentKind(String kind) {
        if (kind == null || !ALLOWED_FRAGMENT_KINDS.contains(kind)) {
            throw new IllegalArgumentException(
                "Invalid fragment_kind: " + kind +
                ". Allowed values: " + ALLOWED_FRAGMENT_KINDS
            );
        }
    }

    /**
     * Validate node_kind is in allowed set and conditional field requirements:
     * - When node_kind=Message: message_id required, fragment_id must be null
     * - When node_kind=Fragment: fragment_id required, message_id must be null
     *
     * @param kind The node_kind value
     * @param messageId The message_id value
     * @param fragmentId The fragment_id value
     * @throws IllegalArgumentException if constraint violated
     */
    public void validateNodeKind(String kind, String messageId, String fragmentId) {
        if (kind == null || !ALLOWED_NODE_KINDS.contains(kind)) {
            throw new IllegalArgumentException(
                "Invalid node_kind: " + kind +
                ". Allowed values: " + ALLOWED_NODE_KINDS
            );
        }

        if ("Message".equals(kind)) {
            if (messageId == null || messageId.isBlank()) {
                throw new IllegalArgumentException(
                    "When node_kind is 'Message', message_id is required."
                );
            }
            if (fragmentId != null && !fragmentId.isBlank()) {
                throw new IllegalArgumentException(
                    "When node_kind is 'Message', fragment_id must be null."
                );
            }
        } else if ("Fragment".equals(kind)) {
            if (fragmentId == null || fragmentId.isBlank()) {
                throw new IllegalArgumentException(
                    "When node_kind is 'Fragment', fragment_id is required."
                );
            }
            if (messageId != null && !messageId.isBlank()) {
                throw new IllegalArgumentException(
                    "When node_kind is 'Fragment', message_id must be null."
                );
            }
        }
    }
}
