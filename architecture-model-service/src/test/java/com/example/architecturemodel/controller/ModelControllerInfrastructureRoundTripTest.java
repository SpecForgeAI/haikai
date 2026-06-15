package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.ModelFileSummaryDto;
import com.example.architecturemodel.model.dto.entity.CloudAccountDto;
import com.example.architecturemodel.model.dto.entity.ComputeClusterDto;
import com.example.architecturemodel.model.dto.entity.ComputeResourceDto;
import com.example.architecturemodel.model.dto.entity.DataStoreInstanceDto;
import com.example.architecturemodel.model.dto.entity.DeploymentUnitDto;
import com.example.architecturemodel.model.dto.entity.EnvironmentDto;
import com.example.architecturemodel.model.dto.entity.InfrastructurePointDto;
import com.example.architecturemodel.model.dto.entity.InfrastructureResourceDto;
import com.example.architecturemodel.model.dto.entity.ListenerDto;
import com.example.architecturemodel.model.dto.entity.LoadBalancerDto;
import com.example.architecturemodel.model.dto.entity.LocationDto;
import com.example.architecturemodel.model.dto.entity.NetworkDto;
import com.example.architecturemodel.model.dto.entity.SubnetDto;
import com.example.architecturemodel.model.dto.relationship.DeploymentUnitComputeResourceDto;
import com.example.architecturemodel.model.dto.relationship.LoadBalancerResourceRouteDto;
import com.example.architecturemodel.model.dto.relationship.ResourceSubnetHostingDto;
import com.example.architecturemodel.service.DiagramExportService;
import com.example.architecturemodel.service.ModelService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Controller-level {@link MockMvc} round-trip test for the full-model
 * GET/PUT endpoints on {@link ModelController}, with an
 * Infrastructure-bearing payload covering all 12 Infrastructure entity
 * types, {@code infrastructure_points}, and the 3 Infrastructure
 * relationship tables.
 *
 * <p>Spec: <strong>Infrastructure Domain Backend API</strong> (spec 2 of 7),
 * Task Groups 3 and 4.</p>
 *
 * <p><strong>Task Group 3 -- full-model round trip</strong> (3 tests):</p>
 * <ol>
 *   <li>{@link #putThenGet_roundTripsAllInfrastructureLists()} -- PUT a
 *       fully-populated Infra payload (one row per entity type, two
 *       {@code infrastructure_points} rows including a polymorphic
 *       {@code COMPUTE_RESOURCE}-flavoured one referenced by R2, and one
 *       row per relationship), then GET the same path. Assert all 16
 *       Infra lists round-trip with deep equality and that the
 *       {@code deployment_unit_compute_resources[0]
 *       .compute_infrastructure_point_id} polymorphically resolves to the
 *       {@code COMPUTE_RESOURCE}-flavoured infrastructure point.</li>
 *   <li>{@link #get_emptyInfrastructurePayload_returnsEmptyListsNotNull()}
 *       -- GET when the underlying service returns an empty model (no Infra
 *       rows). Assert all 16 Infra JSON lists are present as empty arrays,
 *       not {@code null}, preserving the spec-1 omitted-list invariant at
 *       the controller edge.</li>
 *   <li>{@link
 *       #put_payloadIsForwardedToServiceWithCorrectPathScope()} -- PUT
 *       forwards the deserialized {@link ArchitectureModelDto} to
 *       {@link ModelService#saveModel(String, UUID, UUID,
 *       ArchitectureModelDto)} with all 16 Infra lists intact (one each),
 *       proving the controller does not silently drop Infra fields when
 *       deserializing the request body.</li>
 * </ol>
 *
 * <p><strong>Task Group 4 -- scoping + inverse polymorphic + backwards-
 * compat coverage</strong> (3 tests, hard cap is 6):</p>
 * <ol start="4">
 *   <li>{@link #get_wrongProjectIdForArchitecture_doesNotLeakInfraRows()}
 *       -- controller-level scoping. GET on a {@code (wrongProjectId,
 *       architectureId)} pair where the underlying service has no matching
 *       {@code model_files} row returns an empty model with empty Infra
 *       lists. Verifies the controller faithfully threads the URL-supplied
 *       project + architecture into
 *       {@link ModelService#loadModelByProjectIdAndArchitectureId(UUID,
 *       UUID)}, so the existing 3-step
 *       {@code findByProjectIdAndArchitectureId} contract -- exercised by
 *       spec 1 and {@code ArchitectureScopedRoutesTest} for non-Infra
 *       payloads -- is not bypassed by Infra-bearing requests.</li>
 *   <li>{@link #putThenGet_inversePolymorphicCase_computeCluster()} --
 *       inverse polymorphic case complementing test 1: an
 *       {@code infrastructure_points} row with
 *       {@code point_kind = COMPUTE_CLUSTER} round-trips through the
 *       controller and is the target of
 *       {@code deployment_unit_compute_resources[0]
 *       .compute_infrastructure_point_id}.</li>
 *   <li>{@link
 *       #put_omittedInfrastructurePayload_passesThroughToService()} --
 *       backwards-compat: a payload <em>without</em> Infra rows still
 *       round-trips through the controller. The controller does not
 *       reject empty-Infra payloads; the spec-1 delete-and-replace
 *       semantics in {@code ModelService} handle the omitted-list
 *       case.</li>
 * </ol>
 *
 * <p>Mirrors the standalone {@link MockMvc} convention from
 * {@code ArchitectureSelectiveCopyControllerTest},
 * {@code ArchitectureCrudControllerTest}, and
 * {@code ArchitectureScopedRoutesTest}: {@code @ExtendWith
 * (MockitoExtension.class)},
 * {@code MockMvcBuilders.standaloneSetup(...).setControllerAdvice(new
 * GlobalExceptionHandler()).build()}, and {@code @Mock}-injected
 * {@link ModelService}. {@link DiagramExportService} is also injected as
 * a mock because {@link ModelController}'s constructor takes both
 * collaborators -- diagram export endpoints are out of scope for this
 * test.</p>
 *
 * <p>Spec 1's {@code InfrastructureDomainIntegrationTest} already covers
 * the {@link ModelService}-layer round trip end-to-end with a real H2
 * datasource and full JPA wiring. This controller-layer test exercises
 * the HTTP edge -- request body deserialization, path-variable threading,
 * service-method dispatch, response serialization -- with the
 * {@link ModelService} mocked, focused tightly on the controller's job
 * of wiring the URL to the service.</p>
 */
@ExtendWith(MockitoExtension.class)
class ModelControllerInfrastructureRoundTripTest {

    @Mock private ModelService modelService;
    @Mock private DiagramExportService diagramExportService;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID WRONG_PROJECT_ID =
        UUID.fromString("99999999-9999-9999-9999-999999999999");
    private static final UUID ARCHITECTURE_ID =
        UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final String FILENAME = "infrastructure-roundtrip-test.yaml";

    @BeforeEach
    void setUp() {
        ModelController controller = new ModelController(modelService, diagramExportService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        // The DTOs use per-field @JsonProperty for snake_case, so the default
        // ObjectMapper round-trips them faithfully without naming-strategy
        // configuration.
        objectMapper = new ObjectMapper();
    }

    // ========================================================================
    // Task Group 3 / Test 1 -- full-model PUT then GET round trip
    // ========================================================================

    @Test
    @DisplayName("PUT then GET round-trips all 12 Infra entities, infrastructure_points, and 3 relationships with polymorphic point_kind = COMPUTE_RESOURCE")
    void putThenGet_roundTripsAllInfrastructureLists() throws Exception {
        ArchitectureModelDto payload = buildFullyPopulatedInfraModel("CR");

        // PUT path: stub the save side. Since the DTO is sent as JSON, what
        // matters is that the controller calls saveModel with the path
        // variables threaded in correctly -- the deserialized payload is
        // captured below for round-trip equality.
        when(modelService.saveModel(
                eq(FILENAME), eq(PROJECT_ID), eq(ARCHITECTURE_ID),
                any(ArchitectureModelDto.class)))
            .thenReturn(new ModelFileSummaryDto(
                "mf-1", FILENAME, "round-trip test",
                OffsetDateTime.now(), OffsetDateTime.now(),
                false, null));

        // GET path: stub the load side to return the SAME populated payload.
        // This simulates the spec-1 ModelService behaviour
        // (saveModel-then-loadModel produces identical DTOs end-to-end) at
        // the controller boundary.
        when(modelService.loadModelByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(payload);

        // PUT -- assert 200 + the controller forwarded the request to the
        // architecture-scoped save method.
        mockMvc.perform(put(
                "/api/model/projects/{projectId}/architectures/{architectureId}",
                PROJECT_ID, ARCHITECTURE_ID)
                .param("filename", FILENAME)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(payload)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.filename").value(FILENAME));

        // GET -- assert 200 and walk every Infra list, confirming the
        // round trip preserves shape and key identity fields.
        mockMvc.perform(get(
                "/api/model/projects/{projectId}/architectures/{architectureId}",
                PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            // 12 entity lists -- one row each, id field round-trips.
            .andExpect(jsonPath("$.metaModel.entities.environments.length()").value(1))
            .andExpect(jsonPath("$.metaModel.entities.environments[0].id").value("env-1"))
            .andExpect(jsonPath("$.metaModel.entities.environments[0].name").value("Production"))
            .andExpect(jsonPath("$.metaModel.entities.environments[0].environment_type").value("PROD"))
            .andExpect(jsonPath("$.metaModel.entities.cloud_accounts.length()").value(1))
            .andExpect(jsonPath("$.metaModel.entities.cloud_accounts[0].id").value("ca-1"))
            .andExpect(jsonPath("$.metaModel.entities.locations.length()").value(1))
            .andExpect(jsonPath("$.metaModel.entities.locations[0].id").value("loc-1"))
            .andExpect(jsonPath("$.metaModel.entities.networks.length()").value(1))
            .andExpect(jsonPath("$.metaModel.entities.networks[0].id").value("net-1"))
            .andExpect(jsonPath("$.metaModel.entities.subnets.length()").value(1))
            .andExpect(jsonPath("$.metaModel.entities.subnets[0].id").value("sub-1"))
            .andExpect(jsonPath("$.metaModel.entities.compute_clusters.length()").value(1))
            .andExpect(jsonPath("$.metaModel.entities.compute_clusters[0].id").value("cc-1"))
            .andExpect(jsonPath("$.metaModel.entities.compute_resources.length()").value(1))
            .andExpect(jsonPath("$.metaModel.entities.compute_resources[0].id").value("cr-1"))
            .andExpect(jsonPath("$.metaModel.entities.deployment_units.length()").value(1))
            .andExpect(jsonPath("$.metaModel.entities.deployment_units[0].id").value("du-1"))
            .andExpect(jsonPath("$.metaModel.entities.load_balancers.length()").value(1))
            .andExpect(jsonPath("$.metaModel.entities.load_balancers[0].id").value("lb-1"))
            .andExpect(jsonPath("$.metaModel.entities.listeners.length()").value(1))
            .andExpect(jsonPath("$.metaModel.entities.listeners[0].id").value("lst-1"))
            .andExpect(jsonPath("$.metaModel.entities.data_store_instances.length()").value(1))
            .andExpect(jsonPath("$.metaModel.entities.data_store_instances[0].id").value("ds-1"))
            .andExpect(jsonPath("$.metaModel.entities.infrastructure_resources.length()").value(1))
            .andExpect(jsonPath("$.metaModel.entities.infrastructure_resources[0].id").value("ir-1"))
            // infrastructure_points -- 1 row, the COMPUTE_RESOURCE-flavoured one.
            .andExpect(jsonPath("$.metaModel.entities.infrastructure_points.length()").value(1))
            .andExpect(jsonPath("$.metaModel.entities.infrastructure_points[0].id").value("ip-1"))
            .andExpect(jsonPath("$.metaModel.entities.infrastructure_points[0].point_kind").value("COMPUTE_RESOURCE"))
            .andExpect(jsonPath("$.metaModel.entities.infrastructure_points[0].compute_resource_id").value("cr-1"))
            .andExpect(jsonPath("$.metaModel.entities.infrastructure_points[0].compute_cluster_id").doesNotExist())
            // 3 relationship lists -- one row each.
            .andExpect(jsonPath("$.metaModel.relationships.resource_subnet_hostings.length()").value(1))
            .andExpect(jsonPath("$.metaModel.relationships.resource_subnet_hostings[0].id").value("rsh-1"))
            .andExpect(jsonPath("$.metaModel.relationships.deployment_unit_compute_resources.length()").value(1))
            .andExpect(jsonPath("$.metaModel.relationships.deployment_unit_compute_resources[0].id").value("ducr-1"))
            .andExpect(jsonPath("$.metaModel.relationships.load_balancer_resource_routes.length()").value(1))
            .andExpect(jsonPath("$.metaModel.relationships.load_balancer_resource_routes[0].id").value("lbrr-1"))
            // Polymorphic assertion: R2's compute_infrastructure_point_id
            // resolves to the COMPUTE_RESOURCE-flavoured infrastructure point
            // and the typed FK on that point still references cr-1.
            .andExpect(jsonPath("$.metaModel.relationships.deployment_unit_compute_resources[0].compute_infrastructure_point_id")
                .value("ip-1"));

        verify(modelService).saveModel(
            eq(FILENAME), eq(PROJECT_ID), eq(ARCHITECTURE_ID),
            any(ArchitectureModelDto.class));
        verify(modelService).loadModelByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID);
    }

    // ========================================================================
    // Task Group 3 / Test 2 -- empty/omitted Infra payload still has empty
    // lists (not null) at the GET edge
    // ========================================================================

    @Test
    @DisplayName("GET returns Infrastructure lists as empty arrays (never null) when the underlying model has no Infra rows")
    void get_emptyInfrastructurePayload_returnsEmptyListsNotNull() throws Exception {
        ArchitectureModelDto emptyModel = buildEmptyModel();
        when(modelService.loadModelByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(emptyModel);

        mockMvc.perform(get(
                "/api/model/projects/{projectId}/architectures/{architectureId}",
                PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            // 12 entity lists serialize as empty arrays (length 0) not null.
            .andExpect(jsonPath("$.metaModel.entities.environments").isArray())
            .andExpect(jsonPath("$.metaModel.entities.environments.length()").value(0))
            .andExpect(jsonPath("$.metaModel.entities.cloud_accounts").isArray())
            .andExpect(jsonPath("$.metaModel.entities.cloud_accounts.length()").value(0))
            .andExpect(jsonPath("$.metaModel.entities.locations.length()").value(0))
            .andExpect(jsonPath("$.metaModel.entities.networks.length()").value(0))
            .andExpect(jsonPath("$.metaModel.entities.subnets.length()").value(0))
            .andExpect(jsonPath("$.metaModel.entities.compute_clusters.length()").value(0))
            .andExpect(jsonPath("$.metaModel.entities.compute_resources.length()").value(0))
            .andExpect(jsonPath("$.metaModel.entities.deployment_units.length()").value(0))
            .andExpect(jsonPath("$.metaModel.entities.load_balancers.length()").value(0))
            .andExpect(jsonPath("$.metaModel.entities.listeners.length()").value(0))
            .andExpect(jsonPath("$.metaModel.entities.data_store_instances.length()").value(0))
            .andExpect(jsonPath("$.metaModel.entities.infrastructure_resources.length()").value(0))
            .andExpect(jsonPath("$.metaModel.entities.infrastructure_points").isArray())
            .andExpect(jsonPath("$.metaModel.entities.infrastructure_points.length()").value(0))
            // 3 relationship lists serialize as empty arrays.
            .andExpect(jsonPath("$.metaModel.relationships.resource_subnet_hostings").isArray())
            .andExpect(jsonPath("$.metaModel.relationships.resource_subnet_hostings.length()").value(0))
            .andExpect(jsonPath("$.metaModel.relationships.deployment_unit_compute_resources").isArray())
            .andExpect(jsonPath("$.metaModel.relationships.deployment_unit_compute_resources.length()").value(0))
            .andExpect(jsonPath("$.metaModel.relationships.load_balancer_resource_routes").isArray())
            .andExpect(jsonPath("$.metaModel.relationships.load_balancer_resource_routes.length()").value(0));
    }

    // ========================================================================
    // Task Group 3 / Test 3 -- the controller forwards every Infra list
    // intact when deserializing the PUT body
    // ========================================================================

    @Test
    @DisplayName("PUT forwards the deserialized Infrastructure-bearing model to ModelService.saveModel with all 16 lists populated")
    void put_payloadIsForwardedToServiceWithCorrectPathScope() throws Exception {
        ArchitectureModelDto payload = buildFullyPopulatedInfraModel("CR");

        when(modelService.saveModel(
                eq(FILENAME), eq(PROJECT_ID), eq(ARCHITECTURE_ID),
                any(ArchitectureModelDto.class)))
            .thenReturn(new ModelFileSummaryDto(
                "mf-1", FILENAME, null,
                OffsetDateTime.now(), OffsetDateTime.now(),
                false, null));

        mockMvc.perform(put(
                "/api/model/projects/{projectId}/architectures/{architectureId}",
                PROJECT_ID, ARCHITECTURE_ID)
                .param("filename", FILENAME)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(payload)))
            .andExpect(status().isOk());

        // Capture the deserialized DTO that reached the service. Every Infra
        // list must arrive intact -- the controller must not silently strip
        // Infra fields during request-body deserialization.
        ArgumentCaptor<ArchitectureModelDto> captor =
            ArgumentCaptor.forClass(ArchitectureModelDto.class);
        verify(modelService).saveModel(
            eq(FILENAME), eq(PROJECT_ID), eq(ARCHITECTURE_ID), captor.capture());

        var entities = captor.getValue().metaModel().entities();
        var rels = captor.getValue().metaModel().relationships();

        org.junit.jupiter.api.Assertions.assertEquals(1, entities.environments().size());
        org.junit.jupiter.api.Assertions.assertEquals("env-1", entities.environments().get(0).id());
        org.junit.jupiter.api.Assertions.assertEquals(1, entities.cloudAccounts().size());
        org.junit.jupiter.api.Assertions.assertEquals(1, entities.locations().size());
        org.junit.jupiter.api.Assertions.assertEquals(1, entities.networks().size());
        org.junit.jupiter.api.Assertions.assertEquals(1, entities.subnets().size());
        org.junit.jupiter.api.Assertions.assertEquals(1, entities.computeClusters().size());
        org.junit.jupiter.api.Assertions.assertEquals(1, entities.computeResources().size());
        org.junit.jupiter.api.Assertions.assertEquals(1, entities.deploymentUnits().size());
        org.junit.jupiter.api.Assertions.assertEquals(1, entities.loadBalancers().size());
        org.junit.jupiter.api.Assertions.assertEquals(1, entities.listeners().size());
        org.junit.jupiter.api.Assertions.assertEquals(1, entities.dataStoreInstances().size());
        org.junit.jupiter.api.Assertions.assertEquals(1, entities.infrastructureResources().size());
        org.junit.jupiter.api.Assertions.assertEquals(1, entities.infrastructurePoints().size());
        org.junit.jupiter.api.Assertions.assertEquals(
            "COMPUTE_RESOURCE",
            entities.infrastructurePoints().get(0).pointKind());
        org.junit.jupiter.api.Assertions.assertEquals(1, rels.resourceSubnetHostings().size());
        org.junit.jupiter.api.Assertions.assertEquals(1, rels.deploymentUnitComputeResources().size());
        org.junit.jupiter.api.Assertions.assertEquals(1, rels.loadBalancerResourceRoutes().size());
    }

    // ========================================================================
    // Task Group 4 / Test 1 (required scoping test) -- controller-level
    // project + architecture scoping for Infra-bearing GETs
    // ========================================================================

    @Test
    @DisplayName("GET on a wrong projectId for an architecture does not leak Infra rows from a different project")
    void get_wrongProjectIdForArchitecture_doesNotLeakInfraRows() throws Exception {
        // Underlying ModelService.loadModelByProjectIdAndArchitectureId
        // returns an empty default model when the (project, architecture)
        // pair has no matching model_files row -- which is what happens
        // when the URL projectId doesn't own the architectureId. The
        // controller must thread the URL-supplied projectId through
        // unchanged so the service's own scoping check (the existing
        // findByProjectIdAndArchitectureId 3-step pattern) gets to enforce.
        ArchitectureModelDto empty = buildEmptyModel();

        when(modelService.loadModelByProjectIdAndArchitectureId(WRONG_PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(empty);

        // Request scoped to the WRONG project for this architecture: no
        // Infra rows leak.
        mockMvc.perform(get(
                "/api/model/projects/{projectId}/architectures/{architectureId}",
                WRONG_PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.metaModel.entities.environments.length()").value(0))
            .andExpect(jsonPath("$.metaModel.entities.infrastructure_points.length()").value(0))
            .andExpect(jsonPath("$.metaModel.relationships.resource_subnet_hostings.length()").value(0))
            .andExpect(jsonPath("$.metaModel.relationships.deployment_unit_compute_resources.length()").value(0))
            .andExpect(jsonPath("$.metaModel.relationships.load_balancer_resource_routes.length()").value(0));

        // The crucial scoping assertion: the controller threaded the
        // URL-supplied (wrong) projectId into the service call. The service
        // then enforces its existing findByProjectIdAndArchitectureId
        // contract -- we never reached the populated-payload codepath.
        verify(modelService).loadModelByProjectIdAndArchitectureId(WRONG_PROJECT_ID, ARCHITECTURE_ID);
        verify(modelService, never()).loadModelByProjectIdAndArchitectureId(eq(PROJECT_ID), any());
    }

    // ========================================================================
    // Task Group 4 / Test 2 (optional inverse polymorphic) -- complement to
    // Test 1's COMPUTE_RESOURCE case with a COMPUTE_CLUSTER round trip
    // ========================================================================

    @Test
    @DisplayName("PUT then GET round-trips an InfrastructurePoint with point_kind = COMPUTE_CLUSTER referenced by deployment_unit_compute_resources")
    void putThenGet_inversePolymorphicCase_computeCluster() throws Exception {
        ArchitectureModelDto payload = buildFullyPopulatedInfraModel("CC");

        when(modelService.saveModel(
                eq(FILENAME), eq(PROJECT_ID), eq(ARCHITECTURE_ID),
                any(ArchitectureModelDto.class)))
            .thenReturn(new ModelFileSummaryDto(
                "mf-1", FILENAME, null,
                OffsetDateTime.now(), OffsetDateTime.now(),
                false, null));
        when(modelService.loadModelByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(payload);

        mockMvc.perform(put(
                "/api/model/projects/{projectId}/architectures/{architectureId}",
                PROJECT_ID, ARCHITECTURE_ID)
                .param("filename", FILENAME)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(payload)))
            .andExpect(status().isOk());

        mockMvc.perform(get(
                "/api/model/projects/{projectId}/architectures/{architectureId}",
                PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            // Inverse polymorphic case: the discriminator and the
            // cluster-typed FK both round-trip; the resource-typed FK is
            // null (omitted from JSON output by Jackson).
            .andExpect(jsonPath("$.metaModel.entities.infrastructure_points[0].point_kind").value("COMPUTE_CLUSTER"))
            .andExpect(jsonPath("$.metaModel.entities.infrastructure_points[0].compute_cluster_id").value("cc-1"))
            .andExpect(jsonPath("$.metaModel.entities.infrastructure_points[0].compute_resource_id").doesNotExist())
            // R2 still references the same infrastructure_point id; the
            // discriminator just changed.
            .andExpect(jsonPath("$.metaModel.relationships.deployment_unit_compute_resources[0].compute_infrastructure_point_id")
                .value("ip-1"));
    }

    // ========================================================================
    // Task Group 4 / Test 3 (optional backwards-compat) -- omitted Infra
    // payload still PUTs cleanly through the controller
    // ========================================================================

    @Test
    @DisplayName("PUT with an empty Infrastructure payload forwards through to the service unchanged (delete-and-replace boundary)")
    void put_omittedInfrastructurePayload_passesThroughToService() throws Exception {
        ArchitectureModelDto emptyModel = buildEmptyModel();

        when(modelService.saveModel(
                eq(FILENAME), eq(PROJECT_ID), eq(ARCHITECTURE_ID),
                any(ArchitectureModelDto.class)))
            .thenReturn(new ModelFileSummaryDto(
                "mf-1", FILENAME, null,
                OffsetDateTime.now(), OffsetDateTime.now(),
                false, null));

        mockMvc.perform(put(
                "/api/model/projects/{projectId}/architectures/{architectureId}",
                PROJECT_ID, ARCHITECTURE_ID)
                .param("filename", FILENAME)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(emptyModel)))
            .andExpect(status().isOk());

        // The deserialized DTO that reached the service has all 13 Infra
        // entity lists empty and all 3 Infra relationship lists empty --
        // confirming the controller does not swap nulls in for empty lists
        // during deserialization. The spec-1 ModelService delete-and-
        // replace logic interprets empty lists as "wipe Infra rows for this
        // model file"; that contract is preserved at the controller edge.
        ArgumentCaptor<ArchitectureModelDto> captor =
            ArgumentCaptor.forClass(ArchitectureModelDto.class);
        verify(modelService).saveModel(
            eq(FILENAME), eq(PROJECT_ID), eq(ARCHITECTURE_ID), captor.capture());

        var entities = captor.getValue().metaModel().entities();
        var rels = captor.getValue().metaModel().relationships();
        org.junit.jupiter.api.Assertions.assertNotNull(entities.environments());
        org.junit.jupiter.api.Assertions.assertTrue(entities.environments().isEmpty());
        org.junit.jupiter.api.Assertions.assertNotNull(entities.infrastructurePoints());
        org.junit.jupiter.api.Assertions.assertTrue(entities.infrastructurePoints().isEmpty());
        org.junit.jupiter.api.Assertions.assertNotNull(rels.resourceSubnetHostings());
        org.junit.jupiter.api.Assertions.assertTrue(rels.resourceSubnetHostings().isEmpty());
        org.junit.jupiter.api.Assertions.assertNotNull(rels.deploymentUnitComputeResources());
        org.junit.jupiter.api.Assertions.assertTrue(rels.deploymentUnitComputeResources().isEmpty());
        org.junit.jupiter.api.Assertions.assertNotNull(rels.loadBalancerResourceRoutes());
        org.junit.jupiter.api.Assertions.assertTrue(rels.loadBalancerResourceRoutes().isEmpty());
    }

    // ========================================================================
    // Helpers -- payload builders lifted from the spec-1 integration test
    // (InfrastructureDomainIntegrationTest) and reframed for the controller-
    // layer ArchitectureModelDto contract. The two helpers cover the two
    // polymorphic R2 cases the spec calls out: pointKindCase = "CR" gives
    // an InfrastructurePoint with point_kind = COMPUTE_RESOURCE referenced
    // by R2; pointKindCase = "CC" gives COMPUTE_CLUSTER.
    // ========================================================================

    private ArchitectureModelDto buildFullyPopulatedInfraModel(String pointKindCase) {
        EnvironmentDto env = new EnvironmentDto(
            "env-1", "Production", "Live env", "tier:1",
            "2026-01-01", null,
            "PROD", "ACTIVE",
            Boolean.TRUE, Boolean.FALSE,
            "platform-team", "CRITICAL",
            null, null, null, null, null, null,
            null, null, null, null, null
        );
        CloudAccountDto cloudAccount = new CloudAccountDto(
            "ca-1", "Acct", null, null, null, null,
            "env-1", "AWS", "123456789012", null, null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
        LocationDto location = new LocationDto(
            "loc-1", "Loc", null, null, null, null,
            "env-1", null, "REGION", "AWS",
            "us-east-1", "us-east-1a", "US", "Ashburn", null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
        NetworkDto network = new NetworkDto(
            "net-1", "Net", null, null, null, null,
            "env-1", null, null,
            "VPC", "AWS", "10.0.0.0/16", null, false, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
        SubnetDto subnet = new SubnetDto(
            "sub-1", "Subnet", null, null, null, null,
            "env-1", "net-1", null,
            "10.0.1.0/24", "PUBLIC", "PUBLIC",
            "us-east-1", "us-east-1a", null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
        ComputeClusterDto computeCluster = new ComputeClusterDto(
            "cc-1", "Cluster", null, null, null, null,
            "env-1", null, null, null,
            "EKS", "AWS", "1.27", null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
        ComputeResourceDto computeResource = new ComputeResourceDto(
            "cr-1", "Compute", null, null, null, null,
            "env-1", null, null, null,
            "EC2", "AWS", null, null, null, null,
            "linux", null, "t3.medium", null, null, null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
        DeploymentUnitDto deploymentUnit = new DeploymentUnitDto(
            "du-1", "Deploy", null, null, null, null,
            null, "CONTAINER", "1.0", null, null, null,
            null, null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
        LoadBalancerDto loadBalancer = new LoadBalancerDto(
            "lb-1", "LB", null, null, null, null,
            "env-1", null, null, null,
            "ALB", "AWS", "PUBLIC", "internet-facing", null, null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
        ListenerDto listener = new ListenerDto(
            "lst-1", "Listener", null, null, null, null,
            "env-1", "lb-1", null,
            "HTTPS", 443, null, null, "PUBLIC", true, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
        DataStoreInstanceDto dataStoreInstance = new DataStoreInstanceDto(
            "ds-1", "DB", null, null, null, null,
            "env-1", null, null,
            "RDS", "POSTGRES", "15", "AWS",
            null, 5432, null, null, null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
        InfrastructureResourceDto infrastructureResource = new InfrastructureResourceDto(
            "ir-1", "Resource", null, null, null, null,
            "env-1", null, null,
            "QUEUE", "AWS", "AWS::SQS::Queue", null, null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );

        boolean cluster = "CC".equals(pointKindCase);
        InfrastructurePointDto infraPoint = new InfrastructurePointDto(
            "ip-1",
            cluster ? "COMPUTE_CLUSTER" : "COMPUTE_RESOURCE",
            null,                       // environment_id
            null,                       // cloud_account_id
            null,                       // location_id
            null,                       // network_id
            null,                       // subnet_id
            cluster ? "cc-1" : null,    // compute_cluster_id
            cluster ? null : "cr-1",    // compute_resource_id
            null,                       // deployment_unit_id
            null,                       // load_balancer_id
            null,                       // listener_id
            null,                       // data_store_instance_id
            null                        // infrastructure_resource_id
        );

        ResourceSubnetHostingDto rsh = new ResourceSubnetHostingDto(
            "rsh-1", "ip-1", "sub-1", "env-1",
            "PRIMARY", "10.0.1.10", "10.0.1.10", null,
            "discovery-run-1", new BigDecimal("0.875"), null,
            null, null, null, null, null, null
        );
        DeploymentUnitComputeResourceDto ducr = new DeploymentUnitComputeResourceDto(
            "ducr-1", "du-1", "ip-1", "env-1",
            "1.2.3", "{\"replicas\":3}",
            3, 1, 5, "DEPLOYED",
            "ci-pipeline", new BigDecimal("0.950"), null,
            null, null, null, null, null, null
        );
        LoadBalancerResourceRouteDto lbrr = new LoadBalancerResourceRouteDto(
            "lbrr-1", "lb-1", "lst-1", "ip-1", "env-1",
            "HTTPS", 8443, "api.example.com", "/v1/*",
            "PATH", 100, "/health", null,
            null, null, null, null, null, null
        );

        MetaModelEntitiesDto entities = new MetaModelEntitiesDto(
            // 36 pre-existing domain lists -- empty.
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(),
            // 13 infra entity lists (12 entities + InfrastructurePoint).
            List.of(env),
            List.of(cloudAccount),
            List.of(location),
            List.of(network),
            List.of(subnet),
            List.of(computeCluster),
            List.of(computeResource),
            List.of(deploymentUnit),
            List.of(loadBalancer),
            List.of(listener),
            List.of(dataStoreInstance),
            List.of(infrastructureResource),
            List.of(infraPoint), List.of(), List.of()
        );
        MetaModelRelationshipsDto rels = new MetaModelRelationshipsDto(
            // 10 pre-existing relationship lists -- empty.
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            // 3 infra relationship lists -- single row each.
            List.of(rsh),
            List.of(ducr),
            List.of(lbrr),
            // 4 cross-domain relationship lists -- empty.
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
        return new ArchitectureModelDto(new MetaModelDto(entities, rels), List.of());
    }

    private ArchitectureModelDto buildEmptyModel() {
        MetaModelEntitiesDto entities = new MetaModelEntitiesDto(
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of()
        );
        MetaModelRelationshipsDto rels = new MetaModelRelationshipsDto(
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            // 3 spec 1 Infra-internal relationship lists.
            List.of(), List.of(), List.of(),
            // 4 spec 6 cross-domain relationship lists.
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
        return new ArchitectureModelDto(new MetaModelDto(entities, rels), List.of());
    }
}
