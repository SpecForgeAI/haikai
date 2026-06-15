package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Stateless projection service that deterministically generates User Journey diagram JSON
 * from persisted USER_JOURNEY and ACTIVITY_STEP meta-model data.
 *
 * Every call regenerates the diagram from authoritative DB data. No diagram state is stored.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class UserJourneyDiagramProjectionService {

    private final UserJourneyRepository userJourneyRepository;
    private final ActivityStepRepository activityStepRepository;
    private final ApplicationRepository applicationRepository;
    private final ProcessActivityRepository processActivityRepository;
    private final BusinessUserRepository businessUserRepository;
    private final BusinessProcessRepository businessProcessRepository;
    private final ModelFileRepository modelFileRepository;

    private static final String DIAGRAM_TYPE = "USER_JOURNEY";
    private static final String VERSION = "1.0";
    private static final UserJourneyDiagramRenderHintsDto RENDER_HINTS =
        new UserJourneyDiagramRenderHintsDto("VERTICAL", "LEFT_TO_RIGHT", true);

    /**
     * Project a single User Journey into a diagram contract within a (project,
     * architecture) scope.
     *
     * Spec: Multi-Architecture Plumbing (Spec #1).
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param userJourneyId the user journey ID
     * @return the diagram contract DTO
     * @throws ResourceNotFoundException if no model file exists for the
     *   (projectId, architectureId) pair, the journey does not exist, or the
     *   journey does not belong to the resolved model file
     */
    public UserJourneyDiagramDto projectSingleJourney(UUID projectId, UUID architectureId,
                                                      String userJourneyId) {
        ModelFileEntity modelFile = resolveModelFile(projectId, architectureId);

        UserJourneyEntity journey = userJourneyRepository.findById(userJourneyId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "User journey not found: " + userJourneyId));

        if (!journey.getModelFileId().equals(modelFile.getId())) {
            throw new ResourceNotFoundException(
                "User journey " + userJourneyId + " does not belong to project " + projectId
                    + " architecture " + architectureId);
        }

        List<ActivityStepEntity> steps = activityStepRepository.findByUserJourneyId(userJourneyId);
        return projectJourney(journey, steps);
    }

    /**
     * Project all User Journeys for a (project, architecture) pair into diagram
     * contracts.
     *
     * Spec: Multi-Architecture Plumbing (Spec #1).
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @return list of diagram contract DTOs (empty list if no journeys exist)
     * @throws ResourceNotFoundException if no model file exists for the pair
     */
    public List<UserJourneyDiagramDto> projectAllJourneys(UUID projectId, UUID architectureId) {
        ModelFileEntity modelFile = resolveModelFile(projectId, architectureId);

        List<UserJourneyEntity> journeys = userJourneyRepository.findByModelFileId(modelFile.getId());
        if (journeys.isEmpty()) {
            return List.of();
        }

        List<UserJourneyDiagramDto> results = new ArrayList<>();
        for (UserJourneyEntity journey : journeys) {
            List<ActivityStepEntity> steps = activityStepRepository.findByUserJourneyId(journey.getId());
            results.add(projectJourney(journey, steps));
        }
        return results;
    }

    private ModelFileEntity resolveModelFile(UUID projectId, UUID architectureId) {
        return modelFileRepository.findByProjectIdAndArchitectureId(projectId, architectureId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "No model file found for project: " + projectId
                    + " architecture: " + architectureId));
    }

    /**
     * Core projection: build a UserJourneyDiagramDto from a journey entity and its steps.
     */
    private UserJourneyDiagramDto projectJourney(UserJourneyEntity journey, List<ActivityStepEntity> steps) {
        // 1. Resolve journey-level linked names
        UserJourneyDiagramJourneyDto journeyDto = buildJourneyDto(journey);

        // 2. Sort steps deterministically: sequenceOrder asc, then id asc for ties
        List<ActivityStepEntity> sortedSteps = steps.stream()
            .sorted(Comparator
                .comparing((ActivityStepEntity s) -> s.getSequenceOrder() != null ? s.getSequenceOrder() : Integer.MAX_VALUE)
                .thenComparing(ActivityStepEntity::getId))
            .toList();

        if (sortedSteps.isEmpty()) {
            return new UserJourneyDiagramDto(
                DIAGRAM_TYPE, VERSION, journeyDto,
                List.of(), List.of(), List.of(), RENDER_HINTS
            );
        }

        // 3. Batch load linked entities
        Set<String> applicationIds = sortedSteps.stream()
            .map(ActivityStepEntity::getApplicationId)
            .collect(Collectors.toSet());
        Set<String> processActivityIds = sortedSteps.stream()
            .map(ActivityStepEntity::getProcessActivityId)
            .collect(Collectors.toSet());
        Set<String> businessUserIds = sortedSteps.stream()
            .map(ActivityStepEntity::getBusinessUserId)
            .filter(Objects::nonNull)
            .collect(Collectors.toSet());

        Map<String, ApplicationEntity> appMap = applicationRepository.findAllById(applicationIds)
            .stream().collect(Collectors.toMap(ApplicationEntity::getId, Function.identity()));
        Map<String, ProcessActivityEntity> paMap = processActivityRepository.findAllById(processActivityIds)
            .stream().collect(Collectors.toMap(ProcessActivityEntity::getId, Function.identity()));
        Map<String, BusinessUserEntity> buMap = businessUserRepository.findAllById(businessUserIds)
            .stream().collect(Collectors.toMap(BusinessUserEntity::getId, Function.identity()));

        // Validate all referenced applications exist
        for (String appId : applicationIds) {
            if (!appMap.containsKey(appId)) {
                throw new ResourceNotFoundException("Referenced application not found: " + appId);
            }
        }
        // Validate all referenced process activities exist
        for (String paId : processActivityIds) {
            if (!paMap.containsKey(paId)) {
                throw new ResourceNotFoundException("Referenced process activity not found: " + paId);
            }
        }

        // 4. Lane derivation: unique applications, ordered by first occurrence in step sequence
        List<UserJourneyDiagramLaneDto> lanes = deriveLanes(sortedSteps, appMap);

        // 5. Step mapping
        List<UserJourneyDiagramStepDto> stepDtos = new ArrayList<>();
        for (ActivityStepEntity step : sortedSteps) {
            ProcessActivityEntity pa = paMap.get(step.getProcessActivityId());
            BusinessUserEntity bu = step.getBusinessUserId() != null ? buMap.get(step.getBusinessUserId()) : null;

            // Defensive name fallback: if step name is null, use ProcessActivity name
            String stepName = step.getName() != null ? step.getName() : pa.getName();

            // Diagram label: use entity's diagramLabel, fall back to step name
            String diagramLabel = (step.getDiagramLabel() != null && !step.getDiagramLabel().isBlank())
                ? step.getDiagramLabel()
                : stepName;

            stepDtos.add(new UserJourneyDiagramStepDto(
                step.getId(),
                step.getUserJourneyId(),
                step.getSequenceOrder() != null ? step.getSequenceOrder() : 0,
                step.getApplicationId(),
                step.getProcessActivityId(),
                pa.getName(),
                stepName,
                diagramLabel,
                step.getDescription(),
                step.getBusinessUserId(),
                bu != null ? bu.getName() : null,
                step.getActivityIssues() != null ? step.getActivityIssues() : "",
                step.getUiIssues() != null ? step.getUiIssues() : ""
            ));
        }

        // 6. Edge generation: connect sequential steps
        List<UserJourneyDiagramEdgeDto> edges = generateEdges(journey.getId(), sortedSteps);

        return new UserJourneyDiagramDto(
            DIAGRAM_TYPE, VERSION, journeyDto,
            lanes, stepDtos, edges, RENDER_HINTS
        );
    }

    private UserJourneyDiagramJourneyDto buildJourneyDto(UserJourneyEntity journey) {
        String userRoleName = null;
        if (journey.getPrimaryBusinessUserId() != null) {
            BusinessUserEntity primaryUser = businessUserRepository
                .findById(journey.getPrimaryBusinessUserId())
                .orElseThrow(() -> new ResourceNotFoundException(
                    "Primary business user not found: " + journey.getPrimaryBusinessUserId()));
            userRoleName = primaryUser.getName();
        }

        String parentBpName = null;
        if (journey.getParentBusinessProcessId() != null) {
            BusinessProcessEntity parentBp = businessProcessRepository
                .findById(journey.getParentBusinessProcessId())
                .orElseThrow(() -> new ResourceNotFoundException(
                    "Parent business process not found: " + journey.getParentBusinessProcessId()));
            parentBpName = parentBp.getName();
        }

        return new UserJourneyDiagramJourneyDto(
            journey.getId(),
            journey.getName(),
            journey.getDescription(),
            journey.getPrimaryBusinessUserId(),
            userRoleName,
            journey.getParentBusinessProcessId(),
            parentBpName
        );
    }

    /**
     * Derive lanes from unique applications in steps, ordered by first occurrence
     * in sequence_order. Tie-break by application_id alphabetical.
     */
    private List<UserJourneyDiagramLaneDto> deriveLanes(
            List<ActivityStepEntity> sortedSteps,
            Map<String, ApplicationEntity> appMap) {

        // Track first occurrence order for each application
        Map<String, Integer> firstOccurrence = new LinkedHashMap<>();
        for (ActivityStepEntity step : sortedSteps) {
            String appId = step.getApplicationId();
            if (!firstOccurrence.containsKey(appId)) {
                firstOccurrence.put(appId, step.getSequenceOrder() != null ? step.getSequenceOrder() : Integer.MAX_VALUE);
            }
        }

        // Sort application IDs by first occurrence, then alphabetically for tie-break
        List<String> orderedAppIds = firstOccurrence.entrySet().stream()
            .sorted(Comparator
                .<Map.Entry<String, Integer>, Integer>comparing(Map.Entry::getValue)
                .thenComparing(Map.Entry::getKey))
            .map(Map.Entry::getKey)
            .toList();

        List<UserJourneyDiagramLaneDto> lanes = new ArrayList<>();
        for (int i = 0; i < orderedAppIds.size(); i++) {
            String appId = orderedAppIds.get(i);
            ApplicationEntity app = appMap.get(appId);
            lanes.add(new UserJourneyDiagramLaneDto(app.getId(), app.getName(), i));
        }
        return lanes;
    }

    /**
     * Generate edges connecting sequential steps. N-1 edges for N steps.
     * Edge ID format: "edge-{journeyId}-{fromOrder}-{toOrder}"
     * is_cross_lane = true when consecutive steps have different applicationIds.
     */
    private List<UserJourneyDiagramEdgeDto> generateEdges(
            String journeyId,
            List<ActivityStepEntity> sortedSteps) {

        List<UserJourneyDiagramEdgeDto> edges = new ArrayList<>();
        for (int i = 0; i < sortedSteps.size() - 1; i++) {
            ActivityStepEntity from = sortedSteps.get(i);
            ActivityStepEntity to = sortedSteps.get(i + 1);

            int fromOrder = from.getSequenceOrder() != null ? from.getSequenceOrder() : 0;
            int toOrder = to.getSequenceOrder() != null ? to.getSequenceOrder() : 0;

            String edgeId = "edge-" + journeyId + "-" + fromOrder + "-" + toOrder;
            boolean isCrossLane = !from.getApplicationId().equals(to.getApplicationId());

            edges.add(new UserJourneyDiagramEdgeDto(
                edgeId, from.getId(), to.getId(), i, isCrossLane
            ));
        }
        return edges;
    }
}
