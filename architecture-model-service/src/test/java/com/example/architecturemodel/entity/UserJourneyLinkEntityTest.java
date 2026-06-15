package com.example.architecturemodel.entity;

import com.example.architecturemodel.model.entity.UserJourneyLinkEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for UserJourneyLinkEntity builder round-trip.
 *
 * Spec: User Journey Links Meta-Model Foundation (Task Group 1, Test 1)
 */
class UserJourneyLinkEntityTest {

    @Test
    @DisplayName("UserJourneyLinkEntity builder sets all fields correctly")
    void builder_setsAllFields() {
        UserJourneyLinkEntity entity = UserJourneyLinkEntity.builder()
            .id("ujl-001")
            .modelFileId("model-file-123")
            .sourceUserJourneyId("uj-onboarding")
            .targetUserJourneyId("uj-checkout")
            .relationshipType("PRECEDES")
            .label("after onboarding")
            .description("Onboarding precedes checkout in the customer flow")
            .tags("domain:customer,priority:high")
            .build();

        assertThat(entity.getId()).isEqualTo("ujl-001");
        assertThat(entity.getModelFileId()).isEqualTo("model-file-123");
        assertThat(entity.getSourceUserJourneyId()).isEqualTo("uj-onboarding");
        assertThat(entity.getTargetUserJourneyId()).isEqualTo("uj-checkout");
        assertThat(entity.getRelationshipType()).isEqualTo("PRECEDES");
        assertThat(entity.getLabel()).isEqualTo("after onboarding");
        assertThat(entity.getDescription()).isEqualTo("Onboarding precedes checkout in the customer flow");
        assertThat(entity.getTags()).isEqualTo("domain:customer,priority:high");
    }
}
