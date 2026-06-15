package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.OrganisationDto;
import com.example.architecturemodel.model.dto.OrganisationListItemDto;
import com.example.architecturemodel.service.OrganisationService;
import com.fasterxml.jackson.annotation.JsonAlias;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * REST Controller for Organisation operations.
 *
 * Provides endpoints for listing, creating, retrieving, and updating organisations.
 *
 * Spec 2026-01-18: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs
 * Spec 2026-01-19: Startup Configuration for Feature Toggles - Made conditional on includeDatabase
 * Spec 2026-01-31: Trigger Global Standards Generation - Added PATCH endpoint for flag update
 * Spec 2026-01-31: Fix Create Organisation Standards Flow - Added docsAppliedTo* fields to CreateOrganisationRequest
 */
@RestController
@RequestMapping("/api/v1/organisations")
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class OrganisationController {

    private final OrganisationService organisationService;

    public OrganisationController(OrganisationService organisationService) {
        this.organisationService = organisationService;
    }

    /**
     * Request body for creating an organisation.
     *
     * Spec 2026-01-31: Fix Create Organisation Standards Flow - Task Group 3
     * Expanded to include all six docsAppliedTo* list fields with @JsonAlias for snake_case support.
     * Supports both camelCase and snake_case JSON keys for compatibility.
     */
    public record CreateOrganisationRequest(
        @JsonAlias({"name"})
        String name,
        @JsonAlias({"description"})
        String description,
        @JsonAlias({"docsAppliedToAllSources"})
        List<String> docsAppliedToAllSources,
        @JsonAlias({"docsAppliedToTechStack"})
        List<String> docsAppliedToTechStack,
        @JsonAlias({"docsAppliedToCodingStyles"})
        List<String> docsAppliedToCodingStyles,
        @JsonAlias({"docsAppliedToConventions"})
        List<String> docsAppliedToConventions,
        @JsonAlias({"docsAppliedToErrorHandling"})
        List<String> docsAppliedToErrorHandling,
        @JsonAlias({"docsAppliedToValidation"})
        List<String> docsAppliedToValidation
    ) {}

    /**
     * Request body for updating an organisation.
     *
     * Spec 2026-01-31: Trigger Global Standards Generation - Task Group 1
     * Supports partial updates - only provided fields are updated.
     * Supports both camelCase and snake_case JSON keys for compatibility.
     */
    public record UpdateOrganisationRequest(
        @JsonAlias({"techStandardsGenerated"})
        Boolean techStandardsGenerated
    ) {}

    /**
     * Lists all organisations ordered by name.
     *
     * GET /api/v1/organisations
     *
     * Returns array of {id, name} objects for autocomplete.
     *
     * @return List of OrganisationListItemDto with HTTP 200
     */
    @GetMapping
    public ResponseEntity<List<OrganisationListItemDto>> listOrganisations() {
        log.debug("GET /api/v1/organisations - Listing organisations");
        List<OrganisationListItemDto> organisations = organisationService.listOrganisations();
        return ResponseEntity.ok(organisations);
    }

    /**
     * Gets an organisation by exact name.
     *
     * GET /api/v1/organisations/by-name/{name}
     *
     * @param name The organisation name (path variable)
     * @return OrganisationDto with HTTP 200 if found, or 404 if not found
     */
    @GetMapping("/by-name/{name}")
    public ResponseEntity<OrganisationDto> getOrganisationByName(@PathVariable String name) {
        log.debug("GET /api/v1/organisations/by-name/{} - Getting organisation by name", name);
        OrganisationDto organisation = organisationService.getOrganisationByName(name);
        return ResponseEntity.ok(organisation);
    }

    /**
     * Creates a new organisation.
     *
     * POST /api/v1/organisations
     * Body: { name: string, description?: string, docsAppliedTo*?: string[] }
     *
     * Spec 2026-01-31: Fix Create Organisation Standards Flow - Task Group 3
     * Now accepts all six docsAppliedTo* list fields for persistence.
     *
     * @param request The create organisation request
     * @return OrganisationDto with HTTP 201 on success
     *         HTTP 400 if name is blank
     *         HTTP 409 if organisation with name already exists
     */
    @PostMapping
    public ResponseEntity<OrganisationDto> createOrganisation(@RequestBody CreateOrganisationRequest request) {
        log.info("POST /api/v1/organisations - Creating organisation: {}", request.name());
        OrganisationDto created = organisationService.createOrganisation(
                request.name(),
                request.description(),
                request.docsAppliedToAllSources(),
                request.docsAppliedToTechStack(),
                request.docsAppliedToCodingStyles(),
                request.docsAppliedToConventions(),
                request.docsAppliedToErrorHandling(),
                request.docsAppliedToValidation()
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /**
     * Updates an organisation (partial update).
     *
     * PATCH /api/v1/organisations/{id}
     * Body: { tech_standards_generated?: boolean }
     *
     * Spec 2026-01-31: Trigger Global Standards Generation - Task Group 1
     * Only updates the provided fields, preserving existing values for unset fields.
     *
     * @param id The organisation ID (path variable)
     * @param request The update organisation request containing optional fields
     * @return OrganisationDto with HTTP 200 on success
     *         HTTP 404 if organisation with ID not found
     */
    @PatchMapping("/{id}")
    public ResponseEntity<OrganisationDto> updateOrganisation(
            @PathVariable String id,
            @RequestBody UpdateOrganisationRequest request) {
        log.info("PATCH /api/v1/organisations/{} - Updating organisation: techStandardsGenerated={}",
            id, request.techStandardsGenerated());
        OrganisationDto updated = organisationService.updateOrganisation(id, request.techStandardsGenerated());
        return ResponseEntity.ok(updated);
    }
}
