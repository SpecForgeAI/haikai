package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * End-to-end (real-persistence) integration for the SAVE marker chain that the
 * unit tests only exercise in isolation:
 *
 * <ul>
 *   <li>{@code SavedTargetArchitectureControllerTest} mocks the repository, so
 *       it never proves a stamp actually lands in the schema.</li>
 *   <li>{@code ArchitectureSavedConversationFinderTest} persists the marker
 *       directly, so it never proves the stamp endpoint sets it.</li>
 * </ul>
 *
 * <p>This test wires the REAL {@link SavedTargetArchitectureController} over the
 * REAL {@link ArchitectureRepository} (H2 under {@code @DataJpaTest}) to pin the
 * critical seam end-to-end: stamping a target via the controller makes THAT
 * target the project's most-recent-saved through the saved-id endpoint --
 * decoupled from {@code draft_state='active'} -- and the newest save wins.</p>
 *
 * <p>Spec: Target-State Conversation -- Save, Resume, and Plan Sourcing
 * Decoupled from "Active" (2026-06-26) -- Task Group 6 (cross-tier gap fill).</p>
 */
@DataJpaTest
@ActiveProfiles("test")
class SavedTargetArchitectureEndToEndIntegrationTest {

    @Autowired
    private ArchitectureRepository architectureRepository;

    private SavedTargetArchitectureController controller;

    @BeforeEach
    void setUp() {
        controller = new SavedTargetArchitectureController(architectureRepository);
    }

    private ArchitectureEntity persist(UUID projectId, String name, String draftState,
                                       Instant savedAt) {
        ArchitectureEntity e = ArchitectureEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .name(name)
            .kind("target")
            .draftState(draftState)
            .archived(false)
            .conversationSavedAt(savedAt)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        return architectureRepository.saveAndFlush(e);
    }

    @Test
    @DisplayName("stamping a target via the controller makes IT the most-recent-saved, NOT the active-but-unsaved target")
    void stampViaEndpoint_makesTargetMostRecentSaved_decoupledFromActive() {
        UUID projectId = UUID.randomUUID();

        // The "active" target -- promoted draft, but its conversation was never
        // saved. The save marker (not draft_state) must drive the saved-id read.
        persist(projectId, "Active target (never saved)", "active", null);
        // A separate DRAFT target whose conversation we are about to save.
        ArchitectureEntity draft = persist(projectId, "Draft target", "draft", null);

        // Nothing saved yet -> the saved-id endpoint resolves to null even though
        // an ACTIVE target exists (the two markers are decoupled).
        assertThat(controller.getSavedTargetArchitectureId(projectId)
            .getBody().savedTargetArchitectureId()).isNull();

        // Save the DRAFT conversation through the real stamp endpoint.
        var stampBody = controller.markConversationSaved(projectId, draft.getId()).getBody();
        assertThat(stampBody).isNotNull();
        assertThat(stampBody.conversationSavedAt()).isNotNull();

        // The stamped target is now the project's most-recent-saved -- resolved
        // off the persisted marker, NOT the active row.
        assertThat(controller.getSavedTargetArchitectureId(projectId)
            .getBody().savedTargetArchitectureId()).isEqualTo(draft.getId());
    }

    @Test
    @DisplayName("the latest stamp wins: re-saving a newer target supersedes a previously-saved target as most-recent-saved")
    void latestStampWins_overPreviouslySavedTarget() {
        UUID projectId = UUID.randomUUID();

        // A target saved well in the past (marker set directly to back-date it).
        ArchitectureEntity previouslySaved =
            persist(projectId, "Previously saved target", "draft",
                Instant.parse("2026-01-01T00:00:00Z"));
        // A second target not yet saved.
        ArchitectureEntity newer = persist(projectId, "Newer target", "draft", null);

        // Only the back-dated target is saved so far.
        assertThat(controller.getSavedTargetArchitectureId(projectId)
            .getBody().savedTargetArchitectureId()).isEqualTo(previouslySaved.getId());

        // Saving the newer target stamps now() (clearly after 2026-01-01), so it
        // becomes the most-recent-saved -- the ordering reflects the latest save.
        controller.markConversationSaved(projectId, newer.getId());

        assertThat(controller.getSavedTargetArchitectureId(projectId)
            .getBody().savedTargetArchitectureId()).isEqualTo(newer.getId());
    }
}
