package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.jackson.CamelCaseWire;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * REST controller for the target-state conversation SAVE marker, sibling to
 * {@link ActiveTargetArchitectureController}.
 *
 * <p>Spec: Target-State Conversation -- Save, Resume, and Plan Sourcing
 * Decoupled from "Active" (2026-06-26) -- Task Group 2 (FR2).</p>
 *
 * <p>Two endpoints:</p>
 * <ul>
 *   <li>{@code POST /api/projects/{projectId}/target-architectures/{targetArchitectureId}/conversation-saved}
 *       -- stamps {@code conversation_saved_at = now()} on the target
 *       architecture row (the "Save Conversation" action) and returns the
 *       stamped instant. This is what turns a target-state conversation into a
 *       saveable / resumable / listable object decoupled from promoting a draft
 *       to "active".</li>
 *   <li>{@code GET /api/projects/{projectId}/saved-target-architecture-id}
 *       -- mirrors {@code GET .../active-target-architecture-id}: resolves the
 *       project's MOST-RECENT-SAVED target architecture id (newest
 *       {@code conversation_saved_at}) for the gateway resolver default,
 *       returning {@code savedTargetArchitectureId: null} when the project has
 *       no saved conversation.</li>
 * </ul>
 *
 * <p>Both inline response records are marked {@code @CamelCaseWire} because the
 * target-state UI speaks camelCase (matching
 * {@code ActiveTargetArchitectureIdResponse}).</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class SavedTargetArchitectureController {

    private static final String KIND_TARGET = "target";

    private final ArchitectureRepository architectureRepository;

    /**
     * POST /api/projects/{projectId}/target-architectures/{targetArchitectureId}/conversation-saved
     *
     * <p>Stamps {@code conversation_saved_at = now()} on the target
     * architecture and returns the stamped instant. Idempotent in effect --
     * each call re-stamps to the current instant (the most-recent-saved
     * ordering naturally surfaces the latest save).</p>
     *
     * @return 200 with the stamped {@code conversationSavedAt}; 404 when the
     *         architecture is missing or belongs to a different project
     */
    @PostMapping("/api/projects/{projectId}/target-architectures/{targetArchitectureId}/conversation-saved")
    public ResponseEntity<ConversationSavedResponse> markConversationSaved(
            @PathVariable UUID projectId,
            @PathVariable UUID targetArchitectureId) {
        log.info("POST /api/projects/{}/target-architectures/{}/conversation-saved",
            projectId, targetArchitectureId);

        ArchitectureEntity arch = architectureRepository.findById(targetArchitectureId)
            .filter(a -> projectId.equals(a.getProjectId()))
            .orElseThrow(() -> new ResourceNotFoundException(
                "Target architecture " + targetArchitectureId
                    + " not found in project " + projectId));

        Instant savedAt = Instant.now();
        arch.setConversationSavedAt(savedAt);
        architectureRepository.save(arch);

        return ResponseEntity.ok(new ConversationSavedResponse(arch.getConversationSavedAt()));
    }

    /**
     * GET /api/projects/{projectId}/saved-target-architecture-id
     *
     * <p>Resolves the project's most-recent-saved target architecture id by
     * selecting the newest {@code kind='target' AND archived=false} row whose
     * {@code conversation_saved_at} marker is set. Mirrors
     * {@code GET .../active-target-architecture-id} for the gateway resolver,
     * but keys off the save marker rather than {@code draft_state='active'}.</p>
     *
     * @return 200 with {@code savedTargetArchitectureId} populated when a saved
     *         target conversation exists, or {@code null} when none does (the
     *         resolver maps the latter to its "no saved conversation" copy)
     */
    @GetMapping("/api/projects/{projectId}/saved-target-architecture-id")
    public ResponseEntity<SavedTargetArchitectureIdResponse> getSavedTargetArchitectureId(
            @PathVariable UUID projectId) {
        log.debug("GET /api/projects/{}/saved-target-architecture-id", projectId);

        Optional<ArchitectureEntity> saved = architectureRepository
            .findFirstByProjectIdAndKindAndArchivedFalseAndConversationSavedAtIsNotNullOrderByConversationSavedAtDesc(
                projectId, KIND_TARGET);

        return ResponseEntity.ok(new SavedTargetArchitectureIdResponse(
            saved.map(ArchitectureEntity::getId).orElse(null)));
    }

    /**
     * Stamp response envelope. {@code @CamelCaseWire} -- the target-state UI
     * speaks camelCase.
     */
    @CamelCaseWire
    public record ConversationSavedResponse(Instant conversationSavedAt) {}

    /**
     * Saved-id response envelope. {@code @CamelCaseWire} -- mirrors
     * {@code ActiveTargetArchitectureIdResponse}.
     */
    @CamelCaseWire
    public record SavedTargetArchitectureIdResponse(UUID savedTargetArchitectureId) {}
}
