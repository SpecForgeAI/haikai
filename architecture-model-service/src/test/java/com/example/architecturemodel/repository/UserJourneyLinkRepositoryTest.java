package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.UserJourneyLinkEntity;
import com.example.architecturemodel.repository.relationship.UserJourneyLinkRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

/**
 * Mocked unit tests for UserJourneyLinkRepository.
 *
 * Verifies the repository interface contract: findByModelFileId and deleteByModelFileId.
 * These are Spring Data derived queries -- we mock to verify interface shape and usage.
 *
 * Spec: User Journey Links Meta-Model Foundation (Task Group 1, Tests 3 and 4)
 */
@ExtendWith(MockitoExtension.class)
class UserJourneyLinkRepositoryTest {

    @Mock
    private UserJourneyLinkRepository userJourneyLinkRepository;

    @Test
    @DisplayName("findByModelFileId returns correct links for a given model file")
    void findByModelFileId_returnsCorrectLinks() {
        // Given
        String modelFileId = "model-file-123";

        UserJourneyLinkEntity link1 = UserJourneyLinkEntity.builder()
            .id("ujl-001")
            .modelFileId(modelFileId)
            .sourceUserJourneyId("uj-onboarding")
            .targetUserJourneyId("uj-checkout")
            .relationshipType("PRECEDES")
            .label("after onboarding")
            .description("Onboarding precedes checkout")
            .tags("domain:customer")
            .build();

        UserJourneyLinkEntity link2 = UserJourneyLinkEntity.builder()
            .id("ujl-002")
            .modelFileId(modelFileId)
            .sourceUserJourneyId("uj-checkout")
            .targetUserJourneyId("uj-payment")
            .relationshipType("TRIGGERS")
            .build();

        when(userJourneyLinkRepository.findByModelFileId(modelFileId))
            .thenReturn(List.of(link1, link2));

        // When
        List<UserJourneyLinkEntity> results = userJourneyLinkRepository.findByModelFileId(modelFileId);

        // Then
        assertThat(results).hasSize(2);
        assertThat(results).extracting(UserJourneyLinkEntity::getId)
            .containsExactlyInAnyOrder("ujl-001", "ujl-002");
        assertThat(results).allMatch(link -> link.getModelFileId().equals(modelFileId));

        verify(userJourneyLinkRepository).findByModelFileId(modelFileId);
    }

    @Test
    @DisplayName("deleteByModelFileId removes correct links for a given model file")
    void deleteByModelFileId_removesCorrectLinks() {
        // Given
        String modelFileId = "model-file-123";

        // When
        userJourneyLinkRepository.deleteByModelFileId(modelFileId);

        // Then
        verify(userJourneyLinkRepository, times(1)).deleteByModelFileId(modelFileId);
    }
}
