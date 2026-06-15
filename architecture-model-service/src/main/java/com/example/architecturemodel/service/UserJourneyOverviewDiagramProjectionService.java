package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.*;
import com.example.architecturemodel.repository.relationship.UserJourneyLinkRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Stateless projection service that deterministically generates a User Journey Overview
 * diagram from persisted Business Architecture entities (USER_JOURNEY, USER_JOURNEY_LINK,
 * BUSINESS_USER, BUSINESS_PROCESS, ACTIVITY_STEP).
 *
 * The overview presents all journeys for a selected Business User role, grouped into
 * Business Process lanes and connected by USER_JOURNEY_LINK edges.
 *
 * Each node is enriched with child diagram link resolution data: the service fetches
 * all saved USER_JOURNEY diagrams in the same model file, parses their
 * typedContentJson to extract source_user_journey_id, and deterministically resolves
 * each overview node to zero, one, or multiple matching child diagrams.
 *
 * Every call regenerates the diagram from authoritative DB data. No diagram state is stored.
 *
 * Spec: User Journey Overview Parent Diagram Generation + Parent-Child Diagram Linking
 * Task Group 2: Projection Service + Link Resolution
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class UserJourneyOverviewDiagramProjectionService {

    private final UserJourneyRepository userJourneyRepository;
    private final UserJourneyLinkRepository userJourneyLinkRepository;
    private final BusinessUserRepository businessUserRepository;
    private final BusinessProcessRepository businessProcessRepository;
    private final ActivityStepRepository activityStepRepository;
    private final ModelFileRepository modelFileRepository;
    private final DiagramRepository diagramRepository;

    private static final String DIAGRAM_TYPE = "USER_JOURNEY_OVERVIEW";
    private static final String VERSION = "1.0";
    private static final String UNASSIGNED_LANE_ID = "unassigned";
    private static final String UNASSIGNED_LANE_NAME = "Unassigned";

    /** Default link sub-record for nodes with no resolved child diagram. */
    static final UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto DEFAULT_UNLINKED_LINK =
        new UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto(null, null, "UNLINKED");

    private static final UserJourneyOverviewRenderHintsDto RENDER_HINTS =
        new UserJourneyOverviewRenderHintsDto(
            "VERTICAL", "LEFT_TO_RIGHT", true, true, true, true
        );

    /**
     * Project an overview diagram for all journeys belonging to a given Business User
     * within a (project, architecture) scope.
     *
     * Spec: Multi-Architecture Plumbing (Spec #1).
     *
     * @param projectId      the project UUID
     * @param architectureId the architecture UUID
     * @param businessUserId the business user ID whose journeys to include
     * @return the overview diagram DTO (empty but valid if no matching journeys)
     * @throws ResourceNotFoundException if no model file exists for the
     *   (projectId, architectureId) pair or the business user is not found
     */
    public UserJourneyOverviewDiagramDto projectOverview(UUID projectId, UUID architectureId,
                                                         String businessUserId) {
        ModelFileEntity modelFile = resolveModelFile(projectId, architectureId);

        // Resolve business user name
        BusinessUserEntity businessUser = businessUserRepository.findById(businessUserId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Business user not found: " + businessUserId));

        String businessUserName = businessUser.getName();
        String title = businessUserName + " Journey Overview";

        UserJourneyOverviewHeaderDto header = new UserJourneyOverviewHeaderDto(
            businessUserId, businessUserName, title
        );

        // Fetch all journeys for this model file, filter to selected business user
        List<UserJourneyEntity> allJourneys = userJourneyRepository.findByModelFileId(modelFile.getId());
        List<UserJourneyEntity> filteredJourneys = allJourneys.stream()
            .filter(j -> businessUserId.equals(j.getPrimaryBusinessUserId()))
            .toList();

        // Return empty valid structure for zero-journey scenarios
        if (filteredJourneys.isEmpty()) {
            return new UserJourneyOverviewDiagramDto(
                DIAGRAM_TYPE, VERSION, header,
                List.of(), List.of(), List.of(), RENDER_HINTS
            );
        }

        // Collect journey IDs for link filtering
        Set<String> journeyIds = filteredJourneys.stream()
            .map(UserJourneyEntity::getId)
            .collect(Collectors.toSet());

        // Derive lanes from unique parentBusinessProcessIds
        List<UserJourneyOverviewLaneDto> lanes = deriveLanes(filteredJourneys);

        // Build a map of lane ID by journey for node assignment
        Map<String, String> journeyIdToLaneId = new HashMap<>();
        for (UserJourneyEntity journey : filteredJourneys) {
            String laneId = journey.getParentBusinessProcessId() != null
                ? journey.getParentBusinessProcessId()
                : UNASSIGNED_LANE_ID;
            journeyIdToLaneId.put(journey.getId(), laneId);
        }

        // Fetch links and filter to only those where both ends are in the selected journey set
        List<UserJourneyLinkEntity> allLinks = userJourneyLinkRepository.findByModelFileId(modelFile.getId());
        List<UserJourneyLinkEntity> filteredLinks = allLinks.stream()
            .filter(link -> journeyIds.contains(link.getSourceUserJourneyId())
                         && journeyIds.contains(link.getTargetUserJourneyId()))
            .toList();

        // Compute relationship counts per journey
        Map<String, Integer> inCountMap = new HashMap<>();
        Map<String, Integer> outCountMap = new HashMap<>();
        for (UserJourneyLinkEntity link : filteredLinks) {
            outCountMap.merge(link.getSourceUserJourneyId(), 1, Integer::sum);
            inCountMap.merge(link.getTargetUserJourneyId(), 1, Integer::sum);
        }

        // Resolve child diagram links for each journey node
        Map<String, List<DiagramEntity>> childDiagramMap = resolveChildDiagramMap(modelFile.getId());

        // Derive nodes sorted alphabetically within each lane, grouped by lane order
        List<UserJourneyOverviewNodeDto> nodes = deriveNodes(
            filteredJourneys, journeyIdToLaneId, lanes,
            businessUserId, businessUserName, inCountMap, outCountMap,
            childDiagramMap
        );

        // Derive edges
        List<UserJourneyOverviewEdgeDto> edges = filteredLinks.stream()
            .map(link -> new UserJourneyOverviewEdgeDto(
                link.getId(),
                link.getSourceUserJourneyId(),
                link.getTargetUserJourneyId(),
                link.getRelationshipType(),
                link.getLabel(),
                link.getDescription()
            ))
            .toList();

        return new UserJourneyOverviewDiagramDto(
            DIAGRAM_TYPE, VERSION, header, lanes, nodes, edges, RENDER_HINTS
        );
    }

    private ModelFileEntity resolveModelFile(UUID projectId, UUID architectureId) {
        return modelFileRepository.findByProjectIdAndArchitectureId(projectId, architectureId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "No model file found for project: " + projectId
                    + " architecture: " + architectureId));
    }

    /**
     * Fetch all saved USER_JOURNEY diagrams for the given model file and build
     * a lookup map keyed by source_user_journey_id extracted from the typed content.
     *
     * Follows the UserJourneySyncService pattern for parsing typedContentJson:
     *   typedContentJson -> get("content") (Map) -> get("sync") (Map) -> get("source_user_journey_id") (String)
     *
     * Diagrams with null typedContentJson, null content block, null sync block, or null
     * source_user_journey_id are skipped (v1 diagrams without sync metadata).
     *
     * @param modelFileId the model file ID to scope the query
     * @return map from source_user_journey_id to list of matching DiagramEntity objects
     */
    @SuppressWarnings("unchecked")
    private Map<String, List<DiagramEntity>> resolveChildDiagramMap(String modelFileId) {
        List<DiagramEntity> candidateDiagrams =
            diagramRepository.findByModelFileIdAndDiagramType(modelFileId, "USER_JOURNEY");

        Map<String, List<DiagramEntity>> childDiagramMap = new HashMap<>();

        for (DiagramEntity diagram : candidateDiagrams) {
            Map<String, Object> typedContentJson = diagram.getTypedContentJson();
            if (typedContentJson == null) {
                continue;
            }

            Object contentObj = typedContentJson.get("content");
            if (!(contentObj instanceof Map)) {
                continue;
            }

            Map<String, Object> content = (Map<String, Object>) contentObj;
            Object syncObj = content.get("sync");
            if (!(syncObj instanceof Map)) {
                continue;
            }

            Map<String, Object> syncBlock = (Map<String, Object>) syncObj;
            Object sourceIdObj = syncBlock.get("source_user_journey_id");
            if (!(sourceIdObj instanceof String sourceJourneyId) || sourceJourneyId.isBlank()) {
                continue;
            }

            childDiagramMap.computeIfAbsent(sourceJourneyId, k -> new ArrayList<>()).add(diagram);
        }

        return childDiagramMap;
    }

    /**
     * Resolve the link sub-record for a journey node based on the child diagram map.
     *
     * Resolution rule:
     * - Zero matches: UNLINKED (null diagram id, null diagram name)
     * - Exactly one match: LINKED (diagram id and name from the single match)
     * - Multiple matches: AMBIGUOUS_RESOLVED (select diagram with alphabetically last ID
     *   using Collections.max, since DiagramEntity has no updatedAt field)
     *
     * @param journeyId      the user journey ID to resolve
     * @param childDiagramMap the map from source_user_journey_id to matching diagrams
     * @return the resolved link sub-record
     */
    private UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto resolveLink(
            String journeyId,
            Map<String, List<DiagramEntity>> childDiagramMap) {

        List<DiagramEntity> matches = childDiagramMap.getOrDefault(journeyId, List.of());

        if (matches.isEmpty()) {
            return DEFAULT_UNLINKED_LINK;
        }

        if (matches.size() == 1) {
            DiagramEntity diagram = matches.get(0);
            return new UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto(
                diagram.getId(), diagram.getName(), "LINKED"
            );
        }

        // Multiple matches: select alphabetically last ID as deterministic tiebreaker
        DiagramEntity selected = Collections.max(matches, Comparator.comparing(DiagramEntity::getId));
        return new UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto(
            selected.getId(), selected.getName(), "AMBIGUOUS_RESOLVED"
        );
    }

    /**
     * Derive lanes from unique parentBusinessProcessIds.
     * Alphabetical by Business Process name, with "Unassigned" lane last.
     */
    private List<UserJourneyOverviewLaneDto> deriveLanes(List<UserJourneyEntity> journeys) {
        // Collect unique non-null BP IDs
        Set<String> bpIds = journeys.stream()
            .map(UserJourneyEntity::getParentBusinessProcessId)
            .filter(Objects::nonNull)
            .collect(Collectors.toSet());

        boolean hasUnassigned = journeys.stream()
            .anyMatch(j -> j.getParentBusinessProcessId() == null);

        // Batch load business process entities
        Map<String, BusinessProcessEntity> bpMap;
        if (!bpIds.isEmpty()) {
            bpMap = businessProcessRepository.findAllById(bpIds).stream()
                .collect(Collectors.toMap(BusinessProcessEntity::getId, Function.identity()));
        } else {
            bpMap = Map.of();
        }

        // Sort by BP name alphabetically
        List<Map.Entry<String, BusinessProcessEntity>> sortedBPs = bpMap.entrySet().stream()
            .sorted(Comparator.comparing(e -> e.getValue().getName()))
            .toList();

        List<UserJourneyOverviewLaneDto> lanes = new ArrayList<>();
        int order = 0;
        for (Map.Entry<String, BusinessProcessEntity> entry : sortedBPs) {
            lanes.add(new UserJourneyOverviewLaneDto(
                entry.getKey(), entry.getValue().getName(), order++
            ));
        }

        // Add "Unassigned" lane last if any journey has null parentBusinessProcessId
        if (hasUnassigned) {
            lanes.add(new UserJourneyOverviewLaneDto(UNASSIGNED_LANE_ID, UNASSIGNED_LANE_NAME, order));
        }

        return lanes;
    }

    /**
     * Derive nodes sorted by lane order, then alphabetically by name within each lane.
     * Each node receives a link sub-record resolved from the child diagram map.
     */
    private List<UserJourneyOverviewNodeDto> deriveNodes(
            List<UserJourneyEntity> journeys,
            Map<String, String> journeyIdToLaneId,
            List<UserJourneyOverviewLaneDto> lanes,
            String businessUserId,
            String businessUserName,
            Map<String, Integer> inCountMap,
            Map<String, Integer> outCountMap,
            Map<String, List<DiagramEntity>> childDiagramMap) {

        // Build lane order map for sorting
        Map<String, Integer> laneOrderMap = lanes.stream()
            .collect(Collectors.toMap(UserJourneyOverviewLaneDto::id, UserJourneyOverviewLaneDto::order));

        // Build lane name map
        Map<String, String> laneNameMap = lanes.stream()
            .collect(Collectors.toMap(UserJourneyOverviewLaneDto::id, UserJourneyOverviewLaneDto::name));

        // Sort journeys: first by lane order, then alphabetically by journey name
        List<UserJourneyEntity> sorted = journeys.stream()
            .sorted(Comparator
                .comparing((UserJourneyEntity j) -> laneOrderMap.getOrDefault(
                    journeyIdToLaneId.get(j.getId()), Integer.MAX_VALUE))
                .thenComparing(UserJourneyEntity::getName))
            .toList();

        List<UserJourneyOverviewNodeDto> nodes = new ArrayList<>();
        for (UserJourneyEntity journey : sorted) {
            String laneId = journeyIdToLaneId.get(journey.getId());

            // Compute metadata
            List<ActivityStepEntity> steps = activityStepRepository.findByUserJourneyId(journey.getId());
            int stepCount = steps.size();
            long applicationCount = steps.stream()
                .map(ActivityStepEntity::getApplicationId)
                .distinct()
                .count();

            int relationshipInCount = inCountMap.getOrDefault(journey.getId(), 0);
            int relationshipOutCount = outCountMap.getOrDefault(journey.getId(), 0);

            UserJourneyOverviewNodeDto.UserJourneyOverviewNodeMetadataDto metadata =
                new UserJourneyOverviewNodeDto.UserJourneyOverviewNodeMetadataDto(
                    stepCount, (int) applicationCount, relationshipInCount, relationshipOutCount
                );

            String parentBpName = journey.getParentBusinessProcessId() != null
                ? laneNameMap.getOrDefault(laneId, null)
                : null;

            // Resolve child diagram link for this journey node
            UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto link =
                resolveLink(journey.getId(), childDiagramMap);

            nodes.add(new UserJourneyOverviewNodeDto(
                journey.getId(),
                laneId,
                journey.getName(),
                journey.getDescription(),
                businessUserId,
                businessUserName,
                journey.getParentBusinessProcessId(),
                parentBpName,
                metadata,
                link
            ));
        }

        return nodes;
    }
}
