package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.DeliveryTeamMapper;
import com.example.architecturemodel.model.dto.DeliveryTeamDto;
import com.example.architecturemodel.model.entity.DeliveryTeamEntity;
import com.example.architecturemodel.model.entity.DeliveryTeamType;
import com.example.architecturemodel.repository.DeliveryTeamRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for managing Delivery Teams.
 *
 * Provides operations for listing, retrieving, creating, updating, and deleting
 * delivery teams scoped to a project. Enforces case-insensitive unique name
 * constraint per project and validates input.
 *
 * Spec: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)
 */
@Service
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class DeliveryTeamService {

    private final DeliveryTeamRepository deliveryTeamRepository;
    private final DeliveryTeamMapper deliveryTeamMapper;

    public DeliveryTeamService(DeliveryTeamRepository deliveryTeamRepository,
                                DeliveryTeamMapper deliveryTeamMapper) {
        this.deliveryTeamRepository = deliveryTeamRepository;
        this.deliveryTeamMapper = deliveryTeamMapper;
    }

    /**
     * Lists all delivery teams for a project, ordered by name ascending.
     *
     * @param projectId The project UUID
     * @return List of DeliveryTeamDto ordered alphabetically by name
     */
    @Transactional(readOnly = true)
    public List<DeliveryTeamDto> list(UUID projectId) {
        log.debug("Listing delivery teams for project: {}", projectId);
        return deliveryTeamRepository.findByProjectIdOrderByNameAsc(projectId).stream()
            .map(deliveryTeamMapper::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Gets a delivery team by ID, scoped to a project.
     *
     * @param projectId The project UUID
     * @param teamId The delivery team UUID
     * @return DeliveryTeamDto if found and belongs to the given project
     * @throws ResourceNotFoundException if not found or if the team does not belong to the given project
     */
    @Transactional(readOnly = true)
    public DeliveryTeamDto getById(UUID projectId, UUID teamId) {
        log.debug("Getting delivery team {} for project: {}", teamId, projectId);
        DeliveryTeamEntity entity = deliveryTeamRepository.findById(teamId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Delivery team not found with id: " + teamId));

        if (!entity.getProjectId().equals(projectId)) {
            throw new ResourceNotFoundException(
                "Delivery team not found with id: " + teamId);
        }

        return deliveryTeamMapper.toDto(entity);
    }

    /**
     * Creates a new delivery team for a project.
     *
     * @param projectId The project UUID
     * @param name The team name (required, non-blank, max 120 chars)
     * @param type The team type (must be a valid DeliveryTeamType enum value)
     * @param description Optional description
     * @return The created DeliveryTeamDto
     * @throws IllegalArgumentException if name is blank/null or exceeds 120 chars, or if type is invalid
     * @throws ConflictException if a team with the same name already exists in the project (case-insensitive)
     */
    @Transactional
    public DeliveryTeamDto create(UUID projectId, String name, String type, String description) {
        log.info("Creating delivery team for project: {}, name: '{}'", projectId, name);

        validateName(name);
        validateType(type);

        String trimmedName = name.trim();

        // Check for duplicate name (case-insensitive) within the project
        if (deliveryTeamRepository.existsByProjectIdAndNameIgnoreCase(projectId, trimmedName)) {
            log.warn("Delivery team creation failed - duplicate name (case-insensitive): {}", trimmedName);
            throw new ConflictException(
                "Delivery team with name '" + trimmedName + "' already exists in this project (case-insensitive)");
        }

        DeliveryTeamEntity entity = DeliveryTeamEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .name(trimmedName)
            .type(type.toUpperCase())
            .description(description)
            .build();

        DeliveryTeamEntity saved = deliveryTeamRepository.save(entity);
        log.info("Created delivery team with id: {}", saved.getId());

        return deliveryTeamMapper.toDto(saved);
    }

    /**
     * Updates an existing delivery team.
     *
     * @param projectId The project UUID
     * @param teamId The delivery team UUID
     * @param name The updated team name (required, non-blank, max 120 chars)
     * @param type The updated team type (must be a valid DeliveryTeamType enum value)
     * @param description The updated description
     * @return The updated DeliveryTeamDto
     * @throws ResourceNotFoundException if the team is not found
     * @throws IllegalArgumentException if name is blank/null or exceeds 120 chars, or if type is invalid
     * @throws ConflictException if another team with the same name exists in the project (case-insensitive)
     */
    @Transactional
    public DeliveryTeamDto update(UUID projectId, UUID teamId, String name, String type, String description) {
        log.info("Updating delivery team {} for project: {}", teamId, projectId);

        DeliveryTeamEntity entity = deliveryTeamRepository.findById(teamId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Delivery team not found with id: " + teamId));

        if (!entity.getProjectId().equals(projectId)) {
            throw new ResourceNotFoundException(
                "Delivery team not found with id: " + teamId);
        }

        validateName(name);
        validateType(type);

        String trimmedName = name.trim();

        // Duplicate name check excludes self: find by name, check if found entity has different ID
        Optional<DeliveryTeamEntity> existingWithName =
            deliveryTeamRepository.findByProjectIdAndNameIgnoreCase(projectId, trimmedName);
        if (existingWithName.isPresent() && !existingWithName.get().getId().equals(teamId)) {
            log.warn("Delivery team update failed - duplicate name (case-insensitive): {}", trimmedName);
            throw new ConflictException(
                "Delivery team with name '" + trimmedName + "' already exists in this project (case-insensitive)");
        }

        entity.setName(trimmedName);
        entity.setType(type.toUpperCase());
        entity.setDescription(description);

        DeliveryTeamEntity saved = deliveryTeamRepository.save(entity);
        log.info("Updated delivery team with id: {}", saved.getId());

        return deliveryTeamMapper.toDto(saved);
    }

    /**
     * Deletes a delivery team.
     *
     * The database FK ON DELETE SET NULL automatically nulls work item references.
     *
     * @param projectId The project UUID
     * @param teamId The delivery team UUID
     * @throws ResourceNotFoundException if the team is not found
     */
    @Transactional
    public void delete(UUID projectId, UUID teamId) {
        log.info("Deleting delivery team {} for project: {}", teamId, projectId);

        DeliveryTeamEntity entity = deliveryTeamRepository.findById(teamId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Delivery team not found with id: " + teamId));

        if (!entity.getProjectId().equals(projectId)) {
            throw new ResourceNotFoundException(
                "Delivery team not found with id: " + teamId);
        }

        deliveryTeamRepository.delete(entity);
        log.info("Deleted delivery team with id: {}", teamId);
    }

    /**
     * Validates the team name: must be non-null, non-blank, and max 120 characters.
     */
    private void validateName(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Delivery team name is required");
        }
        if (name.trim().length() > 120) {
            throw new IllegalArgumentException("Delivery team name must not exceed 120 characters");
        }
    }

    /**
     * Validates the team type against the DeliveryTeamType enum.
     */
    private void validateType(String type) {
        if (type == null || type.isBlank()) {
            throw new IllegalArgumentException("Delivery team type is required");
        }
        try {
            DeliveryTeamType.valueOf(type.toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException(
                "Invalid delivery team type: '" + type + "'. Must be one of: INTERNAL, EXTERNAL");
        }
    }
}
