package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.relationship.UserJourneyLinkDto;
import com.example.architecturemodel.model.entity.UserJourneyLinkEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for UserJourneyLink DTO and Entity mappings in EntityMapper.
 *
 * Tests bidirectional mapping between UserJourneyLinkDto and UserJourneyLinkEntity.
 *
 * Spec: User Journey Links Meta-Model Foundation (Task Group 2, Tests 1 and 2)
 */
class EntityMapperUserJourneyLinkTest {

    private EntityMapper entityMapper;

    @BeforeEach
    void setUp() {
        entityMapper = new EntityMapper();
    }

    @Test
    @DisplayName("toDto(UserJourneyLinkEntity) maps all fields correctly to UserJourneyLinkDto")
    void toDto_UserJourneyLinkEntity_mapsAllFields() {
        // Given: A complete UserJourneyLinkEntity with all fields populated
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

        // When: Map to DTO
        UserJourneyLinkDto dto = entityMapper.toDto(entity);

        // Then: All fields are correctly mapped (modelFileId is stripped)
        assertThat(dto.id()).isEqualTo("ujl-001");
        assertThat(dto.sourceUserJourneyId()).isEqualTo("uj-onboarding");
        assertThat(dto.targetUserJourneyId()).isEqualTo("uj-checkout");
        assertThat(dto.relationshipType()).isEqualTo("PRECEDES");
        assertThat(dto.label()).isEqualTo("after onboarding");
        assertThat(dto.description()).isEqualTo("Onboarding precedes checkout in the customer flow");
        assertThat(dto.tags()).isEqualTo("domain:customer,priority:high");
    }

    @Test
    @DisplayName("toEntity(UserJourneyLinkDto, modelFileId) maps all fields and sets modelFileId")
    void toEntity_UserJourneyLinkDto_injectsModelFileId() {
        // Given: A UserJourneyLinkDto (which does not carry modelFileId)
        UserJourneyLinkDto dto = new UserJourneyLinkDto(
            "ujl-002",
            "uj-checkout",
            "uj-payment",
            "TRIGGERS",
            null,  // label is optional
            "Checkout triggers payment processing",
            "domain:commerce"
        );
        String modelFileId = "model-file-456";

        // When: Map to Entity with modelFileId injection
        UserJourneyLinkEntity entity = entityMapper.toEntity(dto, modelFileId);

        // Then: All fields are correctly mapped and modelFileId is injected
        assertThat(entity.getId()).isEqualTo("ujl-002");
        assertThat(entity.getModelFileId()).isEqualTo("model-file-456");
        assertThat(entity.getSourceUserJourneyId()).isEqualTo("uj-checkout");
        assertThat(entity.getTargetUserJourneyId()).isEqualTo("uj-payment");
        assertThat(entity.getRelationshipType()).isEqualTo("TRIGGERS");
        assertThat(entity.getLabel()).isNull();
        assertThat(entity.getDescription()).isEqualTo("Checkout triggers payment processing");
        assertThat(entity.getTags()).isEqualTo("domain:commerce");
    }
}
