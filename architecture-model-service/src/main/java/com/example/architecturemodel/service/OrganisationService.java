package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.OrganisationMapper;
import com.example.architecturemodel.model.dto.OrganisationDto;
import com.example.architecturemodel.model.dto.OrganisationListItemDto;
import com.example.architecturemodel.model.entity.OrganisationEntity;
import com.example.architecturemodel.repository.OrganisationRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for managing Organisations.
 *
 * Provides operations for creating, listing, retrieving, and updating organisations.
 * Enforces case-insensitive unique name constraint and validates input.
 *
 * Spec 2026-01-18: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs
 * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Changed ID generation and method signatures
 * Spec 2026-01-19: Startup Configuration for Feature Toggles - Made conditional on includeDatabase
 * Spec 2026-01-31: Organisation Model + DB + API DTOs - Added case-insensitive uniqueness and new fields
 * Spec 2026-01-31: Trigger Global Standards Generation - Added updateOrganisation method for partial updates
 * Spec 2026-01-31: Fix Create Organisation Standards Flow - Expanded createOrganisation to accept docsAppliedTo* fields
 */
@Service
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class OrganisationService {

    private final OrganisationRepository organisationRepository;
    private final OrganisationMapper organisationMapper;

    public OrganisationService(OrganisationRepository organisationRepository, OrganisationMapper organisationMapper) {
        this.organisationRepository = organisationRepository;
        this.organisationMapper = organisationMapper;
    }

    /**
     * Lists all organisations ordered by name ascending.
     *
     * @return List of OrganisationListItemDto (id, name only) ordered by name
     */
    @Transactional(readOnly = true)
    public List<OrganisationListItemDto> listOrganisations() {
        log.debug("Listing all organisations");
        return organisationRepository.findAllByOrderByNameAsc().stream()
            .map(organisationMapper::toListItemDto)
            .collect(Collectors.toList());
    }

    /**
     * Gets an organisation by its exact name.
     *
     * @param name The organisation name to lookup
     * @return OrganisationDto if found
     * @throws ResourceNotFoundException if organisation with name not found
     */
    @Transactional(readOnly = true)
    public OrganisationDto getOrganisationByName(String name) {
        log.debug("Getting organisation by name: {}", name);
        return organisationRepository.findByName(name)
            .map(organisationMapper::toDto)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Organisation not found with name: " + name));
    }

    /**
     * Gets an organisation by its ID.
     *
     * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Changed parameter from UUID to String
     *
     * @param id The organisation ID (String, e.g., "org-xxxx")
     * @return OrganisationDto if found
     * @throws ResourceNotFoundException if organisation with ID not found
     */
    @Transactional(readOnly = true)
    public OrganisationDto getOrganisationById(String id) {
        log.debug("Getting organisation by id: {}", id);
        return organisationRepository.findById(id)
            .map(organisationMapper::toDto)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Organisation not found with id: " + id));
    }

    /**
     * Creates a new organisation with name and description only (convenience overload).
     *
     * Delegates to full createOrganisation method with empty lists for all docsAppliedTo* fields.
     * Maintains backwards compatibility with existing code.
     *
     * @param name The organisation name (required, unique case-insensitively)
     * @param description Optional description
     * @return The created OrganisationDto
     * @throws IllegalArgumentException if name is blank or null
     * @throws ConflictException if organisation with same name already exists (case-insensitive)
     */
    @Transactional
    public OrganisationDto createOrganisation(String name, String description) {
        return createOrganisation(name, description, null, null, null, null, null, null);
    }

    /**
     * Creates a new organisation with all docsAppliedTo* fields.
     *
     * Validates that:
     * - Name is non-empty (throws IllegalArgumentException if blank)
     * - Name is unique case-insensitively (throws ConflictException if duplicate)
     *
     * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Changed ID generation
     * to use "org-" + UUID.randomUUID() format for consistency with other entities.
     * Spec 2026-01-31: Uses case-insensitive name checking and initializes new fields with defaults.
     * Spec 2026-01-31: Fix Create Organisation Standards Flow - Task Group 3:
     * Expanded signature to accept all six docsAppliedTo* list fields.
     *
     * @param name The organisation name (required, unique case-insensitively)
     * @param description Optional description
     * @param docsAppliedToAllSources List of document references for all sources (null becomes empty)
     * @param docsAppliedToTechStack List of document references for tech stack (null becomes empty)
     * @param docsAppliedToCodingStyles List of document references for coding styles (null becomes empty)
     * @param docsAppliedToConventions List of document references for conventions (null becomes empty)
     * @param docsAppliedToErrorHandling List of document references for error handling (null becomes empty)
     * @param docsAppliedToValidation List of document references for validation (null becomes empty)
     * @return The created OrganisationDto
     * @throws IllegalArgumentException if name is blank or null
     * @throws ConflictException if organisation with same name already exists (case-insensitive)
     */
    @Transactional
    public OrganisationDto createOrganisation(
            String name,
            String description,
            List<String> docsAppliedToAllSources,
            List<String> docsAppliedToTechStack,
            List<String> docsAppliedToCodingStyles,
            List<String> docsAppliedToConventions,
            List<String> docsAppliedToErrorHandling,
            List<String> docsAppliedToValidation) {
        log.info("Creating organisation: name='{}'", name);

        // Validate name is non-empty
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Organisation name is required");
        }

        String trimmedName = name.trim();

        // Check for duplicate name (case-insensitive)
        if (organisationRepository.existsByNameIgnoreCase(trimmedName)) {
            log.warn("Organisation creation failed - duplicate name (case-insensitive): {}", trimmedName);
            throw new ConflictException("Organisation with name '" + trimmedName + "' already exists (case-insensitive)");
        }

        // Generate prefixed String ID for consistency with TEXT ID pattern
        String orgId = "org-" + UUID.randomUUID().toString();

        // Build entity with all fields
        // Null lists are normalized to empty lists to ensure consistent behavior
        OrganisationEntity entity = OrganisationEntity.builder()
            .id(orgId)
            .name(trimmedName)
            .description(description != null ? description.trim() : null)
            .docsAppliedToAllSources(normalizeList(docsAppliedToAllSources))
            .docsAppliedToTechStack(normalizeList(docsAppliedToTechStack))
            .docsAppliedToCodingStyles(normalizeList(docsAppliedToCodingStyles))
            .docsAppliedToConventions(normalizeList(docsAppliedToConventions))
            .docsAppliedToErrorHandling(normalizeList(docsAppliedToErrorHandling))
            .docsAppliedToValidation(normalizeList(docsAppliedToValidation))
            .build();

        OrganisationEntity saved = organisationRepository.save(entity);
        log.info("Created organisation with id: {}", saved.getId());

        return organisationMapper.toDto(saved);
    }

    /**
     * Normalizes a list by converting null to empty ArrayList.
     *
     * @param list The list to normalize (may be null)
     * @return The original list if not null, or a new empty ArrayList if null
     */
    private List<String> normalizeList(List<String> list) {
        return list != null ? list : new ArrayList<>();
    }

    /**
     * Updates an organisation (partial update).
     *
     * Spec 2026-01-31: Trigger Global Standards Generation - Task Group 1
     * Only updates the provided fields, preserving existing values for unset fields.
     *
     * @param id The organisation ID
     * @param techStandardsGenerated Optional flag to update (null means don't change)
     * @return The updated OrganisationDto
     * @throws ResourceNotFoundException if organisation with ID not found
     */
    @Transactional
    public OrganisationDto updateOrganisation(String id, Boolean techStandardsGenerated) {
        log.info("Updating organisation: id={}, techStandardsGenerated={}", id, techStandardsGenerated);

        OrganisationEntity entity = organisationRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Organisation not found with id: " + id));

        // Only update if value is provided
        if (techStandardsGenerated != null) {
            entity.setTechStandardsGenerated(techStandardsGenerated);
        }

        OrganisationEntity saved = organisationRepository.save(entity);
        log.info("Updated organisation with id: {}", saved.getId());

        return organisationMapper.toDto(saved);
    }
}
