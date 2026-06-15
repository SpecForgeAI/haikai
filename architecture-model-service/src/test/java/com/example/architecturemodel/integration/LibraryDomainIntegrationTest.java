package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.entity.ApplicationDto;
import com.example.architecturemodel.model.dto.entity.ApplicationPointDto;
import com.example.architecturemodel.model.dto.entity.LibraryDto;
import com.example.architecturemodel.model.dto.entity.ServiceDto;
import com.example.architecturemodel.model.dto.relationship.CodeUnitDependencyDto;
import com.example.architecturemodel.model.entity.ApplicationPointEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.ApplicationPointRepository;
import com.example.architecturemodel.repository.entity.ApplicationRepository;
import com.example.architecturemodel.repository.entity.LibraryRepository;
import com.example.architecturemodel.repository.relationship.CodeUnitDependencyRepository;
import com.example.architecturemodel.service.ModelService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * End-to-end integration tests for the Library + CodeUnitDependency domain
 * (Spec: 2026-05-05-library-backend-foundation, Task 4.1).
 *
 * <p>Exercises the full save / load / delete-and-replace pipeline through
 * {@link ModelService#saveModel(String, ArchitectureModelDto)} and
 * {@link ModelService#loadModel(String)}. Mirrors
 * {@code InfrastructureTerraformReadinessRoundTripTest}'s shape.</p>
 *
 * <p>Per the test profile contract, H2 in PostgreSQL mode is used; cross-table
 * FK constraints (libraries.package_set_id, code_unit_dependencies endpoints)
 * are NOT emitted by the {@code @Column}-as-String mapping pattern, so this
 * test exercises the DTO &lt;-&gt; entity mapping, save, load, and
 * delete-and-replace, NOT cross-table FK enforcement. The polymorphic
 * ApplicationPoint extension's CHECK is enforced via the {@code @Check}
 * mirror on ApplicationPointEntity.</p>
 */
@SpringBootTest
@Transactional
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:libintegrationdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;NON_KEYWORDS=KEY;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class LibraryDomainIntegrationTest {

    @Autowired private ModelService modelService;
    @Autowired private ModelFileRepository modelFileRepository;
    @Autowired private LibraryRepository libraryRepository;
    @Autowired private CodeUnitDependencyRepository codeUnitDependencyRepository;
    @Autowired private ApplicationPointRepository applicationPointRepository;
    @Autowired private ApplicationRepository applicationRepository;

    @PersistenceContext private EntityManager entityManager;

    private String testFilename;
    private String modelFileId;
    private String applicationId;

    @BeforeEach
    void setUp() {
        testFilename = "lib-it-" + UUID.randomUUID();
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("mf-" + UUID.randomUUID())
            .filename(testFilename)
            .description("Library integration test model")
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .isDefault(false)
            .build();
        modelFileRepository.save(modelFile);
        entityManager.flush();
        modelFileId = modelFile.getId();
        applicationId = "app-orders-" + UUID.randomUUID();
    }

    /**
     * Test 1 (4.1): Round-trip with internal Library + external Library +
     * Service-&gt;Library and Library-&gt;Library code_unit_dependencies edges.
     */
    @Test
    @DisplayName("Round-trip: internal + external Library + Service->Library + Library->Library edges")
    void roundTripBothLibraryVariantsAndBothEdgeVariants() {
        // Two libraries: 1 internal (with repo location), 1 external (no repo)
        LibraryDto internalLib = new LibraryDto(
            "lib-internal-1",
            "com.example:foo-lib",
            "Internal library",
            "internal,maven",
            "2026-01-01",
            "2027-01-01",
            "MAVEN",
            "https://repo.example.com/foo",
            "modules/foo-lib",
            "Java + Spring Boot",
            Map.of("language", "java-21", "frameworks", List.of("spring-boot-3")),
            "java-21",
            List.of("spring-boot-3"),
            "high",
            Instant.parse("2026-04-20T10:00:00Z"),
            "DISCOVERY",
            "manifest-scanner",
            "pom.xml",
            "SCANNED",
            "scan ok",
            "2026-05-04T12:00:00Z",
            null  // package_set_id intentionally null (FK ON DELETE SET NULL)
        );
        LibraryDto externalLib = new LibraryDto(
            "lib-external-1",
            "lodash",
            null, null, null, null,
            "NPM",
            null, null, // no repo_location / repo_subfolder
            null,
            null, null, null, null, null,
            null, null, null, null, null, null,
            null
        );

        // Source/target ApplicationPoints with target_type='LIBRARY' and 'SERVICE'.
        // Service ApplicationPoint as a source for Service->Library edge.
        ServiceDto svc = new ServiceDto(
            "svc-orders", "Orders Service", null, applicationId, null, null,
            null, null, null, null, null, null, null, true,
            null, null, null, null, null
        );

        ApplicationPointDto serviceAP = new ApplicationPointDto(
            "ap-svc-orders",
            "Orders Service Point",
            null, "FUNCTION",
            applicationId, null,
            "svc-orders",
            null,
            "SERVICE", "svc-orders",
            null, null, null, null
        );
        ApplicationPointDto libAP1 = new ApplicationPointDto(
            "ap-lib-foo",
            "Foo Library Point",
            null, "FUNCTION",
            applicationId, null,
            null, null,
            "LIBRARY", "lib-internal-1",
            null, null, null, null
        );
        ApplicationPointDto libAP2 = new ApplicationPointDto(
            "ap-lib-lodash",
            "Lodash Library Point",
            null, "FUNCTION",
            applicationId, null,
            null, null,
            "LIBRARY", "lib-external-1",
            null, null, null, null
        );

        // Service->Library edge
        CodeUnitDependencyDto svcToLib = new CodeUnitDependencyDto(
            "cud-svc-to-lib",
            "ap-svc-orders", "ap-lib-foo",
            "com.example:foo-lib", "1.4.2", "[1.0,2.0)",
            "COMPILE", "pom.xml", 42,
            "MANIFEST_SCAN",
            new BigDecimal("0.875"),
            "Service depends on internal lib",
            "scanned"
        );
        // Library->Library edge (internal lib depends on external lodash)
        CodeUnitDependencyDto libToLib = new CodeUnitDependencyDto(
            "cud-lib-to-lib",
            "ap-lib-foo", "ap-lib-lodash",
            "lodash", "4.17.21", null,
            "RUNTIME", "package.json", 17,
            "MANIFEST_SCAN",
            new BigDecimal("0.999"),
            null, null
        );

        ApplicationDto application = new ApplicationDto(
            applicationId, "Orders App", null, "WEB", null, null,
            null, null, true, "ORD"
        );

        modelService.saveModel(testFilename, buildModel(
            List.of(application),
            List.of(svc),
            List.of(serviceAP, libAP1, libAP2),
            List.of(internalLib, externalLib),
            List.of(svcToLib, libToLib)
        ));
        entityManager.flush();
        entityManager.clear();

        var model = modelService.loadModel(testFilename);
        var entities = model.metaModel().entities();
        var rels = model.metaModel().relationships();

        // Libraries -- both round-trip with all fields
        assertThat(entities.libraries()).hasSize(2);
        LibraryDto loadedInternal = entities.libraries().stream()
            .filter(l -> "lib-internal-1".equals(l.id())).findFirst().orElseThrow();
        assertThat(loadedInternal.name()).isEqualTo("com.example:foo-lib");
        assertThat(loadedInternal.ecosystem()).isEqualTo("MAVEN");
        assertThat(loadedInternal.repoLocation()).isEqualTo("https://repo.example.com/foo");
        assertThat(loadedInternal.repoSubfolder()).isEqualTo("modules/foo-lib");
        assertThat(loadedInternal.coreTechResolutionConfidence()).isEqualTo("high");
        assertThat(loadedInternal.coreTechLanguagePack()).isEqualTo("java-21");
        assertThat(loadedInternal.coreTechFrameworkPacks()).containsExactly("spring-boot-3");
        assertThat(loadedInternal.coreTechResolvedAt())
            .isEqualTo(Instant.parse("2026-04-20T10:00:00Z"));
        // Provenance
        assertThat(loadedInternal.sourceOrigin()).isEqualTo("DISCOVERY");
        assertThat(loadedInternal.sourceSystem()).isEqualTo("manifest-scanner");
        assertThat(loadedInternal.lastVerifiedAt()).isEqualTo("2026-05-04T12:00:00Z");

        LibraryDto loadedExternal = entities.libraries().stream()
            .filter(l -> "lib-external-1".equals(l.id())).findFirst().orElseThrow();
        assertThat(loadedExternal.repoLocation()).isNull();
        assertThat(loadedExternal.repoSubfolder()).isNull();
        assertThat(loadedExternal.ecosystem()).isEqualTo("NPM");

        // Edges round-trip
        assertThat(rels.codeUnitDependencies()).hasSize(2);
        CodeUnitDependencyDto loadedSvc = rels.codeUnitDependencies().stream()
            .filter(e -> "cud-svc-to-lib".equals(e.id())).findFirst().orElseThrow();
        assertThat(loadedSvc.sourceApplicationPointId()).isEqualTo("ap-svc-orders");
        assertThat(loadedSvc.targetApplicationPointId()).isEqualTo("ap-lib-foo");
        assertThat(loadedSvc.declaredVersion()).isEqualTo("1.4.2");
        assertThat(loadedSvc.declaredVersionRange()).isEqualTo("[1.0,2.0)");
        assertThat(loadedSvc.scope()).isEqualTo("COMPILE");
        assertThat(loadedSvc.manifestPath()).isEqualTo("pom.xml");
        assertThat(loadedSvc.manifestLine()).isEqualTo(42);
        assertThat(loadedSvc.confidence()).isEqualByComparingTo(new BigDecimal("0.875"));
        assertThat(loadedSvc.confidence().scale()).isEqualTo(3);

        CodeUnitDependencyDto loadedLibLib = rels.codeUnitDependencies().stream()
            .filter(e -> "cud-lib-to-lib".equals(e.id())).findFirst().orElseThrow();
        assertThat(loadedLibLib.sourceApplicationPointId()).isEqualTo("ap-lib-foo");
        assertThat(loadedLibLib.targetApplicationPointId()).isEqualTo("ap-lib-lodash");
        assertThat(loadedLibLib.scope()).isEqualTo("RUNTIME");
    }

    /**
     * Test 2 (4.1): {@code application_points.target_type = 'LIBRARY'} is
     * accepted at the JPA layer (positive case, mirrors changeset 124).
     */
    @Test
    @DisplayName("ApplicationPoint accepts target_type='LIBRARY' (positive)")
    void applicationPointAcceptsLibraryTargetType() {
        ApplicationPointEntity ap = ApplicationPointEntity.builder()
            .id("ap-lib-positive-it")
            .modelFileId(modelFileId)
            .name("Lib Target")
            .kind("FUNCTION")
            .applicationId(applicationId)
            .targetType("LIBRARY")
            .targetRefId("lib-target-ref-it")
            .build();
        applicationPointRepository.save(ap);
        applicationPointRepository.flush();

        assertThat(applicationPointRepository.findById("ap-lib-positive-it")).isPresent();
    }

    /**
     * Test 3 (4.1): An invalid {@code target_type} (e.g. {@code 'FOO'}) is
     * rejected by the relaxed CHECK from changeset 124.
     */
    @Test
    @DisplayName("ApplicationPoint rejects target_type='FOO' (negative)")
    void applicationPointRejectsInvalidTargetType() {
        ApplicationPointEntity ap = ApplicationPointEntity.builder()
            .id("ap-foo-negative-it")
            .modelFileId(modelFileId)
            .name("Bad Target")
            .kind("FUNCTION")
            .applicationId(applicationId)
            .targetType("FOO")
            .targetRefId("bogus-ref-it")
            .build();

        assertThatThrownBy(() -> {
            applicationPointRepository.save(ap);
            applicationPointRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * Test 4 (4.1): Existing target_types continue to work unchanged.
     */
    @Test
    @DisplayName("ApplicationPoint accepts SERVICE/CLASS/METHOD/NULL unchanged")
    void applicationPointPreservesExistingTargetTypes() {
        for (String targetType : new String[]{"SERVICE", "CLASS", "METHOD"}) {
            ApplicationPointEntity ap = ApplicationPointEntity.builder()
                .id("ap-" + targetType.toLowerCase() + "-ok")
                .modelFileId(modelFileId)
                .name(targetType + " Target")
                .kind("FUNCTION")
                .applicationId(applicationId)
                .targetType(targetType)
                .targetRefId("ref-" + targetType.toLowerCase())
                .build();
            applicationPointRepository.save(ap);
        }
        // NULL target_type also OK
        ApplicationPointEntity nullAp = ApplicationPointEntity.builder()
            .id("ap-null-target")
            .modelFileId(modelFileId)
            .name("Null Target")
            .kind("FUNCTION")
            .applicationId(applicationId)
            .targetType(null)
            .targetRefId(null)
            .build();
        applicationPointRepository.save(nullAp);
        applicationPointRepository.flush();

        assertThat(applicationPointRepository.findById("ap-service-ok")).isPresent();
        assertThat(applicationPointRepository.findById("ap-class-ok")).isPresent();
        assertThat(applicationPointRepository.findById("ap-method-ok")).isPresent();
        assertThat(applicationPointRepository.findById("ap-null-target")).isPresent();
    }

    /**
     * Test 5 (4.1): Delete-and-replace -- save populated, save empty, assert
     * libraries and code_unit_dependencies for that modelFileId are gone.
     */
    @Test
    @DisplayName("Delete-and-replace: empty save wipes prior libraries + dependencies")
    void deleteAndReplaceWipesPriorLibrariesAndDeps() {
        LibraryDto lib = new LibraryDto(
            "lib-d", "Delete Me", null, null, null, null,
            "MAVEN", null, null, null,
            null, null, null, null, null,
            null, null, null, null, null, null,
            null
        );
        // Create the application + ap row referenced by the dependency edge.
        ApplicationPointDto srcAP = new ApplicationPointDto(
            "ap-src-d", "src-d", null, "FUNCTION",
            applicationId, null, null, null,
            null, null, null, null, null, null
        );
        ApplicationPointDto tgtAP = new ApplicationPointDto(
            "ap-tgt-d", "tgt-d", null, "FUNCTION",
            applicationId, null, null, null,
            "LIBRARY", "lib-d",
            null, null, null, null
        );
        CodeUnitDependencyDto edge = new CodeUnitDependencyDto(
            "cud-d", "ap-src-d", "ap-tgt-d",
            null, null, null, null, null, null, null, null,
            null, null
        );
        ApplicationDto app = new ApplicationDto(
            applicationId, "App-D", null, "WEB", null, null, null, null, true, "APD"
        );

        modelService.saveModel(testFilename, buildModel(
            List.of(app), List.of(), List.of(srcAP, tgtAP), List.of(lib), List.of(edge)
        ));
        entityManager.flush();

        // Sanity
        assertThat(libraryRepository.findByModelFileId(modelFileId)).hasSize(1);
        assertThat(codeUnitDependencyRepository.findByModelFileId(modelFileId)).hasSize(1);

        // Replace with empty payload (still need the application present so any
        // remaining application_points are valid; we use a fully empty payload).
        modelService.saveModel(testFilename, buildModel(
            List.of(), List.of(), List.of(), List.of(), List.of()
        ));
        entityManager.flush();
        entityManager.clear();

        assertThat(libraryRepository.findByModelFileId(modelFileId)).isEmpty();
        assertThat(codeUnitDependencyRepository.findByModelFileId(modelFileId)).isEmpty();
    }

    /**
     * Test 6 (4.1): Per-modelFileId scoping -- libraries / code_unit_dependencies
     * under one model file do not leak into another.
     */
    @Test
    @DisplayName("Scoping: libraries / dependencies under one model file are isolated")
    void rowsAreScopedByModelFileId() {
        String otherFilename = "lib-it-other-" + UUID.randomUUID();
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

        LibraryDto libA = new LibraryDto(
            "lib-A", "A lib", null, null, null, null,
            "MAVEN", null, null, null,
            null, null, null, null, null,
            null, null, null, null, null, null, null
        );
        LibraryDto libB = new LibraryDto(
            "lib-B", "B lib", null, null, null, null,
            "NPM", null, null, null,
            null, null, null, null, null,
            null, null, null, null, null, null, null
        );

        modelService.saveModel(testFilename, buildModel(
            List.of(), List.of(), List.of(), List.of(libA), List.of()
        ));
        modelService.saveModel(otherFilename, buildModel(
            List.of(), List.of(), List.of(), List.of(libB), List.of()
        ));
        entityManager.flush();
        entityManager.clear();

        var aEntities = modelService.loadModel(testFilename).metaModel().entities();
        assertThat(aEntities.libraries())
            .extracting(LibraryDto::id)
            .containsExactly("lib-A");

        var bEntities = modelService.loadModel(otherFilename).metaModel().entities();
        assertThat(bEntities.libraries())
            .extracting(LibraryDto::id)
            .containsExactly("lib-B");
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private ArchitectureModelDto buildModel(
            List<ApplicationDto> applications,
            List<ServiceDto> services,
            List<ApplicationPointDto> applicationPoints,
            List<LibraryDto> libraries,
            List<CodeUnitDependencyDto> codeUnitDependencies) {
        return new ArchitectureModelDto(
            new MetaModelDto(buildEntities(applications, services, applicationPoints, libraries),
                             buildRelationships(codeUnitDependencies)),
            List.of()
        );
    }

    /**
     * MetaModelEntitiesDto positional constructor with libraries appended at
     * the end (post-spec 7 + Library Backend Foundation). 51 lists total: 36
     * pre-Infra entities + 13 Infra Domain + 1 iac_sources + 1 libraries.
     */
    private MetaModelEntitiesDto buildEntities(
            List<ApplicationDto> applications,
            List<ServiceDto> services,
            List<ApplicationPointDto> applicationPoints,
            List<LibraryDto> libraries) {
        return new MetaModelEntitiesDto(
            List.of(),       // businessUsers
            List.of(),       // businessProcesses
            List.of(),       // processActivities
            List.of(),       // businessPoints
            applications,    // applications
            List.of(),       // appComponents
            services,        // services
            List.of(),       // interfaces
            List.of(),       // endpoints
            List.of(),       // classes
            List.of(),       // methods
            applicationPoints, // applicationPoints
            List.of(),       // logicalDataEntities
            List.of(),       // logicalDataAttributes
            List.of(),       // physicalDataEntities
            List.of(),       // physicalDataAttributes
            List.of(),       // dataEntityPoints
            List.of(),       // interactions
            List.of(),       // appBusinessPoints
            List.of(),       // events
            List.of(),       // states
            List.of(),       // stateTransitions
            List.of(),       // activities
            List.of(),       // activityFlows
            List.of(),       // activityPartitions
            List.of(),       // uiScreens
            List.of(),       // uiContracts
            List.of(),       // uiComponents
            List.of(),       // uiActions
            List.of(),       // uiCharacteristics
            List.of(),       // businessLogics
            List.of(),       // packageSets
            List.of(),       // packages
            List.of(),       // packageSetDefaultRules
            List.of(),       // userJourneys
            List.of(),       // activitySteps,
            // 13 Infra Domain entity slots
            List.of(),       // environments
            List.of(),       // cloudAccounts
            List.of(),       // locations
            List.of(),       // networks
            List.of(),       // subnets
            List.of(),       // computeClusters
            List.of(),       // computeResources
            List.of(),       // deploymentUnits
            List.of(),       // loadBalancers
            List.of(),       // listeners
            List.of(),       // dataStoreInstances
            List.of(),       // infrastructureResources
            List.of(),       // infrastructurePoints,
            // Spec 7 iac_sources
            List.of(),       // iacSources
            // Library Backend Foundation
            libraries        // libraries
        );
    }

    /**
     * MetaModelRelationshipsDto positional constructor: 19 lists. 10 pre-Infra
     * + 3 Infra-internal + 4 cross-domain + 1 iac_resource_bindings + 1
     * code_unit_dependencies.
     */
    private MetaModelRelationshipsDto buildRelationships(
            List<CodeUnitDependencyDto> codeUnitDependencies) {
        return new MetaModelRelationshipsDto(
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            // 3 Infra-internal
            List.of(), List.of(), List.of(),
            // 4 cross-domain
            List.of(), List.of(), List.of(), List.of(),
            // iac_resource_bindings
            List.of(),
            // code_unit_dependencies
            codeUnitDependencies
        );
    }
}
