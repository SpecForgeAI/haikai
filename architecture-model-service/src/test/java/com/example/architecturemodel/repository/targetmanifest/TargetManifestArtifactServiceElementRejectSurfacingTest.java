package com.example.architecturemodel.repository.targetmanifest;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ValidationException;
import com.example.architecturemodel.model.dto.targetmanifest.TargetManifestArtifactInput;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.ServiceEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.service.targetmanifest.TargetManifestArtifactService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * Task Group 5 (gap-fill) — Spec 2026-06-26 target-manifest-service-association.
 *
 * <p>Cross-tier SURFACING seam the TG2 ownership suite does not assert: it proves
 * the persist path THROWS a {@link ValidationException} on a bad
 * {@code target_service_element_id}, but stops there. The 5.3 example asks for the
 * other half — that the rejection "surfaces as a 4xx the gateway/UI would see".
 * A {@code ValidationException} carrying null routing metadata would still pass
 * TG2 yet yield an UNROUTABLE 400 (the frontend keys its inline picker error on
 * {@code entity_type} + {@code code} + {@code field}).</p>
 *
 * <p>This test joins service-reject -> HTTP envelope: it drives the real
 * cross-architecture reject through {@link TargetManifestArtifactService}, asserts
 * the thrown exception carries the {@code services} /
 * {@code service_element_not_in_architecture} / {@code target_service_element_id}
 * triple, then runs that exact exception through the production
 * {@link GlobalExceptionHandler} and asserts the HTTP 400 envelope the gateway
 * (and, behind it, the picker UI) would receive.</p>
 *
 * <p>NOTE for the record: the gateway's upload-time persist is FAIL-SOFT, so this
 * 400 is the AMS write-contract guard a DIRECT/stale caller hits — the upload
 * response itself never surfaces it (the UI's first-line defence is the
 * required-picker gating from TG4). The guard still matters: it prevents a
 * dangling logical FK ever being written.</p>
 *
 * <p>Reuses the TG2 H2-in-PostgreSQL-compat harness so the ownership join runs
 * against a real datastore.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(TargetManifestArtifactService.class)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:targetmanifestrejectsurfacingdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class TargetManifestArtifactServiceElementRejectSurfacingTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ModelFileRepository modelFileRepository;

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

    private UUID persistService(String modelFileId, String name) {
        UUID serviceId = UUID.randomUUID();
        ServiceEntity svc = ServiceEntity.builder()
            .id(serviceId.toString())
            .modelFileId(modelFileId)
            .applicationId("app-1")
            .name(name)
            .build();
        entityManager.persist(svc);
        return serviceId;
    }

    private static TargetManifestArtifactInput input(String tag, UUID serviceElementId) {
        return new TargetManifestArtifactInput(
            tag, "pom", "MAVEN", "pom.xml", "<project/>", null,
            List.of(), List.of(), serviceElementId);
    }

    @Test
    @DisplayName("A cross-architecture service id is rejected with routing metadata that GlobalExceptionHandler maps to an HTTP 400 the gateway/UI can route to the picker")
    void crossArchitectureRejectSurfacesAsRoutable400() {
        UUID projectId = UUID.randomUUID();
        UUID targetArchitectureId = UUID.randomUUID();
        UUID otherArchitectureId = UUID.randomUUID();
        persistModelFile(projectId, targetArchitectureId);
        ModelFileEntity otherMf = persistModelFile(projectId, otherArchitectureId);
        UUID crossServiceId = persistService(otherMf.getId(), "Other Arch Service");
        entityManager.flush();

        // 1) The persist path throws the typed validation error...
        ValidationException ex = catchThrowableOfType(
            () -> service.persistLatest(
                projectId, targetArchitectureId, List.of(input("orders", crossServiceId))),
            ValidationException.class);

        // 2) ...carrying the routing triple the frontend keys its inline picker
        //    error on (a bare/null-metadata throw would still pass TG2).
        assertThat(ex).isNotNull();
        assertThat(ex.getEntityType()).isEqualTo("services");
        assertThat(ex.getCode()).isEqualTo("service_element_not_in_architecture");
        assertThat(ex.getField()).isEqualTo("target_service_element_id");
        assertThat(ex.getEntityId()).isEqualTo(crossServiceId.toString());

        // 3) The production handler maps that exact exception to the HTTP 400
        //    snake_case envelope the gateway (and the picker UI) would receive.
        ResponseEntity<Map<String, Object>> response =
            new GlobalExceptionHandler().handleValidationException(ex);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        Map<String, Object> body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.get("status")).isEqualTo(HttpStatus.BAD_REQUEST.value());
        assertThat(body.get("entity_type")).isEqualTo("services");
        assertThat(body.get("code")).isEqualTo("service_element_not_in_architecture");
        assertThat(body.get("field")).isEqualTo("target_service_element_id");
    }
}
