package com.example.architecturemodel.service;

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
 * Service responsible for migrating existing sequence_* table data into diagrams.typed_content_json.
 *
 * This migration service:
 * - Queries all Sequence diagrams where typed_content_json IS NULL
 * - For each diagram: loads data from sequence_* tables and converts to typed content JSON
 * - Stores the assembled content into diagrams.typed_content_json
 * - If no matching sequence_diagrams record exists: stores default empty Sequence typedContent
 * - Logs migration counts (migrated N from tables, defaulted M)
 *
 * The migration is idempotent - it only processes diagrams with NULL typed_content_json.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class TypedContentMigrationService {

    private final DiagramRepository diagramRepository;
    private final SequenceDiagramRepository sequenceDiagramRepository;
    private final SequenceParticipantRepository sequenceParticipantRepository;
    private final SequenceMessageRepository sequenceMessageRepository;
    private final SequenceFragmentRepository sequenceFragmentRepository;
    private final SequenceOperandRepository sequenceOperandRepository;
    private final SequenceNodeRepository sequenceNodeRepository;

    /**
     * Result record containing migration counts.
     */
    public record MigrationResult(int migratedCount, int defaultedCount) {
        public int totalCount() {
            return migratedCount + defaultedCount;
        }
    }

    /**
     * Migrates all Sequence diagrams that have NULL typed_content_json.
     *
     * For each Sequence diagram:
     * - If a matching sequence_diagrams record exists: loads and converts all sequence_* data
     * - If no matching record exists: creates default empty Sequence typedContent
     *
     * This method is idempotent - it only processes diagrams with NULL typed_content_json.
     *
     * @return MigrationResult with counts of migrated and defaulted diagrams
     */
    @Transactional
    public MigrationResult migrateSequenceDiagrams() {
        log.info("Starting Sequence diagram migration to typed_content_json...");

        // Find all Sequence diagrams needing migration
        List<DiagramEntity> diagramsToMigrate = diagramRepository
            .findByDiagramTypeAndTypedContentJsonIsNull("Sequence");

        if (diagramsToMigrate.isEmpty()) {
            log.info("No Sequence diagrams need migration (all have typed_content_json populated)");
            return new MigrationResult(0, 0);
        }

        log.info("Found {} Sequence diagrams needing migration", diagramsToMigrate.size());

        int migratedCount = 0;
        int defaultedCount = 0;

        for (DiagramEntity diagram : diagramsToMigrate) {
            String diagramId = diagram.getId();

            // Try to find matching sequence_diagrams record
            Optional<SequenceDiagramEntity> sequenceDiagramOpt = sequenceDiagramRepository.findById(diagramId);

            Map<String, Object> typedContent;
            if (sequenceDiagramOpt.isPresent()) {
                // Load data from sequence_* tables and convert to typed content
                typedContent = assembleTypedContentFromSequenceTables(diagramId);
                migratedCount++;
                log.debug("Migrated sequence data for diagram: {} ({})", diagram.getName(), diagramId);
            } else {
                // No matching sequence_diagrams record - use default empty content
                typedContent = TypedContentDefaults.getDefaultTypedContent("Sequence");
                defaultedCount++;
                log.debug("Created default typed content for orphan diagram: {} ({})", diagram.getName(), diagramId);
            }

            // Update the diagram with typed content
            diagram.setTypedContentJson(typedContent);
            diagramRepository.save(diagram);
        }

        log.info("Sequence diagram migration complete: migrated {} from sequence_* tables, defaulted {} orphan diagrams",
            migratedCount, defaultedCount);

        return new MigrationResult(migratedCount, defaultedCount);
    }

    /**
     * Assembles typed content JSON from sequence_* table data.
     *
     * This method loads all sequence-related entities (participants, messages, fragments,
     * operands, nodes) and converts them to the typed content JSON structure.
     *
     * @param diagramId The sequence diagram ID
     * @return Map representing the typed content envelope with populated content
     */
    private Map<String, Object> assembleTypedContentFromSequenceTables(String diagramId) {
        // Load participants sorted by orderIndex
        List<Map<String, Object>> participants = sequenceParticipantRepository
            .findBySequenceDiagramId(diagramId).stream()
            .sorted(Comparator.comparing(SequenceParticipantEntity::getOrderIndex))
            .map(this::toParticipantMap)
            .collect(Collectors.toList());

        // Load messages
        List<Map<String, Object>> messages = sequenceMessageRepository
            .findBySequenceDiagramId(diagramId).stream()
            .map(this::toMessageMap)
            .collect(Collectors.toList());

        // Load fragments
        List<SequenceFragmentEntity> fragmentEntities = sequenceFragmentRepository
            .findBySequenceDiagramId(diagramId);
        List<Map<String, Object>> fragments = fragmentEntities.stream()
            .map(this::toFragmentMap)
            .collect(Collectors.toList());

        // Load operands for all fragments, sorted by operandIndex
        List<Map<String, Object>> operands = new ArrayList<>();
        for (SequenceFragmentEntity fragment : fragmentEntities) {
            List<Map<String, Object>> fragmentOperands = sequenceOperandRepository
                .findByFragmentId(fragment.getId()).stream()
                .sorted(Comparator.comparing(SequenceOperandEntity::getOperandIndex))
                .map(this::toOperandMap)
                .collect(Collectors.toList());
            operands.addAll(fragmentOperands);
        }

        // Load sequence nodes sorted by orderIndex
        List<Map<String, Object>> sequenceNodes = sequenceNodeRepository
            .findBySequenceDiagramId(diagramId).stream()
            .sorted(Comparator.comparing(SequenceNodeEntity::getOrderIndex))
            .map(this::toNodeMap)
            .collect(Collectors.toList());

        // Build the content structure
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("participants", participants);
        content.put("messages", messages);
        content.put("fragments", fragments);
        content.put("operands", operands);
        content.put("sequenceNodes", sequenceNodes);

        // Build the envelope
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("type", "Sequence");
        envelope.put("version", TypedContentDefaults.CURRENT_VERSION);
        envelope.put("content", content);

        return envelope;
    }

    // ============================================================================
    // Entity to Map Converters
    // ============================================================================

    private Map<String, Object> toParticipantMap(SequenceParticipantEntity entity) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", entity.getId());
        map.put("refKind", entity.getRefKind());
        map.put("refId", entity.getRefId());
        map.put("orderIndex", entity.getOrderIndex());
        return map;
    }

    private Map<String, Object> toMessageMap(SequenceMessageEntity entity) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", entity.getId());
        map.put("exchangeId", entity.getExchangeId());
        map.put("exchangeRole", entity.getExchangeRole());
        map.put("fromParticipantId", entity.getFromParticipantId());
        map.put("toParticipantId", entity.getToParticipantId());
        // Only include refKind/refId if present
        if (entity.getRefKind() != null) {
            map.put("refKind", entity.getRefKind());
        }
        if (entity.getRefId() != null) {
            map.put("refId", entity.getRefId());
        }
        // Only include labelText if present
        if (entity.getLabelText() != null) {
            map.put("labelText", entity.getLabelText());
        }
        return map;
    }

    private Map<String, Object> toFragmentMap(SequenceFragmentEntity entity) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", entity.getId());
        map.put("fragmentKind", entity.getFragmentKind());
        if (entity.getLabelText() != null) {
            map.put("labelText", entity.getLabelText());
        }
        return map;
    }

    private Map<String, Object> toOperandMap(SequenceOperandEntity entity) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", entity.getId());
        map.put("fragmentId", entity.getFragmentId());
        if (entity.getGuardExpression() != null) {
            map.put("guardExpression", entity.getGuardExpression());
        }
        map.put("operandIndex", entity.getOperandIndex());
        return map;
    }

    private Map<String, Object> toNodeMap(SequenceNodeEntity entity) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", entity.getId());
        map.put("nodeKind", entity.getNodeKind());
        if (entity.getMessageId() != null) {
            map.put("messageId", entity.getMessageId());
        }
        if (entity.getFragmentId() != null) {
            map.put("fragmentId", entity.getFragmentId());
        }
        map.put("orderIndex", entity.getOrderIndex());
        if (entity.getParentNodeId() != null) {
            map.put("parentNodeId", entity.getParentNodeId());
        }
        if (entity.getParentOperandId() != null) {
            map.put("parentOperandId", entity.getParentOperandId());
        }
        return map;
    }
}
