package com.example.architecturemodel.repository.targetmanifest;

import com.example.architecturemodel.exception.ValidationException;
import com.example.architecturemodel.model.dto.targetmanifest.TargetManifestArtifactDto;
import com.example.architecturemodel.model.dto.targetmanifest.TargetManifestArtifactInput;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.ServiceEntity;
import com.example.architecturemodel.model.entity.targetmanifest.TargetManifestArtifactEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.ServiceRepository;
import com.example.architecturemodel.service.targetmanifest.TargetManifestArtifactService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Ownership-validation + logical-FK-cleanup slice tests for
 * {@link TargetManifestArtifactService} from Task Group 2 of the Target Manifest
 * -&gt; Service Association (Foreign Key) spec (2026-06-26).
 *
 * <p>Covers (per the 2-8 focused-tests budget):</p>
 * <ol>
 *   <li><b>Valid</b>: a {@code target_service_element_id} resolving to a
 *       {@code services} element that belongs to the path
 *       {@code targetArchitectureId} (and is live) persists, FK retained.</li>
 *   <li><b>Reject unknown</b>: an id with no {@code services} row aborts the
 *       write with a {@link ValidationException} (HTTP 400) and persists
 *       nothing.</li>
 *   <li><b>Reject archived</b>: an id whose {@code services} row was removed
 *       (archived) no longer resolves and is rejected; nothing persisted.</li>
 *   <li><b>Reject cross-architecture</b>: a live {@code services} element under a
 *       DIFFERENT architecture's model file is rejected; nothing persisted.</li>
 *   <li><b>Cleanup</b>: archiving the chosen {@code services} element nulls the
 *       dependent {@code target_manifest_artifacts.target_service_element_id}
 *       (logical cascade -- no physical FK).</li>
 * </ol>
 *
 * <p>Uses the same H2-in-PostgreSQL-compat-mode pattern as
 * {@code TargetManifestArtifactPersistenceTest} (JSONB domain alias so the
 * {@code JsonType} bindings round-trip). Under {@code @DataJpaTest} the schema is
 * Hibernate-generated; the {@code services} and {@code model_files} tables exist
 * from their entities so the ownership join can be exercised. The service is
 * {@code @Import}ed so its validation + cleanup logic runs against a real H2.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(TargetManifestArtifactService.class)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:targetmanifestownerdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class TargetManifestArtifactOwnershipValidationTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private TargetManifestArtifactRepository repository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    @Autowired
    private ServiceRepository serviceRepository;

    @Autowired
    private TargetManifestArtifactService service;

    private ModelFileEntity persistModelFile(UUID projectId, UUID architectureId) {
        ModelFileEntity mf = ModelFileEntity.builder()
            .id(UUID.randomUUID().toString())
            .filename("model-" + architectureId + ".json")
            .projectId(projectId)
            .architectureId(architectureId)
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        return entityManager.persist(mf);
    }

    /**
     * Persists a {@code services} element with a REALISTIC string id
     * ({@code svc-<slug>} — NOT a UUID). 2026-08-14: the original test used
     * UUID-shaped ids, which hid the live bug where the UUID-typed FK column
     * rejected every real element id at the wire (changeset 223).
     */
    private String persistService(String modelFileId, String name) {
        String serviceId = "svc-" + name.toLowerCase().replaceAll("[^a-z0-9]+", "-")
            + "-" + Integer.toHexString(name.hashCode());
        ServiceEntity svc = ServiceEntity.builder()
            .id(serviceId)
            .modelFileId(modelFileId)
            .applicationId("app-1")
            .name(name)
            .build();
        entityManager.persist(svc);
        return serviceId;
    }

    private static TargetManifestArtifactInput input(String tag, String serviceElementId) {
        return new TargetManifestArtifactInput(
            tag, "pom", "MAVEN", "pom.xml", "<project/>", null,
            List.of(), List.of(), serviceElementId);
    }

    @Test
    @DisplayName("Valid: a target_service_element_id belonging to the path architecture (live) persists; the FK round-trips")
    void validInArchitectureServiceElementPersists() {
        UUID projectId = UUID.randomUUID();
        UUID targetArchitectureId = UUID.randomUUID();
        ModelFileEntity mf = persistModelFile(projectId, targetArchitectureId);
        String serviceId = persistService(mf.getId(), "Orders Service");
        entityManager.flush();

        List<TargetManifestArtifactDto> latest = service.persistLatest(
            projectId, targetArchitectureId, List.of(input("orders", serviceId)));
        entityManager.clear();

        assertThat(latest).hasSize(1);
        assertThat(latest.get(0).targetServiceElementId()).isEqualTo(serviceId);

        TargetManifestArtifactEntity row = repository
            .findFirstByProjectIdAndTargetArchitectureIdAndTagAndIsLatestTrue(
                projectId, targetArchitectureId, "orders").orElseThrow();
        assertThat(row.getTargetServiceElementId()).isEqualTo(serviceId);
    }

    @Test
    @DisplayName("Reject unknown: an unknown target_service_element_id aborts the write with a ValidationException and persists NOTHING")
    void rejectUnknownServiceElement() {
        UUID projectId = UUID.randomUUID();
        UUID targetArchitectureId = UUID.randomUUID();
        persistModelFile(projectId, targetArchitectureId);
        entityManager.flush();

        String unknown = "svc-does-not-exist";
        assertThatThrownBy(() -> service.persistLatest(
            projectId, targetArchitectureId, List.of(input("orders", unknown))))
            .isInstanceOf(ValidationException.class);

        // No dangling FK persisted -- validation aborts before any write.
        assertThat(repository.findAll()).isEmpty();
    }

    @Test
    @DisplayName("Reject archived: a target_service_element_id whose services row was removed (archived) no longer resolves and is rejected; NOTHING persisted")
    void rejectArchivedServiceElement() {
        UUID projectId = UUID.randomUUID();
        UUID targetArchitectureId = UUID.randomUUID();
        ModelFileEntity mf = persistModelFile(projectId, targetArchitectureId);
        String serviceId = persistService(mf.getId(), "Orders Service");
        entityManager.flush();

        // Archive == removal: the element no longer has a row (services are
        // soft-deleted by removal; there is no per-row archived flag).
        serviceRepository.deleteById(serviceId);
        entityManager.flush();

        assertThatThrownBy(() -> service.persistLatest(
            projectId, targetArchitectureId, List.of(input("orders", serviceId))))
            .isInstanceOf(ValidationException.class);

        assertThat(repository.findAll()).isEmpty();
    }

    @Test
    @DisplayName("Reject cross-architecture: a live services element under a DIFFERENT architecture's model file is rejected; NOTHING persisted")
    void rejectCrossArchitectureServiceElement() {
        UUID projectId = UUID.randomUUID();
        UUID targetArchitectureId = UUID.randomUUID();
        UUID otherArchitectureId = UUID.randomUUID();
        persistModelFile(projectId, targetArchitectureId);
        ModelFileEntity otherMf = persistModelFile(projectId, otherArchitectureId);
        // The service is live, but belongs to a DIFFERENT architecture.
        String crossServiceId = persistService(otherMf.getId(), "Other Arch Service");
        entityManager.flush();

        assertThatThrownBy(() -> service.persistLatest(
            projectId, targetArchitectureId, List.of(input("orders", crossServiceId))))
            .isInstanceOf(ValidationException.class);

        assertThat(repository.findAll()).isEmpty();
    }

    @Test
    @DisplayName("Cleanup: archiving the chosen services element nulls the dependent target_manifest_artifacts.target_service_element_id (logical cascade)")
    void archivingServiceElementNullsDependentManifestFk() {
        UUID projectId = UUID.randomUUID();
        UUID targetArchitectureId = UUID.randomUUID();
        ModelFileEntity mf = persistModelFile(projectId, targetArchitectureId);
        String serviceId = persistService(mf.getId(), "Orders Service");
        entityManager.flush();

        service.persistLatest(projectId, targetArchitectureId,
            List.of(input("orders", serviceId)));
        entityManager.clear();

        // Precondition: the manifest carries the FK.
        TargetManifestArtifactEntity before = repository
            .findFirstByProjectIdAndTargetArchitectureIdAndTagAndIsLatestTrue(
                projectId, targetArchitectureId, "orders").orElseThrow();
        assertThat(before.getTargetServiceElementId()).isEqualTo(serviceId);

        // Archive the chosen services element -> logical FK cleanup.
        int cleared = service.onServiceElementArchived(serviceId);
        entityManager.clear();

        assertThat(cleared).isEqualTo(1);
        TargetManifestArtifactEntity after = repository
            .findFirstByProjectIdAndTargetArchitectureIdAndTagAndIsLatestTrue(
                projectId, targetArchitectureId, "orders").orElseThrow();
        assertThat(after.getTargetServiceElementId()).isNull();
        // The row itself is retained -- only the logical FK is nulled.
        assertThat(after.getTag()).isEqualTo("orders");
    }
}
