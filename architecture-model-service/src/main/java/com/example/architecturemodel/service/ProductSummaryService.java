package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ProductSummaryDto;
import com.example.architecturemodel.model.dto.ProductSummaryDto.InitiativeSummary;
import com.example.architecturemodel.model.dto.ProductSummaryDto.EpicSummary;
import com.example.architecturemodel.model.dto.ProductSummaryDto.FeatureSummary;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Service for generating product summary for the Bootstrap phase.
 *
 * Builds a hierarchical structure of the Product Book of Work:
 * Initiatives > Epics > Features (excluding Stories for conciseness).
 *
 * This summary is designed for LLM context enrichment during the
 * Implementation Assistant bootstrap phase.
 *
 * Spec: Implement Assistant Stage 3 - Bootstrap Phase
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ProductSummaryService {

    private final WorkItemRepository workItemRepository;
    private final ProjectRepository projectRepository;

    /**
     * Get the product summary for a project.
     *
     * @param projectId the project ID (filename)
     * @return ProductSummaryDto with hierarchical work item structure
     * @throws ResourceNotFoundException if project not found
     */
    @Transactional(readOnly = true)
    public ProductSummaryDto getProductSummary(UUID projectId) {
        log.debug("Getting product summary for project: {}", projectId);

        // Verify project exists by UUID
        if (!projectRepository.existsById(projectId)) {
            throw new ResourceNotFoundException("Project not found: " + projectId);
        }

        // Get all work items for the project
        List<WorkItemEntity> allWorkItems = workItemRepository
            .findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(projectId);

        if (allWorkItems.isEmpty()) {
            log.debug("No work items found for project: {}", projectId);
            return new ProductSummaryDto(List.of());
        }

        // Group by type for easier lookup
        Map<String, List<WorkItemEntity>> byType = allWorkItems.stream()
            .collect(Collectors.groupingBy(WorkItemEntity::getType));

        // Build parent-to-children map
        Map<UUID, List<WorkItemEntity>> childrenByParentId = allWorkItems.stream()
            .filter(wi -> wi.getParentId() != null)
            .collect(Collectors.groupingBy(WorkItemEntity::getParentId));

        // Build hierarchical structure starting from initiatives
        List<WorkItemEntity> initiatives = byType.getOrDefault("INITIATIVE", List.of());

        List<InitiativeSummary> initiativeSummaries = initiatives.stream()
            .map(initiative -> buildInitiativeSummary(initiative, childrenByParentId))
            .collect(Collectors.toList());

        log.debug("Built product summary with {} initiatives for project: {}",
            initiativeSummaries.size(), projectId);

        return new ProductSummaryDto(initiativeSummaries);
    }

    /**
     * Build an InitiativeSummary from an Initiative work item.
     *
     * @param initiative the initiative entity
     * @param childrenByParentId map of parent ID to child work items
     * @return InitiativeSummary with nested epics
     */
    private InitiativeSummary buildInitiativeSummary(
            WorkItemEntity initiative,
            Map<UUID, List<WorkItemEntity>> childrenByParentId) {

        List<WorkItemEntity> epics = childrenByParentId
            .getOrDefault(initiative.getId(), List.of())
            .stream()
            .filter(wi -> "EPIC".equals(wi.getType()))
            .collect(Collectors.toList());

        List<EpicSummary> epicSummaries = epics.stream()
            .map(epic -> buildEpicSummary(epic, childrenByParentId))
            .collect(Collectors.toList());

        return new InitiativeSummary(
            initiative.getId().toString(),
            initiative.getTitle(),
            initiative.getDescription(),
            epicSummaries
        );
    }

    /**
     * Build an EpicSummary from an Epic work item.
     *
     * @param epic the epic entity
     * @param childrenByParentId map of parent ID to child work items
     * @return EpicSummary with nested features
     */
    private EpicSummary buildEpicSummary(
            WorkItemEntity epic,
            Map<UUID, List<WorkItemEntity>> childrenByParentId) {

        List<WorkItemEntity> features = childrenByParentId
            .getOrDefault(epic.getId(), List.of())
            .stream()
            .filter(wi -> "FEATURE".equals(wi.getType()))
            .collect(Collectors.toList());

        List<FeatureSummary> featureSummaries = features.stream()
            .map(this::buildFeatureSummary)
            .collect(Collectors.toList());

        return new EpicSummary(
            epic.getId().toString(),
            epic.getTitle(),
            epic.getDescription(),
            featureSummaries
        );
    }

    /**
     * Build a FeatureSummary from a Feature work item.
     * Stories are intentionally excluded for conciseness.
     *
     * @param feature the feature entity
     * @return FeatureSummary (without stories)
     */
    private FeatureSummary buildFeatureSummary(WorkItemEntity feature) {
        return new FeatureSummary(
            feature.getId().toString(),
            feature.getTitle(),
            feature.getDescription()
        );
    }
}
