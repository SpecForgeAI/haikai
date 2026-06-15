package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.relationship.ApplicationComputeDeploymentDto;
import com.example.architecturemodel.model.dto.relationship.ApplicationInfrastructureResourceUseDto;
import com.example.architecturemodel.model.dto.relationship.ApplicationLoadBalancerExposureDto;
import com.example.architecturemodel.model.dto.relationship.DataEntityDataStoreHostingDto;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.relationship.ApplicationComputeDeploymentRepository;
import com.example.architecturemodel.repository.relationship.ApplicationInfrastructureResourceUseRepository;
import com.example.architecturemodel.repository.relationship.ApplicationLoadBalancerExposureRepository;
import com.example.architecturemodel.repository.relationship.DataEntityDataStoreHostingRepository;
import com.example.architecturemodel.service.ModelService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Transactional;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * End-to-end integration tests for the 4 infrastructure cross-domain
 * relationships (Spec: 2026-05-05-infrastructure-cross-domain-integration,
 * Task 4.1).
 *
 * <p>Exercises the full save/load/delete-and-replace pipeline through
 * {@link ModelService#saveModel(String, ArchitectureModelDto)} and
 * {@link ModelService#loadModel(String)} for each of:
 * <ul>
 *   <li>application_compute_deployments (XR1)</li>
 *   <li>data_entity_data_store_hostings (XR2)</li>
 *   <li>application_infrastructure_resource_uses (XR3)</li>
 *   <li>application_load_balancer_exposures (XR4)</li>
 * </ul>
 *
 * <p>Per spec contract: H2 in PostgreSQL mode is the test backend, FK
 * constraints between cross-domain relationship rows and parent rows are not
 * emitted by the entity-level @Column-as-String mapping (matches DataMovement
 * + spec 2 Infra-internal relationship pattern), so endpoint ids are plain
 * strings without dependent parent rows. The pipeline under test is the DTO
 * <-> entity mapping, save, load, and delete-and-replace, NOT cross-table FK
 * enforcement (which is exercised at the @DataJpaTest slice in
 * {@code InfrastructureCrossDomainFkConstraintTest}).</p>
 */
@SpringBootTest
@Transactional
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:xdomintegrationdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;NON_KEYWORDS=KEY"
})
class InfrastructureCrossDomainRelationshipsRoundTripTest {

    @Autowired private ModelService modelService;
    @Autowired private ModelFileRepository modelFileRepository;

    @Autowired private ApplicationComputeDeploymentRepository applicationComputeDeploymentRepository;
    @Autowired private DataEntityDataStoreHostingRepository dataEntityDataStoreHostingRepository;
    @Autowired private ApplicationInfrastructureResourceUseRepository applicationInfrastructureResourceUseRepository;
    @Autowired private ApplicationLoadBalancerExposureRepository applicationLoadBalancerExposureRepository;

    @PersistenceContext private EntityManager entityManager;

    private String testFilename;
    private String modelFileId;

    @BeforeEach
    void setUp() {
        testFilename = "xdom-it-" + UUID.randomUUID();
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("mf-" + UUID.randomUUID())
            .filename(testFilename)
            .description("Cross-domain integration test model")
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .isDefault(false)
            .build();
        modelFileRepository.save(modelFile);
        entityManager.flush();
        modelFileId = modelFile.getId();
    }

    /**
     * Test 1 (4.1): Save -> load round-trip for XR1 + XR2 (one row each).
     */
    @Test
    @DisplayName("Round-trip: XR1 application_compute_deployments + XR2 data_entity_data_store_hostings")
    void roundTripXr1AndXr2() {
        ApplicationComputeDeploymentDto xr1 = new ApplicationComputeDeploymentDto(
            "xr1-1", "ap-1", "cr-1", "du-1", "env-1",
            "PRIMARY", "node", "20.10",
            "ci-pipeline", new BigDecimal("0.950"),
            "Orders app on primary EKS cluster", "[\"prod\"]"
        );
        DataEntityDataStoreHostingDto xr2 = new DataEntityDataStoreHostingDto(
            "xr2-1", "dep-log-customer", "ds-1", "env-1",
            "orders_db", "public", "customers", "PRIMARY",
            "manual", new BigDecimal("0.800"),
            "Customer entity hosted on primary RDS", "[\"oltp\"]"
        );

        modelService.saveModel(testFilename, buildModel(List.of(xr1), List.of(xr2), List.of(), List.of()));
        entityManager.flush();
        entityManager.clear();

        var rels = modelService.loadModel(testFilename).metaModel().relationships();
        assertThat(rels.applicationComputeDeployments())
            .extracting(ApplicationComputeDeploymentDto::id)
            .containsExactly("xr1-1");
        assertThat(rels.applicationComputeDeployments().get(0).deploymentRole()).isEqualTo("PRIMARY");
        assertThat(rels.applicationComputeDeployments().get(0).confidence())
            .isEqualByComparingTo(new BigDecimal("0.950"));
        assertThat(rels.applicationComputeDeployments().get(0).description())
            .isEqualTo("Orders app on primary EKS cluster");

        assertThat(rels.dataEntityDataStoreHostings())
            .extracting(DataEntityDataStoreHostingDto::id)
            .containsExactly("xr2-1");
        assertThat(rels.dataEntityDataStoreHostings().get(0).hostingRole()).isEqualTo("PRIMARY");
        assertThat(rels.dataEntityDataStoreHostings().get(0).tableOrCollectionName()).isEqualTo("customers");
    }

    /**
     * Test 2 (4.1): Save -> load round-trip for XR3 + XR4 (one row each).
     */
    @Test
    @DisplayName("Round-trip: XR3 application_infrastructure_resource_uses + XR4 application_load_balancer_exposures")
    void roundTripXr3AndXr4() {
        ApplicationInfrastructureResourceUseDto xr3 = new ApplicationInfrastructureResourceUseDto(
            "xr3-1", "ap-1", "ir-1", "env-1",
            "READS_FROM", "HTTPS", "/orders/topic", "READ",
            "manual", new BigDecimal("0.700"),
            "Orders app reads from messaging topic", "[\"messaging\"]"
        );
        ApplicationLoadBalancerExposureDto xr4 = new ApplicationLoadBalancerExposureDto(
            "xr4-1", "ap-1", "lb-1", "lst-1", "env-1",
            "api.example.com", "/v1/*", "HTTPS", 443, "PUBLIC",
            "manual", new BigDecimal("0.875"),
            "Public API ingress for Orders", "[\"public\"]"
        );

        modelService.saveModel(testFilename, buildModel(List.of(), List.of(), List.of(xr3), List.of(xr4)));
        entityManager.flush();
        entityManager.clear();

        var rels = modelService.loadModel(testFilename).metaModel().relationships();
        assertThat(rels.applicationInfrastructureResourceUses())
            .extracting(ApplicationInfrastructureResourceUseDto::id)
            .containsExactly("xr3-1");
        assertThat(rels.applicationInfrastructureResourceUses().get(0).dependencyType()).isEqualTo("READS_FROM");
        assertThat(rels.applicationInfrastructureResourceUses().get(0).accessMode()).isEqualTo("READ");
        assertThat(rels.applicationInfrastructureResourceUses().get(0).endpointOrTopic()).isEqualTo("/orders/topic");

        assertThat(rels.applicationLoadBalancerExposures())
            .extracting(ApplicationLoadBalancerExposureDto::id)
            .containsExactly("xr4-1");
        ApplicationLoadBalancerExposureDto loadedXr4 = rels.applicationLoadBalancerExposures().get(0);
        assertThat(loadedXr4.targetPort()).isEqualTo(443);
        assertThat(loadedXr4.exposure()).isEqualTo("PUBLIC");
        assertThat(loadedXr4.protocol()).isEqualTo("HTTPS");
        assertThat(loadedXr4.listenerId()).isEqualTo("lst-1");
    }

    /**
     * Test 3 (4.1): Delete-and-replace -- save populated, save empty, assert
     * every cross-domain relationship row is gone via direct repository
     * queries.
     */
    @Test
    @DisplayName("Delete-and-replace: empty save wipes prior cross-domain rows")
    void deleteAndReplaceWipesPriorCrossDomainRows() {
        ApplicationComputeDeploymentDto xr1 = new ApplicationComputeDeploymentDto(
            "xr1-d", "ap-1", "cr-1", null, null,
            null, null, null, null, null, "row 1", "[]");
        DataEntityDataStoreHostingDto xr2 = new DataEntityDataStoreHostingDto(
            "xr2-d", "dep-1", "ds-1", null, null, null, null, null, null, null,
            "row 2", "[]");
        ApplicationInfrastructureResourceUseDto xr3 = new ApplicationInfrastructureResourceUseDto(
            "xr3-d", "ap-1", "ir-1", null, null, null, null, null, null, null,
            "row 3", "[]");
        ApplicationLoadBalancerExposureDto xr4 = new ApplicationLoadBalancerExposureDto(
            "xr4-d", "ap-1", "lb-1", null, null, null, null, null, null, null,
            null, null, "row 4", "[]");

        modelService.saveModel(testFilename,
            buildModel(List.of(xr1), List.of(xr2), List.of(xr3), List.of(xr4)));
        entityManager.flush();

        // Sanity: rows landed under our model file.
        assertThat(applicationComputeDeploymentRepository.findByModelFileId(modelFileId)).hasSize(1);
        assertThat(dataEntityDataStoreHostingRepository.findByModelFileId(modelFileId)).hasSize(1);
        assertThat(applicationInfrastructureResourceUseRepository.findByModelFileId(modelFileId)).hasSize(1);
        assertThat(applicationLoadBalancerExposureRepository.findByModelFileId(modelFileId)).hasSize(1);

        // Replace with empty payload.
        modelService.saveModel(testFilename, buildModel(List.of(), List.of(), List.of(), List.of()));
        entityManager.flush();
        entityManager.clear();

        assertThat(applicationComputeDeploymentRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(dataEntityDataStoreHostingRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(applicationInfrastructureResourceUseRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(applicationLoadBalancerExposureRepository.findByModelFileId(modelFileId)).isEmpty();
    }

    /**
     * Test 4 (4.1): Replace semantics -- saving a different row set replaces
     * (not merges) prior rows. Validates that the delete-and-replace pipeline
     * runs before the save in the same transaction.
     */
    @Test
    @DisplayName("Replace semantics: second save replaces (not merges) prior rows")
    void replaceSemanticsForCrossDomainRows() {
        ApplicationComputeDeploymentDto first = new ApplicationComputeDeploymentDto(
            "xr1-first", "ap-1", "cr-1", null, null,
            "PRIMARY", null, null, null, null, "first", "[]");
        modelService.saveModel(testFilename, buildModel(List.of(first), List.of(), List.of(), List.of()));
        entityManager.flush();

        ApplicationComputeDeploymentDto second = new ApplicationComputeDeploymentDto(
            "xr1-second", "ap-2", "cr-2", null, null,
            "WORKER", null, null, null, null, "second", "[]");
        modelService.saveModel(testFilename, buildModel(List.of(second), List.of(), List.of(), List.of()));
        entityManager.flush();
        entityManager.clear();

        var loaded = applicationComputeDeploymentRepository.findByModelFileId(modelFileId);
        assertThat(loaded).hasSize(1);
        assertThat(loaded.get(0).getId()).isEqualTo("xr1-second");
        assertThat(loaded.get(0).getDeploymentRole()).isEqualTo("WORKER");
    }

    /**
     * Test 5 (4.1): Per-model-file scoping -- rows under model file A do not
     * leak into model file B's load. Validates the modelFileId server-side
     * scoping that the EntityMapper sets and findByModelFileId / loadModel
     * filter on.
     */
    @Test
    @DisplayName("Scoping: cross-domain rows under one model file are isolated from another")
    void crossDomainRowsAreScopedByModelFileId() {
        // Set up second model file in the same transaction.
        String otherFilename = "xdom-it-other-" + UUID.randomUUID();
        ModelFileEntity other = ModelFileEntity.builder()
            .id("mf-other-" + UUID.randomUUID())
            .filename(otherFilename)
            .description("scoping companion")
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .isDefault(false)
            .build();
        modelFileRepository.save(other);
        entityManager.flush();

        ApplicationComputeDeploymentDto rowA = new ApplicationComputeDeploymentDto(
            "xr1-a", "ap-a", "cr-a", null, null,
            null, null, null, null, null, "model A row", "[]");
        ApplicationComputeDeploymentDto rowB = new ApplicationComputeDeploymentDto(
            "xr1-b", "ap-b", "cr-b", null, null,
            null, null, null, null, null, "model B row", "[]");

        modelService.saveModel(testFilename, buildModel(List.of(rowA), List.of(), List.of(), List.of()));
        modelService.saveModel(otherFilename, buildModel(List.of(rowB), List.of(), List.of(), List.of()));
        entityManager.flush();
        entityManager.clear();

        // Loading model A returns only its row.
        var aRels = modelService.loadModel(testFilename).metaModel().relationships();
        assertThat(aRels.applicationComputeDeployments())
            .extracting(ApplicationComputeDeploymentDto::id)
            .containsExactly("xr1-a");

        // Loading model B returns only its row.
        var bRels = modelService.loadModel(otherFilename).metaModel().relationships();
        assertThat(bRels.applicationComputeDeployments())
            .extracting(ApplicationComputeDeploymentDto::id)
            .containsExactly("xr1-b");
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private ArchitectureModelDto buildModel(
            List<ApplicationComputeDeploymentDto> xr1,
            List<DataEntityDataStoreHostingDto> xr2,
            List<ApplicationInfrastructureResourceUseDto> xr3,
            List<ApplicationLoadBalancerExposureDto> xr4) {
        MetaModelEntitiesDto entities = buildEmptyEntities();
        MetaModelRelationshipsDto rels = new MetaModelRelationshipsDto(
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            // 3 spec 2 Infra-internal relationships -- empty.
            List.of(), List.of(), List.of(),
            // 4 cross-domain relationships -- the actual payload.
            xr1, xr2, xr3, xr4, List.of(), List.of()
        );
        return new ArchitectureModelDto(new MetaModelDto(entities, rels), List.of());
    }

    /**
     * Builds an empty MetaModelEntitiesDto. Constructor positional argument
     * count matches the current shape: 36 pre-Infra entity lists + 13 Infra
     * entity lists = 49 lists.
     */
    private MetaModelEntitiesDto buildEmptyEntities() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyEntities();
    }
}
