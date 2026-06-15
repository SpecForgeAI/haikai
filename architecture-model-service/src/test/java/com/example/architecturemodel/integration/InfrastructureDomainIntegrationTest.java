package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.entity.ApplicationDto;
import com.example.architecturemodel.model.dto.entity.BusinessProcessDto;
import com.example.architecturemodel.model.dto.entity.BusinessUserDto;
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
import com.example.architecturemodel.model.dto.entity.LogicalDataEntityDto;
import com.example.architecturemodel.model.dto.entity.NetworkDto;
import com.example.architecturemodel.model.dto.entity.SubnetDto;
import com.example.architecturemodel.model.dto.entity.UIScreenDto;
import com.example.architecturemodel.model.dto.relationship.DeploymentUnitComputeResourceDto;
import com.example.architecturemodel.model.dto.relationship.LoadBalancerResourceRouteDto;
import com.example.architecturemodel.model.dto.relationship.ResourceSubnetHostingDto;
import com.example.architecturemodel.model.entity.InfrastructurePointEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.CloudAccountRepository;
import com.example.architecturemodel.repository.entity.ComputeClusterRepository;
import com.example.architecturemodel.repository.entity.ComputeResourceRepository;
import com.example.architecturemodel.repository.entity.DataStoreInstanceRepository;
import com.example.architecturemodel.repository.entity.DeploymentUnitRepository;
import com.example.architecturemodel.repository.entity.EnvironmentRepository;
import com.example.architecturemodel.repository.entity.InfrastructurePointRepository;
import com.example.architecturemodel.repository.entity.InfrastructureResourceRepository;
import com.example.architecturemodel.repository.entity.ListenerRepository;
import com.example.architecturemodel.repository.entity.LoadBalancerRepository;
import com.example.architecturemodel.repository.entity.LocationRepository;
import com.example.architecturemodel.repository.entity.NetworkRepository;
import com.example.architecturemodel.repository.entity.SubnetRepository;
import com.example.architecturemodel.repository.relationship.DeploymentUnitComputeResourceRepository;
import com.example.architecturemodel.repository.relationship.LoadBalancerResourceRouteRepository;
import com.example.architecturemodel.repository.relationship.ResourceSubnetHostingRepository;
import com.example.architecturemodel.service.ModelService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Transactional;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * End-to-end integration tests for the Infrastructure Domain backend.
 *
 * <p>Closes Task Group 8 of spec
 * 2026-05-04-infrastructure-domain-backend-foundation by exercising the full
 * pipeline that Groups 1-7 built (Liquibase schema, JPA entities, DTOs,
 * repositories, EntityMapper extensions, MetaModel DTO extensions, and
 * ModelService save/load/delete-and-replace integration) end-to-end through
 * {@link ModelService#saveModel(String, ArchitectureModelDto)} and
 * {@link ModelService#loadModel(String)}.</p>
 *
 * <p>Per tasks.md sub-task 8.3, this file caps additional strategic tests at
 * <strong>6</strong>:</p>
 * <ol>
 *   <li>Round-trip with at least one row of each of the 12 entity types,
 *       an InfrastructurePoint row, and one row of each of the 3
 *       relationships.</li>
 *   <li>Polymorphic R2 with {@code point_kind = COMPUTE_CLUSTER}.</li>
 *   <li>Polymorphic R2 with {@code point_kind = COMPUTE_RESOURCE} (the
 *       optional symmetric case).</li>
 *   <li>Delete-and-replace: save populated then save empty; assert prior
 *       rows are gone via direct repository queries.</li>
 *   <li>CHECK constraint propagation: zero / two / mismatched typed FKs each
 *       surface as {@link DataIntegrityViolationException}.</li>
 *   <li>Existing-suite regression: a model containing only Business +
 *       Application + Data + Behavioural + UI rows still round-trips with
 *       the same shape it had before this spec (i.e. no infra leakage and
 *       the existing domain lists are populated identically).</li>
 * </ol>
 *
 * <p>The test uses {@code @SpringBootTest} + {@code @Transactional} to align
 * with the existing convention of integration tests that exercise
 * {@link ModelService} (see {@code TypedContentEndToEndTest},
 * {@code BusinessLogicIntegrationTest}). The default test profile uses
 * H2 in PostgreSQL mode; the {@code jsonb} column on
 * {@code DeploymentUnitComputeResourceEntity.runtimeConfig} round-trips
 * through Hypersistence's {@code JsonType} the same way as the existing
 * {@code DiagramEntity.settings} column already exercised by
 * {@code TypedContentEndToEndTest}.</p>
 */
@SpringBootTest
@Transactional
@TestPropertySource(properties = {
    // The {@code ui_characteristics} table contains a column named
    // {@code key}, which the H2 PostgreSQL-mode parser treats as a reserved
    // keyword (Hibernate-generated SQL leaves the column unquoted, matching
    // the production PostgreSQL schema). Adding {@code NON_KEYWORDS=KEY}
    // tells H2 to treat KEY as a regular identifier so the load path that
    // touches every domain (including ui_characteristics) does not blow up
    // with a syntax error. This is test-only; production is real PostgreSQL.
    "spring.datasource.url=jdbc:h2:mem:infraintegrationdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;NON_KEYWORDS=KEY"
})
class InfrastructureDomainIntegrationTest {

    @Autowired private ModelService modelService;
    @Autowired private ModelFileRepository modelFileRepository;

    @Autowired private EnvironmentRepository environmentRepository;
    @Autowired private CloudAccountRepository cloudAccountRepository;
    @Autowired private LocationRepository locationRepository;
    @Autowired private NetworkRepository networkRepository;
    @Autowired private SubnetRepository subnetRepository;
    @Autowired private ComputeClusterRepository computeClusterRepository;
    @Autowired private ComputeResourceRepository computeResourceRepository;
    @Autowired private DeploymentUnitRepository deploymentUnitRepository;
    @Autowired private LoadBalancerRepository loadBalancerRepository;
    @Autowired private ListenerRepository listenerRepository;
    @Autowired private DataStoreInstanceRepository dataStoreInstanceRepository;
    @Autowired private InfrastructureResourceRepository infrastructureResourceRepository;
    @Autowired private InfrastructurePointRepository infrastructurePointRepository;
    @Autowired private ResourceSubnetHostingRepository resourceSubnetHostingRepository;
    @Autowired private DeploymentUnitComputeResourceRepository deploymentUnitComputeResourceRepository;
    @Autowired private LoadBalancerResourceRouteRepository loadBalancerResourceRouteRepository;

    @PersistenceContext private EntityManager entityManager;

    private String testFilename;
    private String modelFileId;

    @BeforeEach
    void setUp() {
        // Each test gets a fresh filename so model_file_id tracking is
        // isolated. The save path picks up the active project (if any) but
        // when none is configured falls back to legacy findByFilename.
        testFilename = "infra-it-" + UUID.randomUUID();
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("mf-" + UUID.randomUUID())
            .filename(testFilename)
            .description("Infrastructure-Domain integration test model")
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .isDefault(false)
            .build();
        modelFileRepository.save(modelFile);
        entityManager.flush();
        modelFileId = modelFile.getId();
    }

    // ========================================================================
    // Test 1 (8.3): Save -> load round-trip across all 12 entity types,
    // InfrastructurePoint, and the 3 relationships.
    // ========================================================================

    @Test
    @DisplayName("Round-trip: save + load preserves all 12 infra entities, infra_point, 3 relationships")
    void roundTripPopulatedInfrastructureModel() {
        ArchitectureModelDto saved = buildFullyPopulatedInfraModel("CR");
        modelService.saveModel(testFilename, saved);
        entityManager.flush();
        entityManager.clear();

        ArchitectureModelDto loaded = modelService.loadModel(testFilename);

        // 12 entity types, 1 InfrastructurePoint, 3 relationships -- each
        // single-row.
        var entities = loaded.metaModel().entities();
        assertThat(entities.environments()).extracting(EnvironmentDto::id)
            .containsExactly("env-1");
        assertThat(entities.cloudAccounts()).extracting(CloudAccountDto::id)
            .containsExactly("ca-1");
        assertThat(entities.locations()).extracting(LocationDto::id)
            .containsExactly("loc-1");
        assertThat(entities.networks()).extracting(NetworkDto::id)
            .containsExactly("net-1");
        assertThat(entities.subnets()).extracting(SubnetDto::id)
            .containsExactly("sub-1");
        assertThat(entities.computeClusters()).extracting(ComputeClusterDto::id)
            .containsExactly("cc-1");
        assertThat(entities.computeResources()).extracting(ComputeResourceDto::id)
            .containsExactly("cr-1");
        assertThat(entities.deploymentUnits()).extracting(DeploymentUnitDto::id)
            .containsExactly("du-1");
        assertThat(entities.loadBalancers()).extracting(LoadBalancerDto::id)
            .containsExactly("lb-1");
        assertThat(entities.listeners()).extracting(ListenerDto::id)
            .containsExactly("lst-1");
        assertThat(entities.dataStoreInstances()).extracting(DataStoreInstanceDto::id)
            .containsExactly("ds-1");
        assertThat(entities.infrastructureResources()).extracting(InfrastructureResourceDto::id)
            .containsExactly("ir-1");

        assertThat(entities.infrastructurePoints()).hasSize(1);
        InfrastructurePointDto point = entities.infrastructurePoints().get(0);
        assertThat(point.id()).isEqualTo("ip-1");
        assertThat(point.pointKind()).isEqualTo("COMPUTE_RESOURCE");
        assertThat(point.computeResourceId()).isEqualTo("cr-1");

        var rels = loaded.metaModel().relationships();
        assertThat(rels.resourceSubnetHostings()).extracting(ResourceSubnetHostingDto::id)
            .containsExactly("rsh-1");
        assertThat(rels.deploymentUnitComputeResources())
            .extracting(DeploymentUnitComputeResourceDto::id)
            .containsExactly("ducr-1");
        assertThat(rels.loadBalancerResourceRoutes())
            .extracting(LoadBalancerResourceRouteDto::id)
            .containsExactly("lbrr-1");

        // Spot-check non-id fields preserved through the full round-trip.
        EnvironmentDto loadedEnv = entities.environments().get(0);
        assertThat(loadedEnv.environmentType()).isEqualTo("PROD");
        assertThat(loadedEnv.isCurrentState()).isTrue();
        DeploymentUnitComputeResourceDto loadedDucr = rels.deploymentUnitComputeResources().get(0);
        assertThat(loadedDucr.computeInfrastructurePointId()).isEqualTo("ip-1");
        assertThat(loadedDucr.runtimeConfig()).contains("\"replicas\":3");
    }

    // ========================================================================
    // Test 2 (8.3): Polymorphic R2 with point_kind = COMPUTE_CLUSTER
    // ========================================================================

    @Test
    @DisplayName("Polymorphic R2: deployment_unit_compute_resources -> InfrastructurePoint(COMPUTE_CLUSTER)")
    void polymorphicR2WithComputeClusterPointKind() {
        ArchitectureModelDto saved = buildFullyPopulatedInfraModel("CC");
        modelService.saveModel(testFilename, saved);
        entityManager.flush();
        entityManager.clear();

        ArchitectureModelDto loaded = modelService.loadModel(testFilename);

        // InfrastructurePoint round-trips with the cluster discriminator and
        // exactly one typed FK set.
        InfrastructurePointDto point = loaded.metaModel().entities()
            .infrastructurePoints().get(0);
        assertThat(point.pointKind()).isEqualTo("COMPUTE_CLUSTER");
        assertThat(point.computeClusterId()).isEqualTo("cc-1");
        assertThat(point.computeResourceId()).isNull();

        // R2 row references the cluster-flavoured infra point.
        DeploymentUnitComputeResourceDto rel = loaded.metaModel().relationships()
            .deploymentUnitComputeResources().get(0);
        assertThat(rel.computeInfrastructurePointId()).isEqualTo("ip-1");

        // And the same row is reachable via the repository directly (i.e. the
        // join is real, not an artefact of DTO mapping).
        assertThat(infrastructurePointRepository.findByModelFileId(modelFileId))
            .extracting(InfrastructurePointEntity::getPointKind)
            .containsExactly("COMPUTE_CLUSTER");
    }

    // ========================================================================
    // Test 3 (8.3, optional): Polymorphic R2 with point_kind = COMPUTE_RESOURCE
    // -- the symmetric case. Cheap because it reuses the same builders.
    // ========================================================================

    @Test
    @DisplayName("Polymorphic R2: deployment_unit_compute_resources -> InfrastructurePoint(COMPUTE_RESOURCE)")
    void polymorphicR2WithComputeResourcePointKind() {
        ArchitectureModelDto saved = buildFullyPopulatedInfraModel("CR");
        modelService.saveModel(testFilename, saved);
        entityManager.flush();
        entityManager.clear();

        InfrastructurePointDto point = modelService.loadModel(testFilename)
            .metaModel().entities().infrastructurePoints().get(0);
        assertThat(point.pointKind()).isEqualTo("COMPUTE_RESOURCE");
        assertThat(point.computeResourceId()).isEqualTo("cr-1");
        assertThat(point.computeClusterId()).isNull();
    }

    // ========================================================================
    // Test 4 (8.3): Delete-and-replace -- save populated, save empty, assert
    // every prior infrastructure row is gone via direct repository queries.
    // ========================================================================

    @Test
    @DisplayName("Delete-and-replace: empty save wipes prior infrastructure rows")
    void deleteAndReplaceWipesPriorInfrastructureRows() {
        // Populate.
        modelService.saveModel(testFilename, buildFullyPopulatedInfraModel("CR"));
        entityManager.flush();

        // Sanity-check rows landed under our model file.
        assertThat(environmentRepository.findByModelFileId(modelFileId)).hasSize(1);
        assertThat(infrastructurePointRepository.findByModelFileId(modelFileId)).hasSize(1);
        assertThat(deploymentUnitComputeResourceRepository.findByModelFileId(modelFileId))
            .hasSize(1);

        // Replace with an empty payload.
        modelService.saveModel(testFilename, buildEmptyModel());
        entityManager.flush();
        entityManager.clear();

        // Direct repository queries: every infra row for this model file is gone.
        assertThat(environmentRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(cloudAccountRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(locationRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(networkRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(subnetRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(computeClusterRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(computeResourceRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(deploymentUnitRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(loadBalancerRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(listenerRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(dataStoreInstanceRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(infrastructureResourceRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(infrastructurePointRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(resourceSubnetHostingRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(deploymentUnitComputeResourceRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(loadBalancerResourceRouteRepository.findByModelFileId(modelFileId)).isEmpty();
    }

    // ========================================================================
    // Test 5 (8.3): CHECK constraint propagates DataIntegrityViolationException
    // for zero / multiple / mismatched typed FKs on InfrastructurePoint.
    //
    // Constraint enforcement at the JPA layer is already exercised by Task 1.1
    // ({@code InfrastructurePointConstraintTest}) at the @DataJpaTest slice;
    // this test re-asserts the same propagation from the @SpringBootTest
    // surface so the integration test bundle is self-contained: callers using
    // the full Spring context observe the same DataIntegrityViolationException
    // bubble up.
    // ========================================================================

    @Test
    @DisplayName("CHECK propagation: zero/two/mismatched FKs all surface DataIntegrityViolationException")
    void checkConstraintPropagatesAtJpaLayer() {
        // Seed the parents the InfrastructurePoint will refer to.
        modelService.saveModel(testFilename, buildFullyPopulatedInfraModel("CR"));
        entityManager.flush();
        entityManager.clear();

        // Case A: zero typed FKs -- (a) of the CHECK rejects.
        InfrastructurePointEntity zeroFk = InfrastructurePointEntity.builder()
            .id("ip-bad-zero")
            .modelFileId(modelFileId)
            .pointKind("COMPUTE_RESOURCE")
            .build();
        assertThatThrownBy(() -> {
            infrastructurePointRepository.save(zeroFk);
            infrastructurePointRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
        entityManager.clear();

        // Case B: two typed FKs -- (a) of the CHECK rejects.
        InfrastructurePointEntity twoFks = InfrastructurePointEntity.builder()
            .id("ip-bad-two")
            .modelFileId(modelFileId)
            .pointKind("COMPUTE_RESOURCE")
            .computeResourceId("cr-1")
            .computeClusterId("cc-1")
            .build();
        assertThatThrownBy(() -> {
            infrastructurePointRepository.save(twoFks);
            infrastructurePointRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
        entityManager.clear();

        // Case C: mismatched discriminator -- (b) of the CHECK rejects.
        InfrastructurePointEntity mismatch = InfrastructurePointEntity.builder()
            .id("ip-bad-mismatch")
            .modelFileId(modelFileId)
            .pointKind("COMPUTE_RESOURCE")
            .computeClusterId("cc-1")
            .build();
        assertThatThrownBy(() -> {
            infrastructurePointRepository.save(mismatch);
            infrastructurePointRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }

    // ========================================================================
    // Test 6 (8.3): Existing-suite regression -- a model containing ONLY
    // pre-existing domain rows (Business + Application + Data + Behavioural +
    // UI shape captured here as one example each, all from before this spec)
    // round-trips with the same shape it had before. The 13 new infra entity
    // lists and 3 new relationship lists default to empty (not null).
    // ========================================================================

    @Test
    @DisplayName("Regression: pre-existing-domain-only model round-trips unchanged with empty infra lists")
    void existingSuiteRegressionWithEmptyInfrastructureSection() {
        BusinessUserDto businessUser = new BusinessUserDto(
            "bu-1", "Customer", "Sample customer user", "external", "CUST"
        );
        BusinessProcessDto businessProcess = new BusinessProcessDto(
            "bp-1", "Order", "Order process", "tier:1", null, null
        );
        ApplicationDto application = new ApplicationDto(
            "app-1", "Orders", "Customer-facing orders app",
            "WEB", "ACTIVE", "tier:1", null, null, Boolean.TRUE, "ORD"
        );
        LogicalDataEntityDto logicalDataEntity = new LogicalDataEntityDto(
            "lde-1", "Customer", "Customer logical entity",
            "domain:customer", null, null,
            null
        );
        UIScreenDto uiScreen = new UIScreenDto(
            "uis-1", "Order Confirmation Screen",
            "/orders/confirm", "Order confirmation", null
        );

        MetaModelEntitiesDto entities = new MetaModelEntitiesDto(
            List.of(businessUser),     // businessUsers
            List.of(businessProcess),  // businessProcesses
            List.of(),                 // processActivities
            List.of(),                 // businessPoints
            List.of(application),      // applications
            List.of(),                 // appComponents
            List.of(),                 // services
            List.of(),                 // interfaces
            List.of(),                 // endpoints
            List.of(),                 // classes
            List.of(),                 // methods
            List.of(),                 // applicationPoints
            List.of(logicalDataEntity),// logicalDataEntities
            List.of(),                 // logicalDataAttributes
            List.of(),                 // physicalDataEntities
            List.of(),                 // physicalDataAttributes
            List.of(),                 // dataEntityPoints
            List.of(),                 // interactions
            List.of(),                 // appBusinessPoints
            List.of(),                 // events
            List.of(),                 // states
            List.of(),                 // stateTransitions
            List.of(),                 // activities
            List.of(),                 // activityFlows
            List.of(),                 // activityPartitions
            List.of(uiScreen),         // uiScreens
            List.of(),                 // uiContracts
            List.of(),                 // uiComponents
            List.of(),                 // uiActions
            List.of(),                 // uiCharacteristics
            List.of(),                 // businessLogics
            List.of(),                 // packageSets
            List.of(),                 // packages
            List.of(),                 // packageSetDefaultRules
            List.of(),                 // userJourneys
            List.of(),                 // activitySteps,
            // Infrastructure domain -- 13 lists, all empty.
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(),
            // iacSources, libraries
            List.of(), List.of()
        );
        MetaModelRelationshipsDto relationships = buildEmptyRelationships();
        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(entities, relationships), List.of());

        modelService.saveModel(testFilename, model);
        entityManager.flush();
        entityManager.clear();

        ArchitectureModelDto loaded = modelService.loadModel(testFilename);

        var loadedEntities = loaded.metaModel().entities();

        // Existing domains round-trip unchanged.
        assertThat(loadedEntities.businessUsers()).extracting(BusinessUserDto::id)
            .containsExactly("bu-1");
        assertThat(loadedEntities.businessProcesses()).extracting(BusinessProcessDto::id)
            .containsExactly("bp-1");
        assertThat(loadedEntities.applications()).extracting(ApplicationDto::id)
            .containsExactly("app-1");
        assertThat(loadedEntities.logicalDataEntities()).extracting(LogicalDataEntityDto::id)
            .containsExactly("lde-1");
        assertThat(loadedEntities.uiScreens()).extracting(UIScreenDto::id)
            .containsExactly("uis-1");

        // 13 infra entity lists default to empty (never null).
        assertThat(loadedEntities.environments()).isEmpty();
        assertThat(loadedEntities.cloudAccounts()).isEmpty();
        assertThat(loadedEntities.locations()).isEmpty();
        assertThat(loadedEntities.networks()).isEmpty();
        assertThat(loadedEntities.subnets()).isEmpty();
        assertThat(loadedEntities.computeClusters()).isEmpty();
        assertThat(loadedEntities.computeResources()).isEmpty();
        assertThat(loadedEntities.deploymentUnits()).isEmpty();
        assertThat(loadedEntities.loadBalancers()).isEmpty();
        assertThat(loadedEntities.listeners()).isEmpty();
        assertThat(loadedEntities.dataStoreInstances()).isEmpty();
        assertThat(loadedEntities.infrastructureResources()).isEmpty();
        assertThat(loadedEntities.infrastructurePoints()).isEmpty();

        // 3 infra relationship lists default to empty (never null).
        assertThat(loaded.metaModel().relationships().resourceSubnetHostings()).isEmpty();
        assertThat(loaded.metaModel().relationships().deploymentUnitComputeResources()).isEmpty();
        assertThat(loaded.metaModel().relationships().loadBalancerResourceRoutes()).isEmpty();
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    /**
     * Builds a model fully populated with one row per infrastructure entity
     * type, an InfrastructurePoint, and one row per infrastructure
     * relationship.
     *
     * @param pointKindCase {@code "CR"} for {@code COMPUTE_RESOURCE} or
     *                       {@code "CC"} for {@code COMPUTE_CLUSTER} -- both
     *                       drive the discriminator on the
     *                       {@code InfrastructurePoint} row referenced by
     *                       the {@code deployment_unit_compute_resources}
     *                       row (R2). All other fields are identical.
     */
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

        // The InfrastructurePoint discriminator + typed FK is the only thing
        // that varies between the two polymorphic-R2 cases.
        boolean cluster = "CC".equals(pointKindCase);
        InfrastructurePointDto infraPoint = new InfrastructurePointDto(
            "ip-1",
            cluster ? "COMPUTE_CLUSTER" : "COMPUTE_RESOURCE",
            null,                  // environment_id
            null,                  // cloud_account_id
            null,                  // location_id
            null,                  // network_id
            null,                  // subnet_id
            cluster ? "cc-1" : null, // compute_cluster_id
            cluster ? null : "cr-1", // compute_resource_id
            null,                  // deployment_unit_id
            null,                  // load_balancer_id
            null,                  // listener_id
            null,                  // data_store_instance_id
            null                   // infrastructure_resource_id
        );

        ResourceSubnetHostingDto rsh = new ResourceSubnetHostingDto(
            "rsh-1", "ip-1", "sub-1", "env-1",
            "PRIMARY", "10.0.1.10", "10.0.1.10", null,
            "discovery-run-1", new BigDecimal("0.875"), null,
            null, null, null, null, null, null
        );
        DeploymentUnitComputeResourceDto ducr = new DeploymentUnitComputeResourceDto(
            "ducr-1", "du-1", "ip-1", "env-1",
            "1.2.3", "{\"replicas\":3,\"flags\":[\"a\",\"b\"]}",
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
            List.of(infraPoint),
            // iacSources, libraries
            List.of(), List.of()
        );
        MetaModelRelationshipsDto rels = new MetaModelRelationshipsDto(
            // 10 pre-existing relationship lists -- empty.
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            // 3 infra relationship lists -- single row each.
            List.of(rsh),
            List.of(ducr),
            List.of(lbrr),
            // 4 cross-domain relationship lists (Spec: 2026-05-05-infrastructure-cross-domain-integration) -- empty.
            List.of(), List.of(), List.of(), List.of(),
            // iacResourceBindings, codeUnitDependencies
            List.of(), List.of()
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
            List.of(), List.of(), List.of(),
            List.of(), List.of()
        );
        return new ArchitectureModelDto(
            new MetaModelDto(entities, buildEmptyRelationships()),
            List.of());
    }

    private MetaModelRelationshipsDto buildEmptyRelationships() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyRelationships();
    }
}
