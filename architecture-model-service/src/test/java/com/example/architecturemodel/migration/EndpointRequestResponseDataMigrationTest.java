package com.example.architecturemodel.migration;

import com.example.architecturemodel.model.entity.EndpointEntity;
import com.example.architecturemodel.model.entity.InterfaceEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.EndpointRepository;
import com.example.architecturemodel.repository.entity.InterfaceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Migration verification tests for migration 040: request/response data entity point
 * FK columns on the endpoints table.
 *
 * Since tests use H2 with hibernate ddl-auto=create-drop, we verify the entity
 * field mappings which mirror the migration's column additions.
 *
 * Spec: Metamodel Interface Endpoint - Add Request/Response Data and Simplify Endpoints Table
 * Task Group 1: Migration 040 - Add Request/Response FK Columns
 */
@DataJpaTest
@ActiveProfiles("test")
class EndpointRequestResponseDataMigrationTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ModelFileRepository modelFileRepository;

    @Autowired
    private InterfaceRepository interfaceRepository;

    @Autowired
    private EndpointRepository endpointRepository;

    private ModelFileEntity modelFile;
    private InterfaceEntity iface;

    @BeforeEach
    void setUp() {
        modelFile = ModelFileEntity.builder()
            .id("test-model-file-ep-040")
            .filename("test-ep-migration-040")
            .isDefault(false)
            .build();
        modelFile = modelFileRepository.save(modelFile);

        iface = InterfaceEntity.builder()
            .id("iface-040")
            .modelFileId(modelFile.getId())
            .serviceId("svc-040")
            .name("TestInterface")
            .build();
        iface = interfaceRepository.save(iface);
        entityManager.flush();
    }

    /**
     * Test 1: Verify request_data_entity_point_id column exists and can store values.
     */
    @Test
    @DisplayName("request_data_entity_point_id column exists in endpoints table")
    void testRequestDataEntityPointIdColumnExists() {
        EndpointEntity endpoint = EndpointEntity.builder()
            .id("ep-req-test")
            .modelFileId(modelFile.getId())
            .interfaceId(iface.getId())
            .name("GetUser")
            .requestDataEntityPointId("dep_log_user-request")
            .build();
        endpointRepository.save(endpoint);
        entityManager.flush();
        entityManager.clear();

        EndpointEntity saved = endpointRepository.findById("ep-req-test").orElseThrow();
        assertThat(saved.getRequestDataEntityPointId()).isEqualTo("dep_log_user-request");
    }

    /**
     * Test 2: Verify response_data_entity_point_id column exists and can store values.
     */
    @Test
    @DisplayName("response_data_entity_point_id column exists in endpoints table")
    void testResponseDataEntityPointIdColumnExists() {
        EndpointEntity endpoint = EndpointEntity.builder()
            .id("ep-resp-test")
            .modelFileId(modelFile.getId())
            .interfaceId(iface.getId())
            .name("GetUser")
            .responseDataEntityPointId("dep_log_user-response")
            .build();
        endpointRepository.save(endpoint);
        entityManager.flush();
        entityManager.clear();

        EndpointEntity saved = endpointRepository.findById("ep-resp-test").orElseThrow();
        assertThat(saved.getResponseDataEntityPointId()).isEqualTo("dep_log_user-response");
    }

    /**
     * Test 3: Verify FK columns allow NULL values (nullable by design for referential integrity).
     */
    @Test
    @DisplayName("FK columns allow NULL values - endpoints save without data entity point references")
    void testFkColumnsAllowNull() {
        EndpointEntity endpoint = EndpointEntity.builder()
            .id("ep-null-test")
            .modelFileId(modelFile.getId())
            .interfaceId(iface.getId())
            .name("GetUserNoData")
            .requestDataEntityPointId(null)
            .responseDataEntityPointId(null)
            .build();
        endpointRepository.save(endpoint);
        entityManager.flush();
        entityManager.clear();

        EndpointEntity saved = endpointRepository.findById("ep-null-test").orElseThrow();
        assertThat(saved.getRequestDataEntityPointId()).isNull();
        assertThat(saved.getResponseDataEntityPointId()).isNull();
    }
}
