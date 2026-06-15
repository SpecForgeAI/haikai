package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.entity.ComputeResourceDto;
import com.example.architecturemodel.model.dto.entity.IaCSourceDto;
import com.example.architecturemodel.model.dto.relationship.DeploymentUnitComputeResourceDto;
import com.example.architecturemodel.model.dto.relationship.IaCResourceBindingDto;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.IaCSourceRepository;
import com.example.architecturemodel.repository.relationship.IaCResourceBindingRepository;
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
 * End-to-end integration tests for the IaC Sources and IaC Resource Bindings
 * tables plus the provenance / readiness field extensions on existing
 * Infrastructure entities and Infra-internal relationships (Spec:
 * 2026-05-05-infrastructure-terraform-discovery-readiness, Task 4.1).
 *
 * <p>Exercises the full save / load / delete-and-replace pipeline through
 * {@link ModelService#saveModel(String, ArchitectureModelDto)} and
 * {@link ModelService#loadModel(String)} for:
 * <ul>
 *   <li>{@code iac_sources} (entity)</li>
 *   <li>{@code iac_resource_bindings} (relationship)</li>
 *   <li>The 6 provenance + 5 readiness fields on a representative entity
 *       ({@code compute_resources}).</li>
 *   <li>The 6 provenance fields on a representative Infra-internal
 *       relationship ({@code deployment_unit_compute_resources}).</li>
 * </ul>
 *
 * <p>Modelled on {@code InfrastructureCrossDomainRelationshipsRoundTripTest}.
 * Per the test profile contract, H2 in PostgreSQL mode is used; cross-table
 * FK constraints between IaCResourceBindingEntity and IaCSourceEntity /
 * InfrastructurePointEntity are NOT emitted by the {@code @Column}-as-String
 * mapping pattern (matches DataMovement / spec 2 / spec 6 precedent), so
 * endpoint ids are plain strings without dependent parent rows. The pipeline
 * under test is the DTO &lt;-&gt; entity mapping, save, load, and
 * delete-and-replace, NOT cross-table FK enforcement.</p>
 */
@SpringBootTest
@Transactional
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:iacintegrationdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;NON_KEYWORDS=KEY"
})
class InfrastructureTerraformReadinessRoundTripTest {

    @Autowired private ModelService modelService;
    @Autowired private ModelFileRepository modelFileRepository;

    @Autowired private IaCSourceRepository iacSourceRepository;
    @Autowired private IaCResourceBindingRepository iacResourceBindingRepository;

    @PersistenceContext private EntityManager entityManager;

    private String testFilename;
    private String modelFileId;

    @BeforeEach
    void setUp() {
        testFilename = "iac-it-" + UUID.randomUUID();
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("mf-" + UUID.randomUUID())
            .filename(testFilename)
            .description("Terraform readiness integration test model")
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .isDefault(false)
            .build();
        modelFileRepository.save(modelFile);
        entityManager.flush();
        modelFileId = modelFile.getId();
    }

    /**
     * Test 1 (4.1): Save -&gt; load round-trip for iac_sources and
     * iac_resource_bindings (one row each).
     */
    @Test
    @DisplayName("Round-trip: iac_sources entity + iac_resource_bindings relationship")
    void roundTripIaCSourceAndBinding() {
        IaCSourceDto src = new IaCSourceDto(
            "iac-src-1",
            "Orders Terraform Repo",
            "Primary IaC source for the Orders service",
            "[\"terraform\",\"orders\"]",
            "2026-01-01T00:00:00Z",
            null,
            "env-prod",
            "TERRAFORM",
            "https://github.com/example/orders-iac",
            "GITHUB",
            "main",
            "a1b2c3d4e5f6",
            "modules/orders",
            "default",
            "orders_service",
            "modules/orders/service",
            "GCP",
            "platform-team",
            "2026-05-05T10:00:00Z",
            "2026-05-05T10:05:00Z"
        );
        IaCResourceBindingDto bind = new IaCResourceBindingDto(
            "iac-bind-1",
            "iac-src-1",
            "ip-cr-1",
            "env-prod",
            "module.orders.google_cloud_run_v2_service.service",
            "google_cloud_run_v2_service",
            "service",
            "GCP",
            "modules/orders/main.tf",
            42,
            75,
            "state-abc",
            "projects/p/locations/l/services/orders",
            "CONFIRMED",
            new BigDecimal("0.875"),
            "2026-05-05T10:00:00Z",
            "Binds Cloud Run service compute resource to Terraform",
            "[\"terraform\",\"prod\"]"
        );

        modelService.saveModel(testFilename,
            buildModel(List.of(src), List.of(bind), List.of(), List.of()));
        entityManager.flush();
        entityManager.clear();

        var model = modelService.loadModel(testFilename);
        var entities = model.metaModel().entities();
        var rels = model.metaModel().relationships();

        assertThat(entities.iacSources())
            .extracting(IaCSourceDto::id)
            .containsExactly("iac-src-1");
        IaCSourceDto loadedSrc = entities.iacSources().get(0);
        assertThat(loadedSrc.name()).isEqualTo("Orders Terraform Repo");
        assertThat(loadedSrc.description())
            .isEqualTo("Primary IaC source for the Orders service");
        assertThat(loadedSrc.commitSha()).isEqualTo("a1b2c3d4e5f6");
        assertThat(loadedSrc.repositoryProvider()).isEqualTo("GITHUB");
        assertThat(loadedSrc.provider()).isEqualTo("GCP");
        assertThat(loadedSrc.moduleName()).isEqualTo("orders_service");

        assertThat(rels.iacResourceBindings())
            .extracting(IaCResourceBindingDto::id)
            .containsExactly("iac-bind-1");
        IaCResourceBindingDto loadedBind = rels.iacResourceBindings().get(0);
        assertThat(loadedBind.iacSourceId()).isEqualTo("iac-src-1");
        assertThat(loadedBind.infrastructurePointId()).isEqualTo("ip-cr-1");
        assertThat(loadedBind.startLine()).isEqualTo(42);
        assertThat(loadedBind.endLine()).isEqualTo(75);
        assertThat(loadedBind.bindingStatus()).isEqualTo("CONFIRMED");
        assertThat(loadedBind.confidence())
            .isEqualByComparingTo(new BigDecimal("0.875"));
        assertThat(loadedBind.confidence().scale()).isEqualTo(3);
        assertThat(loadedBind.description())
            .isEqualTo("Binds Cloud Run service compute resource to Terraform");
        assertThat(loadedBind.tags()).isEqualTo("[\"terraform\",\"prod\"]");
    }

    /**
     * Test 2 (4.1): Smoke check that the 6 provenance + 5 readiness fields
     * round-trip on a representative Infra entity ({@code compute_resources}).
     */
    @Test
    @DisplayName("Provenance + readiness round-trip on compute_resources")
    void provenanceAndReadinessFieldsRoundTripOnComputeResource() {
        ComputeResourceDto cr = new ComputeResourceDto(
            "cr-prov-1",
            "Orders API VM",
            "Primary VM hosting the Orders API",
            "[\"prod\"]",
            null, null,
            "env-prod",
            null, null, null,
            "VIRTUAL_MACHINE",
            "GCP",
            "orders-api-1", "orders-api-1.example.com",
            "10.0.0.10", "203.0.113.10",
            "linux", "java-21",
            "n2-standard-4", 1, 5,
            "compute-ext-1",
            "RUNNING", "platform-team",
            // Provenance (6)
            "DISCOVERED",
            "terraform-repo-scanner",
            "module.orders.google_compute_instance.api",
            "READY",
            "Detected via terraform AST parser",
            "2026-05-05T09:30:00Z",
            // Readiness (5)
            true,
            "modules/orders",
            "google_compute_instance",
            "{\"instance_name\":\"orders-api-1\"}",
            "Suggested readiness via repo scanner"
        );

        modelService.saveModel(testFilename,
            buildModelWithComputeResource(cr));
        entityManager.flush();
        entityManager.clear();

        var loadedEntities = modelService.loadModel(testFilename).metaModel().entities();
        assertThat(loadedEntities.computeResources())
            .extracting(ComputeResourceDto::id)
            .containsExactly("cr-prov-1");
        ComputeResourceDto loaded = loadedEntities.computeResources().get(0);
        // Provenance
        assertThat(loaded.sourceOrigin()).isEqualTo("DISCOVERED");
        assertThat(loaded.sourceSystem()).isEqualTo("terraform-repo-scanner");
        assertThat(loaded.sourceReference())
            .isEqualTo("module.orders.google_compute_instance.api");
        assertThat(loaded.generationStatus()).isEqualTo("READY");
        assertThat(loaded.generationNotes())
            .isEqualTo("Detected via terraform AST parser");
        assertThat(loaded.lastVerifiedAt()).isEqualTo("2026-05-05T09:30:00Z");
        // Readiness
        assertThat(loaded.terraformReady()).isTrue();
        assertThat(loaded.terraformModuleHint()).isEqualTo("modules/orders");
        assertThat(loaded.terraformResourceHint()).isEqualTo("google_compute_instance");
        assertThat(loaded.terraformVariableHints())
            .isEqualTo("{\"instance_name\":\"orders-api-1\"}");
        assertThat(loaded.terraformNotes())
            .isEqualTo("Suggested readiness via repo scanner");
    }

    /**
     * Test 3 (4.1): Smoke check that the 6 provenance fields round-trip on a
     * representative Infra-internal relationship
     * ({@code deployment_unit_compute_resources}). Readiness fields are NOT
     * applied to relationships per Q2 -- not asserted here.
     */
    @Test
    @DisplayName("Provenance round-trip on deployment_unit_compute_resources")
    void provenanceFieldsRoundTripOnDeploymentUnitComputeResource() {
        DeploymentUnitComputeResourceDto rel = new DeploymentUnitComputeResourceDto(
            "ducr-prov-1",
            "du-1",
            "ip-cr-1",
            "env-prod",
            "1.0.0",
            "{}",
            3, 1, 5,
            "RUNNING",
            "manual",
            new BigDecimal("0.900"),
            "[\"prod\"]",
            // Provenance (6)
            "MANUAL",
            "manual",
            "user-edit",
            "READY",
            "Captured from prod deployment",
            "2026-05-05T09:00:00Z"
        );

        modelService.saveModel(testFilename,
            buildModelWithDuComputeResourceRel(rel));
        entityManager.flush();
        entityManager.clear();

        var loadedRels = modelService.loadModel(testFilename).metaModel().relationships();
        assertThat(loadedRels.deploymentUnitComputeResources())
            .extracting(DeploymentUnitComputeResourceDto::id)
            .containsExactly("ducr-prov-1");
        DeploymentUnitComputeResourceDto loaded =
            loadedRels.deploymentUnitComputeResources().get(0);
        assertThat(loaded.sourceOrigin()).isEqualTo("MANUAL");
        assertThat(loaded.sourceSystem()).isEqualTo("manual");
        assertThat(loaded.sourceReference()).isEqualTo("user-edit");
        assertThat(loaded.generationStatus()).isEqualTo("READY");
        assertThat(loaded.generationNotes()).isEqualTo("Captured from prod deployment");
        assertThat(loaded.lastVerifiedAt()).isEqualTo("2026-05-05T09:00:00Z");
    }

    /**
     * Test 4 (4.1): Delete-and-replace -- save populated, save empty, assert
     * every iac_sources / iac_resource_bindings row is gone via direct
     * repository queries.
     */
    @Test
    @DisplayName("Delete-and-replace: empty save wipes prior IaC rows")
    void deleteAndReplaceWipesPriorIaCRows() {
        IaCSourceDto src = new IaCSourceDto(
            "iac-src-d", "Repo D", "desc", "[]",
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null
        );
        IaCResourceBindingDto bind = new IaCResourceBindingDto(
            "iac-bind-d", "iac-src-d", "ip-x", null,
            null, null, null, null, null, null, null, null,
            null, null, null, null,
            "binding to delete", "[]"
        );

        modelService.saveModel(testFilename,
            buildModel(List.of(src), List.of(bind), List.of(), List.of()));
        entityManager.flush();

        // Sanity: rows landed.
        assertThat(iacSourceRepository.findByModelFileId(modelFileId)).hasSize(1);
        assertThat(iacResourceBindingRepository.findByModelFileId(modelFileId)).hasSize(1);

        // Replace with empty payload.
        modelService.saveModel(testFilename,
            buildModel(List.of(), List.of(), List.of(), List.of()));
        entityManager.flush();
        entityManager.clear();

        assertThat(iacSourceRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(iacResourceBindingRepository.findByModelFileId(modelFileId)).isEmpty();
    }

    /**
     * Test 5 (4.1): Per-model-file scoping -- rows under model file A do not
     * leak into model file B's load.
     */
    @Test
    @DisplayName("Scoping: IaC rows under one model file are isolated from another")
    void iacRowsAreScopedByModelFileId() {
        String otherFilename = "iac-it-other-" + UUID.randomUUID();
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

        IaCSourceDto srcA = new IaCSourceDto(
            "iac-src-a", "A repo", "model A", "[]",
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null
        );
        IaCSourceDto srcB = new IaCSourceDto(
            "iac-src-b", "B repo", "model B", "[]",
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null
        );

        modelService.saveModel(testFilename, buildModel(List.of(srcA), List.of(), List.of(), List.of()));
        modelService.saveModel(otherFilename, buildModel(List.of(srcB), List.of(), List.of(), List.of()));
        entityManager.flush();
        entityManager.clear();

        var aEntities = modelService.loadModel(testFilename).metaModel().entities();
        assertThat(aEntities.iacSources())
            .extracting(IaCSourceDto::id)
            .containsExactly("iac-src-a");

        var bEntities = modelService.loadModel(otherFilename).metaModel().entities();
        assertThat(bEntities.iacSources())
            .extracting(IaCSourceDto::id)
            .containsExactly("iac-src-b");
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private ArchitectureModelDto buildModel(
            List<IaCSourceDto> iacSources,
            List<IaCResourceBindingDto> iacBindings,
            List<ComputeResourceDto> computeResources,
            List<DeploymentUnitComputeResourceDto> duCrRels) {
        MetaModelEntitiesDto entities = buildEntities(iacSources, computeResources);
        MetaModelRelationshipsDto rels = buildRelationships(iacBindings, duCrRels);
        return new ArchitectureModelDto(new MetaModelDto(entities, rels), List.of());
    }

    private ArchitectureModelDto buildModelWithComputeResource(ComputeResourceDto cr) {
        return buildModel(List.of(), List.of(), List.of(cr), List.of());
    }

    private ArchitectureModelDto buildModelWithDuComputeResourceRel(
            DeploymentUnitComputeResourceDto rel) {
        return buildModel(List.of(), List.of(), List.of(), List.of(rel));
    }

    /**
     * Builds a MetaModelEntitiesDto with pre-Infra lists empty + the 12 Infra
     * entity lists (one slot reserved for the optional ComputeResource list)
     * + the InfrastructurePoints slot empty + iacSources slot populated last.
     *
     * Constructor positional argument count: 36 pre-Infra + 12 Infra entity +
     * 1 InfrastructurePoint + 1 iacSources = 50 lists.
     */
    private MetaModelEntitiesDto buildEntities(
            List<IaCSourceDto> iacSources,
            List<ComputeResourceDto> computeResources) {
        return new MetaModelEntitiesDto(
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(),
            // 12 Infra entity lists -- index 6 = computeResources.
            List.of(), // environments
            List.of(), // cloudAccounts
            List.of(), // locations
            List.of(), // networks
            List.of(), // subnets
            List.of(), // computeClusters
            computeResources, // computeResources (target slot)
            List.of(), // deploymentUnits
            List.of(), // loadBalancers
            List.of(), // listeners
            List.of(), // dataStoreInstances
            List.of(), // infrastructureResources
            List.of(), // infrastructurePoints
            iacSources, // iacSources (Spec: Terraform & Discovery Readiness)
            List.of() // libraries (Spec: Library Backend Foundation)
        );
    }

    /**
     * Constructor positional argument count: 10 pre-Infra + 3 Infra-internal
     * + 4 cross-domain + 1 iacResourceBindings = 18 lists.
     */
    private MetaModelRelationshipsDto buildRelationships(
            List<IaCResourceBindingDto> iacBindings,
            List<DeploymentUnitComputeResourceDto> duCrRels) {
        return new MetaModelRelationshipsDto(
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            // 3 spec 2 Infra-internal relationships -- index 1 = deploymentUnitComputeResources.
            List.of(),         // resourceSubnetHostings
            duCrRels,          // deploymentUnitComputeResources (target slot)
            List.of(),         // loadBalancerResourceRoutes,
            // 4 cross-domain relationships -- empty.
            List.of(), List.of(), List.of(), List.of(),
            // iac_resource_bindings.
            iacBindings,
            // code_unit_dependencies (Spec: Library Backend Foundation)
            List.of()
        );
    }
}
