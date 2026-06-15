package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.entity.ActivityStepDto;
import com.example.architecturemodel.model.dto.entity.UserJourneyDto;
import com.example.architecturemodel.model.entity.ActivityStepEntity;
import com.example.architecturemodel.model.entity.UserJourneyEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for UserJourney and ActivityStep DTO and Entity mappings in EntityMapper.
 *
 * Tests bidirectional mapping between UserJourneyDto/UserJourneyEntity
 * and ActivityStepDto/ActivityStepEntity.
 *
 * Spec: User Journey Meta-Model Foundation
 */
class EntityMapperUserJourneyTest {

    private EntityMapper entityMapper;

    @BeforeEach
    void setUp() {
        entityMapper = new EntityMapper();
    }

    @Test
    void toDto_UserJourneyEntity_mapsAllFields() {
        // Given: A complete UserJourneyEntity with all fields populated including nullable FKs
        UserJourneyEntity entity = UserJourneyEntity.builder()
            .id("uj-onboarding")
            .modelFileId("model-file-123")
            .name("Customer Onboarding Journey")
            .description("End-to-end onboarding flow for new customers")
            .tags("domain:customer,phase:onboarding")
            .primaryBusinessUserId("bu-customer-rep")
            .parentBusinessProcessId("bp-onboarding")
            .build();

        // When: Map to DTO
        UserJourneyDto dto = entityMapper.toDto(entity);

        // Then: All fields are correctly mapped (modelFileId is stripped)
        assertThat(dto.id()).isEqualTo("uj-onboarding");
        assertThat(dto.name()).isEqualTo("Customer Onboarding Journey");
        assertThat(dto.description()).isEqualTo("End-to-end onboarding flow for new customers");
        assertThat(dto.tags()).isEqualTo("domain:customer,phase:onboarding");
        assertThat(dto.primaryBusinessUserId()).isEqualTo("bu-customer-rep");
        assertThat(dto.parentBusinessProcessId()).isEqualTo("bp-onboarding");
    }

    @Test
    void toEntity_UserJourneyDto_injectsModelFileId() {
        // Given: A UserJourneyDto (which does not carry modelFileId)
        UserJourneyDto dto = new UserJourneyDto(
            "uj-checkout",
            "Checkout Journey",
            "User checkout flow through the e-commerce platform",
            "domain:commerce",
            null,   // primaryBusinessUserId is nullable
            null    // parentBusinessProcessId is nullable
        );
        String modelFileId = "model-file-456";

        // When: Map to Entity with modelFileId injection
        UserJourneyEntity entity = entityMapper.toEntity(dto, modelFileId);

        // Then: All fields are correctly mapped and modelFileId is injected
        assertThat(entity.getId()).isEqualTo("uj-checkout");
        assertThat(entity.getModelFileId()).isEqualTo("model-file-456");
        assertThat(entity.getName()).isEqualTo("Checkout Journey");
        assertThat(entity.getDescription()).isEqualTo("User checkout flow through the e-commerce platform");
        assertThat(entity.getTags()).isEqualTo("domain:commerce");
        assertThat(entity.getPrimaryBusinessUserId()).isNull();
        assertThat(entity.getParentBusinessProcessId()).isNull();
    }

    @Test
    void toDto_ActivityStepEntity_mapsAllFields() {
        // Given: A complete ActivityStepEntity with all fields populated
        ActivityStepEntity entity = ActivityStepEntity.builder()
            .id("as-fill-form")
            .modelFileId("model-file-123")
            .userJourneyId("uj-onboarding")
            .name("Fill Registration Form")
            .description("Customer fills in the registration form in the web app")
            .tags("step:input,channel:web")
            .sequenceOrder(1)
            .processActivityId("pa-register")
            .businessUserId("bu-customer")
            .applicationId("app-web-portal")
            .build();

        // When: Map to DTO
        ActivityStepDto dto = entityMapper.toDto(entity);

        // Then: All fields are correctly mapped (modelFileId is stripped)
        assertThat(dto.id()).isEqualTo("as-fill-form");
        assertThat(dto.userJourneyId()).isEqualTo("uj-onboarding");
        assertThat(dto.name()).isEqualTo("Fill Registration Form");
        assertThat(dto.description()).isEqualTo("Customer fills in the registration form in the web app");
        assertThat(dto.tags()).isEqualTo("step:input,channel:web");
        assertThat(dto.sequenceOrder()).isEqualTo(1);
        assertThat(dto.processActivityId()).isEqualTo("pa-register");
        assertThat(dto.businessUserId()).isEqualTo("bu-customer");
        assertThat(dto.applicationId()).isEqualTo("app-web-portal");
    }

    @Test
    void toEntity_ActivityStepDto_injectsModelFileId() {
        // Given: An ActivityStepDto (which does not carry modelFileId)
        ActivityStepDto dto = new ActivityStepDto(
            "as-verify-identity",
            "uj-onboarding",
            "Verify Identity",
            "System verifies customer identity against external service",
            "step:verification",
            2,
            "pa-verify",
            "bu-system-agent",
            "app-identity-svc",
            null, // diagramLabel
            null, // activityIssues
            null  // uiIssues
        );
        String modelFileId = "model-file-789";

        // When: Map to Entity with modelFileId injection
        ActivityStepEntity entity = entityMapper.toEntity(dto, modelFileId);

        // Then: All fields are correctly mapped and modelFileId is injected
        assertThat(entity.getId()).isEqualTo("as-verify-identity");
        assertThat(entity.getModelFileId()).isEqualTo("model-file-789");
        assertThat(entity.getUserJourneyId()).isEqualTo("uj-onboarding");
        assertThat(entity.getName()).isEqualTo("Verify Identity");
        assertThat(entity.getDescription()).isEqualTo("System verifies customer identity against external service");
        assertThat(entity.getTags()).isEqualTo("step:verification");
        assertThat(entity.getSequenceOrder()).isEqualTo(2);
        assertThat(entity.getProcessActivityId()).isEqualTo("pa-verify");
        assertThat(entity.getBusinessUserId()).isEqualTo("bu-system-agent");
        assertThat(entity.getApplicationId()).isEqualTo("app-identity-svc");
    }
}
