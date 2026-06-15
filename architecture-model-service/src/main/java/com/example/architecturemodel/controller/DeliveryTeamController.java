package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DeliveryTeamDto;
import com.example.architecturemodel.service.DeliveryTeamService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * REST Controller for DeliveryTeam operations.
 *
 * Provides CRUD endpoints for managing delivery teams within a project.
 *
 * Base path: /api/projects/{projectId}/delivery-teams
 *
 * Spec: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)
 */
@RestController
@RequestMapping("/api/projects/{projectId}/delivery-teams")
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class DeliveryTeamController {

    private final DeliveryTeamService deliveryTeamService;

    public DeliveryTeamController(DeliveryTeamService deliveryTeamService) {
        this.deliveryTeamService = deliveryTeamService;
    }

    /**
     * Request body for creating a delivery team.
     */
    public record CreateDeliveryTeamRequest(String name, String type, String description) {}

    /**
     * Request body for updating a delivery team.
     */
    public record UpdateDeliveryTeamRequest(String name, String type, String description) {}

    /**
     * GET /api/projects/{projectId}/delivery-teams
     *
     * List all delivery teams for a project, ordered by name ascending.
     *
     * @param projectId the project UUID
     * @return list of delivery teams with HTTP 200
     */
    @GetMapping
    public ResponseEntity<List<DeliveryTeamDto>> listDeliveryTeams(
            @PathVariable UUID projectId) {
        log.debug("GET /api/projects/{}/delivery-teams", projectId);
        List<DeliveryTeamDto> teams = deliveryTeamService.list(projectId);
        return ResponseEntity.ok(teams);
    }

    /**
     * GET /api/projects/{projectId}/delivery-teams/{teamId}
     *
     * Get a single delivery team by ID.
     *
     * @param projectId the project UUID
     * @param teamId the delivery team UUID
     * @return the delivery team with HTTP 200, or 404 if not found
     */
    @GetMapping("/{teamId}")
    public ResponseEntity<DeliveryTeamDto> getDeliveryTeam(
            @PathVariable UUID projectId,
            @PathVariable UUID teamId) {
        log.debug("GET /api/projects/{}/delivery-teams/{}", projectId, teamId);
        DeliveryTeamDto team = deliveryTeamService.getById(projectId, teamId);
        return ResponseEntity.ok(team);
    }

    /**
     * POST /api/projects/{projectId}/delivery-teams
     *
     * Create a new delivery team.
     *
     * @param projectId the project UUID
     * @param request the create request body
     * @return the created delivery team with HTTP 201
     */
    @PostMapping
    public ResponseEntity<DeliveryTeamDto> createDeliveryTeam(
            @PathVariable UUID projectId,
            @RequestBody CreateDeliveryTeamRequest request) {
        log.info("POST /api/projects/{}/delivery-teams - name='{}'", projectId, request.name());
        DeliveryTeamDto created = deliveryTeamService.create(
            projectId, request.name(), request.type(), request.description());
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /**
     * PUT /api/projects/{projectId}/delivery-teams/{teamId}
     *
     * Update an existing delivery team.
     *
     * @param projectId the project UUID
     * @param teamId the delivery team UUID
     * @param request the update request body
     * @return the updated delivery team with HTTP 200
     */
    @PutMapping("/{teamId}")
    public ResponseEntity<DeliveryTeamDto> updateDeliveryTeam(
            @PathVariable UUID projectId,
            @PathVariable UUID teamId,
            @RequestBody UpdateDeliveryTeamRequest request) {
        log.info("PUT /api/projects/{}/delivery-teams/{}", projectId, teamId);
        DeliveryTeamDto updated = deliveryTeamService.update(
            projectId, teamId, request.name(), request.type(), request.description());
        return ResponseEntity.ok(updated);
    }

    /**
     * DELETE /api/projects/{projectId}/delivery-teams/{teamId}
     *
     * Delete a delivery team. Database FK ON DELETE SET NULL automatically
     * nulls work item references.
     *
     * @param projectId the project UUID
     * @param teamId the delivery team UUID
     * @return HTTP 204 No Content on success
     */
    @DeleteMapping("/{teamId}")
    public ResponseEntity<Void> deleteDeliveryTeam(
            @PathVariable UUID projectId,
            @PathVariable UUID teamId) {
        log.info("DELETE /api/projects/{}/delivery-teams/{}", projectId, teamId);
        deliveryTeamService.delete(projectId, teamId);
        return ResponseEntity.noContent().build();
    }
}
