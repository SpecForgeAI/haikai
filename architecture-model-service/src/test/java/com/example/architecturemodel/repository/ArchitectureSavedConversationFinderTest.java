package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.ArchitectureEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies the two NEW saved-conversation finders on
 * {@link ArchitectureRepository} against a real (H2) schema:
 *
 * <ul>
 *   <li>most-recent-saved:
 *       {@code findFirstByProjectIdAndKindAndArchivedFalseAndConversationSavedAtIsNotNullOrderByConversationSavedAtDesc}
 *       returns the newest saved target (empty when none are saved).</li>
 *   <li>list-saved:
 *       {@code findByProjectIdAndKindAndArchivedFalseAndConversationSavedAtIsNotNullOrderByConversationSavedAtDesc}
 *       returns ONLY saved, non-archived target rows, newest-first.</li>
 * </ul>
 *
 * <p>Both exclude null markers (never saved), archived rows, and other kinds.</p>
 *
 * <p>Spec: Target-State Conversation Save/Resume/Plan-Sourcing (2026-06-26) --
 * Task Group 2 (FR2).</p>
 */
@DataJpaTest
@ActiveProfiles("test")
class ArchitectureSavedConversationFinderTest {

    @Autowired
    private ArchitectureRepository architectureRepository;

    private ArchitectureEntity persist(UUID projectId, String name, String kind,
                                       boolean archived, Instant savedAt) {
        ArchitectureEntity e = ArchitectureEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .name(name)
            .kind(kind)
            .draftState("draft")
            .archived(archived)
            .conversationSavedAt(savedAt)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        return architectureRepository.saveAndFlush(e);
    }

    @Test
    @DisplayName("most-recent-saved returns the newest saved target; list-saved returns only saved targets newest-first")
    void findsSavedNewestFirstExcludingUnsavedArchivedAndOtherKinds() {
        UUID projectId = UUID.randomUUID();

        ArchitectureEntity older = persist(projectId, "Saved older", "target", false,
            Instant.parse("2026-06-20T10:00:00Z"));
        ArchitectureEntity newer = persist(projectId, "Saved newer", "target", false,
            Instant.parse("2026-06-25T10:00:00Z"));
        // Excluded: never saved (null marker).
        persist(projectId, "Unsaved target", "target", false, null);
        // Excluded: archived even though saved most-recently of all.
        persist(projectId, "Saved but archived", "target", true,
            Instant.parse("2026-06-26T10:00:00Z"));
        // Excluded: wrong kind even though saved.
        persist(projectId, "Saved current", "current", false,
            Instant.parse("2026-06-24T10:00:00Z"));

        Optional<ArchitectureEntity> mostRecent = architectureRepository
            .findFirstByProjectIdAndKindAndArchivedFalseAndConversationSavedAtIsNotNullOrderByConversationSavedAtDesc(
                projectId, "target");
        assertThat(mostRecent).isPresent();
        assertThat(mostRecent.get().getId()).isEqualTo(newer.getId());

        List<ArchitectureEntity> saved = architectureRepository
            .findByProjectIdAndKindAndArchivedFalseAndConversationSavedAtIsNotNullOrderByConversationSavedAtDesc(
                projectId, "target");
        assertThat(saved)
            .extracting(ArchitectureEntity::getId)
            .containsExactly(newer.getId(), older.getId());
    }

    @Test
    @DisplayName("most-recent-saved is empty and list-saved is empty when the project has no saved conversation")
    void emptyWhenNoneSaved() {
        UUID projectId = UUID.randomUUID();
        persist(projectId, "Unsaved target A", "target", false, null);
        persist(projectId, "Unsaved target B", "target", false, null);

        assertThat(architectureRepository
            .findFirstByProjectIdAndKindAndArchivedFalseAndConversationSavedAtIsNotNullOrderByConversationSavedAtDesc(
                projectId, "target"))
            .isEmpty();
        assertThat(architectureRepository
            .findByProjectIdAndKindAndArchivedFalseAndConversationSavedAtIsNotNullOrderByConversationSavedAtDesc(
                projectId, "target"))
            .isEmpty();
    }
}
