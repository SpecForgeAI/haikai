package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.entity.EnvironmentDto;
import com.example.architecturemodel.model.dto.entity.InfrastructurePointDto;
import com.example.architecturemodel.model.dto.relationship.DeploymentUnitComputeResourceDto;
import com.example.architecturemodel.model.entity.EnvironmentEntity;
import com.example.architecturemodel.model.entity.InfrastructurePointEntity;
import com.example.architecturemodel.model.entity.DeploymentUnitComputeResourceEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the Infrastructure-domain DTO and Entity mappings on
 * {@link EntityMapper}.
 *
 * Tests asserted by Task 5.1:
 *   1. EntityMapper.toEntity(EnvironmentDto, modelFileId) populates modelFileId
 *      server-side and copies all envelope fields.
 *   2. EntityMapper.toDto(InfrastructurePointEntity) produces a DTO with the
 *      correct point_kind and exactly one non-null typed FK; modelFileId is
 *      not exposed on the DTO.
 *   3. EntityMapper.toEntity(DeploymentUnitComputeResourceDto, modelFileId)
 *      correctly maps computeInfrastructurePointId and the JSONB
 *      runtime_config string round-trip.
 *   4. Round-trip (DTO -> Entity -> DTO) for a relationship with BigDecimal
 *      confidence preserves the BigDecimal value exactly.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation (Task Group 5.1)
 */
class InfrastructureEntityMapperTest {

    private EntityMapper mapper;

    @BeforeEach
    void setUp() {
        mapper = new EntityMapper();
    }

    /**
     * Test 1 (5.1): toEntity sets modelFileId server-side and copies all
     * envelope + standard fields. The DTO does not carry a modelFileId field;
     * the parameter must be the only source.
     */
    @Test
    @DisplayName("toEntity(EnvironmentDto, modelFileId) sets modelFileId from parameter and copies all fields")
    void environmentToEntitySetsModelFileIdServerSide() {
        EnvironmentDto dto = new EnvironmentDto(
            "env-prod",
            "Production",
            "Customer-facing live environment",
            "tier:critical",
            "2024-01-01",
            "2099-12-31",
            "PROD",
            "ACTIVE",
            true,
            false,
            "platform-team",
            "CRITICAL",
            null, // sourceOrigin
            null, // sourceSystem
            null, // sourceReference
            null, // generationStatus
            null, // generationNotes
            null, // lastVerifiedAt
            null, // terraformReady
            null, // terraformModuleHint
            null, // terraformResourceHint
            null, // terraformVariableHints
            null  // terraformNotes
        );

        EnvironmentEntity entity = mapper.toEntity(dto, "model-file-abc");

        // modelFileId comes from the parameter, NOT from the DTO (the DTO has
        // no such field).
        assertThat(entity.getModelFileId()).isEqualTo("model-file-abc");
        assertThat(entity.getId()).isEqualTo("env-prod");
        assertThat(entity.getName()).isEqualTo("Production");
        assertThat(entity.getDescription()).isEqualTo("Customer-facing live environment");
        assertThat(entity.getTags()).isEqualTo("tier:critical");
        assertThat(entity.getValidFrom()).isEqualTo("2024-01-01");
        assertThat(entity.getValidTo()).isEqualTo("2099-12-31");
        assertThat(entity.getEnvironmentType()).isEqualTo("PROD");
        assertThat(entity.getLifecycleState()).isEqualTo("ACTIVE");
        assertThat(entity.getIsCurrentState()).isTrue();
        assertThat(entity.getIsTargetState()).isFalse();
        assertThat(entity.getOwner()).isEqualTo("platform-team");
        assertThat(entity.getCriticality()).isEqualTo("CRITICAL");

        // Round-trip: toDto must NOT expose modelFileId. The DTO has no such
        // field; verify the round-trip preserves all visible state.
        EnvironmentDto roundTrip = mapper.toDto(entity);
        assertThat(roundTrip).isEqualTo(dto);
    }

    /**
     * Test 2 (5.1): toDto for an InfrastructurePointEntity produces a DTO with
     * the correct point_kind and exactly one non-null typed FK. The DTO has
     * no modelFileId field.
     */
    @Test
    @DisplayName("toDto(InfrastructurePointEntity) maps point_kind + the one set FK; modelFileId not exposed")
    void infrastructurePointToDtoMapsDiscriminatorAndOneFk() {
        InfrastructurePointEntity entity = InfrastructurePointEntity.builder()
            .id("ip-cr-1")
            .modelFileId("model-file-xyz")
            .pointKind("COMPUTE_RESOURCE")
            // Exactly one typed FK populated -- compute_resource_id
            .computeResourceId("cr-web-01")
            .build();

        InfrastructurePointDto dto = mapper.toDto(entity);

        assertThat(dto.id()).isEqualTo("ip-cr-1");
        assertThat(dto.pointKind()).isEqualTo("COMPUTE_RESOURCE");
        assertThat(dto.computeResourceId()).isEqualTo("cr-web-01");

        // All 11 other typed FKs must be null.
        assertThat(dto.environmentId()).isNull();
        assertThat(dto.cloudAccountId()).isNull();
        assertThat(dto.locationId()).isNull();
        assertThat(dto.networkId()).isNull();
        assertThat(dto.subnetId()).isNull();
        assertThat(dto.computeClusterId()).isNull();
        assertThat(dto.deploymentUnitId()).isNull();
        assertThat(dto.loadBalancerId()).isNull();
        assertThat(dto.listenerId()).isNull();
        assertThat(dto.dataStoreInstanceId()).isNull();
        assertThat(dto.infrastructureResourceId()).isNull();

        // toEntity round-trip preserves modelFileId from the parameter.
        InfrastructurePointEntity roundTrip = mapper.toEntity(dto, "model-file-xyz");
        assertThat(roundTrip.getModelFileId()).isEqualTo("model-file-xyz");
        assertThat(roundTrip.getPointKind()).isEqualTo("COMPUTE_RESOURCE");
        assertThat(roundTrip.getComputeResourceId()).isEqualTo("cr-web-01");
        assertThat(roundTrip.getEnvironmentId()).isNull();
    }

    /**
     * Test 3 (5.1): toEntity for DeploymentUnitComputeResourceDto correctly
     * maps the renamed compute_infrastructure_point_id field (A2 decision)
     * and the JSONB runtime_config String blob round-trips byte-for-byte.
     * BigDecimal confidence is preserved exactly with scale 3.
     */
    @Test
    @DisplayName("toEntity(DeploymentUnitComputeResourceDto, modelFileId) maps computeInfrastructurePointId, runtimeConfig JSONB and BigDecimal confidence")
    void deploymentUnitComputeResourceMapsPolymorphicFkAndJsonb() {
        String runtimeConfigJson = "{\"replicas\":3,\"env\":{\"LOG_LEVEL\":\"INFO\"}}";
        BigDecimal confidence = new BigDecimal("0.875");

        DeploymentUnitComputeResourceDto dto = new DeploymentUnitComputeResourceDto(
            "ducr-1",
            "du-checkout-svc",
            "ip-cluster-prod",  // compute_infrastructure_point_id -- A2 polymorphic
            "env-prod",
            "1.4.2",
            runtimeConfigJson,
            6,    // desired_instances
            3,    // min_instances
            12,   // max_instances
            "DEPLOYED",
            "evidence:k8s-api",
            confidence,
            "tier:web",
            null, // sourceOrigin
            null, // sourceSystem
            null, // sourceReference
            null, // generationStatus
            null, // generationNotes
            null  // lastVerifiedAt
        );

        DeploymentUnitComputeResourceEntity entity = mapper.toEntity(dto, "model-file-mfid");

        assertThat(entity.getId()).isEqualTo("ducr-1");
        assertThat(entity.getModelFileId()).isEqualTo("model-file-mfid");
        assertThat(entity.getDeploymentUnitId()).isEqualTo("du-checkout-svc");
        // A2 -- the polymorphic compute target FK is named computeInfrastructurePointId.
        assertThat(entity.getComputeInfrastructurePointId()).isEqualTo("ip-cluster-prod");
        assertThat(entity.getEnvironmentId()).isEqualTo("env-prod");
        assertThat(entity.getVersion()).isEqualTo("1.4.2");
        // JSONB runtime_config round-trips as a raw String, byte-for-byte.
        assertThat(entity.getRuntimeConfig()).isEqualTo(runtimeConfigJson);
        assertThat(entity.getDesiredInstances()).isEqualTo(6);
        assertThat(entity.getMinInstances()).isEqualTo(3);
        assertThat(entity.getMaxInstances()).isEqualTo(12);
        assertThat(entity.getDeploymentStatus()).isEqualTo("DEPLOYED");
        assertThat(entity.getEvidenceSource()).isEqualTo("evidence:k8s-api");
        // BigDecimal confidence is preserved exactly with scale 3.
        assertThat(entity.getConfidence()).isEqualByComparingTo(new BigDecimal("0.875"));
        assertThat(entity.getConfidence().scale()).isEqualTo(3);
        assertThat(entity.getTags()).isEqualTo("tier:web");

        // Round-trip: Entity -> DTO preserves all fields including the JSONB
        // runtime_config string round-trip and the BigDecimal scale.
        DeploymentUnitComputeResourceDto rt = mapper.toDto(entity);
        assertThat(rt.computeInfrastructurePointId()).isEqualTo("ip-cluster-prod");
        assertThat(rt.runtimeConfig()).isEqualTo(runtimeConfigJson);
        assertThat(rt.confidence()).isEqualByComparingTo(new BigDecimal("0.875"));
    }

    /**
     * Test 4 (5.1): InfrastructurePointEntity round-trips a different point
     * kind (LOAD_BALANCER) and we verify modelFileId comes from the parameter
     * on toEntity, even when the DTO has no equivalent field. This is the
     * polymorphic correctness check across more than one point_kind.
     */
    @Test
    @DisplayName("InfrastructurePoint round-trips with point_kind LOAD_BALANCER; modelFileId always parameter-sourced")
    void infrastructurePointRoundTripDifferentKind() {
        InfrastructurePointDto dto = new InfrastructurePointDto(
            "ip-lb-1",
            "LOAD_BALANCER",
            null, null, null, null, null, null, null, null,
            "lb-edge-01",  // load_balancer_id is the one set FK
            null, null, null
        );

        InfrastructurePointEntity entity = mapper.toEntity(dto, "model-file-aaa");
        assertThat(entity.getModelFileId()).isEqualTo("model-file-aaa");
        assertThat(entity.getPointKind()).isEqualTo("LOAD_BALANCER");
        assertThat(entity.getLoadBalancerId()).isEqualTo("lb-edge-01");
        assertThat(entity.getComputeResourceId()).isNull();

        InfrastructurePointDto roundTrip = mapper.toDto(entity);
        assertThat(roundTrip).isEqualTo(dto);
    }
}
