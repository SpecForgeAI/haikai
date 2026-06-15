package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.MetaModelSummaryDto;
import com.example.architecturemodel.model.dto.MetaModelSummaryDto.EntitySummary;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Tests for MetaModelSummaryService user journey integration.
 *
 * Spec: User Journey Meta-Model Foundation (Task Group 3)
 */
@ExtendWith(MockitoExtension.class)
class MetaModelSummaryServiceUserJourneyTest {

    @Mock private ModelFileRepository modelFileRepository;
    @Mock private ApplicationRepository applicationRepository;
    @Mock private ApplicationComponentRepository applicationComponentRepository;
    @Mock private ServiceRepository serviceRepository;
    @Mock private InterfaceRepository interfaceRepository;
    @Mock private LogicalDataEntityRepository logicalDataEntityRepository;
    @Mock private PhysicalDataEntityRepository physicalDataEntityRepository;
    @Mock private BusinessUserRepository businessUserRepository;
    @Mock private ProcessActivityRepository processActivityRepository;
    @Mock private UIScreenRepository uiScreenRepository;
    @Mock private UserJourneyRepository userJourneyRepository;

    private MetaModelSummaryService summaryService;

    @BeforeEach
    void setUp() {
        summaryService = new MetaModelSummaryService(
            modelFileRepository,
            applicationRepository,
            applicationComponentRepository,
            serviceRepository,
            interfaceRepository,
            logicalDataEntityRepository,
            physicalDataEntityRepository,
            businessUserRepository,
            processActivityRepository,
            uiScreenRepository,
            userJourneyRepository
        );
    }

    @Test
    void getMetaModelSummary_includesUserJourneys() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        String modelFileId = "mf-1";

        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id(modelFileId)
            .filename("test-model")
            .projectId(projectId)
            .build();

        UserJourneyEntity journey1 = UserJourneyEntity.builder()
            .id("uj-1")
            .modelFileId(modelFileId)
            .name("Customer Onboarding")
            .build();

        UserJourneyEntity journey2 = UserJourneyEntity.builder()
            .id("uj-2")
            .modelFileId(modelFileId)
            .name("Order Fulfillment")
            .build();

        when(modelFileRepository.findByProjectIdAndArchitectureId(projectId, architectureId)).thenReturn(Optional.of(modelFile));
        when(userJourneyRepository.findByModelFileId(modelFileId)).thenReturn(List.of(journey1, journey2));
        setupOtherEmptyMocks(modelFileId);

        MetaModelSummaryDto result = summaryService.getMetaModelSummary(projectId, architectureId);

        assertNotNull(result.userJourneys());
        assertEquals(2, result.userJourneys().size());

        EntitySummary first = result.userJourneys().get(0);
        assertEquals("uj-1", first.id());
        assertEquals("Customer Onboarding", first.name());
        assertEquals("userJourneys", first.entityType());

        EntitySummary second = result.userJourneys().get(1);
        assertEquals("uj-2", second.id());
        assertEquals("Order Fulfillment", second.name());
        assertEquals("userJourneys", second.entityType());
    }

    @Test
    void getMetaModelSummary_emptyUserJourneys() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        String modelFileId = "mf-1";

        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id(modelFileId)
            .filename("test-model")
            .projectId(projectId)
            .build();

        when(modelFileRepository.findByProjectIdAndArchitectureId(projectId, architectureId)).thenReturn(Optional.of(modelFile));
        when(userJourneyRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        setupOtherEmptyMocks(modelFileId);

        MetaModelSummaryDto result = summaryService.getMetaModelSummary(projectId, architectureId);

        assertNotNull(result.userJourneys());
        assertTrue(result.userJourneys().isEmpty());
    }

    private void setupOtherEmptyMocks(String modelFileId) {
        when(applicationRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationComponentRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(serviceRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(interfaceRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(physicalDataEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(businessUserRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(processActivityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiScreenRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
    }
}
