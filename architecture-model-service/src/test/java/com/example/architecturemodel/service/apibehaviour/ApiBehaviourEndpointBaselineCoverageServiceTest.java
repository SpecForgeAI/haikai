package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.EndpointBaselineCoverageDto;
import com.example.architecturemodel.model.entity.EndpointEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineItemEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourOperationEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineItemRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourOperationRepository;
import com.example.architecturemodel.repository.entity.EndpointRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Unit tests for the endpoint→baseline coverage join.
 *
 * Spec: Migration Delivery Plan expansion — endpoint↔baseline coverage
 * (2026-06-24 fix). The headline assertion is the parameterised-endpoint case:
 * a baseline item stores a CONCRETE captured path ("/views/123") but the join
 * still matches the TEMPLATED architecture endpoint ("/views/{viewId}") via the
 * item's operation_id → operation (templated path) indirection — the exact case
 * the old baseline-NAME substring match could never resolve.
 */
@ExtendWith(MockitoExtension.class)
class ApiBehaviourEndpointBaselineCoverageServiceTest {

    @Mock private ModelFileRepository modelFileRepository;
    @Mock private EndpointRepository endpointRepository;
    @Mock private ApiBehaviourBaselineRepository baselineRepository;
    @Mock private ApiBehaviourBaselineItemRepository baselineItemRepository;
    @Mock private ApiBehaviourOperationRepository operationRepository;

    @InjectMocks private ApiBehaviourEndpointBaselineCoverageService service;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCH_ID = UUID.randomUUID();
    private static final String MODEL_FILE_ID = "mf-1";

    private static EndpointEntity endpoint(String id, String verb, String path) {
        return EndpointEntity.builder()
            .id(id)
            .modelFileId(MODEL_FILE_ID)
            .name(verb + " " + path)
            .operationVerb(verb)
            .pathOrAddress(path)
            .protocol("REST")
            .build();
    }

    private static ApiBehaviourBaselineEntity baseline(UUID id, String status) {
        return ApiBehaviourBaselineEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .architectureId(ARCH_ID)
            .name("HiFi API Baseline v1")
            .status(status)
            .build();
    }

    private static ApiBehaviourBaselineItemEntity item(UUID baselineId, UUID operationId, String method, String path) {
        return ApiBehaviourBaselineItemEntity.builder()
            .id(UUID.randomUUID())
            .baselineId(baselineId)
            .captureId(UUID.randomUUID())
            .operationId(operationId)
            .scenarioId(UUID.randomUUID())
            .method(method)
            .path(path)
            .scenarioName("happy_path")
            .build();
    }

    private static ApiBehaviourOperationEntity operation(UUID id, String method, String path) {
        return ApiBehaviourOperationEntity.builder()
            .id(id)
            .sessionId(UUID.randomUUID())
            .method(method)
            .path(path)
            .build();
    }

    private void stubModelFileAndEndpoints(EndpointEntity... endpoints) {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(Optional.of(ModelFileEntity.builder().id(MODEL_FILE_ID).build()));
        when(endpointRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(endpoints));
    }

    @Test
    void parameterisedEndpointMatchesViaOperationIdEvenWhenItemPathIsConcrete() {
        UUID baselineId = UUID.randomUUID();
        UUID operationId = UUID.randomUUID();
        stubModelFileAndEndpoints(endpoint("ep-1", "GET", "/views/{viewId}"));
        when(baselineRepository.findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, ARCH_ID))
            .thenReturn(List.of(baseline(baselineId, "active")));
        // Item stores the CONCRETE captured path; the operation row holds the templated path.
        when(baselineItemRepository.findByBaselineIdOrderByCreatedAtAsc(baselineId))
            .thenReturn(List.of(item(baselineId, operationId, "GET", "/views/123")));
        when(operationRepository.findAllById(any()))
            .thenReturn(List.of(operation(operationId, "GET", "/views/{viewId}")));

        List<EndpointBaselineCoverageDto> coverage = service.computeCoverage(PROJECT_ID, ARCH_ID);

        assertThat(coverage).hasSize(1);
        assertThat(coverage.get(0).endpointId()).isEqualTo("ep-1");
        assertThat(coverage.get(0).baselineId()).isEqualTo(baselineId);
        assertThat(coverage.get(0).method()).isEqualTo("GET");
        assertThat(coverage.get(0).path()).isEqualTo("/views/{viewId}");
    }

    @Test
    void uncoveredEndpointIsAbsentFromTheResult() {
        UUID baselineId = UUID.randomUUID();
        UUID operationId = UUID.randomUUID();
        stubModelFileAndEndpoints(
            endpoint("ep-1", "GET", "/views/{viewId}"),
            endpoint("ep-2", "POST", "/orders"));
        when(baselineRepository.findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, ARCH_ID))
            .thenReturn(List.of(baseline(baselineId, "active")));
        when(baselineItemRepository.findByBaselineIdOrderByCreatedAtAsc(baselineId))
            .thenReturn(List.of(item(baselineId, operationId, "GET", "/views/{viewId}")));
        when(operationRepository.findAllById(any()))
            .thenReturn(List.of(operation(operationId, "GET", "/views/{viewId}")));

        List<EndpointBaselineCoverageDto> coverage = service.computeCoverage(PROJECT_ID, ARCH_ID);

        assertThat(coverage).extracting(EndpointBaselineCoverageDto::endpointId).containsExactly("ep-1");
    }

    @Test
    void draftBaselinesAreIgnored() {
        UUID baselineId = UUID.randomUUID();
        UUID operationId = UUID.randomUUID();
        stubModelFileAndEndpoints(endpoint("ep-1", "GET", "/views/{viewId}"));
        when(baselineRepository.findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, ARCH_ID))
            .thenReturn(List.of(baseline(baselineId, "draft")));

        List<EndpointBaselineCoverageDto> coverage = service.computeCoverage(PROJECT_ID, ARCH_ID);

        assertThat(coverage).isEmpty();
    }

    @Test
    void fallsBackToItemMethodPathWhenOperationRowIsMissing() {
        UUID baselineId = UUID.randomUUID();
        UUID operationId = UUID.randomUUID();
        stubModelFileAndEndpoints(endpoint("ep-1", "GET", "/widgets/keep"));
        when(baselineRepository.findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, ARCH_ID))
            .thenReturn(List.of(baseline(baselineId, "active")));
        when(baselineItemRepository.findByBaselineIdOrderByCreatedAtAsc(baselineId))
            .thenReturn(List.of(item(baselineId, operationId, "GET", "/widgets/keep")));
        // Operation row not found (e.g. deleted) → fall back to the item's (method, path).
        when(operationRepository.findAllById(any())).thenReturn(List.of());

        List<EndpointBaselineCoverageDto> coverage = service.computeCoverage(PROJECT_ID, ARCH_ID);

        assertThat(coverage).extracting(EndpointBaselineCoverageDto::endpointId).containsExactly("ep-1");
        assertThat(coverage.get(0).baselineId()).isEqualTo(baselineId);
    }

    @Test
    void emptyWhenArchitectureHasNoModelFile() {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(Optional.empty());

        assertThat(service.computeCoverage(PROJECT_ID, ARCH_ID)).isEmpty();
    }

    @Test
    void newestActiveBaselineWinsWhenTwoCoverTheSameEndpoint() {
        UUID newer = UUID.randomUUID();
        UUID older = UUID.randomUUID();
        UUID opNewer = UUID.randomUUID();
        UUID opOlder = UUID.randomUUID();
        stubModelFileAndEndpoints(endpoint("ep-1", "GET", "/views/{viewId}"));
        // Repository returns newest-first.
        when(baselineRepository.findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, ARCH_ID))
            .thenReturn(List.of(baseline(newer, "active"), baseline(older, "active")));
        when(baselineItemRepository.findByBaselineIdOrderByCreatedAtAsc(newer))
            .thenReturn(List.of(item(newer, opNewer, "GET", "/views/{viewId}")));
        when(baselineItemRepository.findByBaselineIdOrderByCreatedAtAsc(older))
            .thenReturn(List.of(item(older, opOlder, "GET", "/views/{viewId}")));
        when(operationRepository.findAllById(any()))
            .thenReturn(List.of(operation(opNewer, "GET", "/views/{viewId}")))
            .thenReturn(List.of(operation(opOlder, "GET", "/views/{viewId}")));

        List<EndpointBaselineCoverageDto> coverage = service.computeCoverage(PROJECT_ID, ARCH_ID);

        assertThat(coverage).hasSize(1);
        assertThat(coverage.get(0).baselineId()).isEqualTo(newer);
    }
}
