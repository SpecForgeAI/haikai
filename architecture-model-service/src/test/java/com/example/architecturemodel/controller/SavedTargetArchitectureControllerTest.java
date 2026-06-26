package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link SavedTargetArchitectureController} (stamp endpoint +
 * most-recent-saved id endpoint).
 *
 * <p>Spec: Target-State Conversation Save/Resume/Plan-Sourcing (2026-06-26) --
 * Task Group 2 (FR2).</p>
 */
@ExtendWith(MockitoExtension.class)
class SavedTargetArchitectureControllerTest {

    @Mock
    private ArchitectureRepository architectureRepository;

    @InjectMocks
    private SavedTargetArchitectureController controller;

    @Test
    @DisplayName("stamp endpoint sets conversation_saved_at = now() and returns the stamped instant")
    void markConversationSaved_stampsNowAndReturnsInstant() {
        UUID projectId = UUID.randomUUID();
        UUID archId = UUID.randomUUID();
        ArchitectureEntity arch = ArchitectureEntity.builder()
            .id(archId)
            .projectId(projectId)
            .name("Saved target")
            .kind("target")
            .draftState("draft")
            .conversationSavedAt(null)
            .build();

        when(architectureRepository.findById(archId)).thenReturn(Optional.of(arch));
        when(architectureRepository.save(any(ArchitectureEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        Instant before = Instant.now();
        ResponseEntity<SavedTargetArchitectureController.ConversationSavedResponse> response =
            controller.markConversationSaved(projectId, archId);
        Instant after = Instant.now();

        // The entity is stamped...
        ArgumentCaptor<ArchitectureEntity> saved = ArgumentCaptor.forClass(ArchitectureEntity.class);
        verify(architectureRepository).save(saved.capture());
        assertThat(saved.getValue().getConversationSavedAt()).isNotNull();

        // ...and the stamped instant (now()) is returned on the body.
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        Instant stamped = response.getBody().conversationSavedAt();
        assertThat(stamped).isNotNull();
        assertThat(stamped).isBetween(before, after);
        assertThat(stamped).isEqualTo(saved.getValue().getConversationSavedAt());
    }

    @Test
    @DisplayName("stamp endpoint 404s (ResourceNotFoundException) for a cross-project / missing architecture, without saving")
    void markConversationSaved_crossProject_throwsNotFound() {
        UUID projectId = UUID.randomUUID();
        UUID archId = UUID.randomUUID();
        ArchitectureEntity otherProjectArch = ArchitectureEntity.builder()
            .id(archId)
            .projectId(UUID.randomUUID()) // different project
            .name("Foreign target")
            .kind("target")
            .build();
        when(architectureRepository.findById(archId)).thenReturn(Optional.of(otherProjectArch));

        assertThatThrownBy(() -> controller.markConversationSaved(projectId, archId))
            .isInstanceOf(ResourceNotFoundException.class);

        verify(architectureRepository, never()).save(any());
    }

    @Test
    @DisplayName("saved-id endpoint returns the most-recent-saved id when a saved conversation exists")
    void getSavedTargetArchitectureId_returnsId() {
        UUID projectId = UUID.randomUUID();
        UUID savedId = UUID.randomUUID();
        ArchitectureEntity saved = ArchitectureEntity.builder()
            .id(savedId)
            .projectId(projectId)
            .name("Most-recent-saved")
            .kind("target")
            .conversationSavedAt(Instant.parse("2026-06-26T10:00:00Z"))
            .build();
        when(architectureRepository
            .findFirstByProjectIdAndKindAndArchivedFalseAndConversationSavedAtIsNotNullOrderByConversationSavedAtDesc(
                projectId, "target"))
            .thenReturn(Optional.of(saved));

        ResponseEntity<SavedTargetArchitectureController.SavedTargetArchitectureIdResponse> response =
            controller.getSavedTargetArchitectureId(projectId);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody().savedTargetArchitectureId()).isEqualTo(savedId);
    }

    @Test
    @DisplayName("saved-id endpoint returns null when the project has no saved conversation")
    void getSavedTargetArchitectureId_returnsNullWhenNoneSaved() {
        UUID projectId = UUID.randomUUID();
        when(architectureRepository
            .findFirstByProjectIdAndKindAndArchivedFalseAndConversationSavedAtIsNotNullOrderByConversationSavedAtDesc(
                projectId, "target"))
            .thenReturn(Optional.empty());

        ResponseEntity<SavedTargetArchitectureController.SavedTargetArchitectureIdResponse> response =
            controller.getSavedTargetArchitectureId(projectId);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody().savedTargetArchitectureId()).isNull();
    }
}
