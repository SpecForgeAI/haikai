package com.example.architecturemodel.dto.relationship;

import com.example.architecturemodel.model.dto.relationship.UserJourneyLinkDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for UserJourneyLinkDto JSON serialization with snake_case property names.
 *
 * Spec: User Journey Links Meta-Model Foundation (Task Group 1, Test 2)
 */
class UserJourneyLinkDtoSerializationTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
    }

    @Test
    @DisplayName("UserJourneyLinkDto serializes with snake_case property names via @JsonProperty")
    void userJourneyLinkDto_jsonSerialization_snakeCase() throws Exception {
        UserJourneyLinkDto dto = new UserJourneyLinkDto(
            "ujl-001",
            "uj-onboarding",
            "uj-checkout",
            "PRECEDES",
            "after onboarding",
            "Onboarding precedes checkout",
            "domain:customer"
        );

        String json = objectMapper.writeValueAsString(dto);

        // Verify snake_case property names are present in serialized JSON
        assertThat(json).contains("\"id\":\"ujl-001\"");
        assertThat(json).contains("\"source_user_journey_id\":\"uj-onboarding\"");
        assertThat(json).contains("\"target_user_journey_id\":\"uj-checkout\"");
        assertThat(json).contains("\"relationship_type\":\"PRECEDES\"");
        assertThat(json).contains("\"label\":\"after onboarding\"");
        assertThat(json).contains("\"description\":\"Onboarding precedes checkout\"");
        assertThat(json).contains("\"tags\":\"domain:customer\"");

        // Verify camelCase names are NOT present
        assertThat(json).doesNotContain("\"sourceUserJourneyId\"");
        assertThat(json).doesNotContain("\"targetUserJourneyId\"");
        assertThat(json).doesNotContain("\"relationshipType\"");

        // Verify round-trip deserialization
        UserJourneyLinkDto deserialized = objectMapper.readValue(json, UserJourneyLinkDto.class);
        assertThat(deserialized.id()).isEqualTo("ujl-001");
        assertThat(deserialized.sourceUserJourneyId()).isEqualTo("uj-onboarding");
        assertThat(deserialized.targetUserJourneyId()).isEqualTo("uj-checkout");
        assertThat(deserialized.relationshipType()).isEqualTo("PRECEDES");
        assertThat(deserialized.label()).isEqualTo("after onboarding");
        assertThat(deserialized.description()).isEqualTo("Onboarding precedes checkout");
        assertThat(deserialized.tags()).isEqualTo("domain:customer");
    }
}
