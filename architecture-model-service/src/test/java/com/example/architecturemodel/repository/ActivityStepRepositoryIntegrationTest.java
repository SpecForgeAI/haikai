package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.ActivityStepEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.UserJourneyEntity;
import com.example.architecturemodel.repository.entity.ActivityStepRepository;
import com.example.architecturemodel.repository.entity.UserJourneyRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;

import java.time.OffsetDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Lightweight Spring integration test for ActivityStepRepository.
 *
 * Verifies that the Spring Data derived query findByUserJourneyId works correctly
 * with actual H2 database interaction.
 *
 * Spec: User Journey Temporary Diagram JSON Generation
 * Task Group 4: Integration Tests
 */
@DataJpaTest
class ActivityStepRepositoryIntegrationTest {

    @Autowired
    private ActivityStepRepository activityStepRepository;

    @Autowired
    private UserJourneyRepository userJourneyRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    private static final String MODEL_FILE_ID = "test-model-file";
    private static final String JOURNEY_ID_1 = "uj-001";
    private static final String JOURNEY_ID_2 = "uj-002";

    @BeforeEach
    void setUp() {
        // Create model file for FK
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id(MODEL_FILE_ID)
            .filename("test-model.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(modelFile);

        // Create two user journeys
        UserJourneyEntity journey1 = UserJourneyEntity.builder()
            .id(JOURNEY_ID_1)
            .modelFileId(MODEL_FILE_ID)
            .name("Journey 1")
            .build();
        userJourneyRepository.save(journey1);

        UserJourneyEntity journey2 = UserJourneyEntity.builder()
            .id(JOURNEY_ID_2)
            .modelFileId(MODEL_FILE_ID)
            .name("Journey 2")
            .build();
        userJourneyRepository.save(journey2);

        // Create activity steps: 2 for journey 1, 1 for journey 2
        activityStepRepository.save(ActivityStepEntity.builder()
            .id("step-1a")
            .modelFileId(MODEL_FILE_ID)
            .userJourneyId(JOURNEY_ID_1)
            .name("Step 1A")
            .sequenceOrder(1)
            .processActivityId("pa-1")
            .businessUserId("bu-1")
            .applicationId("app-1")
            .diagramLabel("label")
            .activityIssues("")
            .uiIssues("")
            .build());

        activityStepRepository.save(ActivityStepEntity.builder()
            .id("step-1b")
            .modelFileId(MODEL_FILE_ID)
            .userJourneyId(JOURNEY_ID_1)
            .name("Step 1B")
            .sequenceOrder(2)
            .processActivityId("pa-2")
            .businessUserId("bu-1")
            .applicationId("app-2")
            .diagramLabel("label")
            .activityIssues("")
            .uiIssues("")
            .build());

        activityStepRepository.save(ActivityStepEntity.builder()
            .id("step-2a")
            .modelFileId(MODEL_FILE_ID)
            .userJourneyId(JOURNEY_ID_2)
            .name("Step 2A")
            .sequenceOrder(1)
            .processActivityId("pa-3")
            .businessUserId("bu-1")
            .applicationId("app-1")
            .diagramLabel("label")
            .activityIssues("")
            .uiIssues("")
            .build());
    }

    /**
     * Test 1: findByUserJourneyId returns correct steps for a journey.
     */
    @Test
    void findByUserJourneyId_returnsCorrectSteps() {
        // When
        List<ActivityStepEntity> steps = activityStepRepository.findByUserJourneyId(JOURNEY_ID_1);

        // Then
        assertThat(steps).hasSize(2);
        assertThat(steps).extracting(ActivityStepEntity::getId)
            .containsExactlyInAnyOrder("step-1a", "step-1b");
        assertThat(steps).allMatch(s -> s.getUserJourneyId().equals(JOURNEY_ID_1));
    }

    /**
     * Test 2: findByUserJourneyId returns empty list for non-existent journey.
     */
    @Test
    void findByUserJourneyId_returnsEmptyForNonExistentJourney() {
        // When
        List<ActivityStepEntity> steps = activityStepRepository.findByUserJourneyId("nonexistent-journey");

        // Then
        assertThat(steps).isEmpty();
    }
}
