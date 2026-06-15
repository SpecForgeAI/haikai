package com.example.architecturemodel.dto;

import com.example.architecturemodel.model.dto.entity.ActivityStepDto;
import com.example.architecturemodel.model.dto.entity.UserJourneyDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for UserJourneyDto and ActivityStepDto JSON serialization/deserialization,
 * plus MetaModelEntitiesDto backward compatibility for snapshot import.
 *
 * Spec: User Journey Meta-Model Foundation (Task Group 5 - Gap-filling tests)
 */
class UserJourneyDtoSerializationTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        // Configure ObjectMapper to match production configuration from application.yml
        objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
    }

    // ============================================================================
    // Test 1: UserJourneyDto JSON serialization (snake_case property names)
    // ============================================================================

    @Test
    @DisplayName("UserJourneyDto serializes with snake_case property names via @JsonProperty")
    void userJourneyDto_jsonSerialization() throws Exception {
        UserJourneyDto dto = new UserJourneyDto(
            "uj-onboarding",
            "Customer Onboarding",
            "End-to-end onboarding flow",
            "domain:customer",
            "bu-customer-rep",
            "bp-onboarding"
        );

        String json = objectMapper.writeValueAsString(dto);

        // Verify snake_case property names are present in serialized JSON
        assertThat(json).contains("\"id\":\"uj-onboarding\"");
        assertThat(json).contains("\"name\":\"Customer Onboarding\"");
        assertThat(json).contains("\"description\":\"End-to-end onboarding flow\"");
        assertThat(json).contains("\"tags\":\"domain:customer\"");
        assertThat(json).contains("\"primary_business_user_id\":\"bu-customer-rep\"");
        assertThat(json).contains("\"parent_business_process_id\":\"bp-onboarding\"");

        // Verify camelCase names are NOT present
        assertThat(json).doesNotContain("\"primaryBusinessUserId\"");
        assertThat(json).doesNotContain("\"parentBusinessProcessId\"");

        // Verify round-trip deserialization
        UserJourneyDto deserialized = objectMapper.readValue(json, UserJourneyDto.class);
        assertThat(deserialized.id()).isEqualTo("uj-onboarding");
        assertThat(deserialized.primaryBusinessUserId()).isEqualTo("bu-customer-rep");
        assertThat(deserialized.parentBusinessProcessId()).isEqualTo("bp-onboarding");
    }

    // ============================================================================
    // Test 2: ActivityStepDto JSON serialization (snake_case property names)
    // ============================================================================

    @Test
    @DisplayName("ActivityStepDto serializes with snake_case property names via @JsonProperty")
    void activityStepDto_jsonSerialization() throws Exception {
        ActivityStepDto dto = new ActivityStepDto(
            "as-fill-form",
            "uj-onboarding",
            "Fill Registration Form",
            "Customer fills out the form",
            "step:input",
            1,
            "pa-register",
            "bu-customer",
            "app-web-portal",
            null, // diagramLabel
            null, // activityIssues
            null  // uiIssues
        );

        String json = objectMapper.writeValueAsString(dto);

        // Verify snake_case property names for all FK fields
        assertThat(json).contains("\"id\":\"as-fill-form\"");
        assertThat(json).contains("\"user_journey_id\":\"uj-onboarding\"");
        assertThat(json).contains("\"name\":\"Fill Registration Form\"");
        assertThat(json).contains("\"description\":\"Customer fills out the form\"");
        assertThat(json).contains("\"tags\":\"step:input\"");
        assertThat(json).contains("\"sequence_order\":1");
        assertThat(json).contains("\"process_activity_id\":\"pa-register\"");
        assertThat(json).contains("\"business_user_id\":\"bu-customer\"");
        assertThat(json).contains("\"application_id\":\"app-web-portal\"");

        // Verify camelCase names are NOT present
        assertThat(json).doesNotContain("\"userJourneyId\"");
        assertThat(json).doesNotContain("\"sequenceOrder\"");
        assertThat(json).doesNotContain("\"processActivityId\"");
        assertThat(json).doesNotContain("\"businessUserId\"");
        assertThat(json).doesNotContain("\"applicationId\"");

        // Verify round-trip deserialization
        ActivityStepDto deserialized = objectMapper.readValue(json, ActivityStepDto.class);
        assertThat(deserialized.id()).isEqualTo("as-fill-form");
        assertThat(deserialized.userJourneyId()).isEqualTo("uj-onboarding");
        assertThat(deserialized.sequenceOrder()).isEqualTo(1);
        assertThat(deserialized.processActivityId()).isEqualTo("pa-register");
        assertThat(deserialized.businessUserId()).isEqualTo("bu-customer");
        assertThat(deserialized.applicationId()).isEqualTo("app-web-portal");
    }

    // ============================================================================
    // Test 3: MetaModelEntitiesDto backward compatibility (missing fields)
    // ============================================================================

    @Test
    @DisplayName("MetaModelEntitiesDto deserializes JSON without user_journeys/activity_steps as null")
    void metaModelEntitiesDto_backwardCompatibility() throws Exception {
        // Simulate a pre-feature snapshot JSON that has NO user_journeys or activity_steps fields.
        // Jackson should deserialize missing record fields as null.
        // Use a default ObjectMapper (no SNAKE_CASE strategy) since MetaModelEntitiesDto
        // has explicit @JsonProperty annotations.
        ObjectMapper defaultMapper = new ObjectMapper();

        String jsonWithoutUserJourneys = """
            {
                "business_users": [],
                "business_processes": [],
                "process_activities": [],
                "business_points": [],
                "applications": [],
                "app_components": [],
                "services": [],
                "interfaces": [],
                "endpoints": [],
                "classes": [],
                "methods": [],
                "application_points": [],
                "logical_data_entities": [],
                "logical_data_attributes": [],
                "physical_data_entities": [],
                "physical_data_attributes": [],
                "data_entity_points": [],
                "interactions": [],
                "app_business_points": [],
                "events": [],
                "states": [],
                "state_transitions": [],
                "activities": [],
                "activity_flows": [],
                "activity_partitions": [],
                "ui_screens": [],
                "ui_contracts": [],
                "ui_components": [],
                "ui_actions": [],
                "ui_characteristics": [],
                "business_logics": [],
                "package_sets": [],
                "packages": [],
                "package_set_default_rules": []
            }
            """;

        MetaModelEntitiesDto result = defaultMapper.readValue(jsonWithoutUserJourneys, MetaModelEntitiesDto.class);

        // The missing fields should deserialize as null for a Java record
        assertThat(result.userJourneys()).isNull();
        assertThat(result.activitySteps()).isNull();

        // Other fields should still be present as empty lists
        assertThat(result.businessUsers()).isNotNull().isEmpty();
        assertThat(result.applications()).isNotNull().isEmpty();
    }
}
